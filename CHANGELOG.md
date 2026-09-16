# Changelog

Ghi lại các bản phát hành code; trạng thái triển khai được ghi trong từng entry.
Entry mới nhất luôn ở đầu file, cập nhật theo quy trình commit/SERVER trong `CLAUDE.md`.

## V1.0.0.65 — 2026-09-17

- Vá dependency npm và runtime Docker; backend/frontend qua gate High với bằng chứng cho bản vá zlib.
- Giữ render phụ đề, media và scanner trên runtime mới; nâng dependency AI speech và kiểm lại runtime cũ trước sử dụng.
- Chuẩn bị bridge bảo trì và pilot agent; rollout gói Windows ký số vẫn tạm dừng.

## V1.0.0.64 — 2026-09-16

**Chuẩn bị phát hành, chưa đồng bộ server:** Agent có bản cầu nối sang gói
cập nhật ký số, kiểm toàn vẹn/phiên bản và rollout theo danh sách máy. Giữ
dữ liệu local, chờ job kết thúc và tự quay lại runtime trước nếu pairing lỗi.
Token Windows dùng DPAPI; source được đóng gói/làm rối, không hứa chống
admin giải ngược. Media/AI vẫn chạy tại máy user.

Cần làm: đồng bộ server tương thích ở bước cuối, kiểm health, đưa gói đã ký
vào thư mục release và chỉ bật cohort pilot đã chọn. Chưa tự publish public
hoặc thay đổi máy user.

## V1.0.0.63 — 2026-09-16

**Giao diện**: tất cả node trên Flow giờ có lịch sử sửa cấu hình riêng, hỗ
trợ Ctrl+Z/Ctrl+Shift+Z (tối đa 50 bước/node trong phiên).

**Resize & Upload V3/V3.1/V3.2**: Kiểm tra Input có icon đổi tên/xóa/di
chuyển từng folder/asset thật (sửa trực tiếp trên máy, có Undo phục hồi
filesystem trước khi đổi lại config/cursor) và icon làm mới. V3.2 tải danh
sách tab báo cáo qua Google API/Apps Script.

Cần làm: deploy lại bundle Google Apps Script (nodes/resize-upload-v3-2) để
có action tabs cho báo cáo V3.2.

## V1.0.0.62 — 2026-09-16

**Giao diện**: các bảng nổi khi mở (menu chuột phải, palette thêm node, panel
cấu hình node, log chạy, Settings, thư viện Workflow) giờ có hiệu ứng xuất
hiện nhẹ (140–220 ms) thay vì bật tức thì. Nút trên thanh công cụ có phản hồi
hover/nhấn/focus bàn phím rõ hơn. Tự tắt hiệu ứng nếu hệ điều hành đang bật
"giảm chuyển động"; không ảnh hưởng node/dây nối/kéo thả trên canvas.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.61 — 2026-09-16

**Resize & Upload V3/V3.1/V3.2**: dòng/nhánh tải Drive lỗi giờ có nền đỏ và
thông báo trên canvas, lấy theo nguồn Drive đang dùng — xóa nguồn hoặc tải
lại thành công thì tự bỏ đánh dấu. Kết quả output được giữ lại theo trình
duyệt sau khi reload/mở lại tab/chạy node khác (chạy lại node thì xóa kết
quả cũ). Thêm bút đổi/gộp Theme theo nhóm hoặc từng video ngay trong Kiểm
tra Input. Thêm icon mở nhanh thư mục tải/nguồn/vị trí video; Kiểm tra Input
và Nhận diện V3.2 tự quét lại mỗi 3 giây khi đang mở.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.60 — 2026-09-16

**Resize & Upload V3/V3.1/V3.2**: khi chạy từ trình duyệt (nối dây), link
Google Drive ở Input giờ chỉ tải xuống lúc bấm Run thay vì phải tải trước —
tránh giữ dữ liệu tải sẵn không dùng tới. Nếu tải lỗi, node dừng lại cho thử
lại hoặc tải tay, rồi cần bấm "Xác nhận chạy tiếp" mới gửi lượt render. Bấm
STOP trong lúc đang chuẩn bị sẽ hủy, không gửi render dở dang.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.59 — 2026-09-15

**Resize & Upload V3/V3.1/V3.2**: thêm ô AddOn (checkbox + văn bản) sau
Datetime trên từng dòng/nhánh. Khi bật và có nội dung, văn bản được chèn sau
Language và trước phần size/duration/date trong tên video và thumbnail; áp
dụng cho cả 3 bản và cả chế độ bảng lẫn nối dây. Tắt hoặc để trống giữ nguyên
tên file như cũ.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.58 — 2026-09-15

**Resize & Upload V3**: thêm ô nhập Link Google Drive tại Input — tải folder
Drive công khai ("bất kỳ ai có liên kết") đệ quy về máy chạy node bằng gdown,
có tiến độ, tự thử lại tối đa 3 lần khi Google lỗi tạm thời, kiểm tra video
bằng FFprobe trước khi nhận folder, và cảnh báo rõ khi thiếu quyền truy cập
hoặc cần bổ sung file bằng đường dẫn thủ công. Kết quả hiển thị gọn hơn: ẩn
thumbnail khỏi danh sách, tự thêm vùng cuộn khi trên 10 mục.

**Resize & Upload V3/V3.1/V3.2**: nhận diện tên asset đầy đủ/thiếu App tốt
hơn — bỏ đuôi thừa sau mã ngôn ngữ, giữ nguyên Theme/Label/ENxEN, và luôn gán
mã App/nền tảng đầu ra theo App đang chạy trên node (không theo mã App đọc
được từ tên file nguồn).

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.57 — 2026-09-15

