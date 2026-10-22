/**
 * KHO DỮ LIỆU VECTƠ OFFLINE + CHỈ MỤC KHÔNG GIAN LƯỚI
 * =====================================================
 *
 * Vai trò: nạp các gói GeoJSON trong `public/offline-vector/` vào bộ nhớ, chuẩn hoá
 * thành `VectorFeature` (đã tính sẵn bounding box), rồi lập CHỈ MỤC LƯỚI ĐỀU để
 * truy vấn theo bán kính nhanh.
 *
 * VÌ SAO DÙNG LƯỚI ĐỀU MÀ KHÔNG DÙNG R-TREE
 *   Quy mô dữ liệu của 1 vùng là vài chục nghìn feature, mỗi feature nhỏ. Lưới ô 5 km
 *   cho duyệt chỉ vài chục ô cho mỗi truy vấn, không cần thêm thư viện nào (repo
 *   cố tình giữ dependency tối thiểu), và chạy nhanh hơn R-tree ở mức này.
 *
 * VÌ SAO DÙNG MỘT Promise DÙNG CHUNG
 *   `loadOfflineTerrain()` đã dùng mẫu này: React StrictMode mount 2 lần sẽ gọi
 *   effect 2 lần, nếu mỗi lần đều fetch lại toàn bộ GeoJSON thì tốn băng thông và
 *   nhân đôi thời gian khởi động. Cache một Promise là đủ.
 */

import type {
  VectorFeature,
  VectorFeatureKind,
  VectorPackInfo,
} from '../types/vectorFeature';
import { VECTOR_FEATURE_KINDS } from '../types/vectorFeature';
import { toVectorFeature, toPackInfo, type RawGeoJson, type RawVectorTileIndex } from './vectorFeatureDecode';
import { createConcurrencyGate } from '../utils/concurrencyGate';
import { beginVectorLoad, type VectorLoadTimer } from './vectorPerf';
import { loadVectorFileInWorker } from './vectorLoadWorkerClient';

/**
 * CỠ Ô LƯỚI (độ). 0.05° ≈ 5.5 km theo vĩ độ, ~5.9 km theo kinh độ ở Việt Nam.
 * Đủ nhỏ để phân bố đều feature, đủ lớn để số ô truy vấn ở bán kính 100 km vẫn nhỏ
 * (vùng 35 km bán kính ≈ 7x7 ô chứa dữ liệu).
 */
const GRID_CELL_DEG = 0.05;

/** Khóa ô lưới, dạng `${row}_${col}`. */
function cellKey(row: number, col: number): string {
  return `${row}_${col}`;
}

/** Chuyển vĩ độ sang chỉ số hàng lưới (âm được phép - vùng VN đều dương nhưng code tổng quát). */
function rowOf(lat: number): number {
  return Math.floor(lat / GRID_CELL_DEG);
}

/** Chuyển kinh độ sang chỉ số cột lưới. */
function colOf(lon: number): number {
  return Math.floor(lon / GRID_CELL_DEG);
}

/** Một gói dữ liệu vectơ đã nạp, kèm các feature thuộc gói đó. */
export interface VectorPack {
  info: VectorPackInfo;
  features: VectorFeature[];
}

/** Tập hợp tất cả gói + chỉ mục lưới, là kết quả của `loadVectorFeatureStore()`. */
export interface VectorFeatureStore {
  packs: VectorPack[];
  /** Tổng số feature của tất cả gói. */
  featureCount: number;
  /** Đếm theo loại, phủ tất cả loại (kể cả loại có 0). */
  kindCounts: Record<VectorFeatureKind, number>;
  /** Ô lưới -> danh sách index của feature nằm trong ô đó (index vào `allFeatures`). */
  grid: Map<string, number[]>;
  /** Mảng phẳng chứa mọi feature, để tra cứu nhanh theo index trong `grid`. */
  allFeatures: VectorFeature[];
}

