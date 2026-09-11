import { useState } from 'react';
import { useStore } from '../store.js';
import { adminApi, useAdminData, AdminHeading, AdminSearch, AdminMessage, AdminEmpty, AdminDialog, dateLabel } from './AdminShared.jsx';
const roles = { admin: 'Quản trị viên', member: 'Thành viên' };
const statuses = { active: 'Hoạt động', pending: 'Chờ duyệt', rejected: 'Đã khóa / từ chối' };

function Permissions({ user, close }) {
  const { data, error, loading } = useAdminData(async () => {
    const [nodes, credentials, permissions] = await Promise.all([adminApi('/nodes'), adminApi('/credentials'), adminApi(`/users/${user.id}/permissions`)]);
    return { nodes, credentials: credentials.filter(value => value.scope === 'public'), ...permissions };
  }, [user.id]);
  const [draft, setDraft] = useState(null); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState(''); const [search, setSearch] = useState('');
  const current = draft || data;
  const toggle = (key, value) => { const selected = new Set(current[key]); selected.has(value) ? selected.delete(value) : selected.add(value); setDraft({ ...current, [key]: [...selected] }); };
  const save = async () => { setBusy(true); setFailure(''); try { await adminApi(`/users/${user.id}/permissions`, 'PUT', { nodeTypes: current.nodeTypes, credentialNames: current.credentialNames }); close('Đã lưu quyền truy cập.'); } catch (err) { setFailure(err.message); } finally { setBusy(false); } };
  return <AdminDialog title={`Phân quyền · ${user.name || user.email}`} close={() => close()} submit={save} busy={busy} disabled={!data || loading || !!error}>
    <p>Thành viên chỉ dùng được node và credential đã chọn. Bỏ hết lựa chọn sẽ thu hồi các quyền này.</p><AdminMessage error={failure || error} />
    {!data ? <AdminEmpty>{loading ? 'Đang tải quyền…' : 'Không tải được quyền. Hãy đóng và thử lại.'}</AdminEmpty> : <>
      <AdminSearch value={search} onChange={setSearch} label="Tìm node để phân quyền" />
      <div className="admin-permissions"><section><h3>Node ({current.nodeTypes.length})</h3><div className="review-actions">
        <button type="button" onClick={() => setDraft({ ...current, nodeTypes: data.nodes.map(node => node.id) })}>Chọn tất cả</button>
        <button type="button" onClick={() => setDraft({ ...current, nodeTypes: [] })}>Bỏ chọn</button></div>
        {data.nodes.filter(node => `${node.name} ${node.id}`.toLowerCase().includes(search.toLowerCase())).map(node => <label className="review-check" key={node.id}>
          <input type="checkbox" checked={current.nodeTypes.includes(node.id)} onChange={() => toggle('nodeTypes', node.id)} />{node.name || node.id}</label>)}</section>
      <section><h3>Credential dùng chung ({current.credentialNames.length})</h3><p className="review-hint">Chỉ hiển thị tên; không hiển thị khóa bí mật.</p>
        {data.credentials.length ? data.credentials.map(value => <label className="review-check" key={value.name}><input type="checkbox" checked={current.credentialNames.includes(value.name)} onChange={() => toggle('credentialNames', value.name)} />{value.name}</label>) : <AdminEmpty>Chưa có credential dùng chung.</AdminEmpty>}</section></div></>}
  </AdminDialog>;
}
export default function AdminUsers() {
  const me = useStore(state => state.currentUser);
  const { data, error, loading, refresh } = useAdminData(async () => { const [users, usage] = await Promise.all([adminApi('/users'), adminApi('/users/usage-stats')]); return { users, usage }; });
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [permissionUser, setPermissionUser] = useState(null);
  const [change, setChange] = useState(null); const [busy, setBusy] = useState(false); const [failure, setFailure] = useState(''); const [notice, setNotice] = useState('');
  const mutate = async () => { setBusy(true); setFailure(''); try { await adminApi(`/users/${change.user.id}`, 'PATCH', change.patch); setChange(null); setNotice('Đã cập nhật tài khoản.'); await refresh(); } catch (err) { setFailure(err.message); } finally { setBusy(false); } };
  const rows = (data?.users || []).filter(user => (filter === 'all' || user.status === filter) && `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()));
  const usage = id => data?.usage.nodes.filter(row => row.userId === id).reduce((sum, row) => sum + row.count, 0) || 0;
  return <section className="admin-page"><AdminHeading title="Người dùng & quyền truy cập" description="Duyệt tài khoản, chọn vai trò và cấp quyền sử dụng trong môi trường hiện tại." loading={loading} refresh={refresh} />
    <AdminMessage error={error || (!change && failure)} notice={notice} />
    <div className="review-stats">{Object.entries(statuses).map(([key, label]) => <div key={key}><span>{label}</span><strong>{data ? data.users.filter(user => user.status === key).length : '—'}</strong></div>)}</div>
    <div className="admin-toolbar"><AdminSearch value={search} onChange={setSearch} label="Tìm tên hoặc email" /><select aria-label="Lọc trạng thái tài khoản" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Mọi trạng thái</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    <div className="review-card admin-table-wrap"><table className="admin-table"><thead><tr><th>Tài khoản</th><th>Trạng thái</th><th>Vai trò</th><th>Lượt dùng node</th><th>Thao tác</th></tr></thead><tbody>
      {rows.map(user => <tr key={user.id}><td><strong>{user.name || 'Chưa đặt tên'} {user.id === me?.id && <small>(Bạn)</small>}</strong><small>{user.email}</small><small>Tạo: {dateLabel(user.createdAt)}</small></td>
        <td><span className={`admin-badge ${user.status === 'active' ? 'is-ok' : 'is-wait'}`}>{statuses[user.status]}</span></td><td><select aria-label={`Vai trò ${user.email}`} value={user.role} disabled={user.id === me?.id || busy || !!error} onChange={event => { setFailure(''); setChange({ user, patch: { role: event.target.value }, label: `Đổi vai trò thành ${roles[event.target.value]}` }); }}>{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td>
        <td>{usage(user.id)}</td><td><div className="review-actions">{user.role !== 'admin' && <button disabled={!!error} onClick={() => setPermissionUser(user)}>Phân quyền</button>}
          {user.id !== me?.id && <button disabled={busy || !!error} onClick={() => { setFailure(''); setChange({ user, patch: { status: user.status === 'active' ? 'rejected' : 'active' }, label: user.status === 'active' ? 'Khóa tài khoản' : 'Duyệt tài khoản' }); }}>{user.status === 'active' ? 'Khóa' : 'Duyệt'}</button>}
          {user.status === 'pending' && <button disabled={busy || !!error} onClick={() => { setFailure(''); setChange({ user, patch: { status: 'rejected' }, label: 'Từ chối tài khoản' }); }}>Từ chối</button>}</div></td></tr>)}
    </tbody></table>{!rows.length && <AdminEmpty>{loading ? 'Đang tải tài khoản…' : search || filter !== 'all' ? 'Không có tài khoản khớp bộ lọc.' : 'Người dùng sẽ xuất hiện sau khi đăng nhập vào môi trường này.'}</AdminEmpty>}</div>
    <p className="review-hint">Quản trị viên có toàn quyền dùng node và credential chung. Tài khoản của bạn được bảo vệ khỏi việc tự khóa hoặc tự hạ quyền.</p>
    {permissionUser && <Permissions key={permissionUser.id} user={permissionUser} close={message => { setPermissionUser(null); if (message) setNotice(message); }} />}
    {change && <AdminDialog title={change.label} close={() => setChange(null)} submit={mutate} busy={busy} action="Xác nhận thay đổi"><p><strong>{change.user.email}</strong></p>
      <p>{change.patch.role === 'admin' ? 'Quản trị viên có thể quản lý tài khoản và tài nguyên dùng chung.' : change.patch.status === 'rejected' ? 'Tài khoản sẽ mất quyền truy cập; các phiên đăng nhập hiện tại bị thu hồi. Dữ liệu đã tạo được giữ lại.' : 'Thay đổi có hiệu lực ngay sau khi lưu.'}</p><AdminMessage error={failure} /></AdminDialog>}
  </section>;
}
