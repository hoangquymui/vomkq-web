# Trợ lý GIS có nguồn — bản thử nghiệm v2

Giao diện cập nhật ngày 07/10/2026. Tính năng chạy trong frontend hiện tại và `ai-core/backend`. Cờ `vompk.analysis.v2.enabled` mặc định tắt; mở bằng nút **GIS AI** trên thanh công cụ. Thư mục `ai/` vẫn là hồ sơ tham khảo.

## Sử dụng

1. Chạy `npm run dev`, mở địa chỉ Vite hiển thị, bấm **GIS AI**. Một bảng chung chứa **AI phân tích**, **Chat** và **Tài liệu**.
2. **AI phân tích** mở ngay bảng phân tích hiện có, gồm lớp đối tượng và bảng đặc tính vùng phủ. Các phép tính và điều khiển cũ được tái sử dụng. Chọn đối tượng trên bản đồ và cập nhật phân tích như trước. Không còn nút AI riêng hoặc bảng AI nổi thứ hai.
3. Trong **Tài liệu**, nhập TXT/Markdown và chọn nguồn cho lượt hỏi. Đợi Core lập chỉ mục rồi cập nhật danh sách. UI hiển thị retrieval lexical/hybrid và tình trạng dense/OCR quan sát được; không tự cài extractor hoặc tải model.
4. Trong **Chat**, chọn model đã có trên máy và hỏi tài liệu đã chọn. Nút gửi chỉ khả dụng khi có nguồn tài liệu. Trích dẫn mở đoạn hỗ trợ; diễn giải bằng lời cần được xem lại. Có nút **Khôi phục kết quả** để đọc lượt đang có từ Core.
5. Đóng GIS AI bằng nút ✕ hoặc nút thanh công cụ. Các mục **Vùng & số đo**, **Dữ liệu** và **Báo cáo** đã được bỏ theo yêu cầu. Bấm marker kết quả phân tích sẽ mở đúng mục **AI phân tích** trong bảng chung.

Core được launcher Vite bật từ runtime portable sẵn có. Model nhẹ được ưu tiên khi đã cài; không tự bật Deep hoặc tải model/asset. Bảng phân tích vùng phủ dùng luồng hiện có. Chat dùng `document-qa-v1`; kết quả vùng phủ cũ không tự được gắn nhãn snapshot GIS đã kiểm chứng vì chưa có ledger/hash nguồn tương ứng.

Các phần kỹ thuật bên dưới mô tả engine snapshot, API và dữ liệu đã triển khai trước khi rút gọn giao diện. API/store báo cáo và ZIP vẫn tương thích với dữ liệu đã lưu; các màn hình thao tác này không còn trong GIS AI. Không xóa dữ liệu hoặc lịch sử cũ khi đổi giao diện.

## Nguồn và vòng đời

- Tọa độ WGS84, thứ tự longitude/latitude. Polygon có lỗ và Multi* được xử lý; vùng đi qua đường đổi ngày hiện bị từ chối rõ ràng.
- Đếm đối tượng quan sát giao vùng; diện tích/chiều dài được cắt theo AOI trước khi đo. Diện tích từng loại hợp nhất các polygon, tỷ lệ = diện tích hợp nhất / diện tích AOI × 100. Tỷ lệ của các loại khác nhau có thể chồng nhau.
- ID nguồn trùng và hình học tương đương được tính một lần. Cùng ID nhưng hình học khác nhau được ghi xung đột và loại khỏi phép đo; không tự chọn phiên bản.
- `observed`, `partial`, `missing`, `outside`, `unknown` là tình trạng dữ liệu. Giá trị thiếu dùng `null`. Cao độ hợp lệ bằng `0` được giữ nguyên. Mẫu cao độ chỉ mô tả các điểm lấy mẫu, không phải cực trị toàn vùng.
- Hash dataset gồm manifest và nội dung cell thực đã đọc. Snapshot có hash canonical tại backend. Terrain hash mô tả mẫu đã lấy, không mô tả toàn kho tile terrain.
- Snapshot bất biến theo ID. Đổi vùng, nguồn hoặc model hủy công việc hiện tại và tăng revision ngữ cảnh; kết quả cũ không ghi lên ngữ cảnh mới. Hủy worker dùng terminate, hủy run gọi DELETE backend.
- Không công bố token chưa kiểm tra. EOF, timeout, truncation hoặc schema/citation/số/chiều so sánh sai không tạo kết quả hoàn tất. Refresh đọc bản bền vững bằng GET; backend restart đánh dấu run dang dở `interrupted`, không tự suy luận lại.
- `validation.valid` xác nhận kiểm tra schema, liên kết nguồn và các ràng buộc số liệu của ứng dụng. Nó không xác nhận dữ liệu đầy đủ ngoài thực tế hoặc diễn giải ngữ nghĩa luôn đúng. Gói có checksum không phải chữ ký xác thực của người gửi.

