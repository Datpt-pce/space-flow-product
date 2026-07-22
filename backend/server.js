require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WORKFLOWS_DIR = path.join(__dirname, 'workflows');
[UPLOADS_DIR, WORKFLOWS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/nodes', require('./routes/nodes'));
app.use('/api/workflows', require('./routes/workflows'));
app.use('/api/execute', require('./routes/execute'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/files', require('./routes/files'));
app.use('/api/capcut', require('./routes/capcut'));
app.use('/api/video', require('./routes/video'));
app.use('/api/resize-upload', require('./routes/resize-upload'));
app.use('/api/resize-upload-v2', require('./routes/resize-upload-v2'));
app.use('/api/system', require('./routes/system'));

app.listen(PORT, () => {
  console.log(`Space Flow backend running on http://localhost:${PORT}`);
});
