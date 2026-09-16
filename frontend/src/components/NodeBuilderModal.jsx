// Custom Node Platform Phase 5 (specs/space-flow-master-plan/01-custom-node-platform.md):
// Local Node Builder — tabs General/Ports/Config/Runtime/Permissions/Tests, form-editing a
// Manifest v2 node.json + its single entry file, backed by backend/routes/local-nodes.js.
//
// Scope cut vs the plan's task checklist: no separate "Docs" tab — General's description field
// covers that for v1 rather than adding a whole extra package file (README.md) the draft storage
// format doesn't support yet (see the plan's §0 hand-off note). Ports/Config/Permissions are
// edited as raw JSON (reusing ConfigFields.jsx's CodeField) rather than bespoke per-shape forms —
// this audience is already comfortable with node.json's shape (it's what nodes/*/node.json looks
// like today), and one well-tested JSON editor beats three half-built nested form generators.
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useStore } from '../store.js';
import { CodeField } from './ConfigFields.jsx';
import {
  fetchLocalNodeDraft, createLocalNodeDraft, updateLocalNodeDraft,
  testLocalNodeDraft, installLocalNodeDraft,
} from '../lib/api.js';

const TABS = ['General', 'Ports', 'Config', 'Runtime', 'Permissions', 'Tests'];

const PACKAGE_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function blankManifest() {
  return {
    schemaVersion: 2,
    packageId: '',
    version: '1.0.0',
    displayName: '',
    description: '',
    category: 'data',
    runtime: { type: 'javascript', entry: 'execute.js' },
    inputs: [],
    outputs: [],
    config: [],
    capabilities: {},
    limits: { timeoutSeconds: 30, memoryMB: 256, maxOutputMB: 16 },
    compatibility: { spaceFlow: '>=1.0.0' },
  };
}

const BLANK_SOURCE = {
  javascript: 'module.exports = async function execute(inputs, config) {\n  return {};\n};\n',
  python: 'import sys, json\n\ndef main():\n    payload = json.loads(sys.stdin.read())\n    inputs = payload.get("inputs", {})\n    config = payload.get("config", {})\n    print(json.dumps({}))\n\nif __name__ == "__main__":\n    main()\n',
};

const inputClass = "w-full bg-[var(--n50,#f9fafb)] border border-[var(--card-border,#e5e7eb)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--sub,#374151)] focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-colors";
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-[11px] text-[var(--sub,#4b5563)] mb-1 font-medium">{label}</label>
      {children}
    </div>
  );
}

