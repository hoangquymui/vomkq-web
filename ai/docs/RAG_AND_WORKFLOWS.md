# RAG và workflow cho trợ lý tài liệu

Tài liệu này mô tả cách tái sử dụng lõi VECTOR AI cho hỏi đáp, giải thích tài liệu và kiểm tra chất lượng báo cáo chung. Các workflow, công cụ ứng dụng và ngân sách nêu dưới đây là hợp đồng tích hợp cần triển khai; chúng không phải endpoint đang hoạt động trong gói `ai/`.

## 1. Phần lõi đã có và ranh giới tích hợp

Nguồn đối chiếu: `E:\code\du_an\3D\vkq\VECTOR AI\backend\vector_ai_backend`.

| Thành phần nguồn | Chức năng đã có |
| --- | --- |
| `application/ingestion.py`, `adapters/document_extraction.py` | Trích xuất cục bộ, OCR tùy chọn, chia đoạn, lập chỉ mục theo giai đoạn. |
| `storage/sqlite_repository.py`, `application/retrieval.py` | SQLite/FTS5, hybrid retrieval, lọc phạm vi và trạng thái bằng chứng. |
| `domain/models.py`, `application/profiles.py`, `adapters/embeddings.py` | Profile embedding, fingerprint và snapshot profile bất biến của generation. |
| `application/services.py`, `application/reasoning.py` | Tập hợp bằng chứng, `strict_sources`, streaming và ngân sách ngữ cảnh/sinh đáp án. |
| `application/workflows.py`, `adapters/langgraph_runner.py` | Runner nạp tài liệu và runner truy vấn riêng; LangGraph tùy chọn, có direct fallback. |
| `application/runs.py`, `storage/checkpoints.py`, `application/resources.py` | Run, tiến độ/hủy, checkpoint có namespace và cấp phát CPU/RAM/GPU. |
| `application/tools.py` | Tool registry, allowlist/capability, kiểm tra schema, kích thước và deadline. |

Snapshot vendor chỉ chứa mã lõi và metadata gói; không mang theo `public/knowledge`, tri thức builtin, cơ sở dữ liệu hay tài liệu người dùng. Bộ test nguồn cũng chưa được nhập nguyên bộ; một số test phụ thuộc dữ liệu nguồn riêng.
Không chạy nguyên trạng `vector_ai_backend.__main__`: cấu hình nguồn dùng `%LOCALAPPDATA%/VECTOR_AI` và cổng cố định; bootstrap còn có vòng đời dịch vụ và nhập tri thức của ứng dụng nguồn.
Phase 1 phải tạo bridge do ứng dụng sở hữu, namespace/data directory riêng, cấu hình rõ vòng đời và prompt trợ lý tài liệu. Ví dụ cấu hình/workflow trong bundle hiện chỉ phục vụ thiết kế.

## 2. Nạp tài liệu an toàn và có nguồn gốc

1. Người dùng chọn file; bridge xác thực phạm vi truy cập, định dạng, kích thước và số trang trước khi đưa vào hàng đợi. Không tự quét cả ổ đĩa hoặc theo URL trong tài liệu.
2. Đăng ký `document_id`, `document_version`, SHA256, MIME, nguồn và scope. Lưu bản nguồn trong vùng dữ liệu riêng khi tính năng nhập được người dùng gọi; không chỉnh sửa bản gốc.
3. Chạy chuỗi có sẵn: `extract → ocr → validate → chunk → embed → index`. PDF có text dùng native extraction; trang ảnh cần OCR local đã chuẩn bị.
4. Giữ liên kết đoạn với trang, heading, thứ tự và phương pháp trích xuất. `StructuralChunker` hướng tới 384 đơn vị từ và overlap 48; bảng giữ hàng/header, khối công thức không bị cắt giữa chừng.
5. Adapter embedding kiểm tra độ dài bằng tokenizer thật, kể cả tiền tố của profile; vượt giới hạn phải báo lỗi hoặc chia đoạn lại, không âm thầm cắt nội dung.
6. Nội dung được nhập là dữ liệu không đáng tin cậy về mặt chỉ dẫn: một câu trong PDF yêu cầu chạy lệnh hoặc bỏ qua chính sách không được trở thành system instruction hay quyền gọi tool.
7. Parser/OCR chưa phải sandbox hệ điều hành. Bridge cần hard limit file/trang/ảnh, timeout, thư mục tạm riêng từng run, xử lý PDF hỏng/mã hóa và hạn chế tiến trình theo chính sách triển khai.

