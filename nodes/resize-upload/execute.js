const path = require('path');
const fs = require('fs');
const { spawnPython } = require('../../backend/engine/runner');
const { itemToPath, pathToItem } = require('../../backend/utils/items');

const DIR = __dirname;
const SETTINGS_FILE = path.join(DIR, 'settings.json');
const CUSTOM_LINKS_FILE = path.join(DIR, 'custom_links.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

module.exports = async function execute(inputs, config, context) {
  const settings = readJson(SETTINGS_FILE, {});
  const custom_links = readJson(CUSTOM_LINKS_FILE, {});

  const onLine = (line) => {
    if (!line) return;
    if (line.startsWith('PROGRESS\t')) {
      const [, percentStr, message] = line.split('\t');
      context.progress(Number(percentStr) || 0, message || '');
    } else {
      context.log(line);
    }
  };

  // executor.py's stdin contract expects plain folder path strings — unwrap the
  // Item[] at this JS boundary, the Python script itself is untouched.
  const foldersIn = Array.isArray(inputs.folders_in) ? inputs.folders_in.map(it => itemToPath(it)) : inputs.folders_in;

  const result = await spawnPython(
    path.join(DIR, 'executor.py'),
    { inputs: { ...inputs, folders_in: foldersIn }, config, settings, custom_links },
    onLine
  );

  context.log(`Xong: ${result.files_out.length} video, ${result.unc_links.length} UNC, ${result.gcs_links.length} GCS link`);
  // unc_links/gcs_links are plain link strings (not files) — left untouched; files_out
  // is a genuine file-path list, wrapped into the standard Item[] envelope.
  return { ...result, files_out: result.files_out.map(p => pathToItem(p)) };
};
