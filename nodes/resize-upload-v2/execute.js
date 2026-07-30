const path = require('path');
const fs = require('fs');
const { spawnPython } = require('../../backend/engine/runner');

const V1_DIR = path.join(__dirname, '..', 'resize-upload');
const SETTINGS_FILE = path.join(V1_DIR, 'settings.json');
const CUSTOM_LINKS_FILE = path.join(V1_DIR, 'custom_links.json');

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
    } else if (line.startsWith('ROWRESULT\t')) {
      try {
        context.rowResult(JSON.parse(line.slice('ROWRESULT\t'.length)));
      } catch { /* ignore malformed row result line */ }
    } else {
      context.log(line);
    }
  };

  const result = await spawnPython(
    path.join(__dirname, 'executor.py'),
    { inputs, config, settings, custom_links },
    onLine
  );

  context.log(`Xong: ${result.files_out.length} video, ${result.unc_links.length} UNC, ${result.gcs_links.length} GCS link`);
  return result;
};
