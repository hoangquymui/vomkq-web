import { CesiumGlobe } from "./components/map/CesiumGlobe";
import { MapErrorBoundary } from "./components/map/MapErrorBoundary";
import { TopBar } from "./components/ui/TopBar";
import { LeftSidebar } from "./components/ui/LeftSidebar";
import { RightInspector } from "./components/ui/RightInspector";
import { MeasurementPanel } from "./components/ui/MeasurementPanel";
import { PlacementBanner } from "./components/ui/PlacementBanner";
import { RadarFieldStatsModal } from "./components/ui/RadarFieldStatsModal";
import { RadarCrossSectionPanel } from "./components/ui/RadarCrossSectionPanel";
import { SpxRadarCoveragePanel } from "./components/ui/SpxRadarCoveragePanel";
import { MapDownloadModal } from "./components/ui/MapDownloadModal";
import { LayoutModal } from "./components/ui/LayoutModal";
import { TacticalLayerControls } from "./components/ui/TacticalLayerControls";
import { TacticalMapLegend } from "./components/ui/TacticalMapLegend";
import { AiPlacementAdvisorPanel } from "./components/ui/AiPlacementAdvisorPanel";

export function App() {

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
      <TacticalMapLegend />

      {/* Panel cố vấn vị trí đặt khí tài bằng AI local (VECTOR AI) */}
      <AiPlacementAdvisorPanel />

      {/* Banner thông báo khi đang đặt khí tài */}
      <PlacementBanner />

      {/* Thanh công cụ đo khoảng cách khi kích hoạt thước đo */}
      <MeasurementPanel />

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
    </div>
  );
}

export default App;
