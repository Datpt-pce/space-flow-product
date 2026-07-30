const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, execFile } = require('child_process');
const { ZipArchive } = require('archiver');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const HOST_MOUNT_PREFIX = '/host-fs/';

// Chỉ đọc/ghi, không bao giờ xoá dữ liệu trong các thư mục/ổ đĩa đã mount từ máy host
// (%USERPROFILE%, các ổ đĩa, EXTRA_HOST_DIR_N) — chặn ở đây để đảm bảo dù logic bên trên
// có thay đổi thế nào, thao tác xoá vẫn không bao giờ chạm tới dữ liệu thật của người dùng.
function assertNotHostMounted(absPath) {
  if (absPath.replace(/\\/g, '/').startsWith(HOST_MOUNT_PREFIX)) {
    throw new Error('Không được phép xoá file trong thư mục/ổ đĩa đã mount từ máy host.');
  }
}

// POST /api/files/cleanup — xóa các file trong uploads/ không còn được tham chiếu
router.post('/cleanup', (req, res) => {
  const { referencedPaths = [] } = req.body;

  // Chuẩn hóa referenced paths thành tên file (basename)
  const referencedNames = new Set(
    referencedPaths.map(p => path.basename(p.replace(/\\/g, '/')))
  );

  let deleted = 0;

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full);
        // Xóa thư mục con nếu rỗng
        try {
          assertNotHostMounted(full);
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {}
      } else if (!referencedNames.has(entry.name)) {
        try {
          assertNotHostMounted(full);
          fs.unlinkSync(full);
          deleted++;
        } catch {}
      }
    }
  }

  scanDir(UPLOADS_DIR);
  res.json({ deleted });
});

const WIN32_ONLY_ERROR = 'Chức năng này chỉ khả dụng khi chạy trên Windows, không dùng được trong container product. Vui lòng nhập đường dẫn thủ công.';

const MEDIA_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.mp4', '.mov', '.avi', '.mkv', '.webm'];
const JSON_EXTS = ['.json'];

function matchesExt(name, filter) {
  const exts = filter === 'media' ? MEDIA_EXTS : JSON_EXTS;
  return exts.includes(path.extname(name).toLowerCase());
}

// Các root cho phép duyệt qua modal web (chỉ dùng khi chạy trong Docker product,
// nơi %USERPROFILE%, các ổ đĩa (start.ps1 tự dò) và EXTRA_HOST_DIR_N được mount qua
// docker-compose.yml)
const DRIVE_LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DRIVE_ROOTS = DRIVE_LETTERS.map(L => ({
  id: `drive-${L.toLowerCase()}`,
  label: `Ổ đĩa ${L}:`,
  dir: `/host-fs/drive-${L.toLowerCase()}`,
  requireEnv: `HOST_DRIVE_${L}`,
}));

const ROOT_CONFIG = [
  { id: 'home', label: 'Thư mục người dùng', dir: process.env.HOST_FS_HOME },
  ...DRIVE_ROOTS,
  { id: 'extra1', label: process.env.EXTRA_HOST_DIR_1, dir: '/host-fs/extra1', requireEnv: 'EXTRA_HOST_DIR_1' },
  { id: 'extra2', label: process.env.EXTRA_HOST_DIR_2, dir: '/host-fs/extra2', requireEnv: 'EXTRA_HOST_DIR_2' },
  { id: 'extra3', label: process.env.EXTRA_HOST_DIR_3, dir: '/host-fs/extra3', requireEnv: 'EXTRA_HOST_DIR_3' },
];

function getBrowsableRoots() {
  return ROOT_CONFIG.filter(r => r.dir && (!r.requireEnv || process.env[r.requireEnv]) && fs.existsSync(r.dir));
}

const SEARCH_MAX_DIRS = 15000;
const SEARCH_MAX_DEPTH = 10;
const SEARCH_TIME_BUDGET_MS = 8000;

function normalizeName(name) {
  return name.normalize('NFC').toLowerCase();
}

