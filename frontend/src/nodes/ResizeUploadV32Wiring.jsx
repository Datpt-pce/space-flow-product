import ResizeAddOn from './ResizeAddOn.jsx';
import ResizeResultLinks from './ResizeResultLinks.jsx';
import { useLayoutEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { basename, inputCls, MODES } from './resizeUploadShared.jsx';

const button = 'px-2 py-1 rounded-lg bg-[var(--n100,#f3f4f6)] hover:bg-[var(--n200,#e5e7eb)] disabled:opacity-50';
const card = 'relative rounded-xl border border-[var(--card-border,#e5e7eb)] bg-[var(--card,#fff)] p-3';
const colors = ['#ef4444', '#3b82f6', '#8b5cf6', '#059669', '#d97706'];

export default function ResizeUploadV32Wiring({ rows, folders, upstreamFolders, catalog, onRows, onFolders, onTask, onMessage, onRecognize, makeRow, output, disabled, rowErrors = {} }) {
  const board = useRef(null);
  const origin = useRef(null);
  const [pending, setPending] = useState(null);
  const [pointer, setPointer] = useState(null);
  const [points, setPoints] = useState({});
  const [selection, setSelection] = useState([]);
  const [target, setTarget] = useState('');
  const allFolders = [...new Set([...folders, ...upstreamFolders, ...rows.flatMap(row => row.input_folders)])];
  const apps = [...new Set(rows.map(row => row.app).filter(Boolean))];
  const platforms = apps.flatMap(app => Object.entries(catalog[app]?.platforms || {}).map(([key, value]) => ({ app, key, ...value })));
  const changeRow = (id, fields) => onRows(rows.map(row => row.id === id ? { ...row, ...fields } : row));
  const selectedRows = rows.filter(row => row.selected);
  const count = selectedRows.reduce((sum, row) => sum + new Set(row.input_folders).size * new Set(row.platforms).size, 0);
  const unused = allFolders.filter(path => !selectedRows.some(row => row.input_folders.includes(path))).length;
  const portData = {};
  allFolders.forEach((path, i) => { portData[`f-${i}`] = { kind: 'folder', path }; });
  rows.forEach(row => { portData[`in-${row.id}`] = { kind: 'input', row }; portData[`out-${row.id}`] = { kind: 'output', row }; });
  platforms.forEach((platform, i) => { portData[`p-${i}`] = { kind: 'platform', platform }; });
  const wires = rows.flatMap((row, i) => [
    ...row.input_folders.map(path => ({ from: `f-${allFolders.indexOf(path)}`, to: `in-${row.id}`, color: colors[i % colors.length], active: row.selected,
      label: `Gỡ dây ${basename(path)} → Nhánh ${i + 1}`, remove: () => changeRow(row.id, { input_folders: row.input_folders.filter(p => p !== path) }) })),
    ...row.platforms.map(key => ({ from: `out-${row.id}`, to: `p-${platforms.findIndex(p => p.app === row.app && p.key === key)}`, color: colors[i % colors.length], active: row.selected,
      label: `Gỡ dây Nhánh ${i + 1} → ${catalog[row.app]?.platforms?.[key]?.name || key}`, remove: () => changeRow(row.id, { platforms: row.platforms.filter(p => p !== key) }) })),
  ]);

  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const scale = rect.width / element.offsetWidth || 1;
      const next = {};
      element.querySelectorAll('[data-wire-port]').forEach(port => {
        const box = port.getBoundingClientRect();
        next[port.dataset.wirePort] = { x: (box.left + box.width / 2 - rect.left) / scale, y: (box.top + box.height / 2 - rect.top) / scale };
      });
      setPoints(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.querySelectorAll('[data-wire-card]').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [JSON.stringify(allFolders), JSON.stringify(rows), JSON.stringify(platforms)]);

  const connect = (from, to) => {
    if (disabled) return;
    const a = portData[from], b = portData[to];
    if (!a || !b || from === to) return;
    if (a.kind === 'folder' && b.kind === 'input') {
      const paths = b.row.input_folders;
      changeRow(b.row.id, { input_folders: paths.includes(a.path) ? paths.filter(p => p !== a.path) : [...paths, a.path] });
    } else if (a.kind === 'output' && b.kind === 'platform' && a.row.app === b.platform.app) {
      const keys = a.row.platforms;
      changeRow(a.row.id, { platforms: keys.includes(b.platform.key) ? keys.filter(p => p !== b.platform.key) : [...keys, b.platform.key] });
    } else {
      onMessage('Nối Folder → cổng trái nhánh, hoặc cổng phải nhánh → nền tảng thuộc App của nhánh.');
    }
  };
  const finish = event => {
    if (!origin.current) return;
    const to = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-wire-port]')?.dataset.wirePort;
    const from = origin.current;
    origin.current = null;
    if (to && to !== from) { connect(from, to); setPending(null); setPointer(null); }
  };
  const port = (key, label, side, color = '#ef4444') => <button type="button" aria-label={label} title={`${label} — kéo dây hoặc bấm hai cổng; nối lại để gỡ`} data-wire-port={key} disabled={disabled}
    className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-[3px] border-[var(--card,#fff)] shadow-sm cursor-crosshair ${pending === key ? 'ring-2 ring-red-400' : ''}`}
    style={{ [side]: -10, background: color }}
    onPointerDown={event => { event.stopPropagation(); origin.current = key; if (['folder', 'output'].includes(portData[key].kind)) { setPending(key); setPointer(null); } }}
    onClick={event => { event.stopPropagation(); if (pending && pending !== key) { connect(pending, key); setPending(null); setPointer(null); } else if (['folder', 'output'].includes(portData[key].kind)) setPending(key); }} />;
  const curve = (a, b) => `M ${a.x},${a.y} C ${a.x + 45},${a.y} ${b.x - 45},${b.y} ${b.x},${b.y}`;

  return <div className="nodrag nowheel flex-1 min-h-0 flex flex-col text-[11px]" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { setPending(null); setPointer(null); } }}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
      <p aria-label="Tổng hợp nối dây"><strong>{allFolders.length} nhóm · {selectedRows.length} nhánh · {count} tổ hợp nhóm/nền tảng</strong>{unused > 0 && <span className="text-amber-600"> · {unused} nhóm chưa nối vào nhánh đang chọn, sẽ bỏ qua</span>}</p>
      <button className={button} disabled={disabled} onClick={() => onRows([...rows, makeRow()])}><Plus size={12} className="inline" /> Thêm nhánh Asana</button>
    </div>
    <div className="text-[10px] text-[var(--sub,#6b7280)] mb-2">Kéo từ chấm tròn sang cổng đích, hoặc bấm lần lượt hai cổng. Bấm dây để gỡ. Có thể chọn nhiều nhóm rồi nối cùng lúc.</div>
    <div className="overflow-auto min-h-[210px] flex-1 border border-[var(--card-border,#e5e7eb)] rounded-xl">
      <fieldset disabled={disabled} className="min-w-[990px] min-h-full border-0 p-4" onPointerUp={finish} onPointerCancel={() => { origin.current = null; setPending(null); setPointer(null); }}>
        <div className="grid grid-cols-[240px_1fr_210px] gap-x-20 mb-3 font-semibold text-[var(--sub,#6b7280)]"><span>1. NHÓM INPUT</span><span>2. NHÁNH ASANA / CẤU HÌNH</span><span>3. NỀN TẢNG</span></div>
        <div ref={board} className="relative grid grid-cols-[240px_1fr_210px] gap-x-20 items-start" onPointerMove={event => {
          if (!pending) return;
          const rect = board.current.getBoundingClientRect(), scale = rect.width / board.current.offsetWidth || 1;
          setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
        }}>
          <svg className="absolute inset-0 w-full h-full overflow-visible pointer-events-none" aria-label="Dây kết nối">
            {wires.map(wire => points[wire.from] && points[wire.to] && <g key={`${wire.from}-${wire.to}`}>
              <path d={curve(points[wire.from], points[wire.to])} fill="none" stroke={wire.color} strokeWidth="2" opacity={wire.active ? 0.7 : 0.2} />
              <path role="button" aria-label={wire.label} tabIndex={disabled ? -1 : 0} d={curve(points[wire.from], points[wire.to])} fill="none" stroke="transparent" strokeWidth="14" className="pointer-events-auto cursor-pointer" onClick={() => { if (!disabled) wire.remove(); }} onKeyDown={event => { if (!disabled && ['Enter', ' ', 'Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); wire.remove(); } }} />
            </g>)}
            {pending && pointer && points[pending] && <path d={curve(points[pending], pointer)} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="5 4" />}
          </svg>
          <div className="flex flex-col gap-2">
            <div className={card} data-wire-card><button className={button} onClick={onRecognize}>Nhận diện / sửa Input</button><p className="mt-2 text-[10px]">Mỗi cổng là một nhóm Theme / mã App / thoại × chữ.</p></div>
            {allFolders.length > 0 && <div className={`${card} flex flex-col gap-2`} data-wire-card>
              <label><input aria-label="Chọn tất cả folder để nối" type="checkbox" checked={allFolders.every(path => selection.includes(path))} onChange={e => setSelection(e.target.checked ? allFolders : [])} /> Chọn nhiều ({selection.filter(p => allFolders.includes(p)).length})</label>
              <select aria-label="Nhánh nhận folder đã chọn" className={inputCls} value={target} onChange={e => setTarget(e.target.value)}><option value="">Chọn nhánh…</option>{rows.map((row, i) => <option key={row.id} value={row.id}>Nhánh {i + 1} · {catalog[row.app]?.name || 'Chưa chọn App'}</option>)}</select>
              <button className={button} disabled={!selection.length || !rows.some(row => row.id === target)} onClick={() => { const row = rows.find(row => row.id === target); changeRow(row.id, { input_folders: [...new Set([...row.input_folders, ...selection.filter(p => allFolders.includes(p))])] }); setSelection([]); }}>Nối folder đã chọn</button>
            </div>}
            {allFolders.map((path, i) => <div key={path} className={`${card} flex items-center gap-2`} data-wire-card>
              <input aria-label={`Chọn folder ${basename(path)}`} type="checkbox" checked={selection.includes(path)} onChange={e => setSelection(e.target.checked ? [...selection, path] : selection.filter(p => p !== path))} />
              <span className="truncate flex-1" title={path}>{basename(path)}</span>
              {port(`f-${i}`, `Nối folder ${basename(path)}`, 'right')}
            </div>)}
          </div>
          <div className="flex flex-col gap-4">
            {rows.map((row, i) => <div key={row.id} aria-invalid={!!(rowErrors[row.id] || output?.rows?.[row.id]?.error)} className={card} style={{ borderTop: `3px solid ${colors[i % colors.length]}`, opacity: row.selected ? 1 : 0.55, ...(rowErrors[row.id] || output?.rows?.[row.id]?.error ? { background: 'color-mix(in srgb, #ef4444 10%, var(--card, #fff))', outline: '1px solid #f87171' } : {}) }} data-wire-card>
              {port(`in-${row.id}`, `Folder vào nhánh ${i + 1}`, 'left', colors[i % colors.length])}
              {port(`out-${row.id}`, `Nền tảng từ nhánh ${i + 1}`, 'right', colors[i % colors.length])}
              <div className="flex justify-between mb-2"><label className="font-semibold"><input aria-label={`Chọn nhánh ${i + 1}`} type="checkbox" checked={!!row.selected} onChange={e => changeRow(row.id, { selected: e.target.checked })} /> Nhánh {i + 1}</label><button aria-label={`Xóa nhánh ${i + 1}`} onClick={() => { onFolders(allFolders.filter(p => !upstreamFolders.includes(p))); onRows(rows.filter(r => r.id !== row.id)); }}><X size={13} /></button></div>
              <select aria-label={`App nhánh ${i + 1}`} className={`${inputCls} mb-2`} value={row.app} onChange={e => changeRow(row.id, { app: e.target.value, platforms: [] })}><option value="">Chọn App…</option>{Object.entries(catalog).map(([key, app]) => <option key={key} value={key}>{app.name}</option>)}</select>
              <textarea aria-label={`Asana nhánh ${i + 1}`} className={`${inputCls} h-12 resize-none`} placeholder="Task Asana URL (mỗi dòng một task)" value={row.task_urls} onChange={e => changeRow(row.id, { task_urls: e.target.value })} />
              <button className="text-red-500 mt-1 mb-2" onClick={() => onTask(row.id)}>Chọn từ Asana</button>
              <div className="flex flex-wrap gap-3 items-center">
                <label>Resize <select aria-label={`Resize nhánh ${i + 1}`} className="bg-[var(--n100,#f3f4f6)] rounded p-1" value={row.mode} onChange={e => changeRow(row.id, { mode: e.target.value })}>{MODES.map(mode => <option key={mode.value} value={mode.value}>{mode.value.startsWith('4') ? '4' : mode.value.startsWith('3') ? '3' : '8'}</option>)}</select></label>
                <label><input aria-label={`Thumbnail nhánh ${i + 1}`} type="checkbox" checked={row.export_thumbnail !== false} onChange={e => changeRow(row.id, { export_thumbnail: e.target.checked })} /> Thumb</label>
                <label><input aria-label={`Drive nhánh ${i + 1}`} type="checkbox" checked={row.use_unc !== false} onChange={e => changeRow(row.id, { use_unc: e.target.checked })} /> Drive</label>
                <label><input aria-label={`Hôm nay nhánh ${i + 1}`} type="checkbox" checked={row.use_today_date !== false} onChange={e => changeRow(row.id, { use_today_date: e.target.checked })} /> Hôm nay</label>
                {row.use_today_date === false && <input aria-label={`Ngày nhánh ${i + 1}`} className={inputCls} placeholder="YYMMDD" value={row.custom_date} onChange={e => changeRow(row.id, { custom_date: e.target.value })} />}
                <ResizeAddOn row={row} scope={`nhánh ${i + 1}`} onChange={fields => changeRow(row.id, fields)} />
              </div>
              <div className="mt-2 text-[10px] text-[var(--sub,#6b7280)]">{row.input_folders.length} nhóm → {row.platforms.length} nền tảng · {row.input_folders.length * row.platforms.length} tổ hợp</div>
              {!!row.platforms.length && <div className="mt-1 flex flex-wrap gap-1">{row.platforms.map(key => <button key={key} className={button} aria-label={`Gỡ nền tảng ${key} nhánh ${i + 1}`} onClick={() => changeRow(row.id, { platforms: row.platforms.filter(p => p !== key) })}>{catalog[row.app]?.platforms?.[key]?.name || key} ×</button>)}</div>}
              {rowErrors[row.id] ? <div className="mt-2 text-red-500">{rowErrors[row.id]}</div> : output?.rows?.[row.id] && <div className={`mt-2 ${output.rows[row.id].status === 'done' ? 'text-green-600' : 'text-red-500'}`}>{output.rows[row.id].status === 'done' ? '✓ Xong' : output.rows[row.id].error}</div>}
              <ResizeResultLinks links={output?.rows?.[row.id]?.unc_links} thumbnailLinks={output?.rows?.[row.id]?.thumbnail_links} row={row} catalog={catalog} />
            </div>)}
            {!rows.length && <p className={card}>Thêm nhánh Asana để bắt đầu nối dây.</p>}
          </div>
          <div className="flex flex-col gap-3">
            {platforms.map((platform, i) => <div key={`${platform.app}-${platform.key}`} className={card} data-wire-card>
              {port(`p-${i}`, `Nối nền tảng ${platform.app} ${platform.key}`, 'left')}
              <div className="text-[10px] text-[var(--sub,#6b7280)]">{catalog[platform.app]?.name}</div>
              <div className="font-semibold mt-1">{platform.name || platform.key}</div><div className="text-[10px] mt-1">{platform.code || 'Chưa có mã app'}</div>
            </div>)}
            {!platforms.length && <p className={card}>Chọn App trong nhánh để hiện các nền tảng có thể nối.</p>}
          </div>
        </div>
      </fieldset>
    </div>
    {pending && <p role="status" className="text-red-500 mt-1">Đang nối dây — chọn cổng đích. Esc để hủy.</p>}
  </div>;
}
