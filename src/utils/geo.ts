/**
 * Tính khoảng cách trắc địa giữa 2 điểm toạ độ WGS-84 theo công thức Haversine (km)
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371.0; // Bán kính trái đất tính bằng km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Định dạng toạ độ hiển thị chuẩn quân sự (Độ thập phân hoặc Độ Phút Giây)
 */
export function formatCoordinates(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lon).toFixed(4)}°${lonDir}`;
}

/**
 * Tạo danh sách toạ độ vòng tròn 2D bao quanh tâm
 */
export function generateCircleCoordinates(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  pointsCount = 64
): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  const dByR = radiusKm / 6371.0;
  const latRad = (centerLat * Math.PI) / 180;
  const lonRad = (centerLon * Math.PI) / 180;

  for (let i = 0; i <= pointsCount; i++) {
    const bearing = (i * 2 * Math.PI) / pointsCount;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(dByR) +
        Math.cos(latRad) * Math.sin(dByR) * Math.cos(bearing)
    );
    const pLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dByR) * Math.cos(latRad),
        Math.cos(dByR) - Math.sin(latRad) * Math.sin(pLat)
      );
    coords.push([(pLat * 180) / Math.PI, (pLon * 180) / Math.PI]);
  }
  return coords;
}
