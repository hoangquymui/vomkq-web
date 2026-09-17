import React, { useRef } from 'react';
import {
  Globe2,
  Ruler,
  Layers,
  FileDown,
  FileUp,
  Trash2,
  FolderOpen,
  MapPin,
  Share2,
  BarChart3,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { PRESET_LOCATIONS } from '../../data/equipmentTemplates';
import type { LayoutSaveData } from '../../types/layout';

export const TopBar: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    activeTool,
    setActiveTool,
    terrainExaggeration,
    setTerrainExaggeration,
    vietnamOnly,
    toggleVietnamOnly,
    showAllDomes,
    toggleDomes,
    showCommandLinks,
    toggleCommandLinks,
    triggerFlyTo,
    clearAll,
    exportToLayout,
    importFromLayout,
    loadSampleScenario,
    setShowRadarFieldModal,
  } = useTacticalStore();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Xuất file JSON bố cục
  const handleExport = () => {
    const layout = exportToLayout('Bo_Cuc_Phong_Khong_VomKQ');
    const blob = new Blob([JSON.stringify(layout, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `VomKQ_Layout_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Nạp file JSON bố cục
  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const layout = JSON.parse(event.target?.result as string) as LayoutSaveData;
        if (layout && Array.isArray(layout.equipments)) {
          importFromLayout(layout);
        } else {
          alert('Tệp bố cục không hợp lệ!');
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi đọc file JSON bố cục');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <header className="absolute top-0 left-0 right-0 h-14 bg-slate-950/90 backdrop-blur-md border-b border-cyan-900/40 z-30 px-3 flex items-center justify-between select-none">
      {/* 1. Logo & Tiêu đề Hệ thống */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/60 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.4)]">
          <Globe2 className="w-5 h-5 animate-pulse" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold tracking-wider text-cyan-400 text-sm font-mono">
              VÒM KHÍ QUYỂN (VomKQ)
            </span>
            <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.5 rounded font-mono">
              3D GIS
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-sans hidden xl:block">
            Hệ Thống Mô Phỏng & Lập Kế Hoạch Phòng Không Trên Địa Hình Thực Tế
          </p>
        </div>
      </div>

      {/* 2. Điều hướng Khu vực, Chế độ 3D/2D & Bản đồ */}
      <div className="flex items-center gap-2">
        {/* Chọn nhanh khu vực */}
        <div className="relative flex items-center">
          <MapPin className="w-3.5 h-3.5 text-cyan-400 absolute left-2.5 pointer-events-none" />
          <select
            onChange={(e) => {
              const loc = PRESET_LOCATIONS.find((p) => p.id === e.target.value);
              if (loc) triggerFlyTo(loc);
            }}
            defaultValue="tamdao"
            className="bg-slate-900 text-slate-200 text-xs pl-8 pr-2.5 py-1.5 rounded border border-slate-700 hover:border-cyan-500/60 focus:outline-none focus:border-cyan-500 transition-colors cursor-pointer"
          >
            {PRESET_LOCATIONS.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Chuyển đổi 3D (Tự động kích hoạt địa hình 3D lồi lõm) / 2D (Bản đồ phẳng) */}
        <div className="flex rounded bg-slate-900 p-0.5 border border-slate-700">
          <button
            onClick={() => setViewMode('3D')}
            className={`px-3 py-1 text-xs font-bold rounded transition-all ${
              viewMode === '3D'
                ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            3D
          </button>
          <button
            onClick={() => setViewMode('2D')}
            className={`px-3 py-1 text-xs font-bold rounded transition-all ${
              viewMode === '2D'
                ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.4)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            2D
          </button>
        </div>

        {/* Nút Chỉ Vùng Việt Nam / Toàn Cầu */}
        <button
          onClick={toggleVietnamOnly}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded border transition-all ${
            vietnamOnly
              ? 'bg-rose-950/85 text-rose-300 border-rose-500/60 shadow-[0_0_10px_rgba(244,63,94,0.3)]'
              : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
          }`}
          title="Bật/Tắt: Cắt gọn chỉ hiển thị vùng lãnh thổ & hải đảo Việt Nam"
        >
          <span className="text-xs">🇻🇳</span>
          <span>{vietnamOnly ? 'Chỉ Vùng VN' : 'Toàn Cầu'}</span>
        </button>

        {/* Độ phóng đại địa hình khi ở chế độ 3D */}
        {viewMode === '3D' && (
          <div className="flex items-center gap-1 bg-slate-900 px-2 py-1 rounded border border-slate-700 text-xs">
            <span className="text-[10px] text-slate-400 font-mono">Độ lồi:</span>
            <select
              value={terrainExaggeration}
              onChange={(e) => setTerrainExaggeration(parseFloat(e.target.value))}
              className="bg-transparent text-emerald-300 font-mono font-bold focus:outline-none cursor-pointer"
              title="Độ lồi lõm địa hình 3D"
            >
              <option value="1.0" className="bg-slate-900 text-slate-200">1.0x (Chuẩn)</option>
              <option value="1.5" className="bg-slate-900 text-slate-200">1.5x (Rõ nét)</option>
              <option value="2.0" className="bg-slate-900 text-slate-200">2.0x (Nổi khối)</option>
              <option value="2.5" className="bg-slate-900 text-slate-200">2.5x (Mạnh mẽ)</option>
            </select>
          </div>
        )}

        {/* Bật/Tắt Vòm 3D */}
        <button
          onClick={toggleDomes}
          title="Bật/Tắt Vòm Radar 3D"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-all ${
            showAllDomes
              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50'
              : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden lg:inline">Vòm 3D</span>
        </button>

        {/* Bật/Tắt Tuyến Chỉ Huy */}
        <button
          onClick={toggleCommandLinks}
          title="Bật/Tắt Tuyến chỉ huy"
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-all ${
            showCommandLinks
              ? 'bg-amber-950/80 text-amber-300 border-amber-500/50'
              : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
          }`}
        >
          <Share2 className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden lg:inline">Chỉ Huy</span>
        </button>

        {/* Thước đo khoảng cách */}
        <button
          onClick={() =>
            setActiveTool(activeTool === 'measure' ? 'select' : 'measure')
          }
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-all ${
            activeTool === 'measure'
              ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
              : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
          }`}
        >
          <Ruler className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden lg:inline">Thước Đo</span>
        </button>

        {/* Đánh giá Trường Radar Tổng Hợp */}
        <button
          onClick={() => setShowRadarFieldModal(true)}
          title="Xem bảng đánh giá chỉ số Trường Radar (K_trl, P_ph, S_trường)"
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-cyan-500/40 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)] transition-all cursor-pointer"
        >
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden xl:inline">Trường Radar</span>
        </button>
      </div>

      {/* 3. Tác vụ Kịch bản, Lưu/Tải Layout */}
      <div className="flex items-center gap-1.5">
        {/* Nạp kịch bản mẫu */}
        <button
          onClick={loadSampleScenario}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded transition-colors"
          title="Nạp kịch bản bố trí bảo vệ phòng không Bắc Bộ"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline">Kịch bản mẫu</span>
        </button>

        {/* Nạp File JSON */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded transition-colors"
          title="Tải kế hoạch từ file JSON"
        >
          <FileUp className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden xl:inline">Tải Bố Cục</span>
        </button>

        {/* Lưu File JSON */}
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded transition-colors"
          title="Lưu kế hoạch hiện tại ra file JSON"
        >
          <FileDown className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden xl:inline">Lưu Bố Cục</span>
        </button>

        {/* Xóa sạch */}
        <button
          onClick={() => {
            if (window.confirm('Bạn có chắc muốn xoá toàn bộ khí tài trên bản đồ?')) {
              clearAll();
            }
          }}
          className="p-1.5 text-xs text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/60 rounded transition-colors"
          title="Xóa toàn bộ khí tài"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
