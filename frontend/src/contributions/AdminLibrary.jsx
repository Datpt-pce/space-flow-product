import { useState } from 'react';
import { adminApi, useAdminData, AdminHeading, AdminSearch, AdminMessage, AdminEmpty, AdminDialog, dateLabel } from './AdminShared.jsx';
const names = { AdminReview: 'Chờ duyệt', ChangesRequested: 'Cần chỉnh sửa', Published: 'Đã phát hành', Deprecated: 'Ngừng khuyến nghị', Revoked: 'Đã thu hồi' };
function PackageDetail({ selected, close, reload }) {
  const base = `/registry/admin/${encodeURIComponent(selected.package_id)}/${encodeURIComponent(selected.version)}`;
  const { data, error, loading } = useAdminData(() => adminApi(base), [base]);
  const [action, setAction] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState('');
  const labels = { approve: 'Duyệt & phát hành', 'request-changes': 'Yêu cầu sửa', deprecate: 'Ngừng khuyến nghị', revoke: 'Thu hồi phiên bản', rollback: 'Khôi phục phát hành' };
  const effects = { approve: 'Ký gói và cho phép người dùng cài phiên bản này từ Registry.', 'request-changes': 'Gửi lý do sửa vào hồ sơ; gói chưa được phát hành.', deprecate: 'Khuyến nghị chuyển phiên bản; bản đã cài vẫn chạy.', revoke: 'Đánh dấu thu hồi; chính sách runtime hiện tại sẽ cảnh báo hoặc chặn bản đã cài.', rollback: 'Đưa đúng phiên bản này về trạng thái đã phát hành.' };
  const submit = async () => { setBusy(true); setFailure(''); try { await adminApi(`${base}/${action}`, 'POST', { note }); await reload(); close(); } catch (err) { setFailure(err.message); } finally { setBusy(false); } };
  return <AdminDialog title={`${selected.display_name || selected.package_id} · ${selected.version}`} close={close} submit={submit} busy={busy} disabled={!action || !data || loading || !!error || (['request-changes', 'revoke'].includes(action) && !note.trim())} action={labels[action] || 'Chọn thao tác'}>
    <AdminMessage error={failure || error} />{data && <><p><span className="admin-badge">{names[data.status] || data.status}</span> · Mức rủi ro: {data.riskScore || 'Chưa đánh giá'}</p>
      <h4>Kết quả kiểm tra</h4>{data.steps.length ? data.steps.map(step => <div className="admin-check" key={step.step}><strong>{step.pass ? '✓' : '✕'} {step.name}</strong><p>{step.detail}</p></div>) : <AdminEmpty>Chưa có kết quả kiểm tra được lưu.</AdminEmpty>}
      {data.findings.map((finding, i) => <div className="admin-check" key={i}><strong>{finding.severity} · {finding.title}</strong><p>{finding.detail}</p></div>)}
      <details><summary>Manifest của phiên bản</summary><pre>{JSON.stringify(data.manifest, null, 2)}</pre></details>
      {!!data.lifecycleEvents.length && <><h4>Lịch sử</h4>{data.lifecycleEvents.map((event, i) => <p key={i}>{event.action} · {event.note} · {dateLabel(event.created_at)}</p>)}</>}
      <label>Thao tác với phiên bản<select aria-label="Thao tác với phiên bản" value={action} onChange={event => setAction(event.target.value)}><option value="">Chọn thao tác</option>
        {(data.status === 'AdminReview' ? ['approve', 'request-changes'] : data.status === 'Published' ? ['deprecate', 'revoke'] : data.status === 'Deprecated' ? ['revoke', 'rollback'] : data.status === 'Revoked' ? ['rollback'] : []).map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      {action && <p className="review-hint">{effects[action]}</p>}<label>Ghi chú / lý do<textarea rows={3} maxLength={4000} value={note} onChange={event => setNote(event.target.value)} /></label></>}
  </AdminDialog>;
}
function FlowEdit({ flow, close, reload }) {
  const [name, setName] = useState(flow.name); const [visibility, setVisibility] = useState(flow.visibility); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await adminApi(`/workflows/${flow.id}`, 'PUT', { name: name.trim(), visibility }, { 'If-Match': `"${flow.revision}"` }); await reload(); close(); } catch (err) { setError(err.message); } finally { setBusy(false); } };
  return <AdminDialog title="Quản lý flow" close={close} submit={save} busy={busy} disabled={!name.trim()}><AdminMessage error={error} />
    <label>Tên flow<input required maxLength={240} value={name} onChange={event => setName(event.target.value)} /></label><label>Chia sẻ<select aria-label="Chia sẻ" value={visibility} onChange={event => setVisibility(event.target.value)}><option value="private">Riêng tư · chỉ bạn</option><option value="team">Chung · cả team được xem</option></select></label><p>Nội dung node và kết nối trong flow được giữ nguyên.</p></AdminDialog>;
}
export default function AdminLibrary() {
  const [tab, setTab] = useState('nodes'); const [search, setSearch] = useState(''); const [status, setStatus] = useState('all'); const [selected, setSelected] = useState(null); const [flow, setFlow] = useState(null); const [node, setNode] = useState(null);
  const { data, error, loading, refresh } = useAdminData(() => adminApi(tab === 'nodes' ? '/nodes' : tab === 'packages' ? '/registry/admin/queue' : '/workflows'), [tab]);
  const rows = (Array.isArray(data) ? data : []).filter(row => tab === 'nodes' ? !row.ownerId && !row.package_id : tab === 'packages' ? row.package_id : row.ownerId)
    .filter(row => `${row.name || row.display_name || ''} ${row.id || row.package_id} ${row.ownerName || row.owner_email || ''}`.toLowerCase().includes(search.toLowerCase()))
    .filter(row => tab !== 'packages' || status === 'all' || row.status === status);
  return <section className="admin-page"><AdminHeading title="Node / Flow" description="Tra cứu thư viện node, duyệt phiên bản đóng góp và quản lý flow của bạn hoặc được chia sẻ trong team." loading={loading} refresh={refresh} />
    <AdminMessage error={error} /><div className="review-tabs admin-tabs">{[['nodes', 'Thư viện node'], ['packages', 'Gói đóng góp'], ['flows', 'Flow đã lưu']].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); setSearch(''); setSelected(null); }}>{label}</button>)}</div>
    <div className="admin-toolbar"><AdminSearch value={search} onChange={setSearch} label={tab === 'nodes' ? 'Tìm node' : tab === 'packages' ? 'Tìm gói hoặc người gửi' : 'Tìm flow'} />{tab === 'packages' && <select aria-label="Trạng thái gói" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Mọi trạng thái</option>{Object.entries(names).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select>}<span>{rows.length} mục</span></div>
    {tab === 'nodes' ? <div className="admin-node-grid">{rows.map(value => <button className="review-card admin-node" key={value.id} onClick={() => setNode(value)}><span className="admin-badge">{value.category}</span><strong>{value.name || value.id}</strong><p>{value.description || 'Xem đầu vào, đầu ra và cấu hình của node.'}</p><small>{value.id}</small></button>)}</div> :
      <div className="review-card admin-table-wrap"><table className="admin-table"><thead><tr><th>{tab === 'packages' ? 'Gói / phiên bản' : 'Flow'}</th><th>Người tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{rows.map(value => <tr key={value.id}><td><strong>{value.display_name || value.name || value.package_id}</strong><small>{value.version || `Sửa: ${dateLabel(value.updatedAt)}`}</small></td>
        <td>{value.owner_name || value.ownerName || value.owner_email || 'Chưa có tên'}</td><td><span className="admin-badge">{tab === 'packages' ? names[value.status] : value.visibility === 'team' ? 'Chung với team' : 'Riêng tư'}</span></td><td>
          {tab === 'packages' ? <button disabled={!!error} onClick={() => setSelected(value)}>Xem & xử lý</button> : value.isMine ? <button disabled={!!error} onClick={() => setFlow(value)}>Đổi tên / chia sẻ</button> : <span className="review-hint">Do chủ flow quản lý</span>}</td></tr>)}</tbody></table></div>}
    {!rows.length && <AdminEmpty>{loading ? 'Đang tải…' : error ? 'Dữ liệu chưa tải được. Hãy làm mới để thử lại.' : search ? 'Không có kết quả khớp tìm kiếm.' : tab === 'packages' ? 'Chưa có gói gửi duyệt. Gói node được gửi từ My Nodes trong ứng dụng.' : tab === 'flows' ? 'Chưa có flow. Lưu workflow từ canvas để thấy ở đây.' : 'Chưa có node trong môi trường này.'}</AdminEmpty>}
    {tab === 'flows' && <p className="review-hint">Chỉ hiển thị flow của bạn và flow chia sẻ với team. Mở thư viện workflow trên canvas để chỉnh nội dung hoặc chạy flow.</p>}
    {selected && <PackageDetail selected={selected} close={() => setSelected(null)} reload={refresh} />}{flow && <FlowEdit flow={flow} close={() => setFlow(null)} reload={refresh} />}
    {node && <div className="review-dialog-backdrop"><section className="review-dialog admin-dialog" role="dialog" aria-label={node.name || node.id}><div className="review-section-heading"><h2>{node.name || node.id}</h2><button onClick={() => setNode(null)}>Đóng</button></div><p>{node.description}</p>
      <h4>Đầu vào</h4>{node.inputs?.length ? node.inputs.map(port => <p key={port.id}>{port.label || port.id} · {port.type}</p>) : <p>Không cần đầu vào.</p>}
      <h4>Đầu ra</h4>{node.outputs?.map(port => <p key={port.id}>{port.label || port.id} · {port.type}</p>)}<h4>Cấu hình</h4>{node.config?.map(field => <p key={field.id}>{field.label || field.id} · {field.type}{field.required ? ' · bắt buộc' : ''}</p>)}<p className="review-hint">Thêm node từ nút Add node trên canvas. Cấp quyền cho thành viên trong mục Người dùng.</p></section></div>}
  </section>;
}
