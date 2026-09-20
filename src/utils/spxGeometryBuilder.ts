import * as Cesium from 'cesium';
import type {
  SpxCoverageResult,
  SpxRadarCoverageConfig,
} from '../types/spxRadarCoverage';
import { destinationPoint } from './spxCoverageEngine';

/**
 * Helper chuyển toạ độ thập phân sang định dạng DMS (Độ, Phút, Giây)
 */
export function toDmsString(deg: number, isLat: boolean): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = ((minFloat - m) * 60).toFixed(1);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  return `${d}° ${m}' ${s}" ${dir}`;
}

/**
 * =========================================================================================
 * 🎨 NƠI CHỈNH MÀU SẮC VÀ KIỂU DÁNG VÒNG CỰ LY RADAR (RANGE RINGS)
 * File: src/utils/spxGeometryBuilder.ts
 * 
 * Bạn có thể dễ dàng thay đổi mã màu HEX hoặc hướng hiển thị nhãn tại đây:
 * =========================================================================================
 */
export const RANGE_RING_THEME = {
  // Màu các vòng cự ly thông thường (Mặc định: Vàng hổ phách #fbbf24 - Nổi bật trên nền biển xanh và đất liền)
  ringColor: '#0465b5ff',

  // Màu vòng cự ly tối đa ngoài cùng [MAX] (Mặc định: Vàng cam #f59e0b)
  maxRingColor: '#0f5702ff',

  // Màu chữ số khoảng cách trên nhãn (Mặc định: Trắng phát sáng #ffffff)
  labelTextColor: '#076effff',

  // Màu nền của hộp nhãn khoảng cách (Mặc định: Đen quân sự #020617)
  labelBgColor: '#bbc7fbff',

  // Màu 4 trục chữ thập Đông Tây Nam Bắc (Mặc định: Xám bạc #94a3b8)
  axisColor: '#0465b5ff',

  // Hướng đặt nhãn cự ly (0: Hướng Bắc, 90: Hướng Đông - Khuyến nghị 0° để không bị rối)
  labelBearingDeg: 0,
};

/**
 * =========================================================================================
 * 📝 NƠI CHỈNH SỬA NỘI DUNG, ĐỊNH DẠNG & XUỐNG DÒNG NHÃN KHÍ TÀI (RADAR INFO CARD)
 * File: src/utils/spxGeometryBuilder.ts
 * 
 * Bạn có thể tự do chỉnh sửa lỗi xuống dòng, thêm bớt trường, thay đổi ký tự tại hàm này:
 * =========================================================================================
 */
export function formatRadarInfoCardText(params: {
  shortId?: string;
  name?: string;
  latDms: string;
  lonDms: string;
  latDec: string;
  lonDec: string;
  groundMsl: string;
  antennaAgl: string;
  rangeKm: string;
  statusVi: string;
}): string {
  const shortPrefix = params.shortId ? `[${params.shortId}] ` : '';
  const displayName = params.name ? `${shortPrefix}${params.name}` : `${shortPrefix}Đài Radar`;

  return [
    `▶ ${displayName}`,
    `  Tọa độ : ${params.latDms}, ${params.lonDms}`,
    `  Cao độ : ${params.groundMsl} (MSL)  |  Anten: ${params.antennaAgl} (AGL)`,
    `  Tác chiến: Tầm ${params.rangeKm}  |  [${params.statusVi}]`,
  ].join('\n');
}

export interface SpxRenderOptions {
  isSelected?: boolean;
  hasAnySelected?: boolean;
  showCoverage?: boolean;
  showRangeRings?: boolean;
  showLabels?: boolean;
  showMarkers?: boolean;
  shortId?: string;
  status?: string;
  category?: import('../types/equipment').EquipmentCategory;
  is2D?: boolean;
  antennaHeightAGL?: number;
  rangeKm?: number;
  color?: string;
}

