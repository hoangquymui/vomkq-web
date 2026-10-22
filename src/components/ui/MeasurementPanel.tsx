import React from 'react';
import { Ruler, Trash2, CheckCircle2, MapPin, X } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import { calculateHaversineDistanceKm } from '../../utils/geo';
import { distanceToGeometryKm } from '../../utils/vectorGeometry';
import { VECTOR_KIND_LABELS } from '../../types/vectorFeature';
import type { VectorFeature } from '../../types/vectorFeature';
import type { EquipmentInstance } from '../../types/equipment';

/**
 * Thẻ đo cự ly giữa khí tài đang chọn và đối tượng vectơ đang bấm trên bản đồ.
 *
 * Cự ly được đo tới CẠNH GẦN NHẤT của hình học, không phải tới tâm. Với một ngôi nhà
 * dài 50 m, cách "tâm" và cách "cạnh" chênh nhau 25 m — ở tầm thấp phủ sóng thì
 * chênh lệch đó quyết định cái đó có nằm trong vùng quan sát hay không.
 */
const FeatureDistanceCard: React.FC<{
  feature: VectorFeature | null;
  instance: EquipmentInstance | null;
  onClear: () => void;
}> = ({ feature, instance, onClear }) => {
  if (!feature) return null;

  const label = VECTOR_KIND_LABELS[feature.kind];
  const name = feature.properties.name;

  const measurement = instance
    ? distanceToGeometryKm(
        { lat: instance.latitude, lon: instance.longitude },
        feature.geometry
      )
    : null;

  return (
    <div className="absolute bottom-20 left-[336px] z-30 w-80 pointer-events-auto">
      <div className="rounded-xl border border-sky-500/50 bg-slate-950/95 backdrop-blur-md p-3 shadow-[0_0_20px_rgba(14,165,233,0.2)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
              <span className="text-xs font-bold text-sky-200 truncate">
                {name || label}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
          </div>
          <button
            onClick={onClear}
            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors flex-shrink-0"
            title="Bỏ chọn"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {instance && measurement ? (
          <div className="mt-2 pt-2 border-t border-slate-800">
            <div className="text-[10px] text-slate-400">
              Cự ly tới <span className="text-cyan-300 font-semibold">{instance.shortId ?? instance.name}</span>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-xl font-bold font-mono text-sky-300 tabular-nums">
                {measurement.distanceKm < 0.01
                  ? (measurement.distanceKm * 1000).toFixed(0)
                  : measurement.distanceKm.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">
                {measurement.distanceKm < 0.01 ? 'm' : 'km'}
              </span>
              {measurement.distanceKm === 0 && (
                <span className="text-[10px] text-amber-400">
                  (khí tài nằm bên trong vùng này)
                </span>
              )}
            </div>
            {measurement.nearest && measurement.distanceKm > 0 && (
              <p className="text-[10px] text-slate-500 mt-1 font-mono">
                Điểm gần nhất: {measurement.nearest.lat.toFixed(5)},{' '}
                {measurement.nearest.lon.toFixed(5)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[10px] text-amber-400/90 mt-2 pt-2 border-t border-slate-800 leading-relaxed">
            Chọn một khí tài trên bản đồ để đo cự ly tới đối tượng này.
          </p>
        )}
      </div>
    </div>
  );
};

export const MeasurementPanel: React.FC = () => {
  const { selectedVectorFeature, selectVectorFeature, selectedInstanceId, instances } = useTacticalStore(useShallow((state) => ({
    selectedVectorFeature: state.selectedVectorFeature,
    selectVectorFeature: state.selectVectorFeature,
    selectedInstanceId: state.selectedInstanceId,
    instances: state.instances,
  })));

  return (
    <FeatureDistanceCard
      feature={selectedVectorFeature}
      instance={instances.find((i) => i.instanceId === selectedInstanceId) ?? null}
      onClear={() => selectVectorFeature(null)}
    />
  );
};

/** Bảng thước đo khoảng cách (chỉ hiện khi bật công cụ đo). */
export const RulerPanel: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    measurePoints,
    clearMeasurePoints,
  } = useTacticalStore(useShallow((state) => ({
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
    measurePoints: state.measurePoints,
    clearMeasurePoints: state.clearMeasurePoints,
  })));

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