// Bounded BFS tìm file/folder đã kéo-thả trong các root đã mount (dùng khi chạy trong
// Docker product, nơi resolve-drop bằng PowerShell/COM không thể chạy được dù browser
// vẫn ở Windows host). So khớp theo tên (+ size với file, để phân biệt trùng tên) —
// duyệt nông trước (BFS), dừng sớm khi đã tìm đủ, giới hạn số thư mục/depth/thời gian
// để không block event loop của backend (route này chạy song song với SSE progress
// của các node khác đang chạy).
async function searchMountedRoots(items) {
  const pending = new Map();
  for (const it of items) {
    if (!it || !it.name) continue;
    const key = normalizeName(it.name);
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push(it);
  }
  if (pending.size === 0) return [];

  const found = new Map();
  const roots = getBrowsableRoots();
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  let dirsVisited = 0;

  for (const root of roots) {
    if (found.size >= pending.size || dirsVisited >= SEARCH_MAX_DIRS || Date.now() > deadline) break;

    let realRoot;
    try { realRoot = fs.realpathSync(root.dir); } catch { continue; }

    const queue = [{ dir: realRoot, depth: 0 }];
    while (queue.length) {
      if (found.size >= pending.size || dirsVisited >= SEARCH_MAX_DIRS || Date.now() > deadline) break;

      const { dir, depth } = queue.shift();
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
      dirsVisited++;
      if (dirsVisited % 200 === 0) await new Promise(r => setImmediate(r));

      for (const entry of entries) {
        const key = normalizeName(entry.name);
        const specs = pending.get(key);
        const full = path.join(dir, entry.name);

        if (specs && !found.has(key)) {
          if (entry.isDirectory()) {
            if (specs.some(s => s.isDir === true)) found.set(key, full);
          } else {
            let matched = specs.some(s => s.size == null);
            if (!matched) {
              try {
                const st = await fs.promises.stat(full);
                matched = specs.some(s => s.size === st.size);
              } catch { /* ignore, treat as no match */ }
            }
            if (matched) found.set(key, full);
          }
        }

        if (entry.isDirectory() && depth + 1 <= SEARCH_MAX_DEPTH) {
          queue.push({ dir: full, depth: depth + 1 });
        }
      }
    }
  }

  return [...found.values()];
}

// Đảm bảo `relPath` (tương đối) không thoát ra khỏi `rootDir`, kể cả qua symlink
function resolveWithinRoot(rootDir, relPath) {
  let realRoot;
  try { realRoot = fs.realpathSync(rootDir); } catch { return null; }
  const target = path.resolve(realRoot, relPath || '.');
  if (!fs.existsSync(target)) return null;
  const realTarget = fs.realpathSync(target);
  const rel = path.relative(realRoot, realTarget);
  if (rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) return null;
  return realTarget;
}

// POST /api/files/open-folder — mở thư mục chứa file trong Explorer (Windows)
router.post('/open-folder', (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'filePath required' });
  if (process.platform !== 'win32') return res.status(400).json({ error: WIN32_ONLY_ERROR });

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

  const dir = path.dirname(absPath);
  exec(`explorer /select,"${absPath}"`, (err) => {
    if (err) exec(`explorer "${dir}"`);
  });
  res.json({ ok: true });
});

// POST /api/files/browse-folder — mở dialog chọn thư mục kiểu Save As hiện đại, trả về path đã chọn
router.post('/browse-folder', (req, res) => {
  if (process.platform !== 'win32') return res.json({ path: null, error: WIN32_ONLY_ERROR });

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(0,0)
    $owner.Show()
    $owner.Activate()
    $f = New-Object System.Windows.Forms.SaveFileDialog
    $f.Title = 'Chon thu muc'
    $f.CheckFileExists = $false
    $f.CheckPathExists = $true
    $f.OverwritePrompt = $false
    $f.ValidateNames = $false
    $f.Filter = 'Thu muc|no.files'
    $f.FileName = 'Chon thu muc nay'
    $result = $f.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') { Write-Output (Split-Path $f.FileName -Parent) }
  `;
  execFile('powershell', ['-NoProfile', '-STA', '-Command', script], (err, stdout) => {
    res.json({ path: (stdout || '').trim() || null });
  });
});

// POST /api/files/browse-file — mở dialog chọn 1 file (mặc định lọc .json), trả về path đã chọn
router.post('/browse-file', (req, res) => {
  if (process.platform !== 'win32') return res.json({ path: null, error: WIN32_ONLY_ERROR });

  const { filter } = req.body || {};
  const dialogFilter = filter === 'media'
    ? `Media Files|${MEDIA_EXTS.map(e => '*' + e).join(';')}|All files|*.*`
    : `JSON|${JSON_EXTS.map(e => '*' + e).join(';')}|All files|*.*`;
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.StartPosition = 'CenterScreen'
    $owner.Size = New-Object System.Drawing.Size(0,0)
    $owner.Show()
    $owner.Activate()
    $f = New-Object System.Windows.Forms.OpenFileDialog
    $f.Title = 'Chon file'
    $f.Filter = '${dialogFilter}'
    $f.CheckFileExists = $true
    $result = $f.ShowDialog($owner)
    $owner.Close()
    if ($result -eq 'OK') { Write-Output $f.FileName }
  `;
  execFile('powershell', ['-NoProfile', '-STA', '-Command', script], (err, stdout) => {
    res.json({ path: (stdout || '').trim() || null });
  });
});

