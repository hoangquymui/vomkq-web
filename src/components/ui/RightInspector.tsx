import React from 'react';
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
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { OperationalStatus } from '../../types/equipment';

export const RightInspector: React.FC = () => {
  const {
    instances,
    selectedInstanceId,
    selectEquipment,
    updateEquipment,
    removeEquipment,
    triggerFlyTo,
  } = useTacticalStore();

  const selected = instances.find((i) => i.instanceId === selectedInstanceId);

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
          <div className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: selected.color }}
            />
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
        <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-2">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span>Toạ độ địa lý (WGS-84)</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-slate-500 font-mono">VĨ ĐỘ (LAT)</span>
              <input
                type="number"
                step="0.001"
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
                step="0.001"
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
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
            <div>
              <span className="text-[10px] text-slate-500 font-mono">ĐỘ CAO ĐẤT (ASL)</span>
              <span className="block text-slate-300 font-mono text-xs py-1">
                {selected.altitude} m
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 font-mono">THÁP ĂNG-TEN (AGL)</span>
              <input
                type="number"
                value={selected.antennaHeightAGL}
                onChange={(e) =>
                  updateEquipment(selected.instanceId, {
                    antennaHeightAGL: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
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
                {selected.rangeKm} km
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="500"
              step="5"
              value={selected.rangeKm}
              onChange={(e) =>
                updateEquipment(selected.instanceId, {
                  rangeKm: parseFloat(e.target.value),
                })
              }
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
                onChange={(e) =>
                  updateEquipment(selected.instanceId, {
                    minElevationDeg: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <span className="text-[10px] text-slate-400">Góc tà max (°)</span>
              <input
                type="number"
                value={selected.maxElevationDeg}
                onChange={(e) =>
                  updateEquipment(selected.instanceId, {
                    maxElevationDeg: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full bg-slate-950 border border-slate-700 px-2 py-1 rounded text-slate-200 font-mono text-xs focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

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
                {useTacticalStore.getState().targetHeightMeters} m
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
                  onClick={() => useTacticalStore.getState().setTargetHeightMeters(btn.value)}
                  className={`py-1 rounded text-[10px] font-mono border transition-all ${
                    useTacticalStore.getState().targetHeightMeters === btn.value
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
              value={useTacticalStore.getState().targetHeightMeters}
              onChange={(e) =>
                useTacticalStore.getState().setTargetHeightMeters(parseFloat(e.target.value))
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
                  (useTacticalStore.getState().targetHeightMeters *
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
                    Math.sqrt(useTacticalStore.getState().targetHeightMeters))
                ).toFixed(1)}{' '}
                km
              </span>
              <span className="text-[9px] text-slate-500 block">4.12·(√ha + √Hmt)</span>
            </div>
          </div>

          {/* Công tắc Bật/Tắt Vùng mù địa hình (Đỏ) */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
            <span className="text-slate-300 text-[11px] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" />
              <span>Hiện Vùng Mù Địa Hình</span>
            </span>
            <button
              onClick={() => useTacticalStore.getState().toggleBlindZones()}
              className={`px-2 py-1 rounded text-[10px] font-semibold border transition-all ${
                useTacticalStore.getState().showBlindZones
                  ? 'bg-rose-950 text-rose-300 border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                  : 'bg-slate-950 text-slate-500 border-slate-800'
              }`}
            >
              {useTacticalStore.getState().showBlindZones ? 'BẬT (MÀU ĐỎ)' : 'TẮT'}
            </button>
          </div>
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
