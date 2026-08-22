import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchSystemStatus, updateDependencies, fetchCredentials, saveCredential, deleteCredential, fetchLocalServices, saveLocalService, deleteLocalService, fetchUsers, updateUserRole, updateUserStatus, fetchUserPermissions, saveUserPermissions, fetchUsageStats, fetchNodes, fetchMyAgents, createAgent, deleteAgent } from '../lib/api.js';

const CREDENTIAL_TYPES = [
  { value: 'bearer', label: 'Bearer token', fields: [{ key: 'token', label: 'Token', type: 'password' }] },
  { value: 'basicAuth', label: 'Basic auth', fields: [{ key: 'user', label: 'User' }, { key: 'pass', label: 'Password', type: 'password' }] },
  { value: 'header', label: 'Header tùy chỉnh', fields: [{ key: 'name', label: 'Tên header' }, { key: 'value', label: 'Giá trị', type: 'password' }] },
  { value: 'query', label: 'Query param', fields: [{ key: 'name', label: 'Tên param' }, { key: 'value', label: 'Giá trị', type: 'password' }] },
];

const SHORTCUTS = [
  {
    section: 'Basics',
    items: [
      { label: 'Copy', keys: ['Ctrl', 'C'] },
      { label: 'Cut', keys: ['Ctrl', 'X'] },
      { label: 'Paste', keys: ['Ctrl', 'V'] },
      { label: 'Undo', keys: ['Ctrl', 'Z'] },
      { label: 'Redo', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: 'Select all', keys: ['Ctrl', 'A'] },
      { label: 'Duplicate', keys: ['Ctrl', 'D'] },
    ],
  },
  {
    section: 'Control',
    items: [
      { label: 'Delete', keys: ['Delete', 'Backspace'] },
      { label: 'Cancel / Close', keys: ['Esc'] },
      { label: 'Add elements', keys: ['Tab'] },
      { label: 'Run', keys: ['Ctrl', 'Enter'] },
    ],
  },
  {
    section: 'Navigation',
    items: [
      { label: 'Pan mode', keys: ['Space'] },
      { label: 'Zoom to fit', keys: ['Scroll'] },
      { label: 'Reset zoom', keys: ['Ctrl', 'O'] },
    ],
  },
];

const BG_OPTIONS = [
  { value: 'dots', label: 'Chấm' },
  { value: 'lines', label: 'Lưới ngang' },
  { value: 'cross', label: 'Lưới chéo' },
  { value: 'none', label: 'Trống' },
];

