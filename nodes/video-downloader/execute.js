const path = require('path');
const fs = require('fs');
const { spawnPython } = require('../../backend/engine/runner');
const { toContainerPath } = require('../../backend/utils/hostPath');
const { fromItems, pathToItem } = require('../../backend/utils/items');

module.exports = async function execute(inputs, config, context) {
  const portUrls = Array.isArray(inputs.urls_in) ? fromItems(inputs.urls_in) : [];
  const rawLines = (config.urls_manual || '').split('\n');
  const rawLabels = Array.isArray(config.urls_labels) ? config.urls_labels : [];
  const sanitizeUrl = (u) => u.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

  // Không dedupe theo giá trị URL — link trùng nhau ở nhiều vị trí (label khác nhau) vẫn giữ
  // nguyên số dòng; tối ưu bằng cách tải chung 1 lần (downloadCache bên dưới) rồi copy ra nhiều
  // file thay vì gọi lại yt-dlp cho từng vị trí trùng.
  const entries = [
    ...portUrls.map(url => ({ url, label: null })),
    ...rawLines.map((line, i) => ({ url: line.trim(), label: rawLabels[i] ?? null })),
  ]
    .map(e => ({ url: sanitizeUrl(e.url), label: e.label }))
    .filter(e => /^https?:\/\//i.test(e.url));

  if (entries.length === 0) throw new Error('Không có URL nào để tải');

  const outDir = config.output_dir?.trim()
    ? toContainerPath(config.output_dir.trim())
    : path.join(context.uploadsDir, 'video-downloader');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Số lần 1 URL xuất hiện quyết định cách đặt tên: xuất hiện 1 lần thì rename-tại-chỗ (không
  // rác thêm file, như trước giờ); xuất hiện nhiều lần thì giữ nguyên file gốc bất biến và copy
  // ra từng bản có label — tránh 2 entry cùng tranh nhau rename/đọc 1 file khi chạy song song.
  const urlOccurrences = new Map();
  for (const { url } of entries) urlOccurrences.set(url, (urlOccurrences.get(url) || 0) + 1);

  const downloadCache = new Map(); // url đã sanitize -> Promise<string|null>, chỉ tải thật 1 lần/URL
  const getRawFilePath = (url) => {
    if (!downloadCache.has(url)) {
      downloadCache.set(url, (async () => {
        const result = await spawnPython(
          path.join(__dirname, 'downloader.py'),
          { url, output_dir: outDir, format: config.output_format || 'best' }
        );
        return result.file_path || null;
      })());
    }
    return downloadCache.get(url);
  };

  const results = new Array(entries.length).fill(null);
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < entries.length) {
      const i = nextIdx++;
      const { url, label } = entries[i];
      const isCacheHit = downloadCache.has(url);
      context.log(isCacheHit
        ? `[${i + 1}/${entries.length}] Dùng lại video đã tải (link trùng): ${url}`
        : `[${i + 1}/${entries.length}] Bắt đầu tải: ${url}`);
      try {
        const rawPath = await getRawFilePath(url);
        if (!rawPath) {
          context.log(`✗ Không tìm thấy file sau khi tải: ${url}`);
          continue;
        }
        let filePath = rawPath;
        if (label) {
          const newPath = path.join(path.dirname(rawPath), `${label}_${path.basename(rawPath)}`);
          try {
            if (urlOccurrences.get(url) > 1) fs.copyFileSync(rawPath, newPath);
            else fs.renameSync(rawPath, newPath);
            filePath = newPath;
          } catch (renameErr) {
            context.log(`⚠ Không đặt được tên theo vị trí ô (${label}): ${renameErr.message}`);
          }
        }
        results[i] = filePath;
        context.log(`✓ Xong: ${path.basename(filePath)}`);
      } catch (err) {
        context.log(`✗ Lỗi (${url}): ${err.message}`);
      }
    }
  };

  const concurrency = Math.max(1, Math.min(10, Number(config.concurrency) || 5));
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));

  const downloadedFiles = results.filter(Boolean);
  if (downloadedFiles.length === 0) throw new Error('Không tải được video nào');
  context.log(`Hoàn tất: ${downloadedFiles.length}/${entries.length} video`);
  return { files_out: downloadedFiles.map(p => pathToItem(p)) };
};
