import React, { useState } from 'react';
import {
  Layers,
  CircleDot,
  Tag,
  MapPin,
  Filter,
  ChevronDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import type { EquipmentCategory } from '../../types/equipment';

export const TacticalLayerControls: React.FC = () => {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const {
    showCoverageLayer,
    showRangeRingsLayer,
    showLabelsLayer,
    showMarkersLayer,
    categoryFilter,
    toggleCoverageLayer,
    toggleRangeRingsLayer,
    toggleLabelsLayer,
    toggleMarkersLayer,
    setCategoryFilter,
  } = useTacticalStore();

  const categories: { key: EquipmentCategory | 'All'; label: string }[] = [
    { key: 'All', label: 'Tất cả loại khí tài' },
    { key: 'RadarCanhGioi', label: 'Radar Cảnh giới (R)' },
    { key: 'TenLuaPhongKhong', label: 'Tên lửa PK (SAM)' },
    { key: 'CamBienThuDong', label: 'Cảm biến thụ động (ESM)' },
    { key: 'SoChiHuy', label: 'Sở chỉ huy (CP)' },
    { key: 'PhaoPhongKhong', label: 'Pháo PK (AAA)' },
    { key: 'TramQuanSat', label: 'Trạm quan sát (OP)' },
  ];

  const currentCategoryLabel =
    categories.find((c) => c.key === categoryFilter)?.label || 'Tất cả';

  return (
    <div className="absolute top-16 right-[336px] z-20 flex flex-col items-end gap-2 select-none pointer-events-auto">
      {/* Thanh công cụ điều khiển lớp bản đồ */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 shadow-xl">
        {/* Toggle Vùng Phủ */}
        <button
          onClick={toggleCoverageLayer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showCoverageLayer
              ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="Bật/Tắt hiển thị Vùng phủ đa tầng (Coverage Contours)"
        >
          <Layers className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Vùng phủ</span>
          {showCoverageLayer ? (
            <Eye className="w-3 h-3 text-cyan-400 ml-0.5 opacity-80" />
          ) : (
            <EyeOff className="w-3 h-3 text-slate-500 ml-0.5 opacity-60" />
          )}
        </button>

        {/* Toggle Vòng Cự Ly */}
        <button
          onClick={toggleRangeRingsLayer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showRangeRingsLayer
              ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="Bật/Tắt hiển thị Vòng cự ly đồng tâm (Range Rings)"
        >
          <CircleDot className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Vòng cự ly</span>
          {showRangeRingsLayer ? (
            <Eye className="w-3 h-3 text-cyan-400 ml-0.5 opacity-80" />
          ) : (
            <EyeOff className="w-3 h-3 text-slate-500 ml-0.5 opacity-60" />
          )}
        </button>

        {/* Toggle Nhãn Thông Số */}
        <button
          onClick={toggleLabelsLayer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showLabelsLayer
              ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="Bật/Tắt hiển thị Nhãn toạ độ & thông số khí tài (Labels)"
        >
          <Tag className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Nhãn</span>
          {showLabelsLayer ? (
            <Eye className="w-3 h-3 text-cyan-400 ml-0.5 opacity-80" />
          ) : (
            <EyeOff className="w-3 h-3 text-slate-500 ml-0.5 opacity-60" />
          )}
        </button>

        {/* Toggle Điểm Đặt / Marker */}
        <button
          onClick={toggleMarkersLayer}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showMarkersLayer
              ? 'bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.25)]'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
          }`}
          title="Bật/Tắt hiển thị Điểm tâm khí tài quân sự (Markers)"
        >
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Điểm đặt</span>
          {showMarkersLayer ? (
            <Eye className="w-3 h-3 text-cyan-400 ml-0.5 opacity-80" />
          ) : (
            <EyeOff className="w-3 h-3 text-slate-500 ml-0.5 opacity-60" />
          )}
        </button>

        <div className="w-[1px] h-5 bg-slate-800 mx-0.5" />

        {/* Bộ Lọc Theo Loại Khí Tài */}
        <div className="relative">
          <button
            onClick={() => setFilterMenuOpen(!filterMenuOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              categoryFilter !== 'All'
                ? 'bg-indigo-950/90 text-indigo-300 border border-indigo-500/40 shadow-[0_0_8px_rgba(99,102,241,0.25)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
            title="Lọc khí tài theo chuyên ngành tác chiến"
          >
            <Filter className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="max-w-[110px] truncate">{currentCategoryLabel}</span>
            <ChevronDown className="w-3 h-3 opacity-70 ml-0.5" />
          </button>

          {/* Menu dropdown danh mục */}
          {filterMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-slate-950/95 backdrop-blur-md border border-slate-800 shadow-2xl p-1 z-30 space-y-0.5">
              <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 border-b border-slate-800/80 mb-1">
                Lọc Chuyên Ngành
              </div>
              {categories.map((cat) => (
                <button
                  key={cat.key}
                  onClick={() => {
                    setCategoryFilter(cat.key);
                    setFilterMenuOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors ${
                    categoryFilter === cat.key
                      ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-700/50'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white border border-transparent'
                  }`}
                >
                  <span>{cat.label}</span>
                  {categoryFilter === cat.key && (
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
