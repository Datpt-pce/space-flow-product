const path = require('path');
const express = require('express');
const { spawnPython } = require('../engine/runner');

const router = express.Router();

// POST /api/video/metadata — lấy thumbnail + title của 1 URL video (không tải)
router.post('/metadata', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const result = await spawnPython(
      path.join(__dirname, '..', '..', 'nodes', 'video-downloader', 'metadata.py'),
      { url }
    );
    res.json(result);
  } catch (err) {
    res.json({ url, error: err.message });
  }
});

module.exports = router;
