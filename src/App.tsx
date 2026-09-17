import { useEffect } from "react";
import { CesiumGlobe } from "./components/map/CesiumGlobe";
import { TopBar } from "./components/ui/TopBar";
import { LeftSidebar } from "./components/ui/LeftSidebar";
import { RightInspector } from "./components/ui/RightInspector";
import { MeasurementPanel } from "./components/ui/MeasurementPanel";
import { PlacementBanner } from "./components/ui/PlacementBanner";
import { RadarFieldStatsModal } from "./components/ui/RadarFieldStatsModal";
import { useTacticalStore } from "./store/useTacticalStore";

export function App() {
  const { loadSampleScenario } = useTacticalStore();

  // Nạp sẵn kịch bản mẫu lúc khởi động
  useEffect(() => {
    loadSampleScenario();
  }, [loadSampleScenario]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {/* Bản đồ 3D Quả địa cầu / 2D Map */}
      <CesiumGlobe />

      {/* Thanh điều khiển trên cùng (Top Bar) */}
      <TopBar />

      {/* Bảng điều khiển trái: Kho khí tài & Biên chế (Catalog / Outliner) */}
      <LeftSidebar />

      {/* Bảng điều khiển phải: Bảng thuộc tính chiến thuật (Inspector) */}
      <RightInspector />

      {/* Banner thông báo khi đang đặt khí tài */}
      <PlacementBanner />

      {/* Thanh công cụ đo khoảng cách khi kích hoạt thước đo */}
      <MeasurementPanel />

      {/* Modal đánh giá chỉ số Trường Radar Tổng Hợp */}
      <RadarFieldStatsModal />
    </div>
  );
}

export default App;
