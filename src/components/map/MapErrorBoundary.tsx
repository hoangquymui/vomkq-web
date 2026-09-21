import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

/**
 * Ranh giới lỗi (Error Boundary) cho khối bản đồ 3D Cesium.
 *
 * Vì sao cần: `new Cesium.Viewer(...)` được gọi trong `useEffect` mount của `CesiumGlobe.tsx` và ném
 * `RuntimeError: The browser supports WebGL, but initialization failed.` khi trình duyệt/webview
 * không cấp được WebGL context. React 19 không có error boundary mặc định, nên lỗi này làm gỡ toàn bộ
 * cây component -> trang trắng im lặng, người dùng không biết vì sao.
 *
 * Cơ chế bắt lỗi: React bọc phần chạy effect trong `try/catch` tại `commitHookEffectListMount` rồi gọi
 * `captureCommitPhaseError(fiber, fiber.return, error)`; hàm này đi ngược lên cây fiber tìm ancestor
 * gần nhất (class component) có `getDerivedStateFromError` và enqueue `createClassErrorUpdate`.
 * Nhờ vậy lỗi trong effect vẫn được boundary này bắt, thay vì làm sập cả app.
 *
 * Phạm vi: chỉ bọc `<CesiumGlobe />`, không ảnh hưởng state/store hay API của các component khác.
 */
interface MapErrorBoundaryProps {
  children: ReactNode;
}

interface MapErrorBoundaryState {
  error: Error | null;
}

/** Nhận diện lỗi do WebGL để đưa hướng khắc phục đúng trọng tâm (trường hợp phổ biến nhất của Cesium) */
const WEBGL_ERROR_PATTERN = /webgl|initialization failed/i;

/** Nguyên nhân khi lỗi được xác định là do WebGL */
const WEBGL_CAUSES: string[] = [
  'WebGL không khả dụng: trình duyệt không cấp được WebGL context (đã tắt tăng tốc phần cứng, driver GPU lỗi, hoặc đang chạy qua Remote Desktop / máy ảo).',
  'Webview nhúng trong IDE (VS Code, Cursor, ...) thường thiếu GPU acceleration nên Cesium không dựng được cảnh 3D.',
  'Tiến trình GPU của trình duyệt đã bị crash hoặc hết tài nguyên GPU do mở quá nhiều tab nặng.',
];

/** Cách khắc phục khi lỗi do WebGL */
const WEBGL_FIXES: string[] = [
  'Mở lại địa chỉ http://localhost:3000/ bằng Chrome hoặc Edge bản desktop, không dùng webview trong IDE.',
  'Bật "Use graphics acceleration when available" trong Settings -> System của Chrome/Edge rồi khởi động lại trình duyệt.',
  'Kiểm tra chrome://gpu, xem dòng "WebGL: Hardware accelerated"; nếu báo lỗi thì cập nhật driver GPU.',
  'Nếu buộc phải chạy trong môi trường không GPU, khởi động trình duyệt kèm cờ --enable-unsafe-swiftshader để dùng WebGL phần mềm.',
  'Đóng bớt tab đang dùng nhiều GPU rồi tải lại trang.',
];

/** Nguyên nhân dự phòng khi lỗi không thuộc nhóm WebGL */
const GENERIC_CAUSES: string[] = [
  'WebGL không khả dụng hoặc bị tắt tăng tốc phần cứng (nguyên nhân thường gặp nhất với Cesium).',
  'Không nạp được tài nguyên bản đồ: địa hình/ảnh ngoại tuyến trong public/ hoặc mạng tới dịch vụ bản đồ trực tuyến.',
  'Lỗi khởi tạo Cesium không mong đợi (xem chi tiết lỗi gốc bên dưới và trong Console).',
];

/** Cách khắc phục dự phòng */
const GENERIC_FIXES: string[] = [
  'Tải lại trang; nếu vẫn lỗi, mở Console (F12) để xem log "[MapErrorBoundary]" và stack của lỗi gốc.',
  'Kiểm tra WebGL tại chrome://gpu và bật tăng tốc phần cứng nếu đang tắt.',
  'Kiểm tra kết nối mạng và sự tồn tại của thư mục public/offline-terrain, public/offline-satellite.',
];

export class MapErrorBoundary extends Component<MapErrorBoundaryProps, MapErrorBoundaryState> {
  state: MapErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): MapErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Không nuốt lỗi: ghi lại lỗi gốc kèm stack cây component để còn chẩn đoán.
    console.error(
      '[MapErrorBoundary] Khối bản đồ 3D không khởi tạo được:',
      error,
      errorInfo.componentStack
    );
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isWebGlError = WEBGL_ERROR_PATTERN.test(error.message);
    const causes = isWebGlError ? WEBGL_CAUSES : GENERIC_CAUSES;
    const fixes = isWebGlError ? WEBGL_FIXES : GENERIC_FIXES;

    return (
      <div className="absolute inset-0 z-0 bg-slate-950 flex items-center justify-center px-4 pt-20 pb-24 select-none">
        <div className="max-w-2xl w-full bg-slate-900/90 backdrop-blur-md border border-amber-500/50 rounded-2xl shadow-[0_0_32px_rgba(0,0,0,0.8)] p-6 flex flex-col gap-4">
          {/* Tiêu đề + mô tả ngắn */}
          <div className="flex items-start gap-3">
            <TriangleAlert className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <h2 className="text-slate-100 text-base font-bold">
                {isWebGlError
                  ? 'Không khởi tạo được bản đồ 3D (WebGL không khả dụng)'
                  : 'Không khởi tạo được bản đồ 3D'}
              </h2>
              <p className="text-slate-400 text-xs">
                Khối bản đồ đã dừng lại, các bảng điều khiển và chức năng còn lại vẫn dùng được bình thường.
              </p>
            </div>
          </div>

          {/* Nguyên nhân */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
              Nguyên nhân thường gặp
            </span>
            <ul className="flex flex-col gap-1.5">
              {causes.map((cause) => (
                <li key={cause} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="w-1 h-1 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span>{cause}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Cách khắc phục */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">
              Cách khắc phục
            </span>
            <ul className="flex flex-col gap-1.5">
              {fixes.map((fix, index) => (
                <li key={fix} className="flex items-start gap-2 text-xs text-slate-300">
                  <span className="text-cyan-300 font-mono text-[11px] leading-4 shrink-0">
                    {index + 1}.
                  </span>
                  <span>{fix}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Lỗi gốc: giữ lại để chẩn đoán, log đầy đủ nằm ở console */}
          <div className="font-mono text-[11px] leading-4 text-amber-200/80 bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 whitespace-pre-wrap break-words">
            {error.name}: {error.message}
          </div>

          {/* Hành động */}
          <div className="flex items-center justify-between gap-4">
            <span className="text-[11px] text-slate-400">
              Lỗi gốc kèm stack đã được ghi ra Console (F12) với tiền tố [MapErrorBoundary].
            </span>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs border border-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.5)] transition-colors shrink-0"
              title="Tải lại trang để thử khởi tạo lại bản đồ 3D"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tải lại trang</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
