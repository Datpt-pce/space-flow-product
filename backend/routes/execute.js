const express = require('express');
const path = require('path');
const executor = require('../engine/executor');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

router.post('/', async (req, res) => {
  const { workflow, startNodeId } = req.body;
  if (!workflow) return res.status(400).json({ error: 'Missing workflow' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await executor.run(workflow, UPLOADS_DIR, send, startNodeId ?? null);
    send('done', { success: true });
  } catch (err) {
    send('error', { success: false, error: err.message });
  }

  res.end();
});

module.exports = router;
