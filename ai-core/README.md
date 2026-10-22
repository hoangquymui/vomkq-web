# VECTOR AI

Ứng dụng trợ lý AI chạy cục bộ bằng Tauri và Ollama với một model Q4_K_M dùng chung cho ba chế độ:

- **Trả lời nhanh (FAST):** tắt Thinking, ngữ cảnh 8K và giới hạn đầu ra 2048 token.
- **Cân bằng (NORMAL):** tắt Thinking, ngữ cảnh 8K và giới hạn đầu ra 4096 token.
- **Suy luận sâu (DEEP):** bật Thinking, ngữ cảnh 16K và giới hạn đầu ra 8192 token.

Trong **Quản lý model**, người dùng chỉ chọn một model để chat. Nút chuyển chế độ
dưới ô nhập đổi ngân sách và chính sách Thinking; model chat vẫn giữ nguyên. Khi đổi model, VECTOR AI
dỡ model cũ khỏi bộ nhớ và chỉ giữ model đang dùng trong thời gian giới hạn.

## Chạy khi phát triển

Muốn mang thư viện/bộ chạy theo mã nguồn sang máy khác, xem [SHARING.md](SHARING.md).
`PREPARE_LOCAL_RUNTIME.bat -BuildDesktop` chuẩn bị runtime cục bộ;
`EXPORT_SHARED_PROJECT.bat` tạo thư mục chia sẻ không kèm dữ liệu cá nhân mặc định.

```powershell
npm install
npm run desktop
```

Trong VS Code có thể bấm `F5` để chạy `RUN_VECTOR_AI.bat`. Hãy giữ terminal
phát triển đang mở trong suốt lúc dùng app; terminal này phục vụ giao diện tại
`127.0.0.1:3000`. Không mở riêng `src-tauri/target/debug/vector-ai.exe` khi Vite
chưa chạy. Bản debug sẽ đợi frontend tối đa 20 giây và báo lỗi rõ ràng thay vì
mở trang `ERR_CONNECTION_REFUSED`.

## Sơ đồ dataset nhiều cấp

Mở **Quản lý workflow RAG → Sơ đồ dataset** để thấy **Kho Kiến Thức** nối với
tất cả tài liệu. Bấm một tài liệu để mở nhánh và tổ chức cây ngay trên sơ đồ:
**Kho Kiến Thức → Tài liệu → Chương → Mục → các mục con → nhiều cấp sâu hơn**. Các
tài liệu khác vẫn hiện; mỗi lần chỉ mở nội dung một tài liệu để giữ sơ đồ gọn.
Nút **Gốc** quay về Kho Kiến Thức mà không bỏ chỉnh sửa đang làm. Kho là điểm
nối giao diện, không gộp file, đổi ID hay phạm vi truy xuất của từng tài liệu.
Đây là cấu trúc
nội dung dataset, không phải sơ đồ các bước OCR/embedding hay LangGraph.

- Chọn một mục, bấm **Mục con** để thêm cấp; chọn loại Chương, Mục, Khái niệm,
  Tiêu chuẩn, Công thức, Bảng hoặc Ghi chú trong bảng thuộc tính.
- **Nhóm 5 phần** tạo 5 mục con trống để người dùng phân loại tiếp, không tự sinh
  công thức hay suy đoán nội dung tài liệu.
- Kéo tay nắm **⠿** thả vào mục khác để đổi cha cho cả nhánh. Cũng có thể chọn
  **Mục cha** hoặc dùng **Lên/Xuống** để thay đổi thứ tự mà không cần kéo chuột.
- Thu/mở nhánh bằng nút **+/−**, tìm mục, phóng/thu, bấm **⊡** để vừa khung;
  kéo nền hoặc dùng thanh cuộn để di chuyển. **Gốc** quay về tài liệu.
- Sửa tên/ghi chú, hoàn tác/làm lại và **Lưu sơ đồ** (`Ctrl+S`). Cây được lưu
  theo document/version cùng revision chống ghi đè từ nhiều cửa sổ, trong
  SQLite của Python Core; backup v2 sao lưu cả cấu trúc này.

Cây ban đầu lấy **tiêu đề/trang và các đoạn nguồn có thật**; không tự bịa các
chương hay phân loại ngữ nghĩa còn thiếu. Có thể xem nội dung gốc và trạng thái
truy xuất khi chọn một đoạn nguồn. Sửa tên/ghi chú của cây chỉ thay đổi cách tổ
chức, **chưa thay nội dung nguồn hoặc thuật toán retrieval**. Không xóa đoạn
nguồn ở đây; xóa một mục tổ chức sẽ chuyển các mục con lên cha để bảo toàn dữ
liệu. Nhập/xóa tài liệu và duyệt công thức vẫn dùng các tab tương ứng.

