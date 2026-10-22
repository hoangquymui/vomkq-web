import fs from 'node:fs';
import path from 'node:path';

const layer = JSON.parse(fs.readFileSync('public/offline-terrain/layer.json', 'utf8'));

function latLonToTile(lat, lon, zoom) {
  // TMS projection EPSG:4326 for Cesium
  // At zoom 0: 2 tiles horizontally (-180..0, 0..180), 1 tile vertically (-90..90)
  const numX = 2 * (1 << zoom);
  const numY = 1 << zoom;
  const x = Math.floor(((lon + 180) / 360) * numX);
  const y = Math.floor(((lat + 90) / 180) * numY);
  return { x, y };
}

const testCoords = [
  { name: 'Tam Đảo (Vĩnh Phúc)', lat: 21.45, lon: 105.65 },
  { name: 'Hà Nội', lat: 21.0285, lon: 105.8542 },
  { name: 'Tây Sơn (Bình Định)', lat: 13.95, lon: 108.95 },
  { name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
  { name: 'Gia Lai', lat: 13.98, lon: 108.0 },
  { name: 'TP Hồ Chí Minh', lat: 10.8231, lon: 106.6297 },
];

console.log('Testing terrain coverage for coordinates across zoom levels:');
for (const coord of testCoords) {
  console.log(`\n--- ${coord.name} (${coord.lat}, ${coord.lon}) ---`);
  let maxFoundZoom = -1;
  for (let z = 0; z <= 13; z++) {
    const tile = latLonToTile(coord.lat, coord.lon, z);
    const ranges = layer.available[z] || [];
    const inRange = ranges.some(r => tile.x >= r.startX && tile.x <= r.endX && tile.y >= r.startY && tile.y <= r.endY);
    const filePath = path.join('public/offline-terrain', `${z}`, `${tile.x}`, `${tile.y}.terrain`);
    const fileExists = fs.existsSync(filePath);
    if (inRange || fileExists) {
      maxFoundZoom = z;
    }
  }
  console.log(`Max Available Zoom: ${maxFoundZoom}`);
}
