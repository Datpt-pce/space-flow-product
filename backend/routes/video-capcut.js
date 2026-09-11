const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { runVideoJob } = require('../agent/videoJobs');
const { hashFile } = require('../video/assetService');
const { transferSource } = require('../video/sourceTransfer');
const router = express.Router();

async function dispatch(ownerId, kind, payload) {
  if ((process.env.SPACE_FLOW_MODE || 'agent') !== 'server') return runVideoJob(kind, payload, () => {});
  const agent = require('../ws/agentServer');
  if (!agent.isAgentOnline(ownerId)) throw new Error('Mở agent trên máy có CapCut rồi thử lại');
  let result;
  await agent.sendJob(ownerId, { type: 'video-job', kind, payload }, (event, data) => { if (event === 'done') result = data.result; });
  return result;
}
router.get('/capability', async (req, res) => {
  try { res.json(await dispatch(req.user.id, 'capcut-adapter', { operation: 'inventory' })); }
  catch (err) { res.status(409).json({ error: err.message }); }
});
router.post('/prepare', async (req, res) => {
  const { renderJobId, build, name, acceptFlattening } = req.body || {};
  if (acceptFlattening !== true) return res.status(400).json({ error: 'Cần xác nhận chuyển video đã gộp các lớp sang CapCut' });
  if (typeof renderJobId !== 'string' || typeof build !== 'string' || typeof name !== 'string') return res.status(400).json({ error: 'Thiếu bản render, phiên bản CapCut hoặc tên dự án' });
  const job = db.prepare(`SELECT j.* FROM video_render_jobs j JOIN video_projects p ON p.id = j.project_id WHERE j.id = ? AND p.owner_id = ? AND j.owner_id = ? AND p.archived_at IS NULL`).get(renderJobId, req.user.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy bản render' });
  if (job.status !== 'done' || !job.output_path) return res.status(409).json({ error: 'Bản render chưa hoàn tất' });
  try {
    const sha256 = await hashFile(job.output_path);
    const manifest = job.manifest_json ? JSON.parse(job.manifest_json) : null;
    if (!manifest?.verifiedAt || manifest.outputHash !== sha256 || manifest.pinnedSeq !== job.pinned_seq) throw new Error('Video không còn khớp bản render đã xác minh');
    let sourcePath = job.output_path;
    if ((process.env.SPACE_FLOW_MODE || 'agent') === 'server') {
      sourcePath = await transferSource(sourcePath, (kind, payload) => dispatch(req.user.id, kind, payload));
    }
    const prepared = await dispatch(req.user.id, 'capcut-adapter', { operation: 'prepare', build, name,
      acceptFlattening, delivery: { kind: 'VerifiedVideo', path: sourcePath, sha256, versionId: `${job.project_id}:${job.pinned_seq}` } });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO video_capcut_packages(id, owner_id, render_job_id, package_path, report_json) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, job.id, prepared.path, JSON.stringify(prepared.report));
    res.status(201).json({ id, status: 'prepared', report: prepared.report });
  } catch (err) { res.status(409).json({ error: err.message }); }
});
router.post('/:id/install', async (req, res) => {
  const record = db.prepare('SELECT * FROM video_capcut_packages WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!record) return res.status(404).json({ error: 'Không tìm thấy gói CapCut' });
  if (record.status === 'installed') return res.json({ id: record.id, status: 'installed' });
  try {
    await dispatch(req.user.id, 'capcut-adapter', { operation: 'install', packagePath: record.package_path });
    db.prepare("UPDATE video_capcut_packages SET status = 'installed' WHERE id = ?").run(record.id);
    res.json({ id: record.id, status: 'installed' });
  } catch (err) { res.status(409).json({ error: err.message }); }
});
module.exports = router;
