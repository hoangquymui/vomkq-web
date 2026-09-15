import React from 'react';
import { Ruler, Trash2, CheckCircle2 } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { calculateHaversineDistanceKm } from '../../utils/geo';

export const MeasurementPanel: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    measurePoints,
    clearMeasurePoints,
  } = useTacticalStore();

  if (activeTool !== 'measure') return null;

  // Tính tổng khoảng cách
  let totalKm = 0;
  for (let i = 0; i < measurePoints.length - 1; i++) {
    totalKm += calculateHaversineDistanceKm(
      measurePoints[i].lat,
      measurePoints[i].lon,
      measurePoints[i + 1].lat,
      measurePoints[i + 1].lon
    );
  }

  const nauticalMiles = totalKm / 1.852;

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 bg-slate-950/90 backdrop-blur-md border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.25)] rounded-xl p-3.5 flex items-center gap-5 select-none animate-in fade-in slide-in-from-bottom-4 duration-200">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-emerald-950 border border-emerald-500/60 flex items-center justify-center text-emerald-400">
          <Ruler className="w-5 h-5" />
        </div>
        <div>
          <div className="text-[11px] font-mono text-emerald-400 font-semibold uppercase tracking-wider">
            Thước Đo Khoảng Cách Thực Địa (WGS-84)
          </div>
          <div className="text-xs text-slate-300">
            {measurePoints.length === 0 ? (
              <span className="text-slate-400">
                Nhấp chuột lên bản đồ để đánh dấu điểm mốc đầu tiên...
              </span>
            ) : (
              <span>
                Đã đánh dấu{' '}
                <strong className="text-emerald-400">{measurePoints.length}</strong>{' '}
                mốc đo
              </span>
            )}
          </div>
        </div>
      </div>

      {measurePoints.length >= 2 && (
        <div className="flex items-center gap-4 px-4 py-1.5 bg-slate-900 rounded-lg border border-slate-800">
          <div>
            <div className="text-[10px] text-slate-400 font-mono">KILOMÉT</div>
            <div className="text-base font-bold font-mono text-emerald-400">
              {totalKm.toFixed(2)} km
            </div>
          </div>
          <div className="w-px h-7 bg-slate-800" />
          <div>
            <div className="text-[10px] text-slate-400 font-mono">HẢI LÝ (NM)</div>
            <div className="text-base font-bold font-mono text-cyan-400">
              {nauticalMiles.toFixed(2)} NM
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {measurePoints.length > 0 && (
          <button
            onClick={clearMeasurePoints}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 rounded-lg border border-slate-800 transition-colors"
            title="Xóa tất cả điểm đo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={() => setActiveTool('select')}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition-colors shadow-sm"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Hoàn tất</span>
        </button>
      </div>
    </div>
  );
};
