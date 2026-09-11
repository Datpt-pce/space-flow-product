// Graph Library Phase 6 (specs/space-flow-master-plan/02-graph-library.md): the first REAL Global
// Graph view, backed by the same queryEngine.js/FilterPanel.jsx Phase 5 built for Local Graph.
// Full-screen overlay (not a small corner panel like LocalGraphPanel) — a global view of the whole
// workspace deserves the room. Phase 7 adds drag-to-pin + Saved Views (LocalGraphPanel.jsx
// deliberately skips pinning — its radial-by-depth layout is already fixed/deterministic, nothing
// to fight against).
//
// Phase 9: layout runs via graphology-layout-forceatlas2's WEB WORKER build
// (`graphology-layout-forceatlas2/worker`), not the synchronous one Phase 6 shipped with — the
// Phase 3 spike measured plain main-thread FA2 (Barnes-Hut, 50 iterations) at **~5 seconds** of
// solid main-thread block at 20k nodes (docs/decisions/0014-graph-renderer-spike.md), which would
// freeze the entire app, not just this modal. The worker build spawns a real Worker (Blob-URL
// pattern, bundler-agnostic — verified in node_modules source, not assumed) that mutates the
// graphology graph's node positions directly; Sigma re-renders reactively since it's already
// subscribed to graph mutation events. Runs in short bursts (`runFA2Burst`) rather than forever,
// since nothing here needs the simulation to keep jiggling once it's settled — `.kill()` at burst
// end (or on unmount/graph-rebuild via the effect cleanup) terminates the actual Worker, which
// matters for the "no leaked worker" property (tested in global-graph-view.spec.js).

import { useEffect, useMemo, useRef, useState } from 'react';
import '@react-sigma/core/lib/style.css';
import { SigmaContainer, useLoadGraph, useSetSettings, useRegisterEvents, useSigma } from '@react-sigma/core';
import { EdgeArrowProgram, EdgeLineProgram } from 'sigma/rendering';
import Graph from 'graphology';
import FA2LayoutSupervisor from 'graphology-layout-forceatlas2/worker';
import { X } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchGlobalGraph, fetchBacklinks } from '../lib/api.js';
import { matchesQuery, resolveGroupColor, isOrphan } from './queryEngine.js';
import { TYPE_COLOR, TYPE_SIZE, parseEntityId } from './entityStyle.js';
import { FORCE_SLIDERS, DEFAULT_FORCE_SETTINGS, buildFA2Settings } from './forceControls.js';
import FilterPanel from './FilterPanel.jsx';
import SavedViewsPanel from './SavedViewsPanel.jsx';

// MVP boundary (02-graph-library.md Phase 6 task checklist): fixed page size + a banner when
// there's more — real streaming/infinite-scroll is explicitly Sau-MVP (§1).
const PAGE_LIMIT = 500;
const FA2_BURST_MS_INITIAL = 2000;
const FA2_BURST_MS_TWEAK = 1000;

// Starts a worker-backed FA2 run, auto-`kill()`s it after durationMs (calling onSettled once,
// with the graph the burst ran against), and returns a `cancel()` for early teardown (component
// unmount / graph replaced before the burst finished) — cancel never fires onSettled, since
// there's no point reapplying pins to a graph instance about to be discarded.
function runFA2Burst(graph, forceSettings, durationMs, onSettled) {
  const supervisor = new FA2LayoutSupervisor(graph, { settings: forceSettings });
  supervisor.start();
  const timer = setTimeout(() => {
    if (!supervisor.killed) supervisor.kill();
    onSettled?.();
  }, durationMs);
  return {
    cancel: () => {
      clearTimeout(timer);
      if (!supervisor.killed) supervisor.kill();
    },
  };
}

