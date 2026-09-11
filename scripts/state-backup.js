// Full-state snapshots require quiesced application/file writers. SQLite itself is copied online.
const path = require('path');
const { snapshot, restore } = require('../backend/services/stateBackup');
const paths = require('../backend/utils/dataPaths');
const [command, source, destination] = process.argv.slice(2);
async function main() {
  if (command === 'create' && source && process.argv.includes('--quiesced')) {
    const { database, uploads, workflows, installs, submissions, drafts, signingKey, config } = paths;
    const result = await snapshot({ database, destination: path.resolve(source),
      roots: { uploads, workflows, installs, submissions, drafts, 'signing-key': signingKey, config } });
    console.log(JSON.stringify({ completedAt: result.completedAt, files: result.files.length, counts: result.counts }));
  } else if (command === 'restore' && source && destination) {
    console.log(JSON.stringify(await restore(path.resolve(source), path.resolve(destination))));
  } else throw new Error('Usage: node scripts/state-backup.js create <new-directory> --quiesced | restore <backup> <new-directory>');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
