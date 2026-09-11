import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { useStore } from '../../store.js';
import { fetchCredentials, saveCredential, deleteCredential } from '../../lib/api.js';

const CREDENTIAL_TYPES = [
  { value: 'bearer', label: 'Bearer token', fields: [{ key: 'token', label: 'Token', type: 'password' }] },
  { value: 'basicAuth', label: 'Basic auth', fields: [{ key: 'user', label: 'User' }, { key: 'pass', label: 'Password', type: 'password' }] },
  { value: 'header', label: 'Header tùy chỉnh', fields: [{ key: 'name', label: 'Tên header' }, { key: 'value', label: 'Giá trị', type: 'password' }] },
  { value: 'query', label: 'Query param', fields: [{ key: 'name', label: 'Tên param' }, { key: 'value', label: 'Giá trị', type: 'password' }] },
  { value: 'asana-pat', label: 'Asana Personal Access Token', fields: [{ key: 'token', label: 'Personal Access Token', type: 'password' }] },
];

export function CredentialsTab() {
  const currentUser = useStore(s => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [type, setType] = useState('bearer');
  const [scope, setScope] = useState('private');
  const [fieldValues, setFieldValues] = useState({});
  const [status, setStatus] = useState('idle'); // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('');

  const typeDef = CREDENTIAL_TYPES.find(t => t.value === type);

  const load = () => fetchCredentials().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveCredential(name.trim(), type, fieldValues, scope);
      if (res.error) throw new Error(res.error);
      setName('');
      setFieldValues({});
      setStatus('idle');
      load();
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleDelete = async (cred) => {
    await deleteCredential(cred.name, cred.scope);
    load();
  };

  return (
    <div className="flex flex-col gap-6 py-1">
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Đã lưu</p>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có credential nào.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {list.map(c => (
              <div key={`${c.scope}:${c.name}`} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                <div className="text-sm text-[var(--sub,#374151)]">
                  {c.name}
                  <span className="text-[var(--n400,#9ca3af)]"> — {CREDENTIAL_TYPES.find(t => t.value === c.type)?.label || c.type}</span>
                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${c.scope === 'public' ? 'bg-blue-50 text-blue-500' : 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)]'}`}>
                    {c.scope === 'public' ? 'Chung' : 'Của tôi'}
                  </span>
                </div>
                {(c.scope === 'private' || isAdmin) && (
                  <button onClick={() => handleDelete(c)} className="text-[var(--n300,#d1d5db)] hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider">Thêm / cập nhật</p>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--n500,#6b7280)]">Tên credential</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="vd: deepseek"
            className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
          />
        </div>

        {isAdmin && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--n500,#6b7280)]">Phạm vi</label>
            <select
              value={scope}
              onChange={e => setScope(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
            >
              <option value="private">Của tôi (chỉ tôi dùng)</option>
              <option value="public">Chung (cả team dùng)</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--n500,#6b7280)]">Loại xác thực</label>
          <select
            value={type}
            onChange={e => { setType(e.target.value); setFieldValues({}); }}
            className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
          >
            {CREDENTIAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {typeDef.fields.map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-xs text-[var(--n500,#6b7280)]">{f.label}</label>
            <input
              type={f.type || 'text'}
              value={fieldValues[f.key] || ''}
              onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value }))}
              className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
            />
          </div>
        ))}

        {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}

        <button
          type="submit"
          disabled={status === 'saving' || !name.trim()}
          className="self-start flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'saving' && <Loader2 size={12} className="animate-spin" />}
          Lưu
        </button>
      </form>
    </div>
  );
}

