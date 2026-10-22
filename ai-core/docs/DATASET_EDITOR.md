# Đọc và soạn dữ liệu có công thức, bảng

## Thư mục tài liệu trong Kho Kiến Thức

Tại nút **Kho Kiến Thức**, bấm **Thư mục tài liệu**, đặt tên như `SỔ TAY`, rồi
kéo tay nắm **⠿** của một tài liệu vào thư mục. Có thể tạo thư mục con và kéo
thư mục vào thư mục khác. Bấm **Lưu sơ đồ** để lưu cách sắp xếp.

Thư mục chỉ là lớp tổ chức ở cấp kho. Nó không gộp tệp, không đổi ID tài liệu,
không đổi phạm vi nguồn và không làm thay đổi dữ liệu hoặc kết quả RAG. Khi xóa
một thư mục, tài liệu và thư mục con được chuyển lên cấp cha thay vì bị xóa.

## Folder trên ổ đĩa, lưu trữ và xóa tài liệu

Cây được đồng bộ thành folder thật trong thư mục dữ liệu của VECTOR AI, ví dụ:
`kho_kien_thuc/so_tay_tong_hop/so_tay_si_quan_phong_khong/`.
Tên folder chuyển thành chữ thường không dấu; tên trùng được thêm mã phân biệt.
Mỗi tài liệu có `noi_dung.md`, `cay_du_lieu.json`, `tai_lieu.json`, `doan_nguon.json`
và thư mục `nguon` chứa bản nguồn nếu còn tệp. Đổi tên/chuyển nhánh rồi **Lưu sơ đồ**
sẽ cập nhật folder tương ứng. **Mở folder kho** hoặc **Mở folder** mở đúng vị trí trên máy.

Folder này là bản đồng bộ từ ứng dụng; hãy chỉnh sửa dữ liệu trong ứng dụng rồi lưu.
Các thay đổi trực tiếp trên file Markdown/JSON ngoài ứng dụng chưa được nhập ngược tự động.
Backup đầy đủ của ứng dụng giữ database và nguồn; các folder được dựng lại khi khởi động.

Chọn nút tài liệu hoặc chuột phải vào tài liệu:

- **Lưu trữ:** chuyển sang `luu_tru_kien_thuc`, ẩn khỏi cây đang dùng và ngừng dùng trong RAG.
- **Xóa tài liệu:** chuyển sang `thung_rac_kien_thuc`, có thể khôi phục; chưa xóa vĩnh viễn.
- **Lưu trữ / Thùng rác → Khôi phục:** trả tài liệu về kho cùng nội dung và cách sắp xếp
  còn tồn tại. Trạng thái bật/tắt nguồn trước khi lưu trữ được giữ.
- **Sao chép folder sang nơi khác:** chọn kho đang dùng/lưu trữ/thùng rác, nhập đường dẫn
  tuyệt đối tới thư mục đích có sẵn. Ứng dụng tạo một bản sao mới có ngày giờ trong đó.

## Toàn màn hình và thao tác nhanh

**Mở rộng sơ đồ** hoặc **F11** mở rộng riêng vùng sơ đồ hết cửa sổ ứng dụng. Tiêu đề,
tab quản lý và bảng thuộc tính được ẩn; thanh công cụ nổi giữ các nút tìm, thu phóng,
lưu, hoàn tác và thu gọn. Bấm **Chỉnh sửa mục**, nhấp đúp vào nút hoặc nhấn **F2**
để mở bảng thuộc tính nổi khi cần. **Esc** đóng menu chuột phải trước, rồi thu gọn sơ đồ.
Chuột phải vào một nút để thêm mục con,
thêm nhóm 5 phần, đổi tên, xóa mục hoặc quản lý tài liệu. Đoạn nguồn gốc vẫn chỉ đọc;
các mục do người dùng tạo có thể xóa và hoàn tác.

