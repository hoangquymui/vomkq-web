# Kế hoạch trợ lý tài liệu chạy cục bộ

Ngày lập: 02/10/2026. Trạng thái: **kế hoạch triển khai**, chưa phải tính năng đã hoàn thành trong `vomphongkhong`.

## Mục tiêu và giới hạn

Xây dựng một trợ lý tài liệu và quy trình làm việc chạy trên máy người dùng: đọc tài liệu được chọn, tìm thông tin, trả lời có trích dẫn, tóm tắt và giải thích báo cáo đã có. Ứng dụng quản lý vòng đời engine, sử dụng bộ runtime được đóng gói và các mô hình đã chuẩn bị cục bộ. Người dùng không phải mở terminal để khởi động engine trong bản desktop hoàn thiện.

Tận dụng lõi Python của dự án `VECTOR AI`; không viết lại ingestion, retrieval, lưu trữ hay quản lý job nếu phần hiện có đáp ứng hợp đồng tích hợp. Đích desktop là Tauri với sidecar; ứng dụng React/Vite hiện tại tiếp tục là chế độ tương thích. Giai đoạn đầu dùng HTTP trên loopback; IPC chỉ được cân nhắc sau khi desktop chạy ổn định và có nhu cầu đã đo được.

Phạm vi công cụ của trợ lý chỉ gồm đọc metadata và báo cáo mô phỏng **đã tồn tại**, giải thích kết quả cùng giả định của báo cáo. Không xây dựng công cụ tối ưu bố trí, xếp hạng phương án triển khai, lựa chọn mục tiêu hoặc điều khiển mô phỏng. Công cụ không sửa trạng thái bản đồ, khí tài hay dữ liệu kịch bản. Tìm kiếm tài liệu có thể sắp thứ tự đoạn văn theo mức liên quan; điều đó không mở rộng phạm vi sang xếp hạng phương án triển khai.

Đợt tổ chức hiện tại chỉ tạo hồ sơ kế hoạch và bản chụp mã nguồn trong `ai/`. Các tệp AI cũ và luồng tích hợp đang chạy giữ nguyên vị trí; chuyển chúng về sau cần một thay đổi riêng, có kiểm tra hồi quy và khả năng quay lại.

## Nền tảng đã quan sát

Nguồn để tái sử dụng nằm tại `E:\code\du_an\3D\vkq\VECTOR AI\backend`, package `vector_ai_backend`. Những nhận định dưới đây dựa vào mã nguồn và tài liệu nguồn đã đọc; chưa có phép kiểm chứng mới trên bản sao tích hợp.

| Thành phần nguồn | Điều đã có | Điều phải hoàn thiện hoặc kiểm chứng tại dự án đích |
| --- | --- | --- |
| `domain/`, `application/`, `adapters/`, `storage/` | Phân lớp lõi nghiệp vụ, adapter và SQLite | Hợp đồng tích hợp độc lập với giao diện/bản đồ; xác định những route còn chứa nghiệp vụ |
| `application/ingestion.py`, `application/retrieval.py` | Chunk theo cấu trúc, bảo vệ bảng; truy xuất lexical và dense có điều kiện | MVP lexical với dữ liệu tiếng Việt; chất lượng trích đoạn và liên kết tới tài liệu |
| `application/runs.py`, `resources.py`, `storage/checkpoints.py` | Job, hủy ở ranh giới batch, checkpoint và cơ chế cấp ngân sách tài nguyên | Vòng đời từ giao diện đích; khôi phục sau lỗi; phối hợp tài nguyên với Cesium |
| `application/tools.py` | Allowlist, capability, kiểm tra JSON/schema, giới hạn payload và deadline | Adapter chỉ đọc báo cáo/metadata; nguồn chưa triển khai công cụ 3D |
| `lifecycle.py` và launcher desktop của nguồn | Định danh process, token instance, parent PID và kiểm tra quyền sở hữu | Supervisor sidecar của ứng dụng đích, xử lý xung đột cổng và thoát ứng dụng |
| README backend | Chế độ `strict_sources`; thiếu evidence có thể trả lời thiếu thông tin mà không gọi mô hình | Kiểm chứng trích dẫn thật, UI mở nguồn, xử lý tài liệu mâu thuẫn |

