const { randomUUID } = require('node:crypto');
const { digest } = require('./versionService');
const busy = new Set();
const fail = (message,status=409)=>Object.assign(new Error(message),{status});
function createBatchDelivery(db,batch,deps) {
  function protectSharedSource(owner,anchorPath,machine,hash) {
    const other=db.prepare(`SELECT id FROM video_assets WHERE (source_path=? OR content_hash=?) AND owner_id<>? AND (source_machine_id=? OR (source_machine_id IS NULL AND ?=0)) LIMIT 1`).get(anchorPath,hash,owner,machine,deps.remote?1:0);
    if(other) throw fail('File này còn được tài khoản khác sử dụng. Lưu variant để bảo toàn nguồn dùng chung.');
  }
  function context(owner,project,run,index,jobId) {
    const manifest=batch.manifest(owner,project,run,index);
    if(!manifest.jobs.some(j=>j.jobId===jobId)) throw fail('Render không thuộc output đã chọn.',404);
    const job=db.prepare('SELECT * FROM video_render_jobs WHERE id=? AND owner_id=?').get(jobId,owner);
    if(job?.status!=='done' || !job.output_path || !job.manifest_json) throw fail('Render chưa xác minh xong.');
    return {manifest,job,render:JSON.parse(job.manifest_json)};
  }
  function publicReceipt(row) {return {...JSON.parse(row.intent_json),id:row.id,state:row.state,error:row.error,assetId:row.asset_id,receipt:row.receipt_json?JSON.parse(row.receipt_json):null};}
  function options(owner,project,run,index,jobId) {
    const {render}=context(owner,project,run,index,jobId);
    const anchors=(render.assetIds || []).map(id=>db.prepare('SELECT id,source_path AS path,source_locality AS locality,source_machine_id AS machineId,original_source_path AS originalPath,content_hash AS hash FROM video_assets WHERE id=? AND owner_id=?').get(id,owner)).filter(Boolean);
    return {anchors,deliveries:db.prepare('SELECT * FROM video_batch_deliveries WHERE run_id=? AND row_index=? AND owner_id=? ORDER BY rowid DESC').all(run,index,owner).map(publicReceipt)};
  }
  async function plan(owner,project,run,index,request) {
    const {job,render,manifest}=context(owner,project,run,index,request.jobId);
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestKey || '')) throw fail('Cần request key.',400);
    const existing=db.prepare('SELECT * FROM video_batch_deliveries WHERE owner_id=? AND request_key=?').get(owner,request.requestKey);
    const selection={jobId:request.jobId,mode:request.mode,anchorId:request.anchorId || null,folder:request.folder || null};
    if(existing) {
      if(existing.run_id!==run || existing.row_index!==index || digest(JSON.parse(existing.intent_json).selection)!==digest(selection)) throw fail('Request key đã dùng cho đích khác.');
      return publicReceipt(existing);
    }
    if(!['variant','replace'].includes(selection.mode)) throw fail('Chế độ giao file không hợp lệ.',400);
    const runner=deps.runner(owner);
    const device=await runner('delivery-info',{});
    let anchor=null;
    if(selection.anchorId) {
      if(!(render.assetIds || []).includes(selection.anchorId)) throw fail('Anchor không thuộc các nguồn của output.',400);
      anchor=db.prepare('SELECT * FROM video_assets WHERE id=? AND owner_id=?').get(selection.anchorId,owner);
      if(!anchor || anchor.source_locality==='server' && deps.remote) throw fail('Nguồn đang lưu trên server. Chọn thư mục trên agent hoặc tải MP4.');
      if(anchor.source_machine_id && anchor.source_machine_id!==device.machineId) throw fail('Anchor thuộc máy khác. Kết nối đúng máy nguồn.');
      if(deps.remote && !anchor.source_machine_id) throw fail('Nguồn cũ chưa có identity máy. Import lại nguồn trên đúng agent trước khi chọn làm anchor.');
      if(anchor.content_hash!==render.assetHashes?.[anchor.id]) throw fail('Anchor đã đổi hash so với bản render.');
      if(selection.mode==='replace' && anchor.original_source_path) throw fail('Đây là backup phục vụ lịch sử; chọn variant để giữ bản cũ.');
      if(selection.mode==='replace') protectSharedSource(owner,anchor.source_path,device.machineId,anchor.content_hash);
    }
    if(!anchor && (selection.mode==='replace' || !selection.folder)) throw fail('Chọn nguồn anchor hoặc thư mục đích.',400);
    const intent={selection,machineId:device.machineId,platform:device.platform,mode:selection.mode,anchorId:anchor?.id || null,
      anchorPath:anchor?.source_path || null,expectedHash:anchor?.content_hash || null,outputHash:render.outputHash,folder:anchor?null:selection.folder,
      stem:manifest.name,jobId:job.id,outputPath:job.output_path};
    if(!/^[a-f0-9]{64}$/.test(intent.outputHash || '')) throw fail('Render thiếu verified output hash.');
    const id=randomUUID();
    db.prepare('INSERT INTO video_batch_deliveries(id,owner_id,run_id,row_index,request_key,intent_json) VALUES (?,?,?,?,?,?)').run(id,owner,run,index,request.requestKey,JSON.stringify(intent));
    return publicReceipt(db.prepare('SELECT * FROM video_batch_deliveries WHERE id=?').get(id));
  }
  async function execute(owner,project,run,index,id,request={}) {
    batch.manifest(owner,project,run,index);
    let row=db.prepare('SELECT * FROM video_batch_deliveries WHERE id=? AND owner_id=? AND run_id=? AND row_index=?').get(id,owner,run,index);
    if(!row) throw fail('Không tìm thấy delivery.',404);
    if(row.state==='done') return publicReceipt(row);
    if(busy.has(id)) throw fail('Delivery đang chạy. Tải lại trạng thái.');
    const intent=JSON.parse(row.intent_json);
    if(row.state==='planned' && intent.mode==='replace' && request.confirmPath!==intent.anchorPath) throw fail('Cần xác nhận đúng file sẽ thay.',400);
    context(owner,project,run,index,intent.jobId);
    busy.add(id);
    try {
      const runner=deps.runner(owner);
      if(row.state==='planned') db.prepare("UPDATE video_batch_deliveries SET state='confirmed',error=NULL WHERE id=?").run(id);
      const device=await runner('delivery-info',{});
      if(device.machineId!==intent.machineId) throw fail('Máy đích đã đổi; mở lại đúng agent.');
      const outputPath=await deps.transfer(intent.outputPath,runner);
      const sourceAliases=intent.mode==='replace'?db.prepare('SELECT id,source_path AS path FROM video_assets WHERE owner_id=? AND content_hash=? AND (source_machine_id IS NULL OR source_machine_id=?) AND (?=0 OR source_locality=\'agent\')').all(owner,intent.expectedHash,intent.machineId,deps.remote?1:0):[];
      const payload={...intent,id,outputPath,sourceAliases,intentHash:digest(intent)};
      const prepared=await runner('delivery-prepare',payload);
      if(prepared.outputHash!==intent.outputHash || prepared.expectedHash!==intent.expectedHash || prepared.machineId!==intent.machineId) throw fail('Receipt không khớp intent.');
      // Old pins refer to IDs, so move every alias of these exact source bytes to backup.
      // This transaction commits BEFORE the physical rename and is safe to repeat after restart.
      db.exec('BEGIN IMMEDIATE');
      try {
        if(intent.mode==='replace') {
          if(!prepared.backup) throw fail('Thiếu backup đã xác minh.');
          protectSharedSource(owner,intent.anchorPath,intent.machineId,intent.expectedHash);
          if(db.prepare("SELECT id FROM video_render_jobs WHERE owner_id=? AND status='running' LIMIT 1").get(owner)) throw fail('Chờ render đang chạy hoàn tất trước khi thay nguồn.');
          if(db.prepare("SELECT id FROM video_assets WHERE source_path=? AND status='processing' LIMIT 1").get(intent.anchorPath)) throw fail('Nguồn đang được import. Thử tiếp tục sau khi import hoàn tất.');
          if(!prepared.protectedAssetIds?.includes(intent.anchorId)) throw fail('Chưa xác minh đầy đủ alias nguồn trước khi thay file.');
          for(const assetId of prepared.protectedAssetIds) db.prepare(`UPDATE video_assets SET original_source_path=COALESCE(original_source_path,source_path),source_path=?,source_machine_id=?
            WHERE owner_id=? AND id=? AND content_hash=? AND (source_machine_id IS NULL OR source_machine_id=?)`).run(prepared.backup,intent.machineId,owner,assetId,intent.expectedHash,intent.machineId);
        }
        db.prepare("UPDATE video_batch_deliveries SET state='prepared',receipt_json=?,error=NULL WHERE id=?").run(JSON.stringify(prepared),id);
        db.exec('COMMIT');
      } catch(e) { db.exec('ROLLBACK');throw e; }
      const receipt=await runner('delivery-commit',{id,machineId:intent.machineId});
      db.prepare("UPDATE video_batch_deliveries SET state='indexing',receipt_json=? WHERE id=?").run(JSON.stringify(receipt),id);
      const asset=await deps.importAsset(owner,receipt.target,runner);
      if(asset.status!=='ok' || asset.content_hash!==intent.outputHash) throw fail('File đã giao, đang chờ reindex. Thử lại để hoàn tất.');
      const current=batch.get(owner,project),listId=`delivered-${digest(project).slice(0,24)}`,itemId=`delivery-${id}`;
      if(!current.draft.lists.some(l=>l.items.some(i=>i.id===itemId))) {
        let list=current.draft.lists.find(l=>l.id===listId);
        if(!list){list={id:listId,name:'Kết quả đã xuất',minRating:0,items:[]};current.draft.lists.push(list);}
        list.items.push({id:itemId,sourceRef:{kind:'media',assetId:asset.id,contentHash:asset.content_hash},rating:0,enabled:true,manualOrder:list.items.length});
        batch.save(owner,project,{expectedRevision:current.revision,name:current.name,draft:current.draft});
      }
      db.prepare("UPDATE video_batch_deliveries SET state='done',asset_id=?,error=NULL WHERE id=?").run(asset.id,id);
      return publicReceipt(db.prepare('SELECT * FROM video_batch_deliveries WHERE id=?').get(id));
    } catch(e) {db.prepare('UPDATE video_batch_deliveries SET error=? WHERE id=?').run(e.message,id);throw e;}
    finally {busy.delete(id);}
  }
  return {options,plan,execute};
}
module.exports={createBatchDelivery};
