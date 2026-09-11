import { useEffect, useState } from 'react';
import { fetchRegistryQueue, fetchRegistrySubmissionDetail, approveRegistrySubmission, requestRegistryChanges, deprecateRegistryVersion, revokeRegistryVersion, rollbackRegistryVersion, fetchPublicRegistry, installPublishedNode } from '../../lib/api.js';

const REGISTRY_STATUS_BADGE = {
  AdminReview: { label: 'AdminReview', className: 'bg-amber-50 text-amber-600' },
  ChangesRequested: { label: 'ChangesRequested', className: 'bg-red-50 text-red-600' },
  Published: { label: 'Published', className: 'bg-green-50 text-green-600' },
  Deprecated: { label: 'Deprecated', className: 'bg-amber-50 text-amber-600' },
  Revoked: { label: 'Revoked', className: 'bg-red-50 text-red-600' },
};
const REGISTRY_RISK_BADGE = {
  low: 'bg-green-50 text-green-600',
  medium: 'bg-amber-50 text-amber-600',
  high: 'bg-red-50 text-red-600',
};

// Admin Review — Custom Node Platform Phase 7 (specs/space-flow-master-plan/
// 01-custom-node-platform.md): the human decision point Phase 6's automated pipeline always
// defers to. Deliberately more compact than the plan's full ambition (manifest diff viewer, SBOM
// viewer, capability matrix, sandbox console) — this 680x480 Settings shell isn't built for that
// much real estate, and the SBOM text itself isn't even persisted anywhere yet (pipeline step 03
// generates it in-memory only, see backend/registry/pipeline/03-sbom.js). What IS here: the full
// pass/fail step log + itemized findings list (exactly what's actually stored), which covers the
// acceptance criteria's core "xem test report, approve/reject" loop.
export function RegistryReviewTab() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // { packageId, version }
  const [detail, setDetail] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const loadQueue = () => fetchRegistryQueue().then(setQueue).catch((e) => alert(e.message)).finally(() => setLoading(false));
  useEffect(() => { loadQueue(); }, []);

  const openDetail = async (packageId, version) => {
    setSelected({ packageId, version });
    setDetail(null);
    setNote('');
    try {
      setDetail(await fetchRegistrySubmissionDetail(packageId, version));
    } catch (e) {
      alert(e.message);
      setSelected(null);
    }
  };

  const handleApprove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await approveRegistrySubmission(selected.packageId, selected.version);
      setSelected(null);
      setDetail(null);
      loadQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!selected) return;
    if (!note.trim()) return alert('Cần ghi lý do trước khi Request Changes');
    setBusy(true);
    try {
      await requestRegistryChanges(selected.packageId, selected.version, note.trim());
      setSelected(null);
      setDetail(null);
      loadQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Custom Node Platform Phase 8 (specs/space-flow-master-plan/01-custom-node-platform.md):
  // Lifecycle Controls — deprecate/revoke/rollback on an already-Published version. Shares the
  // same selected/detail/note state as the AdminReview actions above (same detail view, buttons
  // just differ based on detail.status).
  const handleDeprecate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deprecateRegistryVersion(selected.packageId, selected.version, note.trim());
      setSelected(null);
      setDetail(null);
      loadQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!selected) return;
    if (!note.trim()) return alert('Cần ghi lý do trước khi Revoke');
    if (!confirm('Revoke sẽ chặn chạy version này (nếu có network capability) cho tới khi user tự "Run anyway". Tiếp tục?')) return;
    setBusy(true);
    try {
      await revokeRegistryVersion(selected.packageId, selected.version, note.trim());
      setSelected(null);
      setDetail(null);
      loadQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await rollbackRegistryVersion(selected.packageId, selected.version, note.trim());
      setSelected(null);
      setDetail(null);
      loadQueue();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>;

  if (selected) {
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => { setSelected(null); setDetail(null); }} className="self-start text-xs text-[var(--n500,#6b7280)] hover:text-[var(--sub,#374151)]">
          ← Quay lại hàng đợi
        </button>
        {!detail ? (
          <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>
        ) : (
          <>
            <div>
              <div className="text-sm font-semibold text-[var(--sub,#374151)]">{detail.displayName || detail.packageId}</div>
              <div className="text-[11px] text-[var(--n400,#9ca3af)]">
                {detail.packageId}@{detail.version} · risk:{' '}
                <span className={`px-1.5 py-0.5 rounded-full font-medium ${REGISTRY_RISK_BADGE[detail.riskScore] || ''}`}>{detail.riskScore}</span>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-1">Pipeline (9 bước)</p>
              <div className="flex flex-col gap-0.5">
                {detail.steps.map((s) => (
                  <div key={s.step} className="text-xs flex items-start gap-1.5">
                    <span className={s.pass ? 'text-green-600' : 'text-red-500'}>{s.pass ? '✓' : '✗'}</span>
                    <span className="text-[var(--sub,#374151)]">{s.name}</span>
                    {s.detail && <span className="text-[var(--n400,#9ca3af)] truncate">— {s.detail}</span>}
                  </div>
                ))}
              </div>
            </div>

            {detail.findings.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-1">Findings</p>
                <div className="flex flex-col gap-0.5">
                  {detail.findings.map((f, i) => (
                    <div key={i} className="text-xs text-[var(--sub,#374151)]">
                      <span className={`px-1 rounded text-[10px] font-medium mr-1 ${REGISTRY_RISK_BADGE[f.severity] || 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)]'}`}>{f.severity}</span>
                      {f.title}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {['Published', 'Deprecated', 'Revoked'].includes(detail.status) && detail.lifecycleEvents?.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider mb-1">Lifecycle history</p>
                <div className="flex flex-col gap-0.5">
                  {detail.lifecycleEvents.map((e, i) => (
                    <div key={i} className="text-xs text-[var(--sub,#374151)]">
                      <span className="font-medium">{e.action}</span>
                      {e.note && <span className="text-[var(--n400,#9ca3af)]"> — {e.note}</span>}
                      <span className="text-[var(--n300,#d1d5db)]"> ({e.actor_name || e.actor_email || 'unknown'})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.status === 'AdminReview' && (
              <div className="flex flex-col gap-2 pt-2 border-t border-[var(--card-border,#f3f4f6)]">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Lý do (bắt buộc nếu Request Changes)..."
                  className="text-xs px-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] resize-none"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button onClick={handleApprove} disabled={busy}
                    className="h-7 px-3 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 disabled:opacity-50">
                    Approve &amp; Sign
                  </button>
                  <button onClick={handleRequestChanges} disabled={busy}
                    className="h-7 px-3 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-[var(--sub,#374151)] hover:bg-[var(--n50,#f9fafb)] disabled:opacity-50">
                    Request Changes
                  </button>
                </div>
              </div>
            )}

            {['Published', 'Deprecated', 'Revoked'].includes(detail.status) && (
              <div className="flex flex-col gap-2 pt-2 border-t border-[var(--card-border,#f3f4f6)]">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Lý do (bắt buộc nếu Revoke)..."
                  className="text-xs px-2 py-1.5 rounded-lg border border-[var(--card-border,#e5e7eb)] resize-none"
                  rows={2}
                />
                <div className="flex gap-2">
                  {detail.status === 'Published' && (
                    <button onClick={handleDeprecate} disabled={busy}
                      className="h-7 px-3 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                      Deprecate
                    </button>
                  )}
                  {['Published', 'Deprecated'].includes(detail.status) && (
                    <button onClick={handleRevoke} disabled={busy}
                      className="h-7 px-3 rounded-lg bg-red-600 text-white text-xs hover:bg-red-700 disabled:opacity-50">
                      Revoke
                    </button>
                  )}
                  {['Deprecated', 'Revoked'].includes(detail.status) && (
                    <button onClick={handleRollback} disabled={busy}
                      className="h-7 px-3 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-[var(--sub,#374151)] hover:bg-[var(--n50,#f9fafb)] disabled:opacity-50">
                      Rollback → Published
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--n500,#6b7280)]">
        Version đang chờ duyệt, đã bị yêu cầu sửa, hoặc đã publish (deprecate/revoke/rollback ở
        đây). Approve sẽ ký + publish lên Registry.
      </p>
      {queue.length === 0 ? (
        <p className="text-xs text-[var(--n400,#9ca3af)]">Không có submission nào đang chờ.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {queue.map((row) => (
            <button
              key={`${row.package_id}@${row.version}`}
              onClick={() => openDetail(row.package_id, row.version)}
              className="text-left flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)] hover:bg-[var(--n50,#f9fafb)]"
            >
              <div className="min-w-0">
                <div className="text-sm text-[var(--sub,#374151)] truncate">{row.display_name || row.package_id}</div>
                <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">
                  {row.package_id}@{row.version} · {row.owner_name || row.owner_email || 'unknown'}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${REGISTRY_RISK_BADGE[row.risk_score] || ''}`}>{row.risk_score}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${REGISTRY_STATUS_BADGE[row.status]?.className || ''}`}>{row.status}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Public Registry browse/install — Custom Node Platform Phase 7. Open to every authenticated
// user (not admin-gated): browsing/installing an already-Published (admin-approved+signed)
// version needs no elevated trust — the review already happened.
export function RegistryTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState(null);

  const load = () => fetchPublicRegistry().then(setRows).catch((e) => alert(e.message)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const handleInstall = async (packageId, version) => {
    setInstallingId(`${packageId}@${version}`);
    try {
      await installPublishedNode(packageId, version);
      alert(`Đã cài ${packageId}@${version} — dùng được ngay trong workflow.`);
    } catch (e) {
      alert(e.message);
    } finally {
      setInstallingId(null);
    }
  };

  if (loading) return <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--n500,#6b7280)]">
        Node đã được Admin duyệt + ký, cài về dùng như 1 node bình thường trong workflow.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--n400,#9ca3af)]">Chưa có package nào được publish.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {rows.map((row) => {
            const id = `${row.package_id}@${row.version}`;
            return (
              <div key={id} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)]">
                <div className="min-w-0">
                  <div className="text-sm text-[var(--sub,#374151)] truncate">{row.display_name || row.package_id}</div>
                  <div className="text-[11px] text-[var(--n400,#9ca3af)] truncate">{id} · {row.channel || 'stable'}</div>
                </div>
                <button
                  onClick={() => handleInstall(row.package_id, row.version)}
                  disabled={installingId === id}
                  className="h-7 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-xs hover:bg-[var(--n800,#1f2937)] disabled:opacity-50 flex-shrink-0 ml-2"
                >
                  {installingId === id ? 'Đang cài...' : 'Cài'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

