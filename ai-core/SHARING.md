# Chia sẻ VECTOR AI cùng bộ chạy cục bộ

## Cách dùng

Trên máy đang phát triển, chạy `PREPARE_LOCAL_RUNTIME.bat -BuildDesktop` để chép
Python + thư viện backend, Node/npm, Ollama cùng các thư viện tính toán vào
`runtime/bundles/<phiên-bản>/`. Script chỉ lấy những thành phần đã có trên máy,
không tự tải hay cài thêm. `runtime/active.json` chọn bộ chạy bằng đường dẫn
tương đối. Bộ cũ được giữ nguyên nếu chuẩn bị bộ mới thất bại.

Sau đó chạy `EXPORT_SHARED_PROJECT.bat`. Thư mục chia sẻ nằm trong
`deliverables/VECTOR_AI_SHARED_<ngày-giờ>/`. Chép nguyên thư mục này sang máy
Windows x64 khác rồi mở **RUN_VECTOR_AI_PORTABLE.bat**. Không cần cài Python,
Node, npm hoặc Rust để chạy bản đã chuẩn bị. Bộ chạy frontend đi kèm phục vụ
giao diện tại `127.0.0.1:3000`; desktop mở Python Core/Ollama theo cấu hình local.
Không đổi cổng khi trùng; launcher chỉ dừng frontend do chính nó tạo.

Đây là bản chia sẻ mã nguồn có bộ chạy, **không phải installer hoặc bản release
đã tối ưu**. Giao diện/JS/Python vẫn chỉnh sửa được. Shell Rust được biên dịch
sẵn ở `runtime/bundles/.../bin/vector-ai.exe`; sau khi sửa Rust, chạy lại bước
chuẩn bị trên máy có toolchain. F5/RUN_VECTOR_AI.bat vẫn là chế độ phát triển,
cần Rust + MSVC Build Tools nếu muốn biên dịch lại. Không chép nguyên các
compiler/SDK từ Program Files để giả định rằng máy nhận có thể build.

## Những thứ không tự mang theo

- **Driver NVIDIA/AMD, Windows và WebView2 Runtime:** là thành phần hệ thống.
  Máy nhận phải có bản tương thích. Không thể đảm bảo máy mới có tốc độ/GPU
  tương đương chỉ bằng chép thư mục.
- **Model Ollama:** để riêng mặc định. Có thể dùng model đã cài trên máy nhận.
  Nếu chủ động chuẩn bị `runtime/models/ollama/{manifests,blobs}`, launcher dùng
  kho model đó cho Ollama do app khởi động. Không chép thư mục `.ollama` nguyên
  khối vì có thể chứa khóa cá nhân. Nếu Ollama đang chạy sẵn, nó dùng kho riêng
  của tiến trình đó; app không tự dừng hoặc đổi cấu hình Ollama bên ngoài.
- **OCR/embedding/Qdrant tùy chọn:** `manifest.json` liệt kê chính xác phần còn
  thiếu. Chép package không đồng nghĩa đã có model OCR/embedding, profile hoặc
  chỉ mục. Có thể chuẩn bị Qdrant bằng `-QdrantExe <file>` và Tesseract bằng
  `-TesseractDirectory <thư-mục>`. Model/profile embedding cần cấu hình riêng
  trên máy nhận; không tự mang theo đường dẫn tuyệt đối của máy phát triển.
- Chat, API key, `.env`, cấu hình người dùng, backup cũ và các `.venv` thừa
  không được đưa vào bản xuất. Dữ liệu khi chạy vẫn ở
  `%LOCALAPPDATA%\VECTOR_AI\` của máy nhận, không nằm trong runtime.

## Chọn dữ liệu muốn chia sẻ

Mặc định bản xuất **không kèm kho tài liệu cá nhân** `public/knowledge/` và
`knowledge_sources/`. Nếu muốn chia sẻ cả kho tài liệu tích hợp sẵn, dùng:

```powershell
EXPORT_SHARED_PROJECT.bat -IncludeKnowledge
```

Nếu đã chủ động đặt model trong `runtime/models/`, có thể kèm nó bằng
`-IncludeModels`. Trọng số có thể rất lớn; cần kiểm tra dung lượng và quyền chia
sẻ tài liệu/model trước khi gửi. Không gửi nguyên thư mục dự án làm việc: nó
còn chứa dữ liệu và cache riêng ngoài danh sách xuất an toàn của script.

Các license/notice đi kèm thư viện được giữ khi chép. Kiểm tra điều khoản phân
phối của từng model/thành phần trước khi phát hành công khai.

## Kiểm tra không khởi động app

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-project.ps1 -Check
```

Kiểm tra này chạy Python/Node đi kèm và import backend, không tạo chat hoặc gọi
model. Nó không thay thế kiểm thử end-to-end trên một máy Windows sạch.
