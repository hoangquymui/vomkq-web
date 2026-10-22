import { CesiumGlobe } from "./components/map/CesiumGlobe";
import { MapErrorBoundary } from "./components/map/MapErrorBoundary";
import { TopBar } from "./components/ui/TopBar";
import { LeftSidebar } from "./components/ui/LeftSidebar";
import { RightInspector } from "./components/ui/RightInspector";
import { MeasurementPanel, RulerPanel } from "./components/ui/MeasurementPanel";
import { PlacementBanner } from "./components/ui/PlacementBanner";
import { RadarFieldStatsModal } from "./components/ui/RadarFieldStatsModal";
import { RadarCrossSectionPanel } from "./components/ui/RadarCrossSectionPanel";
import { SpxRadarCoveragePanel } from "./components/ui/SpxRadarCoveragePanel";
import { MapDownloadModal } from "./components/ui/MapDownloadModal";
import { LayoutModal } from "./components/ui/LayoutModal";
import { TacticalLayerControls } from "./components/ui/TacticalLayerControls";
import { TacticalMapLegend } from "./components/ui/TacticalMapLegend";
import { AnalysisPanel } from './components/ui/AnalysisPanel';
import { TacticalSandboxHUD } from './components/ui/TacticalSandboxHUD';
import { FlatnessPatchListPanel } from './components/ui/FlatnessPatchListPanel';
import { TerrainZoneInspector } from './components/ui/TerrainZoneInspector';
import { Crosshair, Loader2, X } from 'lucide-react';

import { useTacticalStore } from './store/useTacticalStore';

export function App() {
  const showMapOverlays = useTacticalStore((state) => state.showMapOverlays);
  const isSelectingFlatnessCenter = useTacticalStore((state) => state.isSelectingFlatnessCenter);
  const isAnalyzingFlatness = useTacticalStore((state) => state.isAnalyzingFlatness);
  const cancelFlatnessSelection = useTacticalStore((state) => state.cancelFlatnessSelection);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* Bản đồ 3D Quả địa cầu / 2D Map
          Bọc error boundary: nếu WebGL không khả dụng (webview IDE, tắt tăng tốc phần cứng...),
          `new Cesium.Viewer(...)` ném lỗi trong useEffect mount. Không có boundary thì React 19 gỡ
          toàn bộ cây component -> trang trắng im lặng. Boundary giữ phần UI còn lại chạy bình thường
          và hiển thị thông báo khắc phục ngay tại vị trí khối bản đồ. */}
      <MapErrorBoundary>
        <CesiumGlobe />
      </MapErrorBoundary>

      {/* Thanh điều khiển trên cùng (Top Bar) */}
      <TopBar />

      {/* Bảng điều khiển trái: Kho khí tài & Biên chế (Catalog / Outliner) */}
      <LeftSidebar />

      {/* Bảng điều khiển phải: Bảng thuộc tính chiến thuật (Inspector) */}
      <RightInspector />

      {/* Thanh điều khiển lớp bản đồ & Bộ lọc chuyên ngành tác chiến */}
      <TacticalLayerControls />

      {/* Bảng chú giải ký hiệu bản đồ & dải tầng màu SPx */}
      {showMapOverlays && <TacticalMapLegend />}

      {/* GIS AI gồm bảng AI phân tích hiện có và hỏi đáp tài liệu local. */}
      <AnalysisPanel />

      {/* Sa bàn Tác chiến Mô phỏng (Tactical Radar Sandbox HUD) */}
      <TacticalSandboxHUD />

      {/* Banner thông báo khi đang đặt khí tài */}
      <PlacementBanner />

      {/* Thanh công cụ đo khoảng cách khi kích hoạt thước đo */}
      <MeasurementPanel />
      <RulerPanel />

      {/* Modal đánh giá chỉ số Trường Radar Tổng Hợp */}
      <RadarFieldStatsModal />

      {/* Modal Quản lý và Tải bản đồ ngoại tuyến */}
      <MapDownloadModal />

      {/* Modal Quản lý Bố Cục Trận Địa (Lưu / Nạp / Xóa JSON) */}
      <LayoutModal />

      {/* Bảng phân tích Mặt Cắt Ngang 2D (Cross Section) */}
      <RadarCrossSectionPanel />

      {/* Bảng điều khiển mô phỏng vùng phủ radar SPx (Cambridge Pixel) */}
      <SpxRadarCoveragePanel />

      {/* Banner hướng dẫn khi đang chọn tâm phân tích 1km */}
      {isSelectingFlatnessCenter && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-xl border border-emerald-500/80 bg-slate-950/95 backdrop-blur-md text-emerald-200 text-xs shadow-[0_0_25px_rgba(16,185,129,0.35)] animate-bounce">
          <Crosshair className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>
            <strong>CHỌN TÂM VÙNG PHÂN TÍCH (BÁN KÍNH 1KM):</strong> Nhấp chuột vào điểm bất kỳ trên bản đồ 3D để quét tìm các bãi bằng phẳng (≥ 10.000 m², ΔH ≤ 4m).
          </span>
          <button
            onClick={cancelFlatnessSelection}
            className="ml-2 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition-colors flex items-center gap-1 border border-slate-700"
          >
            <X className="w-3.5 h-3.5" />
            Hủy
          </button>
        </div>
      )}

      {/* Toast loading khi đang phân tích độ bằng phẳng DEM */}
      {isAnalyzingFlatness && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-sm pointer-events-auto">
          <div className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-cyan-500/60 bg-slate-950/95 text-slate-100 shadow-[0_0_35px_rgba(6,182,212,0.4)]">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            <div className="text-center">
              <h4 className="text-sm font-bold text-cyan-300 font-mono">ĐANG PHÂN TÍCH ĐỊA HÌNH TRẬN ĐỊA 3D</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">
                Đang lấy mẫu cao độ DEM 25×25 (625 điểm) và tính toán các cụm bằng phẳng Union-Find...
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bảng danh sách các mảng bằng phẳng tìm thấy */}
      <FlatnessPatchListPanel />

      {/* Màn hình khảo sát chi tiết mảng địa hình 3D / 2D (Terrain Zone Inspector) */}
      <TerrainZoneInspector />
    </div>
  );
}

export default App;
