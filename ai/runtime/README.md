# Runtime dành cho gói phát hành

Chưa có binary/runtime được sao chép vào thư mục này.

Các thành phần dự kiến: Python >=3.12, thư viện đã khóa phiên bản, engine Ollama local; Qdrant và OCR là gói mở rộng khi được lựa chọn và xác minh.

Source đang gom nằm ở ../vendor/vector-ai/backend. Không chạy entrypoint upstream chưa sửa: cần bridge dùng namespace dữ liệu VomKQ riêng và kiểm tra ownership/process identity.

Runtime được build/chuẩn bị ở giai đoạn đóng gói, có manifest, checksum, nền tảng và license đi kèm. Binary lớn đặt trong các thư mục đã ignore, được phân phối bằng artifact phát hành. Xem PLAN.md để biết tiêu chí nghiệm thu và xử lý port/origin.
