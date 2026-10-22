/**
 * ĐO THỜI GIAN NẠP DỮ LIỆU VECTƠ — TRONG CHÍNH TRÌNH DUYỆT
 * ===========================================================
 *
 * VÌ SAO CẦN MODULE NÀY
 *   Lần đo trước chạy bằng Node đọc file từ đĩa. Đó KHÔNG đại diện cho ứng dụng:
 *   trình duyệt tải qua HTTP từ dev server, phần "chuẩn hoá" trong script chỉ
 *   MÔ PHỎNG, và không đo được thời gian giao diện bị chặn.
 *
 * NGUYÊN TẮC SỐ 1: BỘ ĐO KHÔNG ĐƯỢC LÀM CHẬM VIỆC NÓ ĐO
 *   Bản trước `await` thêm 60 ms trước khi trả kho dữ liệu, và `totalMs` cộng
 *   luôn khoảng chờ đó. Người dùng bị chậm 60 ms chỉ để lấy số liệu — vô lý.
 *   Nay `markReady()` chốt thời điểm dữ liệu sẵn sàng và TRẢ KHO NGAY; phần
 *   thu bản ghi long task chạy nền, không chặn ai. Xem `readyMs` và `totalMs`.
 *
 * SAI LẦM ĐÃ MẮC PHẢI — ĐÃ SỬA Ở ĐÂY
 *   1. Bộ đo bị ghi đè do dùng biến module chung. Nay mỗi lượt nạp có bộ đo riêng.
 *   2. `disconnect()` không lấy bản ghi đang chờ — phải `takeRecords()` TRƯỚC.
 *   3. Nhãn "LẦN ĐẦU" sai khi dùng cache, vì `reset()` không xoá cache dữ liệu.
 *   4. `fetchMs` là TỔNG của các request CHẠY CHỒNG NHAU, không cộng với parse được.
 *   5. `heapMb` là heap JS TỔNG của cả trang, không phải RAM riêng của bộ dữ liệu.
 *   6. Gộp "không hỗ trợ API" với "không đo lượt này". Nay tách ba trạng thái.
 *   7. Long task cuối có thể chưa sinh bản ghi lúc đọc — nay đọc lại sau một
 *      nhịp, và BÁO SỐ ĐẾM chứ không suy luận từ thời lượng.
 *   8. Đường tải gói nguyên khối và request tải index lần hai chưa được đo.
 *
 * CÁCH DÙNG
 *   1. Mở app, bấm "AI phân tích" (hoặc bật lớp đối tượng) để nạp lần đầu.
 *   2. Console in khối `[vectorPerf] ...` (có thể vài chục ms sau khi kho dùng được).
 *   3. Xem lại: `window.__vectorPerf.last()`.
 *   4. Đo lần BẬT LẠI: `window.__vectorPerf.reset()` rồi bật/tắt lớp đối tượng.
 *      Muốn đo lại lượt nạp THẬT thì phải tải lại trang (F5).
 */

import type { VectorFeatureStore } from './vectorFeatureStore';

/**
 * TRẠNG THÁI ĐO LONG TASK — ba trường hợp phải phân biệt rõ.
 *
 * SAI LẦM ĐÃ MẮC: bản trước chỉ có `supported | unsupported` và bỏ watcher
 * khi dùng cache. Kết quả lượt dùng cache báo `unsupported` — người đọc tưởng
 * trình duyệt không hỗ trợ API, trong khi thực tế chỉ là **không đo lượt này**.
 */
export type LongTaskStatus =
  /** Đã đo được. Các con số longTask* có ý nghĩa. */
  | 'measured'
  /** Trình duyệt không có API longtask. KHÔNG THỂ đo trên máy này. */
  | 'api-unsupported'
  /** Có API nhưng lượt này cố ý không bật đo (lượt dùng cache). KHông phải lỗi. */
  | 'not-measured-cache-hit';

interface ObservedEntry {
  duration: number;
}

/** Quan sát longtask. Xem giải thích về `takeRecords` ở `stopAndCollect`. */
class LongTaskWatcher {
  private observer: PerformanceObserver | null = null;
  private collected: ObservedEntry[] = [];
  readonly available: boolean;

