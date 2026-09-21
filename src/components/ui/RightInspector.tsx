import React, { useState, useMemo } from 'react';
import {
  X,
  Sliders,
  Radio,
  Share2,
  Pin,
  Trash2,
  Eye,
  EyeOff,
  Activity,
  MapPin,
  Compass,
  Layers,
  Move,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { OperationalStatus } from '../../types/equipment';
import type { SpxTargetHeightTier } from '../../types/spxRadarCoverage';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { resolveDomeColorHex } from '../../utils/radarDomeMaterial';

/** Slider có nhãn + giá trị, dùng cho khối tham số vòm phủ sóng */
const DomeSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, unit, decimals = 2, onChange }) => (
  <div>
    <div className="flex justify-between text-[11px] mb-1">
      <span className="text-slate-400">{label}</span>
      <span className="text-emerald-300 font-mono">
        {value.toFixed(decimals)}
        {unit ?? ''}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
    />
  </div>
);

/** Nút bật/tắt dạng thẻ, dùng cho khối tham số vòm phủ sóng */
const DomeToggle: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}> = ({ label, hint, checked, onToggle }) => (
  <button
    onClick={onToggle}
    title={hint}
    className={`w-full py-1.5 px-2 rounded border text-[11px] font-medium transition-all flex items-center justify-between ${
      checked
        ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300'
        : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700'
    }`}
  >
    <span>{label}</span>
    <span className="font-mono text-[10px]">{checked ? 'BẬT' : 'TẮT'}</span>
  </button>
);

