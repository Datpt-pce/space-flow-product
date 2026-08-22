const path = require('path');
const sharp = require('sharp');

function outPath(uploadsDir, baseName, ext) {
  const fileName = `${baseName}-${Date.now()}.${ext}`;
  return { filePath: path.join(uploadsDir, fileName), fileName };
}

module.exports = async function execute(inputs, config, context) {
  const items = inputs.items || [];
  const operation = config.operation || 'resize';
  const sourceBinaryField = config.sourceBinaryField || 'data';
  const outputBinaryField = config.outputBinaryField || 'data';

  const result = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const bin = item.binary?.[sourceBinaryField];
    if (!bin?.path) {
      result.push(item);
      continue;
    }

    let img = sharp(bin.path);
    let ext = (path.extname(bin.path).replace('.', '') || 'jpg').toLowerCase();

    switch (operation) {
      case 'resize': {
        const w = Number(config.width) || undefined;
        const h = Number(config.height) || undefined;
        if (w || h) img = img.resize(w, h, { fit: config.fit || 'cover' });
        break;
      }
      case 'rotate':
        img = img.rotate(Number(config.angle) || 90);
        break;
      case 'blur':
        img = img.blur(Number(config.sigma) || 5);
        break;
      case 'crop':
        img = img.extract({
          left: Number(config.left) || 0,
          top: Number(config.top) || 0,
          width: Number(config.width) || 100,
          height: Number(config.height) || 100,
        });
        break;
      case 'grayscale':
        img = img.grayscale();
        break;
      case 'convertFormat': {
        const fmt = config.format || 'jpeg';
        img = img.toFormat(fmt, { quality: Number(config.quality) || 80 });
        ext = fmt === 'jpeg' ? 'jpg' : fmt;
        break;
      }
      default:
        throw new Error(`Edit Image: unknown operation "${operation}"`);
    }

    const { filePath, fileName } = outPath(context.uploadsDir, `img${i}`, ext);
    await img.toFile(filePath);

    result.push({
      json: item.json || {},
      binary: { [outputBinaryField]: { path: filePath, mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, fileName } },
    });
  }

  return { items: result };
};
