const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const target = process.argv[2];
if (!target || !target.startsWith('/work/') || !/\.test\.(js|cjs|mjs)$/.test(target) || !fs.statSync(target).isFile()) process.exit(2);
const state = fs.mkdtempSync('/tmp/sf-review-test-');
const result = spawnSync(process.execPath, ['--test', '--test-timeout=45000', target], { cwd: '/work', stdio: 'inherit', timeout: 60000,
  env: { ...process.env, NODE_ENV: 'test', SF_DATA_DIR: state, SF_IMPORT_LEGACY: '0', SPACE_FLOW_MODE: 'agent', CENTRAL_SERVER_URL: '',
    SF_REVIEW_WORKER_AUTOSTART: '0', CREDENTIALS_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    SIGNING_KEY_PASSPHRASE: 'isolated-review-fixture-only' } });
process.exit(result.status === 0 && !result.error ? 0 : 1);