/** Gán feature vào các ô lưới mà bounding box của nó chạm tới. */
function indexFeatureInGrid(grid: Map<string, number[]>, index: number, feature: VectorFeature): void {
  const rowMin = rowOf(feature.bounds.minLat);
  const rowMax = rowOf(feature.bounds.maxLat);
  const colMin = colOf(feature.bounds.minLon);
  const colMax = colOf(feature.bounds.maxLon);

  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      const key = cellKey(row, col);
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  }
}

/** Lấy danh sách ô lưới có thể chứa feature trong bounding box cho trước. */
function cellsForBounds(bounds: {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}): string[] {
  const keys: string[] = [];
  for (let row = rowOf(bounds.minLat); row <= rowOf(bounds.maxLat); row++) {
    for (let col = colOf(bounds.minLon); col <= colOf(bounds.maxLon); col++) {
      keys.push(cellKey(row, col));
    }
  }
  return keys;
}

/** Bounding box bao phủ hình tròn (lat, lon, bán kính km). */
function circleBounds(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111.0;
  // Ở vĩ độ cao, cùng bán kính km tương ứng vì độ kinh độ nhỏ hơn
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const dLon = radiusKm / (111.0 * cosLat);
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

/**
 * Đọc danh sách gói vectơ có sẵn do Vite inject lúc build/dev.
 *
 * `__OFFLINE_MAP_ASSETS__` chỉ tồn tại trong môi trường Vite. Khi module này được nạp
 * bởi script kiểm thử chạy bằng `tsx`/`node` (docs/verify-*.ts) thì biến đó không có,
 * nên phải kiểm tra trước khi đọc - nếu không sẽ ném ReferenceError và làm hỏng
 * toàn bộ script kiểm thử.
 */
function getConfiguredVectorRegions(): readonly string[] {
  if (typeof __OFFLINE_MAP_ASSETS__ === 'undefined') return [];
  const assets = __OFFLINE_MAP_ASSETS__;
  if (!assets || !Array.isArray(assets.vectorRegions)) return [];
  return assets.vectorRegions;
}

let storePromise: Promise<VectorFeatureStore | null> | undefined;

/** Kích thước file GeoJSON tối đa chấp nhận (bytes) - chống nạp nhầm file rác. */
const MAX_PACK_BYTES = 80 * 1024 * 1024;

/** UI scheduling budget in milliseconds; it does not limit or discard data. */
const LOAD_CPU_SLICE_MS = 6;
/** Check once per 64 features, avoiding a clock read for every small feature. */
const LOAD_CPU_CHECK_INTERVAL = 64;
// Shared across concurrent cells so each of the 16 requests cannot consume a
// separate slice in the same browser task before yielding.
let cpuSliceStartedAt = performance.now();

async function yieldVectorLoad(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  // Chrome schedules the continuation as a new task. A resolved Promise would
  // only yield to microtasks and would still block input/painting.
  if (typeof scheduler?.yield === 'function') await scheduler.yield();
  else await new Promise<void>((resolve) => setTimeout(resolve, 0));
  cpuSliceStartedAt = performance.now();
}

/** Visit every item in order, permitting input/paint between CPU batches. */
async function forEachInLoadSlices<T>(
  items: readonly T[],
  visit: (item: T, index: number) => void,
  recordCpuMs?: (ms: number) => void,
): Promise<void> {
  let activeStartedAt = performance.now();
  for (let index = 0; index < items.length; index++) {
    if (index % LOAD_CPU_CHECK_INTERVAL === 0 && performance.now() - cpuSliceStartedAt >= LOAD_CPU_SLICE_MS) {
      recordCpuMs?.(performance.now() - activeStartedAt);
      await yieldVectorLoad();
      activeStartedAt = performance.now();
    }
    visit(items[index], index);
  }
  recordCpuMs?.(performance.now() - activeStartedAt);
}

function workerLoadOptions(timer?: VectorLoadTimer, maxChars?: number) {
  return {
    maxChars,
    onMetrics: (metrics: { fetchMs: number; parseMs: number; normalizeMs: number }) => {
      timer?.addFetch(metrics.fetchMs);
      timer?.addWorkerParse(metrics.parseMs);
      timer?.addWorkerNormalize(metrics.normalizeMs);
    },
    appendBatch: async (features: VectorFeature[], batch: VectorFeature[]) => {
      // Every worker batch starts in a fresh message task. Idle/network time
      // since the preceding batch must not trigger a gratuitous yield/ACK delay.
      cpuSliceStartedAt = performance.now();
      await forEachInLoadSlices(batch, (feature) => { features.push(feature); });
    },
  };
}

/**
 * Nạp toàn bộ gói dữ liệu vectơ offline và lập chỉ mục lưới.
 *
 * Trả về `null` khi:
 *   - không có gói vectơ nào trong `public/offline-vector/` (chế độ chỉ có ảnh raster), hoặc
 *   - mọi gói đều lỗi khi đọc (ví dụ bản build đặt sai đường dẫn).
 *
 * Promise được cache: gọi nhiều lần chỉ tải 1 lần, đúng pattern của `loadOfflineTerrain()`.
 */

export function loadVectorFeatureStore(): Promise<VectorFeatureStore | null> {
  // Lần gọi thứ 2 trở đi sẽ trả về đúng promise đã cache nên gần như tức thì.
  // Ta vẫn đo lại để phân biệt "nạp thật" với "lấy từ cache": `storePromise` đã
  // cache nên bật/tắt lớp đối tượng lần hai KHÔNG tải lại gì cả.
  // Mỗi lượt nạp có bộ đo RIÊNG. Trước đây dùng một biến module chung nên lần
  // gọi sau ghi đè số liệu của lần đang chạy — khiến số liệu bị chia sai.
  const servedFromCache = storePromise !== undefined;
  const timer: VectorLoadTimer = beginVectorLoad(servedFromCache);

  storePromise ??= (async () => {
    const regions = getConfiguredVectorRegions();
    if (regions.length === 0) {
      return null;
    }

    const packs: VectorPack[] = [];
    const allFeatures: VectorFeature[] = [];
    const grid = new Map<string, number[]>();

    // Nạp 9 tỉnh SONG SONG thay vì tuần tự. Lý do: mỗi tỉnh là một chuỗi `await`
    // (index -> danh sách ô -> từng ô), nên chạy tuần tự khiến thời gian chờ I/O
    // của 9 tỉnh cộng dồn. Chạy song song, I/O của các tỉnh chồng lên nhau.
    // `Promise.allSettled` vì một tỉnh hỏng không được làm hỏng cả bộ.
    const results = await Promise.allSettled(
      regions.map((regionKey) => loadPack(regionKey, timer))
    );

    const kindCounts = Object.fromEntries(
      VECTOR_FEATURE_KINDS.map((kind) => [kind, 0])
    ) as Record<VectorFeatureKind, number>;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const regionKey = regions[i];
      if (result.status === 'rejected') {
        console.warn(`Không nạp được gói vectơ "${regionKey}"; bỏ qua gói này.`, result.reason);
        continue;
      }
      const pack = result.value;
      if (!pack) continue;

      await forEachInLoadSlices(pack.features, (feature) => {
        const index = allFeatures.length;
        allFeatures.push(feature);
        indexFeatureInGrid(grid, index, feature);
        kindCounts[feature.kind] += 1;
      }, (ms) => timer.addMerge(ms));
      packs.push(pack);
    }

    if (packs.length === 0) return null;

    const store: VectorFeatureStore = {
      packs,
      featureCount: allFeatures.length,
      kindCounts,
      grid,
      allFeatures,
    };

    // mergeMs records active indexing/counting CPU only, excluding scheduling
    // waits. Normalization in loadPack/loadPackCell is still a separate phase.
    return store;
  })();

  // BỘ ĐO KHÔNG ĐƯỢC LÀM CHẬM VIỆC TRẢ KHO.
  // `markReady()` chốt thời điểm dữ liệu sẵn sàng và TRẢ NGAY; `collectAsync()`
  // chạy nền để thu bản ghi long task mà không ai phải chờ. Bản trước `await`
  // 60 ms trước khi trả kho, tức bộ đo làm người dùng chậm đúng bằng thời gian
  // cần để đo — vô lý.
  return storePromise.then(
    (store) => {
      timer.markReady(store);
      timer.reportEarly();
      void timer.collectAsync();
      return store;
    },
    (error) => {
      timer.markReady(null);
      timer.reportEarly();
      void timer.collectAsync();
      throw error;
    }
  );
}

