// Custom Node Platform Phase 6 pipeline step 2/9: compatibility range check. Step 1 already ran
// the full manifest JSON-schema validation (sfpkg.verify() -> validateManifest()) — the one
// thing that still needs a live check is whether the *declared* compatibility.spaceFlow SemVer
// range actually covers the Space-Flow version this pipeline is running as, which only the
// running server can know (not a static schema fact).

const fs = require('fs');
const path = require('path');
const semver = require('semver');

const id = '02-schema';
const name = 'Compatibility range check';

const VERSION_PATH = path.join(__dirname, '..', '..', '..', 'VERSION.json');

// VERSION.json uses a 4-segment build number ("1.0.0.20", see CLAUDE.md §11) which isn't valid
// SemVer — coerce() takes the leading 3 segments, matching what a package author would
// realistically write in compatibility.spaceFlow (nobody declares a 4th "build" component).
function currentSpaceFlowVersion() {
  try {
    const raw = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')).version;
    return semver.coerce(raw)?.version || null;
  } catch {
    return null;
  }
}

async function run(ctx) {
  if (!ctx.manifest) return { pass: false, detail: 'skipped — no valid manifest from step 01' };

  const range = ctx.manifest.compatibility?.spaceFlow;
  const current = currentSpaceFlowVersion();
  if (!current) return { pass: false, detail: 'could not determine current Space-Flow version from VERSION.json' };
  if (!semver.validRange(range)) return { pass: false, detail: `compatibility.spaceFlow "${range}" is not a valid SemVer range` };
  if (!semver.satisfies(current, range)) {
    return { pass: false, detail: `declared range "${range}" does not include the running Space-Flow version ${current}` };
  }
  return { pass: true, detail: `compatible with running Space-Flow ${current} (range "${range}")` };
}

module.exports = { id, name, run };
