import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Grid,
  Mountain,
} from 'lucide-react';
import type { FlatPatch } from '../../utils/terrainFlatnessEngine';

interface TacticalCanvas2DProps {
  patch: FlatPatch;
}

/**
 * Bản đồ 2D Tactical vi địa hình (Micro-DEM) theo chuẩn quân sự:
 * - Tương tác đầy đủ: Lăn chuột zoom mượt tại tâm con trỏ, kéo rê chuột (pan) di chuyển bản đồ
 * - Cụm nút điều khiển UI: Zoom In, Zoom Out, Reset, Fit, Bật/Tắt lưới DEM, Bật/Tắt đường đồng mức
 * - Chuẩn hóa tỷ lệ khung hình WGS84 không méo (1 mét trục X = 1 mét trục Y)
 * - Tinh chỉnh vi địa hình: Ẩn mặc định ô vuông 14x14px thô, vẽ đường đồng mức mảnh sắc nét
 * - Thước tỷ lệ mét động (Dynamic Scale Bar) tự điều chỉnh theo mức zoom
 * - La bàn định hướng Bắc & Véc-tơ tuyến giao thông tiếp cận
 * - Cảnh báo mặt nước nếu mảng tiếp giáp hoặc có cảnh báo dòng chảy
 */
export const TacticalCanvas2D: React.FC<TacticalCanvas2DProps> = ({ patch }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Trạng thái tương tác bản đồ
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tùy chọn hiển thị lớp bản đồ
  const [showDemGrid, setShowDemGrid] = useState<boolean>(false); // Mặc định tắt các ô DEM thô
  const [showContours, setShowContours] = useState<boolean>(true); // Bật đường đồng mức

  // Reset về góc nhìn mặc định
  const handleResetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom In / Zoom Out
  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(10.0, z * 1.3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(0.3, z / 1.3));
  }, []);

  // Đổi mảng: tự động reset góc nhìn
  useEffect(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  }, [patch.id]);

  // Xử lý sự kiện lăn chuột (Wheel Zoom) tại vị trí trỏ chuột
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      setZoom((prevZoom) => {
        const nextZoom = Math.max(0.3, Math.min(10.0, prevZoom * factor));
        const effectiveFactor = nextZoom / prevZoom;

        // Giữ vị trí chuột cố định trên không gian bản đồ khi zoom
        setPan((prevPan) => ({
          x: mouseX - (mouseX - prevPan.x) * effectiveFactor,
          y: mouseY - (mouseY - prevPan.y) * effectiveFactor,
        }));

        return nextZoom;
      });
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Xử lý Kéo rê chuột (Pan)
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // Chỉ nhận chuột trái
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Vẽ Canvas 2D
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // 1. Nền bản đồ tối quân sự
    ctx.fillStyle = '#06101e';
    ctx.fillRect(0, 0, width, height);

    if (patch.polygon.length < 3) return;

    // 2. Chuẩn hóa tỷ lệ WGS84 không méo (1m trục X = 1m trục Y)
    const mPerDegLat = 111_132.92;
    const mPerDegLon = 111_412.84 * Math.cos((patch.centerLat * Math.PI) / 180);

    // Chuyển đổi tọa độ polygon sang hệ mét địa phương so với tâm mảng
    const polyM = patch.polygon.map((p) => ({
      xM: (p.lon - patch.centerLon) * mPerDegLon,
      yM: (p.lat - patch.centerLat) * mPerDegLat,
    }));

    let minXM = Number.POSITIVE_INFINITY;
    let maxXM = Number.NEGATIVE_INFINITY;
    let minYM = Number.POSITIVE_INFINITY;
    let maxYM = Number.NEGATIVE_INFINITY;

    for (const p of polyM) {
      if (p.xM < minXM) minXM = p.xM;
      if (p.xM > maxXM) maxXM = p.xM;
      if (p.yM < minYM) minYM = p.yM;
      if (p.yM > maxYM) maxYM = p.yM;
    }

    const spanXM = Math.max(30, maxXM - minXM);
    const spanYM = Math.max(30, maxYM - minYM);
    const padM = Math.max(spanXM, spanYM) * 0.35 + 30;

    const totalXM = spanXM + 2 * padM;
    const totalYM = spanYM + 2 * padM;

    // Tỷ lệ đồng nhất (Isotropic scale): 1 mét = scale pixel
    const baseScale = Math.min(width / totalXM, height / totalYM);
    const scale = baseScale * zoom;

    const centerPolyXM = (minXM + maxXM) / 2;
    const centerPolyYM = (minYM + maxYM) / 2;

    const projectM = (xM: number, yM: number): [number, number] => {
      const sx = width / 2 + (xM - centerPolyXM) * scale + pan.x;
      const sy = height / 2 - (yM - centerPolyYM) * scale + pan.y;
      return [sx, sy];
    };

    const projectGeo = (lon: number, lat: number): [number, number] => {
      const xM = (lon - patch.centerLon) * mPerDegLon;
      const yM = (lat - patch.centerLat) * mPerDegLat;
      return projectM(xM, yM);
    };

    // 3. Lưới toạ độ chiến thuật (Tactical Grid)
    ctx.strokeStyle = '#0e2338';
    ctx.lineWidth = 1;
    const gridStepPx = Math.max(30, Math.min(80, 50 * scale));
    const startX = ((pan.x % gridStepPx) + gridStepPx) % gridStepPx;
    const startY = ((pan.y % gridStepPx) + gridStepPx) % gridStepPx;

    for (let x = startX; x < width; x += gridStepPx) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = startY; y < height; y += gridStepPx) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 4. Biểu diễn vi địa hình thực tế (Samples & Contours)
    const samples = patch.samples || [];
    const deltaH = Math.max(0.2, patch.deltaElevM);
    const minH = patch.minElevM;

    // A. Lưới cao độ DEM (chỉ hiển thị khi bật Toggle Grid với các điểm chấm tinh tế)
    if (showDemGrid && samples.length > 0) {
      for (const s of samples) {
        const [sx, sy] = projectGeo(s.lon, s.lat);
        if (sx < -20 || sx > width + 20 || sy < -20 || sy > height + 20) continue;

        const norm = Math.max(0, Math.min(1, (s.height - minH) / deltaH));
        const r = Math.round(16 + norm * (245 - 16));
        const g = Math.round(185 - norm * 20);
        const b = Math.round(129 + norm * (11 - 129));

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(2, Math.min(4.5, 2.5 * zoom)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // B. Đường đồng mức vi địa hình thực tế (Contours)
    if (showContours && samples.length > 0) {
      const contourLevels: number[] = [];
      const startH = Math.ceil(minH * 2) / 2;
      for (let h = startH; h <= patch.maxElevM; h += 0.5) {
        contourLevels.push(h);
      }

      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);

      for (const targetH of contourLevels) {
        const closeSamples = samples.filter((s) => Math.abs(s.height - targetH) <= 0.35);
        if (closeSamples.length >= 2) {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
          ctx.beginPath();
          const first = projectGeo(closeSamples[0].lon, closeSamples[0].lat);
          ctx.moveTo(first[0], first[1]);

          for (let i = 1; i < closeSamples.length; i++) {
            const pt = projectGeo(closeSamples[i].lon, closeSamples[i].lat);
            ctx.lineTo(pt[0], pt[1]);
          }
          ctx.stroke();

          // Nhãn cao độ trên đường đồng mức
          if (closeSamples.length > 0 && zoom >= 0.8) {
            const mid = projectGeo(closeSamples[0].lon, closeSamples[0].lat);
            ctx.fillStyle = 'rgba(56, 189, 248, 0.75)';
            ctx.font = '8px "JetBrains Mono", monospace';
            ctx.fillText(`${targetH.toFixed(1)}m`, mid[0] + 4, mid[1] - 3);
          }
        }
      }
      ctx.setLineDash([]);
    }

    // 5. Đa giác mảng địa hình bằng phẳng (Patch Polygon)
    const points = patch.polygon.map((p) => projectGeo(p.lon, p.lat));
    if (points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();

      // Tô màu lòng đa giác bán trong suốt siêu nhẹ
      const patchGrad = ctx.createLinearGradient(0, 0, width, height);
      if (patch.isDeployable) {
        patchGrad.addColorStop(0, 'rgba(16, 185, 129, 0.16)');
        patchGrad.addColorStop(1, 'rgba(6, 182, 212, 0.09)');
      } else {
        patchGrad.addColorStop(0, 'rgba(245, 158, 11, 0.18)');
        patchGrad.addColorStop(1, 'rgba(239, 68, 68, 0.11)');
      }
      ctx.fillStyle = patchGrad;
      ctx.fill();

      // Viền phát sáng neon
      ctx.shadowColor = patch.isDeployable ? '#10b981' : '#f59e0b';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = patch.isDeployable ? '#34d399' : '#fbbf24';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Đỉnh đa giác (Vertex pins)
      ctx.fillStyle = '#ffffff';
      for (const [px, py] of points) {
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, Math.min(4, 2.5 * zoom)), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 6. Tâm khuyến nghị đặt khí tài (Tactical Crosshair)
    const [cx, cy] = projectGeo(patch.centerLon, patch.centerLat);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();
    ctx.setLineDash([]);

    // Dấu chữ thập
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(cx - 26, cy);
    ctx.lineTo(cx - 15, cy);
    ctx.moveTo(cx + 15, cy);
    ctx.lineTo(cx + 26, cy);
    ctx.moveTo(cx, cy - 26);
    ctx.lineTo(cx, cy - 15);
    ctx.moveTo(cx, cy + 15);
    ctx.lineTo(cx, cy + 26);
    ctx.stroke();

    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Nhãn tâm điểm
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText('ĐIỂM ĐẶT TRẬN ĐỊA KHUYẾN NGHỊ', cx + 18, cy - 18);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(
      `${patch.centerLat.toFixed(5)}°N, ${patch.centerLon.toFixed(5)}°E`,
      cx + 18,
      cy - 6
    );

    // 7. Véc-tơ tuyến đường tiếp cận (nếu có)
    if (patch.roadCount > 0) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cx - 50, cy + 45);
      ctx.lineTo(cx - 10, cy + 15);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fbbf24';
      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillText(`TUYẾN TIẾP CẬN (${patch.roadCount} ĐOẠN ĐƯỜNG)`, cx - 85, cy + 60);
    }

    // 8. Cảnh báo mặt nước (nếu có)
    if (patch.waterWarning) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(18, 54, 260, 24);
      ctx.fillRect(18, 54, 260, 24);
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText(`⚠️ CẢNH BÁO NƯỚC: ${patch.waterWarning.slice(0, 35)}...`, 24, 70);
    }

    // 9. La bàn định hướng Bắc (Compass Rose)
    const compassX = 42;
    const compassY = 120;
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(compassX, compassY, 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(compassX, compassY - 12);
    ctx.lineTo(compassX - 4, compassY);
    ctx.lineTo(compassX, compassY - 2);
    ctx.closePath();
    ctx.fillStyle = '#f43f5e';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(compassX, compassY + 12);
    ctx.lineTo(compassX - 4, compassY);
    ctx.lineTo(compassX, compassY + 2);
    ctx.closePath();
    ctx.fillStyle = '#475569';
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', compassX, compassY - 16);
    ctx.textAlign = 'left';

    // 10. Thước đo tỷ lệ thực tế động (Dynamic Metric Scale Bar)
    const scaleBarX = 24;
    const scaleBarY = height - 24;

    // Chọn mức khoảng cách mét phù hợp (10m, 20m, 50m, 100m, 200m, 500m)
    const candidateMeters = [10, 20, 50, 100, 200, 500, 1000];
    let chosenM = 50;
    for (const m of candidateMeters) {
      const px = m * scale;
      if (px >= 50 && px <= 140) {
        chosenM = m;
        break;
      }
    }
    const scaleBarPx = Math.round(chosenM * scale);

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(scaleBarX, scaleBarY - 4);
    ctx.lineTo(scaleBarX, scaleBarY);
    ctx.lineTo(scaleBarX + scaleBarPx, scaleBarY);
    ctx.lineTo(scaleBarX + scaleBarPx, scaleBarY - 4);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`0`, scaleBarX - 2, scaleBarY - 8);
    ctx.fillText(`${chosenM}m`, scaleBarX + scaleBarPx - 14, scaleBarY - 8);

    // 11. Bảng số liệu vi địa hình
    ctx.fillStyle = 'rgba(6, 16, 30, 0.88)';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.fillRect(width - 225, height - 76, 212, 64);
    ctx.strokeRect(width - 225, height - 76, 212, 64);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(
      `DIỆN TÍCH: ${(patch.areaM2 / 10000).toFixed(2)} ha (${patch.areaM2.toLocaleString('vi-VN')} m²)`,
      width - 215,
      height - 58
    );
    ctx.fillText(
      `CHÊNH CAO ΔH: ${patch.deltaElevM.toFixed(1)} m [${Math.round(patch.minElevM)} - ${Math.round(patch.maxElevM)}m]`,
      width - 215,
      height - 44
    );
    ctx.fillText(
      `ĐỘ DỐC NỘI BỘ: TB ${patch.meanSlopeDeg.toFixed(1)}° | MAX ${patch.maxSlopeDeg.toFixed(1)}°`,
      width - 215,
      height - 30
    );
    ctx.fillText(
      `TỶ LỆ ZOOM: ${(zoom * 100).toFixed(0)}% (1px = ${(1 / scale).toFixed(2)}m)`,
      width - 215,
      height - 16
    );
  }, [patch, zoom, pan, showDemGrid, showContours]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[460px] bg-slate-950 rounded-xl overflow-hidden border border-cyan-900/40 select-none"
    >
      {/* Canvas bản đồ */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`w-full h-full block ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      />

      {/* Tiêu đề góc trên bên trái */}
      <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur border border-cyan-800/60 rounded px-2.5 py-1 text-[11px] font-mono text-cyan-300 pointer-events-none shadow-lg">
        BẢN ĐỒ VI ĐỊA HÌNH 2D (MICRO-DEM CONTOURS & ACCESS VECTOR)
      </div>

      {/* Cụm nút điều khiển UI tương tác góc trên bên phải */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-950/90 backdrop-blur border border-slate-800 rounded-lg p-1 shadow-2xl">
        <button
          onClick={handleZoomIn}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
          title="Phóng to (Zoom In)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
          title="Thu nhỏ (Zoom Out)"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetView}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
          title="Căn giữa & Khôi phục mặc định"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={handleResetView}
          className="p-1.5 rounded hover:bg-slate-800 text-slate-300 hover:text-cyan-300 transition-colors"
          title="Căn vừa mảng địa hình (Fit to view)"
        >
          <Maximize2 className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-slate-800 mx-0.5" />

        <button
          onClick={() => setShowDemGrid(!showDemGrid)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all border ${
            showDemGrid
              ? 'bg-cyan-950 text-cyan-300 border-cyan-500/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800'
          }`}
          title="Bật/Tắt Lưới cao độ DEM (Mặc định: Tắt)"
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Lưới DEM</span>
        </button>

        <button
          onClick={() => setShowContours(!showContours)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-all border ${
            showContours
              ? 'bg-cyan-950 text-cyan-300 border-cyan-500/80 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800'
          }`}
          title="Bật/Tắt Đường đồng mức vi địa hình"
        >
          <Mountain className="w-3.5 h-3.5" />
          <span>Đường đồng mức</span>
        </button>
      </div>

      {/* Hướng dẫn thao tác nhanh */}
      <div className="absolute bottom-3 left-44 text-[10px] font-mono text-slate-500 pointer-events-none">
        Lăn chuột: Zoom · Kéo giữ: Pan di chuyển
      </div>
    </div>
  );
};
