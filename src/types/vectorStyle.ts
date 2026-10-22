/**
 * BẢNG MÀU & QUY ƯỚC HIỂN THỊ CHO LỚP ĐỐI TƯỢNG VÙNG PHỦ (OSM)
 * =============================================================
 *
 * Tách riêng khỏi `VectorOverlay.tsx` vì 2 lý do:
 *   1. Fast Refresh của React chỉ hoạt động khi 1 file chỉ export component. Nếu file
 *      vừa export component vừa export hằng số, mỗi lần sửa sẽ reload cả trang.
 *   2. Bảng màu cần dùng ở nhiều nơi (chú giải bản đồ, bảng đặc tính, lớp vẽ);
 *      để riêng thì import không kéo theo cả Cesium vào nơi chỉ cần màu sắc.
 */

import type { VectorFeatureKind } from './vectorFeature';
import { VECTOR_KIND_LABELS } from './vectorFeature';

/**
 * Màu theo loại đối tượng, dạng CSS để dùng được cho cả Cesium lẫn chú giải HTML.
 *
 * Màu được chọn theo logic chiến thuật, không phải theo thẩm mỹ thuần:
 *   - Nước (sông/suối/hồ): xanh dương rực, vì cần thấy ngay khi đánh giá phủ sóng.
 *   - Núi: đỏ, vì đây là chướng ngại tự nhiên quan trọng nhất về mặt vùng mù.
 *   - Nhà: xám trung tính, để không lấn át nền tảng ảnh vệ tinh bên dưới.
 *   - Đường: vàng, vì thuộc cả mặt địa lẫn hạ tầng quân sự.
 *   - Rừng: xanh lá, để phân biệt với màu xanh dương của nước.
 */
export const VECTOR_KIND_COLORS: Readonly<Record<VectorFeatureKind, string>> = {
  building: '#9aa4b2',
  water_river: '#38bdf8',
  water_stream: '#67e8f9',
  water_body: '#0ea5e9',
  peak: '#ef4444',
  ridge: '#f97316',
  highway: '#fbbf24',
  forest: '#22c55e',
  land: '#a16207',
  place: '#c084fc',
};

/** Độ dày đường vẽ (pixel) cho loại tuyến. */
export const VECTOR_LINE_WIDTHS: Readonly<Partial<Record<VectorFeatureKind, number>>> = {
  water_river: 3,
  highway: 2.5,
  water_stream: 2,
  ridge: 2,
};

/** Kích thước điểm (pixel) cho loại điểm. */
export const VECTOR_POINT_SIZES: Readonly<Partial<Record<VectorFeatureKind, number>>> = {
  peak: 9,
  place: 5,
};

/**
 * Nhóm hiển thị mặc định: nhóm những loại "nổi bật về mặt phủ sóng" được bật mặc
 * định, còn nhóm "nền" tắt để bản đồ không bị rối.
 */
export const VECTOR_PROMINENT_KINDS: readonly VectorFeatureKind[] = [
  'water_river',
  'water_stream',
  'water_body',
  'peak',
  'ridge',
];

export const VECTOR_BACKGROUND_KINDS: readonly VectorFeatureKind[] = [
  'building',
  'highway',
  'forest',
  'land',
  'place',
];

/** Danh sách {màu, nhãn} theo thứ tự hiển thị, dùng cho chú giải bản đồ. */
export const VECTOR_LEGEND_ITEMS: readonly {
  kind: VectorFeatureKind;
  color: string;
  label: string;
}[] = [
  { kind: 'water_river', color: VECTOR_KIND_COLORS.water_river, label: VECTOR_KIND_LABELS.water_river },
  { kind: 'water_stream', color: VECTOR_KIND_COLORS.water_stream, label: VECTOR_KIND_LABELS.water_stream },
  { kind: 'water_body', color: VECTOR_KIND_COLORS.water_body, label: VECTOR_KIND_LABELS.water_body },
  { kind: 'peak', color: VECTOR_KIND_COLORS.peak, label: VECTOR_KIND_LABELS.peak },
  { kind: 'ridge', color: VECTOR_KIND_COLORS.ridge, label: VECTOR_KIND_LABELS.ridge },
  { kind: 'building', color: VECTOR_KIND_COLORS.building, label: VECTOR_KIND_LABELS.building },
  { kind: 'highway', color: VECTOR_KIND_COLORS.highway, label: VECTOR_KIND_LABELS.highway },
  { kind: 'forest', color: VECTOR_KIND_COLORS.forest, label: VECTOR_KIND_LABELS.forest },
  { kind: 'land', color: VECTOR_KIND_COLORS.land, label: VECTOR_KIND_LABELS.land },
  { kind: 'place', color: VECTOR_KIND_COLORS.place, label: VECTOR_KIND_LABELS.place },
];
