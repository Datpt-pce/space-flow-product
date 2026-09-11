const path = require('path');

const backend = path.resolve(__dirname, '..');
const state = process.env.SF_DATA_DIR ? path.resolve(process.env.SF_DATA_DIR) : null;
const root = (name, fallback) => path.resolve(process.env[name] || (state ? path.join(state, fallback) : path.join(backend, fallback)));
module.exports = {
  database: path.resolve(process.env.SF_DB_PATH || (state ? path.join(state, 'db/space-flow.sqlite') : path.join(backend, 'db/space-flow.sqlite'))),
  uploads: root('SF_UPLOADS_DIR', 'uploads'),
  workflows: root('SF_WORKFLOWS_DIR', 'workflows'),
  installs: root('SF_INSTALLS_DIR', 'registry-installs'),
  submissions: root('SF_SUBMISSIONS_DIR', 'registry-submissions'),
  drafts: root('SF_DRAFTS_DIR', 'registry/local-drafts'),
  signingKey: root('SF_SIGNING_KEY_PATH', 'registry/signing-key.pem'),
  config: root('SF_CONFIG_DIR', 'config'),
};
