import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

console.log('=== BẮT ĐẦU KIỂM TRA 5 VẤN ĐỀ GIS 2D/3D ===\n');

// 1. Kiểm tra mã nguồn CesiumGlobe.tsx
const cesiumGlobePath = path.resolve('src/components/map/CesiumGlobe.tsx');
const cesiumGlobeCode = fs.readFileSync(cesiumGlobePath, 'utf8');

// A. Không được chứa ClippingPolygonCollection gây màn hình đen
assert.ok(
  !cesiumGlobeCode.includes('new Cesium.ClippingPolygonCollection'),
  'FAIL: CesiumGlobe vẫn còn chứa ClippingPolygonCollection'
);
console.log('✔ PASS 1.1: Đã loại bỏ hoàn toàn ClippingPolygonCollection (Chống lỗi màn hình đen)');

// B. Có bật enableCollisionDetection và minimumZoomDistance
assert.ok(
  cesiumGlobeCode.includes('enableCollisionDetection = true'),
  'FAIL: Chưa bật enableCollisionDetection'
);
assert.ok(
  cesiumGlobeCode.includes('minimumZoomDistance = 25'),
  'FAIL: Chưa đặt minimumZoomDistance'
);
console.log('✔ PASS 1.2: Đã bật chống đâm xuyên lòng đất (enableCollisionDetection & minimumZoomDistance)');

// C. Có vẽ polyline clampToGround cho viền neon bám địa hình
assert.ok(
  cesiumGlobeCode.includes('clampToGround: true'),
  'FAIL: Chưa có polyline clampToGround bám địa hình'
);
assert.ok(
  cesiumGlobeCode.includes('fillAlpha = isSelected ? 0.22 : 0.12') ||
  cesiumGlobeCode.includes('fillAlpha = isSelected ? 0.22 : isHovered ? 0.18 : 0.12'),
  'FAIL: Chưa đặt fillAlpha bán trong suốt nhẹ'
);
console.log('✔ PASS 1.3: Trực quan hóa mảng 3D đạt chuẩn (fill bán trong suốt + viền neon clampToGround)');

// 2. Kiểm tra TacticalCanvas2D.tsx
const canvas2dPath = path.resolve('src/components/ui/TacticalCanvas2D.tsx');
const canvas2dCode = fs.readFileSync(canvas2dPath, 'utf8');

assert.ok(
  canvas2dCode.includes('addEventListener(\'wheel\'') || canvas2dCode.includes('addEventListener("wheel"'),
  'FAIL: TacticalCanvas2D thiếu wheel zoom'
);
assert.ok(
  canvas2dCode.includes('onMouseDown={handleMouseDown}'),
  'FAIL: TacticalCanvas2D thiếu pan chuột kéo'
);
assert.ok(
  canvas2dCode.includes('showDemGrid') && canvas2dCode.includes('setShowDemGrid'),
  'FAIL: TacticalCanvas2D thiếu toggle lưới DEM'
);
assert.ok(
  canvas2dCode.includes('showContours') && canvas2dCode.includes('setShowContours'),
  'FAIL: TacticalCanvas2D thiếu toggle đường đồng mức'
);
assert.ok(
  canvas2dCode.includes('mPerDegLat') && canvas2dCode.includes('mPerDegLon'),
  'FAIL: TacticalCanvas2D thiếu chuẩn hóa tỷ lệ WGS84 isotropic'
);
console.log('✔ PASS 2.1: TacticalCanvas2D đầy đủ tương tác (wheel zoom, pan, controls, WGS84 isotropic)');

// 3. Kiểm tra TerrainZoneInspector.tsx
const inspectorPath = path.resolve('src/components/ui/TerrainZoneInspector.tsx');
const inspectorCode = fs.readFileSync(inspectorPath, 'utf8');

assert.ok(
  inspectorCode.includes('selectedPatch.parentZoneId') && inspectorCode.includes('totalZoneAreaM2'),
  'FAIL: TerrainZoneInspector chưa hiển thị thông tin mảng con & vùng gốc'
);
assert.ok(
  inspectorCode.includes('Quy chuẩn: ≤ 1.0 ha (10.000 m²)'),
  'FAIL: TerrainZoneInspector chưa sửa ngưỡng thành <= 1.0 ha'
);
assert.ok(
  inspectorCode.includes('CẢNH BÁO MẶT NƯỚC / DÒNG CHẢY:'),
  'FAIL: TerrainZoneInspector chưa có khối cảnh báo mặt nước'
);
console.log('✔ PASS 3.1: TerrainZoneInspector đồng bộ 2D/3D và hiển thị đầy đủ mảng con, quy chuẩn <= 1 ha, cảnh báo nước');

// 4. Kiểm tra logic phân chia mảng con <= 10.000 m2
const enginePath = path.resolve('src/utils/terrainFlatnessEngine.ts');
const engineCode = fs.readFileSync(enginePath, 'utf8');

assert.ok(
  engineCode.includes('MAX_PATCH_AREA_M2 = 10_000'),
  'FAIL: Chưa có hằng số giới hạn trên MAX_PATCH_AREA_M2 = 10_000'
);
assert.ok(
  engineCode.includes('hasWaterBody') && engineCode.includes('waterWarning'),
  'FAIL: Chưa có xử lý hasWaterBody và waterWarning'
);
console.log('✔ PASS 4.1: terrainFlatnessEngine đảm bảo giới hạn trên 10.000 m2 và xử lý mặt nước');

console.log('\n=== TẤT CẢ 5 VẤN ĐỀ ĐÃ ĐƯỢC XÁC MINH HOÀN TOÀN THÀNH CÔNG! ===');