// GET /api/files/list-dir — duyệt thư mục qua web (fallback khi browse-folder/browse-file
// không chạy được trong Docker product, dùng dữ liệu từ các root đã mount ở docker-compose.yml)
router.get('/list-dir', (req, res) => {
  const roots = getBrowsableRoots();
  const { root, dir = '', filter } = req.query;

  if (!root) {
    return res.json({ roots: roots.map(({ id, label }) => ({ id, label })) });
  }

  const rootCfg = roots.find(r => r.id === root);
  if (!rootCfg) return res.status(400).json({ error: 'Root không hợp lệ' });

  const resolved = resolveWithinRoot(rootCfg.dir, dir);
  if (!resolved) return res.status(403).json({ error: 'Đường dẫn nằm ngoài phạm vi cho phép' });

  let stat;
  try { stat = fs.statSync(resolved); } catch { return res.status(404).json({ error: 'Không tìm thấy' }); }
  if (!stat.isDirectory()) return res.status(400).json({ error: 'Không phải thư mục' });

  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true })
      .map(e => {
        const isDir = e.isDirectory();
        let mtime = null;
        let size = null;
        try {
          const stat = fs.statSync(path.join(resolved, e.name));
          mtime = stat.mtime.toISOString();
          size = isDir ? null : stat.size;
        } catch {}
        return {
          name: e.name,
          type: isDir ? 'dir' : 'file',
          dir: dir ? `${dir}/${e.name}` : e.name,
          matchesFilter: isDir ? true : matchesExt(e.name, filter),
          mtime,
          size,
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  } catch {
    return res.status(403).json({ error: 'Không có quyền đọc thư mục này' });
  }

  const parts = dir ? dir.split('/').filter(Boolean) : [];
  const breadcrumb = [
    { name: rootCfg.label, dir: '' },
    ...parts.map((p, i) => ({ name: p, dir: parts.slice(0, i + 1).join('/') })),
  ];

  res.json({ root, dir, absPath: resolved, breadcrumb, entries });
});

// GET /api/files/preview — stream file từ đường dẫn tuyệt đối bất kỳ (không giới hạn trong uploads/)
router.get('/preview', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'File not found' });

  res.sendFile(absPath);
});

// POST /api/files/resolve-drop — resolve tên file/folder vừa kéo thả từ Explorer thành đường dẫn thật
router.post('/resolve-drop', async (req, res) => {
  const { names = [], items = [] } = req.body;
  if (!Array.isArray(names) || names.length === 0) return res.json({ paths: [] });

  if (process.platform !== 'win32') {
    // Không có PowerShell/COM trong container Linux — tìm bằng tên (+ size) trong
    // các root đã mount (chỉ khi caller gửi kèm `items`, xem searchMountedRoots ở trên).
    if (!Array.isArray(items) || items.length === 0) return res.json({ paths: [] });
    try {
      const paths = await searchMountedRoots(items);
      return res.json({ paths });
    } catch {
      return res.json({ paths: [] });
    }
  }

  const script = `
    $shell = New-Object -ComObject Shell.Application
    foreach ($w in @($shell.Windows())) {
      try {
        $sel = $w.Document.SelectedItems()
        foreach ($item in @($sel)) { Write-Output $item.Path }
      } catch {}
    }
  `;
  execFile('powershell', ['-NoProfile', '-STA', '-Command', script], (err, stdout) => {
    const candidates = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const wantedNames = new Set(names.map(n => n.toLowerCase()));
    const seen = new Set();
    const paths = [];
    for (const p of candidates) {
      const base = path.basename(p).toLowerCase();
      if (wantedNames.has(base) && !seen.has(p)) {
        seen.add(p);
        paths.push(p);
      }
    }
    res.json({ paths });
  });
});

// POST /api/files/download-zip — trả về zip chứa danh sách files
router.post('/download-zip', (req, res) => {
  const { files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'files array required' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="space-flow-export.zip"');

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.pipe(res);

  for (const filePath of files) {
    const absPath = path.resolve(filePath);
    if (fs.existsSync(absPath)) {
      archive.file(absPath, { name: path.basename(absPath) });
    }
  }

  archive.finalize();
});

module.exports = router;
