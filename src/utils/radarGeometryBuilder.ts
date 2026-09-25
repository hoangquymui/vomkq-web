import * as Cesium from 'cesium';
import type { RadarCoverageField, RadarCoverageResult } from '../types/radarCoverage';
import { destinationPoint } from './radarLosEngine';

/**
 * Cấu trúc các thực thể 3D trực quan hoá trường radar
 */
export interface RadarVisualizationEntities {
  visibleEntities: Cesium.Entity[];
  blindEntities: Cesium.Entity[];
  coneOfSilenceEntities: Cesium.Entity[];
}

/**
 * Kiểm tra toạ độ Cartesian3 có hợp lệ và hữu hạn hay không
 */
function isValidCartesian(p: Cesium.Cartesian3 | null | undefined): boolean {
  return (
    p !== null &&
    p !== undefined &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z)
  );
}

/**
 * XÂY DỰNG HÌNH HỌC 3D TRƯỜNG PHỦ RADAR CHUẨN TÁC CHIẾN
 * - Khuyết hình nón vùng mù trên đỉnh radar (Cone of Silence) theo H_mt * cotg(eps_max)
 * - Mép ngoài uốn lượn cắt theo địa hình thực tế và đường chân trời vô tuyến ở độ cao H_mt
 * - Bề mặt vòm mịn màng, liền khối, trong suốt (alpha thấp), KHÔNG bật outline nan quạt gây rối mắt
 * - Vùng khuất địa hình (Shadow) hiển thị bằng màu đỏ cam cảnh báo và mảng bóng đổ bám đất
 * - Thay đổi trực quan tức thì khi người chỉ huy điều chỉnh độ cao mục tiêu H_mt
 */