**Resize & Upload V3/V3.1/V3.2**: nhận diện Theme từ file input đặt phẳng
(không có cấu trúc thư mục con) — cả tên đầy đủ lẫn tên đánh số/label — bên
cạnh luồng nguồn có cấu trúc cũ vẫn giữ nguyên. Các file cùng Theme/folder có
một ngôn ngữ sẽ kế thừa ngôn ngữ đó; nhóm không có mã ngôn ngữ mặc định EN.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.56 — 2026-09-14

**Resize & Upload V3.2**: thêm tùy chọn chọn dòng báo cáo thủ công cho các
job trùng Theme/PIC (không có thông tin phân biệt) — sau khi xem trước, tick
đúng ô M cần ghi, không tự đoán. Thêm bước đọc label từ Sheet (chỉ đọc) để
ghép thứ tự Input với dòng Sheet theo tên/label thật, có xem trước/chọn
dòng/sửa tay trước khi render, tách biệt hoàn toàn khỏi luồng ghi. Sửa lỗi
parser Sheet bỏ sót label hợp lệ khi cột App chứa giá trị ngoài danh mục đã
biết (vd. `ChatI1`) — giờ coi App là metadata, không dùng để loại bỏ dòng.

Cần làm: nếu dùng báo cáo qua Google Apps Script, vào Extensions > Apps
Script trong Sheet, dán lại `nodes/resize-upload-v3-2/google-apps-script.js`
mới nhất và **Deploy > New version** — bản deployment cũ không hỗ trợ đọc
label (protocol 3) hoặc ghi thủ công (protocol 2).

## V1.0.0.55 — 2026-09-14

**Sửa lỗi Run node**: Run/Run-from-here trên một nhánh không còn phát start
event hay gửi payload cho toàn bộ canvas nữa — cả đường chạy local lẫn agent
giờ dùng chung logic thu hẹp phạm vi (ancestors + descendants), node rời và
nhánh anh em không liên quan không còn bị kéo vào lượt chạy hay bị đẩy sang
agent một cách bất ngờ.

**Resize & Upload V3.2**: credential Google Apps Script giờ chấp nhận cả URL
Workspace dạng `.../a/macros/<domain>/s/.../exec` bên cạnh dạng chuẩn — trước
đây bị validator từ chối trước khi gọi mạng.

**Dev launcher (local, không ảnh hưởng production)**: `dev.ps1`/`dev.bat`
giờ tự đăng nhập Local Dev và chỉ lắng nghe trên `127.0.0.1`, không còn phụ
thuộc cờ `DEV_LOGIN_ENABLED` viết tay trong `.env`.

Cần làm: không có — các thay đổi không yêu cầu thao tác thủ công.

## V1.0.0.54 — 2026-09-14

**Resize & Upload V3.2**: viết lại hướng dẫn thiết lập Apps Script thành 7
bước cụ thể (chuẩn bị Gmail/Sheet, dán code, Script Properties, cấp quyền +
deploy, lưu credential, điền cấu hình node, test và ghi thật), thêm mục xử
lý lỗi/cập nhật deployment. Tách hướng dẫn trong node ra component riêng
`ResizeUploadV32AppsScriptGuide.jsx`. Chỉ sửa nội dung hướng dẫn — không đổi
provider, quyền hay logic ghi.

Cần làm: không có — chỉ là cập nhật tài liệu/hướng dẫn hiển thị trong node.

## V1.0.0.53 — 2026-09-14

**Resize & Upload V3.2**: thêm Google Apps Script làm phương thức báo cáo
thay thế bên cạnh Google Sheets API (vẫn mặc định) — chọn qua config
`sheet_report_provider`, dùng chung planner/validator giữa hai provider.
Thêm loại credential "Google Apps Script" (URL web app + secret key), route
tải script bundle đầy đủ để dán vào Apps Script, và test readiness/contract
cho nhánh Apps Script.

Cần làm: chọn provider muốn dùng rồi thiết lập kết nối tương ứng theo hướng
dẫn trong node (API: OAuth Google có sẵn; Apps Script: deploy script tải về
làm web app rồi lưu URL + secret vào credential). Quick 30 + integration 94
test đạt local; contract 19/19, browser 5/5. Agent triển khai thật, Docker,
và consent/ghi Google thật (cả hai provider) chưa được kiểm chứng (xem
[docs/stories/resize-v32-apps-script/validation.md](docs/stories/resize-v32-apps-script/validation.md)).

## V1.0.0.52 — 2026-09-14

**Resize & Upload V3.2**: thêm node mới `resize-upload-v3-2` với nhận diện
profile/SubID linh hoạt hơn (thoại × chữ), sửa/bỏ chọn và nối nhóm → Asana →
nền tảng/checkbox. Thay Google Apps Script bằng Google Sheets API dùng
chung: điền path output `G:/...` theo Detail + PIC Editor vào cột Link Cloud,
giữ nguyên OS/ô có dữ liệu/công thức/vùng bảo vệ. Thêm mục kết nối Google
trong Settings/Node — credential riêng tư hoặc admin tạo public rồi cấp
quyền cho user. V3 và V3.1 giữ nguyên không đổi.

Cần làm: admin cấu hình Google OAuth client trên server một lần (xem
`.env.example`), kết nối Gmail chung và cấp quyền credential + node V3.2 cho
user; restart backend và tải lại frontend để dùng bản mới. Quick 30 +
integration 91 test đạt local; contract mới 18/18, browser 3/3, Python V3.2
14/14; native tạo 27 MP4 + 21 JPG và kiểm nguồn/kích thước. Agent triển khai
thật, Docker, và consent/ghi Google Sheets thật chưa được kiểm chứng (xem
[docs/stories/resize-v32-google-api/validation.md](docs/stories/resize-v32-google-api/validation.md)).

## V1.0.0.51 — 2026-09-14

**Resize & Upload V3.1**: thêm node mới `resize-upload-v3-1`, biến thể riêng
của V3 với giao diện nối dây nội bộ ba cột Folder → nhánh Asana/cấu hình →
nền tảng (kéo hoặc bấm để nối, chọn nhiều folder, gỡ dây, checkbox riêng
từng nhánh, giữ nguyên dây sau khi tải lại). Dùng chung catalog/codec với V3;
không sửa file riêng của V3.

Cần làm: restart backend và tải lại frontend để dùng bản mới. Quick +
integration test đã đạt local (Python V3.1 9/9, V3 19/19; browser V3.1 3/3,
V3 14/14); test native đã tạo 57 MP4 + 48 JPG và kiểm hash nguồn. Workload
Linux/remote-agent/live provider/Docker thật chưa được kiểm chứng (xem
[docs/stories/resize-upload-v3-1/validation.md](docs/stories/resize-upload-v3-1/validation.md)).

## V1.0.0.50 — 2026-09-11

**Analytics Dashboard**: thêm bộ analytics sản phẩm — bốn tab trong Admin
Console, theo dõi semantic/presence trên trình duyệt, job facts theo giao
dịch, số lần chạy thực tế (actual attempts), và sampler tài nguyên
Windows/Linux được relay qua kết nối Agent.

Cần làm: restart backend và tải lại frontend để dùng bản mới; Agent cần
chạy cùng bản code mới để relay đúng dữ liệu resource sampler. Quick/
integration/E2E test đã đạt local, nhưng workload Linux/remote thật và
overhead dài hạn chưa được kiểm chứng (xem
[docs/stories/analytics-dashboard/validation.md](docs/stories/analytics-dashboard/validation.md)).

## V1.0.0.49 — 2026-09-11

**Reload (F5) không còn mất tiến độ run đang chạy**: canvas lưu run/idempotency
key theo tài khoản và tự nối lại tiến độ, log, kết quả sau khi tải lại trang —
kể cả run đã chạy xong trong lúc đóng tab. Direct Resize V1/V2/V3 giờ dùng
chung durable workflow với các node thường. STOP trên 1 node chỉ huỷ run chứa
node đó; STOP trên toolbar huỷ toàn bộ run trình duyệt đang theo dõi cho tài
khoản. Wait giờ nhận được lệnh huỷ; tiến trình Python (FFmpeg) bị dừng cả
process tree thay vì chỉ tiến trình cha. Sửa lỗi custom/saved node hiện tạm
150px trước khi load xong manifest.

Cần làm: Server và Agent phải cùng chạy code executor mới để nhận đúng
mode/huỷ run — deploy đồng bộ cả hai phía. Tính năng đã test kỹ trên luồng
trình duyệt + V3 thật qua F5, nhưng full-integration test và remote-agent/
Linux chưa được kiểm chứng đầy đủ (xem
[docs/stories/node-run-reload/validation.md](docs/stories/node-run-reload/validation.md)).

## V1.0.0.48 — 2026-09-11

**Resize & Upload V3 (sửa kẹt "Đang xử lý")**: khi Agent trả lỗi HTTP hoặc
đóng kết nối SSE giữa chừng, node không còn treo mãi ở trạng thái "running"
mà báo lỗi rõ ràng ngay trên node. Bắt buộc chọn Output Folder trước khi
chạy resize/upload thật (cả frontend lẫn backend), tránh chạy xong không
biết lưu vào đâu.

Cần làm: tải lại trang; nếu dùng chế độ thật (không test), mở Cài đặt V3
(nút bánh răng trên node) và chọn Output Folder trước khi bấm chạy.

## V1.0.0.47 — 2026-09-11

**Thông báo phiên bản (chuông góc trên-phải)**: ghi chú chi tiết/changelog
chỉ hiện với admin (bản contributor chạy local luôn đăng nhập với role
admin nên cũng thấy được); user thường chỉ thấy số phiên bản cần cập nhật
kèm nút "Cập nhật Agent" như trước. Nút này giờ tự khoá và đổi thành
"Đã cập nhật" khi agent đã ở đúng bản mới nhất.

Cần làm: tải lại trang để thấy hành vi mới của chuông thông báo.

## V1.0.0.46 — 2026-09-11

**Creative Assistant (bản đầu)**: thêm luồng `/video?assistant` — nhập
script/draft, gắn asset, căn hook theo lời đọc bằng speech alignment cục bộ,
dựng timeline native đủ lớp (logo/subtitle/text/SFX/music) và xuất MP4.
Sửa kèm lỗi làm tràn khung hình khi tổng thời lượng transition lệch số thực
(floating-point) trong renderPlanner.

Cần làm: tải lại trang để thấy nút "Creative Assistant" trên `/video`.

## V1.0.0.45 — 2026-09-11

**Playable Ads dưới 5 MB**: node tự nén video lớn bằng H.264 hai lượt,
tính bitrate theo thời lượng và phần dung lượng HTML còn lại. Tái dùng video
đã nén cho các network/Android/iOS, giữ nguyên video nguồn và cấu hình tương tác.
Kiểm tra từng HTML dưới 5.000.000 byte; tự thử lại có giới hạn và báo lỗi nếu
không đạt, dọn file tạm khi hoàn tất hoặc hủy. Video đã đủ nhỏ giữ nguyên chất lượng.

Cần làm: trên máy chạy local node, vào Settings > Agent bấm Cập nhật và khởi động
lại Agent để nhận bản nén mới; máy cần FFmpeg/ffprobe khi xử lý video lớn.

