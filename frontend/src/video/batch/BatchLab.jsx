import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, FlaskConical, Save, RefreshCw, Film, Music, Trash2, X, GripVertical, Image as ImageIcon } from 'lucide-react';
import { useVideoStore } from '../store';
import { uploadVideoMedia, importVideoAsset, relinkVideoAsset, previewUrl } from '../../lib/api';
import { orderedCandidates } from '@shared/video-batch-planner';
import BatchBuilder, { BATCH_DRAG } from './BatchBuilder';
import BatchResults from './BatchResults';
import BatchSample from './BatchSample';
import BatchPathInput from './BatchPathInput';
import BatchMiniEditor from './BatchMiniEditor';
import BatchTrash from './BatchTrash';
import BatchInlineName from './BatchInlineName';
import BatchProjectPicker from './BatchProjectPicker';
import BatchProjectSettings from './BatchProjectSettings';
import FolderBrowserModal from '../../components/FolderBrowserModal';
import { useDialogFocus } from '../useDialogFocus';
import { batchRequest } from './batchApi';
import { vectorSvg } from '@shared/video-vector';
import './batch.css';
import AssetPreviewStatus from '../components/AssetPreviewStatus.jsx';
import { useAssetPreviewPolling } from '../useAssetPreviewPolling.js';
import { readBatchDrop } from './folderDrop.js';
import BatchCapcut from './BatchCapcut.jsx';
import BatchCapcutRender from './BatchCapcutRender.jsx';
import BatchSpeech from './BatchSpeech.jsx';

const statusLabel = { ok: 'Sẵn sàng', offline: 'Offline', error: 'Lỗi nguồn', processing: 'Đang xử lý', pending: 'Chờ nhận chỉnh sửa' };
const nameOf = asset => asset?.name || asset?.sourcePath?.split(/[\\/]/).pop() || 'Media';
const run = promise => promise.catch(() => {}); // errors remain visible in the store