export function buildRadarCoverageFieldEntities(
  field: RadarCoverageField,
  showBlindZones: boolean = true,
  themeColorHex: string = '#06b6d4',
  isSelected: boolean = false,
  showConeOfSilence: boolean = true,
  maxEffectiveRangeM?: number
): RadarVisualizationEntities {
  const visibleEntities: Cesium.Entity[] = [];
  const blindEntities: Cesium.Entity[] = [];
  const coneOfSilenceEntities: Cesium.Entity[] = [];

  const {
    radarLat,
    radarLon,
    radarAltM,
    azimuthRays,
    maxElevationDeg,
    maxRangeKm,
    targetHeightM,
    radarHorizonKm,
  } = field;

  const baseColor = Cesium.Color.fromCssColorString(themeColorHex);
  const targetH = targetHeightM || 300;
  const maxElev = maxElevationDeg || 30;

  // 1. Tính bán kính vùng mù đỉnh đầu ở độ cao mục tiêu H_mt: R_kh = H_mt * cotg(eps_max)
  const maxElevRad = (maxElev * Math.PI) / 180;
  const cotgMaxElev = maxElev > 0 && maxElev < 90 ? 1 / Math.tan(maxElevRad) : 0;
  const coneRadiusM = Math.max(0, targetH * cotgMaxElev);

  // 2. Cự ly tối đa phát hiện mục tiêu ở độ cao H_mt:
  // Luôn bị giới hạn trên bởi tầm cự ly thực tế của đài/vòm (maxEffectiveRangeM hoặc maxRangeKm)
  const horizonM = (radarHorizonKm || 4.12 * (Math.sqrt(field.antennaHeightAGL || 15) + Math.sqrt(targetH))) * 1000;
  const profileMaxM = (maxRangeKm || 100) * 1000;
  const effectiveDomeRadiusM =
    typeof maxEffectiveRangeM === 'number' && Number.isFinite(maxEffectiveRangeM) && maxEffectiveRangeM > 0
      ? Math.min(profileMaxM, maxEffectiveRangeM)
      : profileMaxM;
  const maxDetectionDistanceM = Math.min(effectiveDomeRadiusM, horizonM);

  const azimuths = Object.keys(azimuthRays)
    .map(Number)
    .sort((a, b) => a - b);
  const numAz = azimuths.length;

  if (numAz === 0) return { visibleEntities, blindEntities, coneOfSilenceEntities };

  // Mảng lưu tọa độ đỉnh mép trong (Inner Ring) và mép ngoài (Outer Ring) để vẽ đường viền phát quang
  const innerRingPositions: Cesium.Cartesian3[] = [];
  const outerRingPositions: Cesium.Cartesian3[] = [];

  interface AzimuthGeometryData {
    az: number;
    pInner: Cesium.Cartesian3;
    pOuter: Cesium.Cartesian3;
    pShadowEnd: Cesium.Cartesian3;
    hasOcclusion: boolean;
    sOccDistM: number;
    sOccLat: number;
    sOccLon: number;
    sEndLat: number;
    sEndLon: number;
  }

  const azDataList: AzimuthGeometryData[] = [];

  for (let i = 0; i < numAz; i++) {
    const az = azimuths[i];
    const rays = azimuthRays[az] || [];
    const botRay = rays[0]; // Tia góc tà thấp nhất bám sát địa hình

    // Điểm mép trong (mép lỗ khuyết đỉnh đầu ở độ cao H_mt)
    const destInner = destinationPoint(radarLat, radarLon, coneRadiusM, az);
    const pInner = Cesium.Cartesian3.fromDegrees(
      destInner.lon,
      destInner.lat,
      radarAltM + targetH
    );

    // Điểm mép ngoài cự ly xa nhất của vòm tại phương vị này
    const destShadowEnd = destinationPoint(radarLat, radarLon, maxDetectionDistanceM, az);
    const pShadowEnd = Cesium.Cartesian3.fromDegrees(
      destShadowEnd.lon,
      destShadowEnd.lat,
      radarAltM + targetH
    );

    // Kiểm tra chắn địa hình
    let effectiveDistM = maxDetectionDistanceM;
    let outerAltM = radarAltM + targetH;
    let isBlocked = false;
    // Mặc định khi không bị chắn: cự ly bắt đầu bóng râm = điểm kết thúc (độ dày bóng râm = 0, không kéo về tâm)
    let sOccDistM = maxDetectionDistanceM;
    let sOccLat = destShadowEnd.lat;
    let sOccLon = destShadowEnd.lon;

    if (botRay && botRay.hasOcclusion && botRay.occlusionPoint) {
      const occDistM = botRay.occlusionPoint.distanceM;
      if (occDistM > coneRadiusM && occDistM < maxDetectionDistanceM) {
        effectiveDistM = occDistM;
        outerAltM = Math.max(botRay.occlusionPoint.terrainAltM, radarAltM + 10);
        isBlocked = true;
        sOccDistM = occDistM;
        sOccLat = botRay.occlusionPoint.lat;
        sOccLon = botRay.occlusionPoint.lon;
      }
    }

    const destOuter = destinationPoint(radarLat, radarLon, effectiveDistM, az);
    const pOuter = Cesium.Cartesian3.fromDegrees(destOuter.lon, destOuter.lat, outerAltM);

    azDataList.push({
      az,
      pInner,
      pOuter,
      pShadowEnd,
      hasOcclusion: isBlocked,
      sOccDistM,
      sOccLat,
      sOccLon,
      sEndLat: destShadowEnd.lat,
      sEndLon: destShadowEnd.lon,
    });

    if (isValidCartesian(pInner)) innerRingPositions.push(pInner);
    if (isValidCartesian(pOuter)) outerRingPositions.push(pOuter);
  }

  // Khép kín vòng tròn cho polylines
  if (innerRingPositions.length > 0) innerRingPositions.push(innerRingPositions[0]);
  if (outerRingPositions.length > 0) outerRingPositions.push(outerRingPositions[0]);

  // -------------------------------------------------------------
  // A. DỰNG MẶT VÒM PHỦ SÓNG 3D (Mượt mà, liền khối, khoét nón đỉnh đầu, cắt theo địa hình)
  // -------------------------------------------------------------
  const visibleColor = baseColor.withAlpha(isSelected ? 0.25 : 0.15);
  const innerConeColor = Cesium.Color.fromCssColorString('#eab308').withAlpha(isSelected ? 0.16 : 0.08);
  const centerAntennaPos = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM);

  for (let i = 0; i < numAz; i++) {
    const cur = azDataList[i];
    const next = azDataList[(i + 1) % numAz];

    // 1. Mặt nón ngược vùng mù đỉnh đầu (Funnel from antenna to inner ring)
    if (showConeOfSilence && coneRadiusM > 200 && isValidCartesian(cur.pInner) && isValidCartesian(next.pInner)) {
      coneOfSilenceEntities.push(
        new Cesium.Entity({
          name: `Phễu nón vùng mù đỉnh đầu (${cur.az}°)`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy([centerAntennaPos, cur.pInner, next.pInner]),
            perPositionHeight: true,
            material: innerConeColor,
            outline: false,
          },
        })
      );
    }

    // 2. Mặt vòm phủ sóng Visible (từ vòng khuyết đỉnh đầu ra mép ngoài cắt theo địa hình)
    if (
      isValidCartesian(cur.pInner) &&
      isValidCartesian(cur.pOuter) &&
      isValidCartesian(next.pOuter) &&
      isValidCartesian(next.pInner)
    ) {
      visibleEntities.push(
        new Cesium.Entity({
          name: `Vòm phủ sóng (${cur.az}°-${next.az}°)`,
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy([
              cur.pInner,
              cur.pOuter,
              next.pOuter,
              next.pInner,
            ]),
            perPositionHeight: true,
            material: visibleColor,
            outline: false, // Giữ mặt vòm mịn màng, không có nan quạt mắt lưới rối mắt
          },
        })
      );
    }

    // 3. Khối vùng mù địa hình (Shadow) phía sau sườn núi
    if (showBlindZones && (cur.hasOcclusion || next.hasOcclusion)) {
      const shadowColor = Cesium.Color.fromCssColorString('#ef4444').withAlpha(
        isSelected ? 0.35 : 0.22
      );
      const groundShadowColor = Cesium.Color.fromCssColorString('#dc2626').withAlpha(
        isSelected ? 0.45 : 0.3
      );

      // A. Mảng bóng râm bám đất sườn núi (Clamp to Ground)
      const gOcc1 = Cesium.Cartesian3.fromDegrees(cur.sOccLon, cur.sOccLat);
      const gEnd1 = Cesium.Cartesian3.fromDegrees(cur.sEndLon, cur.sEndLat);
      const gEnd2 = Cesium.Cartesian3.fromDegrees(next.sEndLon, next.sEndLat);
      const gOcc2 = Cesium.Cartesian3.fromDegrees(next.sOccLon, next.sOccLat);

      if (
        isValidCartesian(gOcc1) &&
        isValidCartesian(gEnd1) &&
        isValidCartesian(gEnd2) &&
        isValidCartesian(gOcc2)
      ) {
        blindEntities.push(
          new Cesium.Entity({
            name: `Bóng râm địa hình sườn núi (${cur.az}°-${next.az}°)`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy([gOcc1, gEnd1, gEnd2, gOcc2]),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              classificationType: Cesium.ClassificationType.TERRAIN,
              material: groundShadowColor,
            },
          })
        );
      }

      // B. Khối nêm không gian vùng mù nối từ điểm cản ra cự ly xa nhất
      if (
        isValidCartesian(cur.pOuter) &&
        isValidCartesian(cur.pShadowEnd) &&
        isValidCartesian(next.pShadowEnd) &&
        isValidCartesian(next.pOuter)
      ) {
        blindEntities.push(
          new Cesium.Entity({
            name: `Khối mù không gian (${cur.az}°-${next.az}°)`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy([
                cur.pOuter,
                cur.pShadowEnd,
                next.pShadowEnd,
                next.pOuter,
              ]),
              perPositionHeight: true,
              material: shadowColor,
              outline: false,
            },
          })
        );
      }
    }
  }

  // -------------------------------------------------------------
  // B. HAI ĐƯỜNG VIỀN PHÁT QUANG TINH TẾ (Inner & Outer Rings)
  // -------------------------------------------------------------
  // 1. Viền mép lỗ khuyết đỉnh đầu
  if (showConeOfSilence && coneRadiusM > 200 && innerRingPositions.length > 2) {
    coneOfSilenceEntities.push(
      new Cesium.Entity({
        name: `Vành khuyết vùng mù đỉnh đầu - ${field.radarName}`,
        polyline: {
          positions: innerRingPositions,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#facc15'),
            dashLength: 14,
          }),
        },
      })
    );
  }

  // 2. Viền mép ngoài uốn lượn theo địa hình thực tế
  if (outerRingPositions.length > 2) {
    visibleEntities.push(
      new Cesium.Entity({
        name: `Biên phát hiện radar bám địa hình - ${field.radarName}`,
        polyline: {
          positions: outerRingPositions,
          width: isSelected ? 3 : 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            color: baseColor,
            glowPower: isSelected ? 0.35 : 0.2,
          }),
        },
      })
    );
  }

  return {
    visibleEntities,
    blindEntities: showBlindZones ? blindEntities : [],
    coneOfSilenceEntities: showConeOfSilence ? coneOfSilenceEntities : [],
  };
}

