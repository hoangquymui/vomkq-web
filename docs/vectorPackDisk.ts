/**
 * Nạp gói vectơ từ đĩa cho các script kiểm chứng trong docs/.
 *
 * VÌ SAO CẦN FILE NÀY:
 * Script verify chạy bằng `tsx` ngoài Vite, nên không dùng được loader mà
 * `vectorFeatureStore.ts` đang dùng trong ứng dụng. Trước đây mỗi script tự
 * viết một bản `buildStoreFromDisk` — và bản đó chỉ biết dạng gói liền
 * (FeatureCollection). Sau khi `download-tactical-vector.js` tự tách gói > 8 MB
 * thành index + ô, các bản sao đó im lặng coi gói là RỖNG (0 feature) và in ra
 * profile sai — đúng lỗi đã gặp với gói Đà Nẵng 91k đối tượng.
 *
 * Vì vậy: gom MỘT bản hiểu đầy đủ cả 2 dạng gói vào đây, mọi script cùng dùng.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { VectorFeatureStore } from '../src/services/vectorFeatureStore';
import type {
  VectorFeature,
  VectorFeatureKind,
  VectorGeometry,
} from '../src/types/vectorFeature';
import { computeGeometryBounds } from '../src/utils/vectorGeometry';

/** Khớp với `GRID_CELL_DEG` của vectorFeatureStore — store dựng tay phải dùng
 *  cùng kích thước ô, nếu không mọi truy vấn theo bán kính sẽ rỗng. */
const GRID_CELL_DEG = 0.05;

/** Thông tin chung của một gói, đọc được từ cả 2 dạng file. */
export interface DiskPackInfo {
  regionKey: string;
  /** 'monolith' = 1 file FeatureCollection; 'tiled' = index + ô 0.1°. */
  layout: 'monolith' | 'tiled';
  cellCount?: number;
  name: string;
  center: { lat: number; lon: number };
  radiusKm: number;
  featureCount: number;
  kindCounts: Record<string, number>;
  downloadedAt: string;
}

export const VECTOR_PACK_DIR = 'public';

/** Trả về đường dẫn tuyệt đối tới thư mục gói vectơ, tính từ thư mục gốc dự án. */
export function vectorPackDir(): string {
  return join(process.cwd(), VECTOR_PACK_DIR, 'offline-vector');
}

/** Liệt kê các vùng đã tải (chỉ tính file index/gói liền, không tính ô hay file `.all`). */
export function listDownloadedRegions(dir = vectorPackDir()): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.geojson') && !f.endsWith('.geojson.all'))
    .map((f) => f.replace(/\.geojson$/, ''))
    .sort();
}

/**
 * Đọc phần metadata của gói mà KHÔNG cần nạp hết feature.
 * Gói liền nhét trong `.metadata`; gói tách ô đặt ở đỉnh — gộp cả hai về một chỗ.
 */
export function readPackHeader(filePath: string): DiskPackInfo | null {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const tiled = raw.type === 'vector-tile-index';
  const meta = tiled ? raw : (raw.metadata ?? {});

  return {
    regionKey: meta.region ?? raw.regionKey ?? filePath.replace(/\.geojson$/, ''),
    layout: tiled ? 'tiled' : 'monolith',
    cellCount: raw.cellCount,
    name: meta.name ?? raw.name ?? '',
    center: meta.center ?? { lat: 0, lon: 0 },
    radiusKm: meta.radiusKm ?? 30,
    featureCount: raw.featureCount ?? raw.features?.length ?? 0,
    kindCounts: meta.kindCounts ?? {},
    downloadedAt: meta.downloadedAt ?? raw.downloadedAt ?? '',
  };
}

