import { useState, useEffect, useMemo, useRef } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Play, Trash2, Copy, Link2, ChevronDown, Folder, ImageOff, GripVertical, X, Plus } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchVideoMetadata } from '../lib/api.js';
import { ResizeControls } from './resizable.jsx';
import { portGlyph, portStyle } from './portStyle.jsx';

const PREVIEW_CONCURRENCY = 3;
const PREVIEW_DEBOUNCE_MS = 800;

const STATUS_COLORS = {
  running: '#f59e0b',
  done:    '#22c55e',
  error:   '#ef4444',
};

const FORMATS = ['best', 'mp4', 'mp3'];

const DEFAULT_ROW_H = 300;
const DEFAULT_W = 640;
const MIN_W = 520, MAX_W = 900, MIN_H = 280, MAX_H = 680;

function countReachable(nodes, edges, startId) {
  const adj = {};
  for (const e of edges) {
    if (!adj[e.source]) adj[e.source] = [];
    adj[e.source].push(e.target);
  }
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const nodeId = queue.shift();
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const next of (adj[nodeId] || [])) queue.push(next);
  }
  return visited.size;
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return matches.map(u => u.replace(/[.,;)\]]+$/, ''));
}

function extractHrefs(html) {
  const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
  return extractUrls(matches.join('\n'));
}

// <br> không sinh khoảng trắng trong textContent — 1 ô Excel/Sheets có nhiều link xuống dòng
// bằng Alt+Enter (mỗi link 1 <br>) sẽ bị dính liền thành 1 chuỗi hỏng nếu đọc thẳng textContent.
// Thay từng <br> bằng newline trước khi lấy text để extractUrls tách đúng từng link.
function cellText(cell) {
  const clone = cell.cloneNode(true);
  clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return clone.textContent || '';
}

// Dán 1 dải ô từ Google Sheets/Excel: giữ vị trí hàng-cột gốc để đặt tên file sau khi tải.
// Cột đánh số tăng dần theo từng URL tìm được trong hàng (không neo cứng vào vị trí <td>/tab)
// để không mất URL nếu 1 cell chứa nhiều link.
function parseGridFromHtml(html) {
  if (!html) return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const rows = [...doc.querySelectorAll('table tr')];
  if (!rows.length) return null;
  const grid = [];
  rows.forEach((tr, ri) => {
    let col = 0;
    [...tr.querySelectorAll('td, th')].forEach(cell => {
      const anchors = [...cell.querySelectorAll('a[href]')].map(a => a.href);
      const urls = anchors.length ? anchors : extractUrls(cellText(cell));
      urls.forEach(url => { col += 1; grid.push({ row: ri + 1, col, url }); });
    });
  });
  return grid.length ? grid : null;
}

function parseGridFromText(text) {
  if (!text) return null;
  const lines = text.split(/\r\n|\r|\n/);
  const grid = [];
  lines.forEach((line, ri) => {
    let col = 0;
    line.split('\t').forEach(cell => {
      extractUrls(cell).forEach(url => { col += 1; grid.push({ row: ri + 1, col, url }); });
    });
  });
  return grid.length ? grid : null;
}

function getIncomingCount(nodeId, nodes, edges, nodeOutputs) {
  const inEdges = edges.filter(e => e.target === nodeId);
  let total = 0;
  for (const e of inEdges) {
    const outputs = nodeOutputs[e.source];
    if (outputs && outputs[e.sourceHandle] !== undefined) {
      const val = outputs[e.sourceHandle];
      total += Array.isArray(val) ? val.length : 1;
    }
  }
  return total;
}