Bundle portable nguồn `runtime/bundles/20260915-091131-593d8e/manifest.json` khai báo **thiếu** native Qdrant, Tesseract/language files, các adapter embedding/OCR tùy chọn và trọng số embedding/OCR/Ollama. Có runtime và executable không đồng nghĩa có một trợ lý offline đủ mô hình. Không ghi nhận dense retrieval, OCR hoặc suy luận mô hình là sẵn sàng chỉ dựa vào bundle đó.

`backend/vector_ai_backend/config.py` hiện xác thực cổng cố định `8000`/`11434`/`6333` và origin frontend `http://127.0.0.1:3000`; policy CORS nguồn cũng chứa origin cố định, gồm `http://localhost:1420`. Tích hợp với Vite hiện tại hoặc WebView Tauri cần sửa có kiểm soát hợp đồng origin/cấu hình; không giả định cắm vào là chạy được. `scripts/vectorAiLauncher.ts` tại dự án đích là launcher phát triển dựa vào thư mục `VECTOR AI` bên cạnh, chưa phải cơ chế phân phối desktop độc lập.

**Không chạy nguyên trạng bản chụp backend.** `config.py` mặc định dùng `%LOCALAPPDATA%\VECTOR_AI`; đường khởi động `__main__`/lifespan API có thể gọi load/build container khi chưa truyền `data_dir`. Chạy như vậy có nguy cơ mở database của ứng dụng VECTOR AI gốc. Bridge đích phải tạo `BackendSettings(data_dir=<namespace mới của ứng dụng>)`, truyền settings vào `build_container(settings)` rồi `create_app(container)`; mọi repository/checkpoint/file path phải được xác minh nằm trong namespace đó. Namespace mới cần được chốt ở giai đoạn 0; ví dụ dự kiến `%LOCALAPPDATA%\VomKQ\ai`, không dùng thư mục dữ liệu nguồn.

Bootstrap nguồn còn khởi tạo phụ thuộc SymPy dù math được khai báo là extra tùy chọn; worker dùng `sys.executable -m ...` nên bundle phải chạy được đúng Python và tìm được package. Một đường trích xuất DOCX phong phú phụ thuộc script bên ngoài bản chụp; fallback XML không bảo đảm giữ đủ cấu trúc. Những điểm này cần adapter/cấu hình hoặc kiểm chứng đóng gói trước khi công bố hỗ trợ.

## Bố cục làm việc

Mọi hồ sơ và đầu vào chuẩn bị AI của dự án được gom dưới một thư mục:

```text
ai/
  README.md                    # Cách đọc hồ sơ, nguồn gốc và trạng thái thực tế
  PLAN.md                      # Kế hoạch này
  inventory.json               # Danh mục bản chụp, nguồn, SHA-256 và phần bị loại
  vendor/vector-ai/backend/    # Bản chụp mã nguồn backend có chọn lọc
  reference/web/               # Client/launcher hiện tại để đối chiếu, không chạy riêng
  config/                      # Cấu hình ví dụ, không chứa bí mật/cấu hình cá nhân
  docs/                        # Thiết kế RAG và hợp đồng workflow
  workflows/                   # Đặc tả ví dụ; chưa được đăng ký trong engine
  scripts/                     # Tạo/kiểm tra snapshot, không khởi động engine
  runtime/                     # Chỗ chuẩn bị bundle; không coi là đã có runtime đầy đủ
  models/                      # Chỗ chuẩn bị manifest/profile; chưa chứa trọng số
  knowledge/                   # Chỗ chuẩn bị schema/gói mẫu; chưa chứa tài liệu cá nhân
```