/** Đọc và chuẩn hoá 1 gói GeoJSON. Trả null nếu file rỗng/không đúng định dạng. */
async function loadPack(regionKey: string, timer?: VectorLoadTimer): Promise<VectorPack | null> {
  const url = `${import.meta.env.BASE_URL}offline-vector/${regionKey}.geojson`;

  // ĐƯỜNG TẢI 1: file index / gói nguyên khối. Đo đầy đủ vì đây là request
  // không nằm trong `loadPackCell` — nếu không đo thì `requestCount`,
  // `fetchMsSum`, `parseMs` sẽ thiếu dữ liệu của 9 request này.
  timer?.countRequest();
  const workerResult = await loadVectorFileInWorker(url, regionKey, workerLoadOptions(timer, MAX_PACK_BYTES));
  if (workerResult && 'features' in workerResult) {
    const raw = workerResult.header;
    if (raw.type === 'vector-tile-index') {
      indexCache.set(regionKey, raw as RawVectorTileIndex);
      timer?.countTiledPack();
      return loadTiledPack(raw as RawVectorTileIndex, regionKey, timer);
    }
    timer?.countMonolithicPack();
    return workerResult.features.length ? { info: toPackInfo(regionKey, raw), features: workerResult.features } : null;
  }
  const t0 = performance.now();
  let text: string;
  if (workerResult && 'fallbackBlob' in workerResult) {
    text = await workerResult.fallbackBlob.text();
  } else {
    const response = await fetch(url);
    if (!response.ok) {
      timer?.addFetch(performance.now() - t0);
      throw new Error(`HTTP ${response.status} khi tải ${url}`);
    }
    text = await response.text();
  }
  const tFetch = performance.now();
  // Kiểm tra kích thước sau khi đọc: tránh dựng `Response` giả để kiểm tra `content-length`
  if (text.length > MAX_PACK_BYTES) {
    timer?.addFetch(tFetch - t0);
    throw new Error(`Gói vectơ "${regionKey}" quá lớn (${text.length} ký tự)`);
  }

  const raw = JSON.parse(text) as RawGeoJson | RawVectorTileIndex;
  timer?.addFetch(tFetch - t0);
  timer?.addParse(performance.now() - tFetch);

  // Gói lớn đã được script tải tự chia thành ô: file này chỉ là INDEX, phần thật nằm ở
  // các file ô cùng thư mục. Không xử lý theo đường này thì ứng dụng sẽ không có dữ liệu.
  if (raw.type === 'vector-tile-index') {
    // Reuse the header already parsed above; listCellFiles must not download
    // the same file a second time for each tiled pack.
    indexCache.set(regionKey, raw as RawVectorTileIndex);
    timer?.countTiledPack();
    return loadTiledPack(raw as RawVectorTileIndex, regionKey, timer);
  }

  // Gói nguyên khối: phần thân đo ở trên đã đủ (fetch + parse + 1 request).
  timer?.countMonolithicPack();

  if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) {
    throw new Error(`Gói vectơ "${regionKey}" không phải FeatureCollection hợp lệ`);
  }

  const features: VectorFeature[] = [];
  await forEachInLoadSlices(raw.features, (rawFeature) => {
    const feature = toVectorFeature(rawFeature, regionKey);
    if (feature) features.push(feature);
  });

  if (features.length === 0) return null;

  return { info: toPackInfo(regionKey, raw), features };
}