/**
 * Hàm tương thích ngược với kết quả RadarCoverageResult cũ
 */
export function buildRadarVisualizationEntities(
  result: RadarCoverageResult,
  showBlindZones: boolean = true,
  themeColorHex: string = '#06b6d4'
): RadarVisualizationEntities {
  const visibleEntities: Cesium.Entity[] = [];
  const blindEntities: Cesium.Entity[] = [];
  const coneOfSilenceEntities: Cesium.Entity[] = [];

  const {
    radarLat,
    radarLon,
    radarAltM,
    profiles,
    coneOfSilenceRadiusKm,
    targetHeightM,
  } = result;

  const baseColor = Cesium.Color.fromCssColorString(themeColorHex);
  const blindRed = Cesium.Color.fromCssColorString('#ef4444');
  const centerPos = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM);

  if (coneOfSilenceRadiusKm > 0) {
    coneOfSilenceEntities.push(
      new Cesium.Entity({
        name: `Khu mù đỉnh đầu - ${result.radarName}`,
        position: Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM + targetHeightM),
        ellipse: {
          semiMajorAxis: coneOfSilenceRadiusKm * 1000,
          semiMinorAxis: coneOfSilenceRadiusKm * 1000,
          material: Cesium.Color.fromCssColorString('#eab308').withAlpha(0.25),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#eab308'),
          outlineWidth: 2,
          height: radarAltM + targetHeightM,
        },
      })
    );
  }

  const numProfiles = profiles.length;
  for (let i = 0; i < numProfiles; i++) {
    const pCurrent = profiles[i];
    const pNext = profiles[(i + 1) % numProfiles];

    const isCurrentBlocked = pCurrent.maskingAngleRad > 0.05;
    const isNextBlocked = pNext.maskingAngleRad > 0.05;
    const isSectorBlind = isCurrentBlocked || isNextBlocked;

    const curEndSample = pCurrent.samples[pCurrent.samples.length - 1];
    const nextEndSample = pNext.samples[pNext.samples.length - 1];
    if (!curEndSample || !nextEndSample) continue;

    const curCeiling = Math.max(targetHeightM, curEndSample.rayAltM);
    const nextCeiling = Math.max(targetHeightM, nextEndSample.rayAltM);

    const posCurTop = Cesium.Cartesian3.fromDegrees(curEndSample.lon, curEndSample.lat, curCeiling);
    const posNextTop = Cesium.Cartesian3.fromDegrees(nextEndSample.lon, nextEndSample.lat, nextCeiling);

    if (!isValidCartesian(centerPos) || !isValidCartesian(posCurTop) || !isValidCartesian(posNextTop)) {
      continue;
    }

    const sectorColor = isSectorBlind ? blindRed.withAlpha(0.28) : baseColor.withAlpha(0.22);
    const targetList = isSectorBlind ? blindEntities : visibleEntities;

    targetList.push(
      new Cesium.Entity({
        name: `Nan vòm ${pCurrent.azimuthDeg}°`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([centerPos, posCurTop, posNextTop]),
          perPositionHeight: true,
          material: sectorColor,
          outline: true,
          outlineColor: sectorColor.withAlpha(0.6),
          outlineWidth: 1,
        },
      })
    );
  }

  return {
    visibleEntities,
    blindEntities: showBlindZones ? blindEntities : [],
    coneOfSilenceEntities,
  };
}