SHA-256 từng tệp snapshot được lưu trong `inventory.json`, cùng đường dẫn nguồn, phiên bản/commit nếu xác định được, thời điểm chụp và danh sách bao gồm/loại trừ. Bản chụp vendor chỉ chứa mã nguồn lõi và tài liệu/cấu hình cần để hiểu lõi; không đưa bộ tests nguồn vào snapshot đợt này. Loại trừ `.venv`, cache, `__pycache__`, egg-info sinh tự động, runtime/binary, trọng số, toàn bộ `public`/builtin knowledge nguồn, cơ sở dữ liệu người dùng, lịch sử chat, khóa API, `.env` và tài liệu riêng tư. Các test nguồn có thể được đọc/tái sử dụng có chọn lọc trong giai đoạn triển khai; chưa được phân phối trong vendor hiện tại.

Khi có ứng dụng desktop, runtime/model/gói mẫu phát hành là tài nguyên đọc; dữ liệu thay đổi của người dùng nằm trong thư mục dữ liệu ứng dụng riêng ngoài repository. Không ghi chat hay knowledge cá nhân trở lại `ai/vendor/`, thư mục cài đặt hoặc Git. Dùng bản chụp vendor ổn định thay vì import mã trực tiếp từ thư mục đồng cấp trong bản phát hành.

## Kiến trúc dự kiến

```text
React UI trong Tauri / React UI tương thích web
                  |
          AiClient có hợp đồng phiên bản
                  |
      HTTP loopback + sự kiện job/SSE ở MVP
                  |
       Supervisor desktop quản lý sidecar
                  |
    vector_ai_backend: Application + Domain
       |              |               |
 SQLite + FTS5    engine mô hình    tools chỉ đọc
       |          cục bộ quản lý   snapshot báo cáo
       |
 embedding + Qdrant và OCR: bổ sung tùy chọn
```

Supervisor quản lý các process do chính ứng dụng khởi tạo; kiểm tra build/protocol/instance trước khi dùng lại một dịch vụ. Loopback không tự là xác thực: cần hợp đồng xác thực phiên, policy origin và giới hạn request phù hợp. Token định danh instance hiện có phải được phân biệt với token xác thực request. Không dừng process chỉ vì nó chiếm một cổng.

Mô hình ngôn ngữ và embedding có profile riêng; không mặc định chúng là cùng một mô hình. Cấu hình khai báo vị trí asset cục bộ, fingerprint/checksum, tokenizer, giới hạn context, thiết bị và ngân sách tài nguyên. Không tải ngầm mô hình khi chat hay khởi động engine. Thiếu asset phải có trạng thái cụ thể và cách nhập bundle hợp lệ. Chọn mô hình sau khi đánh giá bộ câu hỏi tiếng Việt và tài nguyên máy đích; chưa chốt tên hoặc cam kết tốc độ.

## Các giai đoạn

Mỗi giai đoạn dưới đây đang ở trạng thái **dự kiến**. Hồ sơ tổ chức hoặc bản chụp nguồn được tạo trong đợt này không có nghĩa các tiêu chí triển khai đã đạt. Hoàn tất một giai đoạn cần kết quả kiểm tra ghi lại cùng phiên bản mã và bộ dữ liệu kiểm chứng; không dùng thời gian ước lượng làm tiêu chí.

### Giai đoạn 0 — Chốt nguồn và hợp đồng tích hợp

**Đầu ra:** README, inventory/checksum và bản chụp backend; sơ đồ thành phần; hợp đồng `AiClient` và protocol; danh sách phần tái sử dụng/phần cần adapter. Cấu hình ví dụ phân biệt developer mode, desktop mode, lexical-only và các năng lực tùy chọn.

Đọc các module nguồn vừa đủ để chốt ranh giới; kiểm kê giấy phép phụ thuộc/asset trước khi đóng gói. Ghi rõ trường nào là cấu hình đích, trường nào còn bị validate cố định trong nguồn. Chốt namespace dữ liệu riêng và bridge khởi động tường minh; không dùng entry point nguồn nguyên trạng. Quyết định chính sách origin của dev/WebView và cách tránh va chạm với một bản VECTOR AI đang chạy. Kiểm kê dependency SymPy đang được bootstrap tạo sớm, đường import của worker và script DOCX ngoài snapshot; ghi rõ trường hợp rich DOCX chưa hỗ trợ. Chưa di chuyển các tệp tích hợp cũ.