function buildGraph(entities, edges, colorGroups, ctx, pinnedPositions) {
  const graph = new Graph();
  for (const e of entities) {
    const overrideColor = resolveGroupColor(e, colorGroups, ctx);
    const pinned = pinnedPositions[e.id];
    graph.addNode(e.id, {
      label: e.label || e.id,
      size: TYPE_SIZE[e.type] || 4,
      color: overrideColor || TYPE_COLOR[e.type] || '#7f8c8d',
      entityType: e.type,
      // No single center for a global graph (unlike Local Graph's radial-by-depth) — FA2 needs
      // SOME starting scatter, random is the standard seed for it (unless the entity is pinned).
      x: pinned?.x ?? Math.random(),
      y: pinned?.y ?? Math.random(),
    });
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.sourceId) && graph.hasNode(edge.targetId) && !graph.hasEdge(edge.sourceId, edge.targetId)) {
      graph.addEdge(edge.sourceId, edge.targetId, { relation: edge.relation });
    }
  }
  return graph;
}

// graphology-layout-forceatlas2 has no native "fixed node" support (verified by reading
// iterate.js, not assumed — 02-graph-library.md Phase 7 risk note called this out explicitly) —
// every assign() call moves every node, pinned or not. The only way to actually pin one is to
// force its position back after each pass.
function reapplyPinnedPositions(graph, pinnedPositions) {
  for (const [id, pos] of Object.entries(pinnedPositions)) {
    if (graph.hasNode(id)) {
      graph.setNodeAttribute(id, 'x', pos.x);
      graph.setNodeAttribute(id, 'y', pos.y);
    }
  }
}

