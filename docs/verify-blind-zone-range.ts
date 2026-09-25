/**
 * Verification script: Kiểm chứng tầm cự ly vùng mù / che chắn địa hình (Blind Zones)
 * Đảm bảo:
 * 1. Vùng mù màu đỏ KHÔNG BAO GIỜ vượt quá bán kính vòm danh nghĩa của khí tài (ví dụ 75 km).
 * 2. Điểm chuyển tiếp giữa tia bị che và tia thông suốt không bị giật về tâm đài (khoảng cách 0m).
 * 3. getProfileMaxRange không bao giờ trả về giá trị vượt quá fallbackRangeKm.
 */
import { getProfileMaxRange } from '../src/utils/radarMath';
import { computeRadarCoverageField } from '../src/utils/radarLosEngine';
import { buildRadarCoverageFieldEntities } from '../src/utils/radarGeometryBuilder';
import { EQUIPMENT_TEMPLATES } from '../src/data/equipmentTemplates';
import type { EquipmentInstance } from '../src/types/equipment';

let failures = 0;
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, typeof detail === 'object' ? JSON.stringify(detail) : detail);
}

async function run() {
  // 1. Kiểm tra getProfileMaxRange với template 36D6 / ST-68UM
  const st68Template = EQUIPMENT_TEMPLATES.find((t) => t.id === 'radar_36d6_st68um') || EQUIPMENT_TEMPLATES[0];
  const profile = st68Template.coverageProfile;

  console.log('--- 1. getProfileMaxRange Clamp Test ---');
  const elevAngles = [0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 15.0, 20.0];
  const rangesAtElevations = elevAngles.map((el) => {
    const r = getProfileMaxRange(profile, el, 75);
    return { el, r };
  });

  for (const { el, r } of rangesAtElevations) {
    check(`getProfileMaxRange ở góc tà el=${el}° không vượt quá 75km`, r > 0 && r <= 75.001, { el, r });
  }

  // 2. Kiểm tra computeRadarCoverageField giới hạn maxRangeKm
  console.log('--- 2. computeRadarCoverageField Max Range Test ---');
  const mockInstance: EquipmentInstance = {
    instanceId: 'test_36d6',
    templateId: 'radar_36d6_st68um',
    name: 'Đài Radar 36D6 (ST-68UM) #1',
    category: 'RadarCanhGioi',
    latitude: 15.80975,
    longitude: 108.16211,
    altitude: 12,
    antennaHeightAGL: 25,
    rangeKm: 75,
    scanSpeed: 12,
    minElevationDeg: 0.5,
    maxElevationDeg: 70,
    coverageHeightKm: 30,
    status: 'Active',
    commandedByInstanceId: null,
    color: '#00e5ff',
    showDome: true,
    showSweep: true,
    coverageProfile: profile,
  };

  const field = await computeRadarCoverageField(mockInstance, null, {
    azimuthStepDeg: 5,
    radialStepMeters: 1000,
    targetHeightMeters: 500,
    kFactor: 1.3333,
    showBlindZones: true,
  });

  check('field.maxRangeKm bằng chính xác rangeKm của đài (75km)', field.maxRangeKm === 75, field.maxRangeKm);
  check('Tất cả rays trong field có maxRangeKm <= 75km', field.rays.every((r) => r.maxRangeM <= 75001), {
    rayCount: field.rays.length,
    firstRayMaxM: field.rays[0]?.maxRangeM,
  });

  // 3. Kiểm tra buildRadarCoverageFieldEntities giới hạn tầm cự ly của vùng mù (destShadowEnd)
  console.log('--- 3. buildRadarCoverageFieldEntities Blind Zone Boundary Test ---');
  // Tạo một field có một số tia bị che bởi núi tại km 20
  field.rays.forEach((r, idx) => {
    if (idx >= 10 && idx <= 20) {
      r.visibleEndM = 20000; // Bị che chắn tại 20 km
      r.hasOcclusion = true;
      r.occlusionPoint = { distanceM: 20000, lat: 15.8, lon: 108.2, terrainAltM: 500 };
    } else {
      r.visibleEndM = 75000;
      r.hasOcclusion = false;
      r.occlusionPoint = null;
    }
  });

  const safeRangeKm = mockInstance.rangeKm; // 75 km
  const { blindEntities } = buildRadarCoverageFieldEntities(
    field,
    true, // showBlindZones
    '#00e5ff', // themeColorHex
    true, // isSelected
    false, // showConeOfSilence
    safeRangeKm * 1000 // maxEffectiveRangeM
  );

  check('Có tạo thực thể blindEntities cho vùng bị che', blindEntities.length > 0, blindEntities.length);

  // Tính khoảng cách từ toạ độ radar tới các đỉnh của đa giác vùng mù
  function haversineDistM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  let maxBlindVertexDistM = 0;
  let hasSpikeToCenter = false;

  for (const entity of blindEntities) {
    const rawHierarchy = (entity.polygon?.hierarchy as any);
    const hierarchy = rawHierarchy?.getValue ? rawHierarchy.getValue() : rawHierarchy;
    const positions = Array.isArray(hierarchy) ? hierarchy : hierarchy?.positions;
    if (Array.isArray(positions)) {
      for (const pos of positions) {
        // pos có thể là Cesium.Cartesian3 hoặc object { latitude, longitude }
        let lat = pos.latitude;
        let lon = pos.longitude;
        if (pos.x !== undefined && pos.y !== undefined && pos.z !== undefined) {
          // Cartesian3 -> Cartographic
          const carto = (Cesium.Cartographic as any).fromCartesian(pos);
          lat = (carto.latitude * 180) / Math.PI;
          lon = (carto.longitude * 180) / Math.PI;
        }
        if (lat !== undefined && lon !== undefined) {
          const distM = haversineDistM(mockInstance.latitude, mockInstance.longitude, lat, lon);
          if (distM > maxBlindVertexDistM) {
            maxBlindVertexDistM = distM;
          }
          // Nếu có điểm ở khoảng cách < 100m trong khi điểm bị che bắt đầu từ 20km -> spike to center
          if (distM < 100) {
            hasSpikeToCenter = true;
          }
        }
      }
    }
  }

  console.log(`Khoảng cách xa nhất của đỉnh vùng mù: ${(maxBlindVertexDistM / 1000).toFixed(2)} km (giới hạn vòm = ${safeRangeKm} km)`);
  check(
    `Đỉnh xa nhất của vùng mù <= ${safeRangeKm} km (không vượt ra ngoài vòm 75km)`,
    maxBlindVertexDistM <= safeRangeKm * 1000 + 100, // Dung sai 100m do phép chiếu hình cầu
    { maxBlindVertexDistM, limitM: safeRangeKm * 1000 }
  );

  check('Không có hiện tượng gai nhọn thụt về tâm đài (spike to center < 100m)', !hasSpikeToCenter, {
    hasSpikeToCenter,
  });

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nALL BLIND ZONE RANGE CHECKS PASSED!');
  }
}

import * as Cesium from 'cesium';
run().catch((e) => {
  console.error('Lỗi thực thi:', e);
  process.exit(1);
});
