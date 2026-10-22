/**
 * BẢNG ĐẶC TÍNH VÙNG PHỦ CỦA KHÍ TÀI
 * ======================================
 *
 * Đây là phần "trả lời bằng chứng" cho câu hỏi: khí tài đang chọn nằm trong vùng đất
 * như thế nào - bao nhiêu nhà, sông/suối ở đâu cách bao xa, địa hình dốc cỡ nào,
 * rừng phủ bao nhiêu phần trăm.
 *
 * Bán kính phân tích LUÔN bằng tầm hoạt động của khí tài đang chọn, nên mọi con số
 * trong bảng đều nằm trong "phạm vi hoạt động" mà câu hỏi quan tâm.
 *
 * Dữ liệu do `utils/featureAwareness.ts` dựng, gồm 3 nguồn:
 *   1. Ảnh raster (đã có sẵn) - chỉ để người nhìn, không đọc được nội dung.
 *   2. Cesium terrain (đã có sẵn) - cao độ thật: biết núi/đồi/độ dốc ở đâu.
 *   3. Lớp vectơ OSM (mới) - nhãn của từng đối tượng: nhà, sông, suối, rừng...
 */

import React from 'react';
import { Radar, Loader2, AlertTriangle, MapPin, TrendingUp, Home, Waves, Trees, Route, Building2 } from 'lucide-react';
import { useTacticalStore } from '../../store/useTacticalStore';
import { useShallow } from 'zustand/react/shallow';
import { SlopeRoseChart } from './charts/SlopeRoseChart';

/** 1 dòng số liệu trong bảng. */
function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-slate-800/60 last:border-b-0">
      <span className="text-[11px] text-slate-400 shrink-0">{label}</span>
      <span className="text-xs font-semibold text-cyan-200 text-right tabular-nums" title={hint}>
        {value}
      </span>
    </div>
  );
}

/** Khối tiêu đề nhóm chỉ số. */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * ĐẶC TÍNH VÙNG PHỦ — thành phần con của panel "AI phân tích".
 *
 * VÌ SAO KHÔNG CÒN BẢN NỔI RIÊNG: trước đây đây là một bảng định vị ở cột trái
 * (`absolute top-16 left-[336px]`), trùng vị trí với panel AI. Hai bảng cùng chỗ thì
 * vừa thừa (người dùng thấy hai bản của cùng một thứ) vừa che nhau. Nay nó chỉ
 * tồn tại bên trong panel AI, nên không còn lớp bọc định vị nào ở đây.
 *
 * Hệ quả: muốn xem đặc tính vùng phủ thì bấm nút "AI phân tích" trên thanh trên.
 */
