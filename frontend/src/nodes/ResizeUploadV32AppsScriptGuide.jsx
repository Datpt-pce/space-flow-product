export default function ResizeUploadV32AppsScriptGuide() {
  return <details className="rounded-lg border border-[var(--card-border,#e5e7eb)] p-3 leading-relaxed break-words">
    <summary className="cursor-pointer font-semibold">Thiết lập Apps Script một lần</summary>
    <p className="mt-2">Admin làm bước 1–5 một lần cho nhóm. Mỗi người chỉ chọn kết nối đã được cấp quyền và nhập PIC Editor của mình ở bước 6. Không cần tự tạo Google API key hoặc chia sẻ mật khẩu Gmail.</p>
    <ol className="list-decimal pl-5 space-y-3 mt-3">
      <li><strong>Chuẩn bị Gmail và Sheet.</strong> Dùng Gmail sẽ chạy báo cáo; Gmail này cần quyền Editor trên Sheet đích, không cần sở hữu Sheet. Nếu dùng Gmail mới, phải chia sẻ Sheet cho đúng Gmail đó. Lần đầu nên dùng một Sheet test có Detail, PIC Editor và Link Cloud trống.</li>
      <li><strong>Tạo project và dán code.</strong> Bấm <strong>Tải Apps Script V3.2</strong> ở trên. Mở file tải bằng Notepad, copy toàn bộ. Vào <a className="underline" href="https://script.google.com/home" target="_blank" rel="noreferrer">Google Apps Script</a> bằng Gmail bước 1 → <strong>New project / Dự án mới</strong>. Đặt tên “SpaceFlow Báo cáo”, mở <code>Code.gs</code>, thay code mẫu bằng toàn bộ nội dung vừa copy và bấm Save.</li>
      <li><strong>Script Properties:</strong> Bấm bánh răng <strong>Project Settings / Cài đặt dự án</strong> bên trái → <strong>Script Properties → Add script property</strong>. Thêm hai dòng rồi bấm <strong>Save script properties</strong>:
        <p className="mt-1"><code>SECRET_KEY</code>: tự tạo chuỗi ngẫu nhiên ít nhất 32 ký tự, có thể dùng trình tạo mật khẩu. Lưu lại để dán đúng cùng chuỗi ở bước 5; đây không phải mật khẩu Gmail.</p>
        <p className="mt-1"><code>SPREADSHEET_ID</code>: phần nằm giữa <code>/d/</code> và <code>/edit</code> trong URL Sheet. Ví dụ <code>…/spreadsheets/d/ABC123/edit#gid=0</code> thì nhập <code>ABC123</code>, không nhập URL đầy đủ hoặc số gid. Đây là ví dụ minh họa; dùng ID thật của bạn.</p>
      </li>
      <li><strong>Cấp quyền và triển khai.</strong> Quay lại Editor, chọn hàm <code>authorizeReport</code> trên thanh công cụ → <strong>Run / Chạy → Review permissions</strong> → chọn Gmail bước 1 và cấp quyền. Hàm này chỉ kiểm tra mở Sheet, không điền báo cáo.
        <p className="mt-1">Tiếp theo: <strong>Deploy → New deployment → Select type (bánh răng) → Web app</strong>. Chọn <strong>Execute as: Me</strong> và <strong>Who has access: Anyone</strong> để SpaceFlow gọi được từ server. Bấm <strong>Deploy</strong>, copy <strong>Web app URL</strong> kết thúc bằng <code>/exec</code>.</p>
        <p className="mt-1">Nếu Workspace không cho chọn Anyone/truy cập không đăng nhập, dùng Google API hoặc nhờ quản trị viên xử lý chính sách. Không dùng URL <code>/dev</code>.</p>
      </li>
      <li><strong>Lưu kết nối trong SpaceFlow.</strong> Vào <strong>Settings → Credentials</strong>, phần tạo credential: nhập tên “BaoCao-Team”, chọn <strong>Loại xác thực: Google Apps Script</strong>. Dán URL bước 4 vào <strong>Web App URL</strong>, dán đúng <code>SECRET_KEY</code> bước 3 vào <strong>Secret Key</strong> rồi lưu.
        <p className="mt-1">Admin muốn chia sẻ: chọn <strong>Phạm vi: Chung (cả team dùng)</strong>, sau đó cấp credential cho từng user tại <strong>Settings → Users → Credentials</strong>. Phần “Kết nối Google báo cáo” dùng cho phương thức Google API.</p>
      </li>
      <li><strong>Điền cấu hình V3.2.</strong> Chọn kết nối vừa lưu trong <strong>Kết nối Apps Script</strong>. Dán URL Sheet đã khai báo ở bước 3; nhập tên tab ở mép dưới Sheet (không phải tên file), PIC Editor đúng tên được phân công, ví dụ <strong>Đạt</strong>.
        <p className="mt-1">Theo Sheet mẫu: <strong>Cột Detail = I · Cột PIC Editor = K · Cột Link Cloud = M</strong>. Cột L là checkbox OS, không chọn làm cột báo cáo. Có thể giới hạn dòng bằng <code>I5:M500</code>. Tên Theme bị gõ sai: khai báo ở <strong>Tên Theme khác trên Sheet (alias)</strong>.</p>
      </li>
      <li><strong>Thử trước rồi bật tự động.</strong> Giữ <strong>Chế độ test — lưu Desktop</strong> được tick để kiểm tra video. Test không gọi Apps Script và không ghi Sheet, kể cả khi bật checkbox báo cáo.
        <p className="mt-1">Muốn thử điền Sheet: dùng Sheet test ở bước 1. Tạo output thật với <strong>Test tắt, báo cáo tắt</strong> và checkbox Drive ở nhánh bật; tắt Asana nếu không muốn gửi task. Sau khi copy thành công, bật báo cáo → <strong>Xem trước ô sẽ điền</strong> → kiểm tra đúng Theme/PIC/ô M → <strong>Thử lại báo cáo, không resize</strong> để ghi path.</p>
        <p className="mt-1">Các nút xem trước/thử lại chỉ bật khi Test tắt và đã có output copy thật. Những lần chạy sau, <strong>Test tắt + báo cáo bật</strong> sẽ tự điền ngay sau copy. Giá trị điền là path <code>G:/…</code>, mỗi nền tảng một dòng.</p>
      </li>
    </ol>
    <details className="mt-3"><summary className="cursor-pointer font-semibold">Nếu chưa điền được / cập nhật script</summary>
      <ul className="list-disc pl-5 space-y-1 mt-2">
        <li>Không thấy kết nối: kiểm tra loại Google Apps Script và quyền credential được Admin cấp.</li>
        <li>Lỗi quyền/đăng nhập: kiểm tra Gmail có Editor, đã chạy authorizeReport, triển khai Me + Anyone và URL /exec.</li>
        <li>Lỗi secret/Sheet không được phép: SECRET_KEY hai bên phải giống nhau; SPREADSHEET_ID phải trùng Sheet URL trong node.</li>
        <li>Không khớp dòng: kiểm tra tên tab, PIC có dấu, I/K/M, vùng dòng và alias Theme. Ô Link Cloud đã có dữ liệu/công thức hoặc không được phép sửa sẽ được giữ nguyên.</li>
        <li>Mở URL /exec bằng trình duyệt có thể báo thiếu doGet: script nhận báo cáo qua POST từ SpaceFlow. Không dùng thao tác mở URL để kết luận kết nối hỏng.</li>
        <li>Đã sửa code: Save rồi Deploy → Manage deployments → chọn deployment → Edit (bút chì) → Version: New version → Deploy. Nếu tạo deployment mới, cập nhật URL trong credential.</li>
        <li>Chuyển từ Sheet test sang Sheet thật: đổi SPREADSHEET_ID trong Script Properties và Sheet URL/tab trong node; chạy authorizeReport lại để kiểm tra quyền.</li>
        <li>Báo lỗi sau khi gửi: kiểm tra Sheet thực tế trước khi thử lại; có thể đã ghi một phần.</li>
      </ul>
    </details>
  </details>;
}
