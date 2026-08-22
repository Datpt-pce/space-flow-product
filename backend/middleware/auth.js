const { COOKIE_NAME, getUserForToken } = require('../services/sessions');

function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  const user = getUserForToken(token);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới thực hiện được thao tác này' });
  }
  next();
}

// Lets an agent process's own loopback call (middleware/relayToAgent.js relayed request,
// replayed by agent/connection.js against its own Express app) skip the real session-cookie
// check — the authorization decision already happened once on the server side before relaying.
// Every real browser request (no matching header) falls through to requireAuth unchanged.
function internalOrAuth(req, res, next) {
  const { INTERNAL_RELAY_TOKEN } = require('../agent/connection');
  if (req.headers['x-sf-internal-token'] === INTERNAL_RELAY_TOKEN) {
    req.user = { id: 'internal-relay', role: 'admin' };
    return next();
  }
  return requireAuth(req, res, next);
}

module.exports = { requireAuth, requireAdmin, internalOrAuth };
