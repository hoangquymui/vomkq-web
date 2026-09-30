import * as Cesium from 'cesium';

/**
 * Lấy mẫu địa hình Cesium tối ưu hoá cao độ (High Performance DEM Sampler)
 * 
 * Các điểm tối ưu then chốt:
 * 1. Tra cứu nhanh cấp zoom khả dụng tối đa trên đĩa cứng tại tâm khảo sát (kinh độ, vĩ độ)
 *    thông qua terrainProvider.availability.computeMaximumLevelAtPosition chỉ mất 0.001ms.
 * 2. Xác định ngay cấp zoom tối ưu: Math.max(6, Math.min(targetLevel, maxAvailLevel)).
 *    Nếu đài đặt tại khu vực không có tile cấp cao (vd: Hải Phòng chỉ có cấp 7), hệ thống
 *    lấy mẫu ngay ở cấp 7 mà không tốn thời gian thử cấp 11 -> 10 -> 9 -> 8 làm nghẽn mạng.
 * 3. Tuyệt đối không gọi sampleTerrainMostDetailed trên lưới hàng nghìn điểm vì hàm này
 *    buộc Cesium truy vấn tile cấp 13 cho từng điểm riêng lẻ, gây lỗi HTTP 404/ERR_INSUFFICIENT_RESOURCES.
 * 4. Sử dụng rejectOnTileFail = false để Cesium tự động nội suy hoặc gán 0m cho các điểm ngoài biển/ngoài biên
 *    mà không ném ngoại lệ hay bắt buộc retry tuần tự.
 * 5. Tăng kích thước batch lên 1500 điểm để giảm thiểu Promise/microtask overhead và tối ưu hoá
 *    việc tái sử dụng tile cache trong RAM của Cesium.
 */
export async function sampleTerrainOptimized(
  terrainProvider: Cesium.TerrainProvider | null,
  centerLon: number,
  centerLat: number,
  positions: Cesium.Cartographic[],
  targetLevel: number = 10,
  batchSize: number = 1500
): Promise<number[]> {
  const heights = new Array<number>(positions.length).fill(0);
  if (!terrainProvider || positions.length === 0) {
    return heights;
  }

  // 1. Xác định cấp zoom khả dụng thực tế tại tâm khảo sát
  let optimalLevel = Math.max(6, Math.min(10, targetLevel));
  const providerWithAvail = terrainProvider as unknown as {
    availability?: {
      computeMaximumLevelAtPosition?: (cartographic: Cesium.Cartographic) => number;
    };
  };

  if (
    providerWithAvail.availability &&
    typeof providerWithAvail.availability.computeMaximumLevelAtPosition === 'function'
  ) {
    const centerCarto = Cesium.Cartographic.fromDegrees(centerLon, centerLat);
    const maxAvail = providerWithAvail.availability.computeMaximumLevelAtPosition(centerCarto);
    if (typeof maxAvail === 'number' && maxAvail > 0) {
      optimalLevel = Math.max(6, Math.min(targetLevel, maxAvail));
    }
  }

  // 2. Lấy mẫu từng đợt (batch)
  for (let i = 0; i < positions.length; i += batchSize) {
    const chunk = positions.slice(i, i + batchSize);

    try {
      await Cesium.sampleTerrain(terrainProvider, optimalLevel, chunk, false);
    } catch {
      // Dự phòng duy nhất nếu cấp cao bị lỗi: hạ ngay xuống cấp 6 (phủ kín toàn bộ Việt Nam)
      if (optimalLevel > 6) {
        try {
          await Cesium.sampleTerrain(terrainProvider, 6, chunk, false);
        } catch {
          // Bỏ qua lỗi cục bộ
        }
      }
    }

    for (let j = 0; j < chunk.length; j++) {
      const h = chunk[j].height;
      heights[i + j] = h !== undefined && !isNaN(h) && isFinite(h) ? Math.max(0, h) : 0;
    }

    // Nhường nhẹ luồng xử lý (yield) nếu còn đợt tiếp theo
    if (i + batchSize < positions.length) {
      await new Promise((resolve) => setTimeout(resolve, 4));
    }
  }

  return heights;
}
