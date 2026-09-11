// Graph Library Phase 4 (specs/space-flow-master-plan/02-graph-library.md): first real UI on top
// of the Phase 1/2 relationship index — the local graph of whichever workflow is currently bound
// to the canvas (store.currentWorkflowId). Radial-by-depth layout is hand-written (not
// ForceAtlas2) — see 02-graph-library.md §3 phản biện #2: a local graph is ~star-shaped around 1
// center, radial is cheaper and 100% deterministic, and "distance = hop count" reads better than
// a force layout's arbitrary distances for this specific view.

import { useEffect, useMemo, useRef, useState } from 'react';
import '@react-sigma/core/lib/style.css';
import { SigmaContainer, useLoadGraph, useSetSettings, useRegisterEvents, useSigma } from '@react-sigma/core';
import { EdgeArrowProgram, EdgeLineProgram } from 'sigma/rendering';
import Graph from 'graphology';
import { X, Filter } from 'lucide-react';
import { useStore } from '../store.js';
import { fetchLocalGraph } from '../lib/api.js';
import { matchesQuery, resolveGroupColor } from './queryEngine.js';
import FilterPanel from './FilterPanel.jsx';
import SavedViewsPanel from './SavedViewsPanel.jsx';
import { TYPE_COLOR, TYPE_SIZE, parseEntityId } from './entityStyle.js';

const DEPTH_SPACING = 130;

