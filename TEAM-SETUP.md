# Space-Flow — Hướng dẫn cài đặt cho Team

App này chạy **hoàn toàn trên máy của bạn** qua Docker: mỗi người tự build/chạy container trên máy
mình, nên mọi node (xử lý ảnh, AI…) dùng **CPU/RAM của chính máy bạn** — không dùng chung tài nguyên
của máy người khác. Node.js/Python/thư viện AI đều đã đóng gói sẵn trong Docker image — bạn không cần
tự cài chúng. Code được đồng bộ qua GitHub: mỗi lần mở app sẽ **tự động pull bản mới nhất**.

---

## Cách 1: Cài bằng file `SpaceFlow-Setup.exe` (khuyến nghị)

Đây là cách nhanh nhất — không cần biết Git/terminal.

1. Nhận file `SpaceFlow-Setup.exe` từ người quản lý repo (qua Zalo/Drive/USB nội bộ…).
2. Double-click chạy, chọn thư mục muốn cài (mặc định gợi ý sẵn), bấm Next.
3. Installer sẽ **tự động cài Git nếu máy chưa có** (tải trực tiếp từ GitHub, không qua winget/Store),
   kiểm tra máy đã có **Docker Desktop** chưa (xem mục "Cài 1 lần đầu" bên dưới nếu chưa có), rồi
   **tự tải code từ repo `space-flow-product`** (repo riêng chỉ chứa bản ổn định dành cho team — khác
   với repo phát triển nội bộ) vào thư mục đã chọn, chỉ lấy các folder cần thiết để chạy app (nhẹ máy hơn).
4. Cuối installer, tick "Chạy Space-Flow ngay bây giờ" rồi bấm Finish.
5. App tự có sẵn API key dùng chung của team (không cần tự điền `.env`) — sẽ **build Docker image
   lần đầu (mất vài phút)**, sau đó tự khởi động. Từ lần sau chỉ cần bấm shortcut Space-Flow — tự
   động pull code mới nhất rồi chạy (build lại chỉ khi có gì thay đổi).

## Cài 1 lần đầu: Docker Desktop (bắt buộc)

Installer **không tự cài Docker Desktop** vì nó cần bật WSL2 và thường yêu cầu khởi động lại máy —
mỗi người tự cài 1 lần:

0. Nếu máy chưa từng bật Hyper-V/WSL trước đây: chạy `install-wsl-prereqs.bat` (tự xin quyền
   Admin qua UAC) để bật sẵn Hyper-V/VirtualMachinePlatform/WSL — an toàn để chạy kể cả máy đã bật
   sẵn (sẽ tự bỏ qua). Khởi động lại máy nếu script báo cần restart.
1. Tải tại https://www.docker.com/products/docker-desktop
2. Cài đặt theo hướng dẫn (có thể cần bật "WSL2" nếu máy chưa có, Windows sẽ tự nhắc).
3. Khởi động lại máy nếu được yêu cầu.
4. Mở **Docker Desktop** lên, chờ nó chạy xong (icon cá voi ở khay hệ thống hết xoay).
5. Sau đó mới chạy Space-Flow.

## Cách 2: Cài thủ công (dự phòng, hoặc nếu bạn quen dùng Git)

### 1. Cài 1 lần đầu

1. **Docker Desktop** — xem mục trên.
2. **Git** — tải tại https://git-scm.com.
3. **Clone repo** về máy — dùng repo **`space-flow-product`** (repo riêng chỉ chứa bản ổn định dành cho
   team, khác với repo phát triển nội bộ mà bạn không được cấp quyền truy cập):
   ```
   git clone --filter=blob:none --no-checkout https://github.com/Datpt-pce/space-flow-product.git space-flow
   cd space-flow
   git sparse-checkout init --cone
   git sparse-checkout set frontend backend nodes
   git checkout main
   ```
   Lệnh trên chỉ lấy các folder cần để chạy app (`frontend/`, `backend/`, `nodes/`), bỏ qua `tests/`,
   `.claude/`, `logs/`... cho nhẹ máy.
   > Muốn lấy đầy đủ toàn bộ repo: dùng `git clone https://github.com/Datpt-pce/space-flow-product.git`
   > như bình thường, không cần các lệnh `sparse-checkout` ở trên.