  constructor() {
    const supported =
      typeof PerformanceObserver !== 'undefined' &&
      Array.isArray(PerformanceObserver.supportedEntryTypes) &&
      PerformanceObserver.supportedEntryTypes.includes('longtask');

    if (!supported) {
      this.available = false;
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.collected.push({ duration: entry.duration });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
      this.observer = observer;
      this.available = true;
    } catch {
      this.observer = null;
      this.available = false;
    }
  }

  /** Đọc bản ghi hiện có mà KHÔNG ngắt kết nối. */
  peek(): ObservedEntry[] {
    if (this.observer) this.collected.push(...this.observer.takeRecords());
    const result = [...this.collected];
    this.collected = [];
    return result;
  }

  /** Đọc và trả số liệu, đồng thời ngắt kết nối. */
  stopAndCollect(): ObservedEntry[] {
    if (this.observer) {
      // THỨ TỰ QUAN TRỌNG: takeRecords() trước, disconnect() sau.
      this.collected.push(...this.observer.takeRecords());
      this.observer.disconnect();
      this.observer = null;
    }
    const result = this.collected;
    this.collected = [];
    return result;
  }
}

/** Số liệu của một lần gọi `loadVectorFeatureStore()`. */
export interface VectorLoadTiming {
  /** Lần gọi thứ mấy kể từ lần tải trang (chỉ để tra cứu, KHÔNG phải nhãn). */
  attempt: number;
  /**
   * Thời gian từ lúc bắt đầu tới khi KHO DỮ LIỆU SẴN SÀNG (ms).
   *
   * ĐÂY LÀ CON SỐ DUY NHẤT ĐÁNG TIN cho "nạp mất bao lâu", và nó KHÔNG bao
   * gồm thời gian chờ thu bản ghi long task. Chốt lúc `markReady()`.
   */
  readyMs: number;
  /**
   * Tổng thời gian của cả lượt đo, kể cả phần chờ thu bản ghi.
   * CHỈ để so sánh giữa các lần đo, KHÔNG phản ánh trải nghiệm người dùng.
   */
  totalMs: number;
  /**
   * TỔNG thời gian tải/đọc thân dữ liệu của mọi request (ms), gồm Blob.text trong worker.
   *
   * CẢNH BÁO: các request chạy SONG SONG nên tổng này LỚN HƠN thời gian thực tế
   * đã trôi qua. Ví dụ 16 request mỗi cái 300 ms chạy cùng lúc thì tổng = 4800 ms
   * nhưng người dùng chỉ chờ ~300 ms. TUYỆT ĐỐI KHÔNG cộng với `parseMs`.
   */
  fetchMsSum: number;
  /** Longest recorded fetch/body-read stage (ms); Blob preparation/read may be separate stages. */
  fetchMsMax: number;
  /** Số request đã phát ra, gồm index lần hai, gói nguyên khối và các file ô. */
  requestCount: number;
  /** Total JSON.parse CPU (ms), split by execution context below; not main-thread blocking time. */
  parseMs: number;
  /** JSON.parse CPU executed in the window/fallback (ms). */
  mainThreadParseMs: number;
  /** JSON.parse CPU executed in the loader worker (ms). */
  workerParseMs: number;
  /** Worker normalization and batch preparation CPU, excluding acknowledgement waits (ms). */
  workerNormalizeMs: number;
  /**
   * Thời gian gộp sau khi các tỉnh tải xong (lập chỉ mục lưới + đếm theo loại).
   * KHÔNG gồm `toVectorFeature()` vì hàm đó chạy trong `loadPackCell`, xen trong
   * thời gian chờ mạng. Xem `docs/measurements.md`.
   */
  mergeMs: number;
  /** Số feature đã nạp. */
  featureCount: number;
  /** Số gói đi theo đường tải ô (nhiều request nhỏ). */
  tiledPackCount: number;
  /** Số gói đi theo đường tải nguyên khối (1 file lớn). */
  monolithicPackCount: number;
  /** Số request tải lại index do cache index trống (xem `indexRefetchCount`). */
  indexRefetchCount: number;
  /** Trạng thái đo long task — xem `LongTaskStatus`. */
  longTaskStatus: LongTaskStatus;
  /** Số task dài (>= 50 ms) chặn giao diện. Vô nghĩa trừ khi `measured`. */
  longTaskCount: number;
  /** Tổng thời gian bị chặn bởi task dài (ms). Vô nghĩa trừ khi `measured`. */
  longTaskMs: number;
  /**
   * SỐ BẢN GHI CHỈ XUẤT HIỆN Ở LẦN ĐỌC THỨ HAI (đơn vị: số bản ghi).
   *
   * Ý NGHĨA ĐÚNG — đừng suy diễn thêm:
   *   - Số này KHÔNG phải độ dài của task (độ dài nằm ở `longTaskMs`).
   *   - Số này KHÔNG chứng minh việc chờ là chưa đủ.
   *   - Nếu = 0 thì KHÔNG chứng minh phép đo đã đầy đủ; có thể chỉ là chưa có
   *     task nào kết thúc trong khoảng chờ, hoặc trình duyệt bàn giao chậm hơn.
   *   - Cách kiểm chứng duy nhất là đo thật trên trình duyệt và so `longTaskMs`
   *     với DevTools Performance panel.
   *
   * Nó chỉ cho biết: CÓ bao nhiêu bản ghi mà lần đọc đầu tiên chưa thấy.
   */
  lateEntryCount: number;
  /**
   * Heap JS TỔNG của cả trang, đo tại thời điểm dữ liệu sẵn sàng (MB), hoặc null.
   *
   * KHÔNG phải RAM riêng của bộ dữ liệu vectơ. Dùng để so sánh TRƯỚC/SAU thì
   * hữu ích, còn quy "bộ dữ liệu chiếm N MB" thì không.
   * Chỉ có khi bật `performance.memory` (Chromium, cờ
   * `--enable-precise-memory-info`).
   */
  pageHeapMb: number | null;
  /**
   * true = lần gọi này KHÔNG nạp gì, chỉ lấy kết quả từ `storePromise` đã cache.
   * Đây mới là thông tin quyết định, KHÔNG phải `attempt`.
   */
  servedFromCache: boolean;
}

