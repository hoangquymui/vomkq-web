import { area } from '@turf/area';
import { intersect } from '@turf/intersect';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import assert from 'node:assert/strict';

// Tạo 1 vùng phẳng lớn 300m x 300m (~90.000 m2 = 9 ha) quanh Hà Nội (lat 21.0, lon 105.8)
const centerLat = 21.0;
const centerLon = 105.8;
const mPerDegLat = 111132.92;
const mPerDegLon = 111412.84 * Math.cos((centerLat * Math.PI) / 180);

const halfLatDeg = 150 / mPerDegLat;
const halfLonDeg = 150 / mPerDegLon;

const rootCoords = [
  [centerLon - halfLonDeg, centerLat - halfLatDeg],
  [centerLon - halfLonDeg, centerLat + halfLatDeg],
  [centerLon + halfLonDeg, centerLat + halfLatDeg],
  [centerLon + halfLonDeg, centerLat - halfLatDeg],
  [centerLon - halfLonDeg, centerLat - halfLatDeg],
];

const rootPoly = turfPolygon([rootCoords]);
const rootArea = area(rootPoly);
console.log(`Root area: ${rootArea.toFixed(1)} m2 (~${(rootArea / 10000).toFixed(2)} ha)`);
assert.ok(rootArea > 10000, 'Root area phải > 10.000 m2');

// Phân chia theo ô 100m x 100m (tối đa 10.000 m2)
const stepLatDeg = 100 / mPerDegLat;
const stepLonDeg = 100 / mPerDegLon;

const minLat = centerLat - halfLatDeg;
const maxLat = centerLat + halfLatDeg;
const minLon = centerLon - halfLonDeg;
const maxLon = centerLon + halfLonDeg;

const subPolygons = [];

for (let lat = minLat; lat < maxLat + stepLatDeg * 0.1; lat += stepLatDeg) {
  for (let lon = minLon; lon < maxLon + stepLonDeg * 0.1; lon += stepLonDeg) {
    const cellCoords = [
      [lon, lat],
      [lon, lat + stepLatDeg],
      [lon + stepLonDeg, lat + stepLatDeg],
      [lon + stepLonDeg, lat],
      [lon, lat],
    ];
    const cellPoly = turfPolygon([cellCoords]);
    const isect = intersect(featureCollection([rootPoly, cellPoly]));
    if (isect && isect.geometry) {
      if (isect.geometry.type === 'Polygon') {
        const subArea = area(isect);
        if (subArea >= 500) {
          subPolygons.push({ geom: isect.geometry, area: subArea });
        }
      } else if (isect.geometry.type === 'MultiPolygon') {
        for (const coords of isect.geometry.coordinates) {
          const poly = turfPolygon(coords);
          const subArea = area(poly);
          if (subArea >= 500) {
            subPolygons.push({ geom: poly.geometry, area: subArea });
          }
        }
      }
    }
  }
}

console.log(`Đã chia thành ${subPolygons.length} mảng con.`);
let totalSubArea = 0;
for (let i = 0; i < subPolygons.length; i++) {
  const p = subPolygons[i];
  console.log(`  Mảng con #${i + 1}: ${p.area.toFixed(1)} m2 (${(p.area / 10000).toFixed(3)} ha)`);
  assert.ok(p.area <= 10005, `Mảng con #${i + 1} (${p.area} m2) phải <= 10.000 m2 (sai số tối đa 5m2)!`);
  totalSubArea += p.area;
}

console.log(`Tổng diện tích các mảng con: ${totalSubArea.toFixed(1)} m2 so với gốc ${rootArea.toFixed(1)} m2`);
const ratio = totalSubArea / rootArea;
console.log(`Tỷ lệ bảo toàn diện tích: ${(ratio * 100).toFixed(2)}%`);
assert.ok(ratio >= 0.98 && ratio <= 1.02, 'Tổng diện tích phải bảo toàn xấp xỉ 100%!');
console.log('\n=> TEST SUBDIVISION LOGIC PASS 100%!');
