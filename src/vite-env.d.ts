/// <reference types="vite/client" />

/** Injected by Vite from the optional data packs present at startup/build. */
declare const __OFFLINE_MAP_ASSETS__: Readonly<{
  terrain: boolean;
  satellite: boolean;
  satelliteMaxLevel: number;
  terrainMap: boolean;
  /**
   * Tên các gói dữ liệu vectơ có trong public/offline-vector (không kể .geojson).
   * Rỗng = chưa tải gói vectơ nào; ứng dụng chạy ở chế độ chỉ có ảnh raster.
   */
  vectorRegions: string[];
}>;
