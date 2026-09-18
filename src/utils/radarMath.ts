/**
 * Các công thức toán học & vật lý radar chuyên dụng
 * Được tổng hợp và kiểm chứng từ giáo trình / tài liệu kỹ thuật tác chiến radar quân sự
 */

export const EARTH_RADIUS_METERS = 6371000; // Bán kính Trái Đất chuẩn (m)
export const DEFAULT_K_FACTOR = 4 / 3; // Hệ số khúc xạ khí quyển chuẩn k = 4/3

/**
 * 1. Tính độ sụt do độ cong Trái Đất có xét khúc xạ khí quyển (hz)
 * Công thức (Trang 17): hz = D^2 / (2 * R_td)
 * @param distanceMeters Cự ly ngang D (mét)
 * @param kFactor Hệ số khúc xạ khí quyển (mặc định 4/3)
 */
export function calculateEarthBulgeMeters(
  distanceMeters: number,
  kFactor: number = DEFAULT_K_FACTOR
): number {
  const rEquiv = EARTH_RADIUS_METERS * kFactor;
  return (distanceMeters * distanceMeters) / (2 * rEquiv);
}

/**
 * 2. Tính độ cao của tia sóng radar tại cự ly r (m)
 * h_ray(r) = h_radar + r * tan(phi) - r^2 / (2 * k * Re)
 * @param radarAltMeters Độ cao anten so với mực nước biển (ASL + AGL) (m)
 * @param elevationRad Góc tà của tia sóng (radian)
 * @param distanceMeters Cự ly từ đài đến điểm khảo sát (m)
 * @param kFactor Hệ số khúc xạ (mặc định 4/3)
 */
export function calculateRayHeightMeters(
  radarAltMeters: number,
  elevationRad: number,
  distanceMeters: number,
  kFactor: number = DEFAULT_K_FACTOR
): number {
  const earthBulge = calculateEarthBulgeMeters(distanceMeters, kFactor);
  return radarAltMeters + distanceMeters * Math.tan(elevationRad) - earthBulge;
}

/**
 * 3. Tính góc che khuất do chướng ngại vật (đỉnh núi) tại cự ly L (m)
 * Công thức (Trang 16): tan(alpha_ck) = (H_ck - h_radar + hz) / L
 * @param radarAltMeters Độ cao anten đài radar (ASL + AGL) (m)
 * @param obstacleAltMeters Độ cao đỉnh vật cản (ASL) (m)
 * @param distanceMeters Cự ly từ đài đến vật cản (m)
 * @param kFactor Hệ số khúc xạ
 * @returns Góc che khuất (radian)
 */
export function calculateObstacleMaskingAngleRad(
  radarAltMeters: number,
  obstacleAltMeters: number,
  distanceMeters: number,
  kFactor: number = DEFAULT_K_FACTOR
): number {
  if (distanceMeters <= 0) return 0;
  const hz = calculateEarthBulgeMeters(distanceMeters, kFactor);
  const deltaH = obstacleAltMeters - radarAltMeters + hz;
  return Math.atan2(deltaH, distanceMeters);
}

/**
 * Đổi góc radian sang phút góc (')
 * (1 rad = 180 * 60 / PI ≈ 3437.75')
 */
export function radToArcMinutes(rad: number): number {
  return (rad * 180 * 60) / Math.PI;
}

/**
 * 4. Tính bán kính khu mù đỉnh đầu của đài radar (Cone of Silence)
 * Công thức (Trang 1): R_kh_mù = H_mt * cotg(eps_max)
 * @param targetHeightMeters Độ cao mục tiêu bay H_mt (m)
 * @param maxElevationDeg Góc tà mép trên cánh sóng eps_max (độ)
 * @returns Bán kính khu mù đỉnh đầu (km)
 */
export function calculateConeOfSilenceRadiusKm(
  targetHeightMeters: number,
  maxElevationDeg: number
): number {
  if (maxElevationDeg <= 0 || maxElevationDeg >= 90) return 0;
  const maxElevRad = (maxElevationDeg * Math.PI) / 180;
  // cot(x) = 1 / tan(x)
  const cot = 1 / Math.tan(maxElevRad);
  const radiusMeters = targetHeightMeters * cot;
  return radiusMeters / 1000;
}

/**
 * 5. Tính cự ly nhìn thẳng vô tuyến (Radar Horizon) theo độ cao mục tiêu (km)
 * Công thức (Trang 17): D_nt = 4.12 * (sqrt(h_a) + sqrt(H_mt))
 * @param antennaHeightAGL Độ cao tháp anten so với mặt đất (m)
 * @param targetHeightMeters Độ cao mục tiêu bay (m)
 */
