---
description: 
---

# Debug Workflow

## Bước 1
Mô tả triệu chứng và cách tái hiện.

## Bước 2
Đọc toàn bộ code liên quan đến luồng dữ liệu.

## Bước 3
Xác định:
- Input
- Intermediate values
- Output
- State
- Configuration
- Units
- Default values

## Bước 4
Tìm nguyên nhân gốc trước khi sửa.

Không sửa theo kiểu thử ngẫu nhiên nhiều chỗ.

## Bước 5
Đề xuất nguyên nhân với bằng chứng từ code.

## Bước 6
Thực hiện thay đổi nhỏ nhất để sửa nguyên nhân.

## Bước 7
Kiểm tra lại bug cũ và các chức năng liên quan.

## Bước 8
Cập nhật docs/DEBUG_NOTES.md với:
- triệu chứng
- nguyên nhân
- file
- biến/thông số
- giá trị trước
- giá trị sau
- cách xác minh

## Bước 9
Không git commit và không git push.