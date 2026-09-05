const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { readAutoUpdateConfig, writeAutoUpdateConfig } = require('../config/agentConfig');
const { findPythonExe } = require('../utils/pythonExe');

const router = express.Router();
const ROOT_DIR = path.join(__dirname, '..', '..');

// Chi may agent that (clone tu repo product qua buildAgentSetupScript, xem SettingsModal.jsx)
// moi duoc phep git reset --hard code moi. May dev (repo private space-flow) va server trung
// tam (D:\space-flow-server, deploy qua git archive, khong co .git) deu phai bi loai - reset
// --hard tren repo dev se xoa mat code dang sua do.
const PRODUCT_REPO_URL = 'https://github.com/Datpt-pce/space-flow-product.git';

function isAgentClone(dir) {
  try {
    const remote = execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    return remote === PRODUCT_REPO_URL;
  } catch {
    return false;
  }
}

const ALL_TARGETS = [
  { label: 'root', dir: ROOT_DIR },
  { label: 'frontend', dir: path.join(ROOT_DIR, 'frontend') },
  { label: 'backend', dir: path.join(ROOT_DIR, 'backend') },
];

// Container backend cua product (Dockerfile.backend) chi COPY backend/ + nodes/, khong
// co frontend/ hay package.json o root ben trong image -> tu phat hien target nao thuc
// su ton tai thay vi gia dinh ca 3 luon nam canh nhau nhu khi chay dev native.
function availableTargets() {
  return ALL_TARGETS.filter(t => fs.existsSync(path.join(t.dir, 'package.json')));
}