/** Bộ đo của một lần nạp. Mỗi lần gọi có bộ đo RIÊNG, không dùng chung. */
export class VectorLoadTimer {
  readonly attempt: number;
  private readonly t0 = performance.now();
  private readonly watcher: LongTaskWatcher | null;
  private readonly servedFromCache: boolean;
  private fetchMsSum = 0;
  private fetchMsMax = 0;
  private requestCount = 0;
  private parseMs = 0;
  private mainThreadParseMs = 0;
  private workerParseMs = 0;
  private workerNormalizeMs = 0;
  private mergeMs = 0;
  private tiledPackCount = 0;
  private monolithicPackCount = 0;
  private indexRefetchCount = 0;
  /** Chốt thời điểm dữ liệu sẵn sàng. `null` nếu chưa gọi `markReady()`. */
  private readyAtMs: number | null = null;
  private readyHeapMb: number | null = null;
  private featureCount = 0;

  constructor(attempt: number, servedFromCache: boolean) {
    this.attempt = attempt;
    this.servedFromCache = servedFromCache;
    // Lượt dùng cache không có việc nặng nào để đo, nên KHÔNG bật quan sát. Nhưng
    // đây là "cố ý không đo", KHÔNG phải "trình duyệt không hỗ trợ".
    this.watcher = servedFromCache ? null : new LongTaskWatcher();
  }

  /**
   * Chốt thời điểm KHO DỮ LIỆU SẴN SÀNG và trả kho NGAY.
   *
   * Đây là hàm mà đường gọi thật sẽ `await` — nó KHÔNG chờ gì thêm. Mọi việc thu
   * bản ghi long task diễn ra ở `collectAsync()` sau đó, chạy nền.
   */
  markReady(store: VectorFeatureStore | null): void {
    this.readyAtMs = performance.now() - this.t0;
    this.readyHeapMb = readPageHeapMb();
    this.featureCount = store?.featureCount ?? 0;
  }

