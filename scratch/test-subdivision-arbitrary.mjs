import { area } from '@turf/area';
import { intersect } from '@turf/intersect';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import assert from 'node:assert/strict';

// Đa giác tự nhiên bất kỳ (hình thang + chéo)
const centerLat = 21.45;
const centerLon = 105.65;
const mPerDegLat = 111132.92;
const mPerDegLon = 111412.84 * Math.cos((centerLat * Math.PI) / 180);

const dLat = (m) => m / mPerDegLat;
const dLon = (m) => m / mPerDegLon;

const arbitraryCoords = [
  [centerLon + dLon(-200), centerLat + dLat(-150)],
  [centerLon + dLon(-150), centerLat + dLat(250)],
  [centerLon + dLon(100), centerLat + dLat(200)],
  [centerLon + dLon(250), centerLat + dLat(0)],
  [centerLon + dLon(180), centerLat + dLat(-200)],
  [centerLon + dLon(-200), centerLat + dLat(-150)],
];

const rootPoly = turfPolygon([arbitraryCoords]);
const rootArea = area(rootPoly);
console.log(`Arbitrary root area: ${rootArea.toFixed(1)} m2 (~${(rootArea / 10000).toFixed(2)} ha)`);

// Tìm bounds
let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
for (const [lon, lat] of arbitraryCoords) {
  if (lat < minLat) minLat = lat;
  if (lat > maxLat) maxLat = lat;
  if (lon < minLon) minLon = lon;
  if (lon > maxLon) maxLon = lon;
}

const stepLatDeg = 100 / mPerDegLat;
const stepLonDeg = 100 / mPerDegLon;
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

console.log(`Đã chia đa giác bất kỳ thành ${subPolygons.length} mảng con:`);
let totalSubArea = 0;
for (let i = 0; i < subPolygons.length; i++) {
  const p = subPolygons[i];
  console.log(`  Mảng con #${i + 1}: ${p.area.toFixed(1)} m2 (${(p.area / 10000).toFixed(3)} ha)`);
  assert.ok(p.area <= 10005, `Mảng con #${i + 1} (${p.area} m2) phải <= 10.000 m2!`);
  totalSubArea += p.area;
}

console.log(`Tổng diện tích mảng con: ${totalSubArea.toFixed(1)} m2 / Gốc: ${rootArea.toFixed(1)} m2`);
const ratio = totalSubArea / rootArea;
console.log(`Độ bao phủ: ${(ratio * 100).toFixed(2)}%`);
assert.ok(ratio >= 0.95 && ratio <= 1.01, 'Độ bao phủ phải >= 95% sau khi loại vụn mép < 500m2');
console.log('\n=> TEST ARBITRARY SUBDIVISION PASS 100%!');
