const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { contributorFiles } = require('./distribution');
const { SKILLS } = require('./toolkit');
const { hash } = require('./policy');
const { allowedChangeNote } = require('./source');

test('contributor kit exports discoverable identical skills, verified manifest and no owner settings', () => {
  const files = contributorFiles(path.resolve(__dirname, '../..'));
  for (const name of SKILLS) {
    const canonical = files[`.agent/skills/${name}/SKILL.md`];
    assert.deepEqual(files[`.agents/skills/${name}/SKILL.md`], canonical);
    assert.deepEqual(files[`.claude/skills/${name}/SKILL.md`], canonical);
  }
  const manifest = JSON.parse(files['contributor-toolkit.json']);
  for (const [name, digest] of Object.entries(manifest.files)) assert.equal(hash(files[name]), digest);
  for (const name of ['.claude/settings.json', '.claude/settings.local.json', 'harness.db', '.env', 'scripts/deploy-server.sh']) assert.equal(files[name], undefined);
  const pkg = JSON.parse(files['package.json']);
  for (const name of ['tools:setup', 'tools:doctor', 'graph']) assert.ok(pkg.scripts[name]);
  assert.match(files['AGENTS.md'].toString(), /CONTRIBUTING/);
});
test('change notes never open policy or runtime paths', () => {
  assert.equal(allowedChangeNote('docs/changes/text-empty.md'), true);
  for (const name of ['docs/changes/README.md', 'docs/changes/../AGENTS.md', 'docs/changes/symlink.js', 'docs/TOOLS.md', '.claude/skills/x/SKILL.md', 'backend/server.js']) assert.equal(allowedChangeNote(name), false);
});
