/**
 * Verification script: Kiểm chứng hình học cự ly/diện tích của lớp vectơ offline.
 *
 * Đảm bảo:
 * 1. Chiếu cục bộ <-> toạ độ là nghịch đảo của nhau (điểm khởi đầu trả về đúng chỗ).
 * 2. Khoảng cách tới điểm/đường/đa giác đúng với ca đã biết đáp án.
 * 3. Point-in-polygon nhận diện đúng trong/ngoài đa giác vuông ở xích đạo.
 * 4. Diện tích & chiều dài đúng với hình vuông cạnh 1 km.
 * 5. Douglas-Peucker rút gọn đúng: đường thẳng còn 2 điểm, gấp khúc còn đủ số đỉnh.
 */
import {
  distancePointToSegmentKm,
  distanceToGeometryKm,
  geometryAreaKm2,
  geometryCentroid,
  geometryLengthKm,
  pointInPolygon,
  projectToLocalKm,
  unprojectFromLocalKm,
  simplifyGeometry,
} from '../src/utils/vectorGeometry';
import { calculateHaversineDistanceKm } from '../src/utils/geo';

let failures = 0;
function check(name: string, condition: boolean, detail: unknown) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`[${status}] ${name} ::`, typeof detail === 'object' ? JSON.stringify(detail) : detail);
}

/** Sai số cho phép khi so khoảng cách (km). */
const TOL = 0.02; // 20 m - rộng vì phép chiếu cục bộ xấp xỉ

