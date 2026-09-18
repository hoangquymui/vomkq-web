---
description: 
---

# Development Workflow

## Mục tiêu
Phát triển một tính năng mới trong dự án vomkq-web theo cách có kiểm soát,
không tự ý thay đổi kiến trúc hoặc hành vi hiện có nếu chưa kiểm tra ảnh hưởng.

## Quy trình

### Bước 1 - Khảo sát trước khi sửa
- Đọc các file liên quan trực tiếp đến yêu cầu.
- Xác định:
  - component
  - store
  - type/interface
  - utility/function
  - data flow
  - dependencies
- Tìm nơi dữ liệu được tạo, thay đổi và sử dụng.
- Không sửa code ngay khi chưa hiểu luồng dữ liệu liên quan.

### Bước 2 - Lập kế hoạch
Trước khi chỉnh sửa:
- Nêu ngắn gọn vấn đề.
- Xác định các file cần thay đổi.
- Xác định file mới cần tạo nếu có.
- Nêu các thông số quan trọng bị ảnh hưởng.
- Giữ phạm vi thay đổi nhỏ nhất có thể.

### Bước 3 - Implement
- Viết code rõ ràng, dễ debug.
- Không tạo duplicate logic nếu đã có utility/function phù hợp.
- Ưu tiên tái sử dụng type/interface và hàm hiện có.
- Không đổi tên API, type, field hoặc biến quan trọng nếu không cần thiết.
- Không thay đổi logic ngoài phạm vi yêu cầu.
- Không thực hiện git commit hoặc git push.

### Bước 4 - Kiểm tra
Sau khi code xong:
- Kiểm tra TypeScript errors.
- Kiểm tra import/export.
- Kiểm tra null/undefined và giá trị mặc định.
- Kiểm tra các trường hợp biên.
- Chạy build hoặc test phù hợp với dự án.
- Kiểm tra các phần bị ảnh hưởng trực tiếp.

### Bước 5 - Ghi chú debug
Sau mỗi thay đổi quan trọng, cập nhật:

docs/DEBUG_NOTES.md

Mỗi mục phải ghi:
- Ngày
- Tính năng/module
- Vấn đề hoặc mục tiêu
- File đã thay đổi
- Tên thông số/biến quan trọng
- Giá trị mặc định
- Đơn vị
- Giá trị đầu vào/đầu ra
- Công thức hoặc logic liên quan nếu có
- Kỳ vọng
- Kết quả thực tế
- Cách kiểm tra
- Kết luận

Không tự bịa giá trị hoặc đơn vị.
Chỉ ghi những thông số có trong code, tài liệu dự án hoặc được người dùng xác nhận.

### Bước 6 - Báo cáo cuối
Sau khi hoàn thành, báo cáo:
1. Đã thay đổi gì
2. File nào đã thay đổi
3. Thông số quan trọng nào bị ảnh hưởng
4. Đã kiểm tra những gì
5. Còn vấn đề nào chưa xác minh
6. Không thực hiện git commit/push