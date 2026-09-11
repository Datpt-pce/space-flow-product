const fs = require('fs');
const path = require('path');
const root = '/work/frontend/dist'; const files = {}; let size = 0;
function visit(directory) {
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name); const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Invalid artifact entry');
    if (stat.isDirectory()) visit(target);
    else {
      size += stat.size; if (stat.size > 16 * 1024 * 1024 || size > 80 * 1024 * 1024 || Object.keys(files).length >= 4096) throw new Error('Artifact too large');
      files[path.relative(root, target).replaceAll(path.sep, '/')] = fs.readFileSync(target).toString('base64');
    }
  }
}
visit(root); if (!files['index.html']) throw new Error('Missing index.html');
process.stdout.write(JSON.stringify(files));
