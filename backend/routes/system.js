const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const router = express.Router();
const ROOT_DIR = path.join(__dirname, '..', '..');

// Chi may agent that (clone tu repo product qua buildAgentSetupScript, xem SettingsModal.jsx)
// moi duoc phep git reset --hard code moi. May dev (repo private space-flow) va server trung
// tam (D:\space-flow-server, deploy qua git archive, khong co .git) deu phai bi loai - reset
// --hard tren repo dev se xoa mat code dang sua do.
const PRODUCT_REPO_URL = 'https://github.com/Datpt-pce/space-flow-product.git';

function isAgentClone(dir) {
  try {
    const remote = execSync('git remote get-url origin', { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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
    const proc = spawn(cmd, args, { cwd, shell: true });
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

// Phai giu dong bo voi Dockerfile.backend (RUN pip3 install...) va script setup:python trong
// package.json (CLAUDE.md muc 12 Cross-Platform Feature Checklist) - them package Python moi cho
// node nao thi sua ca 3 cho. gdown pin cung 6.1.0 (xem docs/issues 2026-07-28: 6.1.x tro len doi
// API tham so 'fuzzy') - --upgrade van ton trong pin '==' nen khong vo tinh nang qua ban moi.
const PYTHON_PACKAGES = ['rembg', 'Pillow', 'requests', 'certifi', 'google-cloud-storage', 'yt-dlp', 'gdown==6.1.0'];

// Uu tien 'py' (Python Launcher that) truoc 'python'/'python3' - Windows co san 1 "app execution
// alias" python.exe gia tro toi Microsoft Store, Get-Command/where van thay no ton tai nen phai
// tu chay --version de xac nhan la Python that (xem buildAgentSetupScript Get-RealPythonExe).
function findPythonExe(cwd) {
  for (const exe of ['py', 'python', 'python3']) {
    try {
      const out = execSync(`${exe} --version 2>&1`, { cwd, encoding: 'utf8' });
      if (/Python \d/.test(out)) return exe;
    } catch {
      // exe nay khong that hoac khong ton tai - thu exe tiep theo
    }
  }
  return null;
}

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

router.get('/status', (req, res) => {
  const targets = availableTargets();
  res.json({
    available: targets.length === ALL_TARGETS.length,
    targets: targets.map(t => t.label),
    canUpdateCode: isAgentClone(ROOT_DIR),
  });
});

router.post('/update-deps', async (req, res) => {
  const targets = availableTargets();
  if (targets.length < ALL_TARGETS.length) {
    return res.status(400).json({ error: 'Chỉ khả dụng khi backend, frontend và root cùng nằm trên một máy (dev native), không dùng được trong container product.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const pullCode = isAgentClone(ROOT_DIR);
  if (pullCode) {
    send('log', { target: 'git', line: '=== git fetch + reset --hard origin/main ===' });
    try {
      await runCmd('git', ['fetch', 'origin'], ROOT_DIR, (line) => send('log', { target: 'git', line }));
      await runCmd('git', ['reset', '--hard', 'origin/main'], ROOT_DIR, (line) => send('log', { target: 'git', line }));
    } catch (err) {
      send('error', { target: 'git', error: err.message });
      res.end();
      return;
    }
  }

  // Nang cap thu vien Python (yt-dlp, gdown...) khong lien quan git/npm o tren nen chay
  // khong dieu kien pullCode - loi thuong gap nhat trong thuc te la yt-dlp cu gay lỗi tai
  // TikTok/site khac (xem docs/issues/2026-08-21-tiktok-ytdlp-stale-extractor.md).
  const pythonExe = findPythonExe(ROOT_DIR);
  if (pythonExe) {
    send('log', { target: 'python', line: `=== pip install --upgrade (${pythonExe}) ===` });
    try {
      await runCmd(pythonExe, ['-m', 'pip', 'install', '--upgrade', ...PYTHON_PACKAGES], ROOT_DIR, (line) => send('log', { target: 'python', line }));
    } catch (err) {
      // Khong chan npm update phia sau - thieu/loi Python khong lien quan gi den JS deps.
      send('log', { target: 'python', line: `Lỗi cập nhật thư viện Python (bỏ qua, không chặn phần còn lại): ${err.message}` });
    }
  } else {
    send('log', { target: 'python', line: 'Không tìm thấy Python trên máy này — bỏ qua bước cập nhật thư viện Python.' });
  }

  for (const target of targets) {
    send('log', { target: target.label, line: `=== npm update (${target.label}) ===` });
    try {
      await runNpmUpdate(target.dir, (line) => send('log', { target: target.label, line }));
    } catch (err) {
      send('error', { target: target.label, error: err.message });
      res.end();
      return;
    }
  }

  if (pullCode) {
    send('log', { target: 'restart', line: 'Code đã cập nhật — agent sẽ tự khởi động lại...' });
    send('done', { success: true, restarting: true });
    res.end();
    scheduleSelfRestart(ROOT_DIR);
    return;
  }

  send('done', { success: true });
  res.end();
});

module.exports = router;