| Phím | Thao tác |
| --- | --- |
| Ctrl+S | Lưu sơ đồ và nội dung |
| Ctrl+Z | Hoàn tác |
| Ctrl+Y hoặc Ctrl+Shift+Z | Làm lại |
| Insert hoặc Ctrl+Shift+N | Thêm mục/thư mục con |
| F2 | Đổi tên mục đang chọn |
| Delete | Xóa mục, thư mục hoặc chuyển tài liệu vào Thùng rác |
| Ctrl+F | Tìm mục trong cây |
| Ctrl+0 | Thu phóng vừa cây |

Khi con trỏ nằm trong ô nhập, Ctrl+Z/Delete vẫn thao tác trên văn bản. Lưu trữ/xóa tài liệu
được khôi phục bằng màn hình **Lưu trữ / Thùng rác**, không qua lịch sử Ctrl+Z của sơ đồ.

## Soạn nội dung

Trong **Quản lý workflow RAG → Sơ đồ dataset**, chọn đoạn nguồn để xem công thức
và bảng đã định dạng. Bấm **Xem toàn bộ nội dung** để đọc trong khung lớn. Bảng rộng
có thanh cuộn ngang; **Văn bản gốc** vẫn giữ nguyên Markdown/LaTeX của nguồn.

Danh sách **Loại nội dung** có **Phần**, bên cạnh Chương, Mục và các loại dữ liệu khác.
Có thể tổ chức theo **Tài liệu → Phần → Chương → Mục**; thêm mục con trong một Phần
sẽ mặc định tạo Chương.

Chọn một phần, chương, mục, công thức, bảng hoặc ghi chú để nhập ngay tại vùng
**Nội dung dữ liệu · dùng cho RAG**. Có thể gõ nhanh trong ô của panel hoặc bấm
**Soạn trực quan**. Bấm **Lưu sơ đồ** để lưu nội dung, kiểm tra công thức và cập
nhật chỉ mục. Ô **Ghi chú quản lý** không được đưa vào RAG.

“Đoạn nguồn” mô tả nguồn gốc của một nút, không phải loại nội dung. Với nút đã
trích từ tài liệu, danh sách **Loại nội dung** vẫn chọn được: Khái niệm, Tiêu
chuẩn, Công thức, Bảng, Ghi chú… Chọn **Chưa phân loại** nếu chưa xác định.

Để thêm dữ liệu thủ công, bấm **Tạo tài liệu** ở sơ đồ hoặc tab **Tài liệu**:

Chỉ nhập **Tên tài liệu / đoạn** rồi bấm **Tạo tài liệu trống** nếu muốn dựng khung trước.
Tài liệu xuất hiện ngay trong Kho Kiến Thức với 0 đoạn nguồn; mở nút tài liệu để thêm chương,
mục và nội dung sau. Tài liệu trống không tạo dữ liệu RAG giả và không chạy lập chỉ mục cho tới
khi có nội dung.

- **Văn bản:** gõ nội dung bình thường, có thể thêm tiêu đề bằng `#`.
- **Công thức:** viết như `10w/57kt`, `s = v*t`, `(a+b)/c`, `sqrt(x)`; bản trình bày
  tự cập nhật khi gõ, không cần bấm nút chuyển đổi. `10w/57kt` hiển thị `10w` ở tử
  số và `57kt` ở mẫu số. Biểu thức chưa hoàn chỉnh được giữ để sửa, không lưu nhầm
  công thức cũ khi bấm lưu ngay trong lúc chuyển đổi.
  Các nút Phân số/Căn/Lũy thừa/Chỉ số dưới mở ô nhập từng phần. Có LaTeX nâng cao
  khi cần sửa biểu thức phức tạp. Chuyển ký pháp chỉ để trình bày, không tính hoặc
  chứng minh công thức. Với số thập phân trong ô nhập toán, dùng dấu chấm.
- **Thư viện ký hiệu:** mở từ **Ω Ký hiệu & công thức** trên thanh chế độ xem hoặc
  **Ω Chèn vào ô** trong khối bảng; khung **Thư viện ký hiệu và công thức** cho tìm
  hoặc chọn theo nhóm. Ký hiệu được chèn tại con trỏ. Khi con trỏ nằm trong ô bảng,
  mẫu công thức được bọc thành công thức nội dòng để bảng hiển thị và lưu đúng.
