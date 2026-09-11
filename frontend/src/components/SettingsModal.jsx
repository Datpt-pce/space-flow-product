import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store.js';

import { GeneralTab, AppearanceTab, ShortcutsTab } from './settings/generalTabs.jsx';
import { CredentialsTab } from './settings/credentialsTab.jsx';
import { LocalServicesTab } from './settings/localServicesTab.jsx';
import { SystemTab } from './settings/systemTab.jsx';
import { UsersTab } from './settings/usersTab.jsx';
import { AgentTab } from './settings/agentTab.jsx';
import { MyNodesTab } from './settings/myNodesTab.jsx';
import { AnalyticsPreference } from './AnalyticsTracking.jsx';
import { RegistryTab, RegistryReviewTab } from './settings/registryTabs.jsx';

export default function SettingsModal() {
  const isOpen = useStore(s => s.isSettingsOpen);
  const closeSettings = useStore(s => s.closeSettings);
  const currentUser = useStore(s => s.currentUser);
  const initialTab = useStore(s => s.settingsInitialTab);
  const isAdmin = currentUser?.role === 'admin';
  const [tab, setTab] = useState('general');
  useEffect(() => {
    if (isOpen && ['appearance', 'registry-review', 'users', 'system'].includes(initialTab)) setTab(initialTab);
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') closeSettings(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeSettings]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeSettings(); }}
    >
      <div className="bg-[var(--card,#fff)] rounded-2xl shadow-2xl border border-[var(--card-border,#e5e7eb)] flex overflow-hidden"
        style={{ width: 680, height: 480 }}>
        {/* Sidebar */}
        <div className="w-36 flex-shrink-0 border-r border-[var(--card-border,#f3f4f6)] flex flex-col pt-10 px-2 gap-0.5 overflow-y-auto">
          <p className="text-[11px] font-semibold text-[var(--n400,#9ca3af)] uppercase tracking-wider px-2 mb-2">Settings</p>
          {[
            { id: 'general', label: 'General' },
            { id: 'analytics', label: 'Phân tích sử dụng' },
            { id: 'appearance', label: 'Appearance' },
            { id: 'shortcuts', label: 'Shortcuts' },
            { id: 'credentials', label: 'Credentials' },
            { id: 'my-nodes', label: 'My Nodes' },
            { id: 'registry', label: 'Registry' },
            { id: 'agent', label: 'Agent' },
            ...(isAdmin ? [{ id: 'local-services', label: 'Local Services' }] : []),
            ...(isAdmin ? [{ id: 'users', label: 'Users' }] : []),
            ...(isAdmin ? [{ id: 'registry-review', label: 'Registry Review' }] : []),
            { id: 'system', label: 'System' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors
                ${tab === t.id ? 'bg-[var(--n100,#f3f4f6)] text-[var(--text,#111827)]' : 'text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)] hover:text-[var(--n800,#1f2937)]'}`}
            >
              {t.label}
            </button>
          ))}
          <div className="flex-1" />
          {currentUser && (
            <button
              onClick={() => useStore.getState().logout()}
              className="w-full text-left px-3 py-2 rounded-xl text-sm font-medium text-[var(--n500,#6b7280)] hover:bg-[var(--n50,#f9fafb)] hover:text-red-500 transition-colors mb-2"
            >
              Đăng xuất
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--card-border,#f3f4f6)]">
            <h2 className="text-base font-semibold text-[var(--text,#111827)]">
              {tab === 'analytics' ? 'Phân tích sử dụng' : tab === 'general' ? 'General' : tab === 'appearance' ? 'Appearance' : tab === 'shortcuts' ? 'Shortcuts' : tab === 'credentials' ? 'Credentials' : tab === 'my-nodes' ? 'My Nodes' : tab === 'registry' ? 'Registry' : tab === 'agent' ? 'Agent' : tab === 'local-services' ? 'Local Services' : tab === 'users' ? 'Users' : tab === 'registry-review' ? 'Registry Review' : 'System'}
            </h2>
            <button
              onClick={closeSettings}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--n400,#9ca3af)] hover:bg-[var(--n100,#f3f4f6)] hover:text-[var(--sub,#374151)] transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {tab === 'analytics' ? <AnalyticsPreference /> : tab === 'general' ? <GeneralTab /> : tab === 'appearance' ? <AppearanceTab /> : tab === 'shortcuts' ? <ShortcutsTab /> : tab === 'credentials' ? <CredentialsTab /> : tab === 'my-nodes' ? <MyNodesTab /> : tab === 'registry' ? <RegistryTab /> : tab === 'agent' ? <AgentTab /> : tab === 'local-services' ? <LocalServicesTab /> : tab === 'users' ? <UsersTab /> : tab === 'registry-review' ? <RegistryReviewTab /> : <SystemTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
