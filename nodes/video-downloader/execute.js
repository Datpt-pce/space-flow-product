const path = require('path');
const fs = require('fs');
const { spawnPython } = require('../../backend/engine/runner');
const { toContainerPath } = require('../../backend/utils/hostPath');

module.exports = async function execute(inputs, config, context) {
  const portUrls = Array.isArray(inputs.urls_in) ? inputs.urls_in : [];
  const manualUrls = (config.urls_manual || '')
    .split('\n').map(u => u.trim()).filter(Boolean);
  const urls = [...new Set([...portUrls, ...manualUrls])];

  if (urls.length === 0) throw new Error('Không có URL nào để tải');

  const outDir = config.output_dir?.trim()
    ? toContainerPath(config.output_dir.trim())
    : path.join(context.uploadsDir, 'video-downloader');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const downloadedFiles = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    context.log(`[${i + 1}/${urls.length}] Bắt đầu tải: ${url}`);
    try {
      const result = await spawnPython(
        path.join(__dirname, 'downloader.py'),
        { url, output_dir: outDir, format: config.output_format || 'best' }
      );
      if (result.file_path) {
        downloadedFiles.push(result.file_path);
        context.log(`✓ Xong: ${path.basename(result.file_path)}`);
      } else {
        context.log(`✗ Không tìm thấy file sau khi tải: ${url}`);
      }
    } catch (err) {
      context.log(`✗ Lỗi (${url}): ${err.message}`);
    }
  }

  if (downloadedFiles.length === 0) throw new Error('Không tải được video nào');
  context.log(`Hoàn tất: ${downloadedFiles.length}/${urls.length} video`);
  return { files_out: downloadedFiles };
};