export function calculateRadarHorizonDistanceKm(
  antennaHeightAGL: number,
  targetHeightMeters: number
): number {
  const ha = Math.max(0, antennaHeightAGL);
  const hmt = Math.max(0, targetHeightMeters);
  return 4.12 * (Math.sqrt(ha) + Math.sqrt(hmt));
}

/**
 * 6. Kiểm tra một điểm mục tiêu tại (cự ly r, độ cao H_mt) có bị che khuất không
 * @param radarAltMeters Độ cao tâm phát đài radar (m)
 * @param targetHeightMeters Độ cao mục tiêu (m)
 * @param distanceMeters Cự ly từ đài đến mục tiêu (m)
 * @param maskingAngleRad Góc che khuất lớn nhất của rặng núi phía trước (rad)
 * @param minElevationRad Góc tà nhỏ nhất của đài (rad)
 * @param maxElevationRad Góc tà lớn nhất của đài (rad)
 * @param kFactor Hệ số khúc xạ
 */
export function isTargetVisible(
  radarAltMeters: number,
  targetHeightMeters: number,
  distanceMeters: number,
  maskingAngleRad: number,
  minElevationRad: number,
  maxElevationRad: number,
  kFactor: number = DEFAULT_K_FACTOR
): { isVisible: boolean; reason?: 'cone_of_silence' | 'terrain_blocked' | 'below_min_elev' | 'over_horizon' } {
  if (distanceMeters <= 0) return { isVisible: true };

  // Góc tà hình học từ đài đến mục tiêu (có tính độ cong Trái Đất hz)
  const hz = calculateEarthBulgeMeters(distanceMeters, kFactor);
  const targetElevRad = Math.atan2(targetHeightMeters - radarAltMeters + hz, distanceMeters);

  // 1. Kiểm tra khu mù đỉnh đầu (góc nâng lớn hơn góc tà max)
  if (targetElevRad > maxElevationRad) {
    return { isVisible: false, reason: 'cone_of_silence' };
  }

  // 2. Kiểm tra dưới góc tà min của cánh sóng
  if (targetElevRad < minElevationRad) {
    return { isVisible: false, reason: 'below_min_elev' };
  }

  // 3. Kiểm tra rặng núi chắn sóng (góc tà mục tiêu nhỏ hơn góc che khuất tích lũy)
  if (targetElevRad < maskingAngleRad) {
    return { isVisible: false, reason: 'terrain_blocked' };
  }

  return { isVisible: true };
}

/**
 * 7. Tính hệ số trùng lặp trường rada (K_trl) và xác suất phát hiện (P_ph)
 * Công thức (Trang 4, 7):
 * K_trl = 1.2 * (D_H / D_0)^2
 * P_ph = 1 - (1 - P_tb)^K_trl
 * @param dH Cự ly phát hiện của trường radar ở độ cao ấn định (km)
 * @param d0 Cự ly phát hiện ở độ cao giới hạn dưới (km)
 * @param pTb Xác suất phát hiện trung bình (mặc định 0.75)
 */
export function calculateRadarFieldOverlapAndProb(
  dH: number,
  d0: number,
  pTb: number = 0.75
): { kTrl: number; pPh: number } {
  if (d0 <= 0) return { kTrl: 1.0, pPh: pTb };
  const ratio = dH / d0;
  const kTrl = 1.2 * (ratio * ratio);
  // P_ph = 1 - (1 - P_tb)^K_trl
  const pPh = 1 - Math.pow(1 - pTb, kTrl);
  return {
    kTrl: Number(kTrl.toFixed(2)),
    pPh: Number(Math.min(0.999, Math.max(0, pPh)).toFixed(3)),
  };
}

/**
 * 8. Tính cự ly thông báo xa & thông báo chính xác (Trang 9, 11)
 * Phục vụ tham mưu tác chiến cho Tên lửa phòng không / Pháo / Tiêm kích
 */
export function calculateNotificationDistances(params: {
  interceptDistKm: number; // D_đánh_chặn (km)
  targetSpeedMps: number; // V_mt (m/s)
  delayTimeSec?: number; // t_giữ_chậm (s) mặc định 30s
  readyTimeSec?: number; // t_SSCĐ (s) mặc định 45s
  calcTimeSec?: number; // t_tính_toán (s) mặc định 26s
  missileFlightTimeSec?: number; // t_bay của đạn (s) mặc định 35s
}): { notifyEarlyKm: number; notifyAccurateKm: number } {
  const {
    interceptDistKm,
    targetSpeedMps,
    delayTimeSec = 30,
    readyTimeSec = 45,
    calcTimeSec = 26,
    missileFlightTimeSec = 35,
  } = params;

  // V_mt tính ra km/s
  const vKmS = targetSpeedMps / 1000;

  const notifyEarlyKm = interceptDistKm + vKmS * (delayTimeSec + readyTimeSec);
  const notifyAccurateKm = interceptDistKm + vKmS * (delayTimeSec + calcTimeSec + missileFlightTimeSec);

  return {
    notifyEarlyKm: Math.round(notifyEarlyKm),
    notifyAccurateKm: Math.round(notifyAccurateKm),
  };
}

