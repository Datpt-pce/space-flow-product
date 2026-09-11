const fs = require('fs');
const path = require('path');
// This code is copied into the trusted dependency image, never read from a PR.
if (fs.existsSync('/source')) {
  fs.cpSync('/source', '/work', { recursive: true, dereference: false });
  for (const name of ['backend', 'frontend', 'nodes']) {
    const target = path.join('/work', name, 'node_modules');
    if (fs.existsSync(target)) throw new Error('Unexpected dependencies in submitted source');
    fs.symlinkSync(`/opt/deps/${name}/node_modules`, target, 'dir');
  }
}
console.log('SF_REVIEW_READY');
setInterval(() => {}, 60000);
