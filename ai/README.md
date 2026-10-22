# VECTOR AI — không gian tích hợp của VomKQ

Ngày lập: 02/10/2026. Trạng thái: đã gom source tham khảo và tài liệu; harness mới chưa triển khai/chạy.

Đọc [PLAN.md](PLAN.md) để theo dõi các giai đoạn và tiêu chí nghiệm thu. Đọc [RAG_AND_WORKFLOWS.md](docs/RAG_AND_WORKFLOWS.md) để xem cách tổ chức tri thức, workflow và kết quả có nguồn.

## Thư mục này chứa gì?

| Đường dẫn | Vai trò hiện tại |
|---|---|
| PLAN.md | Kế hoạch triển khai theo giai đoạn |
| docs/RAG_AND_WORKFLOWS.md | Thiết kế RAG, workflow và các ca xác minh |
| vendor/vector-ai/backend/ | Snapshot lõi Python dùng chung của VECTOR AI; giữ nguyên source |
| reference/web/ | Snapshot client HTTP và launcher đang dùng, chỉ để đối chiếu |
| inventory.json | Danh sách file snapshot, đường dẫn nguồn và SHA-256 |
| config/harness.example.json | Cấu hình mục tiêu ở mức thiết kế; chưa phải cấu hình engine hiện tại |
| workflows/*.example.json | Đặc tả workflow dự kiến; chưa đăng ký trong engine |
| runtime/ | Vị trí chuẩn bị runtime/binary cho bản phát hành |
| models/ | Danh mục model; trọng số được chuẩn bị riêng |
| knowledge/ | Danh mục tài liệu được chọn và các index theo phiên bản |
| scripts/snapshot-source.ps1 | Tạo/cập nhật snapshot source nhỏ, không tải model |
| scripts/verify-workspace.py | Kiểm tra checksum, cú pháp Python và dependency nội bộ |

## Phạm vi

Gói này phục vụ tra cứu tài liệu, giải thích kết quả mô phỏng đã có, kiểm tra chất lượng dữ liệu và tạo báo cáo có trích dẫn. Các công cụ dự kiến chỉ đọc snapshot kết quả/metadata.

Source app đang chạy và giao tiếp AI hiện tại vẫn ở vị trí cũ. Các điểm kết nối để chuyển sang harness khi đến giai đoạn tích hợp:

- src/services/vectorAiClient.ts: transport HTTP, scope builtin và stream.
- scripts/vectorAiLauncher.ts: quản lý startup trong Vite, còn phụ thuộc thư mục VECTOR AI bên cạnh.
- vite.config.ts: đăng ký launcher/proxy.
- src/components/ui/AiPlacementAdvisorPanel.tsx, src/utils/aiPlacementAdvisor.ts, src/store/useTacticalStore.ts: các điểm tích hợp cũ; không nằm trong core RAG dùng chung, không được sao chép hoặc sửa ở bước lập kế hoạch.
- Các module GIS/vector/terrain là thành phần dùng chung của app; adapter đọc metadata/kết quả được thiết kế riêng trong PLAN.md.

Toàn bộ tài liệu quản lý, source core chung và cấu hình dự kiến đã tập trung tại ai/. Không gom lịch sử chat, dữ liệu người dùng, khóa API, tài liệu nguồn riêng tư hay các gói binary nhiều GB từ chương trình cũ.

## Trước khi chạy một engine mới

Snapshot vendor là source upstream chưa sửa. Entrypoint mặc định của nó dùng thư mục dữ liệu VECTOR_AI cũ. Vì vậy chưa chạy trực tiếp module vector_ai_backend từ snapshot này.

Giai đoạn tích hợp phải tạo bridge truyền BackendSettings(data_dir=...) riêng, xác minh danh tính/ownership của process, xử lý port/CORS và dùng kho tài liệu riêng được chỉ định. Cấu hình JSON mẫu trong thư mục này chưa được source upstream đọc.

Core có thể tái sử dụng lexical retrieval, workflow, checkpoint, cancellation và nguồn trích dẫn. Khả năng chạy thực tế sau relocation cần được kiểm thử. Bundle portable được khảo sát chưa kèm đủ model weights, embedding/OCR và Qdrant.

## Quản lý snapshot

Snapshot nhỏ, giữ nguyên byte của source; runtime, model và dữ liệu làm việc được tách khỏi source. Các file *.example.json là thiết kế, không chứng minh tính năng đã có.

Trong PowerShell tại thư mục ai:

~~~powershell
.\scripts\snapshot-source.ps1 -Refresh
python .\scripts\verify-workspace.py
~~~

Lệnh snapshot chỉ sao chép source từ repo đang có trên máy; không cài thư viện, không khởi động AI và không xóa file. Khi source thay đổi, kiểm tra lại PLAN.md cùng manifest. Các file vendor có trong manifest được cập nhật khi dùng -Refresh; file thừa ngoài manifest sẽ được báo ở bước verify.

Có thể dùng Python >=3.12 đã cài hoặc interpreter portable hiện có để chạy kiểm tra. Việc xác minh này không import core, không mở database và không chạy inference.

Repo hiện dùng sparse checkout. Khi đưa gói này vào một commit, bổ sung ai vào danh sách checkout bằng git sparse-checkout add ai trước khi stage file. Đợt chuẩn bị này chưa đổi cấu hình sparse hoặc tạo commit.