/**
 * Tạo cờ hiệu quân sự tác chiến dạng SVG Data URL cắm tại tâm đài radar
 * - Cán cờ kim loại có chân cắm và chóp nhọn cắm thẳng xuống tọa độ tâm
 * - Lá cờ đuôi nheo quân sự viền màu nhận diện khí tài kèm mã ngắn (R-01, R-02...)
 * - Điểm chân cờ có tâm chữ thập chuẩn xác tuyệt đối
 */
export function createTacticalFlagSvg(
  shortId: string,
  color: string,
  isSelected: boolean
): string {
  const borderColor = isSelected ? '#fbbf24' : (color || '#06b6d4');
  const glowColor = isSelected ? '#f59e0b' : (color || '#06b6d4');
  const poleColor = isSelected ? '#fef08a' : '#94a3b8';
  const cleanId = shortId ? (shortId.length > 6 ? shortId.substring(0, 6) : shortId) : 'RADAR';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="58" viewBox="0 0 56 58">
    <defs>
      <filter id="glow_${cleanId}" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="${isSelected ? '2.5' : '1.5'}" flood-color="${glowColor}" flood-opacity="0.85"/>
      </filter>
      <linearGradient id="flagGrad_${cleanId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#020617" stop-opacity="0.95"/>
        <stop offset="50%" stop-color="#0f172a" stop-opacity="0.90"/>
        <stop offset="100%" stop-color="${color || '#06b6d4'}" stop-opacity="0.55"/>
      </linearGradient>
    </defs>
    <!-- Điểm cắm chân cờ & Chữ thập định vị tâm radar -->
    <circle cx="10" cy="54" r="3.5" fill="${borderColor}" stroke="#000000" stroke-width="1.2"/>
    <line x1="10" y1="49" x2="10" y2="58" stroke="#ffffff" stroke-width="1.2"/>
    <line x1="5" y1="54" x2="15" y2="54" stroke="#ffffff" stroke-width="1.2"/>
    <!-- Cán cờ kim loại -->
    <line x1="10" y1="6" x2="10" y2="52" stroke="${poleColor}" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="10" cy="5" r="3" fill="#fbbf24" stroke="#78350f" stroke-width="1"/>
    <!-- Lá cờ tác chiến đuôi nheo quân sự -->
    <polygon points="10,7 52,7 44,19 52,31 10,31" fill="url(#flagGrad_${cleanId})" stroke="${borderColor}" stroke-width="${isSelected ? '2.2' : '1.5'}" filter="url(#glow_${cleanId})"/>
    <!-- Ký hiệu radar phát sóng bên trong cờ -->
    <circle cx="16" cy="19" r="2.5" fill="${borderColor}"/>
    <!-- Mã ngắn định danh đài (R-01, R-02...) -->
    <text x="31" y="22.5" font-family="'JetBrains Mono', 'Segoe UI', monospace" font-size="10" font-weight="900" fill="#ffffff" text-anchor="middle" stroke="#000000" stroke-width="0.8" paint-order="stroke fill">${cleanId}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * XÂY DỰNG CÁC THỰC THỂ CESIUM TRỰC QUAN HOÁ VÙNG PHỦ SPx (CAMBRIDGE PIXEL RADAR COVERAGE)
 * - Các dải màu loang theo DEM chuẩn xác cho từng tầng độ cao mục tiêu (500m, 800m, 1000m, 2000m)
 * - Hỗ trợ hiệu ứng Focus/Dimming khi có khí tài được chọn (chuẩn tài liệu tác chiến)
 * - Vòng tròn cự ly đồng tâm (Range rings) nội suy thông minh
 * - Cờ cắm tác chiến & Nhãn thông tin đa dòng đầy đủ: Tên, Tọa độ DMS/Decimal, Độ cao đặt đài MSL, Anten AGL, Tầm quét
 */
export function buildSpxCoverageEntities(
  result: SpxCoverageResult,
  config: SpxRadarCoverageConfig,
  instanceName?: string,
  options?: SpxRenderOptions
): Cesium.Entity[] {
  const entities: Cesium.Entity[] = [];
  const { radarLat, radarLon, groundElevationM, contours, rangeRings } = result;

  const isSelected = Boolean(options?.isSelected);
  const hasAnySelected = Boolean(options?.hasAnySelected);
  const isDimmed = !isSelected && hasAnySelected;
  const showCoverage = options?.showCoverage !== false;
  const showRangeRings = options?.showRangeRings !== false;
  const showLabels = options?.showLabels !== false;
  const showMarkers = options?.showMarkers !== false;
  const is2D = Boolean(options?.is2D);

  const safeLat = typeof radarLat === 'number' && !isNaN(radarLat) && isFinite(radarLat) ? radarLat : 16.043;
  const safeLon = typeof radarLon === 'number' && !isNaN(radarLon) && isFinite(radarLon) ? radarLon : 108.12081;
  const safeGroundAlt = typeof groundElevationM === 'number' && !isNaN(groundElevationM) && isFinite(groundElevationM) ? groundElevationM : 0;

  const radarCartesian = Cesium.Cartesian3.fromDegrees(safeLon, safeLat, is2D ? 0 : safeGroundAlt);

  // 1. Render các đa giác dải màu (Contours)
  // contours: index 0 là tầng cao nhất (Đỏ 2000m), index cuối là tầng thấp nhất (Xanh 500m)
  // - Tầng 2000m (idx 0): zIndex = 10 (Dưới cùng)
  // - Tầng 1000m (idx 1): zIndex = 20
  // - Tầng 800m  (idx 2): zIndex = 30
  // - Tầng 500m  (idx 3): zIndex = 40 (Trên cùng, màu sắc nổi bật nhất!)
  if (showCoverage) {
    contours.forEach((contour, idx) => {
      // Bỏ qua các tầng không có vùng phủ sóng (bị núi che hoặc diện tích = 0)
      if (
        !contour.maxObservedRangeM ||
        contour.maxObservedRangeM <= 0 ||
        !contour.coverageAreaKm2 ||
        contour.coverageAreaKm2 <= 0
      ) {
        return;
      }

      const rawPts = contour.polygonPositions;
      if (!Array.isArray(rawPts) || rawPts.length < 3) return;

      // Loại bỏ điểm trùng lặp cuối cùng khi tạo PolygonHierarchy và lọc các toạ độ hợp lệ
      const uniquePts = rawPts.slice(0, -1).filter(
        (p) => typeof p.lat === 'number' && typeof p.lon === 'number' &&
          !isNaN(p.lat) && !isNaN(p.lon) && isFinite(p.lat) && isFinite(p.lon)
      );
      if (uniquePts.length < 3) return;

      // Kiểm tra đa giác có bị suy biến thành 1 điểm duy nhất (zero area) hay không
      let minLat = uniquePts[0].lat;
      let maxLat = uniquePts[0].lat;
      let minLon = uniquePts[0].lon;
      let maxLon = uniquePts[0].lon;
      for (let i = 1; i < uniquePts.length; i++) {
        if (uniquePts[i].lat < minLat) minLat = uniquePts[i].lat;
        if (uniquePts[i].lat > maxLat) maxLat = uniquePts[i].lat;
        if (uniquePts[i].lon < minLon) minLon = uniquePts[i].lon;
        if (uniquePts[i].lon > maxLon) maxLon = uniquePts[i].lon;
      }
      if (Math.abs(maxLat - minLat) < 0.0001 && Math.abs(maxLon - minLon) < 0.0001) {
        return;
      }

      const cartesianPositions = uniquePts.map((p) =>
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
      );

      const isHighestTier = idx === 0;
      const isLowestTier = idx === contours.length - 1;

      // zIndex: Tầng thấp nhất có zIndex cao nhất
      const zIndex = (idx + 1) * 10 + (isSelected ? 5 : 0);

      // Độ trong suốt mờ màng thanh lịch theo chuẩn Cambridge Pixel (lộ rõ đường sá, địa danh bên dưới)
      const configuredAlpha = typeof config.coverageTransparency === 'number' && !isNaN(config.coverageTransparency)
        ? config.coverageTransparency
        : 0.28;

      let tierAlpha: number;
      if (isDimmed) {
        // Khi một đài khác đang được chọn: Giảm mạnh độ đậm của đài này để tránh rối mắt
        tierAlpha = 0.08;
      } else if (isSelected) {
        // Đài đang được chọn: Giữ độ trong suốt dịu nhẹ (~0.25 - 0.35) để không che khuất bản đồ
        tierAlpha = Math.min(0.38, Math.max(0.15, configuredAlpha * (isLowestTier ? 1.15 : isHighestTier ? 0.8 : 0.95)));
      } else {
        tierAlpha = Math.min(0.32, Math.max(0.12, configuredAlpha * (isLowestTier ? 1.0 : isHighestTier ? 0.75 : 0.85)));
      }

      const polyColor = Cesium.Color.fromCssColorString(contour.tier.color).withAlpha(tierAlpha);

      entities.push(
        new Cesium.Entity({
          name: `SPx Vùng Phủ ${contour.tier.label}`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(cartesianPositions),
            material: polyColor,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            classificationType: Cesium.ClassificationType.TERRAIN,
            zIndex: zIndex,
          },
        })
      );

      // B. Đường viền bao ngoài sắc nét, đậm màu rực rỡ chuẩn Cambridge Pixel (100% solid outline)
      const strokeAlpha = isDimmed ? 0.30 : 1.0;
      const strokeColor = Cesium.Color.fromCssColorString(
        contour.tier.outlineColor || contour.tier.color
      ).withAlpha(strokeAlpha);

      const validRawPts = rawPts.filter(
        (p) => typeof p.lat === 'number' && typeof p.lon === 'number' &&
          !isNaN(p.lat) && !isNaN(p.lon) && isFinite(p.lat) && isFinite(p.lon)
      );
      if (validRawPts.length < 3) return;

      let minOutLat = validRawPts[0].lat;
      let maxOutLat = validRawPts[0].lat;
      let minOutLon = validRawPts[0].lon;
      let maxOutLon = validRawPts[0].lon;
      for (let i = 1; i < validRawPts.length; i++) {
        if (validRawPts[i].lat < minOutLat) minOutLat = validRawPts[i].lat;
        if (validRawPts[i].lat > maxOutLat) maxOutLat = validRawPts[i].lat;
        if (validRawPts[i].lon < minOutLon) minOutLon = validRawPts[i].lon;
        if (validRawPts[i].lon > maxOutLon) maxOutLon = validRawPts[i].lon;
      }
      if (Math.abs(maxOutLat - minOutLat) < 0.0001 && Math.abs(maxOutLon - minOutLon) < 0.0001) {
        return;
      }

      const closedOutlinePositions = validRawPts.map((p) =>
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
      );

      // Độ dày đường viền nổi bật (bản gốc Cambridge Pixel nét viền rất rõ)
      let polylineWidth = 2.8;
      if (isDimmed) {
        polylineWidth = 1.5;
      } else if (isSelected) {
        polylineWidth = isHighestTier ? 4.0 : 3.2;
      } else {
        polylineWidth = isHighestTier ? 3.5 : 2.8;
      }

      entities.push(
        new Cesium.Entity({
          name: `SPx Đường Biên ${contour.tier.label}`,
          polyline: {
            positions: closedOutlinePositions,
            width: polylineWidth,
            material: strokeColor,
            clampToGround: true,
            zIndex: 50 + zIndex,
          },
        })
      );
    });
  }

  // 2. Render Vòng Cự Ly Đồng Tâm (Range Rings) & Trục Chữ Thập (Crosshairs)
  if (showRangeRings && config.showRangeRings && Array.isArray(rangeRings) && rangeRings.length > 0) {
    const ringAlpha = isDimmed ? 0.20 : isSelected ? 0.85 : 0.65;
    const defaultRingColor = Cesium.Color.fromCssColorString(RANGE_RING_THEME.ringColor).withAlpha(ringAlpha);
    const maxRingColor = Cesium.Color.fromCssColorString(RANGE_RING_THEME.maxRingColor).withAlpha(Math.min(1.0, ringAlpha * 1.25));
    const labelColor = Cesium.Color.fromCssColorString(RANGE_RING_THEME.labelTextColor);
    const labelBgColor = Cesium.Color.fromCssColorString(RANGE_RING_THEME.labelBgColor).withAlpha(0.1);

    // A. Vẽ các vòng cự ly tròn đồng tâm
    rangeRings.forEach((ring) => {
      const validRingPositions = ring.positions.filter(
        (p) => typeof p.lat === 'number' && typeof p.lon === 'number' &&
          !isNaN(p.lat) && !isNaN(p.lon) && isFinite(p.lat) && isFinite(p.lon)
      );
      if (validRingPositions.length < 3) return;

      const ringCartesians = validRingPositions.map((p) =>
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
      );
      // Đóng vòng tròn
      ringCartesians.push(ringCartesians[0]);

      const isMaxRing = ring.rangeM === config.endRangeM;

      entities.push(
        new Cesium.Entity({
          name: `Vòng cự ly ${ring.label}`,
          polyline: {
            positions: ringCartesians,
            width: isMaxRing ? (isSelected ? 2.8 : 2.2) : (isSelected ? 1.8 : 1.3),
            material: isMaxRing ? maxRingColor : defaultRingColor,
            clampToGround: true,
            zIndex: isMaxRing ? 75 : 70,
          },
        })
      );

      // B. Nhãn cự ly rõ nét với nền tối (Pill)
      // CHỈ RENDER THEO 1 HƯỚNG DUY NHẤT VÀ TỰ ĐỘNG BIẾN MẤT KHI ZOOM NHỎ LẠI ĐỂ TRÁNH ĐỤNG/DÍNH SỐ
      if (!isDimmed && showLabels) {
        // Hướng đặt nhãn duy nhất (mặc định: Hướng Bắc 0°, hoặc chỉnh tại RANGE_RING_THEME.labelBearingDeg)
        const bearing = RANGE_RING_THEME.labelBearingDeg ?? 0;
        const pt = destinationPoint(safeLat, safeLon, ring.rangeM, bearing);

        if (!isNaN(pt.lat) && !isNaN(pt.lon) && isFinite(pt.lat) && isFinite(pt.lon)) {
          // Tính khoảng cách nhìn tối đa dựa trên bán kính vòng (LOD culling):
          // Vòng nhỏ (< 25km) tự động ẩn sớm khi camera ở xa, chỉ vòng lớn & MAX mới hiển thị từ xa
          const maxDisplayDist = isMaxRing
            ? 1_800_000 // Vòng MAX hiển thị từ cự ly tới 1.800 km
            : Math.max(80_000, ring.rangeM * 4.0); // 10km ẩn sau 80km, 25km ẩn sau 100km, 50km ẩn sau 200km...

          // Định dạng chữ số khoảng cách gọn gàng (km thay vì mét dài dòng)
          const distKm = ring.rangeM >= 1000 ? `${ring.rangeM / 1000}km` : `${ring.rangeM}m`;
          const displayLabel = isMaxRing ? `${distKm} [MAX]` : distKm;

          entities.push(
            new Cesium.Entity({
              name: `Nhãn cự ly ${displayLabel}`,
              position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
              label: {
                text: displayLabel,
                font: isMaxRing ? 'bold 15px "JetBrains Mono", monospace' : 'bold 13px "JetBrains Mono", monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: isMaxRing ? Cesium.Color.fromCssColorString('#fde047') : labelColor,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 4,
                showBackground: true,
                backgroundColor: labelBgColor,
                backgroundPadding: new Cesium.Cartesian2(8, 4),
                heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.CLAMP_TO_GROUND,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxDisplayDist),
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                eyeOffset: new Cesium.Cartesian3(0, 0, 0),
              },
            })
          );
        }
      }
    });

    // C. Vẽ 4 trục chữ thập (Bắc, Nam, Đông, Tây) nếu không bị dimmed
    if (!isDimmed) {
      const maxRingM = typeof config.endRangeM === 'number' && !isNaN(config.endRangeM) && isFinite(config.endRangeM)
        ? config.endRangeM
        : 50000;
      [0, 90, 180, 270].forEach((bearing) => {
        const endPt = destinationPoint(safeLat, safeLon, maxRingM, bearing);
        if (!isNaN(endPt.lat) && !isNaN(endPt.lon) && isFinite(endPt.lat) && isFinite(endPt.lon)) {
          const axisPositions = [
            radarCartesian,
            Cesium.Cartesian3.fromDegrees(endPt.lon, endPt.lat, 0),
          ];

          entities.push(
            new Cesium.Entity({
              name: `Trục chữ thập ${bearing}°`,
              polyline: {
                positions: axisPositions,
                width: 1.0,
                material: Cesium.Color.fromCssColorString(RANGE_RING_THEME.axisColor).withAlpha(0.35),
                clampToGround: true,
                zIndex: 55,
              },
            })
          );
        }
      });
    }
  }

  // 3. Render CỜ CẮM TÁC CHIẾN & TÂM ĐÀI RADAR (Tactical Flag Pin & Anchor Crosshair)
  if (showMarkers) {
    const flagSvg = createTacticalFlagSvg(options?.shortId || 'R', options?.color || '#06b6d4', isSelected);

    // A. Cờ cắm tác chiến với cán cờ kim loại cắm thẳng xuống tâm radar
    entities.push(
      new Cesium.Entity({
        name: `Cờ Cắm Tâm Đài ${options?.shortId || ''}`,
        position: radarCartesian,
        billboard: {
          image: flagSvg,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(-10, 4),
          eyeOffset: new Cesium.Cartesian3(0, 0, -400), // Nổi lên trên vòng cự ly
          heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    );

    // B. Tâm chữ thập định vị chính xác vị trí chân đài
    entities.push(
      new Cesium.Entity({
        name: `Tâm Đài Radar ${options?.shortId || ''}`,
        position: radarCartesian,
        point: {
          pixelSize: isSelected ? 10 : 8,
          color: isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    );
  }

  // 4. Render NHÃN THÔNG TIN CHI TIẾT ĐÀI RADAR (Tactical Military Info Card)
  // eyeOffset: -500 để nhãn thông tin LUÔN LUÔN NỔI LÊN TRÊN CÁC TẦM CỰ LY VÀ ĐƯỜNG VÒNG
  if (showLabels) {
    const latDms = toDmsString(safeLat, true);
    const lonDms = toDmsString(safeLon, false);
    const latDec = safeLat.toFixed(4);
    const lonDec = safeLon.toFixed(4);
    const groundMslText = `${Math.round(safeGroundAlt)}m`;
    const antennaAglText = `${Math.round(options?.antennaHeightAGL || config.radarHeightAGL || 40)}m`;
    const rangeKmText = options?.rangeKm ? `${options.rangeKm}km` : `${Math.round(config.endRangeM / 1000)}km`;
    const statusVi = options?.status === 'Active' ? 'Sẵn sàng CĐ' : options?.status === 'Standby' ? 'Trực ban' : options?.status || 'Hoạt động';

    const infoCardText = formatRadarInfoCardText({
      shortId: options?.shortId,
      name: instanceName,
      latDms,
      lonDms,
      latDec,
      lonDec,
      groundMsl: groundMslText,
      antennaAgl: antennaAglText,
      rangeKm: rangeKmText,
      statusVi,
    });

    entities.push(
      new Cesium.Entity({
        name: `Nhãn Thông Tin Tâm Đài ${options?.shortId || ''}`,
        position: radarCartesian,
        label: {
          text: infoCardText,
          font: isSelected ? 'bold 12px "JetBrains Mono", monospace' : '11px "JetBrains Mono", monospace',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: isSelected ? Cesium.Color.fromCssColorString('#fde047') : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.92),
          backgroundPadding: new Cesium.Cartesian2(10, 6),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(46, -8),
          eyeOffset: new Cesium.Cartesian3(0, 0, -500), // LUÔN NẰM TRÊN CÁC TẦM CỰ LY VÀ ĐƯỜNG VÒNG
          heightReference: is2D ? Cesium.HeightReference.NONE : Cesium.HeightReference.RELATIVE_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    );
  }

  return entities;
}