export default function VideoDownloaderNode({ id, data, selected, width }) {
  const { manifest } = data;
  const config = data.config || {};
  const [runOpen, setRunOpen] = useState(false);
  const [previews, setPreviews] = useState({});
  const previewsRef = useRef({});
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const nodeStatuses     = useStore(s => s.nodeStatuses);
  const nodeOutputs      = useStore(s => s.nodeOutputs);
  const nodes            = useStore(s => s.nodes);
  const edges            = useStore(s => s.edges);
  const runWorkflow      = useStore(s => s.runWorkflow);
  const deleteNode       = useStore(s => s.deleteNode);
  const selectNode       = useStore(s => s.selectNode);
  const duplicateNode    = useStore(s => s.duplicateNode);
  const updateNodeConfig = useStore(s => s.updateNodeConfig);
  const nodeActive       = useStore(s => s.nodeActive);
  const pickFolder       = useStore(s => s.pickFolder);

  const status       = nodeStatuses[id] || 'idle';
  const isRunning    = status === 'running';
  const isActive     = nodeActive[id] !== false;
  const reachable    = countReachable(nodes, edges, id);
  const inCount      = getIncomingCount(id, nodes, edges, nodeOutputs);
  const outFiles     = nodeOutputs[id]?.files_out;
  const outCount     = Array.isArray(outFiles) ? outFiles.length : 0;

  const handleDelete = () => { deleteNode(id); };
  const cfg = (key, def) => (config[key] !== undefined ? config[key] : def);
  const set = (key, val) => updateNodeConfig(id, key, val);
  const urlLines = cfg('urls_manual', '').split('\n');
  const handleBrowse = async () => {
    const path = await pickFolder();
    if (path) set('output_dir', path);
  };

  // urls_labels là mảng song song với urlLines theo ĐÚNG index thô (kể cả dòng trống đang gõ
  // dở) — mọi thao tác sửa/xoá/kéo-thả bên dưới áp y hệt lên cả 2 mảng cùng lúc để luôn khớp
  // nhau. Chỉ lọc bỏ dòng trống khi merge lúc dán (paste), không lọc ở đây.
  const urlLabels = cfg('urls_labels', []);
  const setUrlLinesAndLabels = (nextLines, nextLabels) => {
    set('urls_manual', nextLines.join('\n'));
    set('urls_labels', nextLabels);
  };

  const handleUrlsPaste = (e) => {
    const pasted = e.clipboardData.getData('text');
    const pastedHtml = e.clipboardData.getData('text/html');
    const grid = parseGridFromHtml(pastedHtml) || parseGridFromText(pasted);

    let newUrls, newLabels;
    if (grid && grid.length >= 2) {
      // Dán 1 dải nhiều ô — gắn label hàng-cột cho TỪNG ô, kể cả url trùng nhau giữa các ô
      // (không dedupe theo giá trị url — mỗi ô là 1 dòng riêng, dùng để đặt tên file sau khi tải).
      newUrls = grid.map(g => g.url);
      newLabels = grid.map(g => `${g.row}-${g.col}`);
    } else {
      // Dán 1 link đơn lẻ — giữ hành vi cũ (dedupe nội bộ giữa 2 cách tìm url trong CÙNG 1 lần
      // dán này), không gắn label.
      newUrls = [...new Set([...extractUrls(pasted), ...extractHrefs(pastedHtml)])];
      newLabels = newUrls.map(() => null);
    }

    if (newUrls.length === 0) return;
    e.preventDefault();
    // Lọc dòng trống của danh sách cũ khi merge (giữ đúng hành vi cũ), zip cùng label trước khi lọc
    // để không lệch index giữa 2 mảng.
    const existing = urlLines
      .map((line, i) => ({ url: line.trim(), label: urlLabels[i] ?? null }))
      .filter(p => p.url);
    const mergedUrls = [...existing.map(p => p.url), ...newUrls];
    const mergedLabels = [...existing.map(p => p.label), ...newLabels];
    setUrlLinesAndLabels(mergedUrls, mergedLabels);
  };

  const addUrlLine = () => setUrlLinesAndLabels([...urlLines, ''], [...urlLabels, null]);
  const updateUrlLine = (idx, val) => {
    const next = [...urlLines]; next[idx] = val;
    set('urls_manual', next.join('\n'));
  };
  const deleteUrlLine = (idx) => setUrlLinesAndLabels(
    urlLines.filter((_, i) => i !== idx),
    urlLabels.filter((_, i) => i !== idx)
  );

  const onUrlRowDragStart = (e, idx) => { e.stopPropagation(); setDragIdx(idx); };
  const onUrlRowDragOver  = (e, idx) => { e.preventDefault(); e.stopPropagation(); setDragOverIdx(idx); };
  const onUrlRowDrop      = (e, idx) => {
    e.stopPropagation();
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDragOverIdx(null); return; }
    const nextLines = [...urlLines];
    const [movedLine] = nextLines.splice(dragIdx, 1);
    nextLines.splice(idx, 0, movedLine);
    const nextLabels = [...urlLabels];
    const [movedLabel] = nextLabels.splice(dragIdx, 1);
    nextLabels.splice(idx, 0, movedLabel);
    setUrlLinesAndLabels(nextLines, nextLabels);
    setDragIdx(null); setDragOverIdx(null);
  };
  const onUrlRowDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const previewUrls = useMemo(() => (
    [...new Set((config.urls_manual || '').split('\n').map(u => u.trim()).filter(Boolean))]
  ), [config.urls_manual]);

  useEffect(() => {
    const toFetch = previewUrls.filter(u => !previewsRef.current[u]);
    if (toFetch.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      const loadingEntries = {};
      for (const u of toFetch) loadingEntries[u] = { status: 'loading' };
      previewsRef.current = { ...previewsRef.current, ...loadingEntries };
      setPreviews(prev => ({ ...prev, ...loadingEntries }));

      let idx = 0;
      const runWorker = async () => {
        while (idx < toFetch.length) {
          const url = toFetch[idx++];
          if (cancelled) return;
          let entry;
          try {
            const result = await fetchVideoMetadata(url);
            entry = result.error
              ? { status: 'error' }
              : { status: 'done', thumbnail: result.thumbnail, title: result.title };
          } catch {
            entry = { status: 'error' };
          }
          if (cancelled) return;
          previewsRef.current = { ...previewsRef.current, [url]: entry };
          setPreviews(prev => ({ ...prev, [url]: entry }));
        }
      };
      for (let i = 0; i < Math.min(PREVIEW_CONCURRENCY, toFetch.length); i++) runWorker();
    }, PREVIEW_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [previewUrls]);

  const nodeW = width || DEFAULT_W;

  return (
    <div className="relative flex flex-col" style={{ width: nodeW, height: '100%', opacity: isActive ? 1 : 0.4 }}>
      <ResizeControls selected={selected} minW={MIN_W} minH={MIN_H} maxW={MAX_W} maxH={MAX_H} />

      <NodeToolbar isVisible={!!selected} position={Position.Bottom} align="start" offset={8}>
        <div className="flex items-center gap-0.5 bg-[var(--card,#fff)] rounded-2xl shadow-lg border border-[var(--card-border,#e5e7eb)] px-1.5 py-1.5">
          <div className="relative">
            <button
              className="flex items-center gap-1 px-2 py-1 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors"
              onClick={() => setRunOpen(o => !o)}
            >
              <Play size={12} className="text-[var(--sub,#374151)]" />
              <ChevronDown size={9} className="text-[var(--n400,#9ca3af)]" />
            </button>
            {runOpen && (
              <div className="absolute left-0 top-full mt-1.5 bg-[var(--card,#fff)] rounded-xl shadow-xl border border-[var(--card-border,#e5e7eb)] py-1 z-[9999] min-w-[180px]">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(id); setRunOpen(false); }}
                >
                  <span className="text-[11px] font-medium text-[var(--n800,#1f2937)]">✓ Run from here</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{reachable} nodes</span>
                </button>
                <button
                  className="w-full px-3 py-2 text-left hover:bg-[var(--n50,#f9fafb)] flex items-center gap-2 transition-colors"
                  onClick={() => { runWorkflow(null); setRunOpen(false); }}
                >
                  <span className="text-[11px] text-[var(--sub,#4b5563)]">All workflow</span>
                  <span className="ml-auto text-[10px] text-[var(--n400,#9ca3af)]">~{nodes.length} nodes</span>
                </button>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-[var(--n200,#e5e7eb)]" />
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Open config" onClick={() => selectNode(id)}>
            <Link2 size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-[var(--n100,#f3f4f6)] transition-colors text-[var(--n500,#6b7280)]" title="Duplicate" onClick={() => duplicateNode(id)}>
            <Copy size={12} />
          </button>
          <button className="p-1.5 rounded-xl hover:bg-red-50 transition-colors text-[var(--n500,#6b7280)] hover:text-red-500" title="Delete" onClick={handleDelete}>
            <Trash2 size={12} />
          </button>
        </div>
      </NodeToolbar>

      <div className="absolute bottom-full left-0.5 right-0.5 mb-1 text-[11px] text-[var(--n400,#9ca3af)] font-medium select-none truncate">
        {manifest.name} <span className="text-[var(--n300,#d1d5db)]">#{data.nodeNumber ?? id.slice(-4)}</span>
      </div>

      <div
        className={`relative bg-[var(--card,#fff)] rounded-2xl overflow-visible transition-shadow flex flex-col flex-1 min-h-0 ${
          isRunning
            ? 'ring-2 ring-amber-400 shadow-lg animate-pulse'
            : selected
              ? 'ring-2 ring-blue-500 shadow-lg'
              : 'shadow-sm border border-[var(--card-border,#e5e7eb)] hover:shadow-md'
        }`}
        style={{ width: nodeW }}
      >
        {STATUS_COLORS[status] && (
          <div
            className="absolute top-2.5 right-2.5 w-2.5 h-2.5 rounded-full z-10"
            style={{ background: STATUS_COLORS[status], boxShadow: `0 0 6px ${STATUS_COLORS[status]}80` }}
          />
        )}

        <div className="flex rounded-2xl overflow-hidden flex-1 min-h-0" style={{ flexBasis: DEFAULT_ROW_H }}>

          {/* Cột 1 — URLs */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2" style={{ width: 170, borderRight: '1px solid #e5e7eb' }}>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide">
                URLs {inCount > 0 && <span className="text-sky-500 ml-1">+ {inCount} từ port</span>}
              </div>
              <button
                className="nodrag p-0.5 rounded hover:bg-sky-50 text-[var(--n400,#9ca3af)] hover:text-sky-500 transition-colors"
                onClick={addUrlLine}
                onMouseDown={e => e.stopPropagation()}
                title="Thêm URL"
              >
                <Plus size={11} />
              </button>
            </div>
            <div
              className="nodrag flex-1 overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] px-1 py-0.5 min-h-0"
              onPaste={handleUrlsPaste}
            >
              {urlLines.map((line, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={e => onUrlRowDragStart(e, i)}
                  onDragOver={e => onUrlRowDragOver(e, i)}
                  onDrop={e => onUrlRowDrop(e, i)}
                  onDragEnd={onUrlRowDragEnd}
                  className={`flex items-center gap-1 px-0.5 py-0.5 rounded hover:bg-[var(--n50,#f9fafb)] border-b border-[var(--card-border,#f3f4f6)] last:border-b-0 transition-colors ${
                    dragOverIdx === i && dragIdx !== i ? 'border-t-2 border-t-sky-400 bg-sky-50' : ''
                  } ${dragIdx === i ? 'opacity-40' : ''}`}
                >
                  <span className="text-[9px] text-[var(--n300,#d1d5db)] w-3 text-right flex-shrink-0 select-none">{i + 1}</span>
                  <GripVertical
                    size={10}
                    className="text-[var(--n300,#d1d5db)] cursor-grab flex-shrink-0 nodrag"
                    onMouseDown={e => e.stopPropagation()}
                  />
                  <input
                    type="text"
                    className="nodrag flex-1 min-w-0 bg-transparent text-[10px] text-[var(--sub,#374151)] focus:outline-none placeholder-[var(--n300,#d1d5db)] py-0.5"
                    placeholder={i === 0 ? 'https://youtube.com/...' : ''}
                    value={line}
                    onChange={e => updateUrlLine(i, e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const nextLines = [...urlLines]; nextLines.splice(i + 1, 0, '');
                        const nextLabels = [...urlLabels]; nextLabels.splice(i + 1, 0, null);
                        setUrlLinesAndLabels(nextLines, nextLabels);
                      }
                      if (e.key === 'Backspace' && line === '' && urlLines.length > 1) {
                        e.preventDefault();
                        deleteUrlLine(i);
                      }
                    }}
                  />
                  <button
                    className="nodrag flex-shrink-0 text-[var(--n300,#d1d5db)] hover:text-red-400 transition-colors"
                    onClick={() => deleteUrlLine(i)}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    <X size={9} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Cột 2 — Preview */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2 flex-1 overflow-hidden">
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1">Preview</div>
            <div className="nodrag flex-1 overflow-y-auto rounded-lg border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)]">
              {previewUrls.length === 0 ? (
                <div className="h-full flex items-center justify-center px-2">
                  <span className="text-[9px] text-[var(--n300,#d1d5db)] text-center leading-relaxed">Dán link để xem preview</span>
                </div>
              ) : (
                <div
                  className="grid gap-1.5 p-1.5"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}
                >
                  {previewUrls.map(url => {
                    const p = previews[url];
                    return (
                      <div key={url} className="bg-[var(--card,#fff)] rounded-lg border border-[var(--card-border,#e5e7eb)] overflow-hidden">
                        <div className="w-full aspect-[9/16] bg-[var(--n100,#f3f4f6)] flex items-center justify-center overflow-hidden">
                          {p?.status === 'done' && p.thumbnail ? (
                            <img
                              src={p.thumbnail}
                              alt=""
                              className="w-full h-full object-cover"
                              draggable={false}
                              onError={e => { e.target.style.display = 'none'; }}
                            />
                          ) : p?.status === 'loading' ? (
                            <span className="text-[8px] text-[var(--n400,#9ca3af)] px-1 text-center">Chờ tải...</span>
                          ) : (
                            <ImageOff size={16} className="text-[var(--n300,#d1d5db)]" />
                          )}
                        </div>
                        <div className="px-1 py-0.5">
                          <div className="text-[8px] text-[var(--sub,#4b5563)] truncate" title={p?.title || ''}>
                            {p?.title || (p?.status === 'loading' ? 'Chờ tải...' : url)}
                          </div>
                          <div className="text-[7px] text-[var(--n400,#9ca3af)] truncate" title={url}>{url}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cột 3 — Format & Lưu vào */}
          <div className="flex flex-col bg-[var(--n50,#f9fafb)] px-2.5 pt-3 pb-2" style={{ width: 170, borderLeft: '1px solid #e5e7eb' }}>
            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-2">Format</div>
            <div className="flex gap-1 mb-3 nodrag">
              {FORMATS.map(f => (
                <button
                  key={f}
                  className={`flex-1 px-1.5 py-1 rounded-md text-[9px] font-semibold transition-colors ${
                    cfg('output_format', 'best') === f
                      ? 'bg-sky-500 text-white'
                      : 'bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:border-[var(--n300,#d1d5db)]'
                  }`}
                  onClick={() => set('output_format', f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="border-t border-[var(--card-border,#f3f4f6)] mb-2" />

            <div className="text-[9px] text-[var(--n400,#9ca3af)] uppercase tracking-wide mb-1">Lưu vào</div>
            <div className="flex items-center gap-1">
              <input
                type="text"
                className="nodrag flex-1 min-w-0 h-5 px-1.5 rounded-md border border-[var(--card-border,#e5e7eb)] text-[9px] text-[var(--sub,#374151)] bg-[var(--card,#fff)] focus:outline-none focus:border-sky-400"
                placeholder="Mặc định"
                value={cfg('output_dir', '')}
                onChange={e => set('output_dir', e.target.value)}
              />
              <button
                className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-md border border-[var(--card-border,#e5e7eb)] text-[var(--n500,#6b7280)] hover:border-sky-400 hover:text-sky-500 transition-colors nodrag"
                title="Chọn thư mục"
                onClick={handleBrowse}
              >
                <Folder size={11} />
              </button>
            </div>
          </div>
        </div>

        {/* Status overlays */}
        {status === 'running' && (
          <div className="absolute inset-0 rounded-t-2xl flex items-center justify-center bg-[var(--card,#fff)]/80 z-20">
            <span className="text-[11px] text-amber-500 font-medium animate-pulse">Đang tải...</span>
          </div>
        )}
        {status === 'error' && (
          <div className="absolute top-2 inset-x-0 flex justify-center z-20">
            <span className="text-[10px] text-red-500 font-medium bg-red-50 px-2 py-0.5 rounded-full border border-red-200">Lỗi</span>
          </div>
        )}
        {status === 'done' && outCount > 0 && (
          <div className="absolute top-2 inset-x-0 flex justify-center z-20">
            <span className="text-[10px] text-green-600 font-medium bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
              ✓ {outCount} video
            </span>
          </div>
        )}

        {inCount > 0 && (
          <div className="absolute bottom-2 right-2 bg-sky-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-semibold z-10 px-1">
            {inCount}
          </div>
        )}

        {/* Input port: urls_in */}
        <Handle
          type="target"
          id="urls_in"
          position={Position.Left}
          className="port-handle port-handle--input"
          data-label="URLs"
          style={portStyle('array', 0, 1, 'left')}
        >
          {portGlyph('array')}
        </Handle>

        {/* Output port: files_out */}
        <Handle
          type="source"
          id="files_out"
          position={Position.Right}
          className="port-handle port-handle--output"
          data-label="Videos"
          style={portStyle('array', 0, 1, 'right')}
        >
          {portGlyph('array')}
        </Handle>
      </div>
    </div>
  );
}