/**
 * Nạp gói đã chia ô.
 *
 * VÌ SAO CẦN CƠ CHẾ NÀY: một gói đô thị (Đà Nẵng, TP.HCM) có thể tới hơn 160 000
 * feature và 48 MB. Nạp nguyên khối vào RAM rồi đưa hết lên Cesium sẽ treo trình duyệt.
 * Cách khả thi duy nhất là chia ô: file `public/offline-vector/{region}/` chứa từng ô,
 * và ứng dụng chỉ nạp các ô thật sự nằm trong bán kính phân tích (vài chục ô,
 * vài trăm KB) thay vì cả 48 MB.
 *
 * Ở đây ta nạp TRƯỚC toàn bộ ô rồi đếm, vì `buildSiteProfile()` cần thống kê chính xác
 * cả vùng. Nếu sau này cần vẽ trên bản đồ thì `VectorOverlay` sẽ dùng đường tải ô
 * theo khung nhìn (xem `loadPackCells`).
 */
/**
 * SỐ REQUEST TẢI FILE Ô ĐỒNG THỜI TỐI ĐA — giới hạn TOÀN CỤC.
 *
 * VÌ SAO PHẢI TOÀN CỤC MÀ KHÔNG ĐỂ MỖI TỈNH MỘT GIỚI HẠN: `loadVectorFeatureStore()`
 * nạp 9 tỉnh song song, mỗi tỉnh lại gọi `mapWithLimit(..., 16)`. Nếu giới hạn nằm
 * trong từng tỉnh thì tổng số request cùng lúc là 9 × 16 = 144, khác hẳn phép đo
 * (16 tác vụ tổng cộng) và dễ làm trình duyệt nghẽn hàng đợi.
 *
 * Số này lấy từ phép đo `docs/measure-vector-parallel.mjs` trên máy này:
 * tuần tự 2592 ms -> 16 luồng 2146 ms -> 32 luồng 2152 ms -> 64 luồng 2283 ms.
 * 64 luồng CHẬM HƠN vì tranh giành ổ đĩa. Có thể khác trên máy khác.
 */
