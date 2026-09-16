import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store.js';
import { fetchCredentials, fetchUsers, updateUserRole, updateUserStatus, fetchUserPermissions, saveUserPermissions, fetchUsageStats, fetchNodes } from '../../lib/api.js';

const STATUS_BADGE = {
  pending: { label: 'Chờ duyệt', className: 'bg-amber-50 text-amber-600' },
  active: { label: 'Hoạt động', className: 'bg-green-50 text-green-600' },
  rejected: { label: 'Từ chối', className: 'bg-red-50 text-red-500' },
};

export function UsersTab() {
  const currentUser = useStore(s => s.currentUser);
  const [list, setList] = useState([]);
  const [permissionsUserId, setPermissionsUserId] = useState(null);
  const [showUsage, setShowUsage] = useState(false);

  const load = () => fetchUsers().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const handleRoleChange = async (id, role) => {
    await updateUserRole(id, role);
    load();
  };

  const handleStatusChange = async (id, status) => {
    await updateUserStatus(id, status);
    load();
  };

  return (
    <div className="flex flex-col gap-0.5">
      {list.map(u => {
        const badge = STATUS_BADGE[u.status] || STATUS_BADGE.active;
        return (
          <div key={u.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)] gap-2">
            <div className="text-sm text-[var(--sub,#374151)] min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate">{u.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${badge.className}`}>{badge.label}</span>
              </div>
              <div className="text-xs text-[var(--n400,#9ca3af)] truncate">{u.email}</div>
            </div>

            {u.status === 'pending' ? (
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleStatusChange(u.id, 'active')}
                  className="h-7 px-2 rounded-lg bg-green-50 text-green-600 text-xs font-medium hover:bg-green-100">Duyệt</button>
                <button onClick={() => handleStatusChange(u.id, 'rejected')}
                  className="h-7 px-2 rounded-lg bg-red-50 text-red-500 text-xs font-medium hover:bg-red-100">Từ chối</button>
              </div>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                {u.status === 'rejected' && (
                  <button onClick={() => handleStatusChange(u.id, 'active')}
                    className="h-7 px-2 rounded-lg bg-green-50 text-green-600 text-xs font-medium hover:bg-green-100">Duyệt lại</button>
                )}
                {u.role !== 'admin' && (
                  <button onClick={() => setPermissionsUserId(u.id)}
                    className="h-7 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-[var(--sub,#4b5563)] hover:bg-[var(--n50,#f9fafb)]">Phân quyền</button>
                )}
                <select
                  value={u.role}
                  disabled={u.id === currentUser?.id}
                  onChange={e => handleRoleChange(u.id, e.target.value)}
                  className="h-7 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs disabled:opacity-50"
                >
                  <option value="member">Thành viên</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            )}
          </div>
        );
      })}

      <button onClick={() => setShowUsage(true)}
        className="mt-2 self-start text-xs text-[var(--n500,#6b7280)] hover:text-[var(--n800,#1f2937)] underline underline-offset-2">
        Xem thống kê sử dụng
      </button>

      {permissionsUserId && (
        <UserPermissionsModal
          userId={permissionsUserId}
          userLabel={list.find(u => u.id === permissionsUserId)?.email}
          onClose={() => setPermissionsUserId(null)}
        />
      )}
      {showUsage && <UsageStatsModal users={list} onClose={() => setShowUsage(false)} />}
    </div>
  );
}

// Which node types + public credentials 1 user may use (backend/db/index.js
// user_node_permissions/user_credential_permissions — empty = nothing allowed).
const CATEGORY_LABEL = {
  data: 'Xử lý dữ liệu',
  ai: 'AI',
  control: 'Điều khiển luồng',
  output: 'Xuất kết quả',
  input: 'Nhập liệu',
  trigger: 'Trigger',
  image: 'Hình ảnh',
};

function UserPermissionsModal({ userId, userLabel, onClose }) {
  const [allNodes, setAllNodes] = useState([]);
  const [allCredentials, setAllCredentials] = useState([]);
  const [nodeTypes, setNodeTypes] = useState(new Set());
  const [credentialNames, setCredentialNames] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [nodes, credentials, perms] = await Promise.all([
          fetchNodes(), fetchCredentials(), fetchUserPermissions(userId),
        ]);
        if (perms.error) throw new Error(perms.error);
        setAllNodes(nodes);
        setAllCredentials(credentials.filter(c => c.scope === 'public'));
        setNodeTypes(new Set(perms.nodeTypes));
        setCredentialNames(new Set(perms.credentialNames));
      } catch (err) {
        setErrorMsg(err.message);
      }
    })();
  }, [userId]);

  const toggle = (set, setSet, value) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setSet(next);
  };

  const setAll = (setSet, values, on) => setSet(on ? new Set(values) : new Set());

  const toggleGroup = (set, setSet, values) => {
    const allOn = values.every(v => set.has(v));
    const next = new Set(set);
    values.forEach(v => allOn ? next.delete(v) : next.add(v));
    setSet(next);
  };

  const nodesByCategory = allNodes.reduce((acc, n) => {
    (acc[n.category] ||= []).push(n);
    return acc;
  }, {});

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg('');
    try {
      const res = await saveUserPermissions(userId, { nodeTypes: [...nodeTypes], credentialNames: [...credentialNames] });
      if (res.error) throw new Error(res.error);
      setSaving(false);
      onClose();
    } catch (err) {
      setSaving(false);
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col" style={{ width: 700, maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h3 className="text-sm font-semibold text-[var(--text,#111827)]">Phân quyền — {userLabel}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)]"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 flex gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[var(--n500,#6b7280)] uppercase tracking-wide">Node ({nodeTypes.size}/{allNodes.length})</p>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => setAll(setNodeTypes, allNodes.map(n => n.id), true)} className="text-[var(--n500,#6b7280)] hover:text-[var(--text,#111827)] underline underline-offset-2">Chọn tất cả</button>
                <button onClick={() => setAll(setNodeTypes, allNodes.map(n => n.id), false)} className="text-[var(--n500,#6b7280)] hover:text-[var(--text,#111827)] underline underline-offset-2">Bỏ chọn</button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {Object.entries(nodesByCategory).map(([category, nodes]) => {
                const ids = nodes.map(n => n.id);
                const allOn = ids.every(id => nodeTypes.has(id));
                const someOn = ids.some(id => nodeTypes.has(id));
                return (
                  <div key={category}>
                    <label className="flex items-center gap-2 text-xs font-semibold text-[var(--sub,#4b5563)] cursor-pointer mb-1">
                      <input type="checkbox" checked={allOn}
                        ref={el => { if (el) el.indeterminate = someOn && !allOn; }}
                        onChange={() => toggleGroup(nodeTypes, setNodeTypes, ids)} />
                      {CATEGORY_LABEL[category] || category} ({ids.length})
                    </label>
                    <div className="flex flex-col gap-1 pl-5">
                      {nodes.map(n => (
                        <label key={n.id} className="flex items-center gap-2 text-sm text-[var(--sub,#374151)] cursor-pointer">
                          <input type="checkbox" checked={nodeTypes.has(n.id)} onChange={() => toggle(nodeTypes, setNodeTypes, n.id)} />
                          {n.name || n.id}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-[var(--n500,#6b7280)] uppercase tracking-wide">Credential public ({credentialNames.size}/{allCredentials.length})</p>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={() => setAll(setCredentialNames, allCredentials.map(c => c.name), true)} className="text-[var(--n500,#6b7280)] hover:text-[var(--text,#111827)] underline underline-offset-2">Chọn tất cả</button>
                <button onClick={() => setAll(setCredentialNames, allCredentials.map(c => c.name), false)} className="text-[var(--n500,#6b7280)] hover:text-[var(--text,#111827)] underline underline-offset-2">Bỏ chọn</button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {allCredentials.map(c => (
                <label key={c.name} className="flex items-center gap-2 text-sm text-[var(--sub,#374151)] cursor-pointer">
                  <input type="checkbox" checked={credentialNames.has(c.name)} onChange={() => toggle(credentialNames, setCredentialNames, c.name)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[var(--card-border,#f3f4f6)] flex items-center justify-end gap-2">
          {errorMsg && <p className="text-xs text-red-600 mr-auto">Lỗi: {errorMsg}</p>}
          <button onClick={onClose} className="h-8 px-3 rounded-lg text-sm text-[var(--sub,#4b5563)] hover:bg-[var(--n50,#f9fafb)]">Huỷ</button>
          <button onClick={handleSave} disabled={saving} className="h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)] disabled:opacity-50">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}

// All-time per-user usage counts — GET /api/users/usage-stats (backend/routes/users.js).
function UsageStatsModal({ users, onClose }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { fetchUsageStats().then(setStats); }, []);
  const emailById = Object.fromEntries(users.map(u => [u.id, u.email]));
  const rows = stats ? [
    ...stats.nodes.map(r => ({ ...r, kind: 'Node', label: r.nodeType })),
    ...stats.credentials.map(r => ({ ...r, kind: 'Credential', label: r.credentialName, status: '—' })),
  ] : [];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col" style={{ width: 560, maxHeight: '80vh' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#f3f4f6)]">
          <h3 className="text-sm font-semibold text-[var(--text,#111827)]">Thống kê sử dụng</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)]"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!stats ? (
            <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có dữ liệu sử dụng.</p>
          ) : (
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[var(--n400,#9ca3af)] border-b border-[var(--card-border,#f3f4f6)]">
                  <th className="py-1.5 font-medium">User</th>
                  <th className="py-1.5 font-medium">Loại</th>
                  <th className="py-1.5 font-medium">Tên</th>
                  <th className="py-1.5 font-medium">Trạng thái</th>
                  <th className="py-1.5 font-medium text-right">Số lần</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-[var(--card-border,#f9fafb)] text-[var(--sub,#374151)]">
                    <td className="py-1.5 truncate max-w-[140px]">{emailById[r.userId] || r.userId}</td>
                    <td className="py-1.5">{r.kind}</td>
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5">{r.status}</td>
                    <td className="py-1.5 text-right">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Generates a self-contained PowerShell script that installs Node.js/git if missing (winget),
// clones the public product repo, wires up .env + backend/config/agent.json with this agent's
// own token, and registers a Scheduled Task so the agent auto-starts on login. Built client-side
// (never sent to the backend) since the token is already in the browser right after creation —
// no new server route needed, and the token never crosses the network a second time.
