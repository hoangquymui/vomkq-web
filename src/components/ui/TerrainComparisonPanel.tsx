import React, { useState, useMemo } from 'react';
import {
  X,
  Mountain,
  Layers,
  Eye,
  EyeOff,
  AlertTriangle,
  Play,
  Info,
  Loader2,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import {
  runTerrainComparison,
  type ObserverComparisonPoint,
} from '../../utils/terrainComparisonEngine';

interface TerrainComparisonPanelProps {
  terrainProvider: any | null; // Cesium.TerrainProvider
}

export const TerrainComparisonPanel: React.FC<TerrainComparisonPanelProps> = ({
  terrainProvider,
}) => {
  const {
    instances,
    showTerrainComparison,
    setShowTerrainComparison,
    terrainComparisonResult,
    setTerrainComparisonResult,
    terrainComparisonLayers,
    toggleTerrainComparisonLayer,
  } = useTacticalStore(
    useShallow((state) => ({
      instances: state.instances,
      showTerrainComparison: state.showTerrainComparison,
      setShowTerrainComparison: state.setShowTerrainComparison,
      terrainComparisonResult: state.terrainComparisonResult,
      setTerrainComparisonResult: state.setTerrainComparisonResult,
      terrainComparisonLayers: state.terrainComparisonLayers,
      toggleTerrainComparisonLayer: state.toggleTerrainComparisonLayer,
    }))
  );

  // Lọc danh sách khí tài phù hợp làm Observer (Loại trừ S-300PMU2 theo ngoại lệ nghiêm ngặt)
  const availableObservers = useMemo(() => {
    return instances.filter((inst) => {
      // Ngoại lệ S-300PMU2: Không áp dụng tính năng so sánh mới
      if (inst.templateId === 'sam_s300') return false;
      return (
        typeof inst.latitude === 'number' &&
        typeof inst.longitude === 'number' &&
        !isNaN(inst.latitude) &&
        !isNaN(inst.longitude)
      );
    });
  }, [instances]);

  const [selectedAId, setSelectedAId] = useState<string>('');
  const [selectedBId, setSelectedBId] = useState<string>('');
  const [targetHeightM, setTargetHeightM] = useState<number>(100);
  const [antennaAglA, setAntennaAglA] = useState<number>(15);
  const [antennaAglB, setAntennaAglB] = useState<number>(15);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Thiết lập mặc định nếu chưa chọn
  React.useEffect(() => {
    if (availableObservers.length >= 2) {
      if (!selectedAId) setSelectedAId(availableObservers[0].instanceId);
      if (!selectedBId) setSelectedBId(availableObservers[1].instanceId);
    } else if (availableObservers.length === 1 && !selectedAId) {
      setSelectedAId(availableObservers[0].instanceId);
    }
  }, [availableObservers, selectedAId, selectedBId]);

  const instA = useMemo(
    () => availableObservers.find((i) => i.instanceId === selectedAId),
    [availableObservers, selectedAId]
  );
  const instB = useMemo(
    () => availableObservers.find((i) => i.instanceId === selectedBId),
    [availableObservers, selectedBId]
  );

  const handleRunComparison = async () => {
    if (!instA || !instB) {
      setErrorMsg('Vui lòng chọn đủ 2 vị trí quan sát A và B trên trận địa.');
      return;
    }
    if (instA.instanceId === instB.instanceId) {
      setErrorMsg('Vị trí A và Vị trí B phải là hai địa điểm khác nhau.');
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const obsA: ObserverComparisonPoint = {
        id: instA.instanceId,
        name: instA.name,
        latitude: instA.latitude,
        longitude: instA.longitude,
        altitudeASL: instA.altitude || 0,
        antennaHeightAGL: antennaAglA,
        rangeKm: instA.rangeKm || 40,
        templateId: instA.templateId,
      };

      const obsB: ObserverComparisonPoint = {
        id: instB.instanceId,
        name: instB.name,
        latitude: instB.latitude,
        longitude: instB.longitude,
        altitudeASL: instB.altitude || 0,
        antennaHeightAGL: antennaAglB,
        rangeKm: instB.rangeKm || 40,
        templateId: instB.templateId,
      };

      const result = await runTerrainComparison(obsA, obsB, terrainProvider, {
        azimuthStepDeg: 5,
        targetHeightMeters: targetHeightM,
      });

      setTerrainComparisonResult(result);
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi tính toán so sánh địa hình.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!showTerrainComparison) return null;

  return (
    <div className="fixed top-16 right-4 z-40 w-96 max-h-[85vh] bg-slate-950/95 backdrop-blur-xl border border-cyan-500/60 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.85)] flex flex-col text-slate-100 font-sans select-none overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200">
      {/* Header */}
      <div className="p-3 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mountain className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            SO SÁNH ĐỊA HÌNH GIS (A vs B)
          </h3>
        </div>
        <button
          onClick={() => setShowTerrainComparison(false)}
          className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
          title="Đóng bảng so sánh"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3.5 overflow-y-auto text-xs">
        {/* Chú thích giới hạn kỹ thuật */}
        <div className="p-2 rounded bg-cyan-950/40 border border-cyan-800/40 text-[10px] text-cyan-200/90 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Chức năng phân tích không gian GIS phục vụ trực quan hóa & huấn luyện mô phỏng. Không quy đổi kết quả thành năng lực khai hỏa thực tế.
          </span>
        </div>

        {/* 1. Chọn 2 Vị trí Quan sát */}
        <div className="space-y-2">
          <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-cyan-300">
              <span>Vị trí Quan sát A:</span>
              <span className="font-mono text-[10px] text-slate-400">
                Cao độ ASL: {instA?.altitude || 0}m
              </span>
            </div>
            <select
              value={selectedAId}
              onChange={(e) => setSelectedAId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              {availableObservers.map((inst) => (
                <option key={inst.instanceId} value={inst.instanceId}>
                  [{inst.shortId || 'ĐÀI'}] {inst.name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>Chiều cao ăng-ten AGL:</span>
              <input
                type="number"
                min="1"
                max="100"
                value={antennaAglA}
                onChange={(e) => setAntennaAglA(Number(e.target.value) || 15)}
                className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-right text-cyan-300"
              />
              <span>m</span>
            </div>
          </div>

          <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-bold text-fuchsia-300">
              <span>Vị trí Quan sát B:</span>
              <span className="font-mono text-[10px] text-slate-400">
                Cao độ ASL: {instB?.altitude || 0}m
              </span>
            </div>
            <select
              value={selectedBId}
              onChange={(e) => setSelectedBId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
            >
              {availableObservers.map((inst) => (
                <option key={inst.instanceId} value={inst.instanceId}>
                  [{inst.shortId || 'ĐÀI'}] {inst.name}
                </option>
              ))}
            </select>
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>Chiều cao ăng-ten AGL:</span>
              <input
                type="number"
                min="1"
                max="100"
                value={antennaAglB}
                onChange={(e) => setAntennaAglB(Number(e.target.value) || 15)}
                className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-right text-fuchsia-300"
              />
              <span>m</span>
            </div>
          </div>

          {/* Độ cao mục tiêu khảo sát H_mt */}
          <div className="flex items-center justify-between px-1 text-[11px] font-mono text-amber-300">
            <span>Độ cao mục tiêu (H_mt):</span>
            <div className="flex items-center gap-1">
              {[50, 100, 200, 500].map((h) => (
                <button
                  key={h}
                  onClick={() => setTargetHeightM(h)}
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    targetHeightM === h
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-900 text-slate-300 border-slate-800'
                  }`}
                >
                  {h}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Nút hành động */}
        <button
          onClick={handleRunComparison}
          disabled={isLoading || availableObservers.length < 2}
          className={`w-full py-2 px-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
            isLoading || availableObservers.length < 2
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
              : 'bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-950/50 cursor-pointer'
          }`}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              <span>Đang lấy mẫu địa hình DEM...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              <span>Phân Tích & So Sánh Địa Hình</span>
            </>
          )}
        </button>

        {errorMsg && (
          <div className="p-2 rounded bg-rose-950/80 border border-rose-600 text-[10.5px] text-rose-200 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 2. Kết quả Thống kê Định lượng */}
        {terrainComparisonResult && (
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
              <span>KẾT QUẢ PHÂN TÍCH DIỆN TÍCH:</span>
              <span className="text-[10px] font-mono text-cyan-400">
                {terrainComparisonResult.stats.totalSamples} điểm mẫu
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 font-mono text-[10.5px]">
              <div className="p-2 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300">
                <div className="text-[9px] text-slate-400">Cùng quan sát được (A ∩ B)</div>
                <div className="text-sm font-bold mt-0.5">
                  {terrainComparisonResult.stats.overlapVisiblePercent}%
                </div>
              </div>

              <div className="p-2 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300">
                <div className="text-[9px] text-slate-400">Mù chung do địa hình</div>
                <div className="text-sm font-bold mt-0.5">
                  {terrainComparisonResult.stats.mutualBlindPercent}%
                </div>
              </div>

              <div className="p-2 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                <div className="text-[9px] text-slate-400">Chỉ Vị trí A thấy</div>
                <div className="text-sm font-bold mt-0.5">
                  {terrainComparisonResult.stats.onlyAVisiblePercent}%
                </div>
              </div>

              <div className="p-2 rounded bg-fuchsia-950/60 border border-fuchsia-500/40 text-fuchsia-300">
                <div className="text-[9px] text-slate-400">Chỉ Vị trí B thấy</div>
                <div className="text-sm font-bold mt-0.5">
                  {terrainComparisonResult.stats.onlyBVisiblePercent}%
                </div>
              </div>
            </div>

            {terrainComparisonResult.terrainStatus !== 'loaded' && (
              <div className="p-2 rounded bg-amber-950/80 border border-amber-600/60 text-[10px] text-amber-300 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Cảnh báo: Dữ liệu DEM chưa tải trọn vẹn, đang dùng địa hình phẳng mô phỏng!</span>
              </div>
            )}
          </div>
        )}

        {/* 3. Bộ Công Tắc 6 Lớp Trực Quan Hóa (Layer Toggles) */}
        <div className="space-y-1.5 pt-2 border-t border-slate-800">
          <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>6 LỚP TRỰC QUAN HÓA (BẬT/TẮT ĐỘC LẬP)</span>
          </div>

          <div className="space-y-1">
            {[
              { id: 'baseDem', label: '1. Lớp địa hình DEM gốc', color: 'bg-emerald-500' },
              { id: 'maskA', label: '2. Lớp che khuất Vị trí A', color: 'bg-cyan-500' },
              { id: 'maskB', label: '3. Lớp che khuất Vị trí B', color: 'bg-fuchsia-500' },
              { id: 'overlap', label: '4. Phần không gian chồng lấn (A ∩ B)', color: 'bg-emerald-400' },
              { id: 'nonOverlap', label: '5. Phần không gian không chồng lấn (A ⊕ B)', color: 'bg-amber-400' },
              { id: 'missingDem', label: '6. Các vùng chưa đủ dữ liệu DEM', color: 'bg-slate-500' },
            ].map((layer) => {
              const isOn = terrainComparisonLayers[layer.id as keyof typeof terrainComparisonLayers];
              return (
                <button
                  key={layer.id}
                  onClick={() =>
                    toggleTerrainComparisonLayer(
                      layer.id as keyof typeof terrainComparisonLayers
                    )
                  }
                  className={`w-full px-2.5 py-1 rounded-lg flex items-center justify-between text-[11px] font-mono transition-all border ${
                    isOn
                      ? 'bg-slate-900 border-slate-700 text-slate-200'
                      : 'bg-slate-950/60 border-slate-800/80 text-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${layer.color} ${isOn ? 'opacity-100 shadow-sm' : 'opacity-30'}`} />
                    <span>{layer.label}</span>
                  </div>
                  {isOn ? (
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                  ) : (
                    <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
