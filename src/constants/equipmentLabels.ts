/**
 * TỪ ĐIỂN ĐỊNH NGHĨA NHÃN GIAO DIỆN KHÍ TÀI TẬP TRUNG (CENTRALIZED EQUIPMENT UI LABELS)
 * Sử dụng thống nhất trên LeftSidebar, RightInspector, Tooltip và Modal
 */

export const EQUIPMENT_UI_LABELS = {
  // Tiêu đề các nhóm khí tài trên giao diện
  GROUP_TITLES: {
    RADAR_FIRE_CONTROL: 'RADAR ĐIỀU KHIỂN HỎA LỰC',
    RADAR_EARLY_WARNING: 'RADAR CẢNH GIỚI',
    SAM_MISSILE: 'TỔ HỢP TÊN LỬA PHÒNG KHÔNG (SAM)',
    OTHER_EQUIPMENT: 'SỞ CHỈ HUY, PHÁO & KHÍ TÀI KHÁC',
  },

  // Mô tả ngắn cho từng nhóm radar trên giao diện
  GROUP_DESCRIPTIONS: {
    RADAR_FIRE_CONTROL:
      'Radar 3D đo 3 tọa độ (phương vị, cự ly, độ cao), bắt bám mục tiêu bay thấp/tên lửa hành trình và chỉ thị phần tử bắn cho tên lửa.',
    RADAR_EARLY_WARNING:
      'Radar cảnh giới nhìn vòng phát hiện sớm từ xa, không đo cao 3D trực tiếp để dẫn bắn cho tên lửa.',
  },

  // Nhãn phân loại vai trò phụ của Radar trong dropdown / outliner
  RADAR_SUBROLE_SHORT: {
    FIRE_CONTROL: 'Radar điều khiển hỏa lực',
    EARLY_WARNING: 'Radar cảnh giới',
  },

  // Nhãn tùy chọn liên kết chỉ thị hỏa lực cho SAM trong RightInspector
  RADAR_DESIGNATION_OPTIONS: {
    INDEPENDENT: '-- Tự ngắm độc lập (Không liên kết đài) --',
    FIRE_CONTROL_TAG: '(Radar điều khiển hỏa lực)',
    EARLY_WARNING_TAG: '(Radar cảnh giới)',
  },
} as const;

/**
 * Trả về nhãn vai trò của đài radar dùng chung trên toàn hệ thống
 */
export function getRadarRoleDisplayLabel(canDesignateForSam?: boolean): string {
  return canDesignateForSam
    ? EQUIPMENT_UI_LABELS.RADAR_SUBROLE_SHORT.FIRE_CONTROL
    : EQUIPMENT_UI_LABELS.RADAR_SUBROLE_SHORT.EARLY_WARNING;
}