**Nghiệm thu:** tệp snapshot khớp checksum; không có dữ liệu cá nhân/runtime/trọng số/tests/public knowledge nguồn trong vendor; README chỉ rõ chưa có engine đầy đủ và không được chạy snapshot nguyên trạng; hợp đồng không phụ thuộc `useTacticalStore` hay chức năng cố vấn. Có danh sách phụ thuộc thiếu và quyết định namespace/bridge/origin/cổng được ghi lại. Thiết kế kiểm tra tất cả đường dữ liệu tách khỏi `%LOCALAPPDATA%\VECTOR_AI` trước lần chạy tích hợp đầu tiên.

### Giai đoạn 1 — Desktop quản lý engine và transport

**Đầu ra:** vỏ Tauri cho giao diện hiện tại; supervisor sidecar; bundle runtime Windows x64 có manifest/checksum; `AiClient` HTTP dùng chung cho desktop và chế độ web tương thích; màn hình trạng thái engine/model.

Tái sử dụng cơ chế lifecycle của nguồn sau khi rà soát. Startup kiểm tra manifest, quyền đọc asset và tương thích protocol; khởi động Python/engine cần thiết trong process nền ẩn; chờ health với timeout rõ ràng. Đóng ứng dụng gửi shutdown/hủy job rồi dừng process thuộc sở hữu ứng dụng. Nếu cổng bị chiếm bởi dịch vụ khác, báo xung đột và hướng dẫn xử lý, không tự kết thúc dịch vụ đó. Kênh local ban đầu dùng HTTP; chọn cổng khác hoặc IPC sau này phải cập nhật validation và tests tương ứng.

Web phát triển có thể tiếp tục dùng launcher tương thích. Web build không hứa tự khởi động executable như bản desktop; giao diện phải thể hiện engine chưa kết nối. Phiên bản legacy tiếp tục hoạt động trong lúc chuyển đổi.

**Nghiệm thu:** mở/đóng desktop khởi động/dừng đúng process; restart sau crash không tạo process trùng; thiếu executable/model trả lỗi có hành động khắc phục; cổng bị chiếm không gây mất process ngoài ứng dụng. Health/protocol/auth/origin được kiểm chứng từ WebView và web tương thích. Mở bản đồ vẫn hoạt động khi AI không sẵn sàng.

### Giai đoạn 2 — MVP nhập tài liệu và lexical retrieval

**Đầu ra:** quản lý tài liệu cục bộ; ingestion job; SQLite/FTS5; trích đoạn theo trang/tiêu đề/đoạn; tìm kiếm lexical và xem nguồn. Định dạng đầu tiên: TXT, Markdown và PDF có lớp văn bản; PDF chỉ có ảnh được đánh dấu cần OCR, không coi là tài liệu rỗng đã nhập thành công. Định dạng khác chỉ bổ sung khi có extractor và bộ kiểm chứng.

Tái sử dụng extraction/chunker/lexical index của nguồn, giữ cấu trúc bảng và công thức. Mỗi tài liệu có ID, checksum, phiên bản, scope và trạng thái nhập; mỗi chunk liên kết về nguồn. Kiểm tra encoding, giới hạn file/trang và tài liệu trùng. Import một phiên bản mới không ghi đè bản đang được trích dẫn trước khi phiên bản mới hoàn tất. MVP vẫn chạy khi không có embedding hay Qdrant.

**Nghiệm thu:** bộ tài liệu tiếng Việt tổng hợp/được phép sử dụng cho kết quả lexical có đoạn nguồn đúng; bảng không mất quan hệ cột; import lỗi không kích hoạt dữ liệu dở; dữ liệu của workspace/chat khác không lọt vào truy vấn. Khởi động lại giữ được tài liệu/index và khôi phục hoặc đánh dấu đúng job dang dở.