## Lưu trữ và API

SQLite hiện tại dùng namespace bảng `analysis_*`: snapshot, evidence độc lập theo owner, run/result/metadata và report revision. DB schema v2 có backup trước migration tại `ai-core/data/backups/analysis-migrations/`; backfill giữ JSON/lịch sử cũ và rollback khi migration lỗi. Transport snapshot/result/package vẫn schema 1. History ghi thời gian xử lý, workflow/validator version và digest model quan sát từ tag local khi có.

| API | Chức năng |
| --- | --- |
| `POST/GET /api/v1/analysis/snapshots[/{id}]` | Lưu `{snapshot}` / đọc snapshot bất biến |
| `POST /api/v1/runs` | Workflow, `snapshot_id`, `document_ids`, `report_ids`; workflow mới luôn strict sources |
| `GET /api/v1/runs/{id}/events`, `DELETE /api/v1/runs/{id}` | SSE và hủy |
| `GET /api/v1/analysis/runs/{id}`, `/analysis/history` | Trạng thái/result bền vững và lịch sử |
| `GET/POST /api/v1/analysis/reports` | Đọc/lưu revision báo cáo |
| `GET /api/v1/analysis/capabilities`, `/api/v1/workflows` | Năng lực quan sát và catalog |

Dispatcher thực: `gis-analysis-v1`, `data-quality-v1`, `document-qa-v1`, `report-summary-v1`. Workflow không đăng ký trả 422. Các công cụ mới chỉ đọc phép đo/chất lượng, tìm đoạn tài liệu và đọc snapshot nguồn của báo cáo; số bước hữu hạn. Chỉnh nhãn diagram không thay đổi runtime stages hoặc strict sources.

## Giới hạn có nguồn gốc

| Tham số | Giá trị / đơn vị | Nơi dùng / lý do |
| --- | --- | --- |
| Bán kính ban đầu | 1 km, người dùng chỉnh | Store/UI, vùng lân cận để kiểm tra GIS, không phải ngưỡng chuyên ngành |
| Circle segments | 64 | `analysisGeometry`, xấp xỉ circle của Turf |
| Terrain samples / level | tối đa 25 điểm / L12 | Store/map overlay; quan sát có giới hạn, giữ `null` khi thất bại |
| File/cache | 80 / 160 MiB | `analysisData`; trần file từ kho vector hiện có, LRU working set có giới hạn |
| Fetch concurrency / batch | 4 request / 1.024 feature | Worker; tránh chiếm kết nối và giữ checkpoint hủy/yield |
| Hình học preview | 2.000 feature và 4 MiB | Snapshot; số đo đầy đủ tính trước cap, có finding khi thiếu hình học preview |
| Map preview | 5.000 đỉnh | Overlay; hình học lớn dùng bounds preview ghi rõ |
| Evidence/model output | 32 refs / 24 claims / 100.000 ký tự | Backend; không gửi toàn GeoJSON, kiểm tra trước công bố |
| Tóm tắt báo cáo | tối đa 32 báo cáo | Backend; giữ source snapshots cần kiểm tra và ràng buộc nguồn |
| Metadata HTTP | 30 giây | `analysisClient`; inference dùng timeout của profile client hiện có |
| Upload/report | 100 MiB | Trần Core hiện có |
| ZIP nén/giải nén/manifest | 100 MiB / 256 MiB / 64 KiB | Package guard trước cấp phát, chỉ hai tên tệp cố định |

Ngân sách scheduler là cơ chế xếp việc; không phải giới hạn VRAM thực. Các module Turf khóa phiên bản 7.4.0. `format` JSON schema của Ollama kiểm soát cấu trúc; backend còn kiểm tra giá trị/unit/citation/comparison. Runtime Ollama đã cài không biên dịch được một số string bounds lớn, nên adapter bỏ string bounds khi tạo grammar nhưng giữ array bounds; backend vẫn áp dụng schema và kích thước đầy đủ.