/**
 * 9. Nội suy cự ly phát hiện tối đa từ Coverage Profile theo góc tà
 * Đảm bảo góc ngoài phạm vi [minElevationDeg, maxElevationDeg] có cự ly = 0
 */
export function getProfileMaxRange(
  profile: import('../types/radarCoverage').CoverageProfile | undefined,
  elevationDeg: number,
  fallbackRangeKm: number = 200
): number {
  if (!profile || !profile.points || profile.points.length === 0) {
    return fallbackRangeKm;
  }

  // Góc nằm ngoài biên cho phép của profile -> Không có vùng phủ sóng
  if (
    elevationDeg < profile.minElevationDeg - 0.001 ||
    elevationDeg > profile.maxElevationDeg + 0.001
  ) {
    return 0;
  }

  const pts = profile.points;
  if (elevationDeg <= pts[0].elevationDeg) {
    return pts[0].maxRangeKm;
  }
  if (elevationDeg >= pts[pts.length - 1].elevationDeg) {
    return pts[pts.length - 1].maxRangeKm;
  }

  // Tìm đoạn chứa elevationDeg và nội suy tuyến tính
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    if (elevationDeg >= p1.elevationDeg && elevationDeg <= p2.elevationDeg) {
      const deltaElev = p2.elevationDeg - p1.elevationDeg;
      if (deltaElev <= 0) return p1.maxRangeKm;
      const t = (elevationDeg - p1.elevationDeg) / deltaElev;
      const range = p1.maxRangeKm + t * (p2.maxRangeKm - p1.maxRangeKm);
      return Math.max(0, range);
    }
  }

  return fallbackRangeKm;
}

/**
 * 10. Chuyển đổi mã màu Hex sang HSL
 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  let cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  const num = parseInt(cleanHex, 16) || 0;
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/**
 * 11. Tạo màu chiến thuật quân sự theo chuẩn:
 * - Khi chưa chọn: Giữ Hue và độ sáng gốc của khí tài, không dùng gradient để tránh hỗn tạp đa đài
 * - Khi chọn một đài: Giữ Hue, ánh xạ độ cao vào Brightness (Height -> Lightness), Opacity cho Visible/Shadow
 * Tuyệt đối không dùng dải màu cầu vồng (rainbow).
 */
export function getCoverageFieldColor(
  baseHex: string,
  heightM: number,
  minHeightM: number,
  maxHeightM: number,
  isShadow: boolean,
  isSelected: boolean
): { css: string; alpha: number; hex: string } {
  const { h, s, l } = hexToHsl(baseHex);

  if (!isSelected) {
    // Chế độ mặc định: Không gradient độ cao, giữ màu riêng của khí tài
    if (isShadow) {
      const shadowLightness = Math.max(8, Math.round(l * 0.45));
      return {
        css: `hsla(${h}, ${s}%, ${shadowLightness}%, 0.08)`,
        alpha: 0.08,
        hex: baseHex,
      };
    }
    return {
      css: `hsla(${h}, ${s}%, ${l}%, 0.25)`,
      alpha: 0.25,
      hex: baseHex,
    };
  }

  // Chế độ đài được chọn: Giữ nguyên Hue, ánh xạ Height vào Brightness
  const heightSpan = Math.max(1, maxHeightM - minHeightM);
  const normHeight = Math.max(0, Math.min(1, (heightM - minHeightM) / heightSpan));

  if (isShadow) {
    // Vùng Shadow: Độ sáng thấp hơn (12% -> 35%), alpha mờ
    const shadowL = Math.round(12 + normHeight * 25);
    return {
      css: `hsla(${h}, ${Math.max(20, s * 0.6)}%, ${shadowL}%, 0.12)`,
      alpha: 0.12,
      hex: baseHex,
    };
  }

  // Vùng Visible: Độ sáng ánh xạ từ 25% (tối ở chân địa hình) đến 78% (sáng ở đỉnh trần)
  const visibleL = Math.round(25 + normHeight * 53);
  return {
    css: `hsla(${h}, ${s}%, ${visibleL}%, 0.35)`,
    alpha: 0.35,
    hex: baseHex,
  };
}

