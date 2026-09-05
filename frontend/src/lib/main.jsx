import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '../App.jsx';
import '../index.css';

// Video Editor Phase 0 (specs/space-flow-master-plan/04-video-editor.md): "route thử /video
// trong frontend/src/main.jsx (tách biệt App.jsx/Flow/store.js)". This app has no router at all
// (confirmed while building Custom Node Platform Phase 7 — a single full-screen canvas + Zustand-
// toggled modals) — a plain pathname check is the whole "router" this needs. Phase 3 replaced the
// temporary VideoSpikeTest.jsx with the real Workspace Shell (VideoWorkspace.jsx).
const isVideoEditor = window.location.pathname === '/video';
const RootComponent = isVideoEditor ? React.lazy(() => import('../video/VideoWorkspace.jsx')) : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <RootComponent />
    </React.Suspense>
  </React.StrictMode>
);
