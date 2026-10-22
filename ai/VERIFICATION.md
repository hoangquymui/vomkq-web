# Xác minh gói chuẩn bị — 02/10/2026

Trạng thái: hồ sơ kế hoạch và snapshot source. Harness mới chưa được tích hợp vào ứng dụng.

- 48 file snapshot, tổng 432.972 byte; bao gồm 43 file Python core, 3 file metadata backend và 2 file tích hợp web để tham khảo.
- SHA-256 của mọi bản sao khớp source tại thời điểm tạo; source được kiểm tra lại sau khi sao chép và giữ nguyên.
- 43 file Python parse thành công; các import tương đối trong package tìm được module tương ứng.
- 5 file cấu hình/manifest/workflow mẫu là JSON hợp lệ và được đánh dấu planned hoặc unprepared.
- Source app hiện tại không bị di chuyển hoặc thay đổi bởi đợt lập kế hoạch này.
- Chưa chạy engine, mở database, cài dependency, tải trọng số hoặc kiểm thử inference/RAG thật. Các kiểm chứng đó có tiêu chí riêng trong PLAN.md.

Lệnh kiểm tra dùng interpreter Python 3.12 portable đang có trên máy để chạy ai/scripts/verify-workspace.py. Có thể kiểm tra lại bằng Python >=3.12; script chỉ đọc cấu trúc và checksum, không import hay khởi động AI.

inventory.json chứa provenance và checksum từng file. Các model, runtime, kho tài liệu và index có hướng dẫn/manifest mẫu tại các thư mục riêng; chúng chưa được chuẩn bị thành một runtime phát hành.