## V1.0.0.44 — 2026-09-11

**SERVER — Admin Console và công cụ đóng góp**: đồng bộ code mới nhất từ repo
lên production trên PC-14191. Bổ sung các trang Đóng góp, Node/Flow, Người dùng
và Vận hành, quy trình kiểm tra/test thử PR và gói contributor có rules/skills.
Đóng gói đầy đủ console, contributor-kit và schema khi triển khai.

Ghi nhận đúng máy SERVER và dùng số phiên bản mới để phân biệt hai bản V1.0.0.43.
Cần làm: tải lại trang để nhận giao diện mới; owner tự Test thử/Chấp nhận PR mẫu.

## V1.0.0.43 — 2026-09-11

**Admin Console và đóng góp của thành viên**: thêm các trang Đóng góp,
Node/Flow, Người dùng và Vận hành với dữ liệu thật và kiểm soát quyền.
Owner có thể Kiểm tra, Đọc báo cáo, Test thử và Chấp nhận đúng bản PR;
các bản thử chạy cách ly, phát hành vẫn có bước kiểm soát riêng.

Gói contributor có rules/skills đã lọc và công cụ Harness/Codegraph cục bộ.
Console cảnh báo PR có thể trùng mục tiêu hoặc cùng file; hướng dẫn draw.io
có thêm 14 trang cho người mới. Sửa kiểm tra Video và hoàn thiện đóng gói
console/kit/schema, loại dữ liệu riêng của owner khỏi Docker context.

Trạng thái: phát hành code và product; chưa deploy/restart production vì
server nằm trên máy khác. Cần làm: triển khai bản mới trên máy server khi
sẵn sàng; owner vẫn tự Test thử/Chấp nhận PR mẫu trước các bước phát hành PR.

## V1.0.0.43 — 2026-09-10

**Specs**: thêm spec `team-contribution-and-release` — đánh giá hiện trạng và
đề xuất lean cho quy trình teammate phát triển UI/node/backend, tự test, gửi
admin duyệt, và phát hành server/product/agent theo candidate có khả năng
khôi phục. Chưa có thay đổi code chạy được (tài liệu kế hoạch).

## V1.0.0.42 — 2026-09-10

**Resize & Upload V3 (follow-up)**: admin có thể xóa hẳn một App khỏi thư
viện chung, kèm hộp thoại xác nhận ghi rõ tên App và ảnh hưởng (cấu hình
chung/workflow đang dùng App đó). App mẫu đi kèm bị xóa sẽ không tự xuất
hiện lại sau khi reload. Bản riêng của từng người và file video/thumbnail
không bị xóa.

## V1.0.0.41 — 2026-09-10

**Resize & Upload V3 (follow-up)**: thư viện App/Platform dùng chung tự làm
mới khi mở lại node — focus lại tab, đổi tài khoản, hoặc mỗi 15 giây trong
lúc trang đang hiện — thay vì chỉ đọc một lần lúc tạo node, nên admin sửa
thư viện chung không cần các thành viên khác reload trang mới thấy. Vùng
kéo thả folder Theme có viền highlight khi kéo file vào và báo lỗi rõ ràng
nếu không lấy được đường dẫn (thay vì im lặng bỏ qua).

## V1.0.0.40 — 2026-09-10

**Resize & Upload V3**: node mới cho batch resize/upload, đứng cạnh V1/V2
(giữ nguyên, không đổi). Nhập Theme → ngôn ngữ → video; label chuẩn tự cấp
lại "G" khi sai định dạng hoặc trùng; cảnh báo và yêu cầu xác nhận khi một
nhóm có dưới 5 video. App có thể thêm/đặt tên/xóa, mỗi App có danh sách nền
tảng riêng — droplist nền tảng lọc theo App đang chọn. Thư viện chuẩn dùng
chung cho cả server; phần ghi đè riêng chỉ owner tạo mới thấy và dùng được.
Video copy đúng theo `<đích>/YYMM/YYMMDD/Theme_Code_Language`, thumbnail JPG
copy thẳng vào đích; tạo xong nhóm mới rồi mới xóa đúng nhóm cũ, không quét
lại toàn bộ folder output chung.

## V1.0.0.39 — 2026-09-10

**Batch Creative Lab**: Thêm tám transition BCL native (Mix + bảy mẫu) được
clone từ resource CapCut có kiểm checksum/hash, giữ nguyên clip/source/timing
và phiên CapCut đang chạy. Node Local Speech giờ tự cài runtime (faster-whisper/
Resemblyzer/Seed-VC) ở lần dùng đầu tiên — tự chọn CPU/CUDA, có tiến độ/hủy/
retry, không cần chạy lệnh setup thủ công trước nữa. Phụ đề (caption) có chọn
font hệ thống/Favourite, cỡ chữ, 20 preset kiểu, 9 vị trí, tự chia tối đa hai
dòng theo chiều rộng canvas; áp dụng theo nhóm hoặc toàn bộ track chưa khóa,
có undo/redo và lưu qua server.

## V1.0.0.38 — 2026-09-10

**Batch Creative Lab**: Render CapCut giờ dựng toàn bộ danh sách timeline đã
chọn trong **một** phiên CapCut native duy nhất thay vì mở lại ứng dụng cho
mỗi output — giữ nguyên hành vi khi chỉ chọn 1 timeline. Thêm annotation
giọng nói/phụ đề ở cấp nguồn (faster-whisper + Resemblyzer + Seed-VC, chạy
local): cắt/dịch mốc thời gian theo từng lần xuất hiện trong output, tách
audio đã chuyển giọng thành track riêng, không lặp lại nhận dạng cho mỗi
biến thể. Sửa lỗi hai dòng phụ đề đè lên nhau khi tự động xuống dòng (dùng
chiều cao dòng cố định thay vì đo theo từng dòng).

