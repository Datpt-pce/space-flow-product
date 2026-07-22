const path = require('path');
const fs = require('fs');
const { spawnPython } = require('../../backend/engine/runner');

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

  const result = await spawnPython(
    path.join(DIR, 'executor.py'),
    { inputs, config, settings, custom_links },
    onLine
  );

  context.log(`Xong: ${result.files_out.length} video, ${result.unc_links.length} UNC, ${result.gcs_links.length} GCS link`);
  return result;
};