function runCmd(cmd, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, shell: true, windowsHide: true });
    let lineBuffer = '';

    const handle = (d) => {
      lineBuffer += d.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    };

    proc.stdout.on('data', handle);
    proc.stderr.on('data', handle);

    proc.on('close', (code) => {
      if (lineBuffer) onLine(lineBuffer.replace(/\r$/, ''));
      if (code !== 0) return reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code} (${cwd})`));
      resolve();
    });

    proc.on('error', reject);
  });
}

function runNpmUpdate(cwd, onLine) {
  return runCmd('npm', ['update'], cwd, onLine);
}

// Phai giu dong bo voi Dockerfile.backend (RUN pip3 install...), script setup:python trong
// package.json, VA backend/utils/agentSetupScript.js (script cai agent lan dau, CLAUDE.md muc 12
// Cross-Platform Feature Checklist) - them package Python moi cho node nao thi sua ca 4 cho.
// gdown pin cung 6.1.0 (xem docs/issues 2026-07-28: 6.1.x tro len doi API tham so 'fuzzy') -
// --upgrade van ton trong pin '==' nen khong vo tinh nang qua ban moi.
const PYTHON_PACKAGES = ['rembg', 'Pillow', 'requests', 'certifi', 'google-cloud-storage', 'yt-dlp', 'curl_cffi', 'gdown==6.1.0'];

// Agent chay bang 1 process `node server.js` tran (Startup folder, khong co supervisor/pm2 -
// xem buildAgentSetupScript) nen code moi vua git reset ve chi co hieu luc sau khi tu khoi
// dong lai. Spawn 1 process con doi vai giay (de process hien tai kip nha port) roi tu thoat.
// Co tinh KHONG di qua cmd.exe (truoc day: `cmd /c timeout ... && node server.js`) - tren
// Windows, `detached:true` ket hop spawn cmd.exe la pattern hay khien `windowsHide` khong duoc
// ton trong day du, lam hien cua so console den (xem docs/issues tuong ung). Spawn thang
// node.exe (khong qua shell nao) thi windowsHide hoat dong dang tin cay.
function scheduleSelfRestart(rootDir) {
  const backendDir = path.join(rootDir, 'backend');
  const waiterScript = `
    setTimeout(() => {
      require('child_process').spawn(process.execPath, ['server.js'], {
        cwd: ${JSON.stringify(backendDir)},
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
      process.exit(0);
    }, 2000);
  `;
  spawn(process.execPath, ['-e', waiterScript], {
    cwd: backendDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
  setTimeout(() => process.exit(0), 500);
}

// Doc VERSION.json + entry moi nhat trong CHANGELOG.md, dung cho icon thong bao phien ban moi
// o goc tren-phai frontend (VersionBell.jsx). Khong di qua relayToAgent (xem 'only' o server.js)
// vi day la version cua chinh server dang tra loi request, khong phai may agent cua user.
function readVersionInfo() {
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'VERSION.json'), 'utf8')).version;
  } catch {
    return { version: null, notes: '' };
  }

  let notes = '';
  try {
    const changelog = fs.readFileSync(path.join(ROOT_DIR, 'CHANGELOG.md'), 'utf8');
    const firstEntry = changelog.split(/\n(?=## )/).find(block => block.trim().startsWith('## '));
    if (firstEntry) notes = firstEntry.split('\n').slice(1).join('\n').trim();
  } catch {
    // CHANGELOG.md chua co entry nao - notes rong la binh thuong
  }

  return { version, notes };
}

router.get('/version', (req, res) => {
  res.json(readVersionInfo());
});

router.get('/status', (req, res) => {
  const targets = availableTargets();
  res.json({
    available: targets.length === ALL_TARGETS.length,
    targets: targets.map(t => t.label),
    canUpdateCode: isAgentClone(ROOT_DIR),
    version: readVersionInfo().version,
  });
});

// Lõi pipeline cập nhật, dùng chung cho route thủ công bên dưới VÀ scheduler tự động
// (agent/autoUpdate.js, qua router.internals) - onLog(target, line) thay cho SSE send() vì
// scheduler không có `res`; lỗi thì throw (gắn .target) thay vì tự ghi response.
async function runUpdatePipeline(onLog) {
  const targets = availableTargets();
  if (targets.length < ALL_TARGETS.length) {
    throw Object.assign(new Error('Chỉ khả dụng khi backend, frontend và root cùng nằm trên một máy (dev native), không dùng được trong container product.'), { target: 'update' });
  }

  const pullCode = isAgentClone(ROOT_DIR);
  if (pullCode) {
    onLog('git', '=== git fetch + reset --hard origin/main ===');
    try {
      await runCmd('git', ['fetch', 'origin'], ROOT_DIR, (line) => onLog('git', line));
      await runCmd('git', ['reset', '--hard', 'origin/main'], ROOT_DIR, (line) => onLog('git', line));
    } catch (err) {
      throw Object.assign(new Error(err.message), { target: 'git' });
    }
  }

  // Nang cap thu vien Python (yt-dlp, gdown...) khong lien quan git/npm o tren nen chay
  // khong dieu kien pullCode - loi thuong gap nhat trong thuc te la yt-dlp cu gay lỗi tai
  // TikTok/site khac (xem docs/issues/2026-08-21-tiktok-ytdlp-stale-extractor.md).
  // pythonWarning: khac voi git/npm o tren (throw lam fail ca pipeline), loi pip khong chan npm
  // update phia sau vi thieu/loi Python khong lien quan gi den JS deps - nhung phai bao ve tren
  // (khong duoc nuot am tham) de route/SSE lan luot bao that cho frontend thay vi luon bao xanh
  // "thanh cong" du yt-dlp/curl_cffi chua he duoc dung toi (xem docs/issues tuong ung).
  let pythonWarning = null;
  const pythonExe = findPythonExe(ROOT_DIR);
  if (pythonExe) {
    onLog('python', `=== pip install --upgrade (${pythonExe}) ===`);
    try {
      await runCmd(pythonExe, ['-m', 'pip', 'install', '--upgrade', ...PYTHON_PACKAGES], ROOT_DIR, (line) => onLog('python', line));
    } catch (err) {
      pythonWarning = `Lỗi cập nhật thư viện Python (${err.message})`;
      onLog('python', `${pythonWarning} — bỏ qua, không chặn phần còn lại.`);
    }
  } else {
    pythonWarning = 'Không tìm thấy Python trên máy này — thư viện Python (yt-dlp...) chưa được cập nhật.';
    onLog('python', pythonWarning);
  }

  for (const target of targets) {
    onLog(target.label, `=== npm update (${target.label}) ===`);
    try {
      await runNpmUpdate(target.dir, (line) => onLog(target.label, line));
    } catch (err) {
      throw Object.assign(new Error(err.message), { target: target.label });
    }
  }

  return { pullCode, pythonWarning };
}

router.post('/update-deps', async (req, res) => {
  const targets = availableTargets();
  if (targets.length < ALL_TARGETS.length) {
    return res.status(400).json({ error: 'Chỉ khả dụng khi backend, frontend và root cùng nằm trên một máy (dev native), không dùng được trong container product.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  let result;
  try {
    result = await runUpdatePipeline((target, line) => send('log', { target, line }));
  } catch (err) {
    send('error', { target: err.target || 'update', error: err.message });
    res.end();
    return;
  }

  if (result.pullCode) {
    send('log', { target: 'restart', line: 'Code đã cập nhật — agent sẽ tự khởi động lại...' });
    send('done', { success: true, restarting: true, pythonWarning: result.pythonWarning || null });
    res.end();
    scheduleSelfRestart(ROOT_DIR);
    return;
  }

  send('done', { success: true, pythonWarning: result.pythonWarning || null });
  res.end();
});

router.get('/auto-update-config', (req, res) => {
  res.json(readAutoUpdateConfig());
});

router.post('/auto-update-config', (req, res) => {
  const { enabled, windowStart, windowEnd } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled phải là boolean' });
  }
  const hasStart = windowStart != null;
  const hasEnd = windowEnd != null;
  if (hasStart !== hasEnd) {
    return res.status(400).json({ error: 'Cần nhập đủ cả giờ bắt đầu và kết thúc, hoặc để trống cả hai.' });
  }
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (hasStart && (!timeRe.test(windowStart) || !timeRe.test(windowEnd))) {
    return res.status(400).json({ error: 'Định dạng giờ không hợp lệ (HH:MM).' });
  }
  res.json(writeAutoUpdateConfig({ enabled, windowStart: windowStart ?? null, windowEnd: windowEnd ?? null }));
});

// Cho agent/autoUpdate.js tái sử dụng đúng pipeline + guard ở trên (thay vì tự chạy git/npm
// riêng) - router.js không được require() trực tiếp ở đâu khác ngoài mount middleware trong
// server.js, nên gắn thêm property lên nó (1 function object) là an toàn.
router.internals = { isAgentClone, runUpdatePipeline, scheduleSelfRestart, ROOT_DIR };

module.exports = router;
