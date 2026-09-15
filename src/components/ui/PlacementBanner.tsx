import React from 'react';
import { PlusCircle, X } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';

export const PlacementBanner: React.FC = () => {
  const { activeTool, pendingTemplate, setPendingTemplate } = useTacticalStore();

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