function GraphRenderer({ graph, forceSettings, onSelectEntity, onOpenEntity, showArrows, pinnedPositionsRef, onDragPin, pendingCameraRef }) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const setSettings = useSetSettings();
  const registerEvents = useRegisterEvents();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [menu, setMenu] = useState(null);
  const graphRef = useRef(null);
  const draggedNodeRef = useRef(null);
  const hasDraggedRef = useRef(false);

  // Full layout burst whenever the graph itself is rebuilt (data/filter/color-group changed) —
  // fresh random seed each time, off the main thread the whole time (see file header). Sigma
  // shows nodes at their initial scatter/pinned position immediately (loadGraph happens right
  // away, not after the burst) and animates live as the worker posts position updates.
  useEffect(() => {
    graphRef.current = graph;
    reapplyPinnedPositions(graph, pinnedPositionsRef.current);
    loadGraph(graph);
    if (pendingCameraRef.current) {
      sigma.getCamera().setState(pendingCameraRef.current);
      pendingCameraRef.current = null;
    }
    const handle = runFA2Burst(graph, forceSettings, FA2_BURST_MS_INITIAL, () => {
      reapplyPinnedPositions(graph, pinnedPositionsRef.current);
    });
    return () => handle.cancel();
    // forceSettings deliberately excluded here — the 2nd effect below handles slider tweaks on
    // the SAME graph instance (progressive refinement) instead of restarting from scratch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, loadGraph]);

  // Slider tweak on an already-loaded graph — burst from the CURRENT positions (not a fresh
  // random seed) so it reads as the layout "responding" to the control, not resetting.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) { isFirstRun.current = false; return; }
    if (!graphRef.current) return;
    const handle = runFA2Burst(graphRef.current, forceSettings, FA2_BURST_MS_TWEAK, () => {
      reapplyPinnedPositions(graphRef.current, pinnedPositionsRef.current);
    });
    return () => handle.cancel();
  }, [forceSettings, pinnedPositionsRef]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => { if (!draggedNodeRef.current) setHoveredNode(node); },
      leaveNode: () => setHoveredNode(null),
      downNode: (e) => { draggedNodeRef.current = e.node; hasDraggedRef.current = false; },
      // Note: if the user drags a node while a FA2 burst (worker) is still actively running
      // (within FA2_BURST_MS_INITIAL/TWEAK of a filter/color-group/slider change), the worker's
      // next position update can visually fight this drag briefly — bursts are short (1-2s) and
      // dragging mid-burst is rare in practice, so this isn't specially synchronized against.
      mousemovebody: (e) => {
        if (!draggedNodeRef.current || !graphRef.current) return;
        hasDraggedRef.current = true;
        const pos = sigma.viewportToGraph(e);
        graphRef.current.setNodeAttribute(draggedNodeRef.current, 'x', pos.x);
        graphRef.current.setNodeAttribute(draggedNodeRef.current, 'y', pos.y);
        e.preventSigmaDefault();
        e.original.preventDefault();
        e.original.stopPropagation();
      },
      mouseup: () => {
        if (draggedNodeRef.current && graphRef.current && hasDraggedRef.current) {
          const { x, y } = graphRef.current.getNodeAttributes(draggedNodeRef.current);
          onDragPin(draggedNodeRef.current, { x, y });
        }
        draggedNodeRef.current = null;
      },
      clickNode: ({ node }) => { if (!hasDraggedRef.current) onSelectEntity(node); },
      clickStage: () => { setMenu(null); onSelectEntity(null); },
      rightClickNode: (event) => {
        event.event.original.preventDefault();
        setMenu({ entityId: event.node, x: event.event.x, y: event.event.y });
      },
    });
  }, [registerEvents, onSelectEntity, onDragPin, sigma]);

  useEffect(() => {
    setSettings({
      defaultEdgeType: showArrows ? 'arrow' : 'line',
      // setSettings replaces this map wholesale (sigma.setSetting, not a deep merge) — both
      // programs must be re-declared every call or Sigma loses 'line' and throws (found the hard
      // way in LocalGraphPanel.jsx, see 02-graph-library.md §0 Phase 5 entry).
      edgeProgramClasses: { line: EdgeLineProgram, arrow: EdgeArrowProgram },
      nodeReducer: (node, attrs) => {
        if (!hoveredNode) return attrs;
        if (node === hoveredNode) return { ...attrs, highlighted: true };
        return { ...attrs, color: '#e5e7eb', label: null };
      },
      edgeReducer: (edge, attrs) => {
        if (!hoveredNode || !graphRef.current) return attrs;
        const isNeighborEdge = graphRef.current.extremities(edge).includes(hoveredNode);
        return isNeighborEdge ? { ...attrs, color: '#111827', size: 2 } : { ...attrs, hidden: true };
      },
    });
  }, [hoveredNode, showArrows, setSettings]);

  return menu ? (
    <div
      className="absolute z-50 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-lg shadow-lg py-1 text-xs"
      style={{ left: menu.x, top: menu.y }}
    >
      <button className="block w-full text-left px-3 py-1.5 hover:bg-[var(--n100,#f3f4f6)]" onClick={() => { onOpenEntity(menu.entityId); setMenu(null); }}>Mở</button>
      <button className="block w-full text-left px-3 py-1.5 hover:bg-[var(--n100,#f3f4f6)]" onClick={() => { navigator.clipboard?.writeText(menu.entityId); setMenu(null); }}>Copy ID</button>
    </div>
  ) : null;
}