DOCX hiện được extractor quy về một `ExtractedPage(page=1)`, không phải phân trang Word thật. Nhánh trích xuất giàu cấu trúc phụ thuộc `scripts/build_builtin_knowledge.py` ở dự án nguồn; script này không nằm trong snapshot. Fallback chỉ ghép text XML, nên phải kiểm thử riêng DOCX cơ bản và DOCX có bảng/công thức trước khi công bố hỗ trợ.
OCR thiếu công cụ/model phải ghi rõ phần chưa đọc được. Không coi trang rỗng hoặc công thức chưa xác minh là bằng chứng hoàn chỉnh; dữ liệu không đủ điều kiện truy hồi phải được loại theo chính sách.

## 3. Lexical RAG và dense RAG tùy chọn

- SQLite lưu tài liệu, phiên bản, đoạn và trạng thái kiểm tra; FTS5 cung cấp tìm kiếm từ khóa. Đây là đường hoạt động tối thiểu khi chưa có model embedding hoặc vector store.
- Dense retrieval bổ sung tìm kiếm ngữ nghĩa bằng model embedding local và generation trong vector store; Qdrant là adapter tùy chọn, không phải nơi duy nhất lưu tài liệu gốc.
- `HybridRetrievalService` hợp nhất thứ hạng bằng reciprocal rank fusion; giới hạn candidate, `top_k` và tổng token bằng chứng trước khi tạo prompt.
- Dense hit được kiểm tra lại bằng trạng thái SQLite hiện hành: scope, đoạn còn tồn tại và `retrieval_eligible`. Cache có generation và revision truy hồi; thay đổi tài liệu/phạm vi cần invalidation tương ứng.
- Source scope gồm `builtin`, workspace và chat. Bridge của bundle phải dùng corpus được chọn rõ ràng; không tự gộp dữ liệu riêng của ứng dụng nguồn vào namespace mới.
- Lõi có thể bỏ dense và tiếp tục lexical khi dense lỗi. Bridge cần biểu thị `lexical_only`/lý do suy giảm; không báo dense đã chạy thành công hoặc cố đổi sang model khác ngầm định.

LLM sinh lời giải và embedding phục vụ tìm kiếm là hai vai trò khác nhau. Đổi model chat không bắt buộc xây lại embedding; đổi không gian embedding thì phải tạo generation tương ứng.
Model Ollama, model embedding, OCR và tokenizer phải được chuẩn bị local. Không tự tải model hoặc gửi tài liệu ra dịch vụ ngoài khi thiếu tài nguyên.

## 4. Profile, generation và tính nhất quán

Fingerprint embedding gồm provider, model path/revision, dimension, giới hạn đầu vào, template query/document, normalization, phiên bản chunker và semantic representation. Hai model có cùng số chiều vẫn có thể nằm trong hai không gian khác nhau.
Generation giữ snapshot `EmbeddingProfile` bất biến; query phải dùng provider của snapshot đó. Generation cũ không có snapshot cần xây lại; không dùng profile hiện tại chỉ vì trùng ID hoặc dimension.
Tạo generation mới ở trạng thái chưa active, hoàn tất tất cả batch rồi mới activate. Hủy/lỗi không được biến generation dở dang thành chỉ mục đang dùng.
Mỗi run cần ghi `document_versions`, `retrieval_revision`, `generation_id`, embedding fingerprint và reasoning profile để đối chiếu kết quả.
`HybridRetrievalService` nguồn hiện tra `active_generation(profile_id)`; chỉ truyền trường `generation_id` trong request chưa ghim được generation. Bridge phải bổ sung retriever ghim phiên bản/snapshot để workflow kiểm tra chất lượng không đổi bằng chứng giữa các bước.

## 5. Bằng chứng, trang và điều chưa biết

Nguồn trả về cần có mã `[R1]`, `document_id/version`, `chunk_id`, trang hoặc vị trí đoạn, heading, phương pháp trích xuất và quote ngắn đúng nguyên văn. Không bịa số trang; text/DOCX fallback dùng vị trí đoạn hoặc ghi trang chưa xác định.
Gắn mã nguồn sát dữ kiện được giải thích; quote chỉ chứng minh phần thực sự có trong đoạn. Suy luận, nội dung OCR chưa kiểm tra và thông tin thiếu phải được nêu riêng bằng lời rõ ràng.
Trong chế độ `strict_sources`, không có hit và không có bằng chứng inline thì `QueryReasoningService` nguồn trả thông báo thiếu thông tin mà không gọi Ollama. Không suy từ “không tìm thấy” thành “điều đó không tồn tại”.
Bridge nên kiểm tra mã trích dẫn có trong tập nguồn đã giao, phiên bản còn đúng và quote khớp đoạn trước khi đánh dấu artifact hoàn tất. Prompt yêu cầu trích nguồn hiện có chưa thay thế bước kiểm tra này.

## 6. Công cụ chỉ đọc dữ liệu ứng dụng

