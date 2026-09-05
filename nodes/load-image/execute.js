const fs = require('fs');
const path = require('path');
const { toContainerPath } = require('../../backend/utils/hostPath');

module.exports = async function execute(inputs, config, context) {
  const filePath = toContainerPath(config.file_path);
  if (!filePath) throw new Error('No file path specified');
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const ext = path.extname(filePath).toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff'];
  if (!allowed.includes(ext)) throw new Error(`Unsupported format: ${ext}`);

  context.log(`Loaded: ${path.basename(filePath)}`);

  // Get dimensions via Python (avoids native npm deps on Windows)
  const { spawnPython } = require('../../backend/engine/runner');
  let width = 0, height = 0;
  try {
    const result = await spawnPython(
      path.join(__dirname, 'get-size.py'),
      { path: filePath }
    );
    width = result.width;
    height = result.height;
  } catch {
    context.log('Could not read image dimensions');
  }

  return { image_out: filePath, width, height };
};
