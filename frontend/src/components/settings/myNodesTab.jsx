import { useEffect, useState } from 'react';
import { Trash2, FolderPlus } from 'lucide-react';
import { useStore } from '../../store.js';
import { fetchLocalNodes, deleteLocalNodeDraft, setInstalledNodeApprovedPaths, acknowledgeInstalledRevocation } from '../../lib/api.js';

export function MyNodesTab() {
  const openNodeBuilder = useStore(s => s.openNodeBuilder);
  const closeSettings = useStore(s => s.closeSettings);
  const pickFolder = useStore(s => s.pickFolder);
  const [data, setData] = useState({ drafts: [], installed: [] });
  const [loading, setLoading] = useState(true);

  const load = () => fetchLocalNodes().then(setData).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleAddApprovedPath = async (row) => {
    const folder = await pickFolder();
    if (!folder) return;
    const current = (() => { try { return JSON.parse(row.approved_paths || '[]'); } catch { return []; } })();
    if (current.includes(folder)) return;
    try {
      await setInstalledNodeApprovedPaths(row.package_id, row.version, [...current, folder]);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleRemoveApprovedPath = async (row, folder) => {
    const current = (() => { try { return JSON.parse(row.approved_paths || '[]'); } catch { return []; } })();
    try {
      await setInstalledNodeApprovedPaths(row.package_id, row.version, current.filter(p => p !== folder));
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  // Custom Node Platform Phase 8: "Run anyway" 1 lần cho 1 version đã bị revoke và có network
  // capability (backend/registry/revocation-check.js chặn ở lúc chạy workflow thật cho tới khi
  // xác nhận ở đây).
  const handleAcknowledgeRevocation = async (row) => {
    try {
      await acknowledgeInstalledRevocation(row.package_id, row.version);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const handleDelete = async (packageId) => {
    if (!confirm(`Xoá draft "${packageId}"? Không thể hoàn tác.`)) return;
    try {
      await deleteLocalNodeDraft(packageId);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const openDraft = (packageId) => {
    closeSettings();
    openNodeBuilder(packageId);
  };

  if (loading) return <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--n500,#6b7280)]">
        Tự tạo node riêng chạy hoàn toàn trên máy bạn — không cần chờ ai duyệt. Test qua Test
        Console, cài local khi ưng ý, rồi dùng như 1 node bình thường trong workflow.
      </p>

      <button
        onClick={() => { closeSettings(); openNodeBuilder(null); }}
        className="self-start h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)]"
      >
        + Node mới
      </button>

      <div>
        <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">Local Drafts</p>
        {data.drafts.length === 0 ? (
          <p className="text-xs text-[var(--n400,#9ca3af)]">Chưa có draft nào.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {data.drafts.map(m => (
              <div key={m.packageId} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)] hover:bg-[var(--n50,#f9fafb)]">
                <button onClick={() => openDraft(m.packageId)} className="text-left flex-1 min-w-0">
                  <div className="text-sm text-[var(--sub,#374151)] truncate">{m.displayName || m.packageId}</div>
                  <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">{m.packageId}@{m.version}</div>
                </button>
                <button onClick={() => handleDelete(m.packageId)} className="text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors flex-shrink-0 ml-2">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-2">Installed</p>
        {data.installed.length === 0 ? (
          <p className="text-xs text-[var(--n400,#9ca3af)]">Chưa cài package nào.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {data.installed.map(row => {
              const needsPathApproval = row.manifest?.capabilities?.filesystem === 'user-approved-path';
              const approvedPaths = needsPathApproval
                ? (() => { try { return JSON.parse(row.approved_paths || '[]'); } catch { return []; } })()
                : [];
              return (
                <div key={`${row.package_id}@${row.version}`} className="py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)]">
                  <div className="flex items-center gap-1.5">
                    <div className="text-sm text-[var(--sub,#374151)]">{row.manifest?.displayName || row.package_id}</div>
                    {row.versionStatus === 'Deprecated' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-600">Deprecated</span>
                    )}
                    {row.versionStatus === 'Revoked' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-red-50 text-red-600">Revoked</span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--n400,#9ca3af)]">
                    node.type: <code className="bg-[var(--n50,#f9fafb)] px-1 rounded">{row.package_id}@{row.version}</code>
                  </div>
                  {(row.versionStatus === 'Deprecated' || row.versionStatus === 'Revoked') && (
                    <div className="mt-1.5 pt-1.5 border-t border-[var(--card-border,#f3f4f6)]">
                      {row.lifecycleNote && <p className="text-[11px] text-[var(--n500,#6b7280)] mb-1">{row.lifecycleNote}</p>}
                      {row.versionStatus === 'Revoked' && (
                        <button
                          onClick={() => handleAcknowledgeRevocation(row)}
                          className="text-[11px] text-red-600 hover:text-red-700 font-medium"
                        >
                          Đã hiểu rủi ro — Chạy tiếp
                        </button>
                      )}
                    </div>
                  )}
                  {needsPathApproval && (
                    <div className="mt-2 pt-2 border-t border-[var(--card-border,#f3f4f6)]">
                      <p className="text-[11px] text-[var(--n400,#9ca3af)] mb-1">
                        Package này xin quyền truy cập thư mục — chỉ chạy được với đường dẫn bạn duyệt ở đây.
                      </p>
                      {approvedPaths.map(p => (
                        <div key={p} className="flex items-center justify-between gap-2 py-0.5">
                          <code className="text-[11px] text-[var(--sub,#374151)] truncate">{p}</code>
                          <button onClick={() => handleRemoveApprovedPath(row, p)} className="text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors flex-shrink-0">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => handleAddApprovedPath(row)}
                        className="mt-1 flex items-center gap-1 text-[11px] text-[var(--n500,#6b7280)] hover:text-[var(--sub,#374151)]"
                      >
                        <FolderPlus size={12} /> Duyệt thư mục
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Pairing the CURRENT user's own machine as an agent (specs/hosted-deployment-and-local-agent.md
// Phase D) — every user needs their own paired agent to run node runsOn:"local" (CapCut,
// ComfyUI-local...) on their own machine instead of hitting "agent không online" forever.
