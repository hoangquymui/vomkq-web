import React from 'react';
import { PlusCircle, X } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const PlacementBanner: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    pendingTemplate,
    setPendingTemplate,
    selectedInstanceId,
    instances,
  } = useTacticalStore();

  const selectedInst = instances.find((i) => i.instanceId === selectedInstanceId);

  if (activeTool === 'move' && selectedInst) {
    return (
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-amber-950/95 backdrop-blur-md border border-amber-400 shadow-[0_0_24px_rgba(245,158,11,0.5)] rounded-full px-5 py-2.5 flex items-center gap-4 select-none animate-in fade-in slide-in-from-top-3 duration-200">
        <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-amber-300 font-bold">Di chuyển vị trí đài:</span>
          <strong className="text-white font-bold tracking-wide">
            {selectedInst.name}
          </strong>
          <span className="text-amber-200/80 hidden sm:inline">
            — Nhấp chuột lên bản đồ để chọn vị trí mới (DEM sẽ tự cập nhật)
          </span>
        </div>
        <button
          onClick={() => setActiveTool('select')}
          className="p-1 rounded-full text-amber-300 hover:text-white hover:bg-amber-900/60 transition-colors"
          title="Hủy di chuyển"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (activeTool !== 'place' || !pendingTemplate) return null;

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 bg-cyan-950/95 backdrop-blur-md border border-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.4)] rounded-full px-5 py-2.5 flex items-center gap-4 select-none animate-in fade-in slide-in-from-top-3 duration-200">
      <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />

      <div className="flex items-center gap-2 text-xs">
        <PlusCircle className="w-4 h-4 text-cyan-300" />
        <span className="text-slate-300">Đang triển khai:</span>
        <strong className="text-cyan-200 font-bold tracking-wide">
          {pendingTemplate.name}
        </strong>
        <span className="text-slate-400 hidden sm:inline">
          — Nhấp chuột lên bản đồ để đặt vị trí
        </span>
      </div>

      <button
        onClick={() => setPendingTemplate(null)}
        className="p-1 rounded-full text-cyan-300 hover:text-white hover:bg-cyan-900/60 transition-colors"
        title="Hủy đặt khí tài"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