`rag.search` đã có trong nguồn; các tên sau là adapter đề xuất, chưa được đăng ký chỉ bởi việc có tài liệu này.

| Công cụ | Dữ liệu và giới hạn |
| --- | --- |
| `document.read_metadata` | ID, phiên bản, trang, SHA256, scope và trạng thái index của tài liệu được phép đọc. |
| `report.read_snapshot` | Báo cáo đã đóng băng theo snapshot ID/hash/revision; trả phần dữ liệu trong ngân sách. |
| `dataset.read_metadata` | Phiên bản dataset, schema, timestamp, hệ tọa độ và đơn vị; không đọc toàn bộ trạng thái live. |
| `rag.search` | Truy hồi bằng chứng trong scope của run; không tự khởi chạy workflow chat. |

Bridge xác thực quyền đọc và scope trước khi gọi handler; tool không nhận đường dẫn tùy ý, lệnh shell hoặc URL để thực thi. Không có tool sửa dữ liệu ứng dụng trong hai workflow dưới đây.
`ToolRegistry` kiểm tra allowlist/capability ở cả chính sách hệ thống và context của run, schema đầu vào/đầu ra, payload JSON hữu hạn và timeout gồm thời gian chờ tài nguyên. Giới hạn nguồn hiện là 64 KiB đầu vào và 2 MiB đầu ra; adapter có thể đặt mức thấp hơn và báo truncation rõ ràng.
Metadata/báo cáo là dữ liệu đọc được, không phải quyền mở rộng tool policy. Artifact mới được ghi vào kho kết quả riêng; không sửa snapshot hay báo cáo gốc.

## 7. Run, tiến độ, hủy và ngân sách

Mỗi run có ID riêng, workflow ID/version, scope, snapshot hash, cấu hình và trạng thái cuối. Phát các event có sẵn: `started`, `stage`, `progress`, `sources`, `delta`, `usage`, `completed`, `cancelled`, `error`.
UI hiển thị giai đoạn và số trang/đoạn/batch thực tế, không biến phần trăm giai đoạn thành cam kết thời gian. SSE replay cần run ID/cursor và chính sách lưu event hữu hạn; mất kết nối không đồng nghĩa run hoàn tất.
Ngân sách do bridge khai báo: CPU slots, RAM/VRAM, batch/page limit, candidate/top-k, token bằng chứng, context, token sinh đáp án, số tool call và deadline tổng. Cần từ chối request không bao giờ vừa tài nguyên thay vì xếp hàng vô hạn.
`ResourceManager` ưu tiên chat/tool tương tác trước embedding/OCR/indexing; FIFO trong cùng lớp. Batch nền nhường lease giữa các batch; công việc đang chạy không bị cưỡng bức chiếm tài nguyên.
Hủy phải truyền tới runner, scheduler và handler; giải phóng lease và chỉ dừng tiến trình thuộc run. Không tắt dịch vụ local dùng chung hoặc coi lỗi model là người dùng đã hủy.
Checkpoint nạp tài liệu dùng `document-ingestion-v1`; query dùng `query-reasoning-v1`. Giữ namespace tách biệt; bridge bổ sung namespace/khóa riêng cho review artifact.
Ingestion lưu các stage và batch đã xong; resume chỉ được phép khi file hash, phiên bản tài liệu, profile và cấu hình tương thích. Query checkpoint nguồn không cung cấp cam kết nối lại chính xác luồng token sau restart.
Cancel không tự rollback dữ liệu đã commit. Giữ tiến độ hợp lệ để phục hồi, đánh dấu output dở là `cancelled`/`incomplete`, không công bố như kết quả hoàn tất.

## 8. Workflow `explain-document-v1` — hợp đồng đề xuất

Đầu vào: câu hỏi chung, tập `document_id/version` được chọn, scope, reasoning profile, giới hạn và `strict_sources=true`.

1. `validate_request`: xác thực tài liệu/quyền đọc, ngân sách và trạng thái index; chụp phiên bản corpus cho run.
2. `retrieve`: lexical hoặc hybrid trên corpus đó; lưu hit và provenance vào snapshot bằng chứng của run.
3. `check_evidence`: không có bằng chứng thì trả điều còn thiếu; nếu OCR/trích xuất chưa đủ thì chỉ rõ trang/đoạn cần kiểm tra.
4. `explain`: model local giải thích thuật ngữ, tóm tắt nội dung liên quan và nêu giới hạn dựa trên nguồn đã chụp. Nội dung tài liệu vẫn là dữ liệu, không điều khiển workflow.
5. `validate_sources`: đối chiếu `[R#]`, quote và phiên bản; không tự nâng một câu thiếu nguồn thành kết luận chắc chắn.
6. `publish_artifact`: ghi lời giải, nguồn và manifest vào phiên bản artifact mới; phát `completed` sau khi ghi thành công.