export default function BatchLab() {
  useAssetPreviewPolling();
  const [initializing, setInitializing] = useState(true);
  const project = useVideoStore(s => s.batchProject), projects = useVideoStore(s => s.batchProjects);
  const storeBusy = useVideoStore(s => s.batchBusy), error = useVideoStore(s => s.batchError), dirty = useVideoStore(s => s.batchDirty);
  const busy = storeBusy || initializing;
  const assets = useVideoStore(s => s.assets), assetLoading = useVideoStore(s => s.loading);
  const [listId, setListId] = useState(() => new URLSearchParams(location.search).get('list'));
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(location.search).get('item'));
  const [newName, setNewName] = useState(''), [listName, setListName] = useState('');
  const [search, setSearch] = useState(''), [picker, setPicker] = useState(false), [trash, setTrash] = useState(false);
  const [view, setView] = useState('grid'), [importing, setImporting] = useState(false), [path, setPath] = useState('');
  const [preparedPreview, setPreparedPreview] = useState(null);
  const [activeSlot, setActiveSlot] = useState(null), [inspectorTarget, setInspectorTarget] = useState(null);
  const [inspect, setInspect] = useState(false), [contextMenu, setContextMenu] = useState(null), [miniEditor, setMiniEditor] = useState(null);
  const [dropList, setDropList] = useState(null);
  const [capcut, setCapcut] = useState(false);
  const [capcutRender, setCapcutRender] = useState(false);
  const [speechItem, setSpeechItem] = useState(null);
  const inspectorRef = useDialogFocus(() => setInspect(false), inspect && !preparedPreview && !miniEditor);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector('button')?.focus();
    const close = e => { if (!menuRef.current?.contains(e.target)) setContextMenu(null); };
    const key = e => { if (e.key === 'Escape') { setContextMenu(null); e.stopPropagation(); } };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); };
  }, [contextMenu]);
  const createId = useRef(crypto.randomUUID());
  const initialized = useRef(false);
  const state = () => useVideoStore.getState();
  const setError = message => useVideoStore.setState({ batchError: message });
  const list = project?.draft.lists.find(l => l.id === listId) || project?.draft.lists[0];
  const item = list?.items.find(i => i.id === selectedId);
  const assetFor = i => {
    const a = assets.find(a => a.id === i.sourceRef.assetId) || project?.media[i.id];
    return a?.vector ? { ...a, thumbnailUrl:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(vectorSvg({shape:a.shape}))}` } : a;
  };
  const metaFor = i => {
    const a = assetFor(i), saved = project?.media[i.id];
    return { ...i, kind: a?.kind, status: saved?.preparationPending ? 'pending' : (a?.contentHash !== (i.sourceRef.documentHash || i.sourceRef.contentHash) ? 'error' : a?.status) };
  };
  const candidates = list ? orderedCandidates({ ...list, items: list.items.map(metaFor) }) : [];
  const chosenAsset = item && assetFor(item);
  const blocked = busy || importing || project?.archived;

  useEffect(() => {
    // StrictMode replays effects. Share this initialization instead of allowing
    // a second load to collide with the store's serialized mutation boundary.
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      await state().fetchAssets();
      const all = await state().batchList(false);
      const requested = new URLSearchParams(location.search).get('lab');
      const id = requested || all[0]?.id;
      if (id) await state().batchLoad(id);
    })().catch(() => {}).finally(() => setInitializing(false));
  }, []);
  useEffect(() => {
    const warn = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function editList(fn) { state().batchEdit(p => { const target = p.draft.lists.find(l => l.id === list.id); if (target) fn(target); }); }
  function editItem(fn) { editList(l => { const target = l.items.find(i => i.id === item.id); if (target) fn(target); }); }
  function renameList(id, name) { state().batchEdit(p => { p.draft.lists.find(l => l.id === id).name = name; }); }
  function removeList(id) {
    const target = project.draft.lists.find(l => l.id === id);
    if (project.draft.tracks?.some(t => t.slots.some(s => s.listId === id))) { setError(`List “${target.name}” đang dùng trên timeline. Bỏ các block của list trước khi xóa.`); return; }
    if (target.items.length && !window.confirm(`Bỏ list “${target.name}” và ${target.items.length} item khỏi công thức? File nguồn vẫn được giữ.`)) return;
    state().batchEdit(p => { p.draft.lists = p.draft.lists.filter(l => l.id !== id); });
    if (list?.id === id) { setListId(null); setSelectedId(null); }
  }
  function renameProject(id, name) {
    if (id === project.id) state().batchEdit(p => { p.name = name; });
    else return state().batchRenameOther(id, name);
  }
  async function openProject(id) {
    if (id === project?.id) return;
    if (dirty && !window.confirm('Bỏ các thay đổi Lab chưa lưu để mở project khác?')) return;
    await state().batchLoad(id); setListId(null); setSelectedId(null); setActiveSlot(null);
    history.replaceState(null, '', `/video?${new URLSearchParams({ lab: id })}`);
  }
  async function createProject(e) {
    e.preventDefault();
    if (dirty) { setError('Lưu project hiện tại trước khi tạo project khác.'); return; }
    const created = await state().batchCreate(createId.current, newName);
    createId.current = crypto.randomUUID(); setNewName(''); setTrash(false); setListId(null); setSelectedId(null);
    await state().batchList(false);
    history.replaceState(null, '', `/video?${new URLSearchParams({ lab: created.id })}`);
  }
  function addList(e) {
    e.preventDefault(); if (!listName.trim()) return;
    const id = crypto.randomUUID();
    state().batchEdit(p => p.draft.lists.push({ id, name: listName.trim(), minRating: 0, items: [] }));
    setListId(id); setSelectedId(null); setListName('');
  }
  function addAsset(asset, targetListId = list?.id, targetProjectId = project?.id) {
    if (state().batchProject?.id !== targetProjectId) throw new Error('Project đã đổi. Asset đã nhập vào thư viện; chọn lại list để thêm.');
    const id = crypto.randomUUID();
    state().batchEdit(p => {
      const target = p.draft.lists.find(l => l.id === targetListId);
      if (!target) throw new Error('List đích đã bị bỏ. Asset vẫn có trong thư viện.');
      target.items.push({ id, sourceRef: { kind: 'media', assetId: asset.id, contentHash: asset.contentHash }, rating: 0, manualOrder: target.items.length, enabled: true });
    });
    setListId(targetListId); setSelectedId(id);
  }
  async function importFiles(files, targetListId = list?.id) {
    const targetProjectId = project.id;
    setImporting(true); setError(null);
    try {
      await uploadFiles(files, targetListId, targetProjectId);
    } catch (e) { setError(e.message); } finally { setImporting(false); }
  }
  async function uploadFiles(files, targetListId, targetProjectId) {
    for (const [index, file] of files.entries()) {
      setImporting(`Đang nhập ${index + 1}/${files.length}: ${file.name}`);
      const a = await uploadVideoMedia(file);
      useVideoStore.setState(s => ({ assets: [a, ...s.assets.filter(asset => asset.id !== a.id)], assetsVersion: s.assetsVersion + 1 }));
      if (a.status !== 'ok') throw new Error(`${file.name}: ${a.errorMessage || 'Không đọc được media.'}`);
      addAsset(a, targetListId, targetProjectId);
    }
  }
  async function importDrop(transfer, targetListId) {
    const targetProjectId = project.id;
    setImporting('Đang đọc folder…'); setError(null);
    try {
      const { folders, files } = await readBatchDrop(transfer, {
        maxFolders: 50 - project.draft.lists.length,
        maxFiles: 1000 - project.draft.lists.reduce((total, l) => total + l.items.length, 0),
      });
      if (files.length && !targetListId) throw new Error('Tạo hoặc chọn list trước khi thả file lẻ. Thả folder để tạo list mới.');
      if (state().batchProject?.id !== targetProjectId) throw new Error('Project đã đổi. Thả lại folder vào project cần nhập.');
      const groups = folders.map(folder => ({ ...folder, id: crypto.randomUUID() }));
      if (groups.length) state().batchEdit(p => {
        for (const group of groups) p.draft.lists.push({ id:group.id, name:group.name, minRating:0, items:[] });
      });
      for (const group of groups) {
        setListId(group.id); setSelectedId(null);
        await uploadFiles(group.files, group.id, targetProjectId);
      }
      await uploadFiles(files, targetListId, targetProjectId);
    } catch (e) { setError(e.message); } finally { setImporting(false); }
  }
  function acceptsDrop(e) { return [...e.dataTransfer.types].some(t => ['Files', 'application/x-video-asset'].includes(t)); }
  function dragOver(e, targetListId) {
    if (!acceptsDrop(e)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = blocked || !targetListId ? 'none' : 'copy';
    if (!blocked && targetListId) setDropList(targetListId);
  }
  function dropAssets(e, targetListId) {
    if (!acceptsDrop(e)) return;
    e.preventDefault(); e.stopPropagation(); setDropList(null);
    if (blocked || !project) return;
    const assetId = e.dataTransfer.getData('application/x-video-asset');
    if (assetId) {
      const asset = assets.find(a => a.id === assetId);
      if (!targetListId) setError('Chọn list để thêm asset.');
      else if (asset) addAsset(asset, targetListId);
      else setError('Asset không có trong thư viện. Tải lại trước khi thêm.');
    } else run(importDrop(e.dataTransfer, targetListId));
  }
  async function importPath() {
    setImporting(true); setError(null);
    try {
      const a = await importVideoAsset(path);
      useVideoStore.setState(s => ({ assets: [a, ...s.assets.filter(asset => asset.id !== a.id)], assetsVersion: s.assetsVersion + 1 }));
      addAsset(a); setPath('');
    }
    catch (e) { setError(e.message); } finally { setImporting(false); }
  }
  async function prepare() {
    await state().batchSave();
    const timelineId = await state().batchPrepare(list.id, item.id);
    setInspect(false); setContextMenu(null);
    setMiniEditor({ timelineId, projectId: project.id, listId: list.id, itemId: item.id, name: nameOf(chosenAsset) });
  }
  async function relink() {
    setImporting(true); setError(null);
    try { await relinkVideoAsset(item.sourceRef.assetId, path); await state().fetchAssets(); setPath(''); }
    catch (e) { setError(e.message); } finally { setImporting(false); }
  }
  async function archive(id = project.id) {
    const target = id === project.id ? project : projects.find(p => p.id === id), restore = !!target.archived;
    if (!restore && !window.confirm(`Chuyển Lab “${target.name}” và timeline của nó vào thùng rác? Có thể khôi phục.`)) return;
    if (id === project.id) {
      if (dirty) await state().batchSave();
      await state().batchArchive(restore);
    } else {
      await state().batchArchiveOther(id);
    }
    setTrash(!restore); await state().batchList(false);
  }
  async function reload() {
    if (dirty && !window.confirm('Bỏ thay đổi chưa lưu và tải bản Lab trên server?')) return;
    await state().fetchAssets(); if (project) await state().batchLoad(project.id);
  }
  function reorder(delta) {
    editList(l => {
      const index = l.items.findIndex(i => i.id === item.id), next = index + delta;
      if (next < 0 || next >= l.items.length) return;
      [l.items[index], l.items[next]] = [l.items[next], l.items[index]];
      l.items.forEach((i, order) => { i.manualOrder = order; });
    });
  }
  async function proxy(accept = false) {
    await state().batchSave();
    setImporting(true); setError(null);
    try {
      const p = state().batchProject;
      const updated = await batchRequest(`/${p.id}/${accept ? 'accept-proxy' : 'proxy'}`, { expectedRevision:p.revision, listId:list.id, itemId:item.id });
      useVideoStore.setState({ batchProject:updated, batchDirty:false }); await state().fetchAssets();
    } catch(e) { setError(e.message); } finally { setImporting(false); }
  }
  async function shape() {
    await state().batchSave();setImporting(true);setError(null);
    try {
      const p=state().batchProject, result=await batchRequest(`/${p.id}/shape`,{expectedRevision:p.revision,listId:list.id});
      useVideoStore.setState({batchProject:result.project,batchDirty:false});setSelectedId(result.itemId);
    } catch(e) { setError(e.message); } finally { setImporting(false); }
  }
  return <main className="batch-lab" data-analytics-feature="batch">
    <header className="batch-header">
      <a href="/video" aria-label="Về Video Editor"><ArrowLeft size={18} /></a>
      <FlaskConical size={22} /><div><h1>Batch Creative Lab</h1><p>Chuẩn bị nguồn cho công thức batch</p></div>
      <span className="batch-spacer" />
      <span role="status">{typeof importing === 'string' ? importing : busy || importing ? 'Đang xử lý…' : dirty ? 'Có thay đổi chưa lưu' : project ? 'Đã lưu' : ''}</span>
      <button className="batch-trash-button" aria-label="Thùng rác Lab" title="Thùng rác" disabled={busy || importing} onClick={() => setTrash(true)}><Trash2 size={18}/></button>
      <button disabled={busy || importing} onClick={() => run(reload())}><RefreshCw size={15} /> Tải lại</button>
      <BatchResults project={project} blocked={blocked}/>
      <button disabled={blocked || !project?.draft.tracks?.some(t => t.type === 'video' && t.slots.length)} onClick={() => setCapcut(true)}>Convert to CapCut project</button>
      <button disabled={blocked || !project} onClick={() => setCapcutRender(true)}>Render CapCut</button>
      <button className="batch-primary" disabled={blocked || !dirty} onClick={() => run(state().batchSave())}><Save size={15} /> Lưu Lab</button>
    </header>
    {error && <div role="alert" className="batch-error">{error}</div>}
    <div className="batch-project-bar">
        <BatchProjectPicker project={project} projects={projects} disabled={busy || importing} onSelect={id => run(openProject(id))} onRename={renameProject} onRemove={id => run(archive(id))}/>
        {project && <BatchProjectSettings key={project.id} project={project} busy={busy || importing} blocked={blocked} dirty={dirty} error={error} onArchive={() => run(archive())}/>}
        <form onSubmit={e => run(createProject(e))} className="batch-inline"><input aria-label="Tên project Lab mới" placeholder="Tên project mới" value={newName} maxLength={120} onChange={e => { createId.current = crypto.randomUUID(); setNewName(e.target.value); }} /><button aria-label="Tạo project Lab" disabled={busy || importing || !newName.trim()}><Plus size={16} /></button></form>

    </div>
    <div className="batch-layout">
      <aside className="batch-sidebar" aria-label="Danh sách nguồn Lab" data-drop-active={dropList === 'folders'}
        onDragOver={e => dragOver(e, project ? 'folders' : null)}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropList(null); }}
        onDrop={e => dropAssets(e, list?.id)}>
        {project && <>
          <div className="batch-section-heading"><h2>Danh sách nguồn</h2><span>{project.draft.lists.length}</span></div>
          <div className="batch-list-nav">{project.draft.lists.map(l => {
            const n = orderedCandidates({ ...l, items: l.items.map(metaFor) }).length;
            return <div key={l.id} className="batch-list-entry" draggable={!blocked} onDragStart={e => { if (e.target.tagName === 'INPUT') { e.preventDefault(); return; } e.dataTransfer.setData(BATCH_DRAG, JSON.stringify({ listId: l.id })); e.dataTransfer.effectAllowed = 'copy'; }} data-batch-list={l.id} data-drop-active={dropList === l.id} onDragOver={e => dragOver(e, l.id)} onDragLeave={() => setDropList(null)} onDrop={e => dropAssets(e, l.id)} data-selected={l.id === list?.id}>
              <BatchInlineName name={l.name} label={`Tên list ${l.name}`} prefix={<GripVertical size={13}/>} disabled={blocked} selected={l.id === list?.id} onRename={name => renameList(l.id, name)} onSelect={() => { setListId(l.id); setSelectedId(null); setPath(''); }}/><small>{n}/{l.items.length}</small><button className="batch-remove-name" aria-label={`Xóa list ${l.name}`} disabled={blocked} onClick={() => removeList(l.id)}><X size={13}/></button>
            </div>;
          })}</div>
          <form onSubmit={addList} className="batch-inline"><input aria-label="Tên list mới" placeholder="Hook, Nội dung, CTA…" disabled={blocked} maxLength={120} value={listName} onChange={e => setListName(e.target.value)} /><button aria-label="Thêm list" disabled={blocked || !listName.trim()}><Plus size={16} /></button></form>
          <p className="batch-muted">Thả folder vào đây để tạo list theo tên folder và nhập các file media bên trong.</p>
          <p className="batch-muted">Kéo list xuống Batch Timeline. Một list có thể dùng ở nhiều block.</p>
        </>}
      </aside>
      <section className="batch-library" aria-label="Asset list Lab" data-drop-active={dropList === list?.id} onDragOver={e => dragOver(e, list?.id)} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropList(null); }} onDrop={e => dropAssets(e, list?.id)}>
        {!project ? <div className="batch-empty"><FlaskConical size={40}/><h2>Tạo project đầu tiên</h2><p>Gom Hook, Nội dung và CTA thành các list riêng.<br/>Mỗi item có rating và liên kết nguồn độc lập.</p></div>
          : !list ? <div className="batch-empty"><h2>Thêm list nguồn</h2><p>Đặt tên list bên trái, rồi nhập video, ảnh hoặc audio.</p></div> : <>
          <div className="batch-section-heading"><div className="batch-inline batch-list-title"><input className="batch-title-input" aria-label="Tên list" value={list.name} maxLength={120} disabled={blocked} onChange={e => editList(l => { l.name = e.target.value; })}/><button className="batch-remove-name" aria-label={`Xóa list đang mở ${list.name}`} disabled={blocked} onClick={() => removeList(list.id)}><X size={14}/></button></div><span>{candidates.length}/{list.items.length} được dùng</span></div>
          <div className="batch-toolbar">
            <input aria-label="Tìm item Lab" placeholder="Tìm tên hoặc đường dẫn…" value={search} onChange={e => setSearch(e.target.value)}/>
            <label>Sao tối thiểu<select aria-label="Filter sao" value={list.minRating} disabled={blocked} onChange={e => editList(l => { l.minRating = Number(e.target.value); })}>{[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n} ★</option>)}</select></label>
            <button aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</button><button aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
          </div>
          <div className="batch-toolbar">
            <button disabled={blocked} onClick={() => setPicker(!picker)}>Chọn từ thư viện</button>
            <label className="batch-file-button">Nhập file<input type="file" aria-label="Nhập file vào Lab" accept="video/*,image/*,audio/*" multiple disabled={blocked} onChange={e => { run(importFiles([...e.target.files])); e.target.value = ''; }}/></label>
            <button disabled={blocked} onClick={() => run(shape())}>Thêm shape</button>
          </div>
          {picker && <div className="batch-picker" aria-label="Thư viện media Lab">{assetLoading ? 'Đang tải media…' : assets.length === 0 ? 'Chưa có media trong thư viện. Nhập file để bắt đầu.' : assets.filter(a => !search || nameOf(a).toLowerCase().includes(search.toLowerCase())).map(a => <button key={a.id} draggable={!blocked} onDragStart={e => { e.dataTransfer.setData('application/x-video-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; }} disabled={blocked} onClick={() => addAsset(a)} title={a.sourcePath}>{nameOf(a)} <span>{statusLabel[a.status]}</span></button>)}</div>}
          <div className="batch-inline"><BatchPathInput label="Đường dẫn nguồn Lab" placeholder="Đường dẫn trên máy sở hữu nguồn…" disabled={blocked} value={path} onChange={setPath} mode="file" onError={setError}/><button disabled={blocked || !path.trim()} onClick={() => run(importPath())}>Nhập đường dẫn</button></div>
          {!list.items.length && <div className="batch-empty"><h2>List chưa có asset</h2><p>Kéo thả video, ảnh, audio từ máy vào đây hoặc chọn từ thư viện.</p></div>}
          {item && <div className="batch-toolbar batch-selected-asset"><strong>{nameOf(chosenAsset)}</strong><label>Rating<select aria-label="Rating item nhanh" value={item.rating ?? 0} disabled={blocked} onChange={e => editItem(i => { i.rating = Number(e.target.value); })}>{[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n} ★</option>)}</select></label><button disabled={blocked || chosenAsset?.status !== 'ok'} onClick={() => run(prepare())}>Chỉnh bằng Video Editor</button><button disabled={blocked || chosenAsset?.status !== 'ok' || !['audio','video'].includes(chosenAsset?.kind)} onClick={() => run(state().batchSave().then(() => setSpeechItem(item.id)))}>Voice &amp; captions{item.speech ? ' ✓' : ''}</button></div>}
          <div className={`batch-items batch-items-${view}`}>
            {list.items.filter(i => { const a = assetFor(i); return !search || `${nameOf(a)} ${a?.sourcePath}`.toLowerCase().includes(search.toLowerCase()); }).map(i => {
              const a = assetFor(i), meta = metaFor(i), Icon = { video: Film, audio: Music, image: ImageIcon }[a?.kind] || Film;
              const eligible = candidates.some(c => c.id === i.id);
              return <button key={i.id} data-batch-item={i.id} data-eligible={eligible} aria-pressed={item?.id === i.id} className="batch-item" onContextMenu={e => { e.preventDefault(); setSelectedId(i.id); setContextMenu({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 100) }); }} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); setSelectedId(i.id); const r = e.currentTarget.getBoundingClientRect(); setContextMenu({x: Math.min(r.left, window.innerWidth - 220), y: Math.min(r.bottom, window.innerHeight - 100)}); } }} onClick={() => { setSelectedId(i.id); setPath(''); }}>
                <div className="batch-thumbnail">{a?.thumbnailUrl || (a?.kind === 'image' && a.status === 'ok') ? <img src={a.thumbnailUrl || previewUrl(a.sourcePath)} alt=""/> : <Icon size={28}/>}<AssetPreviewStatus asset={a} compact/></div>
                <div className="batch-item-info"><strong title={a?.sourcePath}>{nameOf(a)}</strong><small title={a?.sourcePath}>{a?.sourcePath}</small><div><span>{i.rating} ★</span><span>{a?.durationMs ? `${(a.durationMs / 1000).toFixed(1)}s` : a?.kind === 'image' ? 'Ảnh' : '—'}</span></div><p>{statusLabel[meta.status] || 'Không khả dụng'}{!eligible ? ' · Không dùng' : ''}{i.sourceRef.trim ? ' · Trim đã ghim' : ''}</p></div>
              </button>;
            })}
          </div>
        </>}
      </section>
      <aside className="batch-inspector" aria-label="Thiết lập block Lab">
        <h2>Thiết lập block</h2>
        {!project?.draft.tracks?.some(t => t.slots.some(s => s.id === activeSlot)) && <p className="batch-muted">Chọn một block list trên Batch Timeline để chỉnh nguồn, âm lượng và chuyển cảnh. Chuột phải vào asset để kiểm tra.</p>}
        <div ref={setInspectorTarget}/>
      </aside>
    </div>
    <BatchBuilder project={project} blocked={blocked} metaFor={metaFor} activeId={activeSlot} setActiveId={setActiveSlot} inspectorTarget={inspectorTarget} nameFor={i => nameOf(assetFor(i))} onRenameList={renameList} onCapcut={() => setCapcut(true)} onCapcutRender={() => setCapcutRender(true)}/>
    {capcut && <BatchCapcut project={project} onClose={() => setCapcut(false)}/>}
    {capcutRender && <BatchCapcutRender project={project} onClose={() => setCapcutRender(false)}/>}
    {speechItem && (() => { const target = project.draft.lists.flatMap(l => l.items).find(i => i.id === speechItem); return target && <BatchSpeech project={project} item={target} asset={assetFor(target)} onClose={() => setSpeechItem(null)}/>; })()}
    {inspect && item && <div className="batch-dialog-backdrop"><section ref={inspectorRef} role="dialog" aria-modal="true" aria-label="Kiểm tra asset" className="batch-dialog batch-asset-inspection">
        <div className="batch-section-heading"><h2>Kiểm tra asset</h2><div className="batch-inline"><button disabled={busy || importing} onClick={() => run(reload())}>Tải lại asset</button><button onClick={() => setInspect(false)}>Đóng kiểm tra</button></div></div>
        {!item ? <p className="batch-muted">Chọn một item để xem nguồn, đánh sao hoặc chỉnh bằng Video Editor.</p> : <>
          <h3>{nameOf(chosenAsset)}</h3>
          <AssetPreviewStatus asset={chosenAsset} allowRetry />
          {chosenAsset?.status === 'ok' && !chosenAsset.prepared && <div className="batch-preview">{chosenAsset.kind === 'image' ? <img src={chosenAsset.vector ? chosenAsset.thumbnailUrl : previewUrl(chosenAsset.sourcePath)} alt={nameOf(chosenAsset)}/> : chosenAsset.kind === 'audio' ? <audio key={item.id} controls src={previewUrl(chosenAsset.sourcePath)}/> : <video key={item.id} controls src={chosenAsset.proxyUrl || previewUrl(chosenAsset.sourcePath)}/>}</div>}
          {chosenAsset?.prepared && <><p className="batch-muted">Công thức đã ghim · bản {item.sourceRef.seq}{chosenAsset.hasNewerPreparation ? ' · Có chỉnh sửa mới trong editor' : ''}</p>
            <button disabled={blocked} onClick={() => run(batchRequest(`/${project.id}/prepared-document`,{listId:list.id,itemId:item.id}).then(setPreparedPreview).catch(e=>setError(e.message)))}>Xem công thức đã ghim</button>
            {chosenAsset.needsProxy && <p className="batch-muted">Cần render trung gian: {chosenAsset.preparedIssues.join(' ')}</p>}
            {!chosenAsset.proxyReady && <button disabled={blocked || ['queued','running'].includes(chosenAsset.proxyStatus)} onClick={() => run(proxy(chosenAsset.proxyStatus === 'done'))}>{chosenAsset.proxyStatus === 'done' ? 'Nhận proxy đã xác minh' : ['queued','running'].includes(chosenAsset.proxyStatus) ? 'Proxy đang xuất · Tải lại để kiểm tra' : 'Tạo proxy trung gian'}</button>}
            {chosenAsset.proxyReady && <p className="batch-muted">Proxy đã xác minh · giữ nguyên pin công thức · Dùng {(chosenAsset.durationMs/1000).toFixed(2)} s</p>}
          </>}
          <p className="batch-path" title={chosenAsset?.sourcePath}>{chosenAsset?.sourcePath}</p>
          <label>Rating<select aria-label="Rating item" value={item.rating ?? 0} disabled={blocked} onChange={e => editItem(i => { i.rating = Number(e.target.value); })}>{[0,1,2,3,4,5].map(n => <option key={n} value={n}>{n} ★</option>)}</select></label>
          <label className="batch-checkbox"><input type="checkbox" checked={item.enabled !== false} disabled={blocked} onChange={e => editItem(i => { i.enabled = e.target.checked; })}/>Dùng item trong batch</label>
          <div className="batch-inline"><button disabled={blocked || list.items[0].id === item.id} onClick={() => reorder(-1)}>Lên</button><button disabled={blocked || list.items.at(-1).id === item.id} onClick={() => reorder(1)}>Xuống</button></div>
          <button disabled={blocked || chosenAsset?.status !== 'ok'} onClick={() => run(prepare())}>{item.preparation ? 'Mở lại timeline chuẩn bị' : 'Chỉnh bằng Video Editor'}</button>
          {project.media[item.id]?.preparationPending && <p className="batch-muted">Có chỉnh sửa chưa nhận. Mở timeline để nhận trim; edit nhiều clip/effect sẽ cần prepared composition.</p>}
          {item.sourceRef.trim && <p className="batch-muted">Trim đã ghim: {(item.sourceRef.trim.sourceInMs / 1000).toFixed(2)}–{(item.sourceRef.trim.sourceOutMs / 1000).toFixed(2)}s · bản {item.sourceRef.trim.seq}</p>}
          {chosenAsset?.status !== 'ok' && !chosenAsset?.prepared && <><p className="batch-muted">Chọn lại file có cùng nội dung để nối lại nguồn.</p><BatchPathInput label="Đường dẫn relink Lab" mode="file" value={path} onChange={setPath} disabled={blocked} onError={setError}/><button disabled={blocked || !path.trim()} onClick={() => run(relink())}>Relink item</button></>}
          <button disabled={blocked} onClick={() => { state().batchEdit(p => {
            const target = p.draft.lists.find(l => l.id === list.id); target.items = target.items.filter(i => i.id !== item.id); target.items.forEach((i, n) => { i.manualOrder = n; });
            for (const slot of p.draft.tracks.flatMap(t => t.slots).filter(s => s.listId === list.id)) {
              if (slot.selectedItemIds) slot.selectedItemIds = slot.selectedItemIds.filter(id => id !== item.id);
              if (slot.fixedItemId === item.id) { delete slot.fixedItemId; slot.selectedItemIds = []; }
            }
          }); setSelectedId(null); setInspect(false); }}>Bỏ item khỏi list</button>
        </>}
      </section></div>}
    {contextMenu && item && <div ref={menuRef} role="menu" aria-label="Thao tác asset" className="batch-context-menu" style={{left:contextMenu.x,top:contextMenu.y}}><button role="menuitem" onClick={() => { setContextMenu(null); setInspect(true); }}>Kiểm tra asset</button><button role="menuitem" disabled={blocked || chosenAsset?.status !== 'ok'} onClick={() => run(prepare())}>Chỉnh bằng Video Editor</button></div>}
    {trash && <BatchTrash onClose={() => setTrash(false)} onChanged={async () => {
      const previousId = state().batchProject?.id;
      const all = await state().batchList(false);
      if (state().batchProject && all.some(p => p.id === state().batchProject.id)) { if (!state().batchDirty) await state().batchLoad(state().batchProject.id); }
      else if (all.length) await state().batchLoad(all[0].id);
      else useVideoStore.setState({ batchProject:null, batchRuns:[], batchRun:null, batchDirty:false });
      const nextId = state().batchProject?.id;
      if (previousId !== nextId) {
        setListId(null); setSelectedId(null); setActiveSlot(null);
        history.replaceState(null, '', nextId ? `/video?${new URLSearchParams({ lab: nextId })}` : '/video?lab');
      }
    }}/>}
    {miniEditor && <BatchMiniEditor context={miniEditor} onClose={nextItemId => run((async () => {
      setMiniEditor(null); if (nextItemId) setSelectedId(nextItemId);
      await reload();
    })())}/>}
    <FolderBrowserModal/>
    {preparedPreview && <BatchSample document={preparedPreview} onClose={() => setPreparedPreview(null)}/>}
  </main>;
}
