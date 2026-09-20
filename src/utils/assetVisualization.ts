import type { EquipmentCategory, OperationalStatus } from '../types/equipment';

/**
 * ============================================================================
 * HỆ THỐNG PHÂN ĐỊNH CAPABILITY & TRỰC QUAN HÓA KHÍ TÀI TÁC CHIẾN (VOMKQ)
 * ============================================================================
 * Chuẩn hóa theo tài liệu: "Cải tiến bố trí nhiều khí tài trên bản đồ 2D"
 * Tách bạch rõ rệt giữa:
 * 1. ASSET IDENTITY (Định danh khí tài: ID, Tên, Chuyên ngành, Tọa độ, Trạng thái)
 * 2. VISUALIZATION CAPABILITIES (Khả năng hiển thị chuyên biệt cho từng loại khí tài)
 *
 * TUYỆT ĐỐI KHÔNG ÉP CÁC KHÍ TÀI KHÁC PHẢI VẼ VÒNG PHỦ VÀ VÒNG TRÒN CỰ LY NHƯ RADAR!
 */

export interface AssetCapabilities {
  /** Có vùng phủ sóng radar đa tầng độ cao SPx DEM / Vòm 3D (CHỈ DÀNH CHO RADAR) */
  hasRadarCoverage: boolean;
  /** Có các vòng cự ly đồng tâm phân khoảng và trục phương vị (CHỈ DÀNH CHO RADAR) */
  hasRangeRings: boolean;
  /** Có quạt quét chuyển động của chùm sóng ăng-ten (CHỈ DÀNH CHO RADAR) */
  hasSweep: boolean;
  /** Có vùng hỏa lực tiêu diệt mục tiêu (TÊN LỬA PHÒNG KHÔNG / PHÁO PHÒNG KHÔNG) */
  hasEngagementEnvelope: boolean;
  /** Có mạng lưới đường liên kết chỉ huy tới các đơn vị phụ thuộc (SỞ CHỈ HUY) */
  hasCommandLinks: boolean;
  /** Có cung quan sát / trinh sát quang học hoặc thụ động (TRẠM QUAN SÁT) */
  hasObservationSector: boolean;
}

export interface AssetTypeProfile {
  category: EquipmentCategory;
  nameVi: string;
  shortPrefix: string;
  defaultColor: string;
  iconName: string;
  militaryRoleVi: string;
  capabilities: AssetCapabilities;
}

/**
 * BẢNG ĐĂNG KÝ HỒ SƠ QUÂN SỰ TỪNG LOẠI KHÍ TÀI (ASSET TYPE REGISTRY)
 */