Cần làm: máy agent chạy Render CapCut cần chạy `npm run setup:speech` để cài
faster-whisper/Resemblyzer/Seed-VC cục bộ trước khi dùng tính năng annotation
giọng nói mới.

## V1.0.0.37 — 2026-09-10

**Agent tray**: icon SF chữ được thay bằng ảnh do user chọn
(`ref-item/icon/5.webp`), đóng gói thành ICO đa kích thước (16/24/32/48/64px)
và nhúng thẳng vào script cài đặt — không phụ thuộc thư mục `ref-item` lúc
chạy.

Cần làm: máy agent cần cài lại (chạy setup) để nhận icon mới.

## V1.0.0.36 — 2026-09-10

**Agent tray**: icon khay hệ thống giờ hiển thị biểu tượng SF riêng thay vì
mượn icon của node.exe. Chống mở trùng nhiều tray cho cùng một bản cài đặt
(mutex theo đường dẫn cài đặt). Menu vẫn dùng được kể cả khi Node không khởi
động nổi — hiển thị trạng thái lỗi, cho xem log lỗi và thử khởi động lại.
Cài đặt/cài lại giờ bật tray trước rồi mới khởi động backend, và tự thay
helper tray cũ (không có mutex) đang chạy ngầm từ lần cài trước.

Cần làm: máy agent cần cài lại (chạy setup) để nhận helper tray mới; sau đó
đăng nhập lại Windows để xác nhận tray tự chạy đúng.

## V1.0.0.35 — 2026-09-09

**Batch Creative Lab**: tách track ảnh/video theo đúng loại nguồn, giữ nguyên
lane/layer khi lọc. "Convert to CapCut project" giờ dùng draft generic, bỏ
bước chọn phiên bản và tự ghi thẳng vào thư mục CapCut. Thêm **Render
CapCut**: chọn project đã convert, từng timeline và thư mục xuất MP4 — chạy
qua agent CapCut native, có job nền theo dõi trạng thái/thử lại và kiểm tra
file MP4 xuất ra thực sự hợp lệ.

Cần làm: máy chạy Render CapCut cần cài CapCut bản tiếng Anh, đóng ứng dụng
CapCut trước khi bấm Render và giữ phiên desktop đang mở (không sleep/lock).

## V1.0.0.34 — 2026-09-08

**Batch Creative Lab**: thiết lập project (tên, Tỷ lệ/W/H/FPS) chuyển từ menu
project thu gọn / thanh Batch Timeline sang một nút **Cài đặt** riêng ngay cạnh
tên project, mở hộp thoại gọn có nút Lưu thiết lập và Archive.

## V1.0.0.33 — 2026-09-08

**Batch Creative Lab**: track hình mới lên trên cùng để PNG không bị video cũ
che; audio mới xuống cuối nhóm, BGM cuối. Ô độ dài nhận giây/số lẻ cho từng
asset trong block, mặc định giữ nguồn (ảnh 3 giây); audio mới cũng giữ độ dài
riêng. Thả folder vào cột List tạo list theo tên folder, gom media cả thư mục
con; file lẻ vẫn vào list đích. Thêm "Convert to CapCut project" ở
header/ma trận: mỗi biến thể là một timeline CapCut riêng (video/PNG/audio
tách track), cài qua installer hiện có. Đưa Tỷ lệ/W/H/FPS ra ngay trên Batch
Timeline, dùng chung 9 preset với editor; W/H nhận pixel chẵn 16–7680 khi
Enter/blur.

## V1.0.0.32 — 2026-09-07

Dọn dẹp: thêm `logs/` (artifact debug/validation tạo ra trong lúc test, không
phải source) vào `.gitignore` — không ảnh hưởng hành vi ứng dụng.

## V1.0.0.31 — 2026-09-07

**Batch Lab**: nhập ảnh/video (upload/path) trả kết quả ngay, không còn phải chờ
tạo thumbnail/proxy — bản xem trước (preview) giờ tạo ở nền, Media Bin hiện
tiến trình và cho thử lại nếu lỗi, video gốc vẫn giữ nguyên khi render. Sửa
lỗi giữ sai thời lượng nguồn, trạng thái loading khi đang render, tên file
xuất theo asset, và audio bị cắt đuôi khi ghép nhiều clip.

## V1.0.0.30 — 2026-09-06

**Settings**: sửa lỗi danh sách tab bên trái hộp thoại Cài đặt bị tràn không cuộn được khi có
nhiều tab.

## V1.0.0.29 — 2026-09-06

Deploy toàn bộ batch tính năng bên dưới (V1.0.0.28) lên server production lần đầu — server trước đó
mới chỉ có phần compound clip, chưa có CapCut export/Composition Compile/Batch Lab/vector-mask-
chroma key/waveform/Command Palette/Graph Editor/v.v.

## V1.0.0.28 — 2026-09-06

