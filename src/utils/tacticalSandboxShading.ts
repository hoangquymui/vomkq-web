/**
 * Tiện ích tạo hiệu ứng hiển thị Sa bàn Tác chiến Tương phản cao trên Quả cầu Cesium 3D
 * (High-Contrast Tactical Radar Scope & Terrain Shading Engine)
 * 
 * Thông số kỹ thuật:
 * - Tên hàm: createTacticalGlobeMaterial
 * - Đầu vào: theme ('monochrome' | 'crt_green' | 'amber'), minAltM (m), maxAltM (m)
 * - Đầu ra: Cesium.Material (ElevationRamp)
 * - Tác dụng: Tô bóng bề mặt địa hình 3D thành màu tương phản cao, nền đen, các đỉnh núi màu sáng
 */
import * as Cesium from 'cesium';
import type { SandboxVisualTheme } from '../types/tacticalSandbox';

interface SavedGlobeState {
  originalMaterial?: Cesium.Material;
  originalBaseColor?: Cesium.Color;
  layersState: Array<{
    show: boolean;
    alpha: number;
  }>;
}

let savedState: SavedGlobeState | null = null;

/**
 * Sinh Canvas 1D chứa Gradient dải màu theo chủ đề hiển thị
 * 
 * - Tên biến: canvas
 * - Kích thước: 256x1 pixel
 * - Gradient dải màu: 0.0 (chân thung lũng / độ cao 0m) -> 1.0 (đỉnh núi cao nhất)
 */
export function generateElevationRampCanvas(theme: SandboxVisualTheme): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    return { width: 256, height: 1 } as HTMLCanvasElement;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const grad = ctx.createLinearGradient(0, 0, 256, 0);

  if (theme === 'monochrome') {
    // Monochrome: Nền tối sâu thung lũng -> Xám bạc sườn núi -> Trắng tinh đỉnh núi
    grad.addColorStop(0.00, '#070b14');
    grad.addColorStop(0.10, '#131b2e');
    grad.addColorStop(0.30, '#334155');
    grad.addColorStop(0.55, '#64748b');
    grad.addColorStop(0.80, '#cbd5e1');
    grad.addColorStop(1.00, '#ffffff');
  } else if (theme === 'crt_green') {
    // CRT Green: Huỳnh quang xanh màn radar cảnh giới P-18 / Kolchuga
    grad.addColorStop(0.00, '#02140d');
    grad.addColorStop(0.10, '#042f22');
    grad.addColorStop(0.30, '#065f46');
    grad.addColorStop(0.55, '#059669');
    grad.addColorStop(0.80, '#34d399');
    grad.addColorStop(1.00, '#a7f3d0');
  } else {
    // Amber HUD: Hổ phách tác chiến ban đêm
    grad.addColorStop(0.00, '#160a02');
    grad.addColorStop(0.10, '#2e1405');
    grad.addColorStop(0.30, '#78350f');
    grad.addColorStop(0.55, '#d97706');
    grad.addColorStop(0.80, '#fbbf24');
    grad.addColorStop(1.00, '#fef08a');
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 1);
  return canvas;
}

/**
 * Khởi tạo vật liệu ElevationRamp cho Globe của Cesium
 * 
 * - minAltM: Cao độ thấp nhất mốc màu (mặc định 0m)
 * - maxAltM: Cao độ cao nhất mốc màu (mặc định 1600m - tương đương đỉnh Tam Đảo / dãy núi cao phía Bắc)
 */
export function createTacticalGlobeMaterial(
  theme: SandboxVisualTheme,
  minAltM: number = 0,
  maxAltM: number = 1600
): Cesium.Material {
  const rampCanvas = generateElevationRampCanvas(theme);

  return new Cesium.Material({
    fabric: {
      type: 'ElevationRamp',
      uniforms: {
        image: rampCanvas,
        minimumHeight: minAltM,
        maximumHeight: maxAltM,
      },
    },
  });
}

/**
 * Áp dụng chế độ sa bàn lên Cesium Viewer:
 * 1. Lưu lại trạng thái lớp bản đồ vệ tinh hiện tại
 * 2. Ẩn tạm thời các ảnh chụp vệ tinh thông thường để bề mặt địa hình thành màu đen
 * 3. Gán vật liệu ElevationRamp để núi non nhô lên màu sáng theo độ cao
 */
export function applyTacticalSandboxShading(
  viewer: Cesium.Viewer,
  theme: SandboxVisualTheme = 'monochrome',
  minAltM: number = 0,
  maxAltM: number = 1600
): void {
  if (!viewer || viewer.isDestroyed()) return;

  const globe = viewer.scene.globe;

  // Lưu trạng thái trước khi chuyển nếu chưa có bản lưu
  if (!savedState) {
    const layers = viewer.imageryLayers;
    const layersState: Array<{ show: boolean; alpha: number }> = [];
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      layersState.push({
        show: layer.show,
        alpha: layer.alpha,
      });
    }

    savedState = {
      originalMaterial: globe.material,
      originalBaseColor: globe.baseColor,
      layersState,
    };
  }

  // Tạm ẩn/làm trong suốt các lớp ảnh nền thông thường
  const layers = viewer.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    layer.alpha = 0.0;
  }

  // Nền địa cầu đen tuyền
  globe.baseColor = Cesium.Color.BLACK;

  // Giải phóng vật liệu cũ nếu có để GPU re-bind
  if (globe.material) {
    try {
      (globe.material as any).destroy?.();
    } catch {
      // ignore
    }
    globe.material = undefined as any;
  }

  // Gán vật liệu tương phản cao
  globe.material = createTacticalGlobeMaterial(theme, minAltM, maxAltM);
  viewer.scene.requestRender();
}

/**
 * Hoàn nguyên trạng thái Quả cầu Cesium về chế độ bản đồ vệ tinh thông thường
 */
export function revertTacticalSandboxShading(viewer: Cesium.Viewer): void {
  if (!viewer || viewer.isDestroyed()) {
    savedState = null;
    return;
  }

  const globe = viewer.scene.globe;

  // Xóa bỏ vật liệu ElevationRamp
  globe.material = undefined as any;

  if (savedState) {
    if (savedState.originalBaseColor) {
      globe.baseColor = savedState.originalBaseColor;
    }

    // Khôi phục hiển thị các lớp bản đồ
    const layers = viewer.imageryLayers;
    for (let i = 0; i < layers.length && i < savedState.layersState.length; i++) {
      const layer = layers.get(i);
      const state = savedState.layersState[i];
      layer.show = state.show;
      layer.alpha = state.alpha;
    }

    savedState = null;
  } else {
    // Fallback: bật lại lớp ảnh nền đầu tiên với alpha = 1
    const layers = viewer.imageryLayers;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers.get(i);
      layer.alpha = 1.0;
      layer.show = true;
    }
  }

  viewer.scene.requestRender();
}
