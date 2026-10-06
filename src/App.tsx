import { lazy, Suspense } from "react";
import { CesiumGlobe } from "./components/map/CesiumGlobe";
import { MapErrorBoundary } from "./components/map/MapErrorBoundary";
import { TopBar } from "./components/ui/TopBar";
import { LeftSidebar } from "./components/ui/LeftSidebar";
import { MeasurementPanel } from "./components/ui/MeasurementPanel";
import { PlacementBanner } from "./components/ui/PlacementBanner";
import { TacticalLayerControls } from "./components/ui/TacticalLayerControls";
import { TacticalMapLegend } from "./components/ui/TacticalMapLegend";

// Tách nhỏ mã nguồn: nạp lười (lazy loading) các panel và modal nặng khi cần
const RightInspector = lazy(() =>
  import("./components/ui/RightInspector").then((m) => ({ default: m.RightInspector }))
);
const RadarCrossSectionPanel = lazy(() =>
  import("./components/ui/RadarCrossSectionPanel").then((m) => ({ default: m.RadarCrossSectionPanel }))
);
const RadarFieldStatsModal = lazy(() =>
  import("./components/ui/RadarFieldStatsModal").then((m) => ({ default: m.RadarFieldStatsModal }))
);
const SpxRadarCoveragePanel = lazy(() =>
  import("./components/ui/SpxRadarCoveragePanel").then((m) => ({ default: m.SpxRadarCoveragePanel }))
);
const MapDownloadModal = lazy(() =>
  import("./components/ui/MapDownloadModal").then((m) => ({ default: m.MapDownloadModal }))
);
const LayoutModal = lazy(() =>
  import("./components/ui/LayoutModal").then((m) => ({ default: m.LayoutModal }))
);
const AiPlacementAdvisorPanel = lazy(() =>
  import("./components/ui/AiPlacementAdvisorPanel").then((m) => ({ default: m.AiPlacementAdvisorPanel }))
);

export function App() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* Bản đồ 3D Quả địa cầu / 2D Map
          Bọc error boundary: nếu WebGL không khả dụng (webview IDE, tắt tăng tốc phần khúc...),
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

      {/* Thanh điều khiển lớp bản đồ & Bộ lọc chuyên ngành tác chiến */}
      <TacticalLayerControls />

      {/* Bảng chú giải ký hiệu bản đồ & dải tầng màu SPx */}
      <TacticalMapLegend />

      {/* Banner thông báo khi đang đặt khí tài */}
      <PlacementBanner />

      {/* Thanh công cụ đo khoảng cách khi kích hoạt thước đo */}
      <MeasurementPanel />

      {/* Các panel & modal nặng được nạp lười bất đồng bộ */}
      <Suspense fallback={null}>
        <RightInspector />
        <AiPlacementAdvisorPanel />
        <RadarFieldStatsModal />
        <MapDownloadModal />
        <LayoutModal />
        <RadarCrossSectionPanel />
        <SpxRadarCoveragePanel />
      </Suspense>
    </div>
  );
}

export default App;
