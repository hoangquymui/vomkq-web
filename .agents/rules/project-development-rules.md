---
trigger: always_on
---

# Project Development Rules

## 1. Nguyên tắc chung
- Trước khi sửa code phải đọc và hiểu code liên quan.
- Ưu tiên sửa tối thiểu, tránh thay đổi không cần thiết.
- Không tự ý thay đổi kiến trúc dự án.
- Không tạo duplicate logic khi đã có function/utility phù hợp.

## 2. Thông số phải được ghi chú
Mọi thông số quan trọng dùng trong logic phải có nguồn gốc rõ ràng.

Khi gặp một thông số quan trọng, xác định:
- Tên biến
- Type
- Giá trị mặc định
- Đơn vị
- Phạm vi hợp lệ nếu có
- Nơi khai báo
- Nơi được sử dụng
- Ý nghĩa của nó
- Quan hệ với các thông số khác

Không đổi đơn vị giữa các module mà không ghi rõ phép chuyển đổi.

## 3. Debug
Khi sửa bug:
- Mô tả nguyên nhân trước khi sửa.
- Xác định input.
- Xác định processing.
- Xác định output.
- Ghi lại giá trị quan trọng gây lỗi.
- Sau khi sửa phải xác minh lại bằng trường hợp tái hiện bug.

Cập nhật docs/DEBUG_NOTES.md sau khi hoàn thành bug fix.

## 4. Không được tự suy đoán
- Không tự tạo giá trị mặc định nếu chưa có căn cứ.
- Không tự đổi đơn vị.
- Không tự thay đổi công thức quan trọng.
- Nếu thiếu thông tin, báo rõ phần còn thiếu.

## 5. Git
Agent không được tự thực hiện:
- git push
- git commit

Người dùng sẽ tự kiểm soát commit và push.
