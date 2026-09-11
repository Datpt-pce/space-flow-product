const express = require('express');
const { getCatalogs, saveCatalog, deletePrivateCatalog } = require('../utils/resizeUploadV3Catalog');
const { run } = require('../../nodes/resize-upload-v3/execute');
const executionContext = require('../engine/executionContext');
const router = express.Router();

router.get('/catalog', (req, res) => res.json(getCatalogs(req.user.id)));
router.post('/catalog', (req, res) => {
  const { scope, data } = req.body;
  if (scope === 'public' && req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ Admin sửa thư viện chung' });
  try { saveCatalog(scope, req.user.id, data); res.json(getCatalogs(req.user.id)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});
router.delete('/catalog', (req, res) => {
  deletePrivateCatalog(req.user.id);
  res.json(getCatalogs(req.user.id));
});

router.post('/preview', async (req, res) => {
  try { res.json(await run(req.body.inputs || {}, req.body.config, { userId: req.user.id }, 'full', 'preview')); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

router.post('/run', async (req, res) => {
  if (!['full', 'upload_only'].includes(req.body.mode || 'full')) return res.status(400).json({ error: 'Chế độ chạy không hợp lệ' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (event, data) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    const outputs = await executionContext.run({ signal: controller.signal }, () => run(req.body.inputs || {}, req.body.config, {
      userId: req.user.id, progress: (percent, message) => send('progress', { percent, message }),
      rowResult: data => send('rowResult', data), log: message => send('log', { message }),
    }, req.body.mode || 'full'));
    send('nodeComplete', { outputs });
    send('done', { success: outputs.success === true });
  } catch (error) { send('error', { error: error.message }); }
  res.end();
});

module.exports = router;