// Places entities on concentric rings by BFS depth (root at center) — see file header for why
// this is hand-written instead of running ForceAtlas2 for the local graph.
function radialLayout(entities) {
  const byDepth = new Map();
  for (const e of entities) {
    if (!byDepth.has(e.depth)) byDepth.set(e.depth, []);
    byDepth.get(e.depth).push(e);
  }
  const positions = {};
  for (const [depth, group] of byDepth) {
    const radius = depth * DEPTH_SPACING;
    // Per-ring rotation offset so a 2-member ring (very common — e.g. 1 node_instance + 1 user)
    // doesn't always land its pair on the same 0°/180° axis as every other ring, which reads as
    // "everything in a straight line" rather than radial for small local graphs.
    const ringOffset = depth * 0.7;
    group.forEach((e, i) => {
      const angle = (2 * Math.PI * i) / group.length + ringOffset;
      positions[e.id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
  }
  return positions;
}

function buildGraph(data, colorGroups, ctx) {
  const graph = new Graph();
  const positions = radialLayout(data.entities);
  for (const e of data.entities) {
    const overrideColor = resolveGroupColor(e, colorGroups, ctx);
    graph.addNode(e.id, {
      label: e.label || e.id,
      size: TYPE_SIZE[e.type] || 4,
      color: overrideColor || TYPE_COLOR[e.type] || '#7f8c8d',
      entityType: e.type,
      ...positions[e.id],
    });
  }
  for (const edge of data.edges) {
    if (graph.hasNode(edge.sourceId) && graph.hasNode(edge.targetId) && !graph.hasEdge(edge.sourceId, edge.targetId)) {
      graph.addEdge(edge.sourceId, edge.targetId, { relation: edge.relation });
    }
  }
  return graph;
}

// Lives inside <SigmaContainer> — the graph/settings/event hooks below all need Sigma's React
// context, which only exists inside that provider.
function GraphRenderer({ data, onOpenEntity, colorGroups, ctx, showArrows, pendingCameraRef }) {
  const sigma = useSigma();
  const loadGraph = useLoadGraph();
  const setSettings = useSetSettings();
  const registerEvents = useRegisterEvents();
  const [hoveredNode, setHoveredNode] = useState(null);
  const [menu, setMenu] = useState(null); // { entityId, x, y }
  const graphRef = useRef(null);

  useEffect(() => {
    graphRef.current = buildGraph(data, colorGroups, ctx);
    loadGraph(graphRef.current);
    if (pendingCameraRef.current) {
      sigma.getCamera().setState(pendingCameraRef.current);
      pendingCameraRef.current = null;
    }
  }, [data, colorGroups, ctx, loadGraph]);

  useEffect(() => {
    registerEvents({
      enterNode: ({ node }) => setHoveredNode(node),
      leaveNode: () => setHoveredNode(null),
      clickNode: ({ node }) => onOpenEntity(node),
      rightClickNode: (event) => {
        event.event.original.preventDefault();
        setMenu({ entityId: event.node, x: event.event.x, y: event.event.y });
      },
      clickStage: () => setMenu(null),
    });
  }, [registerEvents, onOpenEntity]);

  useEffect(() => {
    setSettings({
      defaultEdgeType: showArrows ? 'arrow' : 'line',
      // setSettings replaces this map wholesale (sigma.setSetting(key, value), not a deep merge)
      // — must re-declare 'line' alongside 'arrow' or Sigma loses its default edge program and
      // throws "could not find a suitable program for edge type 'line'" the moment any edge
      // without an explicit type renders.
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
      <button
        className="block w-full text-left px-3 py-1.5 hover:bg-[var(--n100,#f3f4f6)]"
        onClick={() => { onOpenEntity(menu.entityId); setMenu(null); }}
      >
        Mở
      </button>
      <button
        className="block w-full text-left px-3 py-1.5 hover:bg-[var(--n100,#f3f4f6)]"
        onClick={() => { navigator.clipboard?.writeText(menu.entityId); setMenu(null); }}
      >
        Copy ID
      </button>
    </div>
  ) : null;
}

export default function LocalGraphPanel() {
  const isOpen = useStore(s => s.isLocalGraphOpen);
  const toggle = useStore(s => s.toggleLocalGraph);
  const currentWorkflowId = useStore(s => s.currentWorkflowId);
  const loadFromLibrary = useStore(s => s.loadFromLibrary);
  const currentUser = useStore(s => s.currentUser);

  const [depth, setDepth] = useState(2);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [colorGroups, setColorGroups] = useState([]);
  const [showArrows, setShowArrows] = useState(false);
  const rootEntityId = currentWorkflowId ? `workflow:${currentWorkflowId}` : null;
  const ctx = useMemo(() => ({ currentUserId: currentUser?.id }), [currentUser]);
  const pendingCameraRef = useRef(null);
  const sigmaRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !rootEntityId) return;
    let cancelled = false;
    setError(null);
    fetchLocalGraph(rootEntityId, depth)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [isOpen, rootEntityId, depth]);

  // Client-side only (Phase 5 risk note: round-tripping to the API per keystroke can't hit the
  // <200ms budget) — filters the page of data already fetched, same dataset Phase 6's Global
  // Graph will reuse this same query engine against.
  const filteredData = useMemo(() => {
    if (!data) return null;
    const keptIds = new Set(data.entities.filter((e) => matchesQuery(e, query, ctx)).map((e) => e.id));
    return {
      entities: data.entities.filter((e) => keptIds.has(e.id)),
      edges: data.edges.filter((e) => keptIds.has(e.sourceId) && keptIds.has(e.targetId)),
    };
  }, [data, query, ctx]);

  const handleOpenEntity = useMemo(() => (entityId) => {
    const { type, localId } = parseEntityId(entityId);
    // Only `workflow` has a real destination today — everything else (asset/sheet/video_project/
    // note placeholders, plus node_instance/node_package/user) has no screen to open yet
    // (02-graph-library.md Phase 4 risk note: "UI phải thông báo rõ, không click chết im lặng").
    if (type !== 'workflow') {
      setError(`"${localId}" (${type}) chưa có màn hình để mở.`);
      return;
    }
    if (localId === currentWorkflowId) return; // already viewing this workflow
    loadFromLibrary(localId);
  }, [currentWorkflowId, loadFromLibrary]);

  const getCurrentState = () => ({
    filters: { query },
    groups: colorGroups,
    forces: {},
    camera: sigmaRef.current?.getCamera().getState() ?? {},
    pinnedPositions: {}, // radial-by-depth is already fixed/deterministic — nothing to pin here
  });

  const handleApplyView = (view) => {
    setQuery(view.filters?.query ?? '');
    setColorGroups(view.groups ?? []);
    pendingCameraRef.current = view.camera ?? null;
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute z-40 bg-[var(--card,#fff)] border border-[var(--card-border,#e5e7eb)] rounded-2xl shadow-xl flex flex-col overflow-hidden"
      style={{ bottom: 16, right: 16, width: 420, height: 420 }}
    >
      <div className="px-3 py-2 border-b border-[var(--card-border,#f3f4f6)] flex items-center gap-2 flex-shrink-0">
        <span className="text-[11px] font-semibold text-[var(--sub,#4b5563)] flex-1">Local Graph</span>
        {rootEntityId && (
          <>
            <select
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="text-[10px] border border-[var(--card-border,#e5e7eb)] rounded-md px-1 py-0.5 bg-transparent"
              title="Depth"
            >
              <option value={1}>Depth 1</option>
              <option value={2}>Depth 2</option>
              <option value={3}>Depth 3</option>
            </select>
            <button
              onClick={() => setFilterOpen((v) => !v)}
              title="Filter"
              className={`p-1 rounded-lg transition-colors ${filterOpen ? 'bg-[var(--n900,#111827)] text-[var(--n0,#fff)]' : 'text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#4b5563)]'}`}
            >
              <Filter size={13} />
            </button>
            <SavedViewsPanel scope={rootEntityId} getCurrentState={getCurrentState} onApplyView={handleApplyView} />
          </>
        )}
        <button
          onClick={toggle}
          className="p-1 rounded-lg hover:bg-[var(--n100,#f3f4f6)] text-[var(--n400,#9ca3af)] hover:text-[var(--sub,#4b5563)] transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {rootEntityId && filterOpen && (
        <FilterPanel
          query={query}
          onQueryChange={setQuery}
          colorGroups={colorGroups}
          onColorGroupsChange={setColorGroups}
          showArrows={showArrows}
          onShowArrowsChange={setShowArrows}
        />
      )}

      <div className="flex-1 relative overflow-hidden">
        {!rootEntityId && (
          <p className="text-[11px] text-[var(--n400,#9ca3af)] italic p-3">
            Lưu workflow này vào thư viện trước để xem Local Graph.
          </p>
        )}
        {error && (
          <p className="text-[11px] text-red-500 p-3 absolute z-10 bg-[var(--card,#fff)] w-full">{error}</p>
        )}
        {rootEntityId && filteredData && (
          <SigmaContainer
            style={{ width: '100%', height: '100%' }}
            settings={{ labelRenderedSizeThreshold: 6 }}
            ref={(sigma) => { sigmaRef.current = sigma; }}
          >
            <GraphRenderer data={filteredData} onOpenEntity={handleOpenEntity} colorGroups={colorGroups} ctx={ctx} showArrows={showArrows} pendingCameraRef={pendingCameraRef} />
          </SigmaContainer>
        )}
      </div>
    </div>
  );
}
