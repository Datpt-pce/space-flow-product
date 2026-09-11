const express = require('express');
const { runs } = require('../services/workflowRunner');
const { stream } = require('./runs');
const router = express.Router();
// Legacy endpoint retains SSE events; the logical run is now independent of this response.
router.post('/', (req, res, next) => {
  try {
    const row = runs.submit(req.body || {}, req.user, {
      idempotencyKey: req.headers['idempotency-key'], requestId: req.requestId, correlationId: req.correlationId,
    });
    stream(req, res, row);
    runs.start();
  } catch (error) { next(error); }
});
module.exports = router;