  addFetch(ms: number): void {
    this.fetchMsSum += ms;
    if (ms > this.fetchMsMax) this.fetchMsMax = ms;
  }

  addParse(ms: number): void {
    this.parseMs += ms;
    this.mainThreadParseMs += ms;
  }

  addWorkerParse(ms: number): void { this.parseMs += ms; this.workerParseMs += ms; }
  addWorkerNormalize(ms: number): void { this.workerNormalizeMs += ms; }

  addMerge(ms: number): void {
    this.mergeMs += ms;
  }

  countRequest(): void {
    this.requestCount += 1;
  }

  countIndexRefetch(): void {
    this.indexRefetchCount += 1;
  }

  countTiledPack(): void {
    this.tiledPackCount += 1;
  }

  countMonolithicPack(): void {
    this.monolithicPackCount += 1;
  }

  /**
   * Thu số liệu long task. KHÔNG được `await` trên đường trả dữ liệu.
   *
   * VÌ SAO ĐỌC HAI LẦN: theo đặc tả Long Tasks, trình duyệt chỉ ghi thành bản
   * ghi sau khi task KẾT THÚC. Ngay sau việc nặng cuối cùng, bản ghi của chính
   * task đó có thể chưa tồn tại — nếu đọc luôn thì bỏ sót. Ta đọc lần đầu, chờ
   * một nhịp, đọc lần hai. `lateEntryCount` cho biết CÓ bao nhiêu bản ghi chỉ
   * xuất hiện ở lần sau; KHÔNG suy ra gì thêm từ con số đó.
   */
  async collectAsync(): Promise<VectorLoadTiming> {
    let entries: ObservedEntry[] = [];
    let lateEntries: ObservedEntry[] = [];
    let longTaskStatus: LongTaskStatus;

    if (this.servedFromCache) {
      longTaskStatus = 'not-measured-cache-hit';
    } else if (!this.watcher?.available) {
      longTaskStatus = 'api-unsupported';
    } else {
      entries = this.watcher.peek();
      await new Promise((resolve) => setTimeout(resolve, DRAIN_WAIT_MS));
      lateEntries = this.watcher.stopAndCollect();
      entries = entries.concat(lateEntries);
      longTaskStatus = 'measured';
    }

    const timing: VectorLoadTiming = {
      attempt: this.attempt,
      // `readyMs` chốt ở `markReady()`, KHÔNG bao gồm thời gian chờ drain.
      readyMs: this.readyAtMs ?? performance.now() - this.t0,
      totalMs: performance.now() - this.t0,
      fetchMsSum: this.fetchMsSum,
      fetchMsMax: this.fetchMsMax,
      requestCount: this.requestCount,
      parseMs: this.parseMs,
      mainThreadParseMs: this.mainThreadParseMs,
      workerParseMs: this.workerParseMs,
      workerNormalizeMs: this.workerNormalizeMs,
      mergeMs: this.mergeMs,
      featureCount: this.featureCount,
      tiledPackCount: this.tiledPackCount,
      monolithicPackCount: this.monolithicPackCount,
      indexRefetchCount: this.indexRefetchCount,
      longTaskStatus,
      longTaskCount: entries.length,
      longTaskMs: entries.reduce((sum, e) => sum + e.duration, 0),
      lateEntryCount: lateEntries.length,
      pageHeapMb: this.readyHeapMb,
      servedFromCache: this.servedFromCache,
    };

    lastTiming = timing;
    report(timing);
    return timing;
  }

  /** Đồng bộ tối thiểu để ghi log ngay khi kho dữ liệu sẵn sàng. */
  reportEarly(): void {
    console.info(
      `[vectorPerf] ${this.servedFromCache ? 'DUNG CACHE' : `NAP THAT LAN ${this.attempt}`}: ` +
        `du lieu san sang sau ${(this.readyAtMs ?? 0).toFixed(0)} ms ` +
        `(so long task se ghi them sau)`
    );
  }
}

