import { ExternalLink } from 'lucide-react';

export function trialIsOpen(job) {
  return !!job?.trial?.url && !job.trial.stoppedAt && job.trial.expiresAt > Date.now() && job.trial.digest === job.candidate?.digest;
}

export default function TrialInstructions({ job, onOpen, busy, simple = false }) {
  const textChange = job.source?.files?.some(file => file.filename === 'frontend/src/nodes/TextNode.jsx' || file.filename.startsWith('nodes/text/'));
  const open = trialIsOpen(job);
  return <div className="review-trial-guide">
    <p className="review-trial-intro">Bạn đang kiểm tra một bản riêng của ứng dụng. Bản này có dữ liệu thử riêng và chưa được đưa lên server chung.</p>
    <ol>
      <li><strong>Mở ứng dụng dùng thử</strong><p>Bấm nút bên dưới. Ứng dụng mở trong tab mới; giữ tab Control Center này để ghi kết quả khi thử xong.</p>
        {open ? <a className="review-trial-open" href={job.trial.url} target="_blank" rel="noreferrer">Mở lại ứng dụng dùng thử <ExternalLink size={15} /></a> :
          <button type="button" className="review-primary" disabled={busy || !job.gates?.canPreview} onClick={onOpen}>Mở ứng dụng dùng thử</button>}
        {job.trial && !open && <p className="review-hint">Phiên trước đã đóng hoặc hết hạn. Nút này tạo một phiên mới.</p>}</li>
      <li><strong>{textChange ? 'Thử nhập nội dung trong node Text' : 'Kiểm tra thay đổi được đề xuất'}</strong>
        {textChange ? <><p>Trong tab mới, bấm dấu <b>+</b> bên trái (Add node), tìm <b>Text</b> rồi bấm để thêm node. Nhập <b>Xin chào</b> vào ô nội dung và bấm nút tam giác chạy trên node.</p>
          <p><b>Kết quả cần thấy:</b> ô nhập nhận đúng chữ, node chạy xong và nhật ký báo Complete. Xóa hết chữ: ô trống hiển thị hướng dẫn nhập tiếng Việt.</p>
          <p>Trường hợp dữ liệu đầu vào rỗng đã có kiểm tra tự động ở mục Kiểm tra. Bạn chỉ cần xem giao diện và thao tác có đúng ý mình không.</p></> :
          <><p>{job.description || 'Mở phần ứng dụng được thay đổi, làm lại thao tác bạn thường dùng và kiểm tra kết quả.'}</p>
            {!!job.report?.suggestedTests?.length && <ul>{job.report.suggestedTests.slice(0, 4).map((item, index) => <li key={index}>{item}</li>)}</ul>}</>}</li>
      <li><strong>Quay lại đây và ghi kết quả</strong>{simple ? <p>Đóng hướng dẫn này rồi bấm <b>Chấp nhận</b> nếu thay đổi đúng ý bạn. Nếu có lỗi, mở <b>Đọc báo cáo → Yêu cầu chỉnh sửa</b> và mô tả điều cần sửa.</p> : <p>Chọn <b>Đạt yêu cầu</b> hoặc <b>Cần chỉnh sửa</b>, ghi ngắn điều bạn đã thử rồi lưu. Khi đạt, Control Center mới mở bước chọn nơi phát hành và duyệt.</p>}</li>
    </ol>
  </div>;
}
