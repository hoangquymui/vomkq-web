import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Trees,
  Compass,
  MapPin,
  Ruler,
  TrendingDown,
  ShieldAlert,
  Send,
  Eye,
  Box,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { TacticalCanvas2D } from './TacticalCanvas2D';
import { EQUIPMENT_TEMPLATES } from '../../data/equipmentTemplates';
import { createEquipmentFromTemplate } from '../../utils/equipmentFactory';

export const TerrainZoneInspector: React.FC = () => {
  const {
    showTerrainZoneInspector,
    selectedPatchId,
    flatnessAnalysisResult,
    closeTerrainZoneInspector,
    selectPatch,
    addEquipment,
    instances,
  } = useTacticalStore();

  const [activeTab, setActiveTab] = useState<'3d' | '2d'>('3d');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(EQUIPMENT_TEMPLATES[0].id);
  const [deployedNotification, setDeployedNotification] = useState<string | null>(null);

  if (!showTerrainZoneInspector || !flatnessAnalysisResult) {
    return null;
  }

  const { patches } = flatnessAnalysisResult;
  const currentIndex = patches.findIndex((p) => p.id === selectedPatchId);
  const selectedPatch = currentIndex !== -1 ? patches[currentIndex] : patches[0];

  if (!selectedPatch) {
    return null;
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      selectPatch(patches[currentIndex - 1].id);
    }
  };

  const handleNext = () => {
    if (currentIndex < patches.length - 1) {
      selectPatch(patches[currentIndex + 1].id);
    }
  };

  const handleDeploy = () => {
    const template = EQUIPMENT_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (!template) return;

    const groundAlt = Math.round(selectedPatch.minElevM + selectedPatch.deltaElevM / 2);
    const newEq = createEquipmentFromTemplate(template, {
      latitude: Number(selectedPatch.centerLat.toFixed(5)),
      longitude: Number(selectedPatch.centerLon.toFixed(5)),
      altitude: groundAlt,
      nameIndex: instances.length + 1,
    });

    addEquipment(newEq);
    setDeployedNotification(`Đã bố trí ${template.name} tại tâm mảng!`);
    setTimeout(() => setDeployedNotification(null), 3500);
  };

  return (
    <div className="fixed inset-0 z-40 pointer-events-none flex flex-col justify-between overflow-hidden">
      {/* 1. Header Toolbar */}
      <header className="pointer-events-auto flex items-center justify-between px-6 py-3 bg-slate-950/90 backdrop-blur-md border-b border-cyan-500/40 text-slate-100 shadow-2xl">
        <div className="flex items-center gap-4">
          <button
            onClick={closeTerrainZoneInspector}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900/80 hover:bg-slate-800 hover:border-cyan-400 text-xs font-semibold text-cyan-300 transition-all shadow"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Quay lại bản đồ chính</span>
          </button>

          <div className="h-6 w-px bg-slate-800" />

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-100 font-mono tracking-wide">
                KHẢO SÁT CHI TIẾT ĐỊA HÌNH TRẬN ĐỊA · MẢNG #{currentIndex + 1}
                {selectedPatch.parentZoneId && (
                  <span className="text-xs text-cyan-400 font-normal ml-1">
                    (Mảng con #{selectedPatch.subIndex ?? 1} · Vùng phẳng gốc {((selectedPatch.totalZoneAreaM2 || selectedPatch.areaM2) / 10000).toFixed(2)} ha)
                  </span>
                )}
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${
                  selectedPatch.isDeployable
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/60'
                    : 'bg-amber-950/80 text-amber-300 border-amber-500/60'
                }`}
              >
                {selectedPatch.isDeployable ? (
                  <>
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ĐỦ ĐIỀU KIỆN TRIỂN KHAI KHÍ TÀI
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    ĐỊA HÌNH CẦN SAN GẠT
                  </>
                )}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              Tọa độ tâm: {selectedPatch.centerLat.toFixed(5)}°N, {selectedPatch.centerLon.toFixed(5)}°E · Diện tích:{' '}
              <strong className="text-cyan-300">{(selectedPatch.areaM2 / 10000).toFixed(2)} ha</strong> ({Math.round(selectedPatch.areaM2).toLocaleString('vi-VN')} m²)
            </p>
          </div>
        </div>

        {/* Chuyển đổi tab 3D / 2D Tactical & Điều hướng mảng */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setActiveTab('3d')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                activeTab === '3d'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              Mô hình 3D Nổi
            </button>
            <button
              onClick={() => setActiveTab('2d')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md font-medium transition-all ${
                activeTab === '2d'
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Bản đồ 2D Tactical
            </button>
          </div>

          <div className="flex items-center gap-1 bg-slate-900 border border-slate-700/80 rounded-lg p-0.5">
            <button
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition-colors"
              title="Mảng trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-mono px-2 text-slate-400">
              {currentIndex + 1} / {patches.length}
            </span>
            <button
              onClick={handleNext}
              disabled={currentIndex >= patches.length - 1}
              className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 transition-colors"
              title="Mảng tiếp theo"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Work Area */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left Viewport Area */}
        <div className="flex-1 relative">
          {activeTab === '2d' ? (
            <div className="pointer-events-auto absolute inset-4 z-10 flex items-center justify-center">
              <div className="w-full h-full max-w-4xl max-h-[85vh] shadow-2xl">
                <TacticalCanvas2D patch={selectedPatch} />
              </div>
            </div>
          ) : (
            // 3D HUD Reticle Overlay
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              {/* Vòng tâm ngắm chiến thuật */}
              <div className="w-48 h-48 rounded-full border border-cyan-400/20 flex items-center justify-center animate-pulse">
                <div className="w-24 h-24 rounded-full border border-cyan-400/40 border-dashed" />
              </div>
              <div className="absolute top-6 left-6 bg-slate-950/75 backdrop-blur px-3 py-1.5 rounded-lg border border-cyan-500/30 text-xs font-mono text-cyan-300">
                CHẾ ĐỘ KHẢO SÁT 3D CESIUM · BẢO TOÀN TOÀN CẢNH ĐỊA HÌNH VÀ VÂN VỆ TINH DEM THỰC
              </div>
            </div>
          )}
        </div>

        {/* Right HUD Sidebar */}
        <aside className="pointer-events-auto w-96 max-w-sm m-4 bg-slate-950/92 backdrop-blur-md border border-cyan-500/40 rounded-xl p-4 text-slate-200 shadow-2xl flex flex-col gap-4 overflow-y-auto">
          {deployedNotification && (
            <div className="p-2.5 rounded-lg bg-emerald-950/90 border border-emerald-500 text-emerald-200 text-xs font-medium flex items-center gap-2 animate-bounce">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{deployedNotification}</span>
            </div>
          )}

          {/* Block 1: Chỉ số Địa hình Cốt lõi */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
              <Ruler className="w-3.5 h-3.5" />
              Chỉ số Bằng phẳng Địa hình
            </h3>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Chênh lệch độ cao (ΔH)</span>
                <span className="text-base font-bold font-mono text-emerald-400">
                  {selectedPatch.deltaElevM.toFixed(1)} m
                </span>
                <span className="text-[9px] text-slate-500 block">Ngưỡng: ≤ 4.0 m</span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Diện tích bằng phẳng</span>
                <span className="text-base font-bold font-mono text-cyan-400">
                  {(selectedPatch.areaM2 / 10000).toFixed(2)} ha
                </span>
                <span className="text-[9px] text-slate-500 block">Quy chuẩn: ≤ 1.0 ha (10.000 m²)</span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Độ dốc trung bình</span>
                <span className="text-sm font-bold font-mono text-slate-200">
                  {selectedPatch.meanSlopeDeg.toFixed(1)}°
                </span>
              </div>

              <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                <span className="text-[10px] text-slate-400 block">Độ dốc tối đa</span>
                <span className="text-sm font-bold font-mono text-slate-200">
                  {selectedPatch.maxSlopeDeg.toFixed(1)}°
                </span>
              </div>

              <div className="col-span-2 p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block">Cao độ tuyệt đối (DEM)</span>
                  <span className="text-xs font-mono font-medium text-slate-300">
                    Thấp nhất: {Math.round(selectedPatch.minElevM)} m · Cao nhất: {Math.round(selectedPatch.maxElevM)} m
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Block 2: Hiện trạng Mặt bằng & Vật cản */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              Khảo sát Hiện trạng &amp; Vật cản
            </h3>

            {selectedPatch.waterWarning && (
              <div className="p-2.5 rounded-lg bg-rose-950/80 border border-rose-500/80 text-rose-200 text-xs flex items-start gap-2 shadow-lg">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-rose-300 block">CẢNH BÁO MẶT NƯỚC / DÒNG CHẢY:</span>
                  <p className="text-[11px] text-rose-300/90 leading-relaxed">{selectedPatch.waterWarning}</p>
                </div>
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80">
                <span className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                  <Building2 className="w-3.5 h-3.5 text-amber-400" />
                  Công trình dân sự:
                </span>
                <span className="font-mono font-bold text-slate-200">
                  {selectedPatch.buildingCount === 0 ? (
                    <span className="text-emerald-400">Trống (0 nhà)</span>
                  ) : (
                    <span className="text-amber-400">{selectedPatch.buildingCount} công trình</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80">
                <span className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                  <Trees className="w-3.5 h-3.5 text-emerald-400" />
                  Diện tích rừng cây:
                </span>
                <span className="font-mono font-bold text-slate-200">
                  {selectedPatch.forestAreaM2 === 0
                    ? '0 m²'
                    : `${(selectedPatch.forestAreaM2 / 10000).toFixed(1)} ha`}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80">
                <span className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                  <Compass className="w-3.5 h-3.5 text-blue-400" />
                  Sông suối / Nguồn nước:
                </span>
                <span className="font-mono font-bold text-slate-200">
                  {selectedPatch.riverLengthKm === 0 ? 'Không có' : `${selectedPatch.riverLengthKm.toFixed(2)} km`}
                </span>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800/80">
                <span className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                  <TrendingDown className="w-3.5 h-3.5 text-cyan-400" />
                  Đường giao thông tiếp cận:
                </span>
                <span className="font-mono font-bold text-slate-200">
                  {selectedPatch.roadCount > 0 ? (
                    <span className="text-emerald-400">Có kết nối ({selectedPatch.roadCount} đoạn)</span>
                  ) : (
                    <span className="text-slate-400">Xa đường chính</span>
                  )}
                </span>
              </div>
            </div>
          </section>

          {/* Block 3: Triển khai Khí tài Trực tiếp */}
          <section className="space-y-2.5 pt-1 border-t border-slate-800">
            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              Bố trí Trận địa Khí tài
            </h3>

            <div className="space-y-2">
              <label className="block text-[11px] text-slate-400">
                Chọn loại khí tài triển khai vào mảng:
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="mt-1 w-full p-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-cyan-400"
                >
                  {EQUIPMENT_TEMPLATES.map((tmpl) => (
                    <option key={tmpl.id} value={tmpl.id}>
                      {tmpl.name} ({tmpl.category})
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={handleDeploy}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-emerald-600 hover:from-cyan-500 hover:to-emerald-500 text-white text-xs font-bold shadow-lg transition-all"
              >
                <MapPin className="w-3.5 h-3.5" />
                Triển khai khí tài tại mảng này
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
};
