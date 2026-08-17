# Coachio Video Flow

**Coachio Video Flow** là tiện ích mở rộng cho Chrome, giúp tự động hóa quy
trình tạo video hàng loạt trên Google Flow AI (Veo). Tiện ích hỗ trợ quản lý
hàng đợi, gửi prompt, tải ảnh tham chiếu và tự động lưu video đã tạo.

## Tính năng chính

- Xử lý hàng loạt prompt văn bản hoặc ảnh kèm prompt.
- Quản lý hàng đợi, tạm dừng, tiếp tục và thử lại tác vụ lỗi.
- Tự động tải video về thư mục riêng của từng công việc hoặc hiện hộp thoại
  **Save As** cho mỗi video.
- Hỗ trợ Text-to-Video và Image-to-Video.
- Hỗ trợ First frame, ghép chuỗi First + Last frame và ghép ảnh theo từng cặp.
- Tùy chỉnh tỷ lệ khung hình, model, số kết quả và nhịp chạy.
- Giao diện side panel gồm bốn khu vực: Tạo, Hàng đợi, Nhật ký và Cài đặt.
- Hỗ trợ giao diện tiếng Việt và tiếng Anh.

## Tương thích giao diện Flow 8.5.0

- Hỗ trợ trình soạn thảo prompt Slate hiện tại thay cho giao diện `textarea` cũ.
- Hỗ trợ Frames, Omni Flash, Veo 3.1 Lite/Fast/Quality, tỷ lệ 9:16 và 16:9,
  cùng 1–4 kết quả cho mỗi lần tạo.
- Áp dụng cấu hình theo model: Omni Flash cho phép chọn 4 hoặc 6 giây; thời
  lượng của Veo 3.1 Lite/Fast/Quality do Flow quản lý.
- Hỗ trợ cả nhãn số lượng kết quả mới `x1`/`x2`/`x3`/`x4` và nhãn cũ
  `1x`/`2x`/`3x`/`4x` khi Google triển khai giao diện theo từng đợt.
- Gán ảnh trực tiếp vào file input ẩn đã được Flow mount, không bấm mục Upload
  hiển thị trên màn hình, nhờ đó không mở nhầm hộp chọn file của hệ điều hành.
- Xử lý dự án mới đang mở ở chế độ Image/Nano Banana, tự chuyển sang
  Video/Frames rồi mới áp dụng model đã lưu.
- Mỗi ảnh đã chọn có một hàng prompt có thể chỉnh sửa, thay ảnh hoặc xóa ảnh.
  Khi xóa, số lượng ảnh, prompt còn lại và bố cục First/Last frame được đồng bộ.
- Mỗi ảnh chỉ được gửi lên một lần. Tiện ích chờ tối đa 120 giây đối với file
  lớn thay vì gửi lại trong khoảng Flow chưa phản hồi và tạo ảnh trùng.
- Không coi thẻ `Failed` cũ của kết quả trước là lỗi của lần tải ảnh hiện tại.
  Lỗi upload phải gắn với đúng tên file mới được phép kích hoạt thử lại.
- Xác nhận First frame bằng thao tác **Add to Prompt** bắt buộc của Flow trước
  khi điền prompt và bấm tạo.
- Theo dõi video tối đa 8 phút và nhận diện kết quả bằng `data-tile-id` ổn định.
- Tải `currentSrc` của phần tử `<video>` trong đúng thẻ kết quả, tránh thao tác
  menu mô phỏng có thể bị Chrome từ chối.
- Quét nhanh mỗi 500 ms khi đang chạy và bắt đầu tải ngay khi thẻ mới có URL
  video thật; không chờ video tải đủ dữ liệu đệm.
- Kiểm tra URL ở cả trang Flow và background worker; URL thumbnail không bao
  giờ được xem là video hoàn tất.
- Nhật ký chẩn đoán có thể sao chép toàn bộ, gồm thông tin extension, dự án và
  chi tiết từng tác vụ lỗi.

## Yêu cầu

