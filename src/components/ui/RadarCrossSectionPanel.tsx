import React, { useMemo, useState } from 'react';
import {
  X,
  Compass,
  Mountain,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const RadarCrossSectionPanel: React.FC = () => {
  const {
    instances,
    selectedInstanceId,
    coverageFields,
    showCrossSection,
    setShowCrossSection,
    selectedAzimuthDeg,
    setSelectedAzimuthDeg,
  } = useTacticalStore();

  const [isExpanded, setIsExpanded] = useState(false);
  const [hoverData, setHoverData] = useState<{
    distKm: number;
    altM: number;
    terrainM?: number;
    status?: string;
  } | null>(null);

  const selectedInst = useMemo(
    () => instances.find((i) => i.instanceId === selectedInstanceId),
    [instances, selectedInstanceId]
  );

  const field = useMemo(
    () => (selectedInstanceId ? coverageFields[selectedInstanceId] : null),
    [coverageFields, selectedInstanceId]
  );

  // Tìm góc Azimuth gần nhất có trong Coverage Field
  const availableAzimuths = useMemo(() => {
    if (!field || !field.azimuthRays) return [];
    return Object.keys(field.azimuthRays)
      .map(Number)
      .sort((a, b) => a - b);
  }, [field]);

  const currentAzimuth = useMemo(() => {
    if (availableAzimuths.length === 0) return selectedAzimuthDeg;
    // Tìm góc gần nhất với selectedAzimuthDeg
    let closest = availableAzimuths[0];
    let minDiff = 360;
    for (const az of availableAzimuths) {
      let diff = Math.abs(az - selectedAzimuthDeg);
      if (diff > 180) diff = 360 - diff;
      if (diff < minDiff) {
        minDiff = diff;
        closest = az;
      }
    }
    return closest;
  }, [availableAzimuths, selectedAzimuthDeg]);

  // Lấy danh sách Ray trên hướng phương vị đã chọn (SINGLE SOURCE OF TRUTH)
  const raysOnAzimuth = useMemo(() => {
    if (!field || !field.azimuthRays) return [];
    return field.azimuthRays[currentAzimuth] || [];
  }, [field, currentAzimuth]);

  if (!showCrossSection || !selectedInst) return null;

  // Tính toán kích thước đồ thị
  const width = isExpanded ? 1100 : 780;
  const height = isExpanded ? 440 : 320;
  const padLeft = 70;
  const padRight = 40;
  const padTop = 30;
  const padBottom = 45;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Xác định khoảng cự ly và độ cao tối đa để scale biểu đồ
  const maxRangeM = field ? field.maxRangeKm * 1000 : 250000;
  const maxAltM = field ? Math.max(30000, field.maxHeightM + 2000) : 32000;

  // Hàm chuyển đổi toạ độ (Khoảng cách m, Cao độ m) -> (x, y trên SVG)
  const toX = (distM: number) => padLeft + (Math.max(0, distM) / maxRangeM) * chartW;
  const toY = (altM: number) => padTop + chartH - (Math.max(0, altM) / maxAltM) * chartH;

  // Lấy đường địa hình trên hướng phương vị này
  const terrainPoints = (raysOnAzimuth[0]?.samples || []).map((s) => ({
    distM: s.distanceM,
    altM: s.terrainAltM,
  }));

  // Tạo path địa hình khép kín
  let terrainPathD = '';
  if (terrainPoints.length > 0) {
    terrainPathD = `M ${toX(0)} ${toY(0)} L ${toX(0)} ${toY(terrainPoints[0].altM)}`;
    terrainPoints.forEach((p) => {
      terrainPathD += ` L ${toX(p.distM)} ${toY(p.altM)}`;
    });
    const lastP = terrainPoints[terrainPoints.length - 1];
    terrainPathD += ` L ${toX(lastP.distM)} ${toY(0)} Z`;
  }

  // Thống kê tia trên hướng này
  const totalRaysOnAz = raysOnAzimuth.length;
  const occludedRaysOnAz = raysOnAzimuth.filter((r) => r.hasOcclusion).length;
  const firstOcclusion = raysOnAzimuth.find((r) => r.hasOcclusion)?.occlusionPoint;

  return (
    <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 backdrop-blur-xl border border-cyan-500/50 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] flex flex-col select-none overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200">
      {/* 1. Header Bảng Mặt Cắt */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900/70 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm"
            style={{
              backgroundColor: `${selectedInst.color}22`,
              borderColor: `${selectedInst.color}66`,
              color: selectedInst.color,
            }}
          >
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Mặt Cắt Quang Tuyến LOS 2D:</span>
                <span style={{ color: selectedInst.color }}>{selectedInst.name}</span>
              </h3>
              <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-500/40 px-2 py-0.5 rounded font-mono font-bold">
                COVERAGE FIELD (100% 3D SYNC)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans">
              Mô phỏng quang tuyến cắt địa hình thực tế theo góc phương vị ấn định.
            </p>
          </div>
        </div>

        {/* Cụm điều khiển góc phương vị Azimuth */}
        <div className="flex items-center gap-3 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Phương vị:</span>
          </span>

          <button
            onClick={() => setSelectedAzimuthDeg(currentAzimuth - 5)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Quay sang trái (-5°)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1 min-w-[70px] justify-center">
            <span className="text-base font-bold font-mono text-cyan-300">
              {currentAzimuth}°
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {currentAzimuth === 0
                ? 'Bắc'
                : currentAzimuth === 90
                ? 'Đông'
                : currentAzimuth === 180
                ? 'Nam'
                : currentAzimuth === 270
                ? 'Tây'
                : ''}
            </span>
          </div>

          <button
            onClick={() => setSelectedAzimuthDeg(currentAzimuth + 5)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Quay sang phải (+5°)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <input
            type="range"
            min="0"
            max="355"
            step="5"
            value={currentAzimuth}
            onChange={(e) => setSelectedAzimuthDeg(parseInt(e.target.value))}
            className="w-28 accent-cyan-400 h-1 bg-slate-800 rounded-lg cursor-pointer ml-2"
            title="Kéo trượt góc phương vị quét"
          />
        </div>

        {/* Nút phóng to / thu nhỏ & đóng */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors"
            title={isExpanded ? 'Thu nhỏ bảng' : 'Phóng to bảng'}
          >
            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setShowCrossSection(false)}
            className="p-1.5 text-slate-400 hover:text-rose-300 rounded hover:bg-rose-950/60 transition-colors"
            title="Đóng bảng mặt cắt"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Thân Biểu Đồ SVG Mặt Cắt */}
      <div className="relative p-2 bg-slate-950/90 flex flex-col items-center">
        {!field ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mb-3" />
            <p className="text-xs">Đang lấy mẫu địa hình và phân tích trường Coverage Field...</p>
          </div>
        ) : (
          <div className="relative overflow-hidden">
            <svg
              width={width}
              height={height}
              className="bg-slate-950 rounded-xl border border-slate-800/80 cursor-crosshair"
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (mouseX >= padLeft && mouseX <= padLeft + chartW && mouseY >= padTop && mouseY <= padTop + chartH) {
                  const distRatio = (mouseX - padLeft) / chartW;
                  const distKm = Math.round((distRatio * maxRangeM) / 1000);
                  const altRatio = 1 - (mouseY - padTop) / chartH;
                  const altM = Math.round(altRatio * maxAltM);

                  // Tìm độ cao địa hình gần nhất
                  const nearestTerrain = terrainPoints.find((p) => Math.abs(p.distM / 1000 - distKm) < 3);

                  setHoverData({
                    distKm,
                    altM,
                    terrainM: nearestTerrain?.altM,
                  });
                } else {
                  setHoverData(null);
                }
              }}
              onMouseLeave={() => setHoverData(null)}
            >
              <defs>
                {/* Gradient nền địa hình núi non */}
                <linearGradient id="terrainGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#334155" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
                </linearGradient>

                {/* Gradient vùng sóng Visible */}
                <linearGradient id="visibleRayGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor={selectedInst.color} stopOpacity="0.45" />
                  <stop offset="100%" stopColor={selectedInst.color} stopOpacity="0.15" />
                </linearGradient>

                {/* Pattern cho vùng mù Shadow */}
                <pattern id="shadowHatch" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="10" stroke="#ef4444" strokeWidth="1.5" strokeOpacity="0.35" />
                </pattern>
              </defs>

              {/* Lưới toạ độ Y (Độ cao: 5km, 10km, 20km, 30km...) */}
              {[0, 5000, 10000, 15000, 20000, 25000, 30000].map((alt) => {
                if (alt > maxAltM) return null;
                const y = toY(alt);
                return (
                  <g key={alt}>
                    <line
                      x1={padLeft}
                      y1={y}
                      x2={padLeft + chartW}
                      y2={y}
                      stroke="#1e293b"
                      strokeDasharray={alt === 0 ? undefined : '3 3'}
                      strokeWidth="1"
                    />
                    <text
                      x={padLeft - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {(alt / 1000).toFixed(0)} km
                    </text>
                  </g>
                );
              })}

              {/* Lưới toạ độ X (Cự ly: 50km, 100km, 150km, 200km...) */}
              {Array.from({ length: Math.floor(maxRangeM / 50000) + 1 }).map((_, idx) => {
                const distKm = idx * 50;
                const distM = distKm * 1000;
                if (distM > maxRangeM) return null;
                const x = toX(distM);
                return (
                  <g key={distKm}>
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + chartH}
                      stroke="#1e293b"
                      strokeDasharray="3 3"
                      strokeWidth="1"
                    />
                    <text
                      x={x}
                      y={padTop + chartH + 16}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {distKm} km
                    </text>
                  </g>
                );
              })}

              {/* C. Vẽ các chùm tia quét LOS từ đài radar */}
              {raysOnAzimuth.map((ray) => {
                const el = ray.elevationDeg;
                if (ray.maxRangeM <= 0) return null;

                const originX = toX(0);
                const originY = toY(field.radarAltM);

                // Điểm cuối Visible
                const sEndVis =
                  ray.samples.find((s) => s.distanceM >= ray.visibleEndM) ||
                  ray.samples[ray.samples.length - 1];

                const visX = toX(ray.visibleEndM);
                const visY = sEndVis ? toY(sEndVis.rayAltM) : originY;

                // Điểm cuối Shadow
                const sEndMax = ray.samples[ray.samples.length - 1];
                const maxX = toX(ray.maxRangeM);
                const maxY = sEndMax ? toY(sEndMax.rayAltM) : originY;

                return (
                  <g key={el}>
                    {/* Đoạn Visible (Xanh / Màu khí tài) */}
                    <line
                      x1={originX}
                      y1={originY}
                      x2={visX}
                      y2={visY}
                      stroke={selectedInst.color}
                      strokeWidth="1.8"
                      strokeOpacity="0.85"
                    />

                    {/* Đoạn Shadow bị che khuất sau vật cản (Đỏ nét đứt) */}
                    {ray.hasOcclusion && (
                      <line
                        x1={visX}
                        y1={visY}
                        x2={maxX}
                        y2={maxY}
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        strokeOpacity="0.7"
                      />
                    )}
                  </g>
                );
              })}

              {/* B. Vẽ lát cắt địa hình núi non (Terrain Polygon & Line) */}
              {terrainPathD && (
                <path d={terrainPathD} fill="url(#terrainGradient)" stroke="#475569" strokeWidth="1.5" />
              )}

              {/* D. Đánh dấu điểm chạm địa hình gây che khuất (Occlusion Pin) */}
              {raysOnAzimuth
                .filter((r) => r.hasOcclusion && r.occlusionPoint)
                .map((r, idx) => {
                  const occ = r.occlusionPoint!;
                  const occX = toX(occ.distanceM);
                  const occY = toY(occ.terrainAltM);
                  return (
                    <g key={idx}>
                      <circle cx={occX} cy={occY} r="4" fill="#ef4444" stroke="#ffffff" strokeWidth="1" />
                    </g>
                  );
                })}

              {/* E. Cột mốc vị trí đài anten tại x=0 */}
              <g>
                <line
                  x1={toX(0)}
                  y1={toY(0)}
                  x2={toX(0)}
                  y2={toY(field.radarAltM)}
                  stroke={selectedInst.color}
                  strokeWidth="3"
                />
                <circle
                  cx={toX(0)}
                  cy={toY(field.radarAltM)}
                  r="5"
                  fill={selectedInst.color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <text
                  x={toX(0) + 8}
                  y={toY(field.radarAltM) - 6}
                  fill={selectedInst.color}
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="sans-serif"
                >
                  {selectedInst.name} [{field.radarAltM}m]
                </text>
              </g>

              {/* Con trỏ Hover hiển thị toạ độ & trạng thái */}
              {hoverData && (
                <g>
                  <line
                    x1={toX(hoverData.distKm * 1000)}
                    y1={padTop}
                    x2={toX(hoverData.distKm * 1000)}
                    y2={padTop + chartH}
                    stroke="#06b6d4"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    strokeOpacity="0.8"
                  />
                  <line
                    x1={padLeft}
                    y1={toY(hoverData.altM)}
                    x2={padLeft + chartW}
                    y2={toY(hoverData.altM)}
                    stroke="#06b6d4"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                    strokeOpacity="0.8"
                  />
                </g>
              )}
            </svg>

            {/* Tooltip nổi khi Hover trên đồ thị */}
            {hoverData && (
              <div
                className="absolute pointer-events-none bg-slate-900/95 border border-cyan-500/60 rounded-lg p-2 text-[11px] font-mono shadow-xl text-slate-200 z-10 space-y-0.5"
                style={{
                  left: `${Math.min(width - 170, Math.max(padLeft, toX(hoverData.distKm * 1000) + 12))}px`,
                  top: `${Math.min(height - 85, Math.max(padTop, toY(hoverData.altM) - 50))}px`,
                }}
              >
                <div className="text-cyan-300 font-bold">Cự ly: {hoverData.distKm} km</div>
                <div className="text-slate-300">Độ cao khảo sát: {hoverData.altM.toLocaleString()} m</div>
                {hoverData.terrainM !== undefined && (
                  <div className="text-emerald-400">Độ cao đất: {hoverData.terrainM} m</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Footer Thống Kê & Chú Thích Quân Sự */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 rounded" style={{ backgroundColor: selectedInst.color }} />
            <span className="text-slate-400">Vùng Nhìn Thấy (Visible)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-1 border-t-2 border-dashed border-rose-500" />
            <span className="text-slate-400">Vùng Mù Sau Vật Cản (Shadow)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span className="text-slate-400">Điểm Chạm Núi Che Khuất</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Mountain className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Địa hình 3D thực tế</span>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          <div>
            Số tia trên hướng {currentAzimuth}°:{' '}
            <strong className="text-cyan-300">{totalRaysOnAz} tia</strong>
          </div>
          <div className="border-l border-slate-800 pl-3">
            Bị núi chắn:{' '}
            <strong className={occludedRaysOnAz > 0 ? 'text-rose-400' : 'text-emerald-400'}>
              {occludedRaysOnAz} tia
            </strong>
          </div>
          {firstOcclusion && (
            <div className="border-l border-slate-800 pl-3 text-amber-300">
              Đỉnh chắn gần nhất:{' '}
              <strong>{(firstOcclusion.distanceM / 1000).toFixed(1)}km</strong> ({firstOcclusion.terrainAltM}m)
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