Hai pipeline `DocumentIngestionGraph` và `QueryReasoningGraph` vẫn độc lập,
được mô tả ở tab **Tổng quan**. Các sơ đồ workflow legacy được giữ trong SQLite.

Kiểm thử cây: `node scripts/check_dataset_tree.mjs`,
`node scripts/check_dataset_tree_browser.mjs` (Chrome headless, dữ liệu giả cô
lập) và `backend/.venv/Scripts/python.exe -m pytest backend/tests/test_dataset_trees.py`.

## Tạo bộ cài Windows

```powershell
npm run setup
```

Bộ cài được tạo tại:
`src-tauri/target/release/bundle/nsis/VECTOR AI_0.1.0_x64-setup.exe`.

Khi cài đặt, VECTOR AI kiểm tra Ollama. Nếu máy chưa có, trình cài sẽ tải và
mở bộ cài Ollama chính thức. Ở lần chạy đầu, ứng dụng kiểm tra model của chế độ
đang chọn và hiển thị thanh tiến độ nếu cần tải; model không được nhúng vào
Setup.exe để tránh làm bộ cài nặng nhiều GB.

Lịch sử hội thoại được lưu cục bộ trên máy. Nội dung trò chuyện chỉ được gửi
tới API Ollama tại `127.0.0.1:11434`.

## Kiến thức tích hợp sẵn

VECTOR AI có một kho tham chiếu cục bộ được tạo từ ba tài liệu trong
`knowledge_sources/`: **Trinh Sát Trên Không**, **Sổ Tay** và **Sĩ Quan Cao Xạ**.
Kho này tự nạp khi mở ứng dụng, hoạt động trong cả chat thường lẫn workspace và
không yêu cầu người dùng tải lại DOCX. Mỗi câu hỏi chỉ truy xuất các đoạn liên
quan để không làm đầy ngữ cảnh; câu trả lời dùng tài liệu sẽ hiện nguồn `[B1]`,
`[B2]` ngay dưới phản hồi.

Nhấn biểu tượng cơ sở dữ liệu trên thanh đầu ứng dụng để mở **Quản lý dữ liệu**.
Tại đây có thể xem từng nguồn và số đoạn/công thức/bảng, tạm tắt nguồn, đổi tên,
hiệu chỉnh nội dung theo từng đoạn hoặc xóa nguồn khỏi truy xuất. Thao tác xóa là
xóa logic nên có thể khôi phục bất cứ lúc nào; file DOCX và chỉ mục gốc không bị
ghi đè. Các thiết lập này được lưu cục bộ và được đưa vào file sao lưu của app.

Nội dung DOCX luôn được coi là dữ liệu tham chiếu chỉ đọc, không phải lệnh để ứng
dụng hoặc model thực thi. Công thức Word OMML được bộ tạo chỉ mục chuyển sang
LaTeX nhằm giữ phân số, căn, chỉ số, tổng, hệ phương trình và ma trận.

Khi gửi phản hồi, VECTOR AI yêu cầu Ollama offload số lớp tối đa có thể lên GPU
(`num_gpu: -1`) và ưu tiên GPU 0. Nếu VECTOR AI tự khởi động Ollama, ứng dụng còn
bật Flash Attention cùng KV cache `q8_0` để giảm VRAM dùng cho ngữ cảnh. Tỷ lệ
GPU thực tế vẫn phụ thuộc dung lượng model, VRAM và độ dài ngữ cảnh.

Khi thay đổi tài liệu nguồn, tạo lại và kiểm tra chỉ mục bằng:

```powershell
npm run knowledge:build
npm run knowledge:check
npm run knowledge:smoke
npm run build
```

Chỉ mục chạy thực tế nằm tại `public/knowledge/builtin-knowledge.json` và được
đóng gói tự động vào ứng dụng. Không sửa trực tiếp file JSON này. Dùng trình quản
lý trong app cho hiệu chỉnh cục bộ; muốn thay đổi dữ liệu gốc trong bản phát hành
thì sửa DOCX nguồn rồi chạy lại lệnh tạo chỉ mục.

## Cài model fine-tune từ backup.zip

Trong ứng dụng, mở **Quản lý model** ở thanh trên cùng, nhập tên model rồi
chọn **Chọn backup.zip**. VECTOR AI chấp nhận gói xuất từ notebook fine-tune có
cấu trúc:

```text
Qwen3.5-9B-Finetuned-Q4_K_M.gguf
Modelfile
training_summary.json
lora_adapter/
```

Ứng dụng đọc ZIP ở backend, kiểm tra chữ ký GGUF, đăng ký bằng `ollama create`
và chọn model vừa cài làm model dùng chung. `lora_adapter/` được giữ trong backup
phục vụ huấn luyện nhưng không được gửi riêng vào Ollama.
