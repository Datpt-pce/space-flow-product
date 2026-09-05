const express = require('express');
const path = require('path');
const scheduler = require('../engine/scheduler');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

router.post('/:triggerNodeId', (req, res) => {
  const { workflow, intervalSeconds } = req.body;
  if (!workflow) return res.status(400).json({ error: 'Missing workflow' });
  const seconds = Number(intervalSeconds) || 60;
  scheduler.activate(req.params.triggerNodeId, workflow, seconds, UPLOADS_DIR);
  res.json({ active: true, intervalSeconds: seconds });
});

router.delete('/:triggerNodeId', (req, res) => {
  scheduler.deactivate(req.params.triggerNodeId);
  res.json({ active: false });
});

router.get('/:triggerNodeId', (req, res) => {
  res.json({ active: scheduler.isActive(req.params.triggerNodeId) });
});

module.exports = router;