### Giai đoạn 3 — Hỏi đáp có evidence và trích dẫn bắt buộc

**Đầu ra:** luồng truy vấn–retrieval–đóng gói evidence–suy luận–kiểm tra citation; giao diện xem từng nguồn; streaming có phân biệt completed/cancelled/failed. Bundle mô hình ngôn ngữ hợp lệ được nhập cục bộ và engine do ứng dụng quản lý.

Mặc định `strict_sources=true`. Câu trả lời về tài liệu chỉ đưa khẳng định có evidence; nội dung suy luận được nhận diện và liên kết với evidence dùng để suy luận. Nếu không có hoặc không đủ evidence, nói thiếu thông tin; không bù bằng lời đoán của mô hình. Tài liệu chứa chỉ dẫn được coi là nội dung nguồn, không được đổi policy hay gọi tool. Tóm tắt/giải thích cần giữ tên nguồn, phiên bản, trang/tiêu đề và đơn vị số liệu.

Hợp đồng trích dẫn tối thiểu gồm `evidence_id`, `document_id`, `document_version`, `checksum`, `chunk_id`, `page/heading/offset` và trích đoạn. UI dùng ID như `[R1]` nhưng phải mở đúng phiên bản đã dùng; không tin một đường dẫn do mô hình tự viết. Citation ID chưa được cấp cho truy vấn bị từ chối; mâu thuẫn giữa nguồn phải được trình bày cùng trích dẫn của cả hai.

**Nghiệm thu:** bộ câu hỏi có đáp án tham chiếu kiểm tra đúng nguồn/trang, câu hỏi thiếu dữ liệu, mâu thuẫn, citation giả và chỉ dẫn độc hại trong tài liệu. Không evidence thì không gọi mô hình trong chế độ strict. Ngắt stream trước kết thúc không bị ghi là thành công; nhấn dừng phân biệt với lỗi engine. Có phép đo chất lượng trên mô hình thật, không lấy test giả làm bằng chứng.

### Giai đoạn 4 — Gói tri thức có phiên bản và phục hồi

**Đầu ra:** schema knowledge pack, import/export có kiểm tra, staging và kích hoạt nguyên tử, lịch sử phiên bản; backup/restore có checksum. Gói mẫu dùng tài liệu được phép phân phối hoặc dữ liệu tổng hợp.

Manifest khai báo `pack_id`, `pack_version`, `schema_version`, nguồn/giấy phép, checksum từng file, extractor/chunker version, quy tắc scope và phiên bản chỉ mục. Chỉ mục lexical có thể dựng lại từ nguồn. Nếu xuất dense index, ghi đủ fingerprint mô hình/tokenizer, dimension, normalization và generation; nếu thiếu thông tin đó thì bắt buộc dựng lại thay vì truy vấn chéo embedding space. Tri thức đã kích hoạt không sửa tại chỗ; cập nhật qua phiên bản mới.

Import kiểm tra kích thước, đường dẫn, checksum và tương thích trước khi kích hoạt. Gói lỗi giữ trạng thái cũ; backup lưu dữ liệu cần thiết để khôi phục, không mặc định chứa trọng số. Scope riêng tư không trở thành shared chỉ vì export/import. Restore tách khỏi thao tác thay binary và giữ bản trước để quay lại.

**Nghiệm thu:** round-trip một gói cho cùng nguồn và citation; gói hỏng/không tương thích không ảnh hưởng gói đang dùng; rollback giữ đúng nguồn đã trích dẫn; restore sau khi đóng/mở ứng dụng cho dữ liệu nhất quán. Kiểm tra path traversal và nội dung export để không lẫn cấu hình, lịch sử hay tài liệu ngoài phạm vi.

### Giai đoạn 5 — Workflow và tools chỉ đọc

**Đầu ra:** registry tools được allowlist; schema request/response; adapter đọc snapshot metadata và báo cáo đã có; workflow tìm tài liệu, tóm tắt và giải thích báo cáo. Ví dụ adapter đề xuất: `document_metadata`, `read_report_snapshot`, `app_metadata`, dùng cùng tool `rag.search` của lõi nguồn. `explain-document-v1` và `quality-review-v1` là hợp đồng workflow dự kiến, chưa là năng lực đã tích hợp.

