import { useEffect, useState } from 'react';
import { batchRequest } from './batchApi';
import { useVideoStore } from '../store';
import { useDialogFocus } from '../useDialogFocus';
import BatchPathInput from './BatchPathInput';
import { FolderOpen } from 'lucide-react';
import { openFolder } from '../../lib/api';
export default function BatchDelivery({ projectId,runId,item,onClose }) {
  const [data,setData]=useState(null),[anchor,setAnchor]=useState(''),[folder,setFolder]=useState(''),[mode,setMode]=useState('variant');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const dialogRef=useDialogFocus(()=>{if(!busy)onClose();});
  const job=item.jobs.at(-1),base=`/${projectId}/runs/${runId}/items/${item.rowIndex}/deliveries`;
  const refresh=()=>batchRequest(`${base}?jobId=${job.jobId}`).then(result=>{setData(result);if(result.anchors.find(a=>a.id===anchor)?.originalPath)setMode('variant');});
  useEffect(()=>{refresh().catch(e=>setError(e.message));},[base,job.jobId]);
  async function execute(receipt) {
    if(receipt.mode==='replace' && receipt.state==='planned' && !window.confirm(`Thay file này bằng bản render?\n${receipt.anchorPath}\n\nBản gốc được giữ trong backup để timeline cũ tiếp tục mở đúng nội dung.`)) return;
    await batchRequest(`${base}/${receipt.id}`,{confirmPath:receipt.mode==='replace'?receipt.anchorPath:undefined});
    const latest=await batchRequest(`/${projectId}`);
    if(!useVideoStore.getState().batchDirty)useVideoStore.setState({batchProject:latest,batchPreview:null,batchRunKey:null});
  }
  async function perform(receipt) {
    setBusy(true);setError('');
    try {
      if(!receipt) receipt=await batchRequest(base,{requestKey:crypto.randomUUID(),jobId:job.jobId,mode,anchorId:anchor || undefined,folder:anchor?undefined:folder});
      await execute(receipt);
    } catch(e) {setError(e.message);}
    finally {await refresh().catch(e=>setError(e.message));setBusy(false);}
  }
  return <div className="batch-dialog-backdrop"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Lưu về máy nguồn" className="batch-dialog">
    <div className="batch-section-heading"><h2>Lưu về máy nguồn · #{item.rowIndex+1}</h2><button autoFocus disabled={busy} onClick={onClose}>Đóng giao file</button></div>
    <p>Bản render đã xác minh. Chọn một nguồn làm vị trí lưu hoặc nhập thư mục trên máy đang kết nối agent. File hoàn tất được thêm vào list “Kết quả đã xuất”.</p>
    {error && <p role="alert">{error}</p>}
    <label>Vị trí lưu<select aria-label="Nguồn anchor" disabled={busy} value={anchor} onChange={e=>{setAnchor(e.target.value);setMode('variant');}}><option value="">Chọn thư mục trên máy của tôi</option>{data?.anchors.map(a=><option key={a.id} value={a.id}>{a.path}{a.originalPath?' · backup lịch sử':''}{a.locality==='server'?' · nguồn server':''}</option>)}</select></label>
    {!anchor && <label>Thư mục đích<BatchPathInput label="Thư mục giao file" placeholder="Đường dẫn tuyệt đối trên máy đích" disabled={busy} value={folder} onChange={setFolder} onError={setError}/></label>}
    <label>Chế độ<select aria-label="Chế độ giao file" disabled={busy} value={mode} onChange={e=>setMode(e.target.value)}><option value="variant">Lưu variant mới · không trùng tên</option><option value="replace" disabled={!anchor}>Thay file MP4 đã chọn · giữ backup</option></select></label>
    <button className="batch-primary" disabled={busy || !data || !anchor && !folder.trim()} onClick={()=>perform()}>Chuẩn bị giao file</button>
    <div className="batch-delivery-history">{data?.deliveries.map(d=><div key={d.id}><strong>{d.state==='done'?'Đã lưu và thêm vào thư viện':d.state==='planned'?'Chờ xác nhận':'Chưa hoàn tất · có thể tiếp tục'}</strong><p>{d.receipt?.target || d.anchorPath || d.folder}</p>{d.state==='done' && d.receipt?.target && <button aria-label="Mở thư mục file đã lưu" title={d.receipt.target} onClick={()=>openFolder(d.receipt.target).then(r=>{if(r.error)setError(r.error);}).catch(e=>setError(e.message))}><FolderOpen size={16}/></button>}{d.receipt?.backup && <p>Backup: {d.receipt.backup}</p>}{d.error && <p role="alert">{d.error}</p>}{d.state!=='done' && <button disabled={busy} onClick={()=>perform(d)}>Tiếp tục giao file</button>}</div>)}</div>
    <a href={`/api/video-render/${item.timelineId}/render/${job.jobId}/download`} download>Tải MP4 qua trình duyệt</a>
  </section></div>;
}
