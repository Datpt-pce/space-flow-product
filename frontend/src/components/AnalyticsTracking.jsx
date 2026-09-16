import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { beginAnalytics, optedOut, setAnalyticsOptOut } from '../lib/analyticsClient.js';

function currentFeature() {
  const s=useStore.getState();
  if(location.hash==='#review')return 'admin';
  if(s.isGlobalGraphOpen||s.isLocalGraphOpen)return 'graph';
  if(s.activeModule==='sheet')return 'sheet';
  const node=s.nodes.find(n=>n.id===s.ndvNodeId||n.id===s.selectedNodeId);
  if(document.querySelector('[data-analytics-feature="batch"]'))return 'batch';
  if(document.querySelector('[data-analytics-feature="assistant"]'))return 'assistant';
  if(location.pathname==='/video')return 'video';
  return node?.type==='video-editor-workbench'?'video':'canvas';
}
export function useAnalyticsTracking() {
  const owner=useStore(s=>s.currentUser?.id);
  const [preference,setPreference]=useState(0);
  useEffect(()=>{const change=()=>setPreference(n=>n+1);window.addEventListener('sf-analytics-preference',change);window.addEventListener('storage',change);
    return()=>{window.removeEventListener('sf-analytics-preference',change);window.removeEventListener('storage',change);};},[]);
  useEffect(()=>{
    if(!owner||optedOut())return;
    const stop=beginAnalytics({ownerId:owner,getFeature:currentFeature,getWaiting:()=>useStore.getState().isRunning});
    // Clear immediately on identity transition, before the next React effect or HTTP logout finishes.
    const unsubscribe=useStore.subscribe(s=>{if(s.currentUser?.id!==owner)stop();});
    return()=>{unsubscribe();stop();};
  },[owner,preference]);
  return null;
}
export function AnalyticsPreference() {
  const [off,setOff]=useState(optedOut);
  return <section className="rounded-xl border border-[var(--n200)] p-3 text-sm">
    <strong>Phân tích sử dụng</strong>
    <p className="my-2 text-[var(--n500)]">Gửi thao tác tính năng, thời gian tab hoạt động và hiệu năng để cải thiện Space Flow. Không gửi nội dung nhập, prompt hay đường dẫn file. Chỉ admin xem báo cáo.</p>
    <label className="flex gap-2 items-start"><input type="checkbox" checked={!off} onChange={event=>{setOff(!event.target.checked);setAnalyticsOptOut(!event.target.checked);}} />Cho phép gửi dữ liệu sử dụng từ trình duyệt này</label>
    <p className="mt-2 text-xs text-[var(--n500)]">Tắt tùy chọn này dừng tracking browser. Trạng thái job và số đo vận hành của server/Agent vẫn phục vụ quản lý hệ thống.</p>
  </section>;
}
