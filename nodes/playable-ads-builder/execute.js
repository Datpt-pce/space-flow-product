const fs = require('fs');
const path = require('path');
const { toContainerPath } = require('../../backend/utils/hostPath');
const { pathToItem, itemToPath } = require('../../backend/utils/items');
const { NETWORKS, buildHtml } = require('./template');

function defaultState() {
  return {
    start: 0, end: 5, loop: true, pauseBeforeExit: false, exitOnClick: false,
    openOnEnter: false, openOnClick: true,
    cursorOn: false, cursorX: 50, cursorY: 50, cursorScale: 100,
  };
}

// Nối node List vào videos_in => xuất theo TỪNG video, title = tên file video (bỏ đuôi mở
// rộng) — không dùng config.title/video_path thủ công nữa (frontend khoá 2 ô đó khi đã nối).
function jobsFromVideosIn(videosIn) {
  return (videosIn || [])
    .map((it) => itemToPath(it))
    .filter(Boolean)
    .map((p) => ({ videoPath: toContainerPath(p), title: path.parse(p).name }));
}

module.exports = async function execute(inputs, config, context) {
  const androidUrl = (config.linkDownloadAndroid || '').trim();
  const iosUrl = (config.linkDownloadIos || '').trim();
  if (!androidUrl && !iosUrl) throw new Error('Cần điền ít nhất 1 trong 2 URL (Android hoặc iOS)');
  const states = Array.isArray(config.states) && config.states.length ? config.states : [defaultState()];
  const networks = Array.isArray(config.networks) && config.networks.length
    ? config.networks
    : Object.keys(NETWORKS);
  const selectedNetworks = networks.filter((n) => NETWORKS[n]);
  if (!selectedNetworks.length) throw new Error('Chưa chọn network nào');

  let jobs = jobsFromVideosIn(inputs.videos_in);
  if (!jobs.length) {
    const title = (config.title || '').trim();
    const videoPath = toContainerPath((config.video_path || '').trim());
    if (!title) throw new Error('Thiếu Ad Title');
    if (!videoPath) throw new Error('Chưa chọn video');
    jobs = [{ videoPath, title }];
  }

  const files_out = [];
  for (let j = 0; j < jobs.length; j++) {
    const { videoPath, title } = jobs[j];
    if (!fs.existsSync(videoPath)) throw new Error(`Không tìm thấy file video: ${videoPath}`);

    context.progress(Math.round((j / jobs.length) * 95), `Đang đọc video ${j + 1}/${jobs.length}: ${title}`);
    const base64Video = fs.readFileSync(videoPath).toString('base64');

    // Output đi cùng chỗ với video: <thư mục chứa video>/{AND,IOS}/<tên video>/ — không phải
    // uploadsDir. Tên folder/file luôn theo tên VIDEO (không theo Ad Title, vốn có thể khác ở
    // mode thủ công).
    const videoName = path.parse(videoPath).name;
    const safeVideoName = videoName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const videoDir = path.dirname(videoPath);

    for (const [platformKey, url] of [['AND', androidUrl], ['IOS', iosUrl]].filter(([, u]) => u)) {
      const outDir = path.join(videoDir, platformKey, safeVideoName);
      fs.mkdirSync(outDir, { recursive: true });

      for (const net of selectedNetworks) {
        const { extraHead, downloadBody } = NETWORKS[net];
        const html = buildHtml({ title, url, states, base64Video, extraHead, downloadBody });
        const fileName = `${safeVideoName}_${net}.html`;
        const filePath = path.join(outDir, fileName);
        fs.writeFileSync(filePath, html, 'utf8');
        files_out.push(pathToItem(filePath, { mimeType: 'text/html', fileName }));
      }
    }
  }

  context.progress(100, `Đã xuất ${files_out.length} file playable ad`);
  context.log(`Đã xuất ${files_out.length} file playable ad cho ${jobs.length} video`);
  return { files_out };
};
