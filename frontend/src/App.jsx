import { useEffect } from 'react';
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
import FolderBrowserModal from './components/FolderBrowserModal.jsx';
import LoginGate from './components/LoginGate.jsx';
import WorkflowLibraryModal from './components/WorkflowLibraryModal.jsx';

export default function App() {
  const setNodeManifests = useStore(s => s.setNodeManifests);
  const currentUser = useStore(s => s.currentUser);
  const authChecked = useStore(s => s.authChecked);
  const checkSession = useStore(s => s.checkSession);
  const appearanceSettings = useStore(s => s.appearanceSettings);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    const { designMode, theme } = appearanceSettings;
    document.documentElement.dataset.appearance =
      designMode === 'lts' ? 'lts' : `beta-${theme}`;
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
        {/* Full-screen canvas layer */}
        <FlowCanvas />

        {/* Left icon bar overlay */}
        <Toolbar />

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

        {/* Media preview modal */}
        <PreviewModal />

        {/* Settings modal */}
        <SettingsModal />

        {/* Workflow library modal (browse/save/load shared + private workflows) */}
        <WorkflowLibraryModal />

        {/* Web folder browser modal (fallback khi chạy Docker product) */}
        <FolderBrowserModal />

        {/* Pages bar (bottom center) */}
        <PagesBar />
      </div>
    </ReactFlowProvider>
  );
}