Adapter nhận snapshot có ID/version/thời điểm từ ứng dụng hoặc đọc artifact trong phạm vi đã chọn; không truy cập tùy ý toàn bộ filesystem và không gọi shell. Báo cáo chưa có hoặc chưa hoàn tất trả trạng thái thiếu, không tự chạy tính toán mới. Dữ liệu tool có nhãn nguồn riêng gồm `report_snapshot_id`, hash/checksum, revision bất biến, thời điểm tạo, phiên bản mô phỏng và tham số đã ghi trong báo cáo. `quality-review-v1` chỉ kiểm tra tính đầy đủ, nguồn, đơn vị và nhất quán của artifact được cung cấp. Trợ lý có thể giải thích giả định, giới hạn và đơn vị của kết quả; không dùng chúng để đề xuất bố trí hay xếp hạng phương án.

Tái sử dụng policy/schema/deadline và giới hạn JSON của nguồn. Workflow là chuỗi bước hiển thị được, có job ID và evidence từng bước. Bắt đầu bằng luồng xác định đơn giản; adapter LangGraph chỉ bật nếu có nhu cầu cụ thể, không đưa vào bắt buộc của MVP.

**Nghiệm thu:** tools không làm thay đổi state/source artifact; input sai bị từ chối; output bị giới hạn và có provenance; snapshot cũ được nhận diện. Giao diện kiểm tra được mỗi bước đã đọc gì; hủy workflow không gọi bước tiếp. Không có capability ghi, tối ưu bố trí, xếp hạng triển khai hay lựa chọn mục tiêu trong registry.

### Giai đoạn 6 — Dense retrieval và OCR tùy chọn

**Đầu ra:** profile embedding và generation có phiên bản; Qdrant local do supervisor quản lý khi được bật; hybrid retrieval với lexical fallback; adapter OCR và asset ngôn ngữ cục bộ khi được bật.

Chuẩn bị riêng executable, thư viện và trọng số đang thiếu trong manifest nguồn; kiểm tra giấy phép/checksum. Benchmark trước khi chọn mô hình embedding và ngân sách CPU/GPU. Reindex tạo generation mới, chỉ activate khi hoàn tất; vector là cache dựng lại, SQLite/source vẫn là dữ liệu chuẩn. Mô hình khác nhưng cùng dimension không được coi là tương thích. OCR giữ ảnh/trang, nội dung nhận dạng, provenance và trạng thái cần rà soát; không biến độ tin cậy OCR thành chứng minh sự thật.

**Nghiệm thu:** dense thực cải thiện bộ câu hỏi tham chiếu so với lexical theo chỉ số đã định trước; thiếu Qdrant/model vẫn tìm lexical được và UI báo chế độ đang dùng. Hủy reindex không thay active generation; thay model không trộn space; scope/verification được kiểm tra lại với metadata hiện hành. OCR có kiểm chứng trang thật cho tiếng Việt/bảng và đánh dấu đoạn lỗi. Không tuyên bố đã đạt chỉ dựa vào mock tests.

### Giai đoạn 7 — Tài nguyên, kiểm chứng và phát hành

**Đầu ra:** profile máy đích; giới hạn job/context/batch; bộ kiểm thử tích hợp desktop/offline; gói cài đặt có manifest; release checklist và hướng dẫn rollback. Không có cấu hình VRAM/FPS được bảo đảm trước khi đo trên máy đích.

Job phải có `run_id`, trạng thái queued/running/cancelling/cancelled/completed/failed, bước hiện tại, lượng đã xử lý/tổng nếu biết và lỗi phục hồi được. Không hiển thị phần trăm giả cho bước chưa biết tổng. SSE có sequence/cursor để reconnect không lặp sự kiện. Hủy ingestion/OCR/embedding có hiệu lực tại batch boundary; UI phản ánh đang hủy trong lúc batch hiện tại còn chạy. Mỗi job có deadline, giới hạn đầu vào/context/output, checkpoint và ngân sách.

