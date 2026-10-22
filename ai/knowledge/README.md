# Kho tri thức riêng của dự án

documents/ dành cho tài liệu được lựa chọn và có quyền sử dụng. indexes/ dành cho index đã dựng theo phiên bản. Hai thư mục này hiện chỉ có hướng dẫn.

Chưa sao chép tài liệu, builtin knowledge, database hoặc lịch sử chat của VECTOR AI cũ. manifest.example.json là mẫu danh mục rỗng.

Mỗi tài liệu cần ID, phiên bản, nguồn, checksum, thời điểm, phạm vi sử dụng và trạng thái kiểm duyệt. Index cần liên kết document versions, chunker version và embedding profile/generation khi dùng dense retrieval.

Giai đoạn đầu dùng tài liệu kiểm thử tổng hợp để xác minh truy xuất và citation. Hướng dẫn nhập thư viện thực tế, rebuild và backup nằm trong PLAN.md và docs/RAG_AND_WORKFLOWS.md.

