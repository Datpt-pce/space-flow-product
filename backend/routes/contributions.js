const express = require('express');
const { ReviewError } = require('../contributions/errors');

function createRouter({ service, worker, candidates, distribution, releases } = require('../contributions/runtime')) {
  const router = express.Router();
  const route = action => async (req, res) => {
    try { const result = await action(req, res); if (!res.headersSent) res.json(result); }
    catch (error) {
      const expected = error instanceof ReviewError;
      res.status(expected ? error.status || 409 : 500).json({ error: expected ? error.message : 'Tác vụ chưa hoàn tất. Kiểm tra trạng thái và thử lại.', code: expected ? error.code : 'REVIEW_FAILED' });
    }
  };
  router.get('/state', route(req => service.state(req.user)));
  router.get('/jobs/:id', route(req => service.detail(req.user, req.params.id)));
  router.post('/jobs', route(req => service.createIdea(req.user, req.body)));
  router.post('/sync', route(req => service.sync(req.user)));
  router.put('/settings', route(req => service.updateSettings(req.user, req.body)));
  router.post('/connect', route(req => service.connect(req.user)));
  router.get('/doctor', route(async req => {
    service.requireOwner(req.user);
    return { cli: await worker.runner.doctor(), worker: worker.status, ...(candidates ? { sandbox: await candidates.doctor() } : {}) };
  }));
  router.post('/worker/:action', route(async req => {
    service.requireOwner(req.user);
    if (!['start', 'stop', 'tick'].includes(req.params.action)) throw new ReviewError('INVALID_ACTION', 'Thao tác worker không hợp lệ.', 400);
    if (req.params.action === 'start') { service.config.update({ workerEnabled: true }); worker.start(); }
    if (req.params.action === 'stop') { service.config.update({ workerEnabled: false }); await worker.stop(); }
    if (req.params.action === 'tick') worker.tick({ force: true }).catch(() => {});
    return { ...worker.status, busy: worker.busy };
  }));
  for (const action of ['review', 'resume', 'cancel']) router.post(`/jobs/:id/${action}`, route(req => service[action](req.user, req.params.id, req.body.revision)));
  router.post('/jobs/:id/feedback', route(req => service.feedback(req.user, req.params.id, req.body.revision, req.body.body, req.body.publish === true)));
  if (distribution) {
    router.post('/distribution/prepare', route(req => distribution.prepare(req.user)));
    router.post('/distribution/publish', route(req => distribution.publish(req.user, req.body.baselineId)));
  }
  if (candidates) {
    router.post('/sandbox/setup', route(req => candidates.setup(req.user)));
    router.post('/jobs/:id/candidate', route(req => candidates.prepare(req.user, req.params.id, req.body.revision)));
    router.post('/jobs/:id/preview', route(req => candidates.preview(req.user, req.params.id, req.body.revision)));
    router.post('/jobs/:id/trial', route(req => candidates.trial(req.user, req.params.id, req.body)));
    router.delete('/jobs/:id/preview', route(req => candidates.stopPreview(req.user, req.params.id, req.body.revision)));
  }
  if (releases) for (const action of ['approve', 'apply', 'reconcile', 'rollback'])
    router.post(`/jobs/:id/${action}`, route(req => releases[action](req.user, req.params.id, req.body)));
  return router;
}
module.exports = createRouter();
module.exports.createRouter = createRouter;
