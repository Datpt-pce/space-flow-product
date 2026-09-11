const fs = require('fs');
const path = require('path');
const { scanSecrets, manifestFor } = require('./source');
const { requireValue } = require('./errors');

const SKILLS = ['space-flow-change', 'space-flow-debug', 'space-flow-review', 'space-flow-impact', 'space-flow-harness'];
const SCHEMAS = ['001-init', '002-story-verify', '003-tool-registry', '004-intervention', '005-tool-extensions',
  '006-changeset-applied', '007-story-dependencies', '008-story-hierarchy', '009-improvement-identity',
  '010-story-backlog-links', '011-legacy-evidence-snapshots', '012-review-finding-closure', '013-changeset-content-sha', '014-entity-revisions'];
const FILES = ['AGENTS.md', 'CLAUDE.md', '.claude/rules/project.md', '.agent/README.md',
  'docs/ARCHITECTURE.md', 'docs/HARNESS.md', 'docs/TOOLS.md', 'docs/UI.md', 'docs/changes/README.md',
  '.github/pull_request_template.md', '.code-review-graphignore', 'scripts/contributor-tools.cjs',
  ...SKILLS.map(name => `.agent/skills/${name}/SKILL.md`)];
function toolkitFiles(sourceRoot) {
  const root = path.join(sourceRoot, 'contributor-kit'); const files = {};
  for (const name of FILES) {
    const target = path.join(root, name);
    requireValue(fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink() && fs.statSync(target).isFile() &&
      fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep), 'TOOLKIT_SOURCE', `Thiếu hoặc không an toàn: contributor-kit/${name}.`);
    const bytes = fs.readFileSync(target);
    requireValue(bytes.length <= 128000, 'TOOLKIT_SIZE', 'Tài liệu bộ công cụ vượt giới hạn.');
    scanSecrets(name, bytes); files[name] = bytes;
    files[`contributor-kit/${name}`] = bytes;
    if (name.startsWith('.agent/skills/')) {
      files[name.replace('.agent/', '.agents/')] = bytes;
      files[name.replace('.agent/', '.claude/')] = bytes;
    }
  }
  // Schema only, never the owner's populated Harness database.
  for (const schema of SCHEMAS) {
    const name = `scripts/schema/${schema}.sql`; const target = path.join(sourceRoot, name);
    requireValue(fs.existsSync(target) && !fs.lstatSync(target).isSymbolicLink() &&
      fs.realpathSync(target).startsWith(fs.realpathSync(sourceRoot) + path.sep), 'TOOLKIT_SCHEMA', `Thiếu schema Harness: ${name}.`);
    const bytes = fs.readFileSync(target); scanSecrets(name, bytes); files[name] = bytes;
  }
  files['contributor-toolkit.json'] = Buffer.from(JSON.stringify({ schemaVersion: 1, version: 1,
    files: manifestFor(files), excluded: ['owner history and specifications', 'personal settings and hooks', 'secrets and accounts', 'Harness database', 'graph index', 'production commands'] }, null, 2) + '\n');
  return files;
}
module.exports = { toolkitFiles, FILES, SKILLS };
