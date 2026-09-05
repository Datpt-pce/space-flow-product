// Node Manifest v2 JSON Schema validator — Custom Node Platform Phase 2
// (specs/space-flow-master-plan/01-custom-node-platform.md). Compiles
// backend/registry/manifest-schema.json (drafted in Platform Core Phase 0.1) once at module
// load, exposes a single validate function.

const Ajv = require('ajv');
const schema = require('./manifest-schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn = ajv.compile(schema);

// Returns { valid: boolean, errors: string[] } — errors are human-readable
// "<path> <message>" strings, empty array when valid.
function validateManifest(manifest) {
  const valid = validateFn(manifest);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors || []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  return { valid: false, errors };
}

module.exports = { validateManifest };
