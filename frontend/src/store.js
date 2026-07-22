import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { executeWorkflow, cleanupFiles, runResizeUploadNms, runResizeUploadV2Nms, browseFolder, browseFile } from './lib/api.js';

const MAX_HISTORY = 50;

export const useStore = create(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      nodeManifests: {},
      isRunning: false,
      executionLogs: [],
      nodeStatuses: {},
      selectedNodeId: null,
      isPaletteOpen: false,
      paletteInsertPosition: null,
      clipboard: null,
      isLogOpen: false,
      interactionMode: 'default', // 'default' | 'pan' | 'select'
      nodeCounters: {}, // { [nodeType]: count } for sequential display numbering
      contextMenu: null, // { type: 'node'|'item', targetId, itemIndex?, x, y }
      nodeActive: {}, // { [nodeId]: false } — undefined/true means active, false means deactivated
      nodeOutputs: {}, // { [nodeId]: outputs } — last run outputs per node (not persisted)
      nodeProgress: {}, // { [nodeId]: { percent, message } } — live progress per node (not persisted)
      itemClipboard: null, // { nodeId, filePath } for cut/copy item
      previewMedia: null, // { url, type: 'image'|'video', name }
      folderBrowserRequest: null, // { mode: 'folder'|'file', filter, resolve } — modal web fallback khi chạy Docker

      // Pages
      pages: [{ id: 'page-1', name: 'Page 1', nodes: [], edges: [] }],
      activePageId: 'page-1',

      isSettingsOpen: false,
      canvasSettings: { backgroundVariant: 'dots', snapToGrid: false, snapGrid: 16 },

      openSettings: () => set({ isSettingsOpen: true }),
      closeSettings: () => set({ isSettingsOpen: false }),
      updateCanvasSettings: (patch) => set(s => ({ canvasSettings: { ...s.canvasSettings, ...patch } })),

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
            if (Array.isArray(cfg.files)) cfg.files.forEach(p => paths.add(p));
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

      selectNode: (id) => set({ selectedNodeId: id }),

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
        set(s => ({
          nodes: [...s.nodes, {
            ...node,
            id: newId,
            position: { x: node.position.x + 30, y: node.position.y + 30 },
            selected: false,
            data: { ...node.data, config: { ...node.data.config } },
          }],
        }));
      },

      runWorkflow: async (startNodeId = null) => {
        if (get().isRunning) return;
        set({ executionLogs: [], nodeStatuses: {}, nodeOutputs: {}, nodeProgress: {}, isRunning: true, isLogOpen: true });

        const { nodes, edges } = get();
        const workflow = {
          nodes: nodes.map(n => ({ id: n.id, type: n.type, config: n.data.config })),
          edges,
        };

        const addLog = (nodeId, message, level = 'info') =>
          set(s => ({ executionLogs: [...s.executionLogs, { ts: Date.now(), nodeId, message, level }] }));

        try {
          await executeWorkflow(workflow, (eventType, data) => {
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
              set(s => {
                const nodeProgress = { ...s.nodeProgress };
                delete nodeProgress[nodeId];
                return {
                  nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'done' },
                  nodeOutputs: { ...s.nodeOutputs, [nodeId]: outputs },
                  nodeProgress,
                };
              });
              addLog(nodeId, 'Complete');

              // Fade done status back to idle after 3s
              setTimeout(() => {
                set(s => {
                  if (s.nodeStatuses[nodeId] === 'done') {
                    return { nodeStatuses: { ...s.nodeStatuses, [nodeId]: 'idle' } };
                  }
                  return {};
                });
              }, 3000);

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
                  if (!isConnected && Array.isArray(outputValue) && outputValue.length > 0) {
                    const listManifest = nodeManifests['list'];
                    if (listManifest) {
                      const newListId = addNodeToCanvas(
                        listManifest,
                        { x: srcNode.position.x + 360, y: srcNode.position.y },
                        { files: outputValue }
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
            } else if (eventType === 'error') {
              addLog(null, data.error, 'error');
              set({ isLogOpen: true });
              // Mark all currently-running nodes as error
              set(s => {
                const updated = { ...s.nodeStatuses };
                for (const [id, status] of Object.entries(updated)) {
                  if (status === 'running') updated[id] = 'error';
                }
                return { nodeStatuses: updated, nodeProgress: {} };
              });
            } else if (eventType === 'done') {
              addLog(null, 'Workflow finished');
              set({ isLogOpen: true });
            }
          }, startNodeId);
        } catch (err) {
          addLog(null, `Error: ${err.message}`, 'error');
          set({ isLogOpen: true });
        }

        set({ isRunning: false });
      },

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

      exportWorkflow: () => {
        const s = get();
        const currentPages = s.pages.map(p =>
          p.id === s.activePageId ? { ...p, nodes: s.nodes, edges: s.edges } : p
        );
        const data = JSON.stringify({ version: 1, pages: currentPages, activePageId: s.activePageId }, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workflow.json';
        a.click();
        URL.revokeObjectURL(url);
      },

      importWorkflow: (jsonString) => {
        try {
          const data = JSON.parse(jsonString);
          if (!data.pages?.length) return;
          const activePage = data.pages.find(p => p.id === data.activePageId) ?? data.pages[0];
          set({
            pages: data.pages,
            activePageId: activePage.id,
            nodes: activePage.nodes ?? [],
            edges: activePage.edges ?? [],
            nodeCounters: {},
            selectedNodeId: null,
            _undoStack: [],
            _redoStack: [],
          });
        } catch {
          // Invalid JSON — silently ignore
        }
      },
    }),
    {
      name: 'space-flow-state',
      partialize: (s) => ({
        nodes: s.nodes,
        edges: s.edges,
        pages: s.pages,
        activePageId: s.activePageId,
        nodeCounters: s.nodeCounters,
        nodeActive: s.nodeActive,
        canvasSettings: s.canvasSettings,
      }),
    }
  )
);