function run() {
  console.log('--- 1. Chiếu cục bộ (project/unproject) ---');

  const center = { lat: 21.45, lon: 105.65 };
  const sample = { lat: 21.5, lon: 105.7 };

  const [east, north] = projectToLocalKm(sample, center);
  check('project ra số dương (phía đông bắc)', east > 0 && north > 0, { eastKm: +east.toFixed(3), northKm: +north.toFixed(3) });

  // Cự ly từ phép chiếu phải khớp haversine
  const projectedDist = Math.sqrt(east * east + north * north);
  const haversineDist = calculateHaversineDistanceKm(center.lat, center.lon, sample.lat, sample.lon);
  check(
    'Cự ly chiếu khớp haversine (sai số < 1%)',
    Math.abs(projectedDist - haversineDist) / haversineDist < 0.01,
    { projectedKm: +projectedDist.toFixed(4), haversineKm: +haversineDist.toFixed(4) }
  );

  // Vòng khép kín chiếu -> chiếu ngược
  const back = unprojectFromLocalKm(east, north, center);
  check(
    'unproject trả về đúng toạ độ gốc',
    Math.abs(back.lat - sample.lat) < 1e-9 && Math.abs(back.lon - sample.lon) < 1e-9,
    { back }
  );

  console.log('--- 2. distancePointToSegmentKm ---');

  // Đoạn thẳng 10 km theo hướng Bắc từ điểm tâm
  const a = { lat: 21.45, lon: 105.65 };
  const b = { lat: 21.45 + 10 / 111, lon: 105.65 };

  // Điểm nằm giữa đoạn, lệch ngang 0.1 độ (~10.5 km)
  const mid = { lat: 21.45 + 5 / 111, lon: 105.65 + 0.1 };
  const r1 = distancePointToSegmentKm(mid, a, b);
  const expectedLatDist = calculateHaversineDistanceKm(mid.lat, mid.lon, 21.45 + 5 / 111, 105.65);
  check(
    'Điểm giữa đoạn: cự ly = cự ly ngang (~10.5 km)',
    Math.abs(r1.distanceKm - expectedLatDist) < TOL,
    { gotKm: +r1.distanceKm.toFixed(3), expectedKm: +expectedLatDist.toFixed(3) }
  );

  // Điểm nằm ngoài đầu đoạn (trước A) -> cự ly = cự ly A↔P
  const before = { lat: 21.44, lon: 105.65 };
  const r2 = distancePointToSegmentKm(before, a, b);
  const expectedBefore = calculateHaversineDistanceKm(21.44, 105.65, 21.45, 105.65);
  check(
    'Điểm trước đầu đoạn: cự ly = cự ly tới A',
    Math.abs(r2.distanceKm - expectedBefore) < TOL,
    { gotKm: +r2.distanceKm.toFixed(3), expectedKm: +expectedBefore.toFixed(3) }
  );

  // Điểm nằm trên đoạn -> cự ly gần 0
  const onLine = { lat: 21.45 + 3 / 111, lon: 105.65 };
  const r3 = distancePointToSegmentKm(onLine, a, b);
  check('Điểm nằm trên đoạn: cự ly ~ 0', r3.distanceKm < 0.01, { gotKm: +r3.distanceKm.toFixed(5) });

  console.log('--- 3. distanceToGeometryKm ---');

  // Point
  const pointFeature = { type: 'Point' as const, coordinates: [105.65, 21.45] as [number, number] };
  const rp = distanceToGeometryKm({ lat: 21.46, lon: 105.65 }, pointFeature);
  const expectedPointDist = calculateHaversineDistanceKm(21.46, 105.65, 21.45, 105.65);
  check(
    'Point: cự ly = haversine',
    Math.abs(rp.distanceKm - expectedPointDist) < TOL,
    { gotKm: +rp.distanceKm.toFixed(3), expectedKm: +expectedPointDist.toFixed(3) }
  );

  // LineString: điểm gần đầu bên
  const lineFeature = {
    type: 'LineString' as const,
    coordinates: [
      [105.64, 21.45],
      [105.66, 21.45],
    ] as [number, number][],
  };
  const rl = distanceToGeometryKm({ lat: 21.45, lon: 105.64 }, lineFeature);
  check('LineString: điểm nằm trên tuyến -> cự ly ~ 0', rl.distanceKm < 0.01, { gotKm: +rl.distanceKm.toFixed(5) });

  // Polygon: điểm bên trong -> 0
  const polyFeature = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [105.64, 21.44],
        [105.66, 21.44],
        [105.66, 21.46],
        [105.64, 21.46],
        [105.64, 21.44],
      ],
    ] as [number, number][][],
  };
  const insideDist = distanceToGeometryKm({ lat: 21.45, lon: 105.65 }, polyFeature);
  check('Polygon: điểm bên trong -> cự ly = 0', insideDist.distanceKm === 0, { gotKm: insideDist.distanceKm });

  // Polygon: điểm bên ngoài -> cự ly tới cạnh
  const outsideDist = distanceToGeometryKm({ lat: 21.5, lon: 105.65 }, polyFeature);
  const expectedOutside = calculateHaversineDistanceKm(21.5, 105.65, 21.46, 105.65);
  check(
    'Polygon: điểm bên ngoài -> cự ly tới cạnh gần nhất',
    Math.abs(outsideDist.distanceKm - expectedOutside) < TOL,
    { gotKm: +outsideDist.distanceKm.toFixed(3), expectedKm: +expectedOutside.toFixed(3) }
  );

  console.log('--- 4. pointInPolygon ---');

  const square = polyFeature.coordinates[0];
  check('pointInPolygon: tâm hình vuông -> true', pointInPolygon({ lat: 21.45, lon: 105.65 }, square), {});
  check('pointInPolygon: ngoài hình vuông -> false', !pointInPolygon({ lat: 21.5, lon: 105.65 }, square), {});
  check('pointInPolygon: góc hình vuông -> true', pointInPolygon({ lat: 21.44, lon: 105.64 }, square), {});

  console.log('--- 5. geometryAreaKm2 & geometryLengthKm ---');

  // Ô vuông: 0.02° vĩ độ x 0.02° kinh độ
  //   dLat = 0.02 x 111.32 = 2.227 km
  //   dLon = 0.02 x 111.32 x cos(21.45°) = 2.073 km
  //   => A ≈ 4.62 km², chu vi ≈ 2 x (2.227 + 2.073) = 8.60 km
  const areaKm2 = geometryAreaKm2(polyFeature);
  check(
    'Diện tích ô vuông 0.02° x 0.02° ≈ 4.62 km² (4.3 < A < 4.9)',
    areaKm2 > 4.3 && areaKm2 < 4.9,
    { areaKm2: +areaKm2.toFixed(4) }
  );

  const lengthKm = geometryLengthKm(polyFeature);
  check(
    'Chu vi ô vuông 0.02° ≈ 8.60 km (8.2 < L < 9.0)',
    lengthKm > 8.2 && lengthKm < 9.0,
    { lengthKm: +lengthKm.toFixed(3) }
  );

  // Diện tích Point/Line luôn = 0
  check('geometryAreaKm2(Point) = 0', geometryAreaKm2(pointFeature) === 0, {});
  check('geometryAreaKm2(LineString) = 0', geometryAreaKm2(lineFeature) === 0, {});

  console.log('--- 6. geometryCentroid ---');

  const centroid = geometryCentroid(polyFeature);
  check(
    'Centroid ô vuông khép kín nằm đúng tâm (bỏ điểm lặp)',
    centroid !== null && Math.abs(centroid.lat - 21.45) < 1e-9 && Math.abs(centroid.lon - 105.65) < 1e-9,
    { centroid }
  );

  // Hình vuông LỆCH TÂM: tọa độ tâm thật là (21.5, 105.7), không phải trung bình đỉnh
  // của 4 góc sau khi bỏ điểm lặp. Kiểm tra rằng code KHÔNG cộng 2 lần điểm đầu.
  const offsetSquare = {
    type: 'Polygon' as const,
    coordinates: [
      [
        [105.6, 21.4],
        [105.7, 21.4],
        [105.7, 21.5],
        [105.6, 21.5],
        [105.6, 21.4],
      ],
    ] as [number, number][][],
  };
  const offsetCentroid = geometryCentroid(offsetSquare);
  check(
    'Centroid ô vuông lệch: khớp trung bình 4 đỉnh (không lệch về góc đầu)',
    offsetCentroid !== null &&
      Math.abs(offsetCentroid.lat - 21.45) < 1e-9 &&
      Math.abs(offsetCentroid.lon - 105.65) < 1e-9,
    { offsetCentroid }
  );

  console.log('--- 7. simplifyGeometry (Douglas-Peucker) ---');

  // Đường thẳng 100 điểm -> rút gọn còn 2 điểm
  const straightLine = {
    type: 'LineString' as const,
    coordinates: Array.from({ length: 100 }, (_, i) => [105.65 + i * 0.001, 21.45] as [number, number]),
  };
  const simplifiedStraight = simplifyGeometry(straightLine, 0.1);
  check(
    'Đường thẳng 100 điểm -> 2 điểm (tolerance=100m)',
    simplifiedStraight.type === 'LineString' && simplifiedStraight.coordinates.length === 2,
    { points: simplifiedStraight.type === 'LineString' ? simplifiedStraight.coordinates.length : -1 }
  );

  // Đường gấp khúc: giữ điểm gấp
  const zigzag = {
    type: 'LineString' as const,
    coordinates: [
      [105.64, 21.44],
      [105.65, 21.46],
      [105.66, 21.44],
    ] as [number, number][],
  };
  const simplifiedZigzag = simplifyGeometry(zigzag, 0.01);
  check(
    'Đường gấp khúc 3 điểm -> giữ đủ 3 điểm (vượt tolerance)',
    simplifiedZigzag.type === 'LineString' && simplifiedZigzag.coordinates.length === 3,
    { points: simplifiedZigzag.type === 'LineString' ? simplifiedZigzag.coordinates.length : -1 }
  );

  // tolerance = 0 -> không rút gọn
  const notSimplified = simplifyGeometry(straightLine, 0);
  check(
    'tolerance=0 -> giữ nguyên 100 điểm',
    notSimplified.type === 'LineString' && notSimplified.coordinates.length === 100,
    { points: notSimplified.type === 'LineString' ? notSimplified.coordinates.length : -1 }
  );

  console.log('');
  console.log(failures === 0 ? 'TẤT CẢ PASS' : `${failures} FAIL`);
  process.exitCode = failures === 0 ? 0 : 1;
}

run();
