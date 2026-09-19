import React, { useState, useMemo } from 'react';
import {
  X,
  Radio,
  Layers,
  Sparkles,
  Maximize2,
  Minimize2,
  HelpCircle,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { SpxTargetHeightTier } from '../../types/spxRadarCoverage';

export const SpxRadarCoveragePanel: React.FC = () => {
  const {
    showSpxPanel,
    setShowSpxPanel,
    spxConfig,
    updateSpxConfig,
    spxResults,
    isCalculatingSpx,
    instances,
    selectedInstanceId,
    updateEquipment,
    addEquipment,
    selectEquipment,
    triggerFlyTo,
  } = useTacticalStore();

  const [posFormat, setPosFormat] = useState<'dms' | 'decimal'>('dms');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);

  // Tìm đài radar đang chọn (hoặc đài đầu tiên có thể mô phỏng)
  const currentRadar = useMemo(() => {
    if (selectedInstanceId) {
      const found = instances.find((i) => i.instanceId === selectedInstanceId);
      if (found) return found;
    }
    return instances.find((i) => i.rangeKm > 0) || instances[0] || null;
  }, [instances, selectedInstanceId]);

  const activeResult = currentRadar ? spxResults[currentRadar.instanceId] : null;

  // Đặt nhanh vị trí đài mẫu Sơn Trà - Đà Nẵng (Ảnh SPx)
  const handleSetPresetDaNang = () => {
    const danangLat = 16.043;
    const danangLon = 108.1208;
    if (currentRadar) {
      updateEquipment(currentRadar.instanceId, {
        latitude: danangLat,
        longitude: danangLon,
        antennaHeightAGL: 40,
        rangeKm: 50,
      });
      triggerFlyTo({
        id: 'danang_spx',
        name: 'Đà Nẵng (Ảnh mẫu SPx)',
        latitude: danangLat,
        longitude: danangLon,
        height: 95000,
      });
    } else {
      const newId = `eq_radar_danang_${Date.now()}`;
      addEquipment({
        instanceId: newId,
        templateId: 'radar_36d6',
        name: 'Trạm Radar Sơn Trà - Đà Nẵng (Ảnh SPx)',
        category: 'RadarCanhGioi',
        latitude: danangLat,
        longitude: danangLon,
        altitude: 103,
        antennaHeightAGL: 40,
        rangeKm: 50,
        scanSpeed: 30,
        minElevationDeg: -10,
        maxElevationDeg: 40,
        coverageHeightKm: 20,
        status: 'Active',
        commandedByInstanceId: null,
        color: '#06b6d4',
        showDome: true,
        showSweep: false,
      });
      selectEquipment(newId);
      triggerFlyTo({
        id: 'danang_spx',
        name: 'Đà Nẵng (Ảnh mẫu SPx)',
        latitude: danangLat,
        longitude: danangLon,
        height: 95000,
      });
    }
  };

  if (!showSpxPanel) return null;

  // Helper chuyển thập phân sang Độ, Phút, Giây
  const toDms = (deg: number) => {
    const d = Math.floor(Math.abs(deg));
    const minFloat = (Math.abs(deg) - d) * 60;
    const m = Math.floor(minFloat);
    const s = Number(((minFloat - m) * 60).toFixed(1));
    return { d, m, s, dir: deg >= 0 ? 1 : -1 };
  };

  const latDms = currentRadar ? toDms(currentRadar.latitude) : { d: 16, m: 2, s: 34.8, dir: 1 };
  const lonDms = currentRadar ? toDms(currentRadar.longitude) : { d: 108, m: 7, s: 14.9, dir: 1 };

  // Xử lý thay đổi toạ độ theo DMS
  const handleDmsChange = (
    coord: 'lat' | 'lon',
    part: 'd' | 'm' | 's',
    value: number
  ) => {
    if (!currentRadar) return;
    const current = coord === 'lat' ? latDms : lonDms;
    const newD = part === 'd' ? value : current.d;
    const newM = part === 'm' ? value : current.m;
    const newS = part === 's' ? value : current.s;
    const sign = current.dir;
    const newDecimal = sign * (newD + newM / 60 + newS / 3600);

    updateEquipment(currentRadar.instanceId, {
      [coord === 'lat' ? 'latitude' : 'longitude']: newDecimal,
    });
  };

  // Cập nhật tầng độ cao từ chuỗi (e.g. "500 800 1000 2000")
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

    updateSpxConfig({ targetHeights: newTiers });
  };

  const heightsString = spxConfig.targetHeights.map((t) => t.heightMeters).join(' ');

  return (
    <div
      className={`fixed left-3 top-16 z-40 bg-slate-900/95 border border-cyan-500/40 rounded-xl shadow-2xl backdrop-blur-md text-slate-200 select-none flex flex-col transition-all duration-200 ${
        isMinimized ? 'w-80' : 'w-96 max-h-[88vh]'
      }`}
      style={{ boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 15px rgba(6, 182, 212, 0.2)' }}
    >
      {/* Header chuẩn SPx */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-950/90 border-b border-cyan-900/50 rounded-t-xl shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-cyan-950/80 border border-cyan-500/60 flex items-center justify-center text-cyan-400">
            <Radio className="w-3.5 h-3.5" />
          </div>
          <div>
            <h2 className="text-xs font-bold tracking-wider text-cyan-300 font-mono">
              SPx RADAR COVERAGE
            </h2>
            <p className="text-[10px] text-slate-400">Cambridge Pixel • DEM 2D Coverage</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {isCalculatingSpx && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 font-mono animate-pulse mr-1">
              <Sparkles className="w-3 h-3" /> Đang quét DEM...
            </span>
          )}
          <button
            onClick={() => setShowHelpModal(true)}
            title="Trợ giúp"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-cyan-300 transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            {isMinimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setShowSpxPanel(false)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body Controls */}
      {!isMinimized && (
        <div className="p-3.5 space-y-3 overflow-y-auto font-sans text-xs">
          {/* Thông tin đài radar đang chọn */}
          <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-mono text-cyan-400 font-bold">
                {currentRadar ? currentRadar.name : 'Chưa chọn đài radar'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300 font-mono">
                {activeResult?.terrainStatus === 'dem_loaded'
                  ? 'DEM 3D Chuẩn'
                  : 'Đang kết nối DEM'}
              </span>
            </div>
            {currentRadar && (
              <p className="text-[11px] text-slate-400 font-mono">
                Cao độ mặt đất: <strong>{activeResult ? activeResult.groundElevationM : 0}m</strong> (MSL) • Anten:{' '}
                <strong>{spxConfig.radarHeightAGL}m</strong> (AGL)
              </p>
            )}

            <button
              onClick={handleSetPresetDaNang}
              className="w-full mt-2 py-1 px-2 rounded bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] flex items-center justify-center gap-1.5 transition-colors shadow-sm"
              title="Đặt đài radar tại Sơn Trà - Đà Nẵng với toạ độ và thông số giống hệt ảnh mẫu SPx"
            >
              <span>🎯 Đặt đài mẫu Đà Nẵng (16°02'34.8"N, 108°07'14.9"E)</span>
            </button>
          </div>

          {/* 1. Position */}
          <div className="p-2.5 rounded-lg bg-slate-950/40 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 font-mono">Position</span>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="posFormat"
                    checked={posFormat === 'dms'}
                    onChange={() => setPosFormat('dms')}
                    className="text-cyan-500 focus:ring-0"
                  />
                  <span>DMS</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="posFormat"
                    checked={posFormat === 'decimal'}
                    onChange={() => setPosFormat('decimal')}
                    className="text-cyan-500 focus:ring-0"
                  />
                  <span>Decimal</span>
                </label>
              </div>
            </div>

            {posFormat === 'dms' && currentRadar ? (
              <div className="space-y-1.5 font-mono text-[11px]">
                {/* Latitude */}
                <div className="flex items-center gap-1">
                  <span className="w-16 text-slate-400">Latitude:</span>
                  <input
                    type="number"
                    value={latDms.d}
                    onChange={(e) => handleDmsChange('lat', 'd', Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>°</span>
                  <input
                    type="number"
                    value={latDms.m}
                    onChange={(e) => handleDmsChange('lat', 'm', Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>'</span>
                  <input
                    type="number"
                    step="0.1"
                    value={latDms.s}
                    onChange={(e) => handleDmsChange('lat', 's', Number(e.target.value))}
                    className="w-14 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>" N</span>
                </div>

                {/* Longitude */}
                <div className="flex items-center gap-1">
                  <span className="w-16 text-slate-400">Longitude:</span>
                  <input
                    type="number"
                    value={lonDms.d}
                    onChange={(e) => handleDmsChange('lon', 'd', Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>°</span>
                  <input
                    type="number"
                    value={lonDms.m}
                    onChange={(e) => handleDmsChange('lon', 'm', Number(e.target.value))}
                    className="w-10 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>'</span>
                  <input
                    type="number"
                    step="0.1"
                    value={lonDms.s}
                    onChange={(e) => handleDmsChange('lon', 's', Number(e.target.value))}
                    className="w-14 bg-slate-900 border border-slate-700 rounded px-1 text-center text-xs"
                  />
                  <span>" E</span>
                </div>
              </div>
            ) : currentRadar ? (
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <div>
                  <label className="text-slate-400 block mb-0.5">Lat:</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={currentRadar.latitude}
                    onChange={(e) =>
                      updateEquipment(currentRadar.instanceId, {
                        latitude: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-0.5">Lon:</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={currentRadar.longitude}
                    onChange={(e) =>
                      updateEquipment(currentRadar.instanceId, {
                        longitude: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* 2. Cấu hình hình học Anten & Cự ly */}
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div>
              <label className="text-slate-400 block mb-0.5">
                Radar height (AGL):
              </label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="1"
                  value={spxConfig.radarHeightAGL}
                  onChange={(e) =>
                    updateSpxConfig({
                      radarHeightAGL: Math.max(1, parseFloat(e.target.value) || 1),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-cyan-300 font-bold"
                />
                <span className="text-slate-500">m</span>
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-0.5">End range (m):</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="5000"
                  value={spxConfig.endRangeM}
                  onChange={(e) =>
                    updateSpxConfig({
                      endRangeM: Math.max(1000, parseFloat(e.target.value) || 50000),
                    })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-amber-300 font-bold"
                />
                <span className="text-slate-500">m</span>
              </div>
            </div>
          </div>

          {/* Quick End Range Presets */}
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-slate-500">Tầm:</span>
            {[30000, 50000, 75000, 100000].map((r) => (
              <button
                key={r}
                onClick={() => updateSpxConfig({ endRangeM: r })}
                className={`px-2 py-0.5 rounded border transition-colors ${
                  spxConfig.endRangeM === r
                    ? 'bg-cyan-950 text-cyan-300 border-cyan-500/60 font-bold'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                }`}
              >
                {r / 1000}km
              </button>
            ))}
          </div>

          {/* 3. Beam Angles & Curvature */}
          <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
            <div>
              <label className="text-slate-400 block mb-0.5">Beam angles (°):</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="1"
                  value={spxConfig.minElevationDeg}
                  onChange={(e) =>
                    updateSpxConfig({ minElevationDeg: parseFloat(e.target.value) || -10 })
                  }
                  className="w-1/2 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-center"
                />
                <span className="text-slate-500">to</span>
                <input
                  type="number"
                  step="1"
                  value={spxConfig.maxElevationDeg}
                  onChange={(e) =>
                    updateSpxConfig({ maxElevationDeg: parseFloat(e.target.value) || 40 })
                  }
                  className="w-1/2 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs text-center"
                />
              </div>
            </div>

            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 pt-3">
                <input
                  type="checkbox"
                  checked={spxConfig.earthCurvature}
                  onChange={(e) => updateSpxConfig({ earthCurvature: e.target.checked })}
                  className="rounded text-cyan-500 focus:ring-0"
                />
                <span className="font-mono text-[11px]">Curvature of Earth (4/3)</span>
              </label>
            </div>
          </div>

          {/* 4. Target heights (m) - Bảng Dãy Màu Chuẩn SPx */}
          <div className="p-2.5 rounded-lg bg-slate-950/60 border border-cyan-900/40 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-cyan-300 font-mono flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> Target heights (m):
              </span>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="altRef"
                    checked={spxConfig.altitudeReference === 'sea_level'}
                    onChange={() => updateSpxConfig({ altitudeReference: 'sea_level' })}
                    className="text-cyan-500 focus:ring-0"
                  />
                  <span>Sea Level</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="altRef"
                    checked={spxConfig.altitudeReference === 'ground'}
                    onChange={() => updateSpxConfig({ altitudeReference: 'ground' })}
                    className="text-cyan-500 focus:ring-0"
                  />
                  <span>Ground</span>
                </label>
              </div>
            </div>

            {/* Các chip màu tương ứng với từng tầng độ cao */}
            <div className="grid grid-cols-4 gap-1.5">
              {spxConfig.targetHeights.map((tier) => (
                <div
                  key={tier.id}
                  className="p-1.5 rounded border text-center font-mono font-bold text-[11px] shadow-sm flex flex-col items-center justify-center gap-0.5"
                  style={{
                    backgroundColor: `${tier.color}20`,
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

            {/* Input chỉnh sửa nhanh danh sách độ cao */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[10px] text-slate-400 font-mono">Chuỗi độ cao:</span>
              <input
                type="text"
                defaultValue={heightsString}
                onBlur={(e) => handleHeightsStringChange(e.target.value)}
                placeholder="500 800 1000 2000"
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-cyan-300"
              />
            </div>
          </div>

          {/* 5. Coverage Transparency & Range Rings */}
          <div className="space-y-2 pt-1 border-t border-slate-800 font-mono text-[11px]">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-slate-400">Coverage transparency:</span>
                <span className="text-cyan-300 font-bold">
                  {Math.round(spxConfig.coverageTransparency * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={spxConfig.coverageTransparency}
                onChange={(e) =>
                  updateSpxConfig({ coverageTransparency: parseFloat(e.target.value) })
                }
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={spxConfig.showRangeRings}
                  onChange={(e) => updateSpxConfig({ showRangeRings: e.target.checked })}
                  className="rounded text-cyan-500 focus:ring-0"
                />
                <span className="text-slate-300">Vòng cự ly (Range rings - 5km)</span>
              </label>
              <span className="text-[10px] text-slate-500">Mỗi 5000m</span>
            </div>
          </div>

          {/* 6. Thống kê vùng phủ */}
          {activeResult && activeResult.contours.length > 0 && (
            <div className="p-2 rounded bg-slate-950/40 border border-slate-800 text-[10px] font-mono space-y-1">
              <span className="text-slate-400 block font-bold">Thống kê vùng phủ thực tế:</span>
              {activeResult.contours.map((c) => (
                <div key={c.tier.id} className="flex items-center justify-between">
                  <span style={{ color: c.tier.color }}>
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

      {/* Modal Trợ Giúp */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-cyan-500/50 rounded-xl p-4 max-w-md text-xs text-slate-300 space-y-3 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="font-bold text-cyan-300 font-mono flex items-center gap-1.5">
                <Radio className="w-4 h-4" /> VỀ PHẦN MỀM SPx RADAR COVERAGE
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="p-1 rounded hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p>
              Đây là hệ thống mô phỏng vùng phủ sóng radar đa tầng độ cao theo chuẩn <strong>SPx Radar Coverage</strong> của tập đoàn <strong>Cambridge Pixel (Anh Quốc)</strong>.
            </p>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-400">
              <li>
                <strong>Dãy màu phân tầng:</strong> Các màu đại diện cho độ cao mục tiêu khác nhau (ví dụ: Xanh 500m, Vàng 800m, Cam 1000m, Đỏ 2000m).
              </li>
              <li>
                <strong>Độ loang theo DEM:</strong> Các tia radar được quét qua dữ liệu địa hình 3D thực tế. Đỉnh núi che khuất sẽ tạo ra các góc lẹm, vùng bóng râm (shadow) chuẩn xác.
              </li>
              <li>
                <strong>Độ cong Trái Đất 4/3:</strong> Mô hình chuẩn khúc xạ khí quyển quân sự k=4/3, khiến mục tiêu ở xa bị sụt giảm theo quy luật d² / (2·R_eff).
              </li>
            </ul>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded"
              >
                Đã Hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