### 2. Chạy app

Vào thư mục vừa clone, **double-click file `start.bat`**.

- Script sẽ kiểm tra Docker đang chạy chưa (nếu chưa, mở Docker Desktop lên trước rồi chạy lại).
- **Lần đầu tiên**: script sẽ tự tạo file `.env` và mở Notepad để bạn điền API key.
  → Dán `ANTHROPIC_API_KEY` **của riêng bạn** (dạng `sk-ant-...`) vào, lưu lại, đóng Notepad,
  rồi **double-click `start.bat` lần nữa**.
  > Mỗi người dùng key riêng của mình — không xin/dùng chung key của người khác.
- Script sẽ tự: pull code mới → build Docker image (lần đầu mất vài phút) → khởi động app.
- Khi thấy dòng `Frontend: http://localhost:2612`, mở link đó trên trình duyệt.

### 3. Những lần sau

Chỉ cần **double-click `start.bat`**. Nó tự động pull code mới nhất rồi chạy — không cần thao tác gì thêm.

Để **dừng app**: nhấn `Ctrl + C` trong cửa sổ đen, hoặc đóng cửa sổ.

---

## Câu hỏi thường gặp

**App có cần mạng nội bộ / kết nối tới máy của người khác không?**
Không. App chạy độc lập trên máy bạn qua Docker (`localhost`). Chỉ cần internet để `git pull` code mới,
build Docker image, và gọi API AI.

**Tôi sửa code local nên `git pull` báo lỗi?**
Bạn đang có thay đổi chưa lưu. Nếu không cần giữ, chạy `git stash` rồi mở lại app. Nếu cần giữ, hãy commit trước.

**Báo lỗi "Docker chưa chạy"?**
Mở ứng dụng Docker Desktop lên, chờ icon cá voi ở khay hệ thống hết xoay (nghĩa là đã sẵn sàng), rồi
chạy lại `start.bat`.

**Sửa code xong mà chạy `start.bat` không thấy thay đổi?**
Docker cache lại image cũ nếu package.json/Dockerfile không đổi. Thường `docker compose up --build`
(chính là lệnh `start.bat` dùng) sẽ tự phát hiện code đổi và rebuild đúng phần cần thiết. Nếu vẫn
không thấy, chạy `docker compose build --no-cache` rồi `start.bat` lại.

**Nút "Chọn thư mục"/"Chọn file" mở ra danh sách rỗng hoặc thiếu thư mục mình muốn?**
Khi chạy Docker, các nút này mở dropdown liệt kê `%USERPROFILE%` (Desktop, Documents, Downloads,
Videos...) và **tất cả ổ cứng gắn trong máy trừ ổ C** — `start.bat` tự dò các ổ đĩa này mỗi lần
chạy, không cần cấu hình gì. Chỉ khi muốn duyệt một thư mục cụ thể mà không muốn lộ nguyên cả ổ
đĩa (ví dụ một project riêng), mới cần khai thêm vào `.env` (xem biến `EXTRA_HOST_DIR_1/2/3` trong
`.env.example`) rồi chạy lại `start.bat`. Nếu một ổ đĩa không xuất hiện trong dropdown dù máy có
ổ đó, cần cấp quyền cho Docker Desktop: mở **Docker Desktop → Settings → Resources → File Sharing**,
thêm ổ đĩa đó vào danh sách được chia sẻ (chủ yếu áp dụng cho máy dùng chế độ Hyper-V; máy dùng
WSL2 thường đã tự chia sẻ sẵn mọi ổ đĩa).
