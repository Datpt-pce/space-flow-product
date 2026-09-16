import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { fetchLocalServices, saveLocalService, deleteLocalService } from '../../lib/api.js';

export function LocalServicesTab() {
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