**Video Editor**: hỗ trợ nhúng 1 timeline làm 1 clip bên trong timeline khác ("compound clip") —
chọn timeline nguồn qua hộp thoại, hệ thống tự render sẵn thành asset rồi chèn vào track như clip
bình thường; có thể "bung" (unpack) lại thành các clip gốc khi cần sửa chi tiết, kèm huy hiệu báo
khi bản nhúng đã cũ so với timeline nguồn. Thêm tính năng gom nhiều clip đã chọn trên timeline
(collection) để thao tác cùng lúc. Xuất project sang CapCut (node "CapCut Handoff" + hộp thoại
xuất, có kiểm tra tương thích profile CapCut đang cài). Thêm node "Composition Compile" ghép
recipe/component/variant thành 1 timeline cố định. Lưu lịch sử phiên bản project, có màn so sánh
khung hình giữa 2 phiên bản. Hỗ trợ ảnh vector (SVG), vẽ mask, chroma key, hiển thị dạng sóng âm
thanh. Thêm bảng lệnh nhanh (Command Palette), Graph Editor dạng dock, sửa chữ trực tiếp trên
canvas, panel chỉnh tốc độ clip, chọn tỉ lệ khung hình. Kéo-thả asset nội bộ trong Media Bin không
còn bị nhầm thành upload file từ máy. Track rỗng sau khi xoá/cắt/di chuyển hết clip giờ tự dọn
(giữ được undo 1 bước). Dropdown chọn font tìm được không phân biệt hoa/thường, đánh dấu font yêu
thích riêng theo trình duyệt.

## V1.0.0.27 — 2026-09-04

**Video Editor**: phát hiện xung đột chỉnh sửa thật khi 2 nơi cùng sửa 1 project (gửi đúng phiên
bản gốc cho mọi lệnh sửa/undo/redo/thử lại) — hiện banner "Đồng bộ lại" riêng, không lẫn với nút
"Thử lại" khi mất mạng. Thêm nút xoá project ngay trong danh sách project (giữ chuột lên để hiện).
Thêm hộp thoại xem nhanh phím tắt. Sửa vòng focus bị mất khi bấm Tab vào khu vực chọn asset trong
Media Bin.

## V1.0.0.26 — 2026-09-04

**Video Editor**: node mới "Video Editor Workbench" — nhúng Video Editor như 1 node trên canvas,
có nút "Mở Editor" deep-link thẳng vào project. Undo/redo giờ được lưu bền qua reload (không mất
khi tải lại trang). Sửa lỗi export bị cắt ngắn thời lượng khi có nhiều track overlay chồng nhau, và
lỗi ffmpeg thỉnh thoảng ra thời lượng sai (race điều kiện tpad+overlay, chuyển sang dùng concat).
Khi mất kết nối và lệnh chỉnh sửa không lưu được sau nhiều lần thử lại, giờ hiện rõ nút thử lại/bỏ
qua thay vì âm thầm lệch dữ liệu với server. Phát hiện khi project bị chỉnh từ nơi khác (tab khác/
máy khác) lúc quay lại tab. Sửa 1 số lỗi thao tác kéo-thả bị gãy khi nhấn Esc hoặc mất con trỏ giữa
chừng.

## V1.0.0.25 — 2026-09-03

**Video Editor**: xoá hàng loạt asset khỏi Media Bin (nút "Xoá" trên thanh chọn nhiều + mục
"Delete" trong menu chuột phải, có xác nhận trước khi xoá). Cảnh báo sớm ngay trên panel Export
nếu máy chạy render đang thiếu ffmpeg/encoder cần thiết — biết trước thay vì phải đợi job export
chạy xong rồi mới báo lỗi. Sửa lỗi ghép nhiều track video: khoảng trống giữa 2 clip trên cùng
track giờ giữ đúng màn hình đen thay vì bị nén mất, và clip ở track chồng (overlay) hiện đúng vị
trí thời gian thực của nó thay vì bị dồn về đầu.

**Nội bộ**: chuẩn hoá mô hình dữ liệu composition document (versioning, migration path), tách rõ
ranh giới renderer/khả năng máy (capability snapshot)/CapCut adapter qua 3 ADR mới, thêm cơ chế
retry an toàn (idempotency key) cho lệnh chỉnh sửa timeline để tránh áp dụng trùng khi mất kết nối.

## V1.0.0.24 — 2026-09-03

**Nội bộ**: chuẩn hoá hướng dẫn làm việc cho agent — mọi agent vào repo phải đọc và tuân thủ
`CLAUDE.md` cùng các rule áp dụng trong `.claude/rules/` trước khi bắt đầu công việc.

## V1.0.0.23 — 2026-08-31

**Video Editor**: nâng cấp trải nghiệm dựng phim — thanh điều khiển phát (transport bar), panel
kéo giãn được, phím tắt bàn phím, hiển thị dạng sóng âm thanh, chọn nhiều clip cùng lúc để
kéo/xoá/di chuyển hàng loạt, bắt dính (snap), zoom/pan timeline mượt hơn, và bảng chỉnh transform
chi tiết hơn. Thêm tính năng chọn nhiều file trong thư viện tài nguyên rồi tạo hàng loạt timeline
cùng lúc chỉ với 1 thao tác. Sửa nhiều lỗi nhỏ khi thao tác timeline (menu chuột phải tự đóng
trước khi bấm được, nhấn phím Esc đôi khi làm gãy thao tác kéo-thả, click chọn clip đôi khi không
ăn do vùng bấm bị chồng lấn).

## V1.0.0.22 — 2026-08-29

Ba tính năng lớn cùng lên bản này:

- **Spreadsheet**: import Google Sheets công khai (chỉ cần link), liên kết tài khoản Google để
  đồng bộ đọc-ghi 2 chiều, mã hoá thông tin đăng nhập (credentials) lưu trong database.
- **Video Editor**: hàng đợi xuất video (xuất nhiều lần không tranh CPU), preset xuất
  (Gốc/1080p/720p), phụ đề/caption, sticker, ghi âm giọng nói, điều chỉnh âm lượng/fade, nút
  ẩn/tắt tiếng riêng từng track.
- **Graph**: xem sơ đồ quan hệ dữ liệu dạng đồ thị (toàn cục và theo từng node), lưu lại view đã
  chỉnh.

