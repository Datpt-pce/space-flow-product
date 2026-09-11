const { getCredential } = require('../utils/credentials');
const { getCatalogs } = require('../utils/resizeUploadV3Catalog');

function resolveConfig(config, userId) {
  return { ...config, __resolved_v3_catalog: getCatalogs(userId).effective,
    __resolved_asana_pat: getCredential(config?.asana_credential_name, userId)?.data?.token || '' };
}

function resolveResizeUploadV3(req, res, next) {
  if (req.method !== 'POST' || !['/run', '/preview'].includes(req.path)) return next();
  const config = req.body?.config;
  if (!config || typeof config !== 'object' || Array.isArray(config) || !Array.isArray(config.rows)) {
    return res.status(400).json({ error: 'Config cần danh sách rows' });
  }
  const ids = new Set();
  for (const row of config.rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || !Array.isArray(row.input_folders) || row.input_folders.some(p => typeof p !== 'string')
      || !Array.isArray(row.platforms) || row.platforms.some(p => typeof p !== 'string')) {
      return res.status(400).json({ error: 'Dòng cần id riêng, folder và danh sách nền tảng hợp lệ' });
    }
    ids.add(row.id);
  }
  if (req.user.id !== 'internal-relay') {
    if (req.user.role !== 'admin' && !require('../db').prepare('SELECT 1 FROM user_node_permissions WHERE user_id = ? AND node_type = ?').get(req.user.id, 'resize-upload-v3')) {
      return res.status(403).json({ error: 'Chưa được cấp quyền dùng Resize & Upload V3' });
    }
    // Browser-supplied resolved fields are always replaced at the authenticated boundary.
    req.body.config = resolveConfig(config, req.user.id);
  }
  next();
}

module.exports = { resolveConfig, resolveResizeUploadV3 };
