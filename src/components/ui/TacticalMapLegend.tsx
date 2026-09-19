import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp, Layers, CircleDot, Activity, Shield } from 'lucide-react';

export const TacticalMapLegend: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="absolute bottom-6 left-[336px] z-20 select-none pointer-events-auto max-w-sm">
      {!isExpanded ? (
        /* Nút thu gọn mở Chú giải */
        <button
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-950/85 backdrop-blur-md border border-slate-800 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-300 shadow-xl transition-all"
        >
          <Info className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold">Chú giải bản đồ</span>
          <ChevronUp className="w-3.5 h-3.5 opacity-70" />
        </button>
      ) : (
        /* Bảng Chú giải đầy đủ */
        <div className="w-80 rounded-2xl bg-slate-950/90 backdrop-blur-md border border-slate-800 shadow-2xl overflow-hidden transition-all animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Tiêu đề */}
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-900/70 border-b border-slate-800/80">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-bold text-slate-100 uppercase tracking-wider font-mono">
                Chú Giải Tác Chiến
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
              title="Thu nhỏ chú giải"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3.5 space-y-3.5 text-xs max-h-[380px] overflow-y-auto">
            {/* 1. Dải màu SPx theo độ cao mục tiêu */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono mb-2">
                <Layers className="w-3.5 h-3.5 text-cyan-400" />
                <span>Vùng Phủ SPx (Độ cao mục tiêu)</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-3.5 h-3.5 rounded bg-red-500/80 border border-red-400 flex-shrink-0" />
                  <span className="text-slate-200">2000m (Tầng cao)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-3.5 h-3.5 rounded bg-orange-500/80 border border-orange-400 flex-shrink-0" />
                  <span className="text-slate-200">1000m (Tầng trung)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-3.5 h-3.5 rounded bg-amber-400/80 border border-amber-300 flex-shrink-0" />
                  <span className="text-slate-200">800m (Tầng thấp)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-3.5 h-3.5 rounded bg-emerald-500/90 border border-emerald-300 flex-shrink-0 shadow-[0_0_6px_#10b981]" />
                  <span className="text-emerald-300 font-semibold">500m (Sát đất)</span>
                </div>
              </div>
            </div>

            {/* 2. Vòng cự ly & Trục chữ thập */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono mb-2">
                <CircleDot className="w-3.5 h-3.5 text-cyan-400" />
                <span>Vòng Cự Ly (Range Rings)</span>
              </div>
              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-[2px] bg-cyan-400" />
                    <span className="text-slate-300">Vòng phân khoảng</span>
                  </div>
                  <span className="text-[10px] text-cyan-300">10 / 25 / 50 km</span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <span className="w-4 h-[3px] bg-sky-400 shadow-[0_0_4px_#38bdf8]" />
                    <span className="text-slate-300">Vòng cự ly tối đa (MAX)</span>
                  </div>
                  <span className="text-[10px] text-sky-300 font-semibold">Đường biên đậm</span>
                </div>
              </div>
            </div>

            {/* 3. Trạng thái khí tài */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono mb-2">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Trạng Thái Điểm Đặt</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981] flex-shrink-0" />
                  <span className="text-slate-300">Hoạt động (Active)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-slate-300">Sẵn sàng (Standby)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
                  <span className="text-slate-300">Bảo dưỡng (Maint.)</span>
                </div>
                <div className="flex items-center gap-2 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 flex-shrink-0" />
                  <span className="text-slate-300">Tắt máy (Offline)</span>
                </div>
              </div>
            </div>

            {/* 4. Mã định danh quân sự ngắn */}
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-mono mb-2">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                <span>Ký Hiệu Định Danh Quân Sự</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold text-[10px]">
                    R-xx
                  </span>
                  <span className="text-slate-300 truncate">Radar Cảnh Giới</span>
                </div>
                <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold text-[10px]">
                    SAM-xx
                  </span>
                  <span className="text-slate-300 truncate">Tên Lửa PK</span>
                </div>
                <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold text-[10px]">
                    CP-xx
                  </span>
                  <span className="text-slate-300 truncate">Sở Chỉ Huy</span>
                </div>
                <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-slate-900/50 border border-slate-800/60">
                  <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold text-[10px]">
                    AAA-xx
                  </span>
                  <span className="text-slate-300 truncate">Pháo PK</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
