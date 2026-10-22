# Model assets

Chưa có trọng số model trong gói này. manifest.example.json chỉ mô tả các artifact cần chuẩn bị.

Model sinh văn bản và model embedding có vai trò riêng. Dense index phải khớp đúng embedding profile/generation; cùng số chiều chưa đủ để tương thích.

Chọn model theo đo đạc RAM/VRAM và độ trễ trên máy đích. Tải/chuẩn bị model là bước riêng; harness dự kiến không tự tải model khi chạy. Trọng số đặt tại weights/ hoặc gói model ngoài source, kèm phiên bản, license, nguồn và checksum.