const CELL_FETCH_CONCURRENCY = 16;

/**
 * Bộ giới hạn toàn cục cho mọi request tải file ô.
 *
 * Mọi gọi `acquire()` đều phải đi qua đây, bất kể tỉnh nào. Nhờ vậy "16" nghĩa là
 * đúng 16 request trên toàn hệ thống, không phải 16 mỗi tỉnh.
 */
const cellFetchGate = createConcurrencyGate(CELL_FETCH_CONCURRENCY);



async function loadTiledPack(
  index: RawVectorTileIndex,
  regionKey: string,
  timer?: VectorLoadTimer
): Promise<VectorPack | null> {
  const cellFiles = await listCellFiles(regionKey, timer);

  // TẢI CÁC Ô SONG SONG; giới hạn số request đồng thời do cổng TOÀN CỤC
  // `cellFetchGate` đảm nhiệm, không phải giới hạn riêng của tỉnh này.
  //
  // Trước đây là `for (...) { await loadPackCell(...) }` — tuần tự. Đo trên máy này:
  //   tuần tự : I/O 1121 ms + parse 1471 ms = 2592 ms
  //   16 luồng : I/O  373 ms + parse 1772 ms = 2146 ms
  // I/O giảm khoảng 3 lần. Phần `parse` gần như không đổi — xem
  // `docs/measure-vector-parallel.mjs`.
  const batches = await Promise.all(
    cellFiles.map((cellName) => {
      timer?.countRequest();
      return loadPackCell(regionKey, cellName, timer);
    })
  );

  const features: VectorFeature[] = [];
  for (const cellFeatures of batches) {
    await forEachInLoadSlices(cellFeatures, (feature) => {
      if (feature) features.push(feature);
    });
  }

  if (features.length === 0) return null;

  const info: VectorPackInfo = {
    regionKey,
    name: index.name ?? regionKey,
    centerLat: index.center?.lat ?? 0,
    centerLon: index.center?.lon ?? 0,
    radiusKm: index.radiusKm ?? 0,
    featureCount: index.featureCount ?? features.length,
    kindCounts: (index.kindCounts ?? {}) as Partial<Record<VectorFeatureKind, number>>,
    downloadedAt: index.downloadedAt ?? '',
  };

  return { info, features };
}