export const ASSET_TYPE_REGISTRY: Record<EquipmentCategory, AssetTypeProfile> = {
  RadarCanhGioi: {
    category: 'RadarCanhGioi',
    nameVi: 'Radar Cảnh Giới',
    shortPrefix: 'R',
    defaultColor: '#06b6d4',
    iconName: 'Radar',
    militaryRoleVi: 'Trinh sát phát hiện sớm và chỉ thị mục tiêu từ xa',
    capabilities: {
      hasRadarCoverage: true,
      hasRangeRings: true,
      hasSweep: true,
      hasEngagementEnvelope: false,
      hasCommandLinks: false,
      hasObservationSector: false,
    },
  },
  TenLuaPhongKhong: {
    category: 'TenLuaPhongKhong',
    nameVi: 'Tên Lửa Phòng Không',
    shortPrefix: 'SAM',
    defaultColor: '#ef4444',
    iconName: 'Target',
    militaryRoleVi: 'Hỏa lực phòng không tiêu diệt mục tiêu bay',
    capabilities: {
      hasRadarCoverage: false, // TUYỆT ĐỐI KHÔNG TÍNH SPX RADAR CHO SAM
      hasRangeRings: false,   // KHÔNG VẼ VÒNG CỰ LY ĐỒNG TÂM RADAR
      hasSweep: false,
      hasEngagementEnvelope: true, // HIỂN THỊ VÙNG HỎA LỰC TIÊU DIỆT (ENGAGEMENT ENVELOPE)
      hasCommandLinks: false,
      hasObservationSector: false,
    },
  },
  SoChiHuy: {
    category: 'SoChiHuy',
    nameVi: 'Sở Chỉ Huy Tác Chiến',
    shortPrefix: 'CP',
    defaultColor: '#eab308',
    iconName: 'Radio',
    militaryRoleVi: 'Trung tâm chỉ huy điều hành tác chiến phòng không',
    capabilities: {
      hasRadarCoverage: false, // TUYỆT ĐỐI KHÔNG VẼ VÒNG TRÒN PHỦ NHƯ RADAR
      hasRangeRings: false,   // KHÔNG VẼ VÒNG CỰ LY RADAR
      hasSweep: false,
      hasEngagementEnvelope: false,
      hasCommandLinks: true,  // HIỂN THỊ MẠNG ĐƯỜNG LIÊN KẾT CHỈ HUY TỚI CÁC ĐƠN VỊ PHỤ THUỘC
      hasObservationSector: false,
    },
  },
  PhaoPhongKhong: {
    category: 'PhaoPhongKhong',
    nameVi: 'Pháo Phòng Không',
    shortPrefix: 'AAA',
    defaultColor: '#10b981',
    iconName: 'Zap',
    militaryRoleVi: 'Hỏa lực tầm gần bảo vệ mục tiêu điểm và điểm chốt',
    capabilities: {
      hasRadarCoverage: false,
      hasRangeRings: false,
      hasSweep: false,
      hasEngagementEnvelope: true, // VÙNG HỎA LỰC PHÁO TẦM GẦN (3-5KM)
      hasCommandLinks: false,
      hasObservationSector: false,
    },
  },
  TramQuanSat: {
    category: 'TramQuanSat',
    nameVi: 'Trạm Quan Sát / Trinh Sát',
    shortPrefix: 'OP',
    defaultColor: '#8b5cf6',
    iconName: 'Antenna',
    militaryRoleVi: 'Trinh sát quang học thụ động và cảnh giới đường không',
    capabilities: {
      hasRadarCoverage: false, // KHÔNG ÉP VÒNG PHỦ 360°
      hasRangeRings: false,
      hasSweep: false,
      hasEngagementEnvelope: false,
      hasCommandLinks: false,
      hasObservationSector: true, // CUNG QUAN SÁT THỰC TẾ
    },
  },
};

/**
 * Lấy tập Capabilities hiển thị cho một loại khí tài
 */
export function getAssetCapabilities(category?: EquipmentCategory): AssetCapabilities {
  if (!category || !ASSET_TYPE_REGISTRY[category]) {
    return ASSET_TYPE_REGISTRY.RadarCanhGioi.capabilities;
  }
  return ASSET_TYPE_REGISTRY[category].capabilities;
}

/**
 * Bảng màu trạng thái tác chiến quân sự
 */
export const STATUS_COLOR_MAP: Record<OperationalStatus, { hex: string; vi: string }> = {
  Active: { hex: '#10b981', vi: 'Sẵn sàng CĐ' },
  Standby: { hex: '#f59e0b', vi: 'Trực ban' },
  Maintenance: { hex: '#f97316', vi: 'Bảo dưỡng' },
  Offline: { hex: '#64748b', vi: 'Tắt máy' },
};

/**
 * TẠO MARKER SVG TÁC CHIẾN ĐẶC TRƯNG THEO TỪNG CHUYÊN NGÀNH QUÂN SỰ
 * - Radar: Biểu tượng quạt quét anten parabol
 * - Sở Chỉ Huy: Biểu tượng cờ chỉ huy mạ vàng / ngôi sao chỉ huy SCH
 * - Tên Lửa: Biểu tượng đầu đạn / hai quả tên lửa phòng không sẵn sàng phóng
 * - Pháo PK: Biểu tượng hai nòng pháo phòng không đan chéo
 * - Trạm Quan Sát: Biểu tượng ống nhòm / tháp quan sát trinh sát
 */
