// Custom Node Platform Phase 6 (specs/space-flow-master-plan/01-custom-node-platform.md)
// pipeline step 1/9: archive/path-traversal + manifest schema validation. Reuses Phase 2's
// sfpkg.verify() wholesale (zip-slip/symlink rejection, ajv manifest schema) — no new logic
// needed here, this step is what actually gates every step after it on having a real manifest.

const { verify } = require('../sfpkg');

const id = '01-archive';
const name = 'Archive validation (zip-slip/symlink/manifest schema)';

async function run(ctx) {
  const result = verify({ buffer: ctx.archiveBuffer });
  if (!result.valid) {
    return { pass: false, detail: result.errors.join('; ') };
  }
  return {
    pass: true,
    detail: `manifest valid, checksum ${result.checksum}`,
    manifest: result.manifest,
    checksum: result.checksum,
  };
}

module.exports = { id, name, run };
