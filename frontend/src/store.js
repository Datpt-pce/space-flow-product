import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { executeWorkflow, cleanupFiles, runResizeUploadNms, runResizeUploadV2Nms, browseFolder, browseFile, fetchMe, logout as apiLogout, createWorkflow, updateWorkflow, loadWorkflow as apiLoadWorkflow } from './lib/api.js';
import { itemToPath } from './lib/items.js';

const MAX_HISTORY = 50;

export const useStore = create(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      nodeManifests: {},
      favoriteNodeIds: [], // node ids đánh dấu sao trong NodePalette, nổi lên đầu danh sách
      isRunning: false,
      activeRunCount: 0, // số lần runWorkflow() đang chạy đồng thời (2 nhánh độc lập có thể chạy song song)
      executionLogs: [],
      nodeStatuses: {},
      nodeErrorInfo: {}, // { [nodeId]: { continued: boolean } } — phân biệt lỗi continueOnFail vs lỗi dừng hẳn workflow (not persisted)
      selectedNodeId: null,
      ndvNodeId: null, // node đang mở overlay NDV (double-click) — tách biệt với selectedNodeId (ConfigPanel)
      isPaletteOpen: false,
      paletteInsertPosition: null,
      clipboard: null,
      isLogOpen: false,
      interactionMode: 'default', // 'default' | 'pan' | 'select'
      nodeCounters: {}, // { [nodeType]: count } for sequential display numbering
      contextMenu: null, // { type: 'node'|'item', targetId, itemIndex?, x, y }
      nodeActive: {}, // { [nodeId]: false } — undefined/true means active, false means deactivated
      nodeContinueOnFail: {}, // { [nodeId]: true } — if true, a failed node doesn't abort the workflow
      nodeRetryOnFail: {}, // { [nodeId]: true } — if true, engine retries (maxTries/retryDelay defaults) before failing
      nodePinnedData: {}, // { [nodeId]: outputs } — frozen output, engine skips re-executing the node (wins over everything)
      nodeMockInput: {}, // { [nodeId]: { [portId]: value } } — sample input used only for ports with zero real connections
      nodeOutputs: {}, // { [nodeId]: outputs } — last run outputs per node (not persisted)
      nodeProgress: {}, // { [nodeId]: { percent, message } } — live progress per node (not persisted)
      itemClipboard: null, // { nodeId, filePath } for cut/copy item
      previewMedia: null, // { url, type: 'image'|'video', name }
      folderBrowserRequest: null, // { mode: 'folder'|'file', filter, resolve } — modal web fallback khi chạy Docker

      // Pages
      pages: [{ id: 'page-1', name: 'Page 1', nodes: [], edges: [] }],
      activePageId: 'page-1',

      isSettingsOpen: false,
      isWorkflowLibraryOpen: false,
      openWorkflowLibrary: () => set({ isWorkflowLibraryOpen: true }),
      closeWorkflowLibrary: () => set({ isWorkflowLibraryOpen: false }),

      // Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2 task checklist):
      // "Thêm activeModule ('flow'|'sheet') vào store, switcher trong Toolbar.jsx, App.jsx render
      // có điều kiện" — a stopgap module switch (§3 phản biện #5) until a real Workspace Shell
      // exists. Lives here (not sheet/store.js) because it's an app-shell concern shared by both
      // modules, not Sheet-specific state.
      activeModule: 'flow', // 'flow' | 'sheet'
      setActiveModule: (mod) => set({ activeModule: mod }),

      // Graph Library Phase 4 (specs/space-flow-master-plan/02-graph-library.md): which library
      // workflow (backend/db `workflows.id`) this canvas currently corresponds to, if any — set on
      // save/load, cleared by New/Import since those replace the canvas with unsaved content.
      // Needed so LocalGraphPanel knows which entity to open; nothing else in this store tracked
      // it before (saveCurrentToLibrary/loadFromLibrary used the id once and discarded it).
      currentWorkflowId: null,
      isLocalGraphOpen: false,
      toggleLocalGraph: () => set(s => ({ isLocalGraphOpen: !s.isLocalGraphOpen })),
      isGlobalGraphOpen: false,
      toggleGlobalGraph: () => set(s => ({ isGlobalGraphOpen: !s.isGlobalGraphOpen })),
      canvasSettings: { backgroundVariant: 'dots', snapToGrid: false, snapGrid: 16 },
      appearanceSettings: { theme: 'light' },

      // Auth (not persisted — session lives in the httpOnly cookie, not localStorage)
      currentUser: null,
      authChecked: false,
      checkSession: async () => {
        const user = await fetchMe().catch(() => null);
        set({ currentUser: user, authChecked: true });
      },
      setCurrentUser: (user) => set({ currentUser: user }),
      logout: async () => {
        await apiLogout().catch(() => {});
        set({ currentUser: null });
      },

      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),

      // Custom Node Platform Phase 5 — Local Node Builder. nodeBuilderPackageId: null means
      // "new draft" (blank form), a string opens that existing draft for editing.
      nodeBuilderOpen: false,
      nodeBuilderPackageId: null,
      openNodeBuilder: (packageId = null) => set({ nodeBuilderOpen: true, nodeBuilderPackageId: packageId }),
      closeNodeBuilder: () => set({ nodeBuilderOpen: false, nodeBuilderPackageId: null }),
      updateCanvasSettings: (patch) => set(s => ({ canvasSettings: { ...s.canvasSettings, ...patch } })),
      updateAppearanceSettings: (patch) => set(s => ({ appearanceSettings: { ...s.appearanceSettings, ...patch } })),

      openPreview: (data) => set({ previewMedia: data }),
      closePreview: () => set({ previewMedia: null }),

      // Chọn thư mục/file: thử dialog native (win32) trước, fallback mở modal web
      // khi backend báo lỗi platform (không phải khi user chỉ hủy dialog native)
      pickFolder: () => new Promise(async (resolve) => {
        const { path, error } = await browseFolder();
        if (path) return resolve(path);
        if (!error) return resolve(null);
        set({ folderBrowserRequest: { mode: 'folder', resolve } });
      }),
      pickFile: (filter) => new Promise(async (resolve) => {
        const { path, error } = await browseFile(filter);
        if (path) return resolve(path);
        if (!error) return resolve(null);
        set({ folderBrowserRequest: { mode: 'file', filter, resolve } });
      }),
      resolveFolderBrowser: (path) => {
        get().folderBrowserRequest?.resolve(path);
        set({ folderBrowserRequest: null });
      },

      // Undo/redo two-stack
      _undoStack: [],
      _redoStack: [],

      _pushUndo: () => {
        const s = get();
        const snap = { nodes: s.nodes, edges: s.edges };
        set({ _undoStack: [...s._undoStack.slice(-MAX_HISTORY + 1), snap], _redoStack: [] });
      },

      // Thu thập tất cả file path đang được tham chiếu bởi mọi node trên mọi page
      _gatherAllFilePaths: () => {
        const s = get();
        const paths = new Set();
        const collectFromNodes = (nodes) => {
          for (const n of nodes) {
            const cfg = n.data?.config || {};
            if (cfg.file_path) paths.add(cfg.file_path);
            if (Array.isArray(cfg.files)) cfg.files.forEach(p => { if (typeof p === 'string') paths.add(p); });
            if (cfg.cred_config_path) paths.add(cfg.cred_config_path);
            if (cfg.cred_links_path) paths.add(cfg.cred_links_path);
          }
        };
        collectFromNodes(s.nodes);
        for (const page of s.pages) {
          if (page.id !== s.activePageId && Array.isArray(page.nodes)) {
            collectFromNodes(page.nodes);
          }
        }
        return [...paths];
      },

      cleanupOrphanedFiles: () => {
        const paths = get()._gatherAllFilePaths();
        cleanupFiles(paths).catch(() => {});
      },

      undo: () => {
        const s = get();
        if (!s._undoStack.length) return;
        const prev = s._undoStack[s._undoStack.length - 1];
        const current = { nodes: s.nodes, edges: s.edges };
        set({
          nodes: prev.nodes,
          edges: prev.edges,
          _undoStack: s._undoStack.slice(0, -1),
          _redoStack: [...s._redoStack, current],
          selectedNodeId: null,
        });
      },

      redo: () => {
        const s = get();
        if (!s._redoStack.length) return;
        const next = s._redoStack[s._redoStack.length - 1];
        const current = { nodes: s.nodes, edges: s.edges };
        set({
          nodes: next.nodes,
          edges: next.edges,
          _undoStack: [...s._undoStack, current],
          _redoStack: s._redoStack.slice(0, -1),
          selectedNodeId: null,
        });
      },

      setNodes: (changes) => set(s => ({ nodes: applyNodeChanges(changes, s.nodes) })),
      setEdges: (changes) => set(s => ({ edges: applyEdgeChanges(changes, s.edges) })),
      addEdge: (edge) => {
        get()._pushUndo();
        set(s => ({ edges: [...s.edges, edge] }));
      },

      setNodeManifests: (manifests) =>
        set({ nodeManifests: Object.fromEntries(manifests.map(m => [m.id, m])) }),

      toggleFavoriteNode: (id) => set(s => ({
        favoriteNodeIds: s.favoriteNodeIds.includes(id)
          ? s.favoriteNodeIds.filter(x => x !== id)
          : [...s.favoriteNodeIds, id],
      })),

      selectNode: (id) => set({ selectedNodeId: id }),

      openNodeDetail: (id) => set({ ndvNodeId: id }),
      closeNodeDetail: () => set({ ndvNodeId: null }),

      updateNodeConfig: (nodeId, key, value) =>
        set(s => ({
          nodes: s.nodes.map(n =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
              : n
          ),
        })),

      addNodeToCanvas: (manifest, position, configOverrides = {}) => {
        get()._pushUndo();
        const id = `${manifest.id}-${Date.now()}`;
        const defaults = Object.fromEntries(
          (manifest.config || []).map(f => [f.id, f.default ?? ''])
        );
        const s = get();
        const nodeNumber = (s.nodeCounters[manifest.id] || 0) + 1;
        set(prev => ({
          nodes: [...prev.nodes, {
            id,
            type: manifest.id,
            position,
            data: { manifest, config: { ...defaults, ...configOverrides }, nodeNumber },
          }],
          nodeCounters: { ...prev.nodeCounters, [manifest.id]: nodeNumber },
        }));
        return id;
      },

      // Thanh icon quick-add khi hover port (ListNodeBeta.jsx) — thêm 1 node mới + tự nối luôn
      // edge từ port nguồn, không cần user tự kéo dây. targetHandle tự chọn port input đầu tiên
      // của targetManifest khớp `portType` (vd. 'array' cho output "files" của node List).
      addNodeToCanvasConnected: (sourceNodeId, sourceHandle, portType, targetManifest, position) => {
        const targetHandle = (targetManifest.inputs || []).find(p => p.type === portType)?.id;
        if (!targetHandle) return null;
        const newId = get().addNodeToCanvas(targetManifest, position);
        get().addEdge({
          id: `e-${sourceNodeId}-${sourceHandle}-${newId}`,
          source: sourceNodeId,
          sourceHandle,
          target: newId,
          targetHandle,
        });
        return newId;
      },

      openPalette: (insertPosition = null) => set({ isPaletteOpen: true, paletteInsertPosition: insertPosition }),
      closePalette: () => set({ isPaletteOpen: false, paletteInsertPosition: null }),

      copySelected: () => {
        const s = get();
        const selectedNodes = s.nodes.filter(n => n.selected);
        if (!selectedNodes.length) return;
        const selectedIds = new Set(selectedNodes.map(n => n.id));
        const selectedEdges = s.edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target));
        set({ clipboard: { nodes: selectedNodes, edges: selectedEdges } });
      },

      pasteClipboard: () => {
        const s = get();
        if (!s.clipboard?.nodes.length) return;
        s._pushUndo();
        const nowMs = Date.now();
        const idMap = {};
        const newNodes = s.clipboard.nodes.map((node, i) => {
          const newId = `${node.type}-${nowMs}-${i}`;
          idMap[node.id] = newId;
          return {
            ...node,
            id: newId,
            position: { x: node.position.x + 30, y: node.position.y + 30 },
            selected: true,
            data: { ...node.data, config: { ...node.data.config } },
          };
        });
        const newEdges = s.clipboard.edges.map((edge, i) => ({
          ...edge,
          id: `edge-${nowMs}-${i}`,
          source: idMap[edge.source],
          target: idMap[edge.target],
          selected: false,
        }));
        set({
          nodes: [...s.nodes.map(n => ({ ...n, selected: false })), ...newNodes],
          edges: [...s.edges, ...newEdges],
          selectedNodeId: null,
        });
      },
      toggleLog: () => set(s => ({ isLogOpen: !s.isLogOpen })),

      setInteractionMode: (mode) => set({ interactionMode: mode }),

      deleteSelected: () => {
        get()._pushUndo();
        set(s => {
          const removedIds = new Set(s.nodes.filter(n => n.selected).map(n => n.id));
          return {
            nodes: s.nodes.filter(n => !n.selected),
            edges: s.edges.filter(e =>
              !removedIds.has(e.source) && !removedIds.has(e.target) && !e.selected
            ),
            selectedNodeId: null,
          };
        });
      },

      selectAll: () => {
        set(s => ({ nodes: s.nodes.map(n => ({ ...n, selected: true })) }));
      },

      cutSelected: () => {
        const s = get();
        const selectedNodes = s.nodes.filter(n => n.selected);
        if (!selectedNodes.length) return;
        const selectedIds = new Set(selectedNodes.map(n => n.id));
        const selectedEdges = s.edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target));
        set({ clipboard: { nodes: selectedNodes, edges: selectedEdges } });
        s.deleteSelected();
      },

      duplicateNode: (nodeId) => {
        const node = get().nodes.find(n => n.id === nodeId);
        if (!node) return;
        get()._pushUndo();
        const newId = `${node.type}-${Date.now()}`;
        const newConfig = { ...node.data.config };
        // 08-E E7 (specs/.../08-v2/08-e-editor-node-and-workbench.md): a manifest field's config
        // (e.g. video-editor-workbench's `projectId`) references an EXCLUSIVE mutable resource, not
        // a plain value — a shallow config copy would leave two canvas nodes silently pointing at
        // the same underlying video project. `clearConfigOnDuplicate` in node.json opts specific
        // config keys out of the copy so the duplicate starts unbound instead.
        for (const key of node.data.manifest.clearConfigOnDuplicate || []) {
          delete newConfig[key];
        }
        set(s => ({
          nodes: [...s.nodes, {
            ...node,
            id: newId,
            position: { x: node.position.x + 30, y: node.position.y + 30 },
            selected: false,
            data: { ...node.data, config: newConfig },
          }],
        }));
      },

      buildWorkflowPayload: () => {
        const { nodes, edges, nodeActive, nodeContinueOnFail, nodeRetryOnFail, nodePinnedData, nodeMockInput } = get();
        return {
          nodes: nodes.map(n => ({
            id: n.id,
            type: n.type,
            config: n.data.config,
            active: nodeActive[n.id] !== false,
            continueOnFail: nodeContinueOnFail[n.id] === true,
            retryOnFail: nodeRetryOnFail[n.id] === true,
            pinnedData: nodePinnedData[n.id] || undefined,
            mockInput: nodeMockInput[n.id] || undefined,
          })),
          edges,
        };
      },

      runWorkflow: async (startNodeId = null, resume = false) => {
        const isFirstRun = get().activeRunCount === 0;
        set(s => ({
          // Chỉ xoá state toàn cục khi chưa có run nào khác đang chạy — 1 run
          // thứ 2 (nhánh độc lập) không được xoá trạng thái của run đang chạy dở.
          ...(isFirstRun
            ? { executionLogs: [], nodeStatuses: {}, nodeErrorInfo: {}, nodeOutputs: {}, nodeProgress: {} }
            : {}),
          activeRunCount: s.activeRunCount + 1,
          isRunning: true,
          isLogOpen: true,
        }));

        const workflow = get().buildWorkflowPayload();

        // Node id thuộc về CHÍNH lần gọi runWorkflow này (không phải toàn bộ
        // nodeStatuses) — dùng để scope xử lý lỗi cứng bên dưới, tránh 1 run lỗi
        // đánh sập trạng thái của 1 run khác đang chạy song song.
        const touchedNodeIds = new Set();

        const addLog = (nodeId, message, level = 'info') =>
          set(s => ({ executionLogs: [...s.executionLogs, { ts: Date.now(), nodeId, message, level }] }));

        try {
          await executeWorkflow(workflow, (eventType, data) => {
            if (data && data.nodeId) touchedNodeIds.add(data.nodeId);
            if (eventType === 'log') {
              addLog(data.nodeId, data.message, data.level);
              if (data.nodeId) set(s => ({ nodeStatuses: { ...s.nodeStatuses, [data.nodeId]: 'running' } }));
            } else if (eventType === 'progress') {
              const nodeId = data.nodeId;
              set(s => ({ nodeProgress: { ...s.nodeProgress, [nodeId]: { percent: data.percent, message: data.message } } }));
            } else if (eventType === 'rowResult') {
              const nodeId = data.nodeId;
              set(s => {
                const existing = s.nodeOutputs[nodeId] || {};
                return {
                  nodeOutputs: {
                    ...s.nodeOutputs,
                    [nodeId]: { ...existing, rows: { ...(existing.rows || {}), [data.row_id]: data } },
                  },
                };
              });
            } else if (eventType === 'nodeComplete') {
              const nodeId = data.nodeId;
              const outputs = data.outputs || {};
              // Disabled/pinned node: engine skipped real execution — reflect that as idle,
              // not a "done" run (no green flash/fade for a node that didn't actually execute).
              const skippedExec = data.disabled || data.pinned;
              const newStatus = skippedExec ? 'idle' : 'done';
              set(s => {
                const nodeProgress = { ...s.nodeProgress };
                delete nodeProgress[nodeId];
                return {
                  nodeStatuses: { ...s.nodeStatuses, [nodeId]: newStatus },
                  nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs },
                  nodeProgress,
                };
              });
              addLog(nodeId, data.disabled ? 'Skipped (deactivated)' : data.pinned ? 'Skipped (pinned)' : 'Complete');

              if (!skippedExec) {
                // Fade done status back to idle after 3s
                setTimeout(() => {
                  set(s => {
                    if (s.nodeStatuses[nodeId] === 'done') {
                      return { nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'idle' } };
                    }
                    return {};
                  });
                }, 3000);
              }

              // Auto-create ListNode for unconnected array outputs
              const { nodes: currentNodes, edges: currentEdges, nodeManifests, addNodeToCanvas, addEdge } = get();
              const srcNode = currentNodes.find(n => n.id === nodeId);
              const srcManifest = nodeManifests[srcNode?.type];
              if (srcNode && srcManifest?.outputs) {
                for (const outPort of srcManifest.outputs) {
                  const isConnected = currentEdges.some(
                    e => e.source === nodeId && e.sourceHandle === outPort.id
                  );
                  const outputValue = outputs[outPort.id];
                  // Item[] envelope (docs/product/node-spec/DISCUSSION.md mục 13): only file-
                  // shaped items (resolvable via itemToPath) make sense inside a ListNode's
                  // config.files (plain path strings) — generic json-record output isn't a
                  // file list, so skip auto-creating a ListNode for it.
                  const filePaths = Array.isArray(outputValue)
                    ? outputValue.map(it => itemToPath(it)).filter(Boolean)
                    : [];
                  if (!isConnected && filePaths.length > 0) {
                    const listManifest = nodeManifests['list'];
                    if (listManifest) {
                      const newListId = addNodeToCanvas(
                        listManifest,
                        { x: srcNode.position.x + 360, y: srcNode.position.y },
                        { files: filePaths }
                      );
                      addEdge({
                        id: `e-${nodeId}-${outPort.id}-${newListId}`,
                        source: nodeId,
                        sourceHandle: outPort.id,
                        target: newListId,
                        targetHandle: 'items',
                      });
                    }
                  }
                }
              }
            } else if (eventType === 'nodeError') {
              // continueOnFail: only this node turns red, the rest of the graph keeps running.
              // 'nodeError' only fires from the continueOnFail branch in executor.js — a hard
              // stop never emits it, it just throws straight to the global 'error' event below.
              const nodeId = data.nodeId;
              set(s => {
                const nodeProgress = { ...s.nodeProgress };
                delete nodeProgress[nodeId];
                return {
                  nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'error' },
                  nodeErrorInfo: { ...s.nodeErrorInfo, [nodeId]: { continued: true } },
                  nodeProgress,
                };
              });
              addLog(nodeId, data.message, 'error');
            } else if (eventType === 'error') {
              addLog(null, data.error, 'error');
              set({ isLogOpen: true });
              // Mark this run's own currently-running node(s) as a hard-stop error (workflow
              // halted) — scoped to touchedNodeIds so a run that fails doesn't also error out
              // nodes belonging to a different run happening to be executing concurrently.
              set(s => {
                const updated = { ...s.nodeStatuses };
                const errorInfo = { ...s.nodeErrorInfo };
                const nodeProgress = { ...s.nodeProgress };
                for (const id of touchedNodeIds) {
                  if (updated[id] === 'running') {
                    updated[id] = 'error';
                    errorInfo[id] = { continued: false };
                  }
                  delete nodeProgress[id];
                }
                return { nodeStatuses: updated, nodeErrorInfo: errorInfo, nodeProgress };
              });
            } else if (eventType === 'done') {
              addLog(null, 'Workflow finished');
              set({ isLogOpen: true });
            }
          }, startNodeId, resume);
        } catch (err) {
          addLog(null, `Error: ${err.message}`, 'error');
          // Stream itself failed (network drop, backend crash mid-run) — no
          // nodeError/error event ever arrived, so nodes still 'running'
          // would otherwise stay stuck on "Processing..." forever.
          set(s => {
            const updated = { ...s.nodeStatuses };
            const errorInfo = { ...s.nodeErrorInfo };
            const nodeProgress = { ...s.nodeProgress };
            for (const id of touchedNodeIds) {
              if (updated[id] === 'running') {
                updated[id] = 'error';
                errorInfo[id] = { continued: false };
              }
              delete nodeProgress[id];
            }
            return { nodeStatuses: updated, nodeErrorInfo: errorInfo, nodeProgress, isLogOpen: true };
          });
        }

        set(s => {
          const activeRunCount = Math.max(0, s.activeRunCount - 1);
          return { activeRunCount, isRunning: activeRunCount > 0 };
        });
      },

      continueWorkflow: (nodeId) => get().runWorkflow(nodeId, true),

      runNms: async (nodeId, mode) => {
        const node = get().nodes.find(n => n.id === nodeId);
        if (!node) return;
        set(s => ({
          nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'running' },
          nodeProgress: { ...s.nodeProgress, [nodeId]: undefined },
        }));

        try {
          await runResizeUploadNms(node.data.config, mode, (eventType, data) => {
            if (eventType === 'progress') {
              set(s => ({ nodeProgress: { ...s.nodeProgress, [nodeId]: { percent: data.percent, message: data.message } } }));
            } else if (eventType === 'nodeComplete') {
              const outputs = data.outputs || {};
              set(s => {
                const nodeProgress = { ...s.nodeProgress };
                delete nodeProgress[nodeId];
                return {
                  nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'done' },
                  nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs },
                  nodeProgress,
                };
              });
              setTimeout(() => {
                set(s => {
                  if (s.nodeStatuses[nodeId] === 'done') {
                    return { nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'idle' } };
                  }
                  return {};
                });
              }, 3000);
            } else if (eventType === 'error') {
              set(s => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'error' }, nodeProgress: { ...s.nodeProgress, [nodeId]: undefined } }));
            }
          });
        } catch {
          set(s => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'error' } }));
        }
      },

      runNmsV2: async (nodeId, mode) => {
        const node = get().nodes.find(n => n.id === nodeId);
        if (!node) return;
        set(s => ({
          nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'running' },
          nodeProgress: { ...s.nodeProgress, [nodeId]: undefined },
          nodeOutputs: { ...s.nodeOutputs, [nodeId]: {} },
        }));

        try {
          await runResizeUploadV2Nms(node.data.config, mode, (eventType, data) => {
            if (eventType === 'progress') {
              set(s => ({ nodeProgress: { ...s.nodeProgress, [nodeId]: { percent: data.percent, message: data.message } } }));
            } else if (eventType === 'rowResult') {
              set(s => {
                const existing = s.nodeOutputs[nodeId] || {};
                return {
                  nodeOutputs: {
                    ...s.nodeOutputs,
                    [nodeId]: { ...existing, rows: { ...(existing.rows || {}), [data.row_id]: data } },
                  },
                };
              });
            } else if (eventType === 'nodeComplete') {
              const outputs = data.outputs || {};
              set(s => {
                const nodeProgress = { ...s.nodeProgress };
                delete nodeProgress[nodeId];
                return {
                  nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'done' },
                  nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs },
                  nodeProgress,
                };
              });
              setTimeout(() => {
                set(s => {
                  if (s.nodeStatuses[nodeId] === 'done') {
                    return { nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'idle' } };
                  }
                  return {};
                });
              }, 3000);
            } else if (eventType === 'error') {
              set(s => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'error' }, nodeProgress: { ...s.nodeProgress, [nodeId]: undefined } }));
            }
          });
        } catch {
          set(s => ({ nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'error' } }));
        }
      },

      deleteNode: (nodeId) => {
        get()._pushUndo();
        set(s => ({
          nodes: s.nodes.filter(n => n.id !== nodeId),
          edges: s.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
          selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
        }));
      },

      deleteEdge: (edgeId) => {
        get()._pushUndo();
        set(s => ({ edges: s.edges.filter(e => e.id !== edgeId) }));
      },

      openContextMenu: (data) => set({ contextMenu: data }),
      closeContextMenu: () => set({ contextMenu: null }),
      toggleNodeActive: (nodeId) => set(s => ({
        nodeActive: { ...s.nodeActive, [nodeId]: s.nodeActive[nodeId] === false ? true : false },
      })),
      toggleContinueOnFail: (nodeId) => set(s => ({
        nodeContinueOnFail: { ...s.nodeContinueOnFail, [nodeId]: !s.nodeContinueOnFail[nodeId] },
      })),
      toggleRetryOnFail: (nodeId) => set(s => ({
        nodeRetryOnFail: { ...s.nodeRetryOnFail, [nodeId]: !s.nodeRetryOnFail[nodeId] },
      })),
      pinNodeOutput: (nodeId) => set(s => {
        const current = s.nodeOutputs[nodeId];
        if (!current) return {};
        return { nodePinnedData: { ...s.nodePinnedData, [nodeId]: current } };
      }),
      unpinNodeOutput: (nodeId) => set(s => {
        const next = { ...s.nodePinnedData };
        delete next[nodeId];
        return { nodePinnedData: next };
      }),
      setNodeMockInput: (nodeId, portId, value) => set(s => ({
        nodeMockInput: {
          ...s.nodeMockInput,
          [nodeId]: { ...(s.nodeMockInput[nodeId] || {}), [portId]: value },
        },
      })),

      removeItemFromNode: (nodeId, itemIndex) => {
        set(s => ({
          nodes: s.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const files = [...(n.data.config?.files || [])];
            files.splice(itemIndex, 1);
            return { ...n, data: { ...n.data, config: { ...n.data.config, files } } };
          }),
        }));
        // Dọn file nếu không còn node nào tham chiếu
        get().cleanupOrphanedFiles();
      },

      copyItemFromNode: (nodeId, itemIndex) => {
        const node = get().nodes.find(n => n.id === nodeId);
        if (!node) return;
        const files = node.data.config?.files || [];
        set({ itemClipboard: { filePath: files[itemIndex] } });
      },

      cutItemFromNode: (nodeId, itemIndex) => {
        const node = get().nodes.find(n => n.id === nodeId);
        if (!node) return;
        const files = node.data.config?.files || [];
        set({ itemClipboard: { filePath: files[itemIndex] } });
        get().removeItemFromNode(nodeId, itemIndex);
      },

      pasteItemToNode: (nodeId) => {
        const s = get();
        if (!s.itemClipboard) return;
        set(prev => ({
          nodes: prev.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const files = [...(n.data.config?.files || []), s.itemClipboard.filePath];
            return { ...n, data: { ...n.data, config: { ...n.data.config, files } } };
          }),
        }));
      },

      // --- List node Beta (ListNodeBeta.jsx) — không đổi 4 action LTS phía trên.
      // Model: config.textItems: [{id,text}], config.tableItems: [{id,cells}] (cells khớp vị trí
      // với config.headers dùng chung cho cả node), config.itemOrder: ['file:<idx>'|'text:<id>'|
      // 'row:<id>', ...], config.itemMode: 'append'|'replace'. itemOrder absent/rỗng = thứ tự mặc
      // định (files rồi textItems rồi tableItems) — xem nodes/list/execute.js cho logic đọc lại
      // giống hệt.
      _listDefaultOrder: (config) => {
        const files = (config?.files || []).filter(f => typeof f === 'string');
        const textItems = config?.textItems || [];
        const tableItems = config?.tableItems || [];
        return [...files.map((_, i) => `file:${i}`), ...textItems.map(t => `text:${t.id}`), ...tableItems.map(t => `row:${t.id}`)];
      },

      addTextItemToNode: (nodeId, text) => set(s => ({
        nodes: s.nodes.map(n => {
          if (n.id !== nodeId) return n;
          const config = n.data.config || {};
          const textItems = config.textItems || [];
          const newItem = { id: crypto.randomUUID(), text };
          const currentOrder = (config.itemOrder && config.itemOrder.length)
            ? config.itemOrder
            : get()._listDefaultOrder(config);
          const itemOrder = [...currentOrder, `text:${newItem.id}`];
          return { ...n, data: { ...n.data, config: { ...config, textItems: [...textItems, newItem], itemOrder } } };
        }),
      })),

      addFileItemsToNode: (nodeId, filePaths) => set(s => ({
        nodes: s.nodes.map(n => {
          if (n.id !== nodeId) return n;
          const config = n.data.config || {};
          const files = (config.files || []).filter(f => typeof f === 'string');
          const currentOrder = (config.itemOrder && config.itemOrder.length)
            ? config.itemOrder
            : get()._listDefaultOrder(config);
          const startIdx = files.length;
          const itemOrder = [...currentOrder, ...filePaths.map((_, i) => `file:${startIdx + i}`)];
          return { ...n, data: { ...n.data, config: { ...config, files: [...files, ...filePaths], itemOrder } } };
        }),
      })),

      editTextItemInNode: (nodeId, itemId, newText) => set(s => ({
        nodes: s.nodes.map(n => {
          if (n.id !== nodeId) return n;
          const config = n.data.config || {};
          const textItems = (config.textItems || []).map(t => (t.id === itemId ? { ...t, text: newText } : t));
          return { ...n, data: { ...n.data, config: { ...config, textItems } } };
        }),
      })),

      reorderNodeItems: (nodeId, newOrderTokens) => set(s => ({
        nodes: s.nodes.map(n => (n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...(n.data.config || {}), itemOrder: newOrderTokens } } }
          : n)),
      })),

      // Xoá theo token — renumber lại "file:N" trong itemOrder sau khi splice config.files
      // (config.files vẫn là mảng theo vị trí, không theo id — đây là chỗ dễ sai nhất).
      removeListItemBeta: (nodeId, token) => {
        set(s => ({
          nodes: s.nodes.map(n => {
            if (n.id !== nodeId) return n;
            const config = n.data.config || {};
            let files = (config.files || []).filter(f => typeof f === 'string');
            let textItems = config.textItems || [];
            let tableItems = config.tableItems || [];
            let order = (config.itemOrder && config.itemOrder.length)
              ? config.itemOrder
              : get()._listDefaultOrder(config);

            if (token.startsWith('file:')) {
              const idx = parseInt(token.slice(5), 10);
              files = files.filter((_, i) => i !== idx);
              order = order
                .filter(t => t !== token)
                .map(t => {
                  if (!t.startsWith('file:')) return t;
                  const n2 = parseInt(t.slice(5), 10);
                  return n2 > idx ? `file:${n2 - 1}` : t;
                });
            } else if (token.startsWith('text:')) {
              const itemId = token.slice(5);
              textItems = textItems.filter(t => t.id !== itemId);
              order = order.filter(t => t !== token);
            } else if (token.startsWith('row:')) {
              const rowId = token.slice(4);
              tableItems = tableItems.filter(t => t.id !== rowId);
              order = order.filter(t => t !== token);
            }
            return { ...n, data: { ...n.data, config: { ...config, files, textItems, tableItems, itemOrder: order } } };
          }),
        }));
        get().cleanupOrphanedFiles();
      },

      setItemMode: (nodeId, mode) => set(s => ({
        nodes: s.nodes.map(n => (n.id === nodeId
          ? { ...n, data: { ...n.data, config: { ...(n.data.config || {}), itemMode: mode } } }
          : n)),
      })),

      // Dán bảng tab-delimited (paste-to-table) — thêm 1 headers dùng chung cho cả node + nhiều
      // row cùng lúc. Không gộp vào addTextItemToNode/addFileItemsToNode vì shape khác hẳn.
      addTableRowsToNode: (nodeId, headers, rowsOfCells) => set(s => ({
        nodes: s.nodes.map(n => {
          if (n.id !== nodeId) return n;
          const config = n.data.config || {};
          const tableItems = config.tableItems || [];
          const currentOrder = (config.itemOrder && config.itemOrder.length)
            ? config.itemOrder
            : get()._listDefaultOrder(config);
          const newItems = rowsOfCells.map(cells => ({ id: crypto.randomUUID(), cells }));
          const itemOrder = [...currentOrder, ...newItems.map(t => `row:${t.id}`)];
          return { ...n, data: { ...n.data, config: { ...config, headers, tableItems: [...tableItems, ...newItems], itemOrder } } };
        }),
      })),

      // Sửa đúng 1 ô trong 1 row bảng (editor nhiều ô riêng biệt) — mirror editTextItemInNode,
      // địa chỉ hoá 2 chiều (rowId + cellIndex).
      editTableCellInNode: (nodeId, rowId, cellIndex, value) => set(s => ({
        nodes: s.nodes.map(n => {
          if (n.id !== nodeId) return n;
          const config = n.data.config || {};
          const tableItems = (config.tableItems || []).map(t => {
            if (t.id !== rowId) return t;
            const cells = [...t.cells];
            cells[cellIndex] = value;
            return { ...t, cells };
          });
          return { ...n, data: { ...n.data, config: { ...config, tableItems } } };
        }),
      })),

      // Cầu nối 1 chiều để ContextMenu.jsx (overlay tách biệt) yêu cầu ListNodeBeta.jsx mở chế độ
      // sửa inline cho đúng row — ListNodeBeta tự đọc + tự clear sau khi xử lý.
      listEditRequest: null,
      requestEditListItem: (nodeId, token) => set({ listEditRequest: { nodeId, token } }),
      clearListEditRequest: () => set({ listEditRequest: null }),

      setRunning: (v) => set({ isRunning: v }),
      appendLog: (entry) => set(s => ({ executionLogs: [...s.executionLogs, entry] })),
      clearLogs: () => set({ executionLogs: [], nodeStatuses: {} }),
      setNodeStatus: (id, status) =>
        set(s => ({ nodeStatuses: { ...s.nodeStatuses, [id]: status } })),

      // --- Pages ---

      switchPage: (pageId) => set(s => {
        const updatedPages = s.pages.map(p =>
          p.id === s.activePageId ? { ...p, nodes: s.nodes, edges: s.edges } : p
        );
        const newPage = updatedPages.find(p => p.id === pageId);
        if (!newPage) return {};
        return {
          pages: updatedPages,
          activePageId: pageId,
          nodes: newPage.nodes ?? [],
          edges: newPage.edges ?? [],
          selectedNodeId: null,
          _undoStack: [],
          _redoStack: [],
        };
      }),

      addPage: () => set(s => {
        const id = `page-${Date.now()}`;
        const n = s.pages.length + 1;
        // Save current working state into active page first
        const updatedPages = s.pages.map(p =>
          p.id === s.activePageId ? { ...p, nodes: s.nodes, edges: s.edges } : p
        );
        return {
          pages: [...updatedPages, { id, name: `Page ${n}`, nodes: [], edges: [] }],
          activePageId: id,
          nodes: [],
          edges: [],
          selectedNodeId: null,
          _undoStack: [],
          _redoStack: [],
        };
      }),

      deletePage: (pageId) => set(s => {
        if (s.pages.length <= 1) return {};
        const newPages = s.pages.filter(p => p.id !== pageId);
        if (s.activePageId !== pageId) return { pages: newPages };
        const firstPage = newPages[0];
        return {
          pages: newPages,
          activePageId: firstPage.id,
          nodes: firstPage.nodes ?? [],
          edges: firstPage.edges ?? [],
          selectedNodeId: null,
          _undoStack: [],
          _redoStack: [],
        };
      }),

      renamePage: (pageId, name) => set(s => ({
        pages: s.pages.map(p => p.id === pageId ? { ...p, name } : p),
      })),

      reorderPages: (fromId, toId) => set(s => {
        const from = s.pages.findIndex(p => p.id === fromId);
        const to = s.pages.findIndex(p => p.id === toId);
        if (from === -1 || to === -1 || from === to) return {};
        const next = [...s.pages];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { pages: next };
      }),

      // --- Export / Import ---

      // Builds the same "pages v2" payload used by file export AND the server-side
      // Workflow Library (backend/routes/workflows.js) — one source of truth for the shape.
      buildExportPayload: () => {
        const s = get();
        const currentPages = s.pages.map(p =>
          p.id === s.activePageId ? { ...p, nodes: s.nodes, edges: s.edges } : p
        );
        // version 2 (2026-08-06): mang theo 5 map per-node từng bị bỏ sót (docs/product/node-spec/
        // README.md mục "Known gap") — trước đó export/import chỉ có {pages,edges,nodes}, làm mất
        // continueOnFail/retryOnFail/active/pinnedData/mockInput khi chia sẻ file .json. Các map
        // này global theo node id (không tách theo page, khớp cách buildWorkflowPayload() đọc).
        return {
          version: 2,
          pages: currentPages,
          activePageId: s.activePageId,
          nodeActive: s.nodeActive,
          nodeContinueOnFail: s.nodeContinueOnFail,
          nodeRetryOnFail: s.nodeRetryOnFail,
          nodePinnedData: s.nodePinnedData,
          nodeMockInput: s.nodeMockInput,
        };
      },

      exportWorkflow: () => {
        const data = JSON.stringify(get().buildExportPayload(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow.json';
        a.click();
        URL.revokeObjectURL(url);
      },

      // Replaces the canvas with a parsed "pages v2" payload — shared by file import AND
      // "Load from Library" (backend/routes/workflows.js GET /:id returns the same shape).
      applyImportedData: (data) => {
        if (!data.pages?.length) return;
        const activePage = data.pages.find(p => p.id === data.activePageId) ?? data.pages[0];
        set({
          pages: data.pages,
          activePageId: activePage.id,
          nodes: activePage.nodes ?? [],
          edges: activePage.edges ?? [],
          nodeCounters: {},
          selectedNodeId: null,
          currentWorkflowId: null, // loadFromLibrary() re-sets this right after, if applicable
          _undoStack: [],
          _redoStack: [],
          // File cũ (version 1, trước 2026-08-06) không có 5 field này — mặc định {} thay vì
          // giữ nguyên state hiện tại, để import luôn thay thế sạch giống nodes/edges ở trên.
          nodeActive: data.nodeActive || {},
          nodeContinueOnFail: data.nodeContinueOnFail || {},
          nodeRetryOnFail: data.nodeRetryOnFail || {},
          nodePinnedData: data.nodePinnedData || {},
          nodeMockInput: data.nodeMockInput || {},
        });

        // Node versioning (docs/product/node-spec/DISCUSSION.md mục 10): chỉ cảnh báo,
        // không chặn import — savedVersion có thể lệch nếu node.json đổi sau khi lưu file này.
        const currentManifests = get().nodeManifests;
        for (const n of (activePage.nodes ?? [])) {
          const savedVersion = n.data?.manifest?.version;
          const currentVersion = currentManifests[n.type]?.version;
          if (savedVersion && currentVersion && savedVersion !== currentVersion) {
            console.warn(
              `[space-flow] Node "${n.id}" (${n.type}) được lưu với version ${savedVersion}, ` +
              `hiện tại node.json là ${currentVersion} — kiểm tra lại config/port nếu có lỗi.`
            );
          }
        }
      },

      importWorkflow: (jsonString) => {
        try {
          const data = JSON.parse(jsonString);
          get().applyImportedData(data);
        } catch {
          // Invalid JSON — silently ignore
        }
      },

      saveCurrentToLibrary: async (name, visibility) => {
        const payload = get().buildExportPayload();
        const res = await createWorkflow(name, visibility, payload);
        if (res.id) set({ currentWorkflowId: res.id });
        return res;
      },

      loadFromLibrary: async (id) => {
        const res = await apiLoadWorkflow(id);
        if (res.error) throw new Error(res.error);
        get().applyImportedData(res.payload);
        set({ currentWorkflowId: id });
      },
    }),
    {
      name: 'space-flow-state',
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        pages: s.pages,
        activePageId: s.activePageId,
        currentWorkflowId: s.currentWorkflowId,
        nodeCounters: s.nodeCounters,
        nodeActive: s.nodeActive,
        nodeContinueOnFail: s.nodeContinueOnFail,
        nodeRetryOnFail: s.nodeRetryOnFail,
        nodePinnedData: s.nodePinnedData,
        nodeMockInput: s.nodeMockInput,
        favoriteNodeIds: s.favoriteNodeIds,
        canvasSettings: s.canvasSettings,
        appearanceSettings: s.appearanceSettings,
      }),
    }
  )
);