export function createCategoryTacticalMarkerSvg(
  category: EquipmentCategory,
  shortId: string,
  color: string,
  isSelected: boolean,
  status: OperationalStatus = 'Active'
): string {
  const meta = ASSET_TYPE_REGISTRY[category] || ASSET_TYPE_REGISTRY.RadarCanhGioi;
  const themeColor = isSelected ? '#fbbf24' : (color || meta.defaultColor);
  const glowColor = isSelected ? '#f59e0b' : themeColor;
  const poleColor = isSelected ? '#fef08a' : '#94a3b8';
  const cleanId = shortId ? (shortId.length > 7 ? shortId.substring(0, 7) : shortId) : meta.shortPrefix;
  const statusColor = STATUS_COLOR_MAP[status]?.hex || '#10b981';

  // Biểu tượng quân sự trung tâm theo chuyên ngành
  let categoryIconSvg = '';
  switch (category) {
    case 'SoChiHuy':
      // Sở chỉ huy: Ngôi sao vàng & Vương miện C2
      categoryIconSvg = `
        <polygon points="17,14 19,19 24,19 20,22 22,27 17,24 12,27 14,22 10,19 15,19" fill="#fde047" stroke="#b45309" stroke-width="0.8"/>
      `;
      break;

    case 'TenLuaPhongKhong':
      // Tên lửa: 2 đầu đạn tên lửa vút lên
      categoryIconSvg = `
        <path d="M14,26 L14,14 L16,11 L18,14 L18,26 Z" fill="#ef4444" stroke="#ffffff" stroke-width="0.7"/>
        <path d="M19,26 L19,16 L21,13 L23,16 L23,26 Z" fill="#f97316" stroke="#ffffff" stroke-width="0.7"/>
        <polygon points="12,26 14,23 14,26" fill="#ef4444"/>
        <polygon points="18,26 18,23 20,26" fill="#ef4444"/>
      `;
      break;

    case 'PhaoPhongKhong':
      // Pháo PK: Hai nòng pháo đan chéo
      categoryIconSvg = `
        <line x1="12" y1="26" x2="22" y2="12" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="22" y1="26" x2="12" y2="12" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <circle cx="17" cy="19" r="3" fill="#10b981" stroke="#ffffff" stroke-width="1"/>
      `;
      break;

    case 'TramQuanSat':
      // Trạm quan sát: Ống nhòm trinh sát quang học
      categoryIconSvg = `
        <circle cx="14" cy="19" r="3.5" fill="none" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="21" cy="19" r="3.5" fill="none" stroke="#ffffff" stroke-width="1.5"/>
        <line x1="17.5" y1="19" x2="17.5" y2="17" stroke="#ffffff" stroke-width="1.5"/>
        <circle cx="14" cy="19" r="1.5" fill="#a855f7"/>
        <circle cx="21" cy="19" r="1.5" fill="#a855f7"/>
      `;
      break;

    case 'RadarCanhGioi':
    default:
      // Radar: Anten chảo parabol & các chùm sóng
      categoryIconSvg = `
        <circle cx="15" cy="20" r="2.5" fill="${themeColor}"/>
        <path d="M17,16 A 5 5 0 0 1 17,24" fill="none" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M20,13 A 9 9 0 0 1 20,27" fill="none" stroke="#38bdf8" stroke-width="1.2" stroke-linecap="round"/>
      `;
      break;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="62" height="60" viewBox="0 0 62 60">
    <defs>
      <filter id="glow_${cleanId}" x="-25%" y="-25%" width="150%" height="150%">
        <feDropShadow dx="0" dy="0" stdDeviation="${isSelected ? '3' : '1.8'}" flood-color="${glowColor}" flood-opacity="0.9"/>
      </filter>
      <linearGradient id="badgeGrad_${cleanId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.96"/>
        <stop offset="60%" stop-color="#0f172a" stop-opacity="0.92"/>
        <stop offset="100%" stop-color="${themeColor}" stop-opacity="0.6"/>
      </linearGradient>
    </defs>

    <!-- Điểm cắm chân cờ & Chữ thập tâm tọa độ -->
    <circle cx="10" cy="55" r="3.5" fill="${themeColor}" stroke="#000000" stroke-width="1.2"/>
    <line x1="10" y1="50" x2="10" y2="59" stroke="#ffffff" stroke-width="1.2"/>
    <line x1="5" y1="55" x2="15" y2="55" stroke="#ffffff" stroke-width="1.2"/>

    <!-- Cán cờ kim loại có chóp định vị -->
    <line x1="10" y1="6" x2="10" y2="53" stroke="${poleColor}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="10" cy="5" r="3" fill="#fbbf24" stroke="#78350f" stroke-width="1"/>

    <!-- Thân huy hiệu / Thẻ tác chiến -->
    <polygon points="10,6 58,6 50,19 58,32 10,32" fill="url(#badgeGrad_${cleanId})" stroke="${themeColor}" stroke-width="${isSelected ? '2.4' : '1.5'}" filter="url(#glow_${cleanId})"/>

    <!-- Biểu tượng quân sự đặc trưng chuyên ngành -->
    ${categoryIconSvg}

    <!-- Mã ngắn định danh khí tài (CP-01, SAM-01, R-01...) -->
    <text x="37" y="23" font-family="'JetBrains Mono', 'Segoe UI', monospace" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle" stroke="#000000" stroke-width="0.8" paint-order="stroke fill">${cleanId}</text>

    <!-- LED chỉ báo trạng thái tác chiến (Active=Xanh lục, Standby=Vàng, v.v.) -->
    <circle cx="48" cy="10" r="2.8" fill="${statusColor}" stroke="#000000" stroke-width="0.8"/>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Định dạng thẻ thông tin khí tài đa dòng theo đúng chuyên ngành quân sự
 */
export function formatTacticalAssetInfoCard(params: {
  category: EquipmentCategory;
  shortId?: string;
  name: string;
  latDms: string;
  lonDms: string;
  groundMsl: string;
  antennaAgl: string;
  rangeKm: string;
  statusVi: string;
  commandedByName?: string;
}): string {
  const {
    category,
    shortId,
    name,
    latDms,
    lonDms,
    groundMsl,
    antennaAgl,
    rangeKm,
    statusVi,
    commandedByName,
  } = params;

  const idTag = shortId ? `[${shortId}] ` : '';
  const lines: string[] = [];

  // Dòng 1: Tiêu đề khí tài
  lines.push(`▶ ${idTag}${name}`);

  // Dòng 2: Tọa độ địa lý
  lines.push(`  Tọa độ : ${latDms}, ${lonDms}`);

  // Dòng 3 & 4: Tùy biến theo từng chuyên ngành tác chiến
  switch (category) {
    case 'SoChiHuy':
      lines.push(`  Cao độ SCH : ${groundMsl} (MSL) | Cột anten: ${antennaAgl} (AGL)`);
      lines.push(`  Bán kính C2: ${rangeKm}  |  Trạng thái: [${statusVi}]`);
      break;

    case 'TenLuaPhongKhong':
      lines.push(`  Cao độ trận địa: ${groundMsl} (MSL) | Bệ phóng: ${antennaAgl} (AGL)`);
      lines.push(`  Cự ly diệt mục tiêu: ${rangeKm}  |  Trạng thái: [${statusVi}]`);
      break;

    case 'PhaoPhongKhong':
      lines.push(`  Cao độ trận địa: ${groundMsl} (MSL)`);
      lines.push(`  Tầm bắn hiệu quả: ${rangeKm}  |  Trạng thái: [${statusVi}]`);
      break;

    case 'TramQuanSat':
      lines.push(`  Cao độ trạm trinh sát: ${groundMsl} (MSL) | Tháp vọng: ${antennaAgl} (AGL)`);
      lines.push(`  Cự ly quan sát: ${rangeKm}  |  Trạng thái: [${statusVi}]`);
      break;

    case 'RadarCanhGioi':
    default:
      lines.push(`  Cao độ đài : ${groundMsl} (MSL) | Anten: ${antennaAgl} (AGL)`);
      lines.push(`  Tầm trinh sát : ${rangeKm}  |  Trạng thái: [${statusVi}]`);
      break;
  }

  // Dòng 5: Cấp chỉ huy trực tiếp (nếu có)
  if (commandedByName) {
    lines.push(`  Trực thuộc : ${commandedByName}`);
  }

  return lines.join('\n');
}