export const RightInspector: React.FC = () => {
  const {
    instances,
    selectedInstanceId,
    selectEquipment,
    updateEquipment,
    removeEquipment,
    triggerFlyTo,
    showCrossSection,
    toggleCrossSection,
    coverageFields,
    targetHeightMeters,
    setTargetHeightMeters,
    activeTool,
    setActiveTool,
    spxConfig,
    updateEquipmentSpxConfig,
    spxResults,
    // Kiểu vòm phủ sóng tham chiếu (port từ Unity Defense/RadarDome)
    domeAlpha,
    setDomeAlpha,
    domeAzimuthSegments,
    setDomeAzimuthSegments,
    domeElevationRings,
    setDomeElevationRings,
    domeRimColor,
    setDomeRimColor,
    domeRimPower,
    setDomeRimPower,
    domeScanLineCount,
    setDomeScanLineCount,
    domeScanLineSpeed,
    setDomeScanLineSpeed,
    domeScanLineAnimated,
    toggleDomeScanLineAnimated,
    showDomeFootprint,
    setShowDomeFootprint,
    domeTerrainMasked,
    setDomeTerrainMasked,
    domeColorOverride,
    setDomeColorOverride,
    resetDomeStyleDefaults,
  } = useTacticalStore();

  const [coordFormat, setCoordFormat] = useState<'decimal' | 'dms'>('dms');

  const selected = instances.find((i) => i.instanceId === selectedInstanceId);

  // Helper chuyển đổi độ thập phân sang DMS (Độ, Phút, Giây)
  const toDms = (deg: number) => {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const s = Number(((minFloat - m) * 60).toFixed(1));
    return { d, m, s, dir: deg >= 0 ? 1 : -1 };
  };

  const latDms = selected ? toDms(selected.latitude) : { d: 16, m: 2, s: 34.8, dir: 1 };
  const lonDms = selected ? toDms(selected.longitude) : { d: 108, m: 7, s: 14.9, dir: 1 };

  const handleDmsChange = (
    coord: 'lat' | 'lon',
    part: 'd' | 'm' | 's',
    value: number
  ) => {
    if (!selected) return;
    const current = coord === 'lat' ? latDms : lonDms;
    const newD = part === 'd' ? value : current.d;
    const newM = part === 'm' ? value : current.m;
    const newS = part === 's' ? value : current.s;
    const sign = current.dir;
    const newDecimal = Number((sign * (newD + newM / 60 + newS / 3600)).toFixed(5));

    updateEquipment(selected.instanceId, {
      [coord === 'lat' ? 'latitude' : 'longitude']: newDecimal,
    });
  };

  // Cấu hình SPx riêng của đài đang chọn
  const instSpxConfig = useMemo(() => {
    if (!selected) return spxConfig;
    return {
      ...spxConfig,
      radarHeightAGL: selected.antennaHeightAGL || spxConfig.radarHeightAGL,
      endRangeM: selected.rangeKm ? selected.rangeKm * 1000 : spxConfig.endRangeM,
      minElevationDeg: selected.minElevationDeg !== undefined ? selected.minElevationDeg : spxConfig.minElevationDeg,
      maxElevationDeg: selected.maxElevationDeg !== undefined ? selected.maxElevationDeg : spxConfig.maxElevationDeg,
      ...(selected.spxConfig || {}),
    };
  }, [selected, spxConfig]);

  const activeSpxResult = selected ? spxResults[selected.instanceId] : null;

  // Màu vòm hiệu dụng: ghi đè -> domeColor của template -> màu khí tài
  const templateDomeColor = selected
    ? EQUIPMENT_TEMPLATES.find((t) => t.id === selected.templateId)?.domeColor
    : undefined;
  const effectiveDomeColor = selected
    ? resolveDomeColorHex(selected.color, templateDomeColor, domeColorOverride)
    : '#77ff7e';

  const updateSelectedSpx = (updates: Partial<typeof spxConfig>) => {
    if (!selected) return;
    updateEquipmentSpxConfig(selected.instanceId, updates);
    const equipUpdates: Partial<typeof selected> = {};
    if (updates.endRangeM !== undefined) {
      equipUpdates.rangeKm = Math.round(updates.endRangeM / 1000);
    }
    if (updates.radarHeightAGL !== undefined) {
      equipUpdates.antennaHeightAGL = updates.radarHeightAGL;
    }
    if (updates.minElevationDeg !== undefined) {
      equipUpdates.minElevationDeg = updates.minElevationDeg;
    }
    if (updates.maxElevationDeg !== undefined) {
      equipUpdates.maxElevationDeg = updates.maxElevationDeg;
    }
    if (Object.keys(equipUpdates).length > 0) {
      updateEquipment(selected.instanceId, equipUpdates);
    }
  };

  const handleHeightsStringChange = (val: string) => {
    const numbers = val
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0);

    if (numbers.length === 0) return;

    const colors = ['#00e676', '#ffd600', '#ff9100', '#ff1744', '#e040fb', '#00b0ff'];
    const newTiers: SpxTargetHeightTier[] = numbers.map((h, idx) => ({
      id: `tier_${h}`,
      heightMeters: h,
      color: colors[idx % colors.length],
      label: `${h}m`,
    }));

    updateSelectedSpx({ targetHeights: newTiers });
  };

  const heightsString = instSpxConfig.targetHeights.map((t) => t.heightMeters).join(' ');

  // Danh sách các Sở Chỉ Huy để gán liên kết C2
  const commandPosts = instances.filter(
    (i) => i.category === 'SoChiHuy' && i.instanceId !== selectedInstanceId
  );

  if (!selected) {
    return (
      <aside className="absolute top-14 right-0 bottom-0 w-80 bg-slate-950/80 backdrop-blur-md border-l border-slate-800/80 p-4 z-20 flex flex-col justify-center items-center text-center select-none text-slate-400">
        <Sliders className="w-10 h-10 text-slate-600 mb-3" />
        <h3 className="text-sm font-semibold text-slate-300">Bảng Thuộc Tính (Inspector)</h3>
        <p className="text-xs text-slate-500 mt-1.5 max-w-[220px]">
          Nhấp chọn một khí tài trên quả địa cầu 3D hoặc từ danh sách biên chế để cấu hình chi tiết thông số chiến thuật.
        </p>
      </aside>
    );
  }

  return (
    <aside className="absolute top-14 right-0 bottom-0 w-80 bg-slate-950/90 backdrop-blur-md border-l border-cyan-900/40 z-20 flex flex-col select-none overflow-y-auto">
      {/* 1. Header Khí Tài */}
      <div className="p-3.5 border-b border-slate-800 bg-slate-900/50 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
            {selected.shortId && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-800/80 rounded">
                {selected.shortId}
              </span>
            )}
            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">
              {selected.category}
            </span>
          </div>
          <input
            type="text"
            value={selected.name}
            onChange={(e) =>
              updateEquipment(selected.instanceId, { name: e.target.value })
            }
            className="mt-1 font-bold text-sm text-slate-100 bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 focus:outline-none w-full"
          />
        </div>
        <button
          onClick={() => selectEquipment(null)}
          className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3.5 space-y-4 flex-1 text-xs">
        {/* 2. Trạng thái hoạt động (Operational Status) */}
        <div>
          <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5 mb-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Trạng thái hoạt động</span>
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                { id: 'Active', label: 'Đang hoạt động', color: 'text-emerald-400 border-emerald-500/50 bg-emerald-950/40' },
                { id: 'Standby', label: 'Chờ lệnh', color: 'text-amber-400 border-amber-500/50 bg-amber-950/40' },
                { id: 'Maintenance', label: 'Bảo trì', color: 'text-orange-400 border-orange-500/50 bg-orange-950/40' },
                { id: 'Offline', label: 'Ngừng hoạt động', color: 'text-rose-400 border-rose-500/50 bg-rose-950/40' },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                onClick={() =>
                  updateEquipment(selected.instanceId, {
                    status: st.id as OperationalStatus,
                  })
                }
                className={`py-1.5 px-2 rounded border text-[11px] font-medium transition-all ${
                  selected.status === st.id
                    ? `${st.color} shadow-sm font-semibold`
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Toạ độ thực địa WGS-84 */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span>Toạ độ địa lý (WGS-84)</span>
            </label>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="coordFormat"
                  checked={coordFormat === 'dms'}
                  onChange={() => setCoordFormat('dms')}
                  className="text-cyan-500 focus:ring-0"
                />
                <span>DMS</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="coordFormat"
                  checked={coordFormat === 'decimal'}
                  onChange={() => setCoordFormat('decimal')}
                  className="text-cyan-500 focus:ring-0"
                />
                <span>Decimal</span>
              </label>
            </div>
          </div>

          {coordFormat === 'dms' ? (
            <div className="space-y-1.5 font-mono text-[11px]">
              {/* Latitude DMS */}
              <div className="flex items-center gap-1">
                <span className="w-14 text-slate-400 text-[10px]">VĨ ĐỘ:</span>
                <input
                  type="number"
                  value={latDms.d}
                  onChange={(e) => handleDmsChange('lat', 'd', Number(e.target.value))}
                  className="w-10 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>°</span>
                <input
                  type="number"
                  value={latDms.m}
                  onChange={(e) => handleDmsChange('lat', 'm', Number(e.target.value))}
                  className="w-10 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>'</span>
                <input
                  type="number"
                  step="0.1"
                  value={latDms.s}
                  onChange={(e) => handleDmsChange('lat', 's', Number(e.target.value))}
                  className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>"</span>
                <span className="text-cyan-400 font-bold ml-0.5">N</span>
              </div>
              {/* Longitude DMS */}
              <div className="flex items-center gap-1">
                <span className="w-14 text-slate-400 text-[10px]">KINH ĐỘ:</span>
                <input
                  type="number"
                  value={lonDms.d}
                  onChange={(e) => handleDmsChange('lon', 'd', Number(e.target.value))}
                  className="w-10 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>°</span>
                <input
                  type="number"
                  value={lonDms.m}
                  onChange={(e) => handleDmsChange('lon', 'm', Number(e.target.value))}
                  className="w-10 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>'</span>
                <input
                  type="number"
                  step="0.1"
                  value={lonDms.s}
                  onChange={(e) => handleDmsChange('lon', 's', Number(e.target.value))}
                  className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs"
                />
                <span>"</span>
                <span className="text-cyan-400 font-bold ml-0.5">E</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-slate-500 font-mono">VĨ ĐỘ (LAT)</span>
                <input
                  type="number"
                  step="0.0001"
                  value={selected.latitude}
                  onChange={(e) =>
                    updateEquipment(selected.instanceId, {
                      latitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-mono">KINH ĐỘ (LON)</span>
                <input
                  type="number"
                  step="0.0001"
                  value={selected.longitude}
                  onChange={(e) =>
                    updateEquipment(selected.instanceId, {
                      longitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <div>
              <span className="text-[10px] text-slate-500 font-mono">ĐỘ CAO ĐẤT (ASL)</span>
              <span className="block text-cyan-300 font-mono text-xs py-0.5 font-bold">
                {selected.altitude} m (MSL)
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-mono">THÁP ĂNG-TEN (AGL)</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={selected.antennaHeightAGL}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    updateEquipment(selected.instanceId, { antennaHeightAGL: val });
                    updateSelectedSpx({ radarHeightAGL: val });
                  }}
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-0.5 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[10px] text-slate-400">m</span>
              </div>
            </div>
          </div>

          {/* Nút Chọn vị trí mới trên bản đồ */}
          <button
            onClick={() => setActiveTool(activeTool === 'move' ? 'select' : 'move')}
            className={`w-full py-1.5 px-2.5 rounded-lg border font-bold text-xs flex items-center justify-center gap-1.5 transition-all ${
              activeTool === 'move'
                ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.5)] animate-pulse'
                : 'bg-slate-950 hover:bg-slate-900 text-cyan-300 border-cyan-500/40 hover:border-cyan-400'
            }`}
            title="Nhấp nút này rồi nhấp chuột vào bất kỳ vị trí nào trên bản đồ để di chuyển đài đến đó"
          >
            <Move className="w-3.5 h-3.5" />
            <span>{activeTool === 'move' ? '📍 Nhấp lên bản đồ để chọn vị trí mới...' : '🎯 Di chuyển đài sang vị trí khác'}</span>
          </button>
        </div>

        {/* 4. Thông số Vòm Radar / Tầm Hỏa lực */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-3">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Thông số Vòm Phủ Sóng & Quét</span>
          </label>

          {/* Bán kính radar */}
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Bán kính tầm xa:</span>
              <span className="text-cyan-300 font-mono font-bold">
                {selected.rangeKm} km ({selected.rangeKm * 1000} m)
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="500"
              step="5"
              value={selected.rangeKm}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                updateEquipment(selected.instanceId, { rangeKm: val });
                updateSelectedSpx({ endRangeM: val * 1000 });
              }}
              className="w-full accent-cyan-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Vận tốc quét */}
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Tốc độ quét 360°:</span>
              <span className="text-cyan-300 font-mono">
                {selected.scanSpeed ? `${selected.scanSpeed}°/s` : 'Không quét'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="60"
              step="2"
              value={selected.scanSpeed}
              onChange={(e) =>
                updateEquipment(selected.instanceId, {
                  scanSpeed: parseFloat(e.target.value),
                })
              }
              className="w-full accent-cyan-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Góc tà */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-slate-400">Góc tà min (°)</span>
              <input
                type="number"
                value={selected.minElevationDeg}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  updateEquipment(selected.instanceId, { minElevationDeg: val });
                  updateSelectedSpx({ minElevationDeg: val });
                }}
                className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Góc tà max (°)</span>
              <input
                type="number"
                value={selected.maxElevationDeg}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 0;
                  updateEquipment(selected.instanceId, { maxElevationDeg: val });
                  updateSelectedSpx({ maxElevationDeg: val });
                }}
                className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 4b. VÙNG PHỦ SPx RADAR 2D (CAMBRIDGE PIXEL STANDARD) */}
        {selected.rangeKm > 0 && (
          <div className="bg-slate-950/70 p-3 rounded-lg border border-cyan-500/50 space-y-3 shadow-md">
            <div className="flex items-center justify-between border-b border-cyan-900/50 pb-2">
              <div className="flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
                <span className="text-xs font-bold font-mono text-cyan-300">
                  SPx VÙNG PHỦ 2D (CAMBRIDGE PIXEL)
                </span>
              </div>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono">
                {activeSpxResult?.terrainStatus === 'dem_loaded' ? 'DEM 3D Chuẩn' : 'Đang nạp DEM'}
              </span>
            </div>

            {/* Cự ly quét tối đa (endRangeM) với nhập tự do (ví dụ 165000m) & phím bấm nhanh */}
            <div>
              <div className="flex justify-between text-[11px] mb-1 font-mono">
                <span className="text-slate-400">Cự ly tối đa End range (m):</span>
                <span className="text-cyan-300 font-bold">
                  {instSpxConfig.endRangeM.toLocaleString()} m ({(instSpxConfig.endRangeM / 1000).toFixed(1)} km)
                </span>
              </div>
              <input
                type="number"
                step="1000"
                value={instSpxConfig.endRangeM}
                onChange={(e) => updateSelectedSpx({ endRangeM: parseFloat(e.target.value) || 1000 })}
                placeholder="165000"
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-cyan-300 font-bold mb-1.5"
              />

              {/* Các mốc cự ly chọn nhanh */}
              <div className="grid grid-cols-4 gap-1">
                {[
                  { label: '25km', m: 25000 },
                  { label: '50km', m: 50000 },
                  { label: '75km', m: 75000 },
                  { label: '100km', m: 100000 },
                  { label: '165km', m: 165000 },
                  { label: '200km', m: 200000 },
                  { label: '250km', m: 250000 },
                  { label: '300km', m: 300000 },
                ].map((chip) => (
                  <button
                    key={chip.m}
                    onClick={() => updateSelectedSpx({ endRangeM: chip.m })}
                    className={`py-1 rounded text-[10px] font-mono border transition-all ${
                      instSpxConfig.endRangeM === chip.m
                        ? 'bg-cyan-900 text-cyan-300 border-cyan-400 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Độ cong Trái Đất 4/3 */}
            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={instSpxConfig.earthCurvature}
                  onChange={(e) => updateSelectedSpx({ earthCurvature: e.target.checked })}
                  className="rounded text-cyan-500 focus:ring-0"
                />
                <span className="font-mono text-[11px]">Độ cong Trái Đất (Curvature 4/3)</span>
              </label>
              <span className="text-[10px] text-cyan-400 font-mono">k = 1.333</span>
            </div>

            {/* Tầng độ cao mục tiêu (Target heights) */}
            <div className="p-2 rounded bg-slate-900/60 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" /> Tầng độ cao mục tiêu (m):
                </span>
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`altRef_${selected.instanceId}`}
                      checked={instSpxConfig.altitudeReference === 'sea_level'}
                      onChange={() => updateSelectedSpx({ altitudeReference: 'sea_level' })}
                      className="text-cyan-500 focus:ring-0"
                    />
                    <span>Sea Level</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name={`altRef_${selected.instanceId}`}
                      checked={instSpxConfig.altitudeReference === 'ground'}
                      onChange={() => updateSelectedSpx({ altitudeReference: 'ground' })}
                      className="text-cyan-500 focus:ring-0"
                    />
                    <span>Ground</span>
                  </label>
                </div>
              </div>

              {/* Các chip màu phân tầng */}
              <div className="grid grid-cols-4 gap-1.5">
                {instSpxConfig.targetHeights.map((tier) => (
                  <div
                    key={tier.id}
                    className="p-1.5 rounded border text-center font-mono font-bold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5"
                    style={{
                      backgroundColor: `${tier.color}25`,
                      borderColor: tier.color,
                      color: tier.color,
                    }}
                  >
                    <div
                      className="w-3 h-3 rounded-full border border-black/40"
                      style={{ backgroundColor: tier.color }}
                    />
                    <span>{tier.label}</span>
                  </div>
                ))}
              </div>

              {/* Input chỉnh sửa chuỗi độ cao */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] text-slate-400 font-mono">Độ cao:</span>
                <input
                  type="text"
                  defaultValue={heightsString}
                  onBlur={(e) => handleHeightsStringChange(e.target.value)}
                  placeholder="500 800 1000 2000"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-cyan-300 font-bold"
                />
              </div>
            </div>

            {/* Độ trong suốt & Vòng cự ly */}
            <div className="space-y-2 pt-1 font-mono text-[11px]">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400">Độ trong suốt dải màu:</span>
                  <span className="text-cyan-300 font-bold">
                    {Math.round(instSpxConfig.coverageTransparency * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={instSpxConfig.coverageTransparency}
                  onChange={(e) =>
                    updateSelectedSpx({ coverageTransparency: parseFloat(e.target.value) })
                  }
                  className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={instSpxConfig.showRangeRings}
                    onChange={(e) => updateSelectedSpx({ showRangeRings: e.target.checked })}
                    className="rounded text-cyan-500 focus:ring-0"
                  />
                  <span className="text-slate-300">Vòng cự ly (Range rings)</span>
                </label>
                <span className="text-[10px] text-cyan-400">Nội suy cự ly thông minh</span>
              </div>
            </div>

            {/* Thống kê vùng phủ thực tế của đài này */}
            {activeSpxResult && activeSpxResult.contours.length > 0 && (
              <div className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono space-y-1">
                <span className="text-slate-400 block font-bold">Thống kê vùng phủ thực tế đài này:</span>
                {activeSpxResult.contours.map((c) => (
                  <div key={c.tier.id} className="flex items-center justify-between">
                    <span style={{ color: c.tier.color }} className="font-bold">
                      Tầng {c.tier.label}:
                    </span>
                    <span className="text-slate-300">
                      Tầm xa: <strong>{(c.maxObservedRangeM / 1000).toFixed(1)}km</strong> • Diện tích:{' '}
                      <strong>{c.coverageAreaKm2.toLocaleString()} km²</strong>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5. Cắt Địa Hình & Vùng Mù Sóng Radar (Line-of-Sight) */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-cyan-900/50 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cắt Địa Hình 3D & Vùng Mù (LOS)</span>
            </label>
            <span className="text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">
              k = 4/3
            </span>
          </div>

          {/* Chọn Độ cao mục tiêu bay H_mt */}
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-slate-400">Độ cao mục tiêu (H_mt):</span>
              <span className="text-cyan-300 font-mono font-bold">
                {targetHeightMeters} m
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 mb-2">
              {[
                { label: '50m', value: 50, note: 'Sát đất' },
                { label: '300m', value: 300, note: 'Bay thấp' },
                { label: '1km', value: 1000, note: 'Bay trung' },
                { label: '5km', value: 5000, note: 'Bay cao' },
              ].map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => setTargetHeightMeters(btn.value)}
                  className={`py-1 rounded text-[10px] font-mono border transition-all ${
                    targetHeightMeters === btn.value
                      ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                      : 'bg-slate-950/70 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                  title={btn.note}
                >
                  {btn.label}
                </button>
              ))}
            </div>
            <input
              type="range"
              min="20"
              max="15000"
              step="50"
              value={targetHeightMeters}
              onChange={(e) =>
                setTargetHeightMeters(parseFloat(e.target.value))
              }
              className="w-full accent-cyan-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          {/* Hiển thị tính toán công thức thực tế */}
          <div className="grid grid-cols-2 gap-2 p-2 bg-slate-950/80 rounded-lg border border-slate-800 font-mono text-[10px]">
            <div>
              <span className="text-slate-500 block">KHU MÙ ĐỈNH (R_kh)</span>
              <span className="text-amber-300 font-bold">
                {(
                  (targetHeightMeters *
                    (1 / Math.tan((selected.maxElevationDeg * Math.PI) / 180))) /
                  1000
                ).toFixed(2)}{' '}
                km
              </span>
              <span className="text-[9px] text-slate-500 block">H_mt · cotg ε_max</span>
            </div>
            <div>
              <span className="text-slate-500 block">CHÂN TRỜI (D_nt)</span>
              <span className="text-cyan-300 font-bold">
                {(
                  4.12 *
                  (Math.sqrt(selected.antennaHeightAGL) +
                    Math.sqrt(targetHeightMeters))
                ).toFixed(1)}{' '}
                km
              </span>
              <span className="text-[9px] text-slate-500 block">4.12·(√ha + √Hmt)</span>
            </div>
          </div>

          {/* Nút Kích Hoạt Mặt Cắt Quang Tuyến 2D (Cross Section) */}
          <div className="pt-2 border-t border-slate-800/80">
            <button
              onClick={toggleCrossSection}
              className={`w-full py-2 px-3 rounded-xl border font-semibold text-xs flex items-center justify-center gap-2 transition-all ${
                showCrossSection
                  ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)] ring-1 ring-cyan-400'
                  : 'bg-slate-950 hover:bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500/50'
              }`}
            >
              <Compass className={`w-4 h-4 ${showCrossSection ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
              <span>{showCrossSection ? 'Đang Xem Mặt Cắt 2D (Cross Section)' : 'Mở Mặt Cắt Quang Tuyến 2D'}</span>
            </button>
          </div>
        </div>

        {/* 5b. Coverage Profile & Dữ Liệu Trường 3D (Single Source of Truth) */}
        {selected.coverageProfile && (
          <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Coverage Profile (Giản đồ phủ)</span>
              </label>
              <span className="text-[9px] text-cyan-300 font-mono">
                {selected.coverageProfile.name}
              </span>
            </div>

            <p className="text-[10px] text-slate-400">
              Giới hạn cự ly theo từng góc tà (nội suy liên tục, không dùng bán kính phẳng):
            </p>

            <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
              {selected.coverageProfile.points.map((pt, idx) => (
                <div key={idx} className="bg-slate-950/80 p-1.5 rounded border border-slate-800 text-center">
                  <span className="text-slate-500 block">{pt.elevationDeg}°</span>
                  <span className="text-cyan-300 font-bold">{pt.maxRangeKm} km</span>
                </div>
              ))}
            </div>

            {/* Trạng thái Coverage Field hiện tại */}
            {coverageFields[selected.instanceId] && (
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Trường 3D: <strong className="text-cyan-300">{coverageFields[selected.instanceId].totalRays} tia</strong></span>
                <span>Bị chắn: <strong className="text-rose-400">{coverageFields[selected.instanceId].occludedRaysCount}</strong></span>
                <span>Tỷ lệ: <strong className="text-emerald-400">{coverageFields[selected.instanceId].coverageRatioPercent}%</strong></span>
              </div>
            )}
          </div>
        )}

        {/* 5c. Vòm phủ sóng — kiểu tham chiếu (port từ Unity Defense/RadarDome) */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-emerald-900/50 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-emerald-300 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Vòm phủ sóng (kiểu tham chiếu)</span>
            </label>
            <span className="text-[9px] text-emerald-300/80 font-mono">RadarDome</span>
          </div>

          {/* Màu vòm hiệu dụng */}
          <div className="flex items-center justify-between p-2 bg-slate-950/80 rounded-lg border border-slate-800 text-[10px] font-mono">
            <span className="text-slate-500">MÀU VÒM HIỆU DỤNG</span>
            <span className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-sm border border-slate-600"
                style={{ backgroundColor: effectiveDomeColor }}
              />
              <span className="text-emerald-300">{effectiveDomeColor}</span>
            </span>
          </div>

          {/* Ghi đè màu vòm */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <span className="text-[10px] text-slate-400 block mb-1">Ghi đè màu vòm</span>
              <input
                type="color"
                value={domeColorOverride ?? effectiveDomeColor}
                onChange={(e) => setDomeColorOverride(e.target.value)}
                className="w-full h-7 bg-slate-950 border border-slate-700 rounded cursor-pointer"
              />
            </div>
            <button
              onClick={() => setDomeColorOverride(null)}
              className={`mt-4 px-2 py-1.5 rounded border text-[10px] font-mono transition-colors ${
                domeColorOverride
                  ? 'border-slate-700 bg-slate-950 text-slate-300 hover:border-rose-500/60'
                  : 'border-slate-800 bg-slate-950/60 text-slate-600'
              }`}
              title="Bỏ ghi đè, quay về màu theo template/màu khí tài"
            >
              BỎ GHI ĐÈ
            </button>
          </div>

          <DomeSlider
            label="Độ đục màu nền vòm (domeAlpha):"
            value={domeAlpha}
            min={0.05}
            max={0.9}
            step={0.01}
            onChange={setDomeAlpha}
          />

          <div className="grid grid-cols-2 gap-2">
            <DomeSlider
              label="Phân đoạn phương vị:"
              value={domeAzimuthSegments}
              min={32}
              max={192}
              step={8}
              decimals={0}
              onChange={setDomeAzimuthSegments}
            />
            <DomeSlider
              label="Vòng góc tà:"
              value={domeElevationRings}
              min={4}
              max={32}
              step={1}
              decimals={0}
              onChange={setDomeElevationRings}
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="w-16">
              <span className="text-[10px] text-slate-400 block mb-1">Viền sáng</span>
              <input
                type="color"
                value={domeRimColor}
                onChange={(e) => setDomeRimColor(e.target.value)}
                className="w-full h-7 bg-slate-950 border border-slate-700 rounded cursor-pointer"
                title={`Màu viền sáng (rimColor) — ${domeRimColor}`}
              />
            </div>
            <div className="flex-1">
              <DomeSlider
                label="Độ gắt viền (rimPower):"
                value={domeRimPower}
                min={0.5}
                max={8}
                step={0.1}
                decimals={1}
                onChange={setDomeRimPower}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <DomeSlider
              label="Số đường quét:"
              value={domeScanLineCount}
              min={1}
              max={40}
              step={1}
              decimals={0}
              onChange={setDomeScanLineCount}
            />
            <DomeSlider
              label="Tốc độ quét:"
              value={domeScanLineSpeed}
              min={-5}
              max={5}
              step={0.1}
              decimals={1}
              onChange={setDomeScanLineSpeed}
            />
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <DomeToggle
              label="Chạy animation dải quét"
              hint="Tắt để đóng băng dải quét ngang"
              checked={domeScanLineAnimated}
              onToggle={toggleDomeScanLineAnimated}
            />
            <DomeToggle
              label="Vòng chân đế mặt đất"
              hint="Tương đương CoverageFootprint LineRenderer của Unity"
              checked={showDomeFootprint}
              onToggle={() => setShowDomeFootprint(!showDomeFootprint)}
            />
            <DomeToggle
              label="Cắt vòm theo địa hình"
              hint="Bật để giới hạn bán kính vòm theo visibleEndM của tia LOS (mặc định tắt = vòm lý tưởng như video)"
              checked={domeTerrainMasked}
              onToggle={() => setDomeTerrainMasked(!domeTerrainMasked)}
            />
          </div>

          <button
            onClick={resetDomeStyleDefaults}
            className="w-full py-2 px-3 rounded-xl border border-emerald-600/60 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 text-xs font-semibold transition-colors"
            title="Đặt lại toàn bộ tham số vòm về đúng bộ giá trị của video tham chiếu (alpha 0.30, 96x12, rim #fff232 power 2.0, 14 đường quét, tốc độ 0.6)"
          >
            Khôi phục mặc định kiểu video
          </button>
        </div>

        {/* 6. Quan hệ Chỉ Huy Tác Chiến (C2) */}
        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Share2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Sở Chỉ Huy Trực Thuộc</span>
          </label>
          <select
            value={selected.commandedByInstanceId || ''}
            onChange={(e) =>
              updateEquipment(selected.instanceId, {
                commandedByInstanceId: e.target.value || null,
              })
            }
            className="w-full bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded border border-slate-700 focus:outline-none focus:border-amber-500"
          >
            <option value="">-- Độc lập (Không gán SCH) --</option>
            {commandPosts.map((cp) => (
              <option key={cp.instanceId} value={cp.instanceId}>
                {cp.name}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-500 italic">
            {selected.commandedByInstanceId
              ? 'Tuyến truyền số liệu chỉ huy sẽ được hiển thị bằng đường nối 3D.'
              : 'Khí tài hoạt động độc lập hoặc đóng vai trò chỉ huy.'}
          </p>
        </div>

        {/* 7. Hiển thị riêng cho khí tài */}
        <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
          <span className="text-slate-300 text-xs">Hiển thị Vòm 3D đơn vị</span>
          <button
            onClick={() =>
              updateEquipment(selected.instanceId, {
                showDome: !selected.showDome,
              })
            }
            className={`p-1.5 rounded border transition-colors ${
              selected.showDome
                ? 'bg-cyan-950 text-cyan-300 border-cyan-500/50'
                : 'bg-slate-950 text-slate-500 border-slate-800'
            }`}
          >
            {selected.showDome ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 7. Action Footer */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/60 flex items-center gap-2">
        <button
          onClick={() =>
            triggerFlyTo({
              id: selected.instanceId,
              name: selected.name,
              latitude: selected.latitude,
              longitude: selected.longitude,
              height: 95000,
              pitch: -35,
            })
          }
          className="flex-1 py-2 px-3 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-600/60 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
          title="Ghim tâm nhìn vào khí tài để kéo bản đồ lên/xuống"
        >
          <Pin className="w-4 h-4 text-cyan-400" />
          <span>Ghim & Kéo góc nhìn</span>
        </button>

        <button
          onClick={() => removeEquipment(selected.instanceId)}
          className="py-2 px-3 rounded bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-semibold flex items-center justify-center transition-colors"
          title="Xóa khí tài này khỏi bản đồ"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};
