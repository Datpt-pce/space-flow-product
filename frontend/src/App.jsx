import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { fetchNodes } from './lib/api.js';
import { useStore } from './store.js';
import Toolbar from './components/Toolbar.jsx';
import NodePalette from './components/NodePalette.jsx';
import FlowCanvas from './components/FlowCanvas.jsx';
import ConfigPanel from './components/ConfigPanel.jsx';
import ExecutionLog from './components/ExecutionLog.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import PreviewModal from './components/PreviewModal.jsx';
import PagesBar from './components/PagesBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import FolderBrowserModal from './components/FolderBrowserModal.jsx';

export default function App() {
  const setNodeManifests = useStore(s => s.setNodeManifests);

  useEffect(() => {
    fetchNodes().then(setNodeManifests).catch(err => {
      console.error('Failed to load nodes from backend:', err);
    });
  }, []);

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

        {/* Floating execution log (bottom) */}
        <ExecutionLog />

        {/* Context menu overlay */}
        <ContextMenu />

        {/* Media preview modal */}
        <PreviewModal />

        {/* Settings modal */}
        <SettingsModal />

        {/* Web folder browser modal (fallback khi chạy Docker product) */}
        <FolderBrowserModal />

        {/* Pages bar (bottom center) */}
        <PagesBar />
      </div>
    </ReactFlowProvider>
  );
}