/**
 * Thời gian chờ để task cuối kịp sinh bản ghi (ms).
 *
 * KHÔNG thuộc vào `readyMs`. Chạy nền sau khi kho đã trả về.
 */
const DRAIN_WAIT_MS = 60;

/** Heap JS tổng của trang, hoặc null nếu API không khả dụng. */
function readPageHeapMb(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number };
  }).memory;
  if (!memory) return null;
  return Math.round(memory.usedJSHeapSize / 1024 / 1024);
}

let attemptCounter = 0;
let lastTiming: VectorLoadTiming | null = null;

function report(t: VectorLoadTiming): void {
  const nhan = t.servedFromCache
    ? 'DUNG CACHE (khong tai lai)'
    : `NAP THAT LAN ${t.attempt}`;

  const longTask =
    t.longTaskStatus === 'measured'
      ? `${t.longTaskCount} luc / ${t.longTaskMs.toFixed(0)} ms chan giao dien`
      : t.longTaskStatus === 'not-measured-cache-hit'
        ? 'KHONG DO (luot dung cache, khong co viec nang)'
        : 'KHONG DO DUOC (trinh duyet khong ho tro API longtask)';

  const lines = [
    `[vectorPerf] ${nhan}`,
    `   data san sang     : ${t.readyMs.toFixed(0)} ms   <-- con so dung`,
    `   request           : ${t.requestCount}  (${t.tiledPackCount} goi chia o + ${t.monolithicPackCount} goi nguyen khoi + ${t.indexRefetchCount} tai lai index)`,
    `   fetch/read (TONG) : ${t.fetchMsSum.toFixed(0)} ms [network + body read; chay song song, KHONG cong duoc]`,
    `   fetch/read max   : ${t.fetchMsMax.toFixed(0)} ms [stage dai nhat]`,
    `   parse CPU (TONG)  : ${t.parseMs.toFixed(0)} ms [main ${t.mainThreadParseMs.toFixed(0)} / worker ${t.workerParseMs.toFixed(0)}; KHONG phai thoi gian chan UI]`,
    `   worker chuan hoa  : ${t.workerNormalizeMs.toFixed(0)} ms [KHONG gom cho ACK]`,
    `   gop chi muc       : ${t.mergeMs.toFixed(0)} ms`,
    `   feature           : ${t.featureCount.toLocaleString()}`,
    `   long task         : ${longTask}`,
    `   ban ghi muon      : ${t.lateEntryCount}  [chi la SO BAN GHI, KHONG phai do dai task]`,
    `   heap ca trang     : ${t.pageHeapMb === null ? 'khong do duoc' : `${t.pageHeapMb} MB`}  [KHONG phai RAM rieng cua du lieu]`,
    `   tong thoi gian do : ${t.totalMs.toFixed(0)} ms (gom ca thoi gian cho thu ban ghi)`,
  ];
  console.info(lines.join('\n'));
}

/** Đặt lại bộ đếm để đo lần tiếp theo. KHÔNG xoá cache dữ liệu. */
export function resetVectorPerf(): void {
  attemptCounter = 0;
  console.info(
    '[vectorPerf] Da dat lai bo dem. KHONG xoa cache du lieu — ' +
      'lan do tiep theo van se bao "DUNG CACHE". ' +
      'Muon do lai tuyet tu (nap that), hay tai lai trang (F5).'
  );
}

export function getLastVectorTiming(): VectorLoadTiming | null {
  return lastTiming;
}

/** Bắt đầu một lượt nạp mới; trả về bộ đo riêng cho lượt đó. */
export function beginVectorLoad(servedFromCache: boolean): VectorLoadTimer {
  attemptCounter += 1;
  return new VectorLoadTimer(attemptCounter, servedFromCache);
}

declare global {
  interface Window {
    __vectorPerf?: {
      reset: typeof resetVectorPerf;
      last: () => VectorLoadTiming | null;
    };
  }
}

if (typeof window !== 'undefined') {
  window.__vectorPerf = {
    reset: resetVectorPerf,
    last: () => lastTiming,
  };
}
