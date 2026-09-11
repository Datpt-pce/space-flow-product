const express = require('express');
const { runs } = require('../services/workflowRunner');
const router = express.Router();

function publicRun(row) {
  return { id: row.id, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
    requestId: row.request_id, correlationId: row.correlation_id, cancelRequested: !!row.cancel_requested };
}
function stream(req, res, row) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Run-Id', row.id);
  res.flushHeaders();
  let cursor = Number(req.headers['last-event-id'] || req.query.after || 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  const write = (event, data, seq) => {
    if (res.destroyed || res.writableEnded) return;
    if (seq <= cursor) return;
    cursor = seq;
    // A slow subscriber is disconnected and can resume from Last-Event-ID; work keeps running.
    if (res.writableLength > 1024 * 1024) return res.destroy();
    res.write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (['done', 'error'].includes(event)) res.end();
  };
  const unsubscribe = runs.subscribe(row.id, write);
  let batch;
  do {
    batch = runs.events(row.id, req.user.id, cursor);
    for (const event of batch) write(event.event, event.data, event.seq);
  } while (batch.length === 1000 && !res.writableEnded && !res.destroyed);
  if (!['queued', 'running'].includes(row.state) && !res.writableEnded) res.end();
  const heartbeat = setInterval(() => { if (!res.destroyed && !res.writableEnded) res.write(': heartbeat\n\n'); }, 15000);
  const close = () => { clearInterval(heartbeat); unsubscribe(); };
  res.once('close', close); if (res.writableEnded) close();
}
router.post('/', (req, res, next) => {
  try {
    const row = runs.submit(req.body || {}, req.user, { idempotencyKey: req.headers['idempotency-key'], requestId: req.requestId, correlationId: req.correlationId });
    runs.start(); res.status(202).json(publicRun(row));
  } catch (error) { next(error); }
});
router.get('/:id', (req, res, next) => { try { res.json(publicRun(runs.get(req.params.id, req.user.id))); } catch (error) { next(error); } });
router.get('/:id/events', (req, res, next) => { try { stream(req, res, runs.get(req.params.id, req.user.id)); } catch (error) { next(error); } });
router.post('/:id/cancel', (req, res, next) => { try { res.json(publicRun(runs.cancel(req.params.id, req.user.id))); } catch (error) { next(error); } });
module.exports = { router, stream, publicRun };
