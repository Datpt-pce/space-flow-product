const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const artifacts = require('../services/artifacts');

const router = express.Router();
const UPLOADS_DIR = require('../utils/dataPaths').uploads;

// Chặn các extension có thể bị trình duyệt thực thi (stored XSS) khi mở trực tiếp file đã
// upload qua /uploads (express.static) — không dùng allowlist vì node "file-list" cho phép
// upload file tuỳ ý (không chỉ ảnh) làm input workflow.
const DANGEROUS_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'php', 'php3', 'php4', 'php5', 'phtml', 'jsp', 'jspx',
  'asp', 'aspx', 'sh', 'bash', 'exe', 'msi', 'dll', 'bat', 'cmd', 'ps1', 'js', 'mjs', 'cjs',
  'jar', 'com', 'scr', 'vbs', 'wsf',
]);

function sanitizeOriginalName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, crypto.createHash('sha256').update(req.user.id).digest('hex'));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = sanitizeOriginalName(file.originalname);
    const ext = path.extname(safeName).slice(1).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      return cb(new Error('Định dạng file này không được phép upload'));
    }
    cb(null, `${crypto.randomUUID()}-${safeName}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 8, parts: 9, fieldSize: 8192, fieldNestingDepth: 2 } });

router.post('/', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    try {
      const artifact = await artifacts.register(req.file.path, req.user.id, { expiresAt: Date.now() + 7 * 86400000 });
      res.json({ path: req.file.path, filename: req.file.filename, artifactId: artifact.id });
    } catch (error) {
      fs.unlinkSync(req.file.path);
      res.status(error.status || 500).json({ error: 'Cannot register uploaded artifact' });
    }
  });
});

module.exports = router;