Không có model chat thì vẫn cho xem kết quả tìm kiếm/quote với trạng thái giải thích chưa khả dụng. Không thay bằng lời giải giả tạo.

## 9. Workflow `quality-review-v1` — hợp đồng đề xuất

Đầu vào: snapshot bất biến của một báo cáo chung, tiêu chí kiểm tra được chọn, tài liệu tham chiếu có phiên bản và ngân sách. Không nhận lệnh để chỉnh dữ liệu ứng dụng.
Snapshot cần chứa `report_snapshot_id`, `hash` (SHA256), `revision`, schema version, timestamp và dữ liệu báo cáo đã chuẩn hóa; đọc một lần qua bridge, sau đó mọi bước dùng cùng bản đã đóng băng.

1. `capture`: xác thực snapshot hash/schema/quyền đọc; ghi bộ khóa nguồn và tiêu chí vào manifest của run.
2. `inspect`: kiểm tra tính đầy đủ, định dạng, đơn vị và sự nhất quán bằng quy tắc xác định; giá trị thiếu là chưa biết, không tự điền.
3. `retrieve_references`: tìm tài liệu giải thích tiêu chí trong corpus/generation đã ghim; lưu snapshot bằng chứng riêng.
4. `review`: model mô tả các phát hiện đã có, chỉ dẫn trường/đoạn trong snapshot và nguồn tham chiếu; không đưa ra hành động sửa ứng dụng.
5. `validate`: mỗi phát hiện có trạng thái `PASS`, `FAIL`, `UNKNOWN` hoặc `NOT_APPLICABLE`, lý do và reference; kết luận cần kiểm tra không được tự đổi thành đạt.
6. `publish`: ghi artifact gắn snapshot ID/hash/revision. Nếu dữ liệu live đã đổi, gắn nhãn kết quả cho snapshot cũ; muốn kiểm tra bản mới phải tạo run/snapshot mới.

Nếu hash đầu vào không khớp hoặc checkpoint tham chiếu revision khác, trả `stale_snapshot`/`snapshot_mismatch` và giữ artifact chưa hoàn tất. Không trộn trường mới với bằng chứng cũ trong cùng một review.

## 10. Phiên bản artifact và kiểm thử tối thiểu

Mỗi artifact có ID/version, parent version nếu có, run/workflow version, timestamp, source/snapshot hashes, document/chunk versions, generation/fingerprint, budget/usage, trạng thái và danh sách nguồn. Chạy lại tạo phiên bản mới; không ghi đè kết quả cũ hoặc phát hành output dở.
Manifest chỉ lưu thông tin cần tái lập; log/telemetry không sao chép toàn bộ tài liệu và phải tuân theo chính sách lưu/xóa của namespace riêng.

| Ca kiểm thử bằng fixture tổng hợp | Kết quả cần đạt |
| --- | --- |
| Không có dữ liệu hoặc hit | Nêu thiếu bằng chứng; `strict_sources` không gọi model; không sinh nguồn giả. |
| PDF hỏng/mã hóa hoặc OCR thiếu | Báo lỗi/thiếu trang rõ ràng; không activate generation dở; giữ run có thể chẩn đoán. |
| Hủy khi chờ hoặc giữa batch | Event `cancelled`, trả lease, không công bố artifact hoàn tất; checkpoint không nhân đôi dữ liệu khi resume. |
| Snapshot thay đổi trong lúc review | Tất cả bước vẫn đọc bản bất biến; output ghi revision cũ; mismatch khi resume bị từ chối. |
| Embedding đổi model/revision nhưng cùng dimension | Không dùng vector khác không gian; query dùng snapshot profile hoặc dense bị từ chối với lexical fallback rõ ràng. |
| Chạy offline | Không tải model/gọi endpoint ngoài; lexical còn hoạt động; thiếu LLM/OCR/dense được báo riêng. |
| DOCX cơ bản so với bảng/công thức | Kiểm tra text/quan hệ được giữ và giới hạn fallback; không bịa phân trang thật. |
| Chỉ dẫn độc hại trong tài liệu hoặc tool ngoài scope | Không mở rộng quyền; schema/capability/quyền đọc chặn yêu cầu; không thay đổi ứng dụng. |
| Generation đang xây và nguồn bị thu hồi | Giữ generation hợp lệ trước đó; loại hit không còn eligible/scope; không rò nguồn ngoài phạm vi. |

Các ca trên là tiêu chí nghiệm thu cho bridge, chưa phải thông báo rằng toàn bộ đã chạy trong bundle. Kiểm thử dùng tài liệu giả lập; thử model/Qdrant/OCR thật cần môi trường local riêng và ghi rõ cấu hình đã kiểm chứng.