/** Danh sách tên file ô (không kể đuôi) của 1 gói đã chia ô. */
async function listCellFiles(regionKey: string, timer?: VectorLoadTimer): Promise<string[]> {
  const index = await fetchVectorTileIndex(regionKey, timer);
  if (!index) return [];

  // Đường nhanh: index đã liệt kê sẵn các ô có thật.
  if (Array.isArray(index.cells) && index.cells.length > 0) return index.cells;

  // Dự phòng cho gói cũ chưa có `cells`: dò lưới phủ bbox. Sẽ có 404 ở các
  // góc vuông trống — đây là hành vi bình thường (ô trống ≠ dữ liệu hỏng) và
  // `loadPackCell` đã bỏ qua 404, nên bản đồ vẫn đúng, chỉ là console nhiễu.
  if (!index.bbox) return [];

  const [minLon, minLat, maxLon, maxLat] = index.bbox;
  const cellDeg = index.cellDeg || 0.1;

  const names: string[] = [];
  const rowMin = Math.floor(minLat / cellDeg);
  const rowMax = Math.floor(maxLat / cellDeg);
  const colMin = Math.floor(minLon / cellDeg);
  const colMax = Math.floor(maxLon / cellDeg);

  // Vùng 55 km bán kính ở cellDeg=0.1 cho khoảng 12x12 ô vuông -> 144 request,
  // trong đó ~40 ô là 404. Chỉ diễn ra 1 lần cho mỗi gói rồi được cache.
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      names.push(`${row}_${col}`);
    }
  }
  return names;
}

/** Đọc index của gói đã chia ô (dùng chung cache với listCellFiles). */
const indexCache = new Map<string, RawVectorTileIndex | null>();

/**
 * Đọc index của gói đã chia ô (dùng chung cache với `listCellFiles`).
 *
 * Normal loads reuse the header cached by loadPack(). The fallback is retained
 * for callers with no cached index and still counts every actual request.
 */
async function fetchVectorTileIndex(
  regionKey: string,
  timer?: VectorLoadTimer
): Promise<RawVectorTileIndex | null> {
  if (indexCache.has(regionKey)) return indexCache.get(regionKey) ?? null;

  timer?.countIndexRefetch();
  timer?.countRequest();

  // Khai báo NGOÀI try: nhánh catch cũng cần t0 để ghi thời gian đã chờ.
  const t0 = performance.now();

  try {
    const response = await fetch(`${import.meta.env.BASE_URL}offline-vector/${regionKey}.geojson`);
    if (!response.ok) {
      timer?.addFetch(performance.now() - t0);
      indexCache.set(regionKey, null);
      return null;
    }
    const text = await response.text();
    const tFetch = performance.now();
    const raw = JSON.parse(text) as RawGeoJson | RawVectorTileIndex;
    timer?.addFetch(tFetch - t0);
    timer?.addParse(performance.now() - tFetch);

    const result = raw.type === 'vector-tile-index' ? (raw as RawVectorTileIndex) : null;
    indexCache.set(regionKey, result);
    return result;
  } catch {
    timer?.addFetch(performance.now() - t0);
    indexCache.set(regionKey, null);
    return null;
  }
}

