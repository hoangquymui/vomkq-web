import React from 'react';
import {
  X,
  Radar,
  Shield,
  Layers,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import {
  calculateRadarFieldOverlapAndProb,
  calculateConeOfSilenceRadiusKm,
  calculateRadarHorizonDistanceKm,
  calculateNotificationDistances,
} from '../../utils/radarMath';

export const RadarFieldStatsModal: React.FC = () => {
  const {
    instances,
    showRadarFieldModal,
    setShowRadarFieldModal,
    targetHeightMeters,
    coverageResults,
  } = useTacticalStore();

  if (!showRadarFieldModal) return null;

  // Lọc các đài radar cảnh giới và trinh sát tham gia tạo trường
  const radarInstances = instances.filter(
    (i) =>
      i.category === 'RadarCanhGioi' ||
      i.category === 'TramQuanSat' ||
      i.category === 'TenLuaPhongKhong'
  );

  const n = radarInstances.length;
  // Cự ly phát hiện trung bình
  const avgRangeKm =
    n > 0
      ? radarInstances.reduce((sum, r) => sum + r.rangeKm, 0) / n
      : 0;

  // Cự ly độ cao giới hạn dưới giả định D_0 (ở H_mt)
  const d0 = Math.max(50, avgRangeKm * 0.75);
  // Diện tích trường rada (Trang 3, 7): S = 2.6 * D0^2 * n
  const sTruongSqKm = Math.round(2.6 * d0 * d0 * Math.max(1, n));

  // Hệ số trùng lặp K_trl và Xác suất phát hiện P_ph (Trang 4, 7)
  const { kTrl, pPh } = calculateRadarFieldOverlapAndProb(avgRangeKm, d0, 0.78);

  // Tham số cự ly thông báo cho SCH Tên Lửa / Tiêm kích (Trang 9, 11)
  const notifStats = calculateNotificationDistances({
    interceptDistKm: Math.round(avgRangeKm * 0.6),
    targetSpeedMps: 300, // 300 m/s (~1080 km/h - mục tiêu phản lực)
    delayTimeSec: 30,
    readyTimeSec: 45,
    calcTimeSec: 26,
    missileFlightTimeSec: 35,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-cyan-500/50 rounded-2xl shadow-[0_0_40px_rgba(6,182,212,0.3)] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden select-none">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-400">
              <Radar className="w-5 h-5 animate-spin" style={{ animationDuration: '8s' }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>Đánh Giá Chỉ Số Trường Radar Tổng Hợp</span>
                <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded font-mono">
                  GIÁO TRÌNH TÁC CHIẾN
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Mô hình tính toán trường radar, hệ số trùng lặp $K_{'{trl}'}$, xác suất phát hiện $P_{'{ph}'}$ & cự ly thông báo chiến đấu
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowRadarFieldModal(false)}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-300">
          {/* Cụm 4 chỉ số tổng hợp hàng đầu */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block mb-1">
                Số Đài Tạo Trường (n)
              </span>
              <div className="text-2xl font-bold font-mono text-cyan-300">
                {n} <span className="text-xs font-normal text-slate-400">trạm</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block">
                Cự ly TB: {avgRangeKm.toFixed(0)} km
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block mb-1">
                Diện Tích Trường (S)
              </span>
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {sTruongSqKm.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-400">km²</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                S = 2,6 × D₀² × n
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block mb-1">
                Hệ Số Trùng Lặp (K_trl)
              </span>
              <div className="text-2xl font-bold font-mono text-amber-400">
                {kTrl}
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                {kTrl >= 1.5 ? 'Độ tin cậy cao (≥1.5)' : 'Phủ đơn tuyến'}
              </span>
            </div>

            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider block mb-1">
                Xác Suất Phát Hiện (P_ph)
              </span>
              <div className="text-2xl font-bold font-mono text-cyan-300">
                {(pPh * 100).toFixed(1)}%
              </div>
              <span className="text-[10px] text-slate-500 mt-1 block font-mono">
                P_ph = 1 - (1 - P_tb)^K_trl
              </span>
            </div>
          </div>

          {/* Bảng chi tiết từng đài tham gia trường */}
          <div className="bg-slate-950/70 rounded-xl border border-slate-800 overflow-hidden">
            <div className="p-3 bg-slate-900/80 border-b border-slate-800 font-semibold text-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Chi Tiết Tham Số Phủ Sóng & Khu Mù Từng Trạm Radar</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Mục tiêu bay: <strong className="text-cyan-300">{targetHeightMeters}m</strong> AGL
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/40 text-[11px] text-slate-400 font-mono">
                    <th className="p-2.5">TÊN KHÍ TÀI</th>
                    <th className="p-2.5">CAO ĐỘ (ASL / AGL)</th>
                    <th className="p-2.5">TẦM R_MAX</th>
                    <th className="p-2.5">GÓC TÀ (MIN / MAX)</th>
                    <th className="p-2.5 text-amber-300">KHU MÙ ĐỈNH (R_kh)</th>
                    <th className="p-2.5 text-cyan-300">CHÂN TRỜI (D_nt)</th>
                    <th className="p-2.5 text-emerald-400">TỶ LỆ PHỦ (%)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                  {radarInstances.map((inst) => {
                    const cov = coverageResults[inst.instanceId];
                    const coneKm = calculateConeOfSilenceRadiusKm(
                      targetHeightMeters,
                      inst.maxElevationDeg
                    );
                    const horizonKm = calculateRadarHorizonDistanceKm(
                      inst.antennaHeightAGL,
                      targetHeightMeters
                    );

                    const coveragePct = cov ? cov.coverageRatioPercent : 100;

                    return (
                      <tr key={inst.instanceId} className="hover:bg-slate-900/50 transition-colors">
                        <td className="p-2.5 font-sans font-medium text-slate-200 flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: inst.color }}
                          />
                          <span className="truncate max-w-[200px]">{inst.name}</span>
                        </td>
                        <td className="p-2.5 text-slate-300">
                          {inst.altitude}m / {inst.antennaHeightAGL}m
                        </td>
                        <td className="p-2.5 font-bold text-cyan-300">
                          {inst.rangeKm} km
                        </td>
                        <td className="p-2.5 text-slate-400">
                          {inst.minElevationDeg}° → {inst.maxElevationDeg}°
                        </td>
                        <td className="p-2.5 text-amber-400 font-bold">
                          {coneKm.toFixed(2)} km
                        </td>
                        <td className="p-2.5 text-cyan-300">
                          {horizonKm.toFixed(1)} km
                        </td>
                        <td className="p-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              coveragePct >= 80
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40'
                                : coveragePct >= 50
                                ? 'bg-amber-950 text-amber-300 border border-amber-500/40'
                                : 'bg-rose-950 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {coveragePct}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hộp Thông Báo Tác Chiến Cho Tên Lửa & Tiêm Kích */}
          <div className="p-4 bg-slate-950/70 rounded-xl border border-slate-800 flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-amber-950 border border-amber-500/60 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-slate-200 mb-1">
                Yêu Cầu Bảo Đảm Cự Ly Thông Báo Tác Chiến (Trang 9, 11)
              </h4>
              <p className="text-slate-400 text-xs mb-2">
                Tính toán với mục tiêu cơ động vận tốc V_mt = 300 m/s (máy bay phản lực), thời gian giữ chậm tình báo t_chậm = 30s:
              </p>
              <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">CỰ LY THÔNG BÁO XA (D_th.báo xa)</span>
                  <span className="text-base font-bold text-amber-300">
                    {notifStats.notifyEarlyKm} km
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Đảm bảo thời gian mở máy & SSCĐ (45s)
                  </span>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-400 block mb-0.5">CỰ LY THÔNG BÁO CHÍNH XÁC (D_th.báo ch.xác)</span>
                  <span className="text-base font-bold text-cyan-300">
                    {notifStats.notifyAccurateKm} km
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Đảm bảo tính toán phần tử & đạn bay (61s)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60 flex justify-end">
          <button
            onClick={() => setShowRadarFieldModal(false)}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition-colors"
          >
            Đóng bảng
          </button>
        </div>
      </div>
    </div>
  );
};