function BacklinksPanel({ entityId }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setGroups(null);
    setError(null);
    fetchBacklinks(entityId)
      .then((res) => { if (!cancelled) setGroups(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [entityId]);

  if (!entityId) return null;
  const { localId } = parseEntityId(entityId);

  return (
    <div className="w-56 border-l border-[var(--card-border,#f3f4f6)] flex flex-col overflow-hidden flex-shrink-0">
      <div className="px-3 py-2 border-b border-[var(--card-border,#f3f4f6)]">
        <p className="text-[11px] font-semibold text-[var(--sub,#4b5563)] truncate" title={entityId}>{localId}</p>
        <p className="text-[10px] text-[var(--n400,#9ca3af)]">Backlinks & related</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {error && <p className="text-[10px] text-red-500">{error}</p>}
        {!error && !groups && <p className="text-[10px] text-[var(--n400,#9ca3af)] italic">Đang tải…</p>}
        {groups && Object.keys(groups).length === 0 && (
          <p className="text-[10px] text-[var(--n400,#9ca3af)] italic">Không có backlink nào.</p>
        )}
        {groups && Object.entries(groups).map(([relation, entities]) => (
          <div key={relation} className="mb-2">
            <p className="text-[10px] font-semibold text-[var(--n500,#6b7280)] uppercase tracking-wide">{relation}</p>
            {entities.map((e) => (
              <p key={e.id} className="text-[11px] text-[var(--sub,#4b5563)] truncate py-0.5" title={e.id}>{e.label || e.id}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GlobalGraphView() {
  const isOpen = useStore(s => s.isGlobalGraphOpen);
  const toggle = useStore(s => s.toggleGlobalGraph);
  const currentWorkflowId = useStore(s => s.currentWorkflowId);
  const loadFromLibrary = useStore(s => s.loadFromLibrary);
  const currentUser = useStore(s => s.currentUser);

  const [raw, setRaw] = useState(null); // { entities, edges, nextCursor }
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [colorGroups, setColorGroups] = useState([]);
  const [showArrows, setShowArrows] = useState(false);
  const [orphanOnly, setOrphanOnly] = useState(false);
  const [forceValues, setForceValues] = useState(DEFAULT_FORCE_SETTINGS);
  const [selectedEntityId, setSelectedEntityId] = useState(null);
  // Pinned positions live in a ref as the source of truth (buildGraph/reapplyPinnedPositions read
  // it fresh every call) so a drag-end never has to trigger a full graph rebuild — that would
  // re-randomize every OTHER node's position too, defeating the point of pinning one. `pinned`
  // STATE below exists only to re-render SavedViewsPanel's save payload / trigger a UI refresh.
  const pinnedPositionsRef = useRef({});
  const [, forcePinnedRerender] = useState(0);
  const pendingCameraRef = useRef(null);
  const sigmaRef = useRef(null);

  const ctx = useMemo(() => ({ currentUserId: currentUser?.id }), [currentUser]);
  const forceSettings = useMemo(() => buildFA2Settings(forceValues), [forceValues]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(null);
    fetchGlobalGraph({ limit: PAGE_LIMIT })
      .then((res) => { if (!cancelled) setRaw(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!raw) return null;
    const keptIds = new Set(
      raw.entities
        .filter((e) => matchesQuery(e, query, ctx))
        .filter((e) => !orphanOnly || isOrphan(e))
        .map((e) => e.id)
    );
    return {
      entities: raw.entities.filter((e) => keptIds.has(e.id)),
      edges: raw.edges.filter((e) => keptIds.has(e.sourceId) && keptIds.has(e.targetId)),
    };
  }, [raw, query, orphanOnly, ctx]);

  // Only rebuilt when the underlying entity/edge SET or styling changes — deliberately NOT a
  // function of pinnedPositions (see pinnedPositionsRef comment above).
  const graph = useMemo(() => {
    if (!filtered) return null;
    return buildGraph(filtered.entities, filtered.edges, colorGroups, ctx, pinnedPositionsRef.current);
  }, [filtered, colorGroups, ctx]);

  const handleDragPin = (entityId, pos) => {
    pinnedPositionsRef.current = { ...pinnedPositionsRef.current, [entityId]: pos };
    forcePinnedRerender((n) => n + 1);
  };

  const getCurrentState = () => ({
    filters: { query },
    groups: colorGroups,
    forces: forceValues,
    camera: sigmaRef.current?.getCamera().getState() ?? {},
    pinnedPositions: pinnedPositionsRef.current,
  });

  const handleApplyView = (view) => {
    setQuery(view.filters?.query ?? '');
    setColorGroups(view.groups ?? []);
    setForceValues({ ...DEFAULT_FORCE_SETTINGS, ...(view.forces ?? {}) });
    pinnedPositionsRef.current = view.pinnedPositions ?? {};
    forcePinnedRerender((n) => n + 1);
    pendingCameraRef.current = view.camera ?? null;
    // Reposition whatever's already on screen right now too — the graph rebuild above already
    // covers the case where query/groups changed, but if the view is otherwise identical, nothing
    // else would trigger a rebuild to pick up the new pinned positions or camera.
    if (graph) {
      reapplyPinnedPositions(graph, pinnedPositionsRef.current);
      if (sigmaRef.current && pendingCameraRef.current) {
        sigmaRef.current.getCamera().setState(pendingCameraRef.current);
        pendingCameraRef.current = null;
      }
    }
  };

  const handleOpenEntity = useMemo(() => (entityId) => {
    const { type, localId } = parseEntityId(entityId);
    if (type !== 'workflow') {
      setError(`"${localId}" (${type}) chưa có màn hình để mở.`);
      return;
    }
    if (localId === currentWorkflowId) return;
    loadFromLibrary(localId);
    toggle();
  }, [currentWorkflowId, loadFromLibrary, toggle]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) toggle(); }}
    >
      <div
        className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex flex-col overflow-hidden"
        style={{ width: '90vw', height: '85vh', maxWidth: 1200 }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border,#f3f4f6)] flex-shrink-0">
          <h2 className="text-sm font-semibold text-[var(--text,#111827)]">Global Graph</h2>
          <div className="flex items-center gap-1">
            <SavedViewsPanel scope="global" getCurrentState={getCurrentState} onApplyView={handleApplyView} />
            <button onClick={toggle} className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)]">
              <X size={15} />
            </button>
          </div>
        </div>

        <FilterPanel
          query={query} onQueryChange={setQuery}
          colorGroups={colorGroups} onColorGroupsChange={setColorGroups}
          showArrows={showArrows} onShowArrowsChange={setShowArrows}
          orphanOnly={orphanOnly} onOrphanOnlyChange={setOrphanOnly}
        />

        <div className="px-3 py-2 border-b border-[var(--card-border,#f3f4f6)] flex flex-wrap items-center gap-3 flex-shrink-0">
          {FORCE_SLIDERS.map(({ key, label, min, max, step }) => (
            <label key={key} className="flex items-center gap-1.5 text-[10px] text-[var(--n500,#6b7280)]">
              {label}
              <input
                type="range" min={min} max={max} step={step}
                value={forceValues[key]}
                onChange={(e) => setForceValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
                className="w-20"
              />
            </label>
          ))}
          <span className="text-[10px] text-[var(--n400,#9ca3af)] italic ml-auto">Kéo 1 node để ghim vị trí</span>
        </div>

        {raw?.nextCursor && (
          <p className="px-3 py-1 text-[10px] text-amber-600 bg-amber-50 flex-shrink-0">
            Đang hiển thị {raw.entities.length} entity đầu tiên — còn nhiều hơn, chưa hỗ trợ tải
            thêm (streaming hoãn Sau-MVP).
          </p>
        )}

        <div className="flex-1 flex overflow-hidden relative">
          {error && (
            <p className="text-[11px] text-red-500 p-3 absolute z-10 bg-[var(--card,#fff)] w-full">{error}</p>
          )}
          <div className="flex-1 relative">
            {graph && (
              <SigmaContainer
                style={{ width: '100%', height: '100%' }}
                settings={{ labelRenderedSizeThreshold: 8 }}
                ref={(sigma) => { sigmaRef.current = sigma; }}
              >
                <GraphRenderer
                  graph={graph}
                  forceSettings={forceSettings}
                  onSelectEntity={setSelectedEntityId}
                  onOpenEntity={handleOpenEntity}
                  showArrows={showArrows}
                  pinnedPositionsRef={pinnedPositionsRef}
                  onDragPin={handleDragPin}
                  pendingCameraRef={pendingCameraRef}
                />
              </SigmaContainer>
            )}
          </div>
          <BacklinksPanel entityId={selectedEntityId} />
        </div>
      </div>
    </div>
  );
}
