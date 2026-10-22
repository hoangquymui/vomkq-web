# AI CORE — VECTOR AI nhúng trong VPK

Thư mục này là **bản sao đầy đủ của VECTOR AI**, được đặt bên trong dự án chính
`vompk` để ứng dụng chạy **độc lập** — không cần folder `VECTOR AI` ở ngoài,
không cần `%LOCALAPPDATA%\VECTOR_AI`.

## Vì sao nằm ở đây?

Trước đây launcher của VPK trỏ sang `../VECTOR AI`. Sau khi tích hợp:

| Việc | Đường dẫn |
|---|---|
| Backend Python | `ai-core/backend` |
| Portable runtime (Python/Node/Ollama) | `ai-core/runtime/bundles/<id>` |
| Toàn bộ trạng thái AI (SQLite, tài liệu, knowledge) | `ai-core/data` |
| Knowledge tĩnh đóng gói sẵn | `ai-core/knowledge_sources` |

`scripts/vectorAiLauncher.ts` (plugin Vite) tự khởi động Ollama + backend khi UI
bấm nút, đọc `runtime/active.json` để biết bundle nào đang hoạt động.

## Biến môi trường launcher tự đặt

| Biến | Giá trị | Ý nghĩa |
|---|---|---|
| `VECTOR_AI_DATA_DIR` | `ai-core/data` | Ghi đè thư mục dữ liệu mặc định |
| `VECTOR_AI_PROJECT_DIR` | `ai-core` | Gốc project (dùng cho script build knowledge) |
| `VECTOR_AI_HOST` / `_PORT` | `127.0.0.1` / `8000` | Cổng cố định, không đổi được |

> `VECTOR_AI_DATA_DIR` được hỗ trợ mới trong `backend/vector_ai_backend/config.py`.
> Nếu không đặt, backend vẫn dùng `%LOCALAPPDATA%\VECTOR_AI` như trước (chạy
> Tauri độc lập vẫn hoạt động bình thường).

## Chuẩn bị lại runtime (khi cần)

```bat
PREPARE_AI_CORE_RUNTIME.bat          :: gom Python + Node + Ollama vào ai-core\runtime
```

Yêu cầu: `ai-core/backend/.venv` đã cài (`requirements.txt`), Node.js và Ollama
đã có trên máy. Model weights của Ollama (~5-6GB) **không** được gom vào bundle —
phải `ollama pull` riêng trên máy nhận.

## Thư mục không đưa lên git

`.gitignore` ở gốc VPK đã loại: `ai-core/runtime/bundles/`, `ai-core/data/`,
`ai-core/backend/.venv/`, `ai-core/src-tauri/target/`, `ai-core/deliverables/VECTOR_AI_SHARED_*/`.

## Chạy bản đã chuyển sang vompk

Tại thư mục `vompk`, chạy `npm run dev`, mở `http://localhost:3000` và bấm
**AI phân tích**. Launcher dùng backend, runtime portable và dữ liệu trong
`ai-core`; model Ollama dùng kho model đã cài trên máy.

Ngày 06/10/2026: đã chuyển dữ liệu từ `vomphongkhong`, snapshot các SQLite bằng
backup API và cập nhật các đường dẫn tài liệu tới bản sao trong `ai-core/data`.
Thư mục `ai/` giữ gói tham khảo/thiết kế; backend đang chạy thuộc `ai-core/`.
