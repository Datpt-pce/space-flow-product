const { getCredential } = require('../utils/credentials');
const { getLinkCatalog } = require('../utils/linkCatalog');

// resize-upload-v2's own POST /run gets relayed whole to the requesting user's agent
// (relayToAgent({ only: ['/run', ...] }) in server.js) — the agent's copy of the route handler
// runs against its own local DB, which has no access to the credentials/link-catalog tables on
// the central server. So the actual secret/catalog value must be resolved HERE, before the relay,
// where req.user is the real authenticated session, and stashed into req.body.config for the
// agent to just use — see specs/resize-upload-v2-central-credentials.md.
function resolveResizeUploadV2Run(req, res, next) {
  if (req.method !== 'POST' || req.path !== '/run') return next();
  req.body.config = req.body.config || {};
  const cred = getCredential(req.body.config.asana_credential_name, req.user?.id);
  req.body.config.__resolved_asana_pat = cred?.data?.token || '';
  req.body.config.__resolved_links = getLinkCatalog(req.user?.id);
  next();
}

module.exports = { resolveResizeUploadV2Run };
