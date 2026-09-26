import React, { useMemo, useState } from 'react';
import {
  X,
  Compass,
  Mountain,
  ChevronLeft,
  ChevronRight,
  Minus,
  ChevronUp,
  Crosshair,
  MapPin,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { destinationPoint } from '../../utils/radarLosEngine';
import {
  calculateSamPearMaxRange,
  calculateSamDeadConeRadius,
  type SamEngagementMode,
} from '../../utils/missileVolumeEngine';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';

export const RadarCrossSectionPanel: React.FC = () => {
  const {
    instances,
    selectedInstanceId,
    coverageFields,
    showCrossSection,
    setShowCrossSection,
    selectedAzimuthDeg,
    setSelectedAzimuthDeg,
    samVolumes,
    samEngagementModes,
    setSamEngagementMode,
    crossSectionProbePoint,
    setCrossSectionProbePoint,
    clearCrossSectionProbePoint,
  } = useTacticalStore();

  const [isMinimized, setIsMinimized] = useState(false);
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

  const isSam = selectedInst?.category === 'TenLuaPhongKhong';

  const field = useMemo(
    () => (selectedInstanceId && !isSam ? coverageFields[selectedInstanceId] : null),
    [coverageFields, selectedInstanceId, isSam]
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

  // Lấy danh sách Ray trên hướng phương vị đã chọn (đối với Radar)
  const raysOnAzimuth = useMemo(() => {
    if (!field || !field.azimuthRays) return [];
    return field.azimuthRays[currentAzimuth] || [];
  }, [field, currentAzimuth]);

  // === DỮ LIỆU ĐẶC THÙ CHO SAM ===
  const samVolume = useMemo(
    () => (selectedInst && isSam ? samVolumes[selectedInst.instanceId] : null),
    [samVolumes, selectedInst, isSam]
  );

  const activeSamMode: SamEngagementMode = useMemo(() => {
    if (!selectedInst) return 'head_on';
    return (
      selectedInst.samEngagementMode ||
      samEngagementModes[selectedInst.instanceId] ||
      'head_on'
    );
  }, [selectedInst, samEngagementModes]);

  const samTmpl = useMemo(
    () => (selectedInst ? EQUIPMENT_TEMPLATES.find((t) => t.id === selectedInst.templateId) : null),
    [selectedInst]
  );

  const samProfile = useMemo(() => {
    if (!selectedInst || !isSam) return null;
    return (selectedInst.samProfiles || samTmpl?.samProfiles)?.[activeSamMode];
  }, [selectedInst, isSam, samTmpl, activeSamMode]);

  const samDMaxKm = samProfile?.dMaxKm || selectedInst?.rangeKm || samTmpl?.defaultRangeKm || 35.4;
  const samDMinKm = samProfile?.dMinKm || selectedInst?.minEngagementRangeKm || samTmpl?.minEngagementRangeKm || 3.5;
  const samHMaxM = samProfile?.hMaxM || selectedInst?.maxEngagementAltitudeM || samTmpl?.maxEngagementAltitudeM || 25000;
  const samHMinM = samProfile?.hMinM || selectedInst?.minEngagementAltitudeM || samTmpl?.minEngagementAltitudeM || 20;
  const samHOptM = selectedInst?.optimalAltitudeM || samTmpl?.optimalAltitudeM || Math.round(samHMaxM * 0.35);
  const samVMps = samProfile?.vMaxMps || selectedInst?.maxTargetSpeedMps || samTmpl?.maxTargetSpeedMps || 900;
  const samPGhKm = samProfile?.pGhKm || selectedInst?.maxTargetParamKm || samTmpl?.maxTargetParamKm || 25.0;

  if (!showCrossSection || !selectedInst) return null;

  // Nếu người dùng chọn CỰC TIỂU HÓA để quan sát toàn cảnh màn hình 3D
  if (isMinimized) {
    return (
      <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 backdrop-blur-xl border border-cyan-500/60 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.85)] flex items-center gap-3 px-3.5 py-2 select-none animate-in fade-in slide-in-from-bottom-3 duration-200">
        {/* Icon & Tên khí tài */}
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center border shadow-sm shrink-0"
          style={{
            backgroundColor: `${selectedInst.color}22`,
            borderColor: `${selectedInst.color}66`,
            color: selectedInst.color,
          }}
        >
          {isSam ? <Crosshair className="w-3.5 h-3.5" /> : <Compass className="w-3.5 h-3.5" />}
        </div>

        <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
          <span className="text-xs font-bold text-slate-200">{selectedInst.name}</span>
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${
              isSam
                ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                : 'bg-cyan-950 text-cyan-300 border-cyan-500/40'
            }`}
          >
            {isSam ? 'SAM WEZ 2D' : 'LOS 2D'}
          </span>
        </div>

        {/* Cụm điều khiển phương vị nhanh */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
          <Compass className="w-3 h-3 text-cyan-400" />
          <span className="text-[11px] text-slate-400 font-mono">Phương vị:</span>
          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth - 5 + 360) % 360)}
            className="p-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
            title="Quay trái (-5°)"
          >
            <ChevronLeft className="w-3 h-3" />
          </button>
          <span className="font-bold font-mono text-cyan-300 min-w-[36px] text-center">
            {currentAzimuth}°
          </span>
          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth + 5) % 360)}
            className="p-0.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
            title="Quay phải (+5°)"
          >
            <ChevronRight className="w-3 h-3" />
          </button>
        </div>

        {/* Điểm ghim 3D (nếu có điểm được chấm) */}
        {crossSectionProbePoint &&
          crossSectionProbePoint.instanceId === selectedInst.instanceId && (
            <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-500/70 px-2.5 py-1 rounded-lg text-[11px] font-mono text-amber-300 shadow-sm">
              <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Điểm 3D: <strong className="text-white">{crossSectionProbePoint.distKm}km</strong> • <strong className="text-white">{crossSectionProbePoint.altM.toLocaleString('vi-VN')}m</strong> ({crossSectionProbePoint.azimuthDeg}°)
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCrossSectionProbePoint();
                }}
                className="p-0.5 hover:bg-amber-400/20 rounded text-amber-400 hover:text-white transition-colors ml-1"
                title="Bỏ ghim điểm 3D này"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

        {/* Cụm nút mở lại biểu đồ & Đóng */}
        <div className="flex items-center gap-1 pl-1">
          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-cyan-950 hover:bg-cyan-900/90 text-cyan-300 border border-cyan-500/50 rounded-lg transition-all shadow-sm"
            title="Mở lại biểu đồ mặt cắt đứng đầy đủ"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            <span>Mở lại biểu đồ</span>
          </button>
          <button
            onClick={() => setShowCrossSection(false)}
            className="p-1.5 text-slate-400 hover:text-rose-300 rounded hover:bg-rose-950/60 transition-colors"
            title="Đóng bảng mặt cắt (Điểm ghim 3D vẫn được lưu giữ)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  // Kích thước đồ thị chuẩn
  const width = 800;
  const height = 340;
  const padLeft = 70;
  const padRight = 45;
  const padTop = 32;
  const padBottom = 48;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Xác định khoảng cự ly và độ cao tối đa để scale biểu đồ
  const maxRangeM = isSam
    ? Math.max(samDMaxKm * 1000 * 1.15, 30000)
    : field
    ? field.maxRangeKm * 1000
    : 250000;

  const maxAltM = isSam
    ? Math.max(samHMaxM * 1.15, 12000)
    : field
    ? Math.max(30000, field.maxHeightM + 2000)
    : 32000;

  // Hàm chuyển đổi toạ độ (Khoảng cách m, Cao độ m) -> (x, y trên SVG)
  const toX = (distM: number) => padLeft + (Math.max(0, distM) / maxRangeM) * chartW;
  const toY = (altM: number) => padTop + chartH - (Math.max(0, altM) / maxAltM) * chartH;

  // Đường cắt địa hình núi non (Terrain Profile)
  const terrainPoints = raysOnAzimuth.length > 0
    ? (raysOnAzimuth[0]?.samples || []).map((s) => ({
        distM: s.distanceM,
        altM: s.terrainAltM,
      }))
    : [];

  let terrainPathD = '';
  if (terrainPoints.length > 0) {
    terrainPathD = `M ${toX(0)} ${toY(0)} L ${toX(0)} ${toY(terrainPoints[0].altM)}`;
    terrainPoints.forEach((p) => {
      terrainPathD += ` L ${toX(p.distM)} ${toY(p.altM)}`;
    });
    const lastP = terrainPoints[terrainPoints.length - 1];
    terrainPathD += ` L ${toX(lastP.distM)} ${toY(0)} Z`;
  }

  // === DỰNG CÁC ĐƯỜNG CONG QUẢ LÊ HỎA LỰC SAM (WEZ 2D) ===
  const numPearSteps = 35;
  const samPearPoints: {
    altM: number;
    dMinM: number;
    dOptM: number;
    dHighM: number;
    dMaxM: number;
    dEffM: number;
  }[] = [];

  if (isSam) {
    const centerAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 6);
    const dMaxM = samDMaxKm * 1000;
    const minElevDeg = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 6.0;
    const maxElevDeg = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
    const cotMinElev = 1 / Math.tan((minElevDeg * Math.PI) / 180);

    for (let s = 0; s <= numPearSteps; s++) {
      const deltaH = (s / numPearSteps) * samHMaxM;
      const altM = centerAltM + deltaH;
      const dInner = calculateSamDeadConeRadius(altM, centerAltM, maxElevDeg);

      let dNom = 0;
      if (deltaH > 0) {
        const launchLimitM = Math.round(deltaH * cotMinElev);
        const aeroMaxM = calculateSamPearMaxRange(deltaH, dMaxM, 0, samHMaxM, samHOptM);
        dNom = Math.min(aeroMaxM, launchLimitM);
        dNom = Math.max(dInner, dNom);
      }

      // Lấy cự ly hiệu dụng sau địa hình nếu có volume
      let dEff = dNom;
      if (samVolume && samVolume.effectiveRanges && deltaH > 0) {
        let bestB = 0;
        let minSpan = 999999;
        for (let b = 0; b < samVolume.altitudeBands.length; b++) {
          const span = Math.abs(samVolume.altitudeBands[b] - altM);
          if (span < minSpan) {
            minSpan = span;
            bestB = b;
          }
        }
        let bestAz = 0;
        let minAzSpan = 999;
        for (let j = 0; j < samVolume.azimuthSamples.length; j++) {
          let diff = Math.abs(samVolume.azimuthSamples[j] - currentAzimuth);
          if (diff > 180) diff = 360 - diff;
          if (diff < minAzSpan) {
            minAzSpan = diff;
            bestAz = j;
          }
        }
        dEff = samVolume.effectiveRanges[bestB]?.[bestAz] ?? dNom;
      }

      samPearPoints.push({
        altM,
        dMinM: dInner,
        dOptM: Math.max(dInner, Math.round(dNom * 0.7)),
        dHighM: Math.max(dInner, Math.round(dNom * 0.85)),
        dMaxM: dNom,
        dEffM: Math.min(dNom, dEff),
      });
    }
  }

  // Dựng SVG Path cho vòm hỏa lực SAM (1 lớp tầm tối đa D_max) và Nón mù đỉnh đầu:
  let samOuterPathD = '';
  let samDeadConePathD = '';

  if (isSam && samPearPoints.length > 0) {
    // Vòm Hỏa Lực Tầm Tối Đa (Outer Boundary): bắt đầu từ tâm (0, centerAlt)
    samOuterPathD = `M ${toX(samPearPoints[0].dMinM)} ${toY(samPearPoints[0].altM)}`;
    for (let i = 1; i < samPearPoints.length; i++) {
      samOuterPathD += ` L ${toX(samPearPoints[i].dMinM)} ${toY(samPearPoints[i].altM)}`;
    }
    const lastP = samPearPoints[samPearPoints.length - 1];
    samOuterPathD += ` L ${toX(lastP.dMaxM)} ${toY(lastP.altM)}`;
    for (let i = samPearPoints.length - 2; i >= 0; i--) {
      samOuterPathD += ` L ${toX(samPearPoints[i].dMaxM)} ${toY(samPearPoints[i].altM)}`;
    }
    samOuterPathD += ' Z';

    // Nón Mù Cực Cận Đỉnh Đầu (Hình nón từ 0,0 lên 65°):
    samDeadConePathD = `M ${toX(0)} ${toY(samPearPoints[0].altM)} L ${toX(0)} ${toY(lastP.altM)} L ${toX(lastP.dMinM)} ${toY(lastP.altM)}`;
    for (let i = samPearPoints.length - 2; i >= 0; i--) {
      samDeadConePathD += ` L ${toX(samPearPoints[i].dMinM)} ${toY(samPearPoints[i].altM)}`;
    }
    samDeadConePathD += ` L ${toX(0)} ${toY(samPearPoints[0].altM)} Z`;
  }

  // Thống kê tia / vật cản
  const totalRaysOnAz = raysOnAzimuth.length;
  const occludedRaysOnAz = raysOnAzimuth.filter((r) => r.hasOcclusion).length;
  const firstOcclusion = raysOnAzimuth.find((r) => r.hasOcclusion)?.occlusionPoint;

  // Hàm đánh giá trạng thái quân sự của điểm khảo sát (dùng chung cho hover và click chấm điểm)
  const evaluatePointStatus = (distKm: number, altM: number, terrainM?: number): string => {
    const distM = distKm * 1000;
    if (terrainM !== undefined && altM <= terrainM) {
      return 'Dưới mặt đất / Địa hình';
    }

    if (isSam && selectedInst) {
      const centerAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 6);
      const deltaH = Math.max(0, altM - centerAltM);
      const dMaxAtH = calculateSamPearMaxRange(deltaH, samDMaxKm * 1000, 0, samHMaxM, samHOptM);
      const maxEl = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
      const minEl = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 6.0;
      const dMinAtH = calculateSamDeadConeRadius(altM, centerAltM, maxEl);
      const cotMinElev = 1 / Math.tan((minEl * Math.PI) / 180);
      const dLaunchLimitM = Math.round(deltaH * cotMinElev);

      if (altM < samHMinM) return `Dưới sàn hỏa lực H_min (${samHMinM}m)`;
      if (altM > samHMaxM) return `Vượt trần hỏa lực H_max (${(samHMaxM / 1000).toFixed(0)}km)`;
      if (distM < dMinAtH) return `Nằm trong nón mù đỉnh đầu (${maxEl}°)`;
      if (deltaH > 0 && distM > dLaunchLimitM) return `Dưới góc ngẩng bệ phóng (${minEl}°)`;
      if (distM <= dMaxAtH) return 'Trong Vùng Tiêu Diệt (100% D_max)';
      return 'Ngoài vùng hỏa lực';
    } else if (selectedInst) {
      const radarAltM = (selectedInst.altitude || 0) + (selectedInst.antennaHeightAGL || 15);
      const angleRad = Math.atan2(altM - radarAltM, distM);
      const angleDeg = (angleRad * 180) / Math.PI;
      const minEl = selectedInst.minElevationDeg !== undefined ? selectedInst.minElevationDeg : 0.5;
      const maxEl = selectedInst.maxElevationDeg !== undefined ? selectedInst.maxElevationDeg : 65.0;
      const maxRange = (selectedInst.rangeKm || 150) * 1000;

      if (angleDeg < minEl) return `Dưới góc tà tối thiểu (${minEl}°)`;
      if (angleDeg > maxEl) return `Trên góc tà tối đa (Nón mù ${maxEl}°)`;
      if (distM > maxRange) return `Vượt cự ly trinh sát (${(maxRange / 1000).toFixed(0)}km)`;

      let isBlocked = false;
      if (terrainPoints.length > 0) {
        for (const tp of terrainPoints) {
          if (tp.distM > 0 && tp.distM < distM) {
            const rayH = radarAltM + (altM - radarAltM) * (tp.distM / distM);
            if (rayH < tp.altM) {
              isBlocked = true;
              break;
            }
          }
        }
      }
      return isBlocked ? 'Bị che khuất bởi địa hình' : 'Trong Vùng Trinh Sát (LOS Rõ)';
    }
    return 'Khảo sát ngoài tầm';
  };

  return (
    <aside className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-950/95 backdrop-blur-xl border border-cyan-500/50 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.85)] flex flex-col select-none overflow-hidden animate-in fade-in slide-in-from-bottom-6 duration-200">
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
            {isSam ? <Crosshair className="w-4 h-4" /> : <Compass className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>{isSam ? 'Mặt Cắt Đứng Vùng Hỏa Lực SAM (WEZ 2D):' : 'Mặt Cắt Quang Tuyến LOS 2D:'}</span>
                <span style={{ color: selectedInst.color }}>{selectedInst.name}</span>
              </h3>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                  isSam
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : 'bg-cyan-950 text-cyan-300 border-cyan-500/40'
                }`}
              >
                {isSam ? 'SAM WEZ PECHORA (VÒM TẦM TỐI ĐA)' : 'COVERAGE FIELD (100% 3D SYNC)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans">
              {isSam
                ? `Biên dạng quả lê khí động học có xét trần bắn ${samHMaxM / 1000}km, cự ly đón/đuổi và nón mù đỉnh đầu.`
                : 'Mô phỏng quang tuyến cắt địa hình thực tế theo góc phương vị ấn định.'}
            </p>
          </div>
        </div>

        {/* Thanh chọn chế độ bắn chuyên biệt cho SAM */}
        {isSam && (
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800/80">
            {(
              [
                { id: 'head_on', label: 'Bắn đón', shortLabel: 'Đón' },
                { id: 'tail_chase', label: 'Bắn đuổi', shortLabel: 'Đuổi' },
                { id: 'jamming_passive', label: 'Nhiễu tiêu cực', shortLabel: 'Nhiễu-TC' },
                { id: 'jamming_active', label: 'Nhiễu tích cực', shortLabel: 'Nhiễu-TK' },
                { id: 'tbk_optical', label: 'Quang học TBK', shortLabel: 'TBK' },
              ] as const
            ).map((m) => {
              const isActive = activeSamMode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setSamEngagementMode(selectedInst.instanceId, m.id)}
                  title={m.label}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-lg transition-all ${
                    isActive
                      ? 'bg-rose-600 text-white font-bold shadow-md shadow-rose-950/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  {m.shortLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Cụm điều khiển góc phương vị Azimuth */}
        <div className="flex items-center gap-3 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
          <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span>Phương vị:</span>
          </span>

          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth - 5 + 360) % 360)}
            className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 transition-colors"
            title="Quay sang trái (-5°)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1 min-w-[65px] justify-center">
            <span className="text-base font-bold font-mono text-cyan-300">
              {currentAzimuth}°
            </span>
          </div>

          <button
            onClick={() => setSelectedAzimuthDeg((currentAzimuth + 5) % 360)}
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
            className="w-24 accent-cyan-400 h-1 bg-slate-800 rounded-lg cursor-pointer ml-1"
            title="Kéo trượt góc phương vị quét"
          />
        </div>

        {/* Chỉ báo điểm ghim 3D (nếu có điểm được chấm) */}
        {crossSectionProbePoint &&
          crossSectionProbePoint.instanceId === selectedInst.instanceId && (
            <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-500/70 px-2.5 py-1 rounded-xl text-[11px] font-mono text-amber-300 shadow-md">
              <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Đã ghim 3D: <strong className="text-white">{crossSectionProbePoint.distKm}km</strong> • <strong className="text-white">{crossSectionProbePoint.altM.toLocaleString('vi-VN')}m</strong> ({crossSectionProbePoint.azimuthDeg}°)
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  clearCrossSectionProbePoint();
                }}
                className="p-0.5 hover:bg-amber-400/20 rounded text-amber-400 hover:text-white transition-colors ml-1"
                title="Bỏ ghim điểm khảo sát 3D này"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

        {/* Nút Cực tiểu hóa (Thu gọn để quan sát 3D) & Đóng */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsMinimized(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-medium text-slate-300 hover:text-cyan-300 bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/50 rounded-lg transition-all shadow-sm cursor-pointer"
            title="Cực tiểu hóa bảng mặt cắt (Thu gọn để quan sát màn hình 3D)"
          >
            <Minus className="w-3.5 h-3.5 text-cyan-400" />
            <span>Cực tiểu hóa</span>
          </button>
          <button
            onClick={() => setShowCrossSection(false)}
            className="p-1.5 text-slate-400 hover:text-rose-300 rounded-lg hover:bg-rose-950/60 transition-colors cursor-pointer"
            title="Đóng bảng mặt cắt (Điểm ghim 3D vẫn được giữ nguyên)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Thân Biểu Đồ SVG Mặt Cắt */}
      <div className="relative p-2 bg-slate-950/90 flex flex-col items-center">
        {!field && !isSam ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin mb-3" />
            <p className="text-xs">Đang lấy mẫu địa hình và phân tích trường Coverage Field...</p>
          </div>
        ) : (
          <div className="relative overflow-hidden">
            <svg
              width={width}
              height={height}
              className="bg-slate-950 rounded-xl border border-slate-800/80 cursor-crosshair select-none"
              onClick={(e) => {
                if (!selectedInst) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (
                  mouseX >= padLeft &&
                  mouseX <= padLeft + chartW &&
                  mouseY >= padTop &&
                  mouseY <= padTop + chartH
                ) {
                  const distRatio = (mouseX - padLeft) / chartW;
                  const distKm = Math.round((distRatio * maxRangeM) / 1000);
                  const distM = distKm * 1000;
                  const altRatio = 1 - (mouseY - padTop) / chartH;
                  const altM = Math.round(altRatio * maxAltM);

                  const nearestTerrain = terrainPoints.find(
                    (p) => Math.abs(p.distM / 1000 - distKm) < 3
                  );

                  const status = evaluatePointStatus(distKm, altM, nearestTerrain?.altM);
                  const dest = destinationPoint(
                    selectedInst.latitude,
                    selectedInst.longitude,
                    distM,
                    currentAzimuth
                  );

                  // Chấm điểm mới: Điểm trước đó sẽ tự động được thay thế hoàn toàn
                  setCrossSectionProbePoint({
                    instanceId: selectedInst.instanceId,
                    azimuthDeg: currentAzimuth,
                    distM,
                    distKm,
                    altM,
                    terrainAltM: nearestTerrain?.altM,
                    status,
                    lat: dest.lat,
                    lon: dest.lon,
                  });
                }
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                if (
                  mouseX >= padLeft &&
                  mouseX <= padLeft + chartW &&
                  mouseY >= padTop &&
                  mouseY <= padTop + chartH
                ) {
                  const distRatio = (mouseX - padLeft) / chartW;
                  const distKm = Math.round((distRatio * maxRangeM) / 1000);
                  const altRatio = 1 - (mouseY - padTop) / chartH;
                  const altM = Math.round(altRatio * maxAltM);

                  const nearestTerrain = terrainPoints.find(
                    (p) => Math.abs(p.distM / 1000 - distKm) < 3
                  );

                  const status = evaluatePointStatus(distKm, altM, nearestTerrain?.altM);

                  setHoverData({
                    distKm,
                    altM,
                    terrainM: nearestTerrain?.altM,
                    status,
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

                {/* Pattern cho vùng mù Shadow / Bị chắn */}
                <pattern
                  id="samShadowHatch"
                  width="10"
                  height="10"
                  patternTransform="rotate(45 0 0)"
                  patternUnits="userSpaceOnUse"
                >
                  <line x1="0" y1="0" x2="0" y2="10" stroke="#f43f5e" strokeWidth="1.5" strokeOpacity="0.45" />
                </pattern>
              </defs>

              {/* Lưới toạ độ Y (Độ cao) */}
              {[0, 2000, 5000, 10000, 15000, 20000, 25000, 30000].map((alt) => {
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

              {/* Lưới toạ độ X (Cự ly) */}
              {Array.from({ length: Math.floor(maxRangeM / (isSam ? 5000 : 50000)) + 1 }).map((_, idx) => {
                const distKm = idx * (isSam ? 5 : 50);
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

              {/* NẾU LÀ RADAR: VẼ CÁC TIA QUÉT LOS */}
              {!isSam &&
                raysOnAzimuth.map((ray) => {
                  const el = ray.elevationDeg;
                  if (ray.maxRangeM <= 0) return null;
                  const originX = toX(0);
                  const originY = toY(field?.radarAltM || 0);

                  const sEndVis =
                    ray.samples.find((s) => s.distanceM >= ray.visibleEndM) ||
                    ray.samples[ray.samples.length - 1];

                  const visX = toX(ray.visibleEndM);
                  const visY = sEndVis ? toY(sEndVis.rayAltM) : originY;

                  return (
                    <g key={el}>
                      <line
                        x1={originX}
                        y1={originY}
                        x2={visX}
                        y2={visY}
                        stroke={selectedInst.color}
                        strokeWidth="1.8"
                        strokeOpacity="0.85"
                      />
                    </g>
                  );
                })}

              {/* NẾU LÀ SAM: VẼ VÒM HỎA LỰC SAM (1 LỚP TẦM TỐI ĐA) VÀ NÓN MÙ HÌNH NÓN */}
              {isSam && (
                <g>
                  {/* 1. Vòm Hỏa Lực Tiêu Diệt Tầm Tối Đa 100% D_max */}
                  {samOuterPathD && (
                    <path
                      d={samOuterPathD}
                      fill={selectedInst.color || '#f43f5e'}
                      fillOpacity="0.32"
                      stroke={selectedInst.color || '#f43f5e'}
                      strokeWidth="2.2"
                    />
                  )}

                  {/* 2. Nón Mù Cực Cận Đỉnh Đầu Hình Nón (Góc ngẩng 65°) */}
                  {samDeadConePathD && (
                    <path
                      d={samDeadConePathD}
                      fill="#020617"
                      fillOpacity="0.8"
                      stroke="#f43f5e"
                      strokeWidth="1.6"
                      strokeDasharray="4 3"
                    />
                  )}

                  {/* Đường sàn H_min (20m) & Đường trần H_max */}
                  <line
                    x1={toX(samDMinKm * 1000)}
                    y1={toY(samHMinM)}
                    x2={toX(samDMaxKm * 1000)}
                    y2={toY(samHMinM)}
                    stroke="#10b981"
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                  <line
                    x1={padLeft}
                    y1={toY(samHMaxM)}
                    x2={toX(samDMaxKm * 1000)}
                    y2={toY(samHMaxM)}
                    stroke="#f43f5e"
                    strokeWidth="1.2"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={toX(samDMaxKm * 1000) + 6}
                    y={toY(samHMaxM) + 4}
                    fill="#f43f5e"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    H_max: {(samHMaxM / 1000).toFixed(0)}km
                  </text>
                </g>
              )}

              {/* Lát cắt địa hình núi non thực tế */}
              {terrainPathD && (
                <path d={terrainPathD} fill="url(#terrainGradient)" stroke="#475569" strokeWidth="1.5" />
              )}

              {/* Điểm Chạm Núi Che Khuất (nếu có) */}
              {firstOcclusion && (
                <g>
                  <circle
                    cx={toX(firstOcclusion.distanceM)}
                    cy={toY(firstOcclusion.terrainAltM)}
                    r="5"
                    fill="#f43f5e"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={toX(firstOcclusion.distanceM)}
                    y1={toY(firstOcclusion.terrainAltM)}
                    x2={toX(maxRangeM)}
                    y2={toY(firstOcclusion.terrainAltM)}
                    stroke="#f43f5e"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                  />
                  <text
                    x={toX(firstOcclusion.distanceM) + 8}
                    y={toY(firstOcclusion.terrainAltM) - 6}
                    fill="#fda4af"
                    fontSize="10"
                    fontWeight="bold"
                    fontFamily="sans-serif"
                  >
                    Địa hình chắn không thể đánh được
                  </text>
                </g>
              )}

              {/* Vị trí đài / Bệ phóng tại x=0 */}
              <g>
                <line
                  x1={toX(0)}
                  y1={toY(0)}
                  x2={toX(0)}
                  y2={toY(selectedInst.altitude || 0)}
                  stroke={selectedInst.color}
                  strokeWidth="3"
                />
                <circle
                  cx={toX(0)}
                  cy={toY(selectedInst.altitude || 0)}
                  r="5"
                  fill={selectedInst.color}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                />
                <text
                  x={toX(0) + 8}
                  y={toY(selectedInst.altitude || 0) - 6}
                  fill={selectedInst.color}
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="sans-serif"
                >
                  {selectedInst.shortId || selectedInst.name} [{selectedInst.altitude || 0}m]
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

              {/* Điểm Chấm Khảo Sát 3D đã ghim (Probe Point) */}
              {crossSectionProbePoint &&
                crossSectionProbePoint.instanceId === selectedInst.instanceId &&
                crossSectionProbePoint.azimuthDeg === currentAzimuth && (
                  <g className="probe-point-marker">
                    {/* Đường dóng chiếu trục X (cự ly) */}
                    <line
                      x1={toX(crossSectionProbePoint.distM)}
                      y1={toY(crossSectionProbePoint.altM)}
                      x2={toX(crossSectionProbePoint.distM)}
                      y2={padTop + chartH}
                      stroke="#fde047"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    {/* Đường dóng chiếu trục Y (độ cao) */}
                    <line
                      x1={padLeft}
                      y1={toY(crossSectionProbePoint.altM)}
                      x2={toX(crossSectionProbePoint.distM)}
                      y2={toY(crossSectionProbePoint.altM)}
                      stroke="#fde047"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                    {/* Vòng hào quang phát sáng xung quanh điểm */}
                    <circle
                      cx={toX(crossSectionProbePoint.distM)}
                      cy={toY(crossSectionProbePoint.altM)}
                      r="10"
                      fill="#fde047"
                      fillOpacity="0.25"
                      stroke="#fde047"
                      strokeWidth="1.5"
                    />
                    {/* Điểm tâm chấm tròn */}
                    <circle
                      cx={toX(crossSectionProbePoint.distM)}
                      cy={toY(crossSectionProbePoint.altM)}
                      r="4"
                      fill="#fde047"
                      stroke="#020617"
                      strokeWidth="2"
                    />
                    {/* Badge toạ độ đính kèm trên đồ thị */}
                    <g
                      transform={`translate(${Math.min(
                        width - 150,
                        Math.max(padLeft + 10, toX(crossSectionProbePoint.distM) + 8)
                      )}, ${Math.max(padTop + 20, toY(crossSectionProbePoint.altM) - 10)})`}
                    >
                      <rect
                        x="0"
                        y="-14"
                        width="132"
                        height="20"
                        rx="4"
                        fill="#020617"
                        fillOpacity="0.9"
                        stroke="#fde047"
                        strokeWidth="1"
                      />
                      <text
                        x="6"
                        y="0"
                        fill="#fde047"
                        fontSize="10"
                        fontWeight="bold"
                        fontFamily="monospace"
                      >
                        📍 {crossSectionProbePoint.distKm}km • {crossSectionProbePoint.altM.toLocaleString('vi-VN')}m
                      </text>
                    </g>
                  </g>
                )}
            </svg>

            {/* Tooltip nổi khi Hover trên đồ thị */}
            {hoverData && (
              <div
                className="absolute pointer-events-none bg-slate-900/95 border border-cyan-500/60 rounded-lg p-2.5 text-[11px] font-mono shadow-xl text-slate-200 z-10 space-y-1"
                style={{
                  left: `${Math.min(width - 230, Math.max(padLeft, toX(hoverData.distKm * 1000) + 12))}px`,
                  top: `${Math.min(height - 95, Math.max(padTop, toY(hoverData.altM) - 55))}px`,
                }}
              >
                <div className="text-cyan-300 font-bold">Cự ly: {hoverData.distKm} km</div>
                <div className="text-slate-300">Độ cao khảo sát: {hoverData.altM.toLocaleString()} m</div>
                {hoverData.terrainM !== undefined && (
                  <div className="text-emerald-400">Độ cao đất: {hoverData.terrainM} m</div>
                )}
                {hoverData.status && (
                  <div className="text-amber-300 font-bold border-t border-slate-800 pt-0.5">
                    {hoverData.status}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 3. Footer Thống Kê & Chú Thích Quân Sự */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-300">
        <div className="flex items-center gap-4">
          {isSam ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-rose-500/80 border border-rose-400" />
                <span className="text-slate-300">Vòm Hỏa Lực Tiêu Diệt (100% D_max)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded bg-slate-950 border border-dashed border-rose-400" />
                <span className="text-slate-400">Nón Mù Đỉnh Đầu (Góc tà cực đại 65°)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-amber-400" />
                <span className="text-slate-400">Góc ngẩng bệ phóng (6° cố định)</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 rounded" style={{ backgroundColor: selectedInst.color }} />
                <span className="text-slate-400">Vùng Nhìn Thấy (Visible)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-1 border-t-2 border-dashed border-rose-500" />
                <span className="text-slate-400">Vùng Mù Sau Vật Cản (Shadow)</span>
              </div>
            </>
          )}

          <div className="flex items-center gap-1.5">
            <Mountain className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Địa hình 3D</span>
          </div>
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px]">
          {isSam ? (
            <>
              <div>
                Xạ giới:{' '}
                <strong className="text-cyan-300">
                  {samDMinKm} - {samDMaxKm} km
                </strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                Độ cao:{' '}
                <strong className="text-emerald-400">
                  {samHMinM}m - {(samHMaxM / 1000).toFixed(0)}km
                </strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                V_max:{' '}
                <strong className="text-amber-300">{samVMps} m/s</strong>
              </div>
              <div className="border-l border-slate-800 pl-3">
                P_gh:{' '}
                <strong className="text-rose-400">{samPGhKm} km</strong>
              </div>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </aside>
  );
};