export const SiteProfilePanel: React.FC = () => {
  const {
    siteProfile,
    isAnalyzingSite,
    analyzeSelectedSite,
    selectedInstanceId,
    instances,
    vectorPackCount,
  } = useTacticalStore(useShallow((state) => ({
    siteProfile: state.siteProfile,
    isAnalyzingSite: state.isAnalyzingSite,
    analyzeSelectedSite: state.analyzeSelectedSite,
    selectedInstanceId: state.selectedInstanceId,
    instances: state.instances,
    vectorPackCount: state.vectorPackCount,
  })));

  const instance = instances.find((i) => i.instanceId === selectedInstanceId);

  return (
    <SiteProfilePanelContent
      siteProfile={siteProfile}
      isAnalyzingSite={isAnalyzingSite}
      onAnalyze={() => void analyzeSelectedSite()}
      instance={instance}
      vectorPackCount={vectorPackCount}
    />
  );
};
/** Nội dung bảng đặc tính, tách riêng để phần điều kiện hiển thị không lặp lại. */
const SiteProfilePanelContent: React.FC<{
  siteProfile: ReturnType<typeof useTacticalStore.getState>['siteProfile'];
  isAnalyzingSite: boolean;
  onAnalyze: () => void;
  instance: ReturnType<typeof useTacticalStore.getState>['instances'][number] | undefined;
  vectorPackCount: number;
}> = ({ siteProfile, isAnalyzingSite, onAnalyze, instance, vectorPackCount }) => {
  if (!siteProfile && !isAnalyzingSite) {
    if (vectorPackCount === 0) {      return (
        <div className="rounded-xl border border-slate-800 bg-slate-950/85 backdrop-blur-md p-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-bold text-amber-300">Chưa có dữ liệu đối tượng vùng phủ</span>
          </div>
          <p className="leading-relaxed">
            Bản đồ hiện chỉ có ảnh vệ tinh — máy không phân biệt được đâu là nhà, đâu là sông.
            Chạy lệnh sau để tải dữ liệu vectơ (OpenStreetMap):
          </p>
          <code className="mt-1.5 block px-2 py-1 rounded bg-slate-900 text-[10px] text-emerald-300 font-mono break-all">
            npm run download-vector-tamdao
          </code>
        </div>
      );
    }

    return (
      <button
        onClick={onAnalyze}
        className="w-full rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-3 py-2 text-left hover:bg-emerald-950/70 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Radar className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-200">
            {instance ? `Phân tích vùng phủ ${instance.shortId ?? instance.name}` : 'Phân tích vùng phủ'}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-slate-400 leading-relaxed">
          {instance
            ? `Đếm nhà, sông, suối, núi, rừng trong tầm ${instance.rangeKm} km của khí tài này.`
            : 'Chọn một khí tài để đếm nhà, sông, suối, núi trong tầm hoạt động của nó.'}
        </p>
      </button>
    );
  }

  if (isAnalyzingSite || !siteProfile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/85 backdrop-blur-md p-3 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Đang lấy mẫu địa hình và đếm đối tượng vùng phủ...
      </div>
    );
  }
  const { terrain, features, radiusKm, areaKm2 } = siteProfile;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 max-h-[70vh] overflow-y-auto">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Radar className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-xs font-bold text-emerald-200 truncate">
              Phân tích vùng phủ
            </span>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Bán kính <span className="text-cyan-300 font-mono">{radiusKm} km</span>
            {' · '}diện tích ≈ <span className="text-cyan-300 font-mono">{areaKm2} km²</span>
          </p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={onAnalyze}
            className="px-2 py-1 rounded text-[10px] text-slate-300 hover:text-emerald-300 border border-slate-700 hover:border-emerald-600 transition-colors"
            title="Phân tích lại"
          >
            Cập nhật
          </button>
        </div>
      </div>

      {/* --- Địa hình (từ Cesium terrain) --- */}
      <Section icon={<TrendingUp className="w-3 h-3 text-amber-400" />} title="Địa hình">
        {terrain.hasTerrainData ? (
          <>
            <Row label="Cao độ tâm" value={`${terrain.elevationAtCenterM} m`} />
            <Row
              label="Dao động cao độ"
              value={`${terrain.minM} – ${terrain.maxM} m`}
              hint="Cao độ thấp nhất – cao nhất trong bán kính phân tích"
            />
            <Row label="Chênh cao độ" value={`${terrain.reliefM} m`} />
            <Row
              label="Độ dốc"
              value={`${terrain.maxSlopeDeg}° / TB ${terrain.meanSlopeDeg}°`}
              hint="Độ dốc lớn nhất / trung bình"
            />
            <Row
              label="Độ gồ ghề"
              value={`${Math.round(terrain.roughness * 100)}%`}
              hint="0% = đồng bằng phẳng, 100% = đồi núi gồ ghề"
            />
            {/* Biểu đồ đặt CUỐI section địa hình: nó tóm tắt bằng hình cái con số
                "độ dốc lớn nhất / trung bình" vừa hiển thị ở trên. */}
            <div className="mt-2">
              <SlopeRoseChart
                rings={siteProfile.terrainRings}
                centerElevationM={terrain.elevationAtCenterM}
                hasTerrainData={terrain.hasTerrainData}
              />
            </div>
          </>
        ) : (
          <p className="text-[10px] text-amber-400/80 leading-relaxed">
            Chưa có dữ liệu cao độ terrain cho vùng này.
          </p>
        )}
      </Section>

      {/* --- Núi (đếm từ lớp vectơ, độc lập với việc có terrain hay không) --- */}
      {terrain.peakCount > 0 && (
        <Section icon={<TrendingUp className="w-3 h-3 text-rose-400" />} title="Núi">
          <Row label="Số đỉnh núi" value={`${terrain.peakCount}`} />
          <Row label="Số sườn núi" value={`${terrain.ridgeCount}`} />
          {terrain.nearestPeak && (
            <Row
              label="Đỉnh gần nhất"
              value={`${terrain.nearestPeak.distanceKm} km${
                terrain.nearestPeak.name ? ` · ${terrain.nearestPeak.name}` : ''
              }`}
            />
          )}
        </Section>
      )}

      {/* --- Nhà cửa --- */}
      <Section icon={<Home className="w-3 h-3 text-slate-300" />} title="Nhà cửa">
        {features.buildingCount > 0 ? (
          <>
            <Row label="Số công trình" value={`${features.buildingCount}`} />
            <Row label="Mật độ" value={`${features.buildingDensityPerKm2} /km²`} />
            <Row
              label="Nhà gần nhất"
              value={features.nearestBuildingKm !== null ? `${features.nearestBuildingKm} km` : '—'}
            />
          </>
        ) : (
          <p className="text-[10px] text-slate-500">Không có công trình nào trong tầm.</p>
        )}
      </Section>

      {/* --- Nước --- */}
      <Section icon={<Waves className="w-3 h-3 text-sky-400" />} title="Nước">
        {features.riverCount > 0 || features.streamCount > 0 || features.waterBodyCount > 0 ? (
          <>
            {features.riverCount > 0 && (
              <>
                <Row label="Số sông / kênh lớn" value={`${features.riverCount}`} />
                <Row
                  label="Chiều dài sông trong vùng"
                  value={`${features.riverLengthKm} km`}
                  hint="Tổng chiều dài các tuyến sông nằm trong bán kính phân tích"
                />
                <Row
                  label="Sông gần nhất"
                  value={features.nearestRiverKm !== null ? `${features.nearestRiverKm} km` : '—'}
                />
              </>
            )}
            {features.streamCount > 0 && (
              <>
                <Row label="Số suối / kênh nhỏ" value={`${features.streamCount}`} />
                <Row label="Chiều dài suối trong vùng" value={`${features.streamLengthKm} km`} />
                <Row
                  label="Suối gần nhất"
                  value={features.nearestStreamKm !== null ? `${features.nearestStreamKm} km` : '—'}
                />
              </>
            )}
            {features.waterBodyCount > 0 && (
              <Row
                label="Hồ / đầm lầm"
                value={`${features.waterBodyCount} vùng · ${features.waterBodyAreaKm2} km²`}
              />
            )}
          </>
        ) : (
          <p className="text-[10px] text-slate-500">Không có sông, suối hay hồ trong tầm.</p>
        )}
      </Section>

      {/* --- Rừng --- */}
      <Section icon={<Trees className="w-3 h-3 text-green-400" />} title="Rừng & đất">
        {features.forestAreaKm2 > 0 ? (
          <>
            <Row
              label="Diện tích rừng"
              value={`${features.forestAreaKm2} km² (${Math.round(features.forestRatio * 100)}%)`}
            />
            <Row
              label="Rừng gần nhất"
              value={features.nearestForestKm !== null ? `${features.nearestForestKm} km` : '—'}
            />
          </>
        ) : (
          <p className="text-[10px] text-slate-500">Không có rừng được ghi nhận trong tầm.</p>
        )}
        {features.landAreaKm2 > 0 && (
          <Row label="Diện tích đất sử dụng" value={`${features.landAreaKm2} km²`} />
        )}
      </Section>

      {/* --- Giao thông --- */}
      {features.roadCount > 0 && (
        <Section icon={<Route className="w-3 h-3 text-yellow-400" />} title="Giao thông">
          <Row label="Số đoạn đường" value={`${features.roadCount}`} />
          <Row label="Tổng chiều dài đường" value={`${features.roadLengthKm} km`} />
          <Row
            label="Đường gần nhất"
            value={features.nearestHighwayKm !== null ? `${features.nearestHighwayKm} km` : '—'}
          />
        </Section>
      )}

      {/* --- Địa danh --- */}
      {features.placeNames.length > 0 && (
        <Section icon={<MapPin className="w-3 h-3 text-purple-400" />} title="Địa danh">
          <p className="text-[10px] text-slate-300 leading-relaxed">
            {features.placeNames.join(' · ')}
          </p>
        </Section>
      )}

      {/* --- Cảnh báo dữ liệu mỏng --- */}
      {features.isSparse && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-600/40 bg-amber-950/40 p-2">
          <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-200/90 leading-relaxed">
            Dữ liệu OSM ở vùng này khá mỏng (chưa được vẽ kỹ). Số liệu về nhà và đường
            có thể THẤP HƠN thực tế.
          </p>
        </div>
      )}

      {!features.hasVectorData && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-slate-700 bg-slate-900/60 p-2">
          <Building2 className="w-3 h-3 text-slate-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-400 leading-relaxed">
            Vùng này chưa có gói dữ liệu vectơ. Hãy tải gói cho vùng cần phân tích:
            {' '}
            <code className="text-emerald-300">npm run download-vector-tamdao</code>
          </p>
        </div>
      )}
    </div>
  );
};
