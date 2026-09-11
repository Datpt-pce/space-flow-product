const router = require('express').Router();
const service = require('../video/batchService').createBatchService(require('../db'), require('./video-projects'), require('./video-versions').service);
const management = require('../video/batchManagement').createBatchManagement(require('../db'), service);
const speech = require('../video/batchSpeech').createBatchSpeech(require('../db'), service, {
  get remote() { return (process.env.SPACE_FLOW_MODE || 'agent') === 'server'; },
  runner:owner => require('./video-assets').makeRunJob(owner, (process.env.SPACE_FLOW_MODE || 'agent') === 'server'),
  transfer:(file, runner) => require('../video/sourceTransfer').transferSource(file, runner),
  importAsset:(owner, file, runner) => require('./video-assets').importAsset(owner, file, runner, { skipPreflight:true, sourceLocality:'agent' }),
});
const capcut = require('../video/batchCapcut').createBatchCapcut(require('../db'), service, {
  get remote() { return (process.env.SPACE_FLOW_MODE || 'agent') === 'server'; },
  runner: owner => require('./video-assets').makeRunJob(owner, (process.env.SPACE_FLOW_MODE || 'agent') === 'server'),
  transfer: (file, runner) => require('../video/sourceTransfer').transferSource(file, runner),
});
const route = fn => async (req, res) => {
  try { res.json(await fn(req)); } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
};
const hashSource = ownerId => async asset => {
  const remote = (process.env.SPACE_FLOW_MODE || 'agent') === 'server' && asset.source_locality !== 'server';
  return (await require('./video-assets').makeRunJob(ownerId, remote)('hash', { path:asset.source_path })).contentHash;
};
const delivery = require('../video/batchDelivery').createBatchDelivery(require('../db'),service,{
  get remote() { return (process.env.SPACE_FLOW_MODE || 'agent') === 'server'; },
  runner: owner => require('./video-assets').makeRunJob(owner,(process.env.SPACE_FLOW_MODE || 'agent') === 'server'),
  transfer: (file,runner) => (process.env.SPACE_FLOW_MODE || 'agent') === 'server' ? require('../video/sourceTransfer').transferSource(file,runner) : Promise.resolve(file),
  importAsset: (owner,file,runner) => require('./video-assets').importAsset(owner,file,runner,{skipPreflight:true,sourceLocality:'agent'}),
});
router.get('/', route(r => service.list(r.user.id, r.query.archived === '1')));
router.post('/', route(r => service.create(r.user.id, r.body || {})));
router.get('/templates', route(r => service.templates(r.user.id)));
router.get('/trash', route(r => management.trash(r.user.id)));
router.post('/trash/restore', route(r => management.restoreProjects(r.user.id, r.body?.projects)));
router.post('/trash/purge', route(r => management.purgeProjects(r.user.id, r.body?.projects)));
router.get('/:id', route(r => service.get(r.user.id, r.params.id)));
router.post('/:id/speech', route(r => speech.start(r.user.id, r.params.id, r.body || {})));
router.get('/:id/speech', route(r => speech.list(r.user.id, r.params.id, r.query.itemId)));
router.get('/:id/speech/:jobId', route(r => speech.status(r.user.id, r.params.id, r.params.jobId)));
router.post('/:id/speech/:jobId/cancel', route(r => speech.status(r.user.id, r.params.id, r.params.jobId, true)));
router.post('/:id/apply-speech', route(r => speech.apply(r.user.id, r.params.id, r.body || {})));
router.put('/:id', route(r => service.save(r.user.id, r.params.id, r.body || {})));
router.post('/:id/archive', route(r => service.archive(r.user.id, r.params.id, { ...r.body, restore: false })));
router.post('/:id/restore', route(r => service.archive(r.user.id, r.params.id, { ...r.body, restore: true })));
router.post('/:id/prepare', route(r => service.prepare(r.user.id, r.params.id, r.body || {})));
router.post('/:id/shape', route(r => service.addShape(r.user.id, r.params.id, r.body || {})));
router.post('/:id/capture', route(r => service.capture(r.user.id, r.params.id, r.body || {})));
router.post('/:id/capture-prepared', route(r => service.capturePrepared(r.user.id, r.params.id, r.body || {})));
router.post('/:id/prepared-document', route(r => service.preparedDocument(r.user.id, r.params.id, r.body || {})));
router.post('/:id/proxy', route(r => service.startProxy(r.user.id, r.params.id, r.body || {}, require('./video-render').createRenderJob)));
router.post('/:id/accept-proxy', route(r => service.acceptProxy(r.user.id, r.params.id, r.body || {}, require('./video-render').promoteJobToAsset)));
router.post('/:id/preflight', route(async r => {
  const result = service.preflight(r.user.id, r.params.id, r.body || {});
  await service.verifySources(r.user.id, result.snapshot, hashSource(r.user.id));
  return result;
}));
router.post('/:id/sample', route(r => service.sample(r.user.id, r.params.id, r.body || {})));
router.post('/:id/capcut', route(r => capcut.prepare(r.user.id, r.params.id, r.body || {})));
router.get('/:id/capcut', route(r => capcut.list(r.user.id, r.params.id)));
router.post('/:id/capcut/:packageId/install', route(r => capcut.install(r.user.id, r.params.id, r.params.packageId)));
router.post('/:id/capcut/:packageId/render', route(r => capcut.render(r.user.id, r.params.id, r.params.packageId, r.body || {})));
router.get('/:id/capcut/:packageId/render/:requestKey', route(r => capcut.render(r.user.id, r.params.id, r.params.packageId, { requestKey:r.params.requestKey }, true)));
router.post('/:id/template', route(r => service.pinTemplate(r.user.id, r.params.id, r.body || {})));
router.get('/:id/runs', route(r => service.runs(r.user.id, r.params.id)));
router.post('/:id/runs', route(async r => {
  const previous = service.existingRun(r.user.id, r.params.id, r.body || {}); if (previous) return previous;
  const pre = service.preflight(r.user.id, r.params.id, r.body || {});
  if (pre.inputHash !== r.body.inputHash) throw Object.assign(new Error('Input đã đổi sau preview. Kiểm tra lại ma trận.'), { status:409 });
  await service.verifySources(r.user.id, pre.snapshot, hashSource(r.user.id));
  return service.createRun(r.user.id, r.params.id, r.body || {});
}));
router.get('/:id/runs/:runId', route(r => service.getRun(r.user.id, r.params.id, r.params.runId, { offset: Number(r.query.offset || 0), limit: Number(r.query.limit || 20) })));
router.post('/:id/runs/:runId/render', route(r => service.renderSelected(r.user.id, r.params.id, r.params.runId, r.body || {}, require('./video-render').createRenderJob)));
router.post('/:id/runs/:runId/archive', route(r => management.archiveOutputs(r.user.id, r.params.id, r.params.runId, r.body || {})));
router.post('/:id/runs/:runId/download', (req, res) => {
  let files;
  try { files = management.downloadFiles(req.user.id, req.params.id, req.params.runId, req.body?.rowIndexes); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  const archive = new (require('archiver').ZipArchive)({ zlib: { level: 0 } });
  res.setHeader('Content-Type', 'application/zip');
  // The UI consumes this POST as a Blob and names the final download.
  res.setHeader('Cache-Control', 'private, no-store');
  archive.on('error', error => res.destroy(error));
  archive.on('warning', error => res.destroy(error));
  res.on('close', () => { if (!res.writableFinished) archive.abort(); });
  archive.pipe(res);
  for (const file of files) archive.file(file.path, { name: file.name });
  archive.finalize().catch(error => res.destroy(error));
});
router.get('/:id/runs/:runId/items/:index/manifest', route(r => service.manifest(r.user.id, r.params.id, r.params.runId, Number(r.params.index))));
router.get('/:id/runs/:runId/items/:index/deliveries', route(r=>delivery.options(r.user.id,r.params.id,r.params.runId,Number(r.params.index),r.query.jobId)));
router.post('/:id/runs/:runId/items/:index/deliveries', route(r=>delivery.plan(r.user.id,r.params.id,r.params.runId,Number(r.params.index),r.body || {})));
router.post('/:id/runs/:runId/items/:index/deliveries/:deliveryId', route(r=>delivery.execute(r.user.id,r.params.id,r.params.runId,Number(r.params.index),r.params.deliveryId,r.body || {})));
module.exports = router;
module.exports.service = service;