/** Nạp mảng GeoJSON feature thô từ file, tự xử lý cả gói tách ô lẫn gói liền. */
function readRawFeatures(filePath: string): any[] {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));

  if (raw.type === 'vector-tile-index') {
    const cellDir = filePath.replace(/\.geojson$/, '');
    if (!existsSync(cellDir)) return [];
    const merged: any[] = [];
    for (const cellFile of readdirSync(cellDir).filter((f) => f.endsWith('.geojson'))) {
      const cellRaw = JSON.parse(readFileSync(join(cellDir, cellFile), 'utf8'));
      if (Array.isArray(cellRaw.features)) {
        // KHÔNG dùng `push(...mảng)`: một ô đô thị có thể chứa hơn 100 000
        // feature, và spread vượt giới hạn đối số của JS -> "Maximum call stack
        // size exceeded". Lặp bằng index là cách duy nhất chắc chắn chạy được.
        for (let i = 0; i < cellRaw.features.length; i++) merged.push(cellRaw.features[i]);
      }
    }
    return merged;
  }

  return Array.isArray(raw.features) ? raw.features : [];
}

/**
 * Dựng `VectorFeatureStore` từ file trên đĩa.
 *
 * @param packDir Thư mục gói (mặc định `public/offline-vector`).
 * @param regionKey Vùng cần nạp. Bỏ trống = nạp TẤT CẢ (dùng cho verify toàn bộ).
 */
export function loadPackFromDisk(
  regionKey?: string,
  packDir = vectorPackDir()
): VectorFeatureStore | null {
  if (!existsSync(packDir)) return null;
  const keys = regionKey ? [regionKey] : listDownloadedRegions(packDir);
  if (keys.length === 0) return null;

  const packs: VectorFeatureStore['packs'] = [];
  const allFeatures: VectorFeature[] = [];
  const grid = new Map<string, number[]>();
  const kindCounts = {} as Record<VectorFeatureKind, number>;

  for (const key of keys) {
    const file = join(packDir, `${key}.geojson`);
    if (!existsSync(file)) continue;

    const header = readPackHeader(file);
    const rawFeatures = readRawFeatures(file);
    const baseIndex = allFeatures.length;

    rawFeatures.forEach((feature: any, offset: number) => {
      const kind = feature.properties?.kind as VectorFeatureKind;
      const geometry = feature.geometry as VectorGeometry | undefined;
      if (!kind || !geometry) return;

      const bounds = computeGeometryBounds(geometry);
      if (!bounds) return;

      allFeatures.push({
        id: String(feature.id ?? `${kind}:${baseIndex + offset}`),
        kind,
        geometry,
        properties: feature.properties,
        bounds,
        regionKey: key,
      });
      kindCounts[kind] = (kindCounts[kind] ?? 0) + 1;

      // Rải feature vào MỌI ô lưới mà bounds của nó chạm tới, để truy vấn theo
      // bán kính không bỏ sót đối tượng nằm ở rìa. Các feature chạm nhiều ô sẽ
      // xuất hiện trong nhiều ô — `queryFeaturesInRadius` phải khử trùng lặp.
      for (
        let row = Math.floor(bounds.minLat / GRID_CELL_DEG);
        row <= Math.floor(bounds.maxLat / GRID_CELL_DEG);
        row++
      ) {
        for (
          let col = Math.floor(bounds.minLon / GRID_CELL_DEG);
          col <= Math.floor(bounds.maxLon / GRID_CELL_DEG);
          col++
        ) {
          const cellKey = `${row}_${col}`;
          const bucket = grid.get(cellKey);
          if (bucket) bucket.push(allFeatures.length - 1);
          else grid.set(cellKey, [allFeatures.length - 1]);
        }
      }
    });

    packs.push({
      info: {
        regionKey: key,
        name: header?.name ?? key,
        centerLat: header?.center.lat ?? 0,
        centerLon: header?.center.lon ?? 0,
        radiusKm: header?.radiusKm ?? 0,
        featureCount: allFeatures.length - baseIndex,
        kindCounts: { ...(header?.kindCounts as object) } as Record<
          VectorFeatureKind,
          number
        >,
        downloadedAt: header?.downloadedAt ?? '',
      },
      features: allFeatures.slice(baseIndex),
    });
  }

  if (allFeatures.length === 0) return null;

  return {
    packs,
    featureCount: allFeatures.length,
    kindCounts,
    grid,
    allFeatures,
  };
}