Cần làm: muốn bật tính năng liên kết Google Sheets, cần điền `GOOGLE_SHEETS_API_KEY`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` và `CREDENTIALS_ENCRYPTION_KEY` vào
`D:\space-flow-server\.env` (xem chú thích trong `.env.example`) — chưa điền thì phần còn lại của
app vẫn chạy bình thường, chỉ riêng liên kết Google Sheets sẽ không dùng được.

## V1.0.0.21 — 2026-08-29

Video Editor: nâng cấp phần xem trước (preview player) lên dùng engine dựng
hình canvas thật thay vì thẻ `<video>` đơn giản trước đây — hỗ trợ ghép
nhiều track cùng lúc (trước chỉ hiện track đầu tiên). Máy không hỗ trợ công
nghệ giải mã video mới (một số trình duyệt cũ) sẽ tự động dùng lại chế độ
xem trước cũ, không bị gián đoạn.

## V1.0.0.20 — 2026-08-28

Tính năng mới: Settings → **My Nodes** — tự tạo node riêng ngay trong app, không cần cài thêm gì.
Điền thông tin node, viết đoạn xử lý (JavaScript), bấm "Run Test" thử trước, rồi "Cài đặt local"
là dùng ngay được trong workflow như node có sẵn — chạy cách ly an toàn trên máy bạn, không đụng
tới node khác hay dữ liệu chung. (Node viết bằng Python tạm thời chưa chạy được trên server này —
chỉ hỗ trợ JavaScript ở bản này.)

Cũng gia cố nhiều lớp an toàn nội bộ cho hệ thống chạy node (không có gì cần bạn tự làm thêm).

## V1.0.0.19 — 2026-08-28

Sửa 2 lỗi: (1) node "Resize Upload"/"Resize Upload V2" — tắt tick Rename làm
mất hẳn tag ngày trong tên file output, nay tag ngày lấy đúng theo cột
Datetime bất kể có bật Rename hay không; (2) node "Playable Ads Builder" —
nay bắt buộc điền ít nhất 1 trong 2 URL Android/iOS, và bỏ qua nhánh không
có URL thay vì tạo thư mục `AND/`/`IOS/` rỗng.

## V1.0.0.18 — 2026-08-26

Phát hành bản sửa thứ tự thư mục output của node "Playable Ads Builder":
`AND/` và `IOS/` nằm ngoài, thư mục theo tên video nằm bên trong.

## V1.0.0.17 — 2026-08-26

Sửa thứ tự thư mục output của node "Playable Ads Builder": nay thư mục
`AND/`, `IOS/` nằm ngoài, thư mục theo tên video nằm trong (trước đây
ngược lại) — ví dụ `D:\Ads\AND\1\1_applovin.html` thay vì
`D:\Ads\1\1\AND\1_applovin.html`.

## V1.0.0.16 — 2026-08-26

Node "Playable Ads Builder" nay tách riêng link download cho Android và
iOS thay vì dùng chung 1 link — mỗi lần chạy xuất ra 2 bộ file HTML riêng
(thư mục con `AND/` và `IOS/`), mỗi bộ trỏ đúng link store tương ứng.

## V1.0.0.15 — 2026-08-26

Các node độc lập nối từ cùng 1 node List (vd. Playable Ads Builder + Gif
Compress cùng nhận input từ 1 node List) nay chạy song song thật thay vì
tuần tự — workflow có nhiều nhánh không phụ thuộc nhau sẽ chạy nhanh hơn
đáng kể. Đi kèm sửa 1 lỗi tiềm ẩn: thư mục file tạm dùng chung giữa các
node khiến 2 node anh em (gif-compress, video-assembly) có thể ghi đè file
tạm của nhau khi chạy cùng lúc.

## V1.0.0.14 — 2026-08-26

Thêm node mới "Playable Ads Builder": nhận video (1 file hoặc nối node
List để chạy hàng loạt), điền title + link app, chọn state/flag/network,
xuất ra bộ file HTML quảng cáo playable cho 5 mạng (applovin, unity,
google, mintegral, moloco) — file xuất nằm cạnh video gốc. Sửa lỗi nút
"Cập nhật" (Settings → System) có thể báo thành công nhưng thư viện Python
(yt-dlp...) thực ra chưa được cập nhật đúng môi trường — nay pipeline Cập
nhật và lúc chạy node dùng chung đúng 1 interpreter Python, thêm gói
`curl_cffi` bị thiếu, và hiển thị cảnh báo rõ ràng nếu bước cập nhật
Python lỗi thay vì luôn báo xanh.

Cần làm: vào Settings → Agent bấm "Cập nhật" ít nhất 1 lần nữa để áp dụng
đúng interpreter Python và cài gói `curl_cffi` còn thiếu.

## V1.0.0.13 — 2026-08-26

Node "Tải video" (video-downloader): bật cơ chế tải song song nhiều link
cùng lúc (mặc định 5, tối đa 10 — cấu hình `concurrency`) thay vì tuần tự
từng link. Sửa lỗi pin Pinterest không có video bị fail 403 khi tải ảnh
thay thế (ép sai định dạng ảnh gốc dù CDN không có bản đó), và bỏ thời
gian chờ thừa trước khi chuyển sang tải ảnh thay thế với các pin đã biết
chắc không có video. Sửa lỗi dán nhiều link từ Excel/Google Sheets vào ô
nhập URL bị dính liền nhau, và lỗi 2 ô nhập URL trùng lặp (ở panel cấu
hình bên phải và khi bấm đúp vào node) làm mất nhãn dòng khi dán nhầm chỗ.

## V1.0.0.12 — 2026-08-25

Bỏ nút "Resize & Upload NMS" ở node Resize & Upload Ver2 — chỉ còn giữ 1
nút nhanh "Upload" (đổi tên từ "Upload NMS") để upload thẳng từ input
folders, không resize lại. Nút chính "RENDER & UPLOAD" (chạy full workflow,
có resize + Asana) không đổi.

## V1.0.0.11 — 2026-08-25

Sửa lỗi node Resize & Upload Ver2 luôn fail ngay từ dòng đầu tiên với
"maximum recursion depth exceeded". Wrapper co giãn % tiến trình theo
từng dòng bị viết nhầm khiến nó tự gọi lại chính nó vô hạn thay vì gọi
hàm progress gốc — mọi lần chạy node này trên production trước đây đều
lỗi ngay khi bấm "Render & Upload".

## V1.0.0.10 — 2026-08-25

Sửa xung đột cổng khi agent cài native (Settings > Agent) chạy cùng lúc với
dev.bat trên cùng 1 máy — cả 2 trước đây đều mặc định bind port 3001 nên
bên chạy sau sẽ tự kill nhầm bên kia. Agent giờ mặc định dùng port 4010
(khi `.env` không set `PORT` tường minh), áp dụng ngay cho agent đã cài từ
trước ở lần tự khởi động lại kế tiếp (auto-update), không cần cài lại.
Cần làm: nếu bạn đã pairing agent trên máy nào từ trước, vào Settings >
Agent > "Xoá & tạo lại" (hoặc chạy lại lệnh cài 1 dòng) trên máy đó để tray
icon nhận đúng port mới — nếu không làm, agent vẫn tự chuyển sang port
4010 nhưng tray icon có thể tạm báo sai trạng thái cho tới khi cài lại.

## V1.0.0.9 — 2026-08-25

Thêm nút "Nhập JSON" trong node Resize & Upload Ver2 (bảng) để dán thẳng
nội dung `custom_links.json` cũ vào App/Link catalog (bản Chung hoặc Riêng)
thay vì phải gõ tay từng App qua form — vì server production không có sẵn
file cũ đó nên bản Chung vẫn đang trống sau lần deploy trước. Sửa thêm 2
lỗi nhỏ: mặc định vào đúng bản theo quyền (Admin → Chung, user thường →
Riêng) để tránh sửa nhầm bản Chung rồi mới biết bị chặn; và các thao tác
lưu/xoá/nhập giờ hiện đúng lỗi thay vì báo thành công dù thất bại.
Cần làm: Admin vào node Resize & Upload Ver2 > Cài đặt chung > "Nhập JSON"
để dán lại danh sách App (nội dung file `custom_links.json` cũ) — chưa ai
làm bước này trên production nên "Quản lý App (Chung)" đang trống với mọi
user.

## V1.0.0.8 — 2026-08-25

Server tự động import lại App/Link catalog cũ (file `custom_links.json` cũ
trên máy dev/agent) vào bảng credential trung tâm nếu bảng đó đang rỗng —
tránh mất danh sách link khi tính năng central credentials của Resize &
Upload Ver2 lên production lần đầu.

## V1.0.0.7 — 2026-08-25

Sửa lỗi node Resize & Upload Ver2 mất Asana PAT/link catalog khi request
được relay sang agent chạy trên máy local của user — thêm bước resolve
credential ngay tại server trung tâm trước khi relay đi.

## V1.0.0.6 — 2026-08-25

Hết cửa sổ CMD đen khi mở folder, khi bấm "Cập nhật", và khi auto-update
chạy nền — vá thêm các chỗ còn sót từ lần sửa hôm qua. Node Resize & Upload
Ver2 (bảng): bỏ upload GCS, chuyển sang copy vào thư mục Google Drive
desktop-sync (tự động đẩy lên cloud); thêm tuỳ chọn ngày tuỳ chỉnh riêng
từng dòng thay vì luôn dùng ngày hôm nay.
Cần làm: thử lại nút "mở folder" và "Cập nhật" ở Settings để xác nhận hết
cửa sổ đen; với node Resize & Upload Ver2, kiểm tra lại folder App trong
"Quản lý App" đang trỏ đúng thư mục Google Drive desktop-sync (không còn
dùng bucket GCS nữa).

## V1.0.0.5 — 2026-08-25

Đổi favicon (icon tab trình duyệt) của web sang ảnh mới.

## V1.0.0.4 — 2026-08-24

Agent giờ tự động lấy code mới + khởi động lại khi có bản mới, không cần bấm
nút "Cập nhật" thủ công (mặc định bật, kiểm tra mỗi 20 phút, chỉ chạy khi
không có node nào đang xử lý). Cần làm: vào Settings > System nếu muốn tắt
hoặc giới hạn theo khung giờ cụ thể.

## V1.0.0.3 — 2026-08-24

Cho phép chạy song song 2 nhánh workflow độc lập: khi 1 nhánh (vd. A→B) đang
chạy, vẽ thêm 1 nhánh mới không liên quan (vd. C→D) và bấm "Continue" trên
node mới sẽ chạy ngay, không phải đợi nhánh đầu chạy xong. Nếu 2 lần chạy
đụng cùng 1 node sẽ báo lỗi rõ ràng thay vì chạy đè lên nhau.

## V1.0.0.2 — 2026-08-24

Sửa node Video Downloader: tải TikTok bỏ sót URL dán từ Google Sheets bị dính
dấu ngoặc kép lạc chỗ, và giảm tỷ lệ lỗi tải rải rác do TikTok chặn bot (cài
thêm thư viện giả lập trình duyệt cho yt-dlp).

## V1.0.0.1 — 2026-08-24

Thêm thông báo phiên bản mới, vài sửa lỗi ổn định và bảo mật.