function KeyBadge({ children }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md border border-[var(--n300,#d1d5db)] bg-[var(--n100,#f3f4f6)] text-[11px] font-medium text-[var(--sub,#4b5563)] leading-none">
      {children}
    </span>
  );
}

function ShortcutsTab() {
  return (
    <div className="flex flex-col gap-6 py-1">
      {SHORTCUTS.map(({ section, items }) => (
        <div key={section}>
          <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">{section}</p>
          <div className="flex flex-col gap-0.5">
            {items.map(({ label, keys }) => (
              <div key={label} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                <span className="text-sm text-[var(--sub,#374151)]">{label}</span>
                <div className="flex items-center gap-1">
                  {keys.map((k, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[var(--n300,#d1d5db)] text-xs">+</span>}
                      <KeyBadge>{k}</KeyBadge>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GeneralTab() {
  const canvasSettings = useStore(s => s.canvasSettings);
  const updateCanvasSettings = useStore(s => s.updateCanvasSettings);

  return (
    <div className="flex flex-col gap-6 py-1">
      {/* Background */}
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Canvas</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Nền canvas</span>
            <div className="flex gap-1">
              {BG_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateCanvasSettings({ backgroundVariant: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${canvasSettings.backgroundVariant === opt.value
                      ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
                      : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Snap to grid</span>
            <button
              onClick={() => updateCanvasSettings({ snapToGrid: !canvasSettings.snapToGrid })}
              className={`relative w-10 h-5 rounded-full transition-colors ${canvasSettings.snapToGrid ? 'bg-[var(--n900,#111827)]' : 'bg-[var(--n200,#e5e7eb)]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-[var(--card,#fff)] shadow transition-transform ${canvasSettings.snapToGrid ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>

          {canvasSettings.snapToGrid && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--sub,#374151)]">Kích thước grid</span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={8}
                  max={64}
                  step={4}
                  value={canvasSettings.snapGrid}
                  onChange={e => updateCanvasSettings({ snapGrid: Number(e.target.value) })}
                  className="w-24 accent-[var(--n900,#111827)]"
                />
                <span className="text-xs text-[var(--n500,#6b7280)] w-8 text-right">{canvasSettings.snapGrid}px</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DESIGN_OPTIONS = [
  { value: 'lts', label: 'LTS' },
  { value: 'beta', label: 'Beta' },
];
const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function AppearanceTab() {
  const appearanceSettings = useStore(s => s.appearanceSettings);
  const updateAppearanceSettings = useStore(s => s.updateAppearanceSettings);
  const isLts = appearanceSettings.designMode !== 'beta';

  return (
    <div className="flex flex-col gap-6 py-1">
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Giao diện</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--sub,#374151)]">Design</span>
            <div className="flex gap-1">
              {DESIGN_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateAppearanceSettings({ designMode: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${appearanceSettings.designMode === opt.value
                      ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
                      : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className={`text-sm ${isLts ? 'text-[var(--n300,#d1d5db)]' : 'text-[var(--sub,#374151)]'}`}>Theme</span>
            <div className="flex gap-1">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  disabled={isLts}
                  onClick={() => updateAppearanceSettings({ theme: opt.value })}
                  className={`px-2.5 h-7 rounded-lg text-xs font-medium transition-colors
                    ${isLts
                      ? 'bg-[var(--n50,#f9fafb)] text-[var(--n300,#d1d5db)] cursor-not-allowed'
                      : appearanceSettings.theme === opt.value
                        ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]'
                        : 'bg-[var(--n100,#f3f4f6)] text-[var(--sub,#4b5563)] hover:bg-[var(--n200,#e5e7eb)]'
                    }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-[var(--n400,#9ca3af)] leading-relaxed">
            {isLts
              ? 'LTS là giao diện hiện tại, đóng băng — không đổi gì so với trước đây.'
              : 'Beta là bố cục node mới đang thử nghiệm. Node List có bố cục Beta riêng (item text xen kẽ file, reorder...); 38 node dùng chung BaseNode đổi bố cục theo "Soft AI Canvas"; 14 node đặc thù còn lại (Video Downloader, Resize & Upload...) giữ nguyên bố cục, chỉ đổi màu.'}
          </p>
        </div>
      </div>
    </div>
  );
}

function CredentialsTab() {
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

function LocalServicesTab() {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | error
  const [errorMsg, setErrorMsg] = useState('');

  const load = () => fetchLocalServices().then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) return;
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await saveLocalService(name.trim(), baseUrl.trim());
      if (res.error) throw new Error(res.error);
      setName('');
      setBaseUrl('');
      setStatus('idle');
      load();
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  const handleDelete = async (svcName) => {
    await deleteLocalService(svcName);
    load();
  };

  return (
    <div className="flex flex-col gap-6 py-1">
      <p className="text-xs text-[var(--n400,#9ca3af)]">
        Ánh xạ tên service (vd. "ollama", "comfyui") sang base URL thật trên máy này — node
        (script-parse-ollama, comfyui-tts, comfyui-lipsync...) để trống field URL sẽ tự tra
        theo tên ở đây. Chỉ lưu trên máy này, không đi kèm workflow khi export/import.
      </p>
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">Đã lưu</p>
        {list.length === 0 ? (
          <p className="text-sm text-[var(--n400,#9ca3af)]">Chưa có local service nào.</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {list.map(s => (
              <div key={s.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[var(--n50,#f9fafb)]">
                <div className="text-sm text-[var(--sub,#374151)]">
                  {s.name} <span className="text-[var(--n400,#9ca3af)]">— {s.baseUrl}</span>
                </div>
                <button onClick={() => handleDelete(s.name)} className="text-[var(--n300,#d1d5db)] hover:text-red-500">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider">Thêm / cập nhật</p>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--n500,#6b7280)]">Tên service</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="vd: ollama, comfyui"
            className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--n500,#6b7280)]">Base URL</label>
          <input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="vd: http://127.0.0.1:8188"
            className="h-8 px-2.5 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm focus:outline-none focus:border-[var(--n400,#9ca3af)]"
          />
        </div>

        {status === 'error' && <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>}

        <button
          type="submit"
          disabled={status === 'saving' || !name.trim() || !baseUrl.trim()}
          className="self-start flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {status === 'saving' && <Loader2 size={12} className="animate-spin" />}
          Lưu
        </button>
      </form>
    </div>
  );
}

function SystemTab() {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [lines, setLines] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [available, setAvailable] = useState(null); // null = đang kiểm tra, true/false
  const [canUpdateCode, setCanUpdateCode] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [unavailableReason, setUnavailableReason] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    fetchSystemStatus()
      .then(res => { setAvailable(res.available); setCanUpdateCode(!!res.canUpdateCode); })
      .catch(err => { setAvailable(false); setUnavailableReason(err.message); });
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const handleUpdate = async () => {
    setStatus('running');
    setLines([]);
    setErrorMsg('');
    setRestarting(false);
    try {
      await updateDependencies((eventType, data) => {
        if (eventType === 'log') {
          setLines(prev => [...prev, data.line]);
        } else if (eventType === 'error') {
          setErrorMsg(`[${data.target}] ${data.error}`);
          setStatus('error');
        } else if (eventType === 'done') {
          setStatus('done');
          setRestarting(!!data.restarting);
        }
      });
    } catch (err) {
      setErrorMsg(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="flex flex-col gap-4 py-1 h-full">
      <div>
        <p className="text-xs font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-3">{canUpdateCode ? 'Code & thư viện' : 'Thư viện'}</p>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--sub,#374151)]">
            {canUpdateCode ? 'Lấy code mới nhất + thư viện JS/Python (yt-dlp...)' : 'Cập nhật thư viện JS (root/frontend/backend) + Python (yt-dlp...)'}
          </span>
          {available === false ? (
            <span className="text-xs text-[var(--n400,#9ca3af)]">Không khả dụng ở môi trường này</span>
          ) : (
            <button
              onClick={handleUpdate}
              disabled={status === 'running' || available !== true}
              className="flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium bg-[var(--n900,#111827)] text-[var(--n0,#fff)] hover:bg-[var(--n700,#374151)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {status === 'running' && <Loader2 size={12} className="animate-spin" />}
              {status === 'running' ? 'Đang cập nhật...' : canUpdateCode ? 'Cập nhật' : 'Cập nhật tất cả thư viện'}
            </button>
          )}
        </div>
        {available === false && (
          <p className="text-xs text-[var(--n400,#9ca3af)] mt-2">
            {unavailableReason || 'Chỉ chạy được ở máy dev (native) — nơi root, frontend và backend cùng nằm trên một máy. ' +
              'Trên bản product (Docker) mỗi service chạy trong container riêng nên không áp dụng được.'}
          </p>
        )}
      </div>

      {status === 'done' && (
        <p className="text-xs text-green-600">
          {restarting
            ? 'Hoàn tất — code đã ở bản mới nhất, agent đang tự khởi động lại. Kiểm tra lại tab Agent sau vài giây để xác nhận Online.'
            : 'Hoàn tất — các thư viện đã ở bản mới nhất hoặc đã được cập nhật.'}
        </p>
      )}
      {status === 'error' && (
        <p className="text-xs text-red-600">Lỗi: {errorMsg}</p>
      )}

      {lines.length > 0 && (
        <pre
          ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#f3f4f6)] rounded-lg p-3 text-[11px] font-mono text-[var(--sub,#4b5563)] whitespace-pre-wrap"
        >
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}

const STATUS_BADGE = {
  pending: { label: 'Chờ duyệt', className: 'bg-amber-50 text-amber-600' },
  active: { label: 'Hoạt động', className: 'bg-green-50 text-green-600' },
  rejected: { label: 'Từ chối', className: 'bg-red-50 text-red-500' },
};

function UsersTab() {
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

  useEffect(() => {
    Promise.all([fetchNodes(), fetchCredentials(), fetchUserPermissions(userId)]).then(
      ([nodes, credentials, perms]) => {
        setAllNodes(nodes);
        setAllCredentials(credentials.filter(c => c.scope === 'public'));
        setNodeTypes(new Set(perms.nodeTypes));
        setCredentialNames(new Set(perms.credentialNames));
      }
    );
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
    await saveUserPermissions(userId, { nodeTypes: [...nodeTypes], credentialNames: [...credentialNames] });
    setSaving(false);
    onClose();
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
        <div className="px-6 py-4 border-t border-[var(--card-border,#f3f4f6)] flex justify-end gap-2">
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
function buildAgentSetupScript(agentToken, serverUrl) {
  return `# Space Flow Agent - cai dat tu dong
# Tao boi Settings -> Agent. Chay 1 lan de pairing may nay lam agent cho ${serverUrl}
$ErrorActionPreference = "Stop"
$CentralServerUrl = "${serverUrl}"
$AgentToken = "${agentToken}"
$InstallDir = "$env:USERPROFILE\\space-flow-agent"
$RepoUrl = "https://github.com/Datpt-pce/space-flow-product.git"

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-WingetPackage($PackageId, $FriendlyName) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "LOI: can cai $FriendlyName nhung may nay khong co winget (App Installer)."
    Write-Host "Cai 'App Installer' tu Microsoft Store (https://aka.ms/getwinget) roi chay lai script nay."
    exit 1
  }
  Write-Host "Dang cai $FriendlyName (winget)..."
  winget install $PackageId -e --accept-package-agreements --accept-source-agreements
  $WingetExitCode = $LASTEXITCODE
  # -1978335189 (0x8A15002B) = "khong co ban cap nhat ap dung duoc": winget tra ve ma nay khi
  # package da duoc cai san va thu upgrade nhung khong co ban moi hon - khong phai loi that.
  if ($WingetExitCode -ne 0 -and $WingetExitCode -ne -1978335189) {
    Write-Host "LOI: cai $FriendlyName that bai (ma loi $WingetExitCode)."
    exit 1
  }
  Refresh-Path
}

function Get-RealPythonExe {
  # Windows co san 1 "app execution alias" python.exe gia tro toi Microsoft Store.
  # Get-Command van thay no ton tai nen phai tu chay --version de biet la Python that hay khong.
  if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    try {
      $out = & python --version 2>&1
      if ($LASTEXITCODE -eq 0 -and $out -match 'Python \d') { return "python" }
    } catch {}
  }
  return $null
}

function Test-NodeVersionOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  try {
    $NodeVer = [Version]((node --version) -replace '^v', '')
    return ($NodeVer -ge [Version]"22.13.0")
  } catch { return $false }
}

if (-not (Test-NodeVersionOk)) {
  Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js"
  if (-not (Test-NodeVersionOk)) {
    Write-Host ""
    Write-Host "LOI: da cai Node.js nhung khong tim thay ban >=22.13.0 trong PATH cua PowerShell nay."
    Write-Host "Hay dong cua so nay, mo PowerShell moi (de nhan PATH cap nhat), roi chay lai script."
    exit 1
  }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WingetPackage "Git.Git" "Git" }
$PythonExe = Get-RealPythonExe
if (-not $PythonExe) { Install-WingetPackage "Python.Python.3.12" "Python"; $PythonExe = Get-RealPythonExe }
if (-not $PythonExe) {
  Write-Host ""
  Write-Host "LOI: da cai Python nhung khong tim thay python/py that trong PATH."
  Write-Host "Hay dong cua so PowerShell nay, mo lai (PATH moi), roi chay lai script."
  exit 1
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Install-WingetPackage "Gyan.FFmpeg" "ffmpeg" }

if (-not (Test-Path $InstallDir)) {
  Write-Host "Tai code Space Flow ve $InstallDir..."
  git clone $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Write-Host "LOI: git clone that bai."; exit 1 }
} else {
  Write-Host "Da co $InstallDir, cap nhat code moi nhat..."
  Push-Location $InstallDir
  git fetch origin
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "LOI: git fetch that bai."; exit 1 }
  git reset --hard origin/main
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "LOI: git reset that bai."; exit 1 }
  Pop-Location
}

Set-Location $InstallDir

Write-Host "Cai dat Python packages cho cac node xu ly video/anh..."
$ErrorActionPreference = "Continue"
& $PythonExe -m pip install --quiet rembg Pillow requests certifi google-cloud-storage yt-dlp gdown==6.1.0
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: cai Python packages that bai (ma loi $LASTEXITCODE)."; exit 1 }

Write-Host "Cai dat dependencies (co the mat vai phut lan dau)..."
npm install --prefix backend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install backend that bai (ma loi $LASTEXITCODE)."; exit 1 }
npm install --prefix frontend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install frontend that bai (ma loi $LASTEXITCODE)."; exit 1 }
if (Test-Path "nodes\\package.json") {
  npm install --prefix nodes
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install nodes that bai (ma loi $LASTEXITCODE)."; exit 1 }
}
$ErrorActionPreference = "Stop"

Write-Host "Ghi cau hinh agent..."
New-Item -ItemType Directory -Force -Path "backend\\config" | Out-Null
"{ \`"agentToken\`": \`"$AgentToken\`" }" | Set-Content -Path "backend\\config\\agent.json" -Encoding ascii
if (-not (Test-Path ".env")) { New-Item -ItemType File ".env" | Out-Null }
$ExistingEnvLines = @(Get-Content ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^(SPACE_FLOW_MODE|CENTRAL_SERVER_URL)=' })
$ExistingEnvLines + @("SPACE_FLOW_MODE=agent", "CENTRAL_SERVER_URL=$CentralServerUrl") | Set-Content -Path ".env" -Encoding ascii

# Dung Startup folder (khong can quyen admin) thay vi Scheduled Task - nhieu may cong ty
# chan Register-ScheduledTask cho user thuong ("Access is denied").
# Dung file .vbs (WshShell.Run windowStyle=0 = SW_HIDE that su) thay vi shortcut .lnk -
# .lnk chi ho tro Normal/Maximized/Minimized (WindowStyle=7 la Thu nho, khong phai An), nen
# van co the flash cua so console moi lan dang nhap Windows.
Write-Host "Dang ky agent tu khoi dong cung Windows (Startup folder)..."
$NodePath = (Get-Command node).Source
try {
  $StartupFolder = [Environment]::GetFolderPath("Startup")
  $OldShortcutPath = Join-Path $StartupFolder "SpaceFlowAgent.lnk"
  if (Test-Path $OldShortcutPath) { Remove-Item $OldShortcutPath -Force -ErrorAction SilentlyContinue }
  $VbsPath = Join-Path $StartupFolder "SpaceFlowAgent.vbs"
  $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$InstallDir\\backend"
WshShell.Run """$NodePath"" server.js", 0, False
"@
  Set-Content -Path $VbsPath -Value $VbsContent -Encoding ascii
  Write-Host "Da tao SpaceFlowAgent.vbs trong Startup folder - agent se tu chay AN moi lan dang nhap Windows."
} catch {
  Write-Host "Khong tao duoc file tu-khoi-dong ($($_.Exception.Message)) - ban can tu chay lai 'node server.js' trong $InstallDir\\backend moi lan can dung."
}

# Chi xoa folder khong tat duoc tien trinh agent cu (van tu chay ngam qua Startup shortcut tu
# lan cai truoc) - no van giu port 3001 va khoa file DB WAL, khien process moi khoi dong xong
# chet ngay lap tuc (EADDRINUSE hoac SQLITE_BUSY khi mo DB o dong dau tien cua server.js).
Write-Host "Kiem tra + dung tien trinh agent cu (neu co) dang giu port 3001..."
try {
  $OldConns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $OldConns) {
    Write-Host "Dung tien trinh cu (PID $($c.OwningProcess)) dang chiem port 3001..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  if ($OldConns) { Start-Sleep -Seconds 1 }
} catch {}

Write-Host "Dang khoi dong agent ngay bay gio..."
$StartupLog = "$InstallDir\\backend\\agent-startup.log"
$Process = Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory "$InstallDir\\backend" -WindowStyle Hidden -PassThru -RedirectStandardOutput $StartupLog -RedirectStandardError "$StartupLog.err"
Start-Sleep -Seconds 3
if ($Process.HasExited) {
  Write-Host ""
  Write-Host "LOI: agent vua khoi dong da tu tat ngay. Log that:"
  Get-Content $StartupLog, "$StartupLog.err" -ErrorAction SilentlyContinue -Tail 20 | ForEach-Object { Write-Host "  $_" }
  Write-Host "Neu log o tren rong, mo PowerShell va chay: cd \`"$InstallDir\\backend\`"; node server.js  -- de xem loi truc tiep."
} else {
  Write-Host ""
  Write-Host "XONG! Agent dang chay nen (PID $($Process.Id)), tu khoi dong lai moi lan dang nhap Windows."
  Write-Host "Kiem tra: mo $CentralServerUrl -> Settings -> Agent -> phai thay trang thai Online sau vai giay."
}
`;
}

const AGENT_STATUS_BADGE = {
  online: { label: 'Online', className: 'bg-green-50 text-green-600' },
  offline: { label: 'Offline', className: 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)]' },
};

// Pairing the CURRENT user's own machine as an agent (specs/hosted-deployment-and-local-agent.md
// Phase D) — every user needs their own paired agent to run node runsOn:"local" (CapCut,
// ComfyUI-local...) on their own machine instead of hitting "agent không online" forever.
function AgentTab() {
  const currentUser = useStore(s => s.currentUser);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState(null); // { id, agentToken } — shown once right after creation
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);

  const load = () => fetchMyAgents().then(list => { setAgents(list); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const myAgent = agents.find(a => a.ownerId === currentUser?.id);
  const serverUrl = window.location.origin;

  // Backend serves the actual setup script (backend/utils/agentSetupScript.js) — this route is
  // public (auth by the token itself, not session) since it's fetched from the target machine via
  // `irm | iex` or a downloaded .bat, neither of which carries the browser's session cookie.
  const installUrl = (format) => {
    const base = `${serverUrl}/api/agent-install/${newToken.agentToken}?serverUrl=${encodeURIComponent(serverUrl)}`;
    return format ? `${base}&format=${format}` : base;
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createAgent(`Máy của ${currentUser?.name || currentUser?.email || ''}`.trim());
      setNewToken(result);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!myAgent) return;
    if (!confirm('Xoá agent hiện tại? Máy này sẽ không chạy được node local (CapCut, ComfyUI...) cho tới khi pairing lại với token mới.')) return;
    await deleteAgent(myAgent.id);
    setNewToken(null);
    load();
  };

  const copyToken = () => {
    navigator.clipboard.writeText(newToken.agentToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyOneLiner = () => {
    navigator.clipboard.writeText(`irm "${installUrl()}" | iex`);
    setCopiedOneLiner(true);
    setTimeout(() => setCopiedOneLiner(false), 1500);
  };

  if (loading) return <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--n500,#6b7280)]">
        Node cần máy thật (CapCut, ComfyUI-local, Ollama, chọn file trên máy...) chỉ chạy được trên
        <b> máy bạn đang ngồi</b> — không phải máy chủ dùng chung. Pairing máy này 1 lần để dùng
        được các node đó.
      </p>

      {newToken && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amber-700">
            Lưu token này ngay — chỉ hiện đúng 1 lần, không xem lại được.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--card,#fff)] border border-amber-200 rounded-lg px-2 py-1.5 truncate">
              {newToken.agentToken}
            </code>
            <button onClick={copyToken}
              className="h-7 px-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 shrink-0">
              {copied ? 'Đã copy' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={copyOneLiner}
              className="h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-xs font-medium hover:bg-[var(--n800,#1f2937)] self-start">
              {copiedOneLiner ? 'Đã copy lệnh' : 'Copy lệnh cài đặt (PowerShell)'}
            </button>
            <p className="text-xs text-[var(--sub,#4b5563)]">
              Mở PowerShell (nhấn <b>Win+X</b> → <b>Windows PowerShell</b>/<b>Terminal</b>), dán
              (Ctrl+V), Enter — không cần tải file, không cần chuột-phải hay chỉnh execution
              policy thủ công.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <a href={installUrl('bat')}
              className="h-8 px-3 rounded-lg border border-[var(--card-border,#d1d5db)] text-[var(--sub,#374151)] text-xs font-medium hover:bg-[var(--n50,#f9fafb)] self-start inline-flex items-center">
              Hoặc tải file .bat (double-click để chạy)
            </a>
            <p className="text-xs text-[var(--sub,#4b5563)]">
              Tải xong, double-click file trong Downloads — chạy ngay, không cần chuột-phải chọn
              "Run with PowerShell" như file .ps1. Lần đầu tải, Windows SmartScreen có thể hỏi
              "Windows protected your PC" → bấm <b>More info</b> → <b>Run anyway</b>.
            </p>
          </div>

          <p className="text-xs text-[var(--sub,#4b5563)]">
            Cả 2 cách trên tự cài Node.js/git/Python/ffmpeg nếu thiếu, tải code, điền sẵn token, và
            tự khởi động lại cùng Windows — không cần làm gì thêm.
          </p>

          <details className="text-xs text-[var(--n500,#6b7280)]">
            <summary className="cursor-pointer hover:text-[var(--sub,#374151)]">Hoặc tự làm tay</summary>
            <div className="text-xs text-[var(--sub,#4b5563)] leading-relaxed mt-1.5">
              <ol className="list-decimal list-inside flex flex-col gap-0.5">
                <li>Cài Node.js + git nếu chưa có, clone code Space Flow về máy.</li>
                <li>Tạo file <code className="bg-[var(--card,#fff)] px-1 rounded">backend/config/agent.json</code>:{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">{'{ "agentToken": "<token trên>" }'}</code></li>
                <li>Trong <code className="bg-[var(--card,#fff)] px-1 rounded">.env</code>, thêm:{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">SPACE_FLOW_MODE=agent</code> và{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">CENTRAL_SERVER_URL={serverUrl}</code></li>
                <li>Chạy <code className="bg-[var(--card,#fff)] px-1 rounded">npm run dev:backend</code> (hoặc{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">node backend/server.js</code>) — để chạy nền lâu dài.</li>
                <li>Hoặc tải trực tiếp{' '}
                  <a href={installUrl('ps1') + '&download=1'} className="underline hover:text-[var(--sub,#1f2937)]">
                    file .ps1 gốc
                  </a>{' '}
                  để đọc/tự chạy tay.</li>
              </ol>
            </div>
          </details>
        </div>
      )}

      {myAgent ? (
        <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)]">
          <div className="text-sm text-[var(--sub,#374151)]">
            <div className="flex items-center gap-1.5">
              <span>{myAgent.name || 'Agent của bạn'}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${AGENT_STATUS_BADGE[myAgent.status]?.className || AGENT_STATUS_BADGE.offline.className}`}>
                {AGENT_STATUS_BADGE[myAgent.status]?.label || myAgent.status}
              </span>
            </div>
            {myAgent.lastSeenAt && <div className="text-xs text-[var(--n400,#9ca3af)] mt-0.5">Lần cuối online: {myAgent.lastSeenAt}</div>}
          </div>
          <button onClick={handleDelete} className="h-7 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-red-500 hover:bg-red-50">
            Xoá & tạo lại
          </button>
        </div>
      ) : !newToken ? (
        <button onClick={handleCreate} disabled={creating}
          className="self-start h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)] disabled:opacity-50">
          {creating ? 'Đang tạo...' : 'Tạo agent mới'}
        </button>
      ) : null}
    </div>
  );
}

export default function SettingsModal() {
  const isOpen = useStore(s => s.isSettingsOpen);
  const closeSettings = useStore(s => s.closeSettings);
  const currentUser = useStore(s => s.currentUser);
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('general');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex overflow-hidden"
        style={{ width: 680, height: 480 }}>
        {/* Sidebar */}
        <div className="w-36 flex-shrink-0 border-r border-[var(--card-border,#f3f4f6)] flex flex-col pt-10 px-2 gap-0.5">
          <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider px-2 mb-2">Settings</p>
          {[
            { id: 'general', label: 'General' },
            { id: 'appearance', label: 'Appearance' },
            { id: 'shortcuts', label: 'Shortcuts' },
            { id: 'credentials', label: 'Credentials' },
            { id: 'agent', label: 'Agent' },
            ...(isAdmin ? [{ id: 'local-services', label: 'Local Services' }] : []),
            ...(isAdmin ? [{ id: 'users', label: 'Users' }] : []),
            { id: 'system', label: 'System' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${tab === t.id ? 'bg-[var(--n100,#f3f4f6)] text-[var(--text,#111827)]' : 'text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)] hover:text-[var(--n800,#1f2937)]'}`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          {currentUser && (
            <button
              onClick={() => useStore.getState().logout()}
              className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)] hover:text-red-500 transition-colors mb-2"
            >
              Đăng xuất
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
            <h2 className="text-base font-semibold text-[var(--text,#111827)]">
              {tab === 'general' ? 'General' : tab === 'appearance' ? 'Appearance' : tab === 'shortcuts' ? 'Shortcuts' : tab === 'credentials' ? 'Credentials' : tab === 'agent' ? 'Agent' : tab === 'local-services' ? 'Local Services' : tab === 'users' ? 'Users' : 'System'}
            </h2>
            <button
              onClick={closeSettings}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === 'general' ? <GeneralTab /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'shortcuts' ? <ShortcutsTab /> : tab === 'credentials' ? <CredentialsTab /> : tab === 'agent' ? <AgentTab /> : tab === 'local-services' ? <LocalServicesTab /> : tab === 'users' ? <UsersTab /> : <SystemTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
