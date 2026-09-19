import * as Cesium from 'cesium';
import type {
  SpxCoverageResult,
  SpxRadarCoverageConfig,
} from '../types/spxRadarCoverage';
import { destinationPoint } from './spxCoverageEngine';

/**
 * Helper chuyển toạ độ thập phân sang định dạng DMS (Độ, Phút, Giây)
 */
function toDmsString(deg: number, isLat: boolean): string {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFloat = (abs - d) * 60;
  const m = Math.floor(minFloat);
  const s = ((minFloat - m) * 60).toFixed(1);
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  return `${d}° ${m}' ${s}" ${dir}`;
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
}

/**
 * XÂY DỰNG CÁC THỰC THỂ CESIUM TRỰC QUAN HOÁ VÙNG PHỦ SPx (CAMBRIDGE PIXEL RADAR COVERAGE)
 * - Các dải màu loang theo DEM chuẩn xác cho từng tầng độ cao mục tiêu (500m, 800m, 1000m, 2000m)
 * - Hỗ trợ hiệu ứng Focus/Dimming khi có khí tài được chọn (chuẩn tài liệu tác chiến)
 * - Vòng tròn cự ly đồng tâm (Range rings) nội suy thông minh
 * - Điểm tâm đài chuẩn Tactical Military Marker với mã định danh ngắn (R-01) và chấm trạng thái
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

  const safeLat = typeof radarLat === 'number' && !isNaN(radarLat) && isFinite(radarLat) ? radarLat : 16.043;
  const safeLon = typeof radarLon === 'number' && !isNaN(radarLon) && isFinite(radarLon) ? radarLon : 108.12081;
  const safeGroundAlt = typeof groundElevationM === 'number' && !isNaN(groundElevationM) && isFinite(groundElevationM) ? groundElevationM : 0;

  const radarCartesian = Cesium.Cartesian3.fromDegrees(safeLon, safeLat, 0);

  // 1. Render các đa giác dải màu (Contours)
  // contours: index 0 là tầng cao nhất (Đỏ 2000m), index cuối là tầng thấp nhất (Xanh 500m)
  // ĐỂ TẦNG THẤP NHẤT (XANH 500M) NỔI BẬT LÊN TRÊN CÙNG, KHÔNG BỊ CHỒNG MÀU VỚI CÁC TẦNG DƯỚI:
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

      // Độ trong suốt: Focus/Dimming mechanism
      const configuredAlpha = typeof config.coverageTransparency === 'number' && !isNaN(config.coverageTransparency)
        ? config.coverageTransparency
        : 0.45;

      let tierAlpha: number;
      if (isDimmed) {
        // Khi một đài khác đang được chọn: Giảm mạnh độ đậm của đài này để tránh rối mắt
        tierAlpha = 0.12;
      } else if (isSelected) {
        // Đài đang được chọn: Tăng độ đậm và tương phản để nổi bật tuyệt đối
        tierAlpha = isLowestTier ? 0.75 : isHighestTier ? 0.45 : 0.60;
      } else {
        tierAlpha = isLowestTier
          ? Math.min(0.85, configuredAlpha * 1.3)
          : isHighestTier
          ? Math.min(0.50, configuredAlpha * 0.8)
          : Math.min(0.70, configuredAlpha * 1.0);
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

      // B. Đường viền bao ngoài sắc nét (Polyline boundary) cho từng tầng
      const strokeAlpha = isDimmed ? 0.20 : isSelected ? 1.0 : 0.90;
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

      let polylineWidth = 2.0;
      if (isDimmed) {
        polylineWidth = 1.0;
      } else if (isSelected) {
        polylineWidth = isHighestTier ? 3.5 : 2.5;
      } else {
        polylineWidth = isHighestTier ? 3.0 : 2.0;
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
    const ringAlpha = isDimmed ? 0.20 : isSelected ? 0.90 : 0.70;
    const defaultRingColor = Cesium.Color.fromCssColorString('#00e5ff').withAlpha(ringAlpha);
    const maxRingColor = Cesium.Color.fromCssColorString('#38bdf8').withAlpha(Math.min(1.0, ringAlpha * 1.25));
    const labelColor = isSelected ? Cesium.Color.fromCssColorString('#38bdf8') : Cesium.Color.fromCssColorString('#00ffff');
    const labelBgColor = Cesium.Color.fromCssColorString('#020617').withAlpha(0.85);

    // A. Vẽ các vòng cự ly
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
            width: isMaxRing ? (isSelected ? 3.0 : 2.5) : (isSelected ? 2.0 : 1.5),
            material: isMaxRing ? maxRingColor : defaultRingColor,
            clampToGround: true,
            zIndex: isMaxRing ? 75 : 70,
          },
        })
      );

      // B. Nhãn cự ly rõ nét với nền tối (Pill) - Chỉ render nếu KHÔNG bị dimmed và nhãn được bật
      if (!isDimmed && showLabels) {
        const cardinalBearings = [0, 180];
        cardinalBearings.forEach((bearing) => {
          const pt = destinationPoint(safeLat, safeLon, ring.rangeM, bearing);
          if (!isNaN(pt.lat) && !isNaN(pt.lon) && isFinite(pt.lat) && isFinite(pt.lon)) {
            entities.push(
              new Cesium.Entity({
                name: `Nhãn cự ly ${ring.label} (${bearing}°)`,
                position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
                label: {
                  text: ring.label,
                  font: isMaxRing ? 'bold 12px "JetBrains Mono", monospace' : 'bold 11px "JetBrains Mono", monospace',
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  fillColor: isMaxRing ? Cesium.Color.WHITE : labelColor,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 4,
                  showBackground: true,
                  backgroundColor: labelBgColor,
                  backgroundPadding: new Cesium.Cartesian2(6, 3),
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  verticalOrigin: Cesium.VerticalOrigin.CENTER,
                  horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                },
              })
            );
          }
        });

        // Nhãn cự ly dọc theo trục Đông (90°) và Tây (270°)
        [90, 270].forEach((bearing) => {
          const pt = destinationPoint(safeLat, safeLon, ring.rangeM, bearing);
          if (!isNaN(pt.lat) && !isNaN(pt.lon) && isFinite(pt.lat) && isFinite(pt.lon)) {
            entities.push(
              new Cesium.Entity({
                name: `Nhãn cự ly ${ring.label} (${bearing}°)`,
                position: Cesium.Cartesian3.fromDegrees(pt.lon, pt.lat, 0),
                label: {
                  text: ring.label,
                  font: isMaxRing ? 'bold 12px "JetBrains Mono", monospace' : 'bold 11px "JetBrains Mono", monospace',
                  style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                  fillColor: isMaxRing ? Cesium.Color.WHITE : labelColor,
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 4,
                  showBackground: true,
                  backgroundColor: labelBgColor,
                  backgroundPadding: new Cesium.Cartesian2(6, 3),
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                  disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  verticalOrigin: Cesium.VerticalOrigin.CENTER,
                  horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                },
              })
            );
          }
        });
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
                material: Cesium.Color.fromCssColorString('#0284c7').withAlpha(0.35),
                clampToGround: true,
                zIndex: 55,
              },
            })
          );
        }
      });
    }
  }

  // 3. Render Tâm Đài Radar & Nhãn Toạ độ DMS chuẩn Cambridge Pixel & Quân sự
  // Điểm tâm đài
  if (showMarkers) {
    let statusColor = Cesium.Color.fromCssColorString('#06b6d4'); // Default cyan
    if (options?.status === 'Active' || options?.status === 'Hoạt động') {
      statusColor = Cesium.Color.fromCssColorString('#10b981'); // Emerald
    } else if (options?.status === 'Standby' || options?.status === 'Sẵn sàng') {
      statusColor = Cesium.Color.fromCssColorString('#f59e0b'); // Amber
    } else if (options?.status === 'Maintenance' || options?.status === 'Bảo dưỡng') {
      statusColor = Cesium.Color.fromCssColorString('#f97316'); // Orange
    } else if (options?.status === 'Offline' || options?.status === 'Tắt máy') {
      statusColor = Cesium.Color.fromCssColorString('#f43f5e'); // Rose
    }

    entities.push(
      new Cesium.Entity({
        name: `Tâm Đài Radar ${options?.shortId || ''}`,
        position: radarCartesian,
        point: {
          pixelSize: isSelected ? 12 : 9,
          color: isSelected ? Cesium.Color.fromCssColorString('#38bdf8') : Cesium.Color.WHITE,
          outlineColor: statusColor,
          outlineWidth: isSelected ? 3.5 : 2.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    );
  }

  // Nhãn thông số kỹ thuật đài tại tâm
  if (showLabels) {
    const latStr = toDmsString(safeLat, true);
    const lonStr = toDmsString(safeLon, false);
    const mslText = `${Math.round(safeGroundAlt)}m MSL`;
    const shortPrefix = options?.shortId ? `[${options.shortId}] ` : '';
    const displayName = instanceName ? `${shortPrefix}${instanceName}` : `${shortPrefix}Radar`;

    entities.push(
      new Cesium.Entity({
        name: `Nhãn Toạ Độ Tâm Đài ${options?.shortId || ''}`,
        position: radarCartesian,
        label: {
          text: `${displayName}\n${latStr}  ${lonStr}\n${mslText}`,
          font: isSelected ? 'bold 12px "JetBrains Mono", monospace' : 'bold 11px "JetBrains Mono", monospace',
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          fillColor: isSelected ? Cesium.Color.fromCssColorString('#38bdf8') : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 4,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#020617').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 4),
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          pixelOffset: new Cesium.Cartesian2(12, -12),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
    );
  }

  return entities;
}
