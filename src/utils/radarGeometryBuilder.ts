import * as Cesium from 'cesium';
import type { RadarCoverageResult, RayProfile } from '../types/radarCoverage';

/**
 * Xây dựng các thực thể 3D trong Cesium để trực quan hoá:
 * 1. Vòm sóng 3D cắt địa hình (Màu Xanh / Cyan cho vùng nhìn thấy)
 * 2. Khối nan quạt / Thung lũng mù địa hình (Màu Đỏ / Cam cho vùng bị che khuất)
 * 3. Vết quét 2D ôm sát mặt đất (Ground footprint)
 * 4. Khu mù đỉnh đầu (Cone of Silence)
 */

export interface RadarVisualizationEntities {
  visibleEntities: Cesium.Entity[];
  blindEntities: Cesium.Entity[];
  coneOfSilenceEntities: Cesium.Entity[];
}

/**
 * Tạo các thực thể Cesium Entity từ kết quả tính toán quang tuyến LOS
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
  const visibleGreen = Cesium.Color.fromCssColorString('#10b981'); // Xanh lá có phủ
  const blindRed = Cesium.Color.fromCssColorString('#ef4444'); // Đỏ mù địa hình

  const centerPos = Cesium.Cartesian3.fromDegrees(radarLon, radarLat, radarAltM);

  // -------------------------------------------------------------
  // 1. KHU MÙ ĐỈNH ĐẦU (Cone of Silence)
  // Vẽ vòng tròn vàng cảnh báo và nón ngược trên đỉnh đài
  // -------------------------------------------------------------
  if (coneOfSilenceRadiusKm > 0) {
    // Vòng tròn giới hạn khu mù tại độ cao mục tiêu H_mt
    coneOfSilenceEntities.push(
      new Cesium.Entity({
        name: `Khu mù đỉnh đầu - ${result.radarName}`,
        position: Cesium.Cartesian3.fromDegrees(
          radarLon,
          radarLat,
          radarAltM + targetHeightM
        ),
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

    // Vành nón khu mù đỉnh đầu nối từ anten lên độ cao mục tiêu
    coneOfSilenceEntities.push(
      new Cesium.Entity({
        name: `Trục nón khu mù đỉnh đầu`,
        polyline: {
          positions: [
            centerPos,
            Cesium.Cartesian3.fromDegrees(
              radarLon,
              radarLat,
              radarAltM + Math.max(1000, targetHeightM * 2)
            ),
          ],
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#eab308'),
            dashLength: 12,
          }),
        },
      })
    );
  }

  // -------------------------------------------------------------
  // 2. VÒM SÓNG 3D CẮT ĐỊA HÌNH (Canopy Mesh & Ray Curtains)
  // Phân tách 2 mảng màu rõ rệt: XANH (Có phủ) và ĐỎ (Mù địa hình)
  // -------------------------------------------------------------
  const numProfiles = profiles.length;

  for (let i = 0; i < numProfiles; i++) {
    const pCurrent = profiles[i];
    const pNext = profiles[(i + 1) % numProfiles];

    const isCurrentBlocked = pCurrent.maskingAngleRad > 0.05; // ~3° trở lên
    const isNextBlocked = pNext.maskingAngleRad > 0.05;
    const isSectorBlind = isCurrentBlocked || isNextBlocked;

    // Lấy điểm xa nhất trên 2 tia liền kề
    const curEndSample = pCurrent.samples[pCurrent.samples.length - 1];
    const nextEndSample = pNext.samples[pNext.samples.length - 1];

    if (!curEndSample || !nextEndSample) continue;

    // Đỉnh chóp sóng phía trên (trần phủ sóng hoặc độ cao mục tiêu)
    const curCeiling = Math.max(targetHeightM, curEndSample.rayAltM);
    const nextCeiling = Math.max(targetHeightM, nextEndSample.rayAltM);

    // Toạ độ 3D của các góc nan quạt
    const posCenter = centerPos;
    const posCurTop = Cesium.Cartesian3.fromDegrees(
      curEndSample.lon,
      curEndSample.lat,
      curCeiling
    );
    const posNextTop = Cesium.Cartesian3.fromDegrees(
      nextEndSample.lon,
      nextEndSample.lat,
      nextCeiling
    );

    // Phân loại: Nếu hướng này bị núi chắn -> Đỏ / Cam; nếu thông thoáng -> Xanh ngọc / Xanh lục
    const sectorColor = isSectorBlind
      ? blindRed.withAlpha(0.28)
      : baseColor.withAlpha(0.22);
    const sectorOutlineColor = isSectorBlind
      ? blindRed.withAlpha(0.7)
      : baseColor.withAlpha(0.6);

    const targetList = isSectorBlind ? blindEntities : visibleEntities;

    // A. MẶT VÒM TRÊN (3D Upper Canopy Sector)
    targetList.push(
      new Cesium.Entity({
        name: `Nan vòm ${pCurrent.azimuthDeg}°`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy([
            posCenter,
            posCurTop,
            posNextTop,
          ]),
          perPositionHeight: true,
          material: sectorColor,
          outline: true,
          outlineColor: sectorOutlineColor,
          outlineWidth: 1,
        },
      })
    );

    // B. TƯỜNG CẮT SƯỜN NÚI NGOÀI CÙNG (Outer Ray Curtain)
    targetList.push(
      new Cesium.Entity({
        name: `Lát cắt quang tuyến ${pCurrent.azimuthDeg}°`,
        wall: {
          positions: [posCurTop, posNextTop],
          minimumHeights: [curEndSample.terrainAltM, nextEndSample.terrainAltM],
          material: sectorColor,
        },
      })
    );
  }

  // -------------------------------------------------------------
  // 3. MẶT CẮT 2D MẶT ĐẤT ÔM SÁT ĐỊA HÌNH (Ground Clamped Footprint)
  // Phân màu chi tiết dọc theo sườn núi và thung lũng
  // -------------------------------------------------------------
  profiles.forEach((profile: RayProfile) => {
    // Duyệt qua các đoạn ray xem đoạn nào nhìn thấy, đoạn nào bị che khuất
    for (let k = 0; k < profile.samples.length - 1; k++) {
      const s1 = profile.samples[k];
      const s2 = profile.samples[k + 1];

      const isBlocked = s2.isBlocked;
      const lineColor = isBlocked
        ? blindRed.withAlpha(0.75)
        : visibleGreen.withAlpha(0.6);

      const targetEntityList = isBlocked ? blindEntities : visibleEntities;

      targetEntityList.push(
        new Cesium.Entity({
          name: `Tia LOS ${profile.azimuthDeg}° (${s1.distanceM / 1000}-${s2.distanceM / 1000}km)`,
          polyline: {
            positions: [
              Cesium.Cartesian3.fromDegrees(s1.lon, s1.lat, s1.terrainAltM + 5),
              Cesium.Cartesian3.fromDegrees(s2.lon, s2.lat, s2.terrainAltM + 5),
            ],
            width: isBlocked ? 3 : 2,
            clampToGround: true,
            material: new Cesium.PolylineGlowMaterialProperty({
              color: lineColor,
              glowPower: isBlocked ? 0.25 : 0.15,
            }),
          },
        })
      );
    }
  });

  return {
    visibleEntities,
    blindEntities: showBlindZones ? blindEntities : [],
    coneOfSilenceEntities,
  };
}