export default function NodeBuilderModal() {
  const isOpen = useStore(s => s.nodeBuilderOpen);
  const packageIdProp = useStore(s => s.nodeBuilderPackageId);
  const closeNodeBuilder = useStore(s => s.closeNodeBuilder);

  const [tab, setTab] = useState('General');
  const [manifest, setManifest] = useState(blankManifest());
  const [source, setSource] = useState(BLANK_SOURCE.javascript);
  const [createdPackageId, setCreatedPackageId] = useState(null); // set once this draft exists on disk
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null); // { type: 'error'|'success', text }
  const [testInputsText, setTestInputsText] = useState('{}');
  const [testConfigText, setTestConfigText] = useState('{}');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setTab('General');
    setStatusMsg(null);
    setTestResult(null);
    if (packageIdProp) {
      setLoading(true);
      fetchLocalNodeDraft(packageIdProp)
        .then(({ manifest: m, source: s }) => {
          setManifest(m);
          setSource(s);
          setCreatedPackageId(packageIdProp);
        })
        .catch(err => setStatusMsg({ type: 'error', text: err.message }))
        .finally(() => setLoading(false));
    } else {
      setManifest(blankManifest());
      setSource(BLANK_SOURCE.javascript);
      setCreatedPackageId(null);
    }
  }, [isOpen, packageIdProp]);

  if (!isOpen) return null;

  const patchManifest = (patch) => setManifest(m => ({ ...m, ...patch }));

  const handleSave = async () => {
    if (!manifest.packageId || !PACKAGE_ID_RE.test(manifest.packageId)) {
      setStatusMsg({ type: 'error', text: 'packageId phải là kebab-case, 2-64 ký tự (a-z, 0-9, -)' });
      setTab('General');
      return;
    }
    setSaving(true);
    setStatusMsg(null);
    try {
      if (createdPackageId) {
        await updateLocalNodeDraft(createdPackageId, manifest, source);
      } else {
        await createLocalNodeDraft(manifest, source);
        setCreatedPackageId(manifest.packageId);
      }
      setStatusMsg({ type: 'success', text: 'Đã lưu draft.' });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleInstall = async () => {
    if (!createdPackageId) {
      setStatusMsg({ type: 'error', text: 'Lưu draft trước khi cài đặt.' });
      return;
    }
    setInstalling(true);
    setStatusMsg(null);
    try {
      const result = await installLocalNodeDraft(createdPackageId);
      setStatusMsg({ type: 'success', text: `Đã cài "${result.packageId}@${result.version}" — dùng ngay trong workflow qua node.type này.` });
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.message });
    } finally {
      setInstalling(false);
    }
  };

  const handleTest = async () => {
    if (!createdPackageId) {
      setStatusMsg({ type: 'error', text: 'Lưu draft trước khi chạy Test Console.' });
      setTab('Tests');
      return;
    }
    let inputs, config;
    try {
      inputs = JSON.parse(testInputsText);
      config = JSON.parse(testConfigText);
    } catch (err) {
      setTestResult({ ok: false, error: `JSON không hợp lệ: ${err.message}` });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testLocalNodeDraft(createdPackageId, inputs, config);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeNodeBuilder(); }}
    >
      <div
        className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden"
        style={{ width: 860, height: 640 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-[var(--card-border,#f3f4f6)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text,#111827)]">
              {createdPackageId ? (manifest.displayName || createdPackageId) : 'Node mới'}
            </h2>
            <p className="text-[11px] text-[var(--n400,#9ca3af)] mt-0.5">
              {createdPackageId ? `${createdPackageId}@${manifest.version} — Local Draft` : 'Chưa lưu'}
            </p>
          </div>
          <button onClick={closeNodeBuilder} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-[var(--card-border,#f3f4f6)]">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${tab === t ? 'bg-[var(--n100,#f3f4f6)] text-[var(--text,#111827)]' : 'text-[var(--n500,#6b7280)] hover:text-[var(--sub,#374151)]'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>
          ) : tab === 'General' ? (
            <div className="flex flex-col gap-3 max-w-md">
              <Field label="packageId (không đổi được sau khi lưu)">
                <input
                  className={inputClass}
                  value={manifest.packageId}
                  disabled={!!createdPackageId}
                  onChange={e => patchManifest({ packageId: e.target.value })}
                  placeholder="my-custom-node"
                />
              </Field>
              <Field label="version (SemVer)">
                <input className={inputClass} value={manifest.version} onChange={e => patchManifest({ version: e.target.value })} placeholder="1.0.0" />
              </Field>
              <Field label="Display name">
                <input className={inputClass} value={manifest.displayName} onChange={e => patchManifest({ displayName: e.target.value })} />
              </Field>
              <Field label="Category">
                <input className={inputClass} value={manifest.category} onChange={e => patchManifest({ category: e.target.value })} />
              </Field>
              <Field label="Description (dùng luôn làm docs ngắn)">
                <textarea className={inputClass + ' resize-y h-24'} value={manifest.description || ''} onChange={e => patchManifest({ description: e.target.value })} />
              </Field>
              <Field label="Author">
                <input className={inputClass} value={manifest.author || ''} onChange={e => patchManifest({ author: e.target.value })} />
              </Field>
              <Field label="License">
                <input className={inputClass} value={manifest.license || ''} onChange={e => patchManifest({ license: e.target.value })} placeholder="MIT" />
              </Field>
            </div>
          ) : tab === 'Ports' ? (
            <div className="flex flex-col gap-4 max-w-lg">
              <CodeField field={{ label: 'Inputs (JSON array — {id,label,type})' }} value={manifest.inputs} onChange={v => patchManifest({ inputs: v })} />
              <CodeField field={{ label: 'Outputs (JSON array — {id,label,type})' }} value={manifest.outputs} onChange={v => patchManifest({ outputs: v })} />
            </div>
          ) : tab === 'Config' ? (
            <div className="max-w-lg">
              <CodeField
                field={{ label: 'Config fields (JSON array — cùng shape với nodes/*/node.json\'s "config")' }}
                value={manifest.config}
                onChange={v => patchManifest({ config: v })}
              />
            </div>
          ) : tab === 'Runtime' ? (
            <div className="flex flex-col gap-4">
              <div className="flex gap-3 max-w-md">
                <div className="flex-1">
                  <Field label="Runtime type">
                    <select
                      className={inputClass}
                      value={manifest.runtime.type}
                      onChange={e => {
                        const type = e.target.value;
                        const entry = type === 'python' ? 'executor.py' : 'execute.js';
                        patchManifest({ runtime: { type, entry } });
                        if (!createdPackageId) setSource(BLANK_SOURCE[type]);
                      }}
                    >
                      <option value="javascript">javascript</option>
                      <option value="python">python</option>
                    </select>
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="Entry file">
                    <input className={inputClass} value={manifest.runtime.entry} onChange={e => patchManifest({ runtime: { ...manifest.runtime, entry: e.target.value } })} />
                  </Field>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 max-w-md">
                <Field label="timeoutSeconds">
                  <input type="number" className={inputClass} value={manifest.limits.timeoutSeconds} onChange={e => patchManifest({ limits: { ...manifest.limits, timeoutSeconds: Number(e.target.value) } })} />
                </Field>
                <Field label="memoryMB">
                  <input type="number" className={inputClass} value={manifest.limits.memoryMB} onChange={e => patchManifest({ limits: { ...manifest.limits, memoryMB: Number(e.target.value) } })} />
                </Field>
                <Field label="maxOutputMB">
                  <input type="number" className={inputClass} value={manifest.limits.maxOutputMB} onChange={e => patchManifest({ limits: { ...manifest.limits, maxOutputMB: Number(e.target.value) } })} />
                </Field>
              </div>
              <Field label={`Entry source (${manifest.runtime.entry})`}>
                <textarea
                  className={inputClass + ' font-mono resize-y h-80'}
                  spellCheck={false}
                  value={source}
                  onChange={e => setSource(e.target.value)}
                />
              </Field>
            </div>
          ) : tab === 'Permissions' ? (
            <div className="max-w-lg flex flex-col gap-3">
              <p className="text-xs text-[var(--n500,#6b7280)]">
                Default-deny — chỉ khai đúng những gì node thật sự cần. Đây là lane "Local Private"
                (chưa qua duyệt server) nên tự khai báo trực tiếp có hiệu lực ngay khi cài local.
              </p>
              <CodeField
                field={{ label: 'capabilities (JSON — network[], filesystem, secrets[], process, gpu)' }}
                value={manifest.capabilities}
                onChange={v => patchManifest({ capabilities: v })}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 max-w-2xl">
              <p className="text-xs text-[var(--n500,#6b7280)]">
                Chạy thử node qua Sandbox Host thật (isolated-vm/bwrap tuỳ runtime) — cần lưu draft
                trước.
              </p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <Field label="Sample inputs (JSON)">
                    <textarea className={inputClass + ' font-mono resize-y h-32'} spellCheck={false} value={testInputsText} onChange={e => setTestInputsText(e.target.value)} />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="Sample config (JSON)">
                    <textarea className={inputClass + ' font-mono resize-y h-32'} spellCheck={false} value={testConfigText} onChange={e => setTestConfigText(e.target.value)} />
                  </Field>
                </div>
              </div>
              <button
                onClick={handleTest}
                disabled={testing}
                className="self-start h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)] disabled:opacity-50 flex items-center gap-1.5"
              >
                {testing && <Loader2 size={13} className="animate-spin" />}
                {testing ? 'Đang chạy...' : 'Run Test'}
              </button>

              {testResult && (
                <div className="rounded-xl border border-[var(--card-border,#e5e7eb)] p-3 text-xs">
                  <div className={`font-semibold mb-1 ${testResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                    {testResult.ok ? `OK — ${testResult.elapsedMs}ms` : `Lỗi${testResult.elapsedMs !== undefined ? ` — ${testResult.elapsedMs}ms` : ''}`}
                  </div>
                  {testResult.ok ? (
                    <pre className="whitespace-pre-wrap break-all text-[var(--sub,#374151)]">{JSON.stringify(testResult.output, null, 2)}</pre>
                  ) : (
                    <p className="text-red-500">{testResult.error}</p>
                  )}
                  {testResult.logs?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[var(--card-border,#f3f4f6)]">
                      <p className="text-[var(--n400,#9ca3af)] mb-1">Logs</p>
                      {testResult.logs.map((l, i) => <div key={i} className="text-[var(--n500,#6b7280)]">{l}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-[var(--card-border,#f3f4f6)]">
          <p className={`text-xs ${statusMsg?.type === 'error' ? 'text-red-500' : statusMsg?.type === 'success' ? 'text-emerald-600' : 'text-transparent'}`}>
            {statusMsg?.text || '—'}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={saving} className="h-8 px-3 rounded-lg border border-[var(--card-border,#e5e7eb)] text-sm text-[var(--sub,#374151)] hover:bg-[var(--n50,#f9fafb)] disabled:opacity-50">
              {saving ? 'Đang lưu...' : 'Lưu draft'}
            </button>
            <button onClick={handleInstall} disabled={installing || !createdPackageId} className="h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)] disabled:opacity-50">
              {installing ? 'Đang cài...' : 'Cài đặt local'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
