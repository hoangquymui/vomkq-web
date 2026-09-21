import React, { useState, useMemo } from 'react';
import {
  X,
  Radio,
  Share2,
  Pin,
  Trash2,
  Activity,
  MapPin,
  Compass,
  Layers,
  Move,
  Table2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Shield,
  Target,
  Zap,
  RadioTower,
  Network,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { OperationalStatus } from '../../types/equipment';
import type { SpxTargetHeightTier } from '../../types/spxRadarCoverage';
import { ASSET_TYPE_REGISTRY } from '../../utils/assetVisualization';

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
    viewMode,
    showSensorNetwork,
    toggleSensorNetwork,
  } = useTacticalStore();

  const [coordFormat, setCoordFormat] = useState<'decimal' | 'dms'>('dms');
  // Tab chế độ xem trong Inspector: Mặc định đồng bộ với viewMode toàn cục nhưng cho phép người dùng chuyển đổi linh hoạt
  const [activeTab, setActiveTab] = useState<'2d' | '3d'>(() =>
    viewMode === '3D' ? '3d' : '2d'
  );

  // Accordion state (Tiêu chí Progressive Disclosure: ĐÓNG MẶC ĐỊNH để inspector luôn ngắn gọn)
  const [isProfileOpen, setIsProfileOpen] = useState<boolean>(false);
  const [isAltitudeTableOpen, setIsAltitudeTableOpen] = useState<boolean>(false);
  const [isSpecsOpen, setIsSpecsOpen] = useState<boolean>(false);

  const selected = instances.find((i) => i.instanceId === selectedInstanceId);

  // Helper tính cự ly đại vòng tròn giữa 2 điểm (km)
  const computeDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
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
  };

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
      minElevationDeg:
        selected.minElevationDeg !== undefined
          ? selected.minElevationDeg
          : spxConfig.minElevationDeg,
      maxElevationDeg:
        selected.maxElevationDeg !== undefined
          ? selected.maxElevationDeg
          : spxConfig.maxElevationDeg,
      ...(selected.spxConfig || {}),
    };
  }, [selected, spxConfig]);

  const activeSpxResult = selected ? spxResults[selected.instanceId] : null;

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

  // Danh sách các trạm cảm biến thụ động khác để tính cự ly đường cơ sở TDoA
  const otherEsmNodes = useMemo(() => {
    if (!selected) return [];
    return instances.filter(
      (i) =>
        i.instanceId !== selected.instanceId &&
        (i.category === 'CamBienThuDong' ||
          ASSET_TYPE_REGISTRY[i.category]?.capabilities.hasSensorNetwork)
    );
  }, [instances, selected]);

  // Phân định khả năng hiển thị của khí tài (Capabilities)
  const caps = selected
    ? ASSET_TYPE_REGISTRY[selected.category]?.capabilities || {
        hasRadarCoverage: selected.category === 'RadarCanhGioi',
        hasRangeRings: selected.category === 'RadarCanhGioi',
        hasSweep: selected.scanSpeed > 0,
        hasEngagementEnvelope:
          selected.category === 'TenLuaPhongKhong' ||
          selected.category === 'PhaoPhongKhong',
        hasCommandLinks: selected.category === 'SoChiHuy',
        hasObservationSector: selected.category === 'TramQuanSat',
        hasSensorNetwork: selected.category === 'CamBienThuDong',
      }
    : null;

  if (!selected || !caps) {
    return (
      <aside className="absolute top-14 right-0 bottom-0 w-80 sm:w-84 bg-slate-950/85 backdrop-blur-md border-l border-slate-800/80 p-4 z-20 flex flex-col justify-center items-center text-center select-none text-slate-400">
        <div className="w-12 h-12 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-center text-slate-600 mb-3 shadow-inner">
          <Shield className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-slate-200 font-mono">BẢNG THUỘC TÍNH KHÍ TÀI</h3>
        <p className="text-xs text-slate-500 mt-2 max-w-[230px] leading-relaxed">
          Nhấp chọn một khí tài trên bản đồ tác chiến hoặc từ danh sách biên chế để xem và cấu hình chi tiết.
        </p>
      </aside>
    );
  }

  return (
    <aside className="absolute top-14 right-0 bottom-0 w-80 sm:w-84 bg-slate-950/95 backdrop-blur-md border-l border-cyan-900/40 z-20 flex flex-col select-none overflow-hidden shadow-2xl text-slate-100">
      {/* ========================================================================= */}
      {/* 1. HEADER / IDENTITY (Vùng nhận diện cố định) */}
      {/* ========================================================================= */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/80 flex items-start justify-between shrink-0">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border mt-0.5 shadow-sm"
            style={{
              backgroundColor: `${selected.color}20`,
              borderColor: `${selected.color}80`,
              color: selected.color,
            }}
          >
            {selected.category === 'SoChiHuy' ? (
              <Shield className="w-4 h-4" />
            ) : selected.category === 'TenLuaPhongKhong' ? (
              <Target className="w-4 h-4" />
            ) : selected.category === 'PhaoPhongKhong' ? (
              <Zap className="w-4 h-4" />
            ) : selected.category === 'CamBienThuDong' ? (
              <RadioTower className="w-4 h-4" />
            ) : (
              <Radio className="w-4 h-4" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {selected.shortId && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-700/70 rounded">
                  {selected.shortId}
                </span>
              )}
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                {selected.category === 'RadarCanhGioi'
                  ? 'RADAR CẢNH GIỚI'
                  : selected.category === 'TenLuaPhongKhong'
                  ? 'TÊN LỬA PHÒNG KHÔNG'
                  : selected.category === 'SoChiHuy'
                  ? 'SỞ CHỈ HUY (C2)'
                  : selected.category === 'PhaoPhongKhong'
                  ? 'PHÁO PHÒNG KHÔNG'
                  : selected.category === 'CamBienThuDong'
                  ? 'CẢM BIẾN THỤ ĐỘNG (ESM)'
                  : 'TRẠM QUAN SÁT'}
              </span>
            </div>
            <input
              type="text"
              value={selected.name}
              onChange={(e) =>
                updateEquipment(selected.instanceId, { name: e.target.value })
              }
              title="Nhấp để sửa tên hiển thị khí tài"
              className="mt-1 font-bold text-xs text-slate-100 bg-transparent border-b border-transparent hover:border-slate-700 focus:border-cyan-500 focus:outline-none w-full truncate"
            />
          </div>
        </div>

        <button
          onClick={() => selectEquipment(null)}
          className="p-1 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors shrink-0 ml-1 cursor-pointer"
          title="Đóng bảng thuộc tính"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ========================================================================= */}
      {/* PHẦN CUỘN CHÍNH CỦA INSPECTOR */}
      {/* ========================================================================= */}
      <div className="p-3 space-y-3 flex-1 overflow-y-auto text-xs">
        {/* ======================================================================= */}
        {/* 2. THAO TÁC NHANH: TRẠNG THÁI HOẠT ĐỘNG & THANH CÔNG CỤ NHANH */}
        {/* ======================================================================= */}
        <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Trạng thái sẵn sàng</span>
            </span>
            <span
              className={`w-2 h-2 rounded-full ${
                selected.status === 'Active'
                  ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                  : selected.status === 'Standby'
                  ? 'bg-amber-400'
                  : selected.status === 'Maintenance'
                  ? 'bg-orange-400'
                  : 'bg-rose-500'
              }`}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
            {(
              [
                {
                  id: 'Active',
                  label: 'Đang hoạt động',
                  color: 'text-emerald-400 border-emerald-500/60 bg-emerald-950/60',
                },
                {
                  id: 'Standby',
                  label: 'Chờ lệnh',
                  color: 'text-amber-400 border-amber-500/60 bg-amber-950/60',
                },
                {
                  id: 'Maintenance',
                  label: 'Bảo trì',
                  color: 'text-orange-400 border-orange-500/60 bg-orange-950/60',
                },
                {
                  id: 'Offline',
                  label: 'Ngừng HĐ',
                  color: 'text-rose-400 border-rose-500/60 bg-rose-950/60',
                },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                onClick={() =>
                  updateEquipment(selected.instanceId, {
                    status: st.id as OperationalStatus,
                  })
                }
                className={`py-1.5 px-2 rounded-lg border text-[10.5px] font-medium transition-all cursor-pointer ${
                  selected.status === st.id
                    ? `${st.color} shadow-sm font-bold`
                    : 'border-slate-800/90 bg-slate-950/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Thanh nút thao tác nhanh: Di chuyển, Ghim góc nhìn, Xóa */}
          <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-800/80">
            <button
              onClick={() => setActiveTool(activeTool === 'move' ? 'select' : 'move')}
              className={`py-1.5 px-2 rounded-lg border font-semibold text-[10.5px] flex items-center justify-center gap-1 transition-all cursor-pointer ${
                activeTool === 'move'
                  ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-pulse'
                  : 'bg-slate-950 hover:bg-slate-900 text-cyan-300 border-slate-800 hover:border-cyan-500/40'
              }`}
              title="Di chuyển đài sang vị trí tọa độ mới trên bản đồ"
            >
              <Move className="w-3 h-3" />
              <span>{activeTool === 'move' ? 'Đặt vị trí...' : 'Di chuyển'}</span>
            </button>

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
              className="py-1.5 px-2 rounded-lg border border-slate-800 hover:border-cyan-500/40 bg-slate-950 hover:bg-slate-900 text-cyan-300 font-semibold text-[10.5px] flex items-center justify-center gap-1 transition-all cursor-pointer"
              title="Bay camera tới vị trí khí tài này"
            >
              <Pin className="w-3 h-3" />
              <span>Ghim vị trí</span>
            </button>

            <button
              onClick={() => {
                if (window.confirm(`Xóa khí tài [${selected.shortId || selected.name}] khỏi trận địa?`)) {
                  removeEquipment(selected.instanceId);
                }
              }}
              className="py-1.5 px-2 rounded-lg border border-rose-900/60 bg-rose-950/30 hover:bg-rose-950/70 text-rose-300 font-semibold text-[10.5px] flex items-center justify-center gap-1 transition-all cursor-pointer"
              title="Xóa khí tài khỏi trận địa"
            >
              <Trash2 className="w-3 h-3" />
              <span>Xóa</span>
            </button>
          </div>
        </div>

        {/* ======================================================================= */}
        {/* 3. THÔNG TIN CHUNG (COMMON INFORMATION - Vị trí, Cao độ, C2) */}
        {/* ======================================================================= */}
        <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span>Vị trí & Cao độ (WGS-84)</span>
            </span>
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="coordFormat"
                  checked={coordFormat === 'dms'}
                  onChange={() => setCoordFormat('dms')}
                  className="text-cyan-500 focus:ring-0 cursor-pointer"
                />
                <span className={coordFormat === 'dms' ? 'text-cyan-300 font-bold' : 'text-slate-500'}>DMS</span>
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="coordFormat"
                  checked={coordFormat === 'decimal'}
                  onChange={() => setCoordFormat('decimal')}
                  className="text-cyan-500 focus:ring-0 cursor-pointer"
                />
                <span className={coordFormat === 'decimal' ? 'text-cyan-300 font-bold' : 'text-slate-500'}>Dec</span>
              </label>
            </div>
          </div>

          {coordFormat === 'dms' ? (
            <div className="space-y-1.5 font-mono text-[10.5px]">
              <div className="flex items-center gap-1">
                <span className="w-12 text-slate-400 text-[10px]">VĨ ĐỘ:</span>
                <input
                  type="number"
                  value={latDms.d}
                  onChange={(e) => handleDmsChange('lat', 'd', Number(e.target.value))}
                  className="w-9 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>°</span>
                <input
                  type="number"
                  value={latDms.m}
                  onChange={(e) => handleDmsChange('lat', 'm', Number(e.target.value))}
                  className="w-9 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>'</span>
                <input
                  type="number"
                  step="0.1"
                  value={latDms.s}
                  onChange={(e) => handleDmsChange('lat', 's', Number(e.target.value))}
                  className="w-11 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>"</span>
                <span className="text-cyan-400 font-bold ml-0.5">N</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-12 text-slate-400 text-[10px]">KINH:</span>
                <input
                  type="number"
                  value={lonDms.d}
                  onChange={(e) => handleDmsChange('lon', 'd', Number(e.target.value))}
                  className="w-9 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>°</span>
                <input
                  type="number"
                  value={lonDms.m}
                  onChange={(e) => handleDmsChange('lon', 'm', Number(e.target.value))}
                  className="w-9 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>'</span>
                <input
                  type="number"
                  step="0.1"
                  value={lonDms.s}
                  onChange={(e) => handleDmsChange('lon', 's', Number(e.target.value))}
                  className="w-11 bg-slate-950 border border-slate-700 rounded px-1 text-center text-xs text-slate-200"
                />
                <span>"</span>
                <span className="text-cyan-400 font-bold ml-0.5">E</span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono">
              <div>
                <span className="text-[10px] text-slate-500">VĨ ĐỘ (LAT)</span>
                <input
                  type="number"
                  step="0.0001"
                  value={selected.latitude}
                  onChange={(e) =>
                    updateEquipment(selected.instanceId, {
                      latitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500">KINH ĐỘ (LON)</span>
                <input
                  type="number"
                  step="0.0001"
                  value={selected.longitude}
                  onChange={(e) =>
                    updateEquipment(selected.instanceId, {
                      longitude: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Cao độ đất và Tháp anten */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <div>
              <span className="text-[10px] text-slate-500 font-mono">CAO ĐỘ ĐẤT (MSL)</span>
              <span className="block text-cyan-300 font-mono text-xs py-0.5 font-bold">
                {selected.altitude} m
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-mono">THÁP ANTEN (AGL)</span>
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

          {/* Sở chỉ huy trực thuộc (C2) */}
          <div className="pt-1.5 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-amber-300 font-mono flex items-center gap-1">
                <Share2 className="w-3 h-3" /> Sở Chỉ Huy Trực Thuộc
              </span>
              {selected.commandedByInstanceId && (
                <span className="text-[9px] text-emerald-400 font-mono">● Đã liên kết</span>
              )}
            </div>
            <select
              value={selected.commandedByInstanceId || ''}
              onChange={(e) =>
                updateEquipment(selected.instanceId, {
                  commandedByInstanceId: e.target.value || null,
                })
              }
              className="w-full bg-slate-950 text-slate-200 text-xs px-2.5 py-1 rounded border border-slate-700 focus:outline-none focus:border-amber-500 cursor-pointer"
            >
              <option value="">-- Độc lập (Không gán SCH) --</option>
              {commandPosts.map((cp) => (
                <option key={cp.instanceId} value={cp.instanceId}>
                  {cp.shortId ? `[${cp.shortId}] ` : ''}{cp.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ======================================================================= */}
        {/* 4. PHÂN TÁCH VIEW MODE TABS: [ 2D BẢN ĐỒ ] VS [ 3D / LOS KHÔNG GIAN ] */}
        {/* ======================================================================= */}
        <div className="space-y-2">
          {/* Thanh chuyển đổi Tab */}
          <div className="grid grid-cols-2 p-1 bg-slate-900 rounded-xl border border-slate-800 text-xs font-mono">
            <button
              onClick={() => setActiveTab('2d')}
              className={`py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === '2d'
                  ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>2D BẢN ĐỒ</span>
            </button>
            <button
              onClick={() => setActiveTab('3d')}
              className={`py-1.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                activeTab === '3d'
                  ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>3D / LOS KHÔNG GIAN</span>
            </button>
          </div>

          {/* ===================================================================== */}
          {/* NỘI DUNG TAB 2D — CHỈ DÀNH CHO BẢN ĐỒ PHẲNG 2D */}
          {/* ===================================================================== */}
          {activeTab === '2d' && (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* Nếu là Radar có vùng phủ SPx */}
              {caps.hasRadarCoverage && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-cyan-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                      <Radio className="w-3.5 h-3.5 text-cyan-400" />
                      VÙNG PHỦ SPx & VÒNG CỰ LY 2D
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono">
                      {activeSpxResult?.terrainStatus === 'dem_loaded' ? 'DEM 3D Chuẩn' : 'Đang nạp DEM'}
                    </span>
                  </div>

                  {/* Cự ly quét tối đa endRangeM */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1 font-mono">
                      <span className="text-slate-400">Cự ly trinh sát tối đa:</span>
                      <span className="text-cyan-300 font-bold">
                        {(instSpxConfig.endRangeM / 1000).toFixed(0)} km
                      </span>
                    </div>
                    <input
                      type="number"
                      step="1000"
                      value={instSpxConfig.endRangeM}
                      onChange={(e) => updateSelectedSpx({ endRangeM: parseFloat(e.target.value) || 1000 })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-cyan-300 font-bold mb-1.5"
                    />

                    {/* Chips cự ly chọn nhanh */}
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { label: '35km', m: 35000 },
                        { label: '50km', m: 50000 },
                        { label: '75km', m: 75000 },
                        { label: '110km', m: 110000 },
                        { label: '145km', m: 145000 },
                        { label: '185km', m: 185000 },
                        { label: '230km', m: 230000 },
                        { label: '360km', m: 360000 },
                      ].map((chip) => (
                        <button
                          key={chip.m}
                          onClick={() => updateSelectedSpx({ endRangeM: chip.m })}
                          className={`py-1 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                            instSpxConfig.endRangeM === chip.m
                              ? 'bg-cyan-900 text-cyan-300 border-cyan-400 font-bold'
                              : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Độ cong Trái Đất 4/3 */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={instSpxConfig.earthCurvature}
                        onChange={(e) => updateSelectedSpx({ earthCurvature: e.target.checked })}
                        className="rounded text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                      <span className="font-mono text-[10.5px]">Độ cong Trái Đất (Curvature 4/3)</span>
                    </label>
                    <span className="text-[10px] text-cyan-400 font-mono">k = 1.333</span>
                  </div>

                  {/* Tầng độ cao mục tiêu (Target heights) */}
                  <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10.5px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5" /> Tầng độ cao mục tiêu (m):
                      </span>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name={`altRef_${selected.instanceId}`}
                            checked={instSpxConfig.altitudeReference === 'sea_level'}
                            onChange={() => updateSelectedSpx({ altitudeReference: 'sea_level' })}
                            className="text-cyan-500 focus:ring-0 cursor-pointer"
                          />
                          <span className={instSpxConfig.altitudeReference === 'sea_level' ? 'text-cyan-300' : 'text-slate-500'}>Sea Level</span>
                        </label>
                        <label className="flex items-center gap-1 cursor-pointer">
                          <input
                            type="radio"
                            name={`altRef_${selected.instanceId}`}
                            checked={instSpxConfig.altitudeReference === 'ground'}
                            onChange={() => updateSelectedSpx({ altitudeReference: 'ground' })}
                            className="text-cyan-500 focus:ring-0 cursor-pointer"
                          />
                          <span className={instSpxConfig.altitudeReference === 'ground' ? 'text-cyan-300' : 'text-slate-500'}>Ground</span>
                        </label>
                      </div>
                    </div>

                    {/* Chips phân tầng */}
                    <div className="grid grid-cols-4 gap-1.5">
                      {instSpxConfig.targetHeights.map((tier) => (
                        <div
                          key={tier.id}
                          className="p-1 rounded border text-center font-mono font-bold text-[10px] flex flex-col items-center justify-center gap-0.5"
                          style={{
                            backgroundColor: `${tier.color}20`,
                            borderColor: tier.color,
                            color: tier.color,
                          }}
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full border border-black/40"
                            style={{ backgroundColor: tier.color }}
                          />
                          <span>{tier.label}</span>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] text-slate-400 font-mono">Độ cao:</span>
                      <input
                        type="text"
                        defaultValue={heightsString}
                        onBlur={(e) => handleHeightsStringChange(e.target.value)}
                        placeholder="500 800 1000 2000"
                        className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-cyan-300 font-bold"
                      />
                    </div>
                  </div>

                  {/* Độ trong suốt & Vòng cự ly */}
                  <div className="space-y-1.5 pt-1 font-mono text-[10.5px]">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-slate-400">Độ trong suốt dải màu:</span>
                        <span className="text-cyan-300 font-bold">
                          {Math.round(instSpxConfig.coverageTransparency * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.05"
                        max="0.8"
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
                          className="rounded text-cyan-500 focus:ring-0 cursor-pointer"
                        />
                        <span className="text-slate-300">Vòng cự ly (Range rings)</span>
                      </label>
                      <span className="text-[9px] text-cyan-400">Tự động LOD culling</span>
                    </div>
                  </div>

                  {/* Thống kê vùng phủ thực tế */}
                  {activeSpxResult && activeSpxResult.contours.length > 0 && (
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[10px] font-mono space-y-1">
                      <span className="text-slate-400 block font-bold">Thống kê diện tích phát hiện:</span>
                      {activeSpxResult.contours.map((c) => (
                        <div key={c.tier.id} className="flex items-center justify-between">
                          <span style={{ color: c.tier.color }} className="font-bold">
                            Tầng {c.tier.label}:
                          </span>
                          <span className="text-slate-300">
                            Tầm: <strong>{(c.maxObservedRangeM / 1000).toFixed(0)}km</strong> • S:{' '}
                            <strong>{c.coverageAreaKm2.toLocaleString()} km²</strong>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Nếu là Tên lửa (SAM) hoặc Pháo (AAA): Vùng hỏa lực tiêu diệt mục tiêu */}
              {caps.hasEngagementEnvelope && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-rose-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-rose-400 font-mono flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-rose-400" />
                      VÙNG HỎA LỰC TIÊU DIỆT (ENGAGEMENT)
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-rose-300 font-mono font-bold">
                      {selected.category === 'TenLuaPhongKhong' ? 'TÊN LỬA PK (SAM)' : 'PHÁO PK (AAA)'}
                    </span>
                  </div>

                  {/* Cự ly diệt xa nhất R_kill */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1 font-mono">
                      <span className="text-slate-400">Bán kính hỏa lực cực đại (R_kill):</span>
                      <span className="text-rose-400 font-bold">{selected.rangeKm} km</span>
                    </div>
                    <input
                      type="range"
                      min={selected.category === 'PhaoPhongKhong' ? 1 : 10}
                      max={selected.category === 'PhaoPhongKhong' ? 15 : 300}
                      step={selected.category === 'PhaoPhongKhong' ? 0.5 : 5}
                      value={selected.rangeKm}
                      onChange={(e) =>
                        updateEquipment(selected.instanceId, { rangeKm: parseFloat(e.target.value) || 10 })
                      }
                      className="w-full accent-rose-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Cự ly diệt cực cận R_min & Trần bắn H_max */}
                  <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
                    <div>
                      <span className="text-[10px] text-slate-400">Cực cận R_min (km):</span>
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        max="50"
                        value={
                          selected.minEngagementRangeKm ??
                          (selected.category === 'TenLuaPhongKhong' ? 3 : 0.2)
                        }
                        onChange={(e) =>
                          updateEquipment(selected.instanceId, {
                            minEngagementRangeKm: parseFloat(e.target.value) || 0.1,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-rose-300 text-xs font-bold focus:border-rose-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400">Trần hỏa lực H_max (m):</span>
                      <input
                        type="number"
                        step="1000"
                        min="500"
                        max="50000"
                        value={
                          selected.maxEngagementAltitudeM ??
                          (selected.category === 'TenLuaPhongKhong' ? 27000 : 2500)
                        }
                        onChange={(e) =>
                          updateEquipment(selected.instanceId, {
                            maxEngagementAltitudeM: parseFloat(e.target.value) || 1000,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-rose-300 text-xs font-bold focus:border-rose-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Thời gian phản ứng & Phương thức dẫn bắn */}
                  <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 font-mono text-[10px] space-y-1">
                    {selected.reactionTimeSeconds !== undefined && (
                      <div className="flex justify-between items-center text-slate-300">
                        <span className="text-slate-400">Thời gian phản ứng (T_pư):</span>
                        <span className="font-bold text-amber-300">{selected.reactionTimeSeconds} giây</span>
                      </div>
                    )}
                    {selected.guidanceMethodVi && (
                      <div className="text-slate-300 pt-0.5">
                        <span className="text-slate-500 block text-[9px] uppercase tracking-wider">
                          Phương thức dẫn bắn:
                        </span>
                        <span className="text-rose-300 font-semibold leading-tight block">
                          {selected.guidanceMethodVi}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Nếu là Cảm biến thụ động ESM (Kolchuga-M) */}
              {caps.hasSensorNetwork && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-purple-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-purple-300 font-mono flex items-center gap-1">
                      <RadioTower className="w-3.5 h-3.5 text-purple-400" />
                      VÙNG TRINH SÁT THỤ ĐỘNG (ESM)
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-950/80 border border-purple-500/40 text-purple-300 font-mono font-bold">
                      KOLCHUGA-M
                    </span>
                  </div>

                  {/* Cự ly trinh sát thụ động */}
                  <div>
                    <div className="flex justify-between text-[11px] mb-1 font-mono">
                      <span className="text-slate-400">Cự ly trinh sát thụ động (R_esm):</span>
                      <span className="text-purple-300 font-bold">{selected.rangeKm} km</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="800"
                      step="20"
                      value={selected.rangeKm}
                      onChange={(e) =>
                        updateEquipment(selected.instanceId, {
                          rangeKm: parseFloat(e.target.value) || 600,
                        })
                      }
                      className="w-full accent-purple-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Dải tần số bức xạ thu nhận */}
                  <div className="p-2 rounded-lg bg-slate-950/70 border border-slate-800 font-mono text-[10.5px] space-y-1">
                    <div className="flex justify-between items-center text-slate-300">
                      <span className="text-slate-400">Dải tần số tiếp nhận:</span>
                      <span className="text-purple-300 font-bold">
                        {selected.frequencyRangeGhz || '0.1 - 18.0 GHz'}
                      </span>
                    </div>
                    <span className="text-[9.5px] text-slate-500 block">
                      Định vị TDoA / Đo hướng DF bức xạ radar đối phương
                    </span>
                  </div>

                  {/* Mạng đường cơ sở TDoA liên trạm */}
                  <div className="p-2 rounded-lg bg-slate-950/90 border border-purple-900/50 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-purple-300 font-mono flex items-center gap-1">
                        <Network className="w-3.5 h-3.5" /> Mạng TDoA ({otherEsmNodes.length} trạm lân cận)
                      </span>
                      <button
                        onClick={toggleSensorNetwork}
                        className={`px-2 py-0.5 rounded text-[9px] font-mono border font-bold cursor-pointer transition-all ${
                          showSensorNetwork
                            ? 'bg-purple-950 text-purple-300 border-purple-500/60'
                            : 'bg-slate-900 text-slate-500 border-slate-800'
                        }`}
                      >
                        {showSensorNetwork ? 'BẬT MẠNG' : 'ẨN MẠNG'}
                      </button>
                    </div>

                    {otherEsmNodes.length > 0 ? (
                      <div className="space-y-1">
                        {otherEsmNodes.map((node) => {
                          const distKm = computeDistanceKm(
                            selected.latitude,
                            selected.longitude,
                            node.latitude,
                            node.longitude
                          );
                          return (
                            <div
                              key={node.instanceId}
                              className="flex items-center justify-between text-[10px] font-mono bg-purple-950/30 p-1 rounded border border-purple-800/40 text-purple-200"
                            >
                              <span>⟷ {node.shortId ? `[${node.shortId}] ` : ''}{node.name}</span>
                              <strong className="text-amber-300">{distKm.toFixed(1)} km</strong>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-[9.5px] text-slate-500 italic">
                        Cần tối thiểu 2 trạm Kolchuga-M trên bản đồ để thiết lập mạng đo giao hội TDoA.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Quét / Sweep (Tốc độ quay 360°) */}
              {caps.hasSweep && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-1.5 font-mono text-[11px]">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Tốc độ quay ăng-ten 360°:</span>
                    <span className="text-cyan-300 font-bold">
                      {selected.scanSpeed ? `${selected.scanSpeed}°/s` : 'Không quay'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="60"
                    step="2"
                    value={selected.scanSpeed}
                    onChange={(e) => updateEquipment(selected.instanceId, { scanSpeed: parseFloat(e.target.value) })}
                    className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              )}
            </div>
          )}

          {/* ===================================================================== */}
          {/* NỘI DUNG TAB 3D / LOS — CHỈ DÀNH CHO PHÂN TÍCH KHÔNG GIAN VÀ ĐỊA HÌNH */}
          {/* ===================================================================== */}
          {activeTab === '3d' && (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* Trường hợp 1: Radar Cảnh Giới (RadarCanhGioi) - Vòm quét và Phân tích LOS 3D raycasting */}
              {caps.hasRadarCoverage && (
                <>
                  {/* Bật/Tắt Vòm 3D & Góc tà */}
                  <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5" /> HIỂN THỊ VÒM 3D & GÓC TÀ
                      </span>
                      <button
                        onClick={() =>
                          updateEquipment(selected.instanceId, {
                            showDome: !selected.showDome,
                          })
                        }
                        className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer ${
                          selected.showDome
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                            : 'bg-slate-950 text-slate-500 border-slate-800'
                        }`}
                      >
                        {selected.showDome ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        <span>{selected.showDome ? 'Đang bật' : 'Đang ẩn'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 font-mono text-[10.5px]">
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
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
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
                          className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 text-xs focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Phân tích Cắt địa hình & Line-of-sight (LOS) */}
                  <div className="bg-slate-900/60 p-2.5 rounded-xl border border-cyan-900/50 space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-[10px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5 text-cyan-400" />
                        CẮT ĐỊA HÌNH 3D & VÙNG MÙ (LOS)
                      </span>
                      <span className="text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">
                        k = 4/3
                      </span>
                    </div>

                    {/* Độ cao mục tiêu bay H_mt */}
                    <div>
                      <div className="flex justify-between text-[11px] mb-1 font-mono">
                        <span className="text-slate-400">Độ cao mục tiêu (H_mt):</span>
                        <span className="text-cyan-300 font-bold">{targetHeightMeters} m</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 mb-1.5">
                        {[
                          { label: '50m', value: 50 },
                          { label: '300m', value: 300 },
                          { label: '1km', value: 1000 },
                          { label: '5km', value: 5000 },
                        ].map((btn) => (
                          <button
                            key={btn.value}
                            onClick={() => setTargetHeightMeters(btn.value)}
                            className={`py-1 rounded text-[10px] font-mono border transition-all cursor-pointer ${
                              targetHeightMeters === btn.value
                                ? 'bg-cyan-950 text-cyan-300 border-cyan-500 font-bold shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                                : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                            }`}
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
                        onChange={(e) => setTargetHeightMeters(parseFloat(e.target.value))}
                        className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>

                    {/* Hiển thị tính toán công thức thực tế */}
                    <div className="grid grid-cols-2 gap-2 p-2 bg-slate-950 rounded-lg border border-slate-800 font-mono text-[10px]">
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
                        <span className="text-[9px] text-slate-600 block">H_mt · cotg ε_max</span>
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
                        <span className="text-[9px] text-slate-600 block">4.12·(√ha + √Hmt)</span>
                      </div>
                    </div>

                    {/* Trạng thái trường 3D */}
                    {coverageFields[selected.instanceId] && (
                      <div className="p-1.5 bg-slate-950 rounded border border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>Tia 3D: <strong className="text-cyan-300">{coverageFields[selected.instanceId].totalRays}</strong></span>
                        <span>Bị chắn: <strong className="text-rose-400">{coverageFields[selected.instanceId].occludedRaysCount}</strong></span>
                        <span>Tỷ lệ: <strong className="text-emerald-400">{coverageFields[selected.instanceId].coverageRatioPercent}%</strong></span>
                      </div>
                    )}

                    {/* Nút Mặt Cắt Quang Tuyến 2D (Cross Section) */}
                    <button
                      onClick={toggleCrossSection}
                      className={`w-full py-2 px-3 rounded-xl border font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        showCrossSection
                          ? 'bg-cyan-950 text-cyan-300 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)] ring-1 ring-cyan-400'
                          : 'bg-slate-950 hover:bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500/50'
                      }`}
                    >
                      <Compass
                        className={`w-4 h-4 ${showCrossSection ? 'animate-spin' : ''}`}
                        style={{ animationDuration: '6s' }}
                      />
                      <span>
                        {showCrossSection
                          ? 'Đang Xem Mặt Cắt 2D (Cross Section)'
                          : 'Mở Mặt Cắt Quang Tuyến 2D'}
                      </span>
                    </button>
                  </div>
                </>
              )}

              {/* Trường hợp 2: Tên Lửa Phòng Không (SAM) & Pháo Phòng Không (AAA) */}
              {caps.hasEngagementEnvelope && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-rose-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-rose-300 font-mono flex items-center gap-1">
                      <Target className="w-3.5 h-3.5 text-rose-400" />
                      VÒM HỎA LỰC ĐÁNH CHẶN 3D
                    </span>
                    <button
                      onClick={() =>
                        updateEquipment(selected.instanceId, {
                          showDome: !selected.showDome,
                        })
                      }
                      className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        selected.showDome
                          ? 'bg-rose-950 text-rose-300 border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                          : 'bg-slate-950 text-slate-500 border-slate-800'
                      }`}
                    >
                      {selected.showDome ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      <span>{selected.showDome ? 'Đang bật' : 'Đang ẩn'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                    <div className="p-1.5 bg-slate-950 rounded border border-slate-800">
                      <span className="text-slate-400 block">CỰ LY TIÊU DIỆT</span>
                      <strong className="text-rose-400">
                        {selected.minEngagementRangeKm ?? (selected.category === 'TenLuaPhongKhong' ? 3 : 0.2)} - {selected.rangeKm} km
                      </strong>
                    </div>
                    <div className="p-1.5 bg-slate-950 rounded border border-slate-800">
                      <span className="text-slate-400 block">TRẦN HỎA LỰC H_max</span>
                      <strong className="text-rose-400">
                        {((selected.maxEngagementAltitudeM || 27000) / 1000).toFixed(0)} km
                      </strong>
                    </div>
                  </div>

                  <p className="text-[9.5px] text-slate-400 italic">
                    Vòm hỏa lực 3D hiển thị thể tích không gian đánh chặn thực tế, tối ưu hóa hiển thị không ép quét sóng như đài radar.
                  </p>
                </div>
              )}

              {/* Trường hợp 3: Cảm Biến Thụ Động ESM (Kolchuga-M) */}
              {caps.hasSensorNetwork && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-purple-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-purple-300 font-mono flex items-center gap-1">
                      <RadioTower className="w-3.5 h-3.5 text-purple-400" />
                      VÒM TRINH SÁT THỤ ĐỘNG 3D
                    </span>
                    <button
                      onClick={() =>
                        updateEquipment(selected.instanceId, {
                          showDome: !selected.showDome,
                        })
                      }
                      className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        selected.showDome
                          ? 'bg-purple-950 text-purple-300 border-purple-500/60 shadow-[0_0_8px_rgba(168,85,247,0.3)]'
                          : 'bg-slate-950 text-slate-500 border-slate-800'
                      }`}
                    >
                      {selected.showDome ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      <span>{selected.showDome ? 'Đang bật' : 'Đang ẩn'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
                    <div className="p-1.5 bg-slate-950 rounded border border-slate-800">
                      <span className="text-slate-400 block">BÁN KÍNH TIẾP NHẬN</span>
                      <strong className="text-purple-300">{selected.rangeKm} km</strong>
                    </div>
                    <div className="p-1.5 bg-slate-950 rounded border border-slate-800">
                      <span className="text-slate-400 block">ĐỘ CAO TRINH SÁT</span>
                      <strong className="text-purple-300">{selected.coverageHeightKm || 40} km</strong>
                    </div>
                  </div>

                  <p className="text-[9.5px] text-slate-400 italic">
                    Vòm trinh sát thu sóng bức xạ thụ động toàn hướng không phát tín hiệu radar, giữ bí mật trận địa tuyệt đối.
                  </p>
                </div>
              )}

              {/* Trường hợp 4: Sở Chỉ Huy Tác Chiến C2 */}
              {caps.hasCommandLinks && (
                <div className="bg-slate-900/60 p-2.5 rounded-xl border border-amber-500/40 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-[10px] font-bold text-amber-300 font-mono flex items-center gap-1">
                      <Shield className="w-3.5 h-3.5 text-amber-400" />
                      PHẠM VI CHỈ HUY & ĐIỀU HÀNH TÁC CHIẾN C2
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 font-mono font-bold">
                      TRUNG TÂM C2
                    </span>
                  </div>

                  <div className="p-1.5 bg-slate-950 rounded border border-slate-800 font-mono text-[10px]">
                    <div className="flex justify-between text-slate-300">
                      <span className="text-slate-400">Bán kính điều phối hỏa lực:</span>
                      <strong className="text-amber-300">{selected.rangeKm} km</strong>
                    </div>
                  </div>

                  <p className="text-[9.5px] text-slate-400 italic">
                    Trung tâm xử lý sơ bộ & thứ cấp dữ liệu tình báo từ mạng radar và phân chia mục tiêu hỏa lực cho các tiểu đoàn tên lửa, pháo phòng không.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ======================================================================= */}
        {/* 5. NÂNG CAO (ADVANCED SECTIONS — PROGRESSIVE DISCLOSURE: ĐÓNG MẶC ĐỊNH) */}
        {/* ======================================================================= */}
        <div className="space-y-2 pt-1 border-t border-slate-800/80">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block font-mono">
            Dữ liệu kỹ thuật chuyên sâu
          </span>

          {/* Accordion 0: Thông Số Vũ Khí & Khí Tài Chuyên Sâu */}
          {(selected.guidanceMethodVi || selected.frequencyRangeGhz || selected.reactionTimeSeconds) && (
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden transition-all">
              <button
                onClick={() => setIsSpecsOpen(!isSpecsOpen)}
                className="w-full p-2.5 flex items-center justify-between text-left hover:bg-slate-850 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    Thông số Tác chiến & Quân sự Chi Tiết
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 shrink-0 ml-1">
                  <span className="text-[10px] font-mono text-amber-400">
                    Chi tiết
                  </span>
                  {isSpecsOpen ? (
                    <ChevronDown className="w-4 h-4 text-amber-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {isSpecsOpen && (
                <div className="p-2.5 pt-0 border-t border-slate-800/60 space-y-2 text-xs font-mono">
                  {selected.guidanceMethodVi && (
                    <div className="pt-2">
                      <span className="text-[10px] text-slate-500 block uppercase">Hệ thống dẫn bắn & Điều khiển:</span>
                      <span className="text-slate-200 font-semibold">{selected.guidanceMethodVi}</span>
                    </div>
                  )}
                  {selected.minEngagementRangeKm !== undefined && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Cự ly tiêu diệt cực cận (R_min):</span>
                      <strong className="text-rose-300">{selected.minEngagementRangeKm} km</strong>
                    </div>
                  )}
                  {selected.maxEngagementAltitudeM !== undefined && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Trần hỏa lực (H_max):</span>
                      <strong className="text-rose-300">{(selected.maxEngagementAltitudeM / 1000).toFixed(0)} km ({selected.maxEngagementAltitudeM}m)</strong>
                    </div>
                  )}
                  {selected.reactionTimeSeconds !== undefined && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Thời gian phản ứng hệ thống (T_pư):</span>
                      <strong className="text-amber-300">{selected.reactionTimeSeconds} giây</strong>
                    </div>
                  )}
                  {selected.frequencyRangeGhz && (
                    <div className="flex justify-between items-center py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Dải tần công tác tiếp nhận:</span>
                      <strong className="text-purple-300">{selected.frequencyRangeGhz}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Accordion 1: Coverage Profile (Giản đồ búp sóng) */}
          {selected.coverageProfile && (
            <div className="bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden transition-all">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="w-full p-2.5 flex items-center justify-between text-left hover:bg-slate-850 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    Coverage Profile ({selected.coverageProfile.name})
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 shrink-0 ml-1">
                  <span className="text-[10px] font-mono text-cyan-400">
                    {selected.coverageProfile.points.length} điểm
                  </span>
                  {isProfileOpen ? (
                    <ChevronDown className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {isProfileOpen && (
                <div className="p-2.5 pt-0 border-t border-slate-800/60 space-y-2 text-xs">
                  <p className="text-[10px] text-slate-400 pt-2">
                    Giới hạn cự ly theo từng góc tà (nội suy liên tục theo búp sóng thực tế):
                  </p>
                  <div className="grid grid-cols-3 gap-1 font-mono text-[10px]">
                    {selected.coverageProfile.points.map((pt, idx) => (
                      <div
                        key={idx}
                        className="bg-slate-950 p-1.5 rounded border border-slate-800 text-center"
                      >
                        <span className="text-slate-500 block">{pt.elevationDeg}°</span>
                        <span className="text-cyan-300 font-bold">{pt.maxRangeKm} km</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Accordion 2: Bảng Tầm Radar Theo Độ Cao Mục Tiêu */}
          {selected.altitudeDetectionTable && (
            <div className="bg-slate-900/60 rounded-xl border border-cyan-500/40 overflow-hidden transition-all shadow-[0_0_12px_rgba(6,182,212,0.1)]">
              <button
                onClick={() => setIsAltitudeTableOpen(!isAltitudeTableOpen)}
                className="w-full p-2.5 flex items-center justify-between text-left hover:bg-slate-850 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Table2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-xs font-semibold text-cyan-300 truncate">
                    Bảng Tầm Radar Theo Độ Cao (Chuẩn Tài Liệu)
                  </span>
                </div>
                <div className="flex items-center gap-1 text-slate-400 shrink-0 ml-1">
                  <span className="text-[9px] text-amber-300 font-mono bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-500/30">
                    m ➜ km
                  </span>
                  {isAltitudeTableOpen ? (
                    <ChevronDown className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </div>
              </button>

              {isAltitudeTableOpen && (
                <div className="p-2.5 pt-0 border-t border-slate-800/60 space-y-2 text-xs">
                  <p className="text-[10px] text-slate-400 pt-2">
                    Nhấp vào từng hàng để áp dụng ngay cự ly trinh sát tương ứng với tầng độ cao mục tiêu:
                  </p>

                  <div className="overflow-x-auto rounded border border-slate-800">
                    <table className="w-full text-[10px] text-left font-mono">
                      <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                        <tr>
                          {selected.altitudeDetectionTable.headers.map((h, i) => (
                            <th
                              key={i}
                              className={`p-1.5 font-bold ${
                                i === 0 ? 'text-slate-300' : 'text-cyan-300 text-center'
                              }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                        {selected.altitudeDetectionTable.rows.map((row, idx) => {
                          const numVal1 =
                            typeof row.val1 === 'number'
                              ? row.val1
                              : parseFloat(String(row.val1));
                          const numVal2 =
                            row.val2 !== undefined && row.val2 !== '-'
                              ? typeof row.val2 === 'number'
                                ? row.val2
                                : parseFloat(String(row.val2))
                              : undefined;
                          const isRowActive =
                            (!isNaN(numVal1) && selected.rangeKm === numVal1) ||
                            (numVal2 !== undefined &&
                              !isNaN(numVal2) &&
                              selected.rangeKm === numVal2);

                          return (
                            <tr
                              key={idx}
                              onClick={() => {
                                const targetKm = !isNaN(numVal1) ? numVal1 : numVal2;
                                if (targetKm && !isNaN(targetKm)) {
                                  updateSelectedSpx({ endRangeM: targetKm * 1000 });
                                }
                              }}
                              className={`hover:bg-cyan-950/40 cursor-pointer transition-colors ${
                                isRowActive
                                  ? 'bg-cyan-950/70 text-cyan-200 font-bold border-l-2 border-cyan-400'
                                  : 'text-slate-300'
                              }`}
                              title={`Bấm để chọn cự ly ${row.val1} km ở độ cao ${row.altitudeM}m`}
                            >
                              <td className="p-1.5 font-bold text-amber-300 whitespace-nowrap">
                                {row.altitudeM >= 1000
                                  ? `${(row.altitudeM / 1000).toLocaleString()} km (${row.altitudeM}m)`
                                  : `${row.altitudeM} m`}
                              </td>
                              <td className="p-1.5 text-center font-bold text-cyan-300 whitespace-nowrap">
                                {row.val1 !== '-' ? `${row.val1} km` : '-'}
                              </td>
                              {selected.altitudeDetectionTable!.headers.length > 2 && (
                                <td
                                  className="p-1.5 text-center font-bold text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                                  onClick={(e) => {
                                    if (numVal2 && !isNaN(numVal2)) {
                                      e.stopPropagation();
                                      updateSelectedSpx({ endRangeM: numVal2 * 1000 });
                                    }
                                  }}
                                >
                                  {row.val2 !== undefined && row.val2 !== '-'
                                    ? `${row.val2} km`
                                    : '-'}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
