const { CSRF_COOKIE_NAME } = require('../services/sessions');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Double-submit cookie check: cookie sf_csrf (không httpOnly) phải khớp header X-CSRF-Token mà
// frontend/src/lib/api.js tự gắn. Site lạ có thể khiến trình duyệt tự gửi cookie kèm request,
// nhưng không đọc được giá trị cookie (same-origin policy) để set header khớp.
function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.user?.id === 'internal-relay') return next(); // relay server-to-server, không phải browser
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token không hợp lệ' });
  }
  next();
}

module.exports = { requireCsrf };
