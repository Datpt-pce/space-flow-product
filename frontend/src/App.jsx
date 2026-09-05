import { lazy, Suspense, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { fetchNodes } from './lib/api.js';
import { useStore } from './store.js';
import Toolbar from './components/Toolbar.jsx';
import NodePalette from './components/NodePalette.jsx';
import FlowCanvas from './components/FlowCanvas.jsx';
import ConfigPanel from './components/ConfigPanel.jsx';
import NodeDetailView from './components/NodeDetailView.jsx';
import ExecutionLog from './components/ExecutionLog.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import PreviewModal from './components/PreviewModal.jsx';
import PagesBar from './components/PagesBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import NodeBuilderModal from './components/NodeBuilderModal.jsx';
import FolderBrowserModal from './components/FolderBrowserModal.jsx';
import LoginGate from './components/LoginGate.jsx';
import WorkflowLibraryModal from './components/WorkflowLibraryModal.jsx';
import VersionBell from './components/VersionBell.jsx';
import LocalGraphPanel from './graph/LocalGraphPanel.jsx';
import GlobalGraphView from './graph/GlobalGraphView.jsx';
import SheetLibraryModal from './sheet/components/SheetLibraryModal.jsx';
import GoogleImportModal from './sheet/components/GoogleImportModal.jsx';
import GoogleLinkPanel from './sheet/components/GoogleLinkPanel.jsx';

// Sheet Phase 2 (specs/space-flow-master-plan/03-spreadsheet.md §4 Phase 2, §3 phản biện #5):
// lazy — SheetWorkspace.jsx is the only thing that imports engine/univerAdapter.js, which pulls
// in the entire Univer plugin set + CSS. A user who never switches to Sheet mode (the default,
// `activeModule: 'flow'`) should never pay that bundle/parse cost.
const SheetWorkspace = lazy(() => import('./sheet/SheetWorkspace.jsx'));

export default function App() {
  const setNodeManifests = useStore(s => s.setNodeManifests);
  const currentUser = useStore(s => s.currentUser);
  const authChecked = useStore(s => s.authChecked);
  const checkSession = useStore(s => s.checkSession);
  const appearanceSettings = useStore(s => s.appearanceSettings);
  const activeModule = useStore(s => s.activeModule);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    document.documentElement.dataset.appearance = `beta-${appearanceSettings.theme}`;
  }, [appearanceSettings]);

  useEffect(() => {
    if (!currentUser) return;
    fetchNodes().then(setNodeManifests).catch(err => {
      console.error('Failed to load nodes from backend:', err);
    });
  }, [currentUser]);

  if (!authChecked) return null;
  if (!currentUser) return <LoginGate />;

  return (
    <ReactFlowProvider>
      <div className="relative w-screen h-screen overflow-hidden bg-[#f5f5f5]">
        {activeModule === 'flow' ? (
          <>
            {/* Full-screen canvas layer */}
            <FlowCanvas />

            {/* Floating node palette popup */}
            <NodePalette />

            {/* Floating config panel (right side) */}
            <ConfigPanel />

            {/* NDV-style overlay — opens on node double-click, bigger than ConfigPanel */}
            <NodeDetailView />

            {/* Floating execution log (bottom) */}
            <ExecutionLog />

            {/* Context menu overlay */}
            <ContextMenu />

            {/* Workflow library modal (browse/save/load shared + private workflows) */}
            <WorkflowLibraryModal />

            {/* Pages bar (bottom center) */}
            <PagesBar />

            {/* Local Graph panel (Graph Library Phase 4) */}
            <LocalGraphPanel />

            {/* Global Graph view (Graph Library Phase 6) */}
            <GlobalGraphView />
          </>
        ) : (
          // Sheet Phase 2 — full-screen workspace layer, same slot FlowCanvas occupies above.
          <Suspense fallback={null}>
            <SheetWorkspace />
          </Suspense>
        )}

        {/* Left icon bar overlay — shared, module-aware (Toolbar.jsx) */}
        <Toolbar />

        {/* Version notification bell (top-right) */}
        <VersionBell />

        {/* Media preview modal */}
        <PreviewModal />

        {/* Settings modal */}
        <SettingsModal />

        {/* Local Node Builder (Custom Node Platform Phase 5) — opened from Settings' My Nodes tab */}
        <NodeBuilderModal />

        {/* Sheet library modal (browse/create/import sheets) */}
        <SheetLibraryModal />

        {/* Sheet Phase 3/4 (specs/space-flow-master-plan/03-spreadsheet.md §4): Google Sheets
            import-once + OAuth-linked read-only. */}
        <GoogleImportModal />
        <GoogleLinkPanel />

        {/* Web folder browser modal (fallback khi chạy Docker product) */}
        <FolderBrowserModal />
      </div>
    </ReactFlowProvider>
  );
}
