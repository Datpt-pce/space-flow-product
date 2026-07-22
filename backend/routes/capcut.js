const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');

const router = express.Router();

function killCapcut() {
  return new Promise((resolve) => {
    exec('taskkill /F /IM CapCut.exe', () => resolve());
  });
}

// POST /api/capcut/restart — kill CapCut nếu đang chạy, mở phiên mới
router.post('/restart', async (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(400).json({ error: 'Điều khiển CapCut chỉ khả dụng khi chạy trên Windows, không dùng được trong container product.' });
  }

  await killCapcut();

  const exePath = path.join(
    process.env.LOCALAPPDATA || '',
    'CapCut', 'Apps', 'CapCut.exe'
  );
  if (!fs.existsSync(exePath)) {
    return res.status(404).json({ error: `Không tìm thấy CapCut.exe tại ${exePath}` });
  }

  const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
  child.unref();

  res.json({ ok: true });
});

module.exports = router;