Tái sử dụng admission/priority giữa chat và background batches nhưng không coi đó là giới hạn vật lý RAM/VRAM của hệ điều hành. Cesium nằm ngoài scheduler backend: phải đo tài nguyên thực, giữ headroom cho bản đồ, khởi đầu embedding CPU/ít concurrency, cho phép tạm dừng tác vụ nền và giải phóng model theo profile. Khi ngân sách thiếu, xếp hàng hoặc trả lỗi rõ ràng; không tự tăng tải. So sánh responsiveness bản đồ khi AI tắt/bật/đang index với cùng dữ liệu và thao tác, ghi cấu hình máy cùng số liệu.

**Nghiệm thu:** kiểm tra chat khi import lớn, hủy/thoát/crash/restart, timeout, hết dung lượng, model thiếu và engine lỗi; không có job/process mồ côi thuộc ứng dụng. Bản đồ tiếp tục dùng được và đạt ngân sách đo đã chốt. Cài/chạy trên máy sạch không cần Python/Node global; kiểm tra ngoại tuyến không phát sinh tải model/tài liệu. Có smoke test với mô hình thật và phục hồi dữ liệu thật được phép dùng.

## Kiểm thử và cổng phát hành

Các lệnh trong README nguồn là điểm khởi đầu để xây dựng kiểm chứng, **không phải kết quả đã chạy trong đợt lập kế hoạch này**. Khi triển khai, ưu tiên regression backend cho ingestion/retrieval, scope, citations, cancellation, lifecycle, tools và backup; kiểm tra TypeScript/build giao diện và `cargo check`/kiểm thử desktop sau khi có vỏ Tauri đích. Test giả kiểm tra hợp đồng; test mô hình/Qdrant/OCR thật kiểm tra năng lực và hiệu năng riêng.

Mỗi release lưu protocol/build ID, runtime/model/pack manifests, checksum, giấy phép, cấu hình máy kiểm chứng và kết quả kiểm tra. Không phát hành nhãn “offline đầy đủ” nếu thiếu runtime hoặc asset bắt buộc; tách rõ lexical-only, chat có mô hình, dense và OCR. Khóa phiên bản dependency/bundle cho release đã kiểm chứng thay vì dựa vào môi trường phát triển tình cờ có sẵn.

Rollback binary bằng bundle trước đã kiểm chứng; rollback tri thức/index bằng active version/generation trước. Trước migration schema, tạo backup đã xác minh và xác định phiên bản nào đọc được dữ liệu sau migration. Nếu downgrade không tương thích, phục hồi backup vào dữ liệu riêng, giữ dữ liệu hiện tại để xuất/đối chiếu; không mở database mới bằng binary cũ một cách mù quáng. Tính năng AI có công tắc tắt; rollback không yêu cầu di chuyển lại tệp tích hợp legacy hoặc xóa dữ liệu người dùng.

## Thứ tự và quyết định còn mở

Triển khai theo thứ tự 0 → 1 → 2 → 3 → 4 → 5. Giai đoạn 7 đặt yêu cầu từ đầu và là cổng nghiệm thu xuyên suốt; giai đoạn 6 chỉ bắt đầu khi lexical/evidence ổn định và có đủ asset. IPC, LangGraph, dense và OCR không là điều kiện để hoàn thành MVP tài liệu.

Các quyết định cần ghi lại trước thay đổi code: hợp đồng origin/cổng của ứng dụng đích; hình thức đóng gói Python/engine; mô hình ngôn ngữ và license; ngân sách máy đích; schema snapshot báo cáo; định dạng pack; chiến lược migration dữ liệu. Kết quả đợt tổ chức hiện tại chỉ là tài liệu và bản chụp nguồn: không cài đặt, tải asset, chạy kiểm thử năng lực hoặc sửa luồng AI/tác chiến đang hoạt động.
