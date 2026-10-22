import React, { useState } from 'react';
import {
  Layers,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Trees,
  Compass,
  Maximize2,
  Loader2,
  RotateCcw,
  Play,
  Mountain,
  Waves,
  MapPin,
  Settings2,
  Activity,
  Droplets,
  Info,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const FlatnessPatchListPanel: React.FC = () => {
  const {
    analysisRegion,
    regionInventoryStatus,
    regionInventoryResult,
    regionInventoryError,
    analysisConfig,
    setAnalysisConfig,
    resetAnalysisConfig,
    analysisStatus,
    analysisError,
    flatnessAnalysisResult,
    isSelectingFlatnessCenter,
    isAnalyzingFlatness,
    hoveredPatchId,
    selectedPatchId,
    showTerrainZoneInspector,
    runFlatnessAnalysis,
    startFlatnessSelection,
    clearFlatnessResult,
    setHoveredPatch,
    selectPatch,
  } = useTacticalStore();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'config' | 'patches'>('inventory');

  // Không hiển thị nếu chưa chọn vùng hoặc đang mở màn hình Inspector toàn màn hình
  if (!analysisRegion || showTerrainZoneInspector) {
    return null;
  }

  const { lat: centerLat, lon: centerLon, radiusKm } = analysisRegion;
  const patches = flatnessAnalysisResult?.patches || [];
  const deployableAreaM2 = flatnessAnalysisResult?.deployableAreaM2 || 0;
  const deployableCount = patches.filter((p) => p.isDeployable).length;

  const inv = regionInventoryResult;

  const formatArea = (m2: number | null | undefined): string => {
    if (m2 === null || m2 === undefined) return 'Chưa có dữ liệu';
    if (m2 === 0) return '0 m²';
    if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha (${Math.round(m2).toLocaleString('vi-VN')} m²)`;
    return `${Math.round(m2).toLocaleString('vi-VN')} m²`;
  };

  const formatLength = (km: number | null | undefined): string => {
    if (km === null || km === undefined) return 'Chưa có dữ liệu';
    if (km === 0) return '0 m';
    if (km >= 1) return `${km.toFixed(2)} km`;
    return `${Math.round(km * 1000)} m`;
  };

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'observed':
        return <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-600/40">Có quan sát</span>;
      case 'partial':
        return <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950/80 text-amber-300 border border-amber-600/40">Một phần</span>;
      case 'missing':
        return <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950/80 text-rose-300 border border-rose-600/40">Chưa có dữ liệu</span>;
      case 'outside':
        return <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">Ngoài phạm vi</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">Đang kiểm tra...</span>;
    }
  };

  return (
    <aside
      aria-label="Bảng thuộc tính vùng khảo sát và phân tích địa hình"
      className="absolute bottom-6 left-80 z-30 w-[430px] max-w-[calc(100vw-340px)] max-h-[calc(100vh-120px)] flex flex-col rounded-xl border border-cyan-500/40 bg-slate-950/95 backdrop-blur-md text-slate-200 shadow-2xl transition-all"
    >
      {/* HEADER TỔNG THỂ */}
      <header className="flex items-center justify-between border-b border-slate-800 p-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-cyan-950/80 border border-cyan-600/50 text-cyan-300 shadow-sm">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
                Thuộc Tính Vùng Khảo Sát
              </h3>
              <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-950 border border-cyan-600/40 text-cyan-300 font-mono">
                r = {Math.round(radiusKm * 1000).toLocaleString('vi-VN')}m
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              {centerLat.toFixed(5)}°N, {centerLon.toFixed(5)}°E · Diện tích: 3,14 km²
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            title={isCollapsed ? 'Mở rộng bảng' : 'Thu gọn bảng'}
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={clearFlatnessResult}
            className="p-1 rounded hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 transition-colors"
            title="Đóng và xóa vùng phân tích"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {!isCollapsed && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* NAVIGATION TABS */}
          <nav className="flex items-center border-b border-slate-800/80 bg-slate-900/60 px-2 pt-1 shrink-0 gap-1 text-[11px]">
            <button
              onClick={() => setActiveTab('inventory')}
              className={`flex-1 py-1.5 px-2 font-medium border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'inventory'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Khảo sát GIS
              {regionInventoryStatus === 'loading' && <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />}
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`flex-1 py-1.5 px-2 font-medium border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'config'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Thiết lập điều kiện
            </button>
            <button
              onClick={() => setActiveTab('patches')}
              className={`flex-1 py-1.5 px-2 font-medium border-b-2 transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'patches'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/30'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Mảng trận địa
              {patches.length > 0 && (
                <span className="px-1 rounded-full text-[9px] bg-cyan-900/80 text-cyan-300 font-mono">
                  {patches.length}
                </span>
              )}
            </button>
          </nav>

          {/* NỘI DUNG CUỘN */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
            {/* TAB 1: KHẢO SÁT GIS VÙNG 1 KM (PHẦN A & B) */}
            {activeTab === 'inventory' && (
              <div className="space-y-3">
                {/* PHẦN A: THÔNG TIN VÙNG & TRẠNG THÁI NGUỒN */}
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 text-[11px] space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                    <span className="font-semibold text-slate-300 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                      Thông tin vùng khảo sát
                    </span>
                    <span className="font-mono text-cyan-300">R = 1.000 m</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="flex items-center justify-between p-1.5 rounded bg-slate-950/60 border border-slate-800/60">
                      <span className="text-slate-400">Dữ liệu DEM 3D:</span>
                      {getStatusBadge(inv?.terrain.status)}
                    </div>
                    <div className="flex items-center justify-between p-1.5 rounded bg-slate-950/60 border border-slate-800/60">
                      <span className="text-slate-400">Dữ liệu Vector:</span>
                      {getStatusBadge(inv?.vectorStoreLoaded ? (inv.highway.status === 'outside' ? 'outside' : 'observed') : 'missing')}
                    </div>
                  </div>
                </div>

                {/* TRẠNG THÁI LOADING INVENTORY */}
                {regionInventoryStatus === 'loading' && (
                  <div className="p-4 rounded-lg bg-cyan-950/20 border border-cyan-800/40 text-center space-y-2">
                    <Loader2 className="w-5 h-5 animate-spin text-cyan-400 mx-auto" />
                    <p className="text-xs text-cyan-200 font-medium">
                      Đang khảo sát dữ liệu GIS trong bán kính 1 km...
                    </p>
                    <p className="text-[10px] text-slate-400">
                      Cắt xén tuyến giao thông, dòng chảy, đo đạc công trình, rừng và lấy mẫu cao độ DEM thực tế.
                    </p>
                  </div>
                )}

                {/* LỖI INVENTORY */}
                {regionInventoryStatus === 'error' && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block">Khảo sát GIS gặp sự cố</span>
                      <p className="text-[10px] text-rose-400/90">{regionInventoryError || 'Không thể đọc dữ liệu'}</p>
                    </div>
                  </div>
                )}

                {/* PHẦN B: CHI TIẾT 6 DANH MỤC GIS */}
                {inv && (
                  <div className="space-y-2">
                    {/* 1. ĐỊA HÌNH */}
                    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800/60 pb-1">
                        <span className="flex items-center gap-1.5 text-cyan-300">
                          <Mountain className="w-3.5 h-3.5" />
                          1. Địa hình & Cao độ DEM
                        </span>
                        {getStatusBadge(inv.terrain.status)}
                      </div>
                      {inv.terrain.minElevationM !== null && inv.terrain.maxElevationM !== null ? (
                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono pt-0.5">
                          <div>Thấp nhất: <strong className="text-slate-200">{inv.terrain.minElevationM}m</strong></div>
                          <div>Cao nhất: <strong className="text-slate-200">{inv.terrain.maxElevationM}m</strong></div>
                          <div>Chênh cao (ΔH): <strong className="text-amber-300">{inv.terrain.deltaElevationM}m</strong></div>
                          <div>Độ dốc TB: <strong className="text-slate-200">{inv.terrain.meanSlopeDeg}°</strong></div>
                          <div className="col-span-2 text-[9px] text-slate-400 font-sans">
                            Độ phủ DEM: {inv.terrain.validSampleCount}/{inv.terrain.sampleCount} điểm mẫu lưới trong vòng tròn.
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-amber-400/90 italic">
                          Chưa có dữ liệu độ cao địa hình cho khu vực này (nằm ngoài phạm vi bao phủ gói DEM).
                        </p>
                      )}
                    </div>

                    {/* 2. CÔNG TRÌNH */}
                    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800/60 pb-1">
                        <span className="flex items-center gap-1.5 text-amber-300">
                          <Building2 className="w-3.5 h-3.5" />
                          2. Công trình & Nhà ở
                        </span>
                        {getStatusBadge(inv.building.status)}
                      </div>
                      {inv.building.count !== null ? (
                        <div className="flex items-center justify-between text-[10px] font-mono pt-0.5">
                          <span>Số lượng: <strong className="text-slate-200">{inv.building.count}</strong> công trình</span>
                          <span>Diện tích: <strong className="text-slate-200">{formatArea(inv.building.totalAreaM2)}</strong></span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic">Chưa có dữ liệu công trình trong vùng này.</p>
                      )}
                    </div>

                    {/* 3. SÔNG SUỐI VÀ MẶT NƯỚC */}
                    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800/60 pb-1">
                        <span className="flex items-center gap-1.5 text-blue-300">
                          <Waves className="w-3.5 h-3.5" />
                          3. Sông suối & Mặt nước
                        </span>
                        {getStatusBadge(inv.water.status)}
                      </div>
                      {inv.water.riverCount !== null ? (
                        <div className="space-y-1 text-[10px] font-mono pt-0.5">
                          <div className="flex items-center justify-between">
                            <span>Sông suối: <strong className="text-slate-200">{inv.water.riverCount}</strong> tuyến</span>
                            <span>Chiều dài trong vùng: <strong className="text-blue-300">{formatLength(inv.water.riverLengthKm)}</strong></span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Hồ / Mặt nước kín: <strong className="text-slate-200">{inv.water.lakeCount}</strong></span>
                            <span>Diện tích mặt nước: <strong className="text-blue-300">{formatArea(inv.water.lakeAreaM2)}</strong></span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic">Chưa có dữ liệu thủy hệ trong vùng này.</p>
                      )}
                    </div>

                    {/* 4. RỪNG */}
                    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800/60 pb-1">
                        <span className="flex items-center gap-1.5 text-emerald-300">
                          <Trees className="w-3.5 h-3.5" />
                          4. Rừng & Thảm thực vật
                        </span>
                        {getStatusBadge(inv.forest.status)}
                      </div>
                      {inv.forest.polygonCount !== null ? (
                        <div className="flex items-center justify-between text-[10px] font-mono pt-0.5">
                          <span>Diện tích: <strong className="text-emerald-300">{formatArea(inv.forest.totalAreaM2)}</strong></span>
                          <span>Tỷ lệ bao phủ: <strong className="text-slate-200">{inv.forest.coveragePercent}%</strong></span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic">Chưa có dữ liệu thảm thực vật trong vùng này.</p>
                      )}
                    </div>

                    {/* 5. ĐƯỜNG GIAO THÔNG */}
                    <div className="p-2.5 rounded-lg bg-slate-900/50 border border-slate-800 text-[11px] space-y-1.5">
                      <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800/60 pb-1">
                        <span className="flex items-center gap-1.5 text-cyan-300">
                          <Compass className="w-3.5 h-3.5" />
                          5. Tuyến đường giao thông
                        </span>
                        {getStatusBadge(inv.highway.status)}
                      </div>
                      {inv.highway.segmentCount !== null ? (
                        <div className="flex items-center justify-between text-[10px] font-mono pt-0.5">
                          <span>Số đoạn đường: <strong className="text-slate-200">{inv.highway.segmentCount}</strong></span>
                          <span>Tổng chiều dài: <strong className="text-cyan-300">{formatLength(inv.highway.totalLengthKm)}</strong></span>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic">Chưa có dữ liệu đường sá trong vùng này.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: THIẾT LẬP ĐIỀU KIỆN PHÂN TÍCH (PHẦN C) */}
            {activeTab === 'config' && (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                    <span className="text-xs font-semibold text-cyan-300 flex items-center gap-1.5">
                      <Settings2 className="w-3.5 h-3.5" />
                      Điều Kiện Lọc Mảng Địa Hình
                    </span>
                    <button
                      onClick={resetAnalysisConfig}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 transition-colors"
                      title="Khôi phục cấu hình mặc định (4m, 1ha, 6°)"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Mặc định
                    </button>
                  </div>

                  {/* 1. Chênh lệch cao độ tối đa */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="cfg-deltaElev" className="text-slate-300 font-medium">
                        1. Chênh lệch cao độ tối đa (ΔH):
                      </label>
                      <span className="font-mono text-cyan-300 font-bold">
                        {analysisConfig.maxElevationDifferenceM} m
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="cfg-deltaElev"
                        type="range"
                        min="1"
                        max="20"
                        step="0.5"
                        value={analysisConfig.maxElevationDifferenceM}
                        onChange={(e) =>
                          setAnalysisConfig({ maxElevationDifferenceM: parseFloat(e.target.value) || 4.0 })
                        }
                        className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                      <input
                        type="number"
                        min="1"
                        max="20"
                        step="0.5"
                        value={analysisConfig.maxElevationDifferenceM}
                        onChange={(e) =>
                          setAnalysisConfig({ maxElevationDifferenceM: parseFloat(e.target.value) || 4.0 })
                        }
                        className="w-16 p-1 rounded bg-slate-950 border border-slate-700 text-center font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Mặc định: <strong>4.0 m</strong>. Giới hạn độ lồi lõm tối đa trong toàn bộ mảng đất.
                    </p>
                  </div>

                  {/* 2. Diện tích tối đa mỗi mảng (Giới hạn trên) */}
                  <div className="space-y-1 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="cfg-maxArea" className="text-slate-300 font-medium">
                        2. Diện tích tối đa mỗi mảng:
                      </label>
                      <span className="font-mono text-cyan-300 font-bold">
                        {(analysisConfig.maxPatchAreaM2 / 10_000).toFixed(1)} ha ({analysisConfig.maxPatchAreaM2.toLocaleString('vi-VN')} m²)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="cfg-maxArea"
                        type="range"
                        min="2000"
                        max="50000"
                        step="1000"
                        value={analysisConfig.maxPatchAreaM2}
                        onChange={(e) =>
                          setAnalysisConfig({ maxPatchAreaM2: parseInt(e.target.value, 10) || 10_000 })
                        }
                        className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                      <input
                        type="number"
                        min="2000"
                        max="50000"
                        step="1000"
                        value={analysisConfig.maxPatchAreaM2}
                        onChange={(e) =>
                          setAnalysisConfig({ maxPatchAreaM2: parseInt(e.target.value, 10) || 10_000 })
                        }
                        className="w-20 p-1 rounded bg-slate-950 border border-slate-700 text-center font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Mặc định: <strong>1.0 ha (10.000 m²)</strong>. Đây là <strong>GIỚI HẠN TRÊN</strong> (vùng lớn hơn sẽ được cắt nhỏ thành các ô con $\le$ mức này).
                    </p>
                  </div>

                  {/* 3. Độ dốc tối đa */}
                  <div className="space-y-1 pt-1 border-t border-slate-800/60">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="cfg-maxSlope" className="text-slate-300 font-medium">
                        3. Độ dốc tối đa:
                      </label>
                      <span className="font-mono text-cyan-300 font-bold">
                        {analysisConfig.maxSlopeDeg}°
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="cfg-maxSlope"
                        type="range"
                        min="2"
                        max="25"
                        step="1"
                        value={analysisConfig.maxSlopeDeg}
                        onChange={(e) =>
                          setAnalysisConfig({ maxSlopeDeg: parseFloat(e.target.value) || 6.0 })
                        }
                        className="flex-1 accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                      />
                      <input
                        type="number"
                        min="2"
                        max="25"
                        step="1"
                        value={analysisConfig.maxSlopeDeg}
                        onChange={(e) =>
                          setAnalysisConfig({ maxSlopeDeg: parseFloat(e.target.value) || 6.0 })
                        }
                        className="w-16 p-1 rounded bg-slate-950 border border-slate-700 text-center font-mono text-xs text-slate-200 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400">
                      Mặc định: <strong>6.0°</strong>. Góc dốc sườn đất lớn nhất cho phép giữa các điểm liền kề.
                    </p>
                  </div>
                </div>

                <div className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-800/40 text-[10px] text-amber-300/90 flex items-start gap-1.5 leading-relaxed">
                  <Info className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Các điều kiện này là cấu hình phân tích toán học do người dùng tùy chọn, không phải tiêu chuẩn kỹ thuật đã được chứng nhận cho việc triển khai thiết bị ngoài thực địa.
                  </span>
                </div>
              </div>
            )}

            {/* TAB 3: DANH SÁCH MẢNG ĐỊA HÌNH (PHẦN D KẾT QUẢ) */}
            {activeTab === 'patches' && (
              <div className="space-y-3">
                {/* Trạng thái chưa quét */}
                {analysisStatus === 'idle' && (
                  <div className="p-5 text-center space-y-3 bg-slate-900/40 rounded-lg border border-slate-800">
                    <div className="p-2.5 w-10 h-10 rounded-full bg-cyan-950/80 border border-cyan-700 text-cyan-300 mx-auto flex items-center justify-center">
                      <Play className="w-5 h-5 ml-0.5" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-xs font-semibold text-slate-200">Chưa Chạy Phân Tích Mảng Trận Địa</h4>
                      <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs mx-auto">
                        Hãy kiểm tra khảo sát GIS và thiết lập điều kiện phù hợp, sau đó bấm nút bên dưới để bắt đầu quét mảng.
                      </p>
                    </div>
                  </div>
                )}

                {/* Trạng thái đang quét */}
                {analysisStatus === 'running' && (
                  <div className="p-6 flex flex-col items-center justify-center gap-3 text-center bg-slate-900/40 rounded-lg border border-slate-800">
                    <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
                    <div className="space-y-1">
                      <span className="text-xs font-semibold text-cyan-200">Đang quét phân tích địa hình...</span>
                      <p className="text-[10px] text-slate-400">
                        Lấy mẫu DEM 81x81 (~25m), gom cụm Union-Find, phân chia đa giác $\le$ {(analysisConfig.maxPatchAreaM2 / 10000).toFixed(1)} ha, lọc $\Delta H \le$ {analysisConfig.maxElevationDifferenceM}m.
                      </p>
                    </div>
                  </div>
                )}

                {/* Trạng thái lỗi */}
                {analysisStatus === 'error' && (
                  <div className="p-4 rounded-lg bg-rose-950/50 border border-rose-800/60 text-rose-300 text-xs space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <span className="font-semibold block">Quét mảng địa hình thất bại</span>
                        <p className="text-[11px] text-rose-400/90">{analysisError || 'Không thể tải dữ liệu địa hình'}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Trạng thái không có mảng đạt chuẩn */}
                {analysisStatus === 'empty' && (
                  <div className="p-5 text-center space-y-2 bg-slate-900/40 rounded-lg border border-slate-800">
                    <div className="p-2 w-8 h-8 rounded-full bg-amber-950/60 border border-amber-800 text-amber-400 mx-auto flex items-center justify-center">
                      <AlertTriangle className="w-4 h-4" />
                    </div>
                    <p className="text-xs text-amber-200 font-medium">Không tìm thấy mảng phù hợp</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Trong bán kính 1 km này không có mảng đất nào đạt tiêu chuẩn $\Delta H \le$ {analysisConfig.maxElevationDifferenceM}m và dốc $\le$ {analysisConfig.maxSlopeDeg}°. Bạn hãy thử nới rộng điều kiện hoặc chọn vùng khác.
                    </p>
                  </div>
                )}

                {/* Trạng thái thành công */}
                {analysisStatus === 'success' && flatnessAnalysisResult && (
                  <div className="space-y-2">
                    {/* Thống kê nhanh */}
                    <div className="grid grid-cols-2 gap-2 p-2.5 bg-slate-900/60 rounded-lg border border-slate-800 text-[11px]">
                      <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Đủ điều kiện (ΔH ≤ {analysisConfig.maxElevationDifferenceM}m)</span>
                        <span className="text-sm font-bold text-emerald-400 font-mono">
                          {deployableCount} / {patches.length} mảng
                        </span>
                      </div>
                      <div className="p-2 rounded bg-slate-950/80 border border-slate-800">
                        <span className="text-[10px] text-slate-400 block">Tổng diện tích khả dụng</span>
                        <span className="text-sm font-bold text-cyan-400 font-mono">
                          {(deployableAreaM2 / 10000).toFixed(2)} ha
                        </span>
                      </div>
                    </div>

                    {/* Danh sách các mảng */}
                    <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                      {patches.map((patch, idx) => {
                        const isHovered = hoveredPatchId === patch.id;
                        const isSelected = selectedPatchId === patch.id;

                        return (
                          <div
                            key={patch.id}
                            onMouseEnter={() => setHoveredPatch(patch.id)}
                            onMouseLeave={() => setHoveredPatch(null)}
                            onClick={() => selectPatch(patch.id)}
                            className={`p-2 rounded-lg cursor-pointer transition-all border ${
                              isSelected
                                ? 'bg-cyan-950/50 border-cyan-500/80 shadow-md'
                                : isHovered
                                  ? 'bg-slate-900 border-yellow-500/60'
                                  : 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-xs text-cyan-300">
                                  #{idx + 1}
                                </span>
                                <span className="text-xs font-medium text-slate-200">
                                  {(patch.areaM2 / 10000).toFixed(2)} ha
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  ({Math.round(patch.areaM2).toLocaleString('vi-VN')} m²)
                                </span>
                              </div>

                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                  patch.isDeployable
                                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                                    : 'bg-amber-950/80 text-amber-300 border-amber-600/50'
                                }`}
                              >
                                {patch.isDeployable ? (
                                  <>
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                    Đạt chuẩn
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                                    Dốc {patch.maxSlopeDeg.toFixed(0)}°
                                  </>
                                )}
                              </span>
                            </div>

                            {/* Chỉ số chi tiết */}
                            <div className="mt-1 flex items-center gap-2.5 text-[10px] text-slate-400 font-mono">
                              <span>ΔH: <strong className="text-slate-200">{patch.deltaElevM.toFixed(1)}m</strong></span>
                              <span>Dốc TB: <strong className="text-slate-200">{patch.meanSlopeDeg.toFixed(1)}°</strong></span>
                              <span>Cao độ: <strong className="text-slate-200">{Math.round(patch.minElevM)}-{Math.round(patch.maxElevM)}m</strong></span>
                            </div>

                            {/* Cảnh báo mặt nước nếu có */}
                            {patch.waterWarning && (
                              <div className="mt-1 flex items-center gap-1 text-[10px] text-rose-300 bg-rose-950/40 px-1.5 py-0.5 rounded border border-rose-800/40">
                                <Droplets className="w-3 h-3 text-rose-400 shrink-0" />
                                <span className="truncate">{patch.waterWarning}</span>
                              </div>
                            )}

                            {/* Vật cản & Nút mở */}
                            <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                              <div className="flex items-center gap-2">
                                {patch.buildingCount > 0 && (
                                  <span className="flex items-center gap-0.5 text-amber-300" title="Số công trình kiến trúc">
                                    <Building2 className="w-3 h-3" /> {patch.buildingCount}
                                  </span>
                                )}
                                {patch.forestAreaM2 > 0 && (
                                  <span className="flex items-center gap-0.5 text-emerald-300" title="Diện tích rừng">
                                    <Trees className="w-3 h-3" /> {(patch.forestAreaM2 / 10000).toFixed(1)}ha
                                  </span>
                                )}
                                {patch.roadCount > 0 && (
                                  <span className="flex items-center gap-0.5 text-blue-300" title="Đoạn đường giao thông">
                                    <Compass className="w-3 h-3" /> {patch.roadCount}
                                  </span>
                                )}
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectPatch(patch.id);
                                }}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-600/50 text-cyan-200 text-[10px] font-medium transition-colors"
                              >
                                Khảo sát 3D/2D
                                <Maximize2 className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* FOOTER & CÁC NÚT ĐIỀU KHIỂN CHÍNH (PHẦN D) */}
          <footer className="p-3 border-t border-slate-800 bg-slate-950/95 space-y-2 shrink-0">
            {/* NÚT CHÍNH PHÂN TÍCH MẢNG */}
            <button
              onClick={() => {
                setActiveTab('patches');
                void runFlatnessAnalysis();
              }}
              disabled={isAnalyzingFlatness}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-cyan-400/80 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold uppercase tracking-wider shadow-lg shadow-cyan-950/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzingFlatness ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang phân tích địa hình...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  Phân tích mảng địa hình triển khai trận địa
                </>
              )}
            </button>

            {/* CÁC NÚT PHỤ */}
            <div className="flex items-center gap-2">
              <button
                onClick={startFlatnessSelection}
                disabled={isSelectingFlatnessCenter || isAnalyzingFlatness}
                className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 text-xs font-medium transition-colors disabled:opacity-50"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Chọn vị trí khác (1km)
              </button>
              <button
                onClick={clearFlatnessResult}
                className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-400 text-xs font-medium transition-colors"
                title="Xóa vùng phân tích"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </footer>
        </div>
      )}
    </aside>
  );
};