- Google Chrome hoặc trình duyệt Chromium có hỗ trợ Manifest V3 và Side Panel.
- Tài khoản đã đăng nhập tại [Google Flow](https://labs.google/fx/tools/flow/).
- Thư mục mã nguồn của extension đã được giải nén đầy đủ.

## Cài đặt trên Chrome bằng Chế độ dành cho nhà phát triển

### 1. Tải mã nguồn

Tải repository dưới dạng ZIP từ GitHub rồi giải nén, hoặc clone bằng Git:

```bash
git clone https://github.com/sonlovinbot/google-auto-flow-video.git
cd google-auto-flow-video
```

Thư mục được chọn ở bước cài đặt phải chứa trực tiếp file `manifest.json`.
Không chọn file ZIP và không chọn thư mục cha bên ngoài repository.

### 2. Bật Chế độ dành cho nhà phát triển

1. Mở Chrome.
2. Nhập `chrome://extensions/` vào thanh địa chỉ rồi nhấn Enter.
3. Bật **Chế độ dành cho nhà phát triển** (**Developer mode**) ở góc trên bên
   phải trang Tiện ích.

### 3. Nạp extension

1. Bấm **Tải tiện ích đã giải nén** (**Load unpacked**).
2. Chọn thư mục `google-auto-flow-video` vừa clone hoặc giải nén — đây là thư
   mục chứa `manifest.json`.
3. Xác nhận thẻ **Coachio Video Flow** xuất hiện và không báo lỗi.

### 4. Ghim biểu tượng và mở tiện ích

1. Bấm biểu tượng mảnh ghép **Tiện ích** trên thanh công cụ Chrome.
2. Bấm biểu tượng ghim bên cạnh **Coachio Video Flow**.
3. Mở Google Flow và đăng nhập.
4. Bấm biểu tượng **Coachio Video Flow** để mở side panel.

### Cập nhật lên phiên bản mới

Nếu cài bằng Git, chạy trong thư mục extension:

```bash
git pull
```

Nếu tải ZIP, tải bản mới và giải nén đè hoặc thay thư mục cũ. Sau đó:

1. Mở `chrome://extensions/`.
2. Tìm **Coachio Video Flow**.
3. Bấm nút **Tải lại** (**Reload**).
4. Tải lại tab Google Flow đang mở.

Chrome giữ dữ liệu cài đặt trong bộ nhớ extension khi bấm **Reload**. Nếu xóa
extension rồi cài lại, dữ liệu cục bộ có thể không còn.

## Cách sử dụng

1. Mở một dự án trong Google Flow.
2. Bấm biểu tượng extension để mở side panel.
3. Chọn chế độ:
   - **Văn bản thành video:** nhập mỗi prompt trên một dòng hoặc phân cách các
     prompt nhiều dòng bằng một dòng trống.
   - **Ảnh thành video:** chọn ảnh, kiểm tra thứ tự và nhập prompt tương ứng.
4. Chọn model, tỷ lệ khung hình, số kết quả và các thiết lập tải xuống.
5. Bấm **Thêm vào hàng đợi**.
6. Kiểm tra danh sách tác vụ trong tab **Hàng đợi**.
7. Bấm **Bắt đầu hàng đợi** và giữ tab Google Flow mở trong khi tiện ích chạy.
8. Theo dõi tiến trình trong tab **Nhật ký**. Nếu có lỗi, sao chép báo cáo đầy
   đủ trước khi thử lại.

## Chế độ First frame và Last frame

Image-to-Video có ba cách ghép ảnh:

| Chế độ | Cách ghép | 20 ảnh tạo ra | Mức sử dụng ảnh |
|---|---|---:|---|
| **First frame** | Mỗi ảnh tạo một video | 20 video | Mỗi ảnh một lần |
| **Ghép chuỗi** | 1→2, 2→3, 3→4… | 19 video | Ảnh ở giữa dùng hai lần |
| **Ghép cặp** | 1→2, 3→4, 5→6… | 10 video | Mỗi ảnh một lần |

Trong hai chế độ có Last frame, dải ảnh được hiển thị như một cuộn phim và
prompt chuyển động nằm giữa hai ảnh. Có thể dùng nút mũi tên để đổi thứ tự ảnh;
prompt vẫn giữ nguyên vị trí để người dùng nhìn thấy ngay quan hệ ghép mới.

Quy tắc prompt giống nhau ở mọi chế độ: một prompt có thể dùng chung cho tất cả
video; nếu không, cần nhập đúng một prompt cho mỗi video. Thiếu prompt sẽ chặn
công việc, còn prompt thừa sẽ được báo thay vì âm thầm bỏ qua.

Trong chế độ ghép chuỗi, ảnh ở giữa chỉ được upload lên Flow một lần dù được sử
dụng cho hai video. Công việc được lưu từ trước khi tính năng này tồn tại vẫn
chạy theo chế độ First frame.

## Xử lý sự cố cài đặt

### Chrome báo không tìm thấy manifest

Bạn đang chọn sai thư mục. Hãy chọn đúng thư mục có file `manifest.json` nằm
trực tiếp bên trong.

### Bấm biểu tượng nhưng side panel không mở

- Kiểm tra extension đang được bật tại `chrome://extensions/`.
- Tải lại extension rồi tải lại tab Google Flow.
- Mở đúng trang `https://labs.google/...`; extension chỉ có quyền trên miền này.

### Extension không tìm thấy nút hoặc khung nhập trên Flow

Google có thể đã thay đổi giao diện. Mở tab **Nhật ký**, sao chép báo cáo chẩn
đoán và kiểm tra phần cấu hình selector bên dưới.

## Khi Google thay đổi giao diện Flow

Tiện ích điều khiển Flow bằng XPath và các nhãn hiển thị. Các giá trị này nằm
trong [`flow-selectors.json`](flow-selectors.json). Khi Google thay đổi giao
diện, có thể sửa file này rồi bấm **Reload** cho extension.

Để ghi đè một vài selector mà không sửa file, mở DevTools của side panel và
chạy, ví dụ:

```js
chrome.storage.local.set({
  selectorOverride: { FRAME_TRIGGER_END_TEXT: "Jump to" },
});
```

Giá trị ghi đè được trộn với cấu hình có sẵn nên chỉ cần khai báo khóa muốn
thay đổi. Giá trị rỗng hoặc không phải chuỗi sẽ bị bỏ qua. Xóa cấu hình ghi đè:

```js
chrome.storage.local.remove("selectorOverride");
```

Nếu thao tác gắn Last frame báo `LAST_FRAME_TRIGGER_MISSING`, nhãn mà bản hiện
tại mong đợi (`End`) không khớp với giao diện Flow. Bản ghi lỗi sẽ liệt kê các
nhãn tìm thấy; hãy đặt `FRAME_TRIGGER_END_TEXT` thành nhãn tương ứng.

## Phát triển và kiểm thử

Yêu cầu Node.js. Chạy toàn bộ test:

```bash
npm test
```

Bộ test bao phủ xử lý prompt, ghép ảnh, First/Last frame, sắp xếp và xóa ảnh,
kiểm tra đường dẫn tải xuống, nhận diện video, phục hồi background worker,
selector Flow và tính đầy đủ của bản dịch.

Lưu ý dành cho người phát triển:

- Chuỗi hiển thị cho người dùng phải nằm trong `i18n.js`. Test sẽ thất bại nếu
  module side panel hard-code tiếng Việt hoặc có khóa dịch không được sử dụng.
- Hàm trong `injector.js` được serialize vào MAIN world của trang Flow nên không
  thể gọi `i18n()`. Trace của các hàm này là thông tin chẩn đoán dành cho lập
  trình viên và được giữ bằng tiếng Anh.
- Background service worker của Manifest V3 không giữ trạng thái quan trọng
  trong biến module. Trạng thái bắt download được lưu trong
  `chrome.storage.session` để chịu được việc worker bị Chrome dừng khi rảnh.

## Giấy phép

Xem [LICENSE.md](LICENSE.md).