- **Bảng:** nhập từng ô, thêm/bớt hàng/cột hoặc dán vùng ô từ Excel. Hàng đầu là
  tiêu đề; giới hạn trình soạn là 200 hàng × 60 cột. **Enter** xuống dòng trong ô,
  **Tab** chuyển sang ô tiếp theo. Dán văn bản nhiều dòng giữ nguyên trong ô;
  dán vùng Excel giữ các hàng/cột và cả xuống dòng bên trong ô có dấu ngoặc kép.
  Dấu `/` trong ô chỉ là ký tự thường và nội dung được lưu đúng như gõ; muốn phân số
  thật, dùng **Ω Chèn vào ô** → **Phân số (chia phần)**. Khi đó ô lưu LaTeX
  `$\frac{…}{…}$` và hiện tử/mẫu ở phần xem trước ngay dưới ô. Xuống dòng lưu bằng
  `<br>` trong bảng Markdown; mở lại vẫn có đủ các dòng. Gộp ô bằng cách bấm một ô,
  giữ **Shift** và bấm ô cuối để chọn vùng rồi bấm **⧉ Gộp ô** hoặc **Ctrl+G**; bấm
  vào ô gộp, hoặc chọn vùng chứa ô gộp, rồi bấm **⧈ Tách ô** hoặc **Ctrl+T** để tách.
  Thêm hàng hoặc cột bằng **＋ Hàng** / **＋ Cột**, hoặc ngay trong lúc gõ bằng **Alt+H**
  (thêm hàng cuối) và **Alt+C** (thêm cột cuối); hàng mới rỗng và đủ số cột hiện có. Khi
  bảng đã đủ 200 hàng hoặc 60 cột, trình soạn báo rõ giới hạn thay vì thêm im lặng. Phím
  tắt chỉ áp dụng khi con trỏ đang ở trong ô bảng; ở ô công thức, Markdown/LaTeX nguồn hay
  ô tên tài liệu, phím vẫn hoạt động bình thường.
  Ô gộp được giữ khi lưu và mở lại; mỗi lần gộp, tách, thêm hoặc bớt hàng/cột đều **Hoàn tác** được.
  Nội dung vượt giới hạn vẫn được giữ trong tab nguồn.
- **Bản trình bày:** kiểm tra nội dung trước khi lưu. Có hoàn tác thay đổi nội dung;
  đóng khi chưa lưu sẽ yêu cầu xác nhận. Khi lưu lỗi, bản nháp vẫn được giữ.

Khi trình soạn có nội dung, **Lưu và nhập vào kho** tạo tài liệu `.md` mới qua pipeline nhập liệu hiện có,
trong phạm vi nguồn đang chọn. Chờ job hoàn tất rồi tải lại danh sách/cây.
Công thức vẫn phải qua chính sách kiểm duyệt; hiển thị đẹp không có nghĩa đã
VERIFIED. Không gọi model AI để tự viết lại dữ kiện của người dùng.

Đoạn đã trích xuất trong cây là **chỉ đọc**, không sửa trực tiếp SQLite/vector.
Muốn chỉnh dữ liệu mặc định cũ: **Quản lý dữ liệu → Chỉnh sửa → Soạn trực quan**,
bấm **Áp dụng vào bản nháp**, sau đó **Lưu thay đổi**. Cách lưu riêng các điều chỉnh
và khôi phục DOCX gốc được giữ như trước.

Các bảng mới nhập/tạo lại chỉ mục được chia ở ranh giới hàng, giữ công thức trong
ô và lặp tiêu đề ở phần tiếp theo. Việc đổi tên/loại/ghi chú quản lý chỉ lưu cây;
việc đổi **Nội dung dữ liệu** mới tạo job cập nhật chỉ mục.
Nếu đoạn cũ đã bị cắt mất cấu trúc bảng ở lần nhập trước, cần tạo lại chỉ mục từ
tài liệu gốc; giao diện không đoán hoặc bổ sung các ô bị thiếu.
