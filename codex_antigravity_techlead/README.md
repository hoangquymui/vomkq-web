# Codex Technical Lead × Google Antigravity (Windows)

**Tác dụng**: Antigravity viết/sửa code; hook `PostToolUse` ghi nhật ký file đã sửa; hook `Stop` gọi Codex CLI trong chế độ **read-only**, đối chiếu code với `SUPERVISOR_TASK.md`, tạo báo cáo JSON và (khi có lỗi cụ thể) yêu cầu Antigravity tiếp tục sửa. Mỗi phiên **tối đa 2 lần tự yêu cầu sửa** (chỉnh trong `.codex-supervisor/settings.json`).

**Lưu ý quan trọng**: Đây là kit giám sát ở checkpoint/Stop, **không phải kết nối điều khiển trực tiếp hai AI mọi lúc**. Hook phải được Antigravity hỗ trợ và kích hoạt trong bản đang dùng. Có báo cáo thực tế về lỗi Stop hooks không chạy trên Antigravity IDE Windows; nếu không thấy nhật ký tự động, sử dụng `--review-now` bên dưới và cập nhật IDE. Codex không đảm bảo phát hiện mọi lỗi.

## 1. Chuẩn bị (PowerShell)

```powershell
node --version
npm --version
python --version
git --version
npm install -g @openai/codex@latest
codex login
codex --version
```

Dùng Codex từ tài khoản ChatGPT (nếu được hỗ trợ). Các lần review dùng hạn mức của tài khoản hoặc API tùy hình thức đăng nhập; không mặc nhiên miễn phí/vô hạn.

## 2. Cài vào dự án

Giải nén ZIP đến một thư mục bất kỳ, rồi mở PowerShell ở THƯ MỤC GIẢI NÉN (chỗ có `setup.py`). Thay đường dẫn phía dưới bằng ROOT Git của dự án bạn đang mở trong Antigravity:

```powershell
python .\setup.py --project "E:\code\du_an\3D\vkq\vomphongkhong"
```

Lệnh cài sẽ **không xóa các hook có sẵn**. Nó tạo/cập nhật đúng 1 mục `codex-tech-lead` trong `.agents/hooks.json`, sao lưu bản hooks.json cũ nếu có, cài hai file `.agents/codex_supervisor.py` và `.agents/codex_review.schema.json`. Không ghi đè `SUPERVISOR_TASK.md` đã có. Tạo `.codex-supervisor/` để chứa log riêng và thêm thư mục này vào `.gitignore`.

**Dự án phải có Git với ít nhất một commit**. Nếu chưa có Git: tự sao lưu rồi khởi tạo/commit trước khi cài. Nếu tồn tại thay đổi cũ chưa commit, Codex có thể tính cả các thay đổi ấy vào đợt review đầu tiên; cân nhắc tạo commit/chọn nhánh riêng để giữ mốc rõ ràng.

## 3. Viết đặc tả để Codex biết cách nghiệm thu

Mở `<PROJECT>\SUPERVISOR_TASK.md` và thay tất cả chuỗi `[DIEN_...]`. Ví dụ:

```markdown
# NHIỆM VỤ HIỆN TẠI
## Mục tiêu
Thêm tìm kiếm trên trang sản phẩm, không làm hỏng giỏ hàng.
## Phạm vi
API tìm kiếm, input frontend, kiểm thử trường hợp chuỗi rỗng.
## Không được làm
Không thay DB schema và không sửa chức năng thanh toán.
## Tiêu chí nghiệm thu
Lọc đúng theo tên, không gây SQL injection, giữ phân trang.
## Cách kiểm thử
Chạy npm test, kiểm thử API với 3 đầu vào mẫu.
```

**Chưa điền đặc tả thì hệ thống sẽ bỏ qua review tự động**, để tránh đánh giá code mà không biết mục tiêu.

## 4. Khởi động lại Antigravity

Trong Antigravity IDE, đóng và mở lại workspace, tìm `... > Customizations > Hooks` (hoặc `Settings > Customizations > Hooks` trong Antigravity 2.0) và kiểm tra `codex-tech-lead` đã bật/trust. Có thể phải khởi động lại toàn bộ IDE để thay đổi hooks có hiệu lực.

Để kiểm tra môi trường, chạy từ ROOT dự án:

