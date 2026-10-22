/**
 * KIỂU DỮ LIỆU LỚP VECTƠ OFFLINE (OSM -> GeoJSON)
 * =================================================
 *
 * Vai trò: định nghĩa hợp đồng dữ liệu cho lớp vectơ thứ hai của hệ thống (lớp thứ nhất
 * là ảnh raster - chỉ để NHÌN). Lớp này cho biết pixel nào là nhà, pixel nào là sông,
 * pixel nào là suối, và mỗi đối tượng ở đâu - để hệ thống có thể trả lời câu hỏi:
 * "trong tầm hoạt động của khí tài này, nhà/sông/suối/núi nằm ở đâu, cách bao xa".
 *
 * Nguồn: OpenStreetMap, tải offline bằng `download-tactical-vector.js` vào
 * `public/offline-vector/{region}.geojson`. Mỗi feature có `properties.kind` là
 * một chuỗi thuộc `VectorFeatureKind` - đây là hợp đồng ổn định, frontend phụ thuộc vào nó.
 */

/**
 * 10 loại đối tượng vectơ mà hệ thống sử dụng.
 * Giá trị phải khớp chính xác với `properties.kind` do download-tactical-vector.js ghi ra.
 *
 * - `building`    : nhà / công trình xây dựng (đa giác). Dùng để đo mật độ dân cư,
 *                   và (giai đoạn sau) làm chướng ngại tầm thấp cho phủ sóng.
 * - `water_river` : sông / kênh lớn (tuyến).
 * - `water_stream`: suối / kênh nhỏ (tuyến).
 * - `water_body`  : hồ / đầm lầm / mặt nước kín (đa giác).
 * - `peak`        : đỉnh núi (điểm). Cao độ lấy từ `properties.ele`, nếu thiếu sẽ
 *                   lấy từ terrain tại vị trí đó.
 * - `ridge`       : sườn núi / lưng núi (tuyến).
 * - `highway`     : đường giao thông (tuyến).
 * - `forest`      : rừng / cây lâu năm (đa giác).
 * - `land`        : loại đất sử dụng (đa giác): residential, farmland, meadow...
 * - `place`       : địa danh (điểm): làng, xã, thị trấn, quận...
 */
export type VectorFeatureKind =
  | 'building'
  | 'water_river'
  | 'water_stream'
  | 'water_body'
  | 'peak'
  | 'ridge'
  | 'highway'
  | 'forest'
  | 'land'
  | 'place';

/** Danh sách đầy đủ các kind, dùng để khởi tạo bộ đếm và validate. */
export const VECTOR_FEATURE_KINDS: readonly VectorFeatureKind[] = [
  'building',
  'water_river',
  'water_stream',
  'water_body',
  'peak',
  'ridge',
  'highway',
  'forest',
  'land',
  'place',
] as const;

/** Nhãn tiếng Việt hiển thị trên UI, khớp với nhãn trong script tải. */
export const VECTOR_KIND_LABELS: Readonly<Record<VectorFeatureKind, string>> = {
  building: 'Nhà / công trình',
  water_river: 'Sông / kênh lớn',
  water_stream: 'Suối / kênh nhỏ',
  water_body: 'Hồ / đầm lầm',
  peak: 'Đỉnh núi',
  ridge: 'Sườn núi',
  highway: 'Đường giao thông',
  forest: 'Rừng',
  land: 'Loại đất',
  place: 'Địa danh',
};

/**
 * Hình học GeoJSON đã được rút gọn. Chỉ 3 dạng vì script tải chỉ sinh ra 3 dạng này
 * (mọi Multi* đã được tách/loại ở bước chuyển đổi trong script).
 * - `Point`      : đỉnh núi, địa danh.
 * - `LineString` : sông, suối, đường, sườn núi.
 * - `Polygon`    : nhà, hồ, rừng, loại đất.
 *
 * Đơn vị toạ độ: WGS-84, độ thập phân. Mảng `coordinates` theo đúng đặc tả GeoJSON,
 * tức là `[lon, lat]` (kinh độ TRƯỚC, vĩ độ sau).
 */
export type VectorGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] };

/** Bounding box (độ) của 1 feature, dùng để lọc nhanh không cần duyệt hết điểm. */
export interface VectorBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/**
 * Thuộc tính của 1 feature, đã lọc còn các tag OSM quan trọng.
 * Tất cả đều là tuỳ chọn vì OSM không phải lúc nào cũng có đủ tag.
 */
export interface VectorFeatureProperties {
  /** Loại đối tượng - trường bắt buộc, quyết định cách feature được xử lý. */
  kind: VectorFeatureKind;
  /**
   * Nhãn tiếng Việt. KHÔNG bắt buộc: script tải KHÔNG ghi trường này vào mỗi feature
   * vì với 165 000 feature thì lặp lại chuỗi này làm phình file thêm nhiều MB vô ích.
   * UI lấy nhãn từ bảng `VECTOR_KIND_LABELS` ở module thay vì đọc từ dữ liệu.
   */
  labelVi?: string;
  /** Tên địa danh nếu có (tiếng Việt ưu tiên, fallback tiếng Anh). */
  name?: string;
  nameVi?: string;
  /** Tag building: loại công trình (house, residential, garage, church...). */
  building?: string;
  /** Số tầng, nếu OSM có ghi. */
  buildingLevels?: number;
  /** Chiều cao (m) nếu OSM có ghi tag height/building:height. */
  heightM?: number;
  /** Loại tuyến nước: river / stream / canal / ditch... */
  waterway?: string;
  /** Loại tự nhiên: water / wood / peak / ridge... */
  natural?: string;
  /** Loại sử dụng đất: forest / residential / farmland / meadow... */
  landuse?: string;
  /** Phân loại đường: motorway / primary / secondary / residential... */
  highway?: string;
  /** Cấp địa danh: village / town / city / suburb... */
  place?: string;
  /** Bề mặt đường: asphalt / paved / unpaved... */
  surface?: string;
  /** Cao độ (m) nếu OSM có ghi tag ele (chủ yếu ở đỉnh núi). */
  ele?: number;
  /** Lớp (layer) cho trường hợp vùng/đường chồng lấn nhau. */
  layer?: number;
}

/** 1 đối tượng vectơ đã nạp vào bộ nhớ. */
export interface VectorFeature {
  /** Định danh ổn định, dạng `kind:node/123` hoặc `kind:way/456`. */
  id: string;
  kind: VectorFeatureKind;
  geometry: VectorGeometry;
  properties: VectorFeatureProperties;
  /** Bounding box đã tính sẵn để truy vấn nhanh. */
  bounds: VectorBounds;
  /** Vùng chứa feature này, để khi nạp nhiều vùng thì biết thuộc vùng nào. */
  regionKey: string;
}

/** Thông tin 1 gói dữ liệu vectơ tải về (tương ứng 1 file .geojson trong public/offline-vector). */
export interface VectorPackInfo {
  /** Tên vùng, ví dụ "tamdao". */
  regionKey: string;
  /** Tên mô tả đầy đủ. */
  name: string;
  /** Tâm vùng (độ). */
  centerLat: number;
  centerLon: number;
  /** Bán kính vùng (km) mà script đã tải về. */
  radiusKm: number;
  /** Số feature trong gói. */
  featureCount: number;
  /** Số feature theo từng loại. */
  kindCounts: Partial<Record<VectorFeatureKind, number>>;
  /** Thời điểm tải (ISO string). */
  downloadedAt: string;
}