/** Đọc 1 file ô; trả mảng rỗng nếu ô không tồn tại (bình thường, không phải lỗi). */
async function loadPackCell(
  regionKey: string,
  cellName: string,
  timer?: VectorLoadTimer
): Promise<(VectorFeature | null)[]> {
  // Chờ cổng toàn cục cho tới khi có chỗ. Phải `finally` để luôn trả quyền —
  // nếu không, một request lỗi sẽ làm nghẽn vĩnh viễn cổng.
  const release = await cellFetchGate.acquire();
  try {
    const url = `${import.meta.env.BASE_URL}offline-vector/${regionKey}/${cellName}.geojson`;

    const workerResult = await loadVectorFileInWorker(url, regionKey, workerLoadOptions(timer));
    if (workerResult && 'features' in workerResult) return workerResult.features;

    // Đo riêng thời gian chờ mạng và thời gian parse. `response.json()` tự parse
    // trong, nên không tách được hai mốc nếu gọi thẳng — ta bọc cả lần gọi để
    // lấy tổng, rồi trừ phần parse đo bằng `JSON.parse` trên text đã đọc.
    const t0 = performance.now();
    let text: string;
    if (workerResult && 'fallbackBlob' in workerResult) {
      text = await workerResult.fallbackBlob.text();
    } else {
      const response = await fetch(url);
      if (!response.ok) {
        timer?.addFetch(performance.now() - t0);
        return []; // 404 = ô trống, bình thường. Không log để tránh spam console.
      }
      text = await response.text();
    }
    const tFetch = performance.now();
    const raw = JSON.parse(text) as RawGeoJson;
    const tParse = performance.now();

    timer?.addFetch(tFetch - t0);
    timer?.addParse(tParse - tFetch);

    if (raw.type !== 'FeatureCollection' || !Array.isArray(raw.features)) return [];
    const features: (VectorFeature | null)[] = [];
    await forEachInLoadSlices(raw.features, (rawFeature) => {
      features.push(toVectorFeature(rawFeature, regionKey));
    });
    return features;
  } catch {
    return [];
  } finally {
    release();
  }
}

/** Xoá cache để nạp lại (chỉ dùng trong kiểm thử, không gọi từ ứng dụng). */
export function resetVectorFeatureStoreCache(): void {
  storePromise = undefined;
}

/**
 * Truy vấn các feature nằm trong một bounding box.
 *
 * Dùng chỉ mục lưới nên chỉ duyệt các ô có thể chứa dữ liệu, thay vì toàn bộ feature.
 * Kết quả KHÔNG đảm bảo nằm trong bán kính - đó là việc của `featureAwareness.ts`.
 *
 * @param store kho dữ liệu đã nạp
 * @param kinds chỉ lấy các loại này; bỏ trống = lấy tất cả
 */
export function queryFeaturesInBounds(
  store: VectorFeatureStore,
  bounds: { minLat: number; minLon: number; maxLat: number; maxLon: number },
  kinds?: readonly VectorFeatureKind[]
): VectorFeature[] {
  // Dùng Set để khử trùng khi 1 feature nằm ở nhiều ô
  const seen = new Set<number>();
  const result: VectorFeature[] = [];

  for (const key of cellsForBounds(bounds)) {
    const bucket = store.grid.get(key);
    if (!bucket) continue;

    for (const index of bucket) {
      if (seen.has(index)) continue;
      seen.add(index);

      const feature = store.allFeatures[index];
      if (kinds && !kinds.includes(feature.kind)) continue;

      // Lọc chính xác bằng bounding box (lưới chỉ là ứng viên)
      const b = feature.bounds;
      if (b.maxLat < bounds.minLat || b.minLat > bounds.maxLat) continue;
      if (b.maxLon < bounds.minLon || b.minLon > bounds.maxLon) continue;

      result.push(feature);
    }
  }

  return result;
}

/**
 * Truy vấn feature trong hình tròn (lat, lon, bán kính km).
 * Lọc 2 bước: lưới (nhanh) -> bounding box chính xác.
 * Vẫn KHÔNG lọc theo cự ly thật tới hình học - xem `queryFeaturesNear()` trong
 * `featureAwareness.ts` cho bản đầy đủ có cự ly và sắp xếp theo cự ly.
 */
export function queryFeaturesInRadius(
  store: VectorFeatureStore,
  lat: number,
  lon: number,
  radiusKm: number,
  kinds?: readonly VectorFeatureKind[]
): VectorFeature[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(radiusKm > 0)) return [];
  return queryFeaturesInBounds(store, circleBounds(lat, lon, radiusKm), kinds);
}

/** Bán kính lưới (km) - dùng khi cần biết độ phân giải không gian của chỉ mục. */
export const VECTOR_GRID_CELL_KM = GRID_CELL_DEG * 111.0;

/** Bounding box bao phủ hình tròn - export để `featureAwareness.ts` dùng lại. */
export function getCircleBounds(lat: number, lon: number, radiusKm: number) {
  return circleBounds(lat, lon, radiusKm);
}
