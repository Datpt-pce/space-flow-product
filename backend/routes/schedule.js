const express = require('express');
const scheduler = require('../engine/scheduler');

const router = express.Router();

router.post('/:triggerNodeId', (req, res) => {
  const { workflow, intervalSeconds } = req.body;
  if (!workflow) return res.status(400).json({ error: 'Missing workflow' });
  const seconds = intervalSeconds === undefined ? 60 : Number(intervalSeconds);
  scheduler.activate(req.params.triggerNodeId, workflow, seconds, req.user);
  res.json({ active: true, intervalSeconds: seconds });
});

router.delete('/:triggerNodeId', (req, res) => {
  scheduler.deactivate(req.params.triggerNodeId, req.user.id);
  res.json({ active: false });
});

router.get('/:triggerNodeId', (req, res) => {
  res.json({ active: scheduler.isActive(req.params.triggerNodeId, req.user.id) });
});

module.exports = router;