Tham khảo API chính thức: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [Turf intersect](https://turfjs.org/docs/api/intersect), [lineSplit](https://turfjs.org/docs/api/lineSplit), [area](https://turfjs.org/docs/api/area).

## Kiểm chứng và nghiệm thu

Các harness nằm trong `docs/verify-analysis-*`; log/screenshot/capture nằm trong `logs/analysis-verification/`, log đánh giá trong `logs/analysis-evaluation/` (không đưa runtime/log vào Git).

Đã chạy TypeScript, production build, **129 test backend**, 39 kiểm tra GIS, 7 ledger, 24 ZIP, 6 store và 13 transport/SSE. Chrome thực đã chạy worker trên vùng Đà Nẵng bán kính 500 m, mở nguồn, hủy, lưu/đọc snapshot, gọi model local, ZIP và ingestion/QA Markdown (13 kiểm tra). Các lượt đo sau tối ưu khoảng 1,7–3,8 giây; lượt cuối có một main-thread long task 83 ms, các lượt trước không ghi nhận long task trong phép đo. Đây là một cảnh kiểm tra, không phải chứng nhận hiệu năng mọi dữ liệu.

Benchmark riêng đếm `scene.postRender` Cesium khi camera di chuyển, 3 cặp lượt cùng cảnh với 20 marker GIS tổng quát: median baseline 28,49 FPS, khi AI chạy 28,34 FPS, tỷ lệ 0,9948; chuyển tab median 89,1 ms, tối đa 141,7 ms. Ba lượt đều có 68 completion tokens từ model local. Chrome headless dùng Intel UHD/D3D11; inventory máy còn có RTX 3050 6 GB. Model có allocation GPU quan sát từ Ollama, không dùng allocation để suy ra mức sử dụng GPU kernel. Kết quả nằm trong `logs/analysis-verification/performance.json`; chưa thay thế nghiệm thu trên Chrome desktop hoặc cảnh nhiều feature/tài liệu nhập nền.

Hai fixture 100 câu riêng biệt đều qua các kiểm tra tự động bám nguồn: `analysis-evaluation-v1.json` chứa trường hợp tổng hợp đối chiếu `0`/`null`/coverage và yêu cầu bịa số; `analysis-evaluation-real-v1.json` từ capture GIS thật, có capture bất biến theo SHA256 và nguồn/phiên bản đã đo. Chạy tra cứu bám nguồn bằng code không phải điểm chính xác AI 100%. Trích đoạn tài liệu và diễn giải rộng vẫn cần đánh giá ngữ nghĩa với bộ tài liệu thực tế của nhóm trước khi mở mặc định.

Ví dụ lệnh PowerShell (Python portable hiện có):

```powershell
npx tsc -b --pretty false
$env:PYTHONPATH = Join-Path (Get-Location) 'ai-core\backend'
& 'ai-core/runtime/bundles/20260915-091131-593d8e/python/python.exe' -m pytest ai-core/backend/tests -q -o addopts=''
& 'ai-core/runtime/bundles/20260915-091131-593d8e/python/python.exe' scripts/evaluate-analysis.py --limit 100
& 'ai-core/runtime/bundles/20260915-091131-593d8e/python/python.exe' scripts/evaluate-analysis.py --fixture docs/analysis-evaluation-real-v1.json --limit 100
npx esbuild docs/verify-analysis-geometry.ts --bundle --platform=node --format=esm --outfile=node_modules/.cache/analysis-geometry.mjs
node node_modules/.cache/analysis-geometry.mjs
node docs/verify-analysis-vector-manifest.mjs
npx esbuild docs/verify-analysis-package.ts --bundle --platform=node --format=cjs --outfile=logs/analysis-verification/package-checks.cjs
node logs/analysis-verification/package-checks.cjs
npx esbuild docs/verify-analysis-store.ts --bundle --platform=node --format=esm --outfile=logs/analysis-verification/store-checks.mjs "--banner:js=import { createRequire as createTaskRequire } from 'node:module'; const require=createTaskRequire(import.meta.url); import.meta.env={BASE_URL:'/',VITE_VECTOR_AI_URL:'http://analysis.test.invalid'};"
node logs/analysis-verification/store-checks.mjs
```

Chrome harness dùng một Chrome riêng với remote debugging 9339 và profile test; chạy `node docs/verify-analysis-chrome.mjs --ai --documents` khi app/Core đã sẵn sàng. Không dùng profile Chrome làm việc của người dùng cho tự động hóa.

`scripts/cleanup-analysis-verification.py` mặc định chỉ liệt kê run fixture khớp chính xác log. `--apply` backup SQLite rồi dọn riêng những run kiểm thử không được báo cáo tham chiếu; không dọn lịch sử legacy hay tài liệu. Fixture Markdown của Chrome harness được chuyển sang archived sau kiểm tra.

Trước khi mở mặc định: đo cold/warm với vùng lớn, pan/zoom cùng cảnh khi AI tắt/bật, tài liệu nhập nền và model đã cài trên RTX 3050 6 GB. Mục tiêu phản hồi UI dưới 200 ms và FPS trung vị khi AI chạy ít nhất 80% baseline cần được kiểm tra trên phiên Chrome desktop thực. Tách kết quả headless khỏi nghiệm thu desktop. DOCX/PDF export và cộng tác LAN thuộc giai đoạn sau.
