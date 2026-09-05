const express = require('express');
const multer = require('multer');
const path = require('path');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

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
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const safeName = sanitizeOriginalName(file.originalname);
    const ext = path.extname(safeName).slice(1).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      return cb(new Error('Định dạng file này không được phép upload'));
    }
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ path: req.file.path, filename: req.file.filename });
  });
});

module.exports = router;