```powershell
python .\.agents\codex_supervisor.py --doctor
```

Kiểm tra `codex` khác `null`, `baseline_sha` tồn tại và `template_edited=true`.

## 5. Giao nhiệm vụ cho Antigravity

Dán prompt gợi ý:

> Hãy triển khai đúng nhiệm vụ tại SUPERVISOR_TASK.md. Trước khi làm, đọc mục tiêu và tiêu chí nghiệm thu. Không sửa .agents/codex_supervisor.py, .agents/hooks.json và .codex-supervisor. Mỗi giai đoạn hoàn thành hãy kiểm tra/ghi kết quả kiểm thử tương ứng. Khi xong, hãy kết thúc phiên để hook Stop gọi Codex nghiệm thu. Nếu nhận phản hồi từ Codex, sửa theo bằng chứng và kiểm thử lại. Không tự báo hoàn thành khi báo cáo Codex chưa đạt.

Kết quả xem ở:

- `<PROJECT>\.codex-supervisor\latest_report.json`: verdict `pass`, `needs_fix`, `inconclusive`.
- `<PROJECT>\.codex-supervisor\events.jsonl`: nhật ký.
- `<PROJECT>\.codex-supervisor\latest_codex_diagnostics.txt`: lỗi Codex khi không chạy được.

**Quy tắc:** `needs_fix` → phản hồi và yêu cầu Antigravity sửa (tối đa 2 vòng). `pass` → Antigravity được dừng. `inconclusive`/gặp lỗi/hết lượt → dừng, báo cáo cần con người xem. Không coi dừng là code đã đạt.

## 6. Thử ngay mà không phụ thuộc Hook / phương án dự phòng

Trong ROOT dự án, sau khi Antigravity đã sửa ít nhất một file và nhiệm vụ đã được điền:

```powershell
python .\.agents\codex_supervisor.py --review-now
Get-Content .\.codex-supervisor\latest_report.json -Raw
```

Lệnh này **chỉ tạo báo cáo**, không tự gửi lại Antigravity. Bạn có thể dán `latest_report.json` vào chat agent Antigravity để yêu cầu sửa. Nếu hook không chạy, đây là phương án ổn định nhất.

## 7. Bắt đầu nhiệm vụ khác

Để mốc Git rõ ràng, khi kết thúc nhiệm vụ trước, hãy commit những thay đổi đã duyệt. Sau đó chạy:

```powershell
python .\.agents\codex_supervisor.py --new-task
```

Cập nhật `SUPERVISOR_TASK.md`, giao nhiệm vụ kế tiếp. Lệnh này đặt lại vòng sửa và lưu Git HEAD mới làm baseline. Nếu có thay đổi chưa commit tại thời điểm đặt baseline, chúng vẫn bị đưa vào review kỳ sau.

## Bảo mật và hạn chế

- Codex được chạy với `--sandbox read-only` và không trực tiếp chỉnh source. **Code và các trích đoạn liên quan vẫn có thể được gửi tới nhà cung cấp mô hình khi review**; không dùng với dữ liệu nhạy cảm nếu chưa được phép.
- Giới hạn review 150 giây, hook tối đa 240 giây. Nếu Codex lỗi/timeout, Stop sẽ cho Antigravity dừng và ghi `review_error` vào log (không tự phê duyệt). Nếu dự án lớn, chỉnh 2 timeout tương ứng.
- Hook Stop chỉ chạy trên kết thúc bình thường (`model_stop` và `fullyIdle=true`); không ép Agent chạy tiếp khi có lỗi hệ thống, công việc nền chưa xong hay vượt bước.
- Không tự động chạy command/test có thể gây thay đổi. Kiểm thử runtime phải do Antigravity/chính bạn thực hiện.
- Không ghi đè Git hoặc auto-commit. Nên chạy trong nhánh làm việc riêng và kiểm tra Git diff sau mỗi đợt.
- `setup.py` dùng Python đang chạy setup làm trình thông dịch hook tuyệt đối. Nếu chuyển máy hoặc đổi Python, chạy lại `setup.py` để sửa đường dẫn.

Nguồn tham khảo chính thức: https://www.antigravity.google/docs/hooks ; https://learn.chatgpt.com/docs/cli/reference
