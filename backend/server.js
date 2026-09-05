require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('./db'); // opens/creates the sqlite DB + runs schema on startup

const { requireAuth, requireAdmin, internalOrAuth } = require('./middleware/auth');
const { requireCsrf } = require('./middleware/csrf');
const { relayToAgent } = require('./middleware/relayToAgent');
const { resolveResizeUploadV2Run } = require('./middleware/resolveResizeUploadV2');

const app = express();
// Agent mode (native install, khong Docker) mac dinh port khac dev (3001) de dev.bat va agent
// chay dong thoi tren cung 1 may khong tu kill nham nhau - xem agentSetupScript.js (cung port).
const PORT = process.env.PORT || (process.env.SPACE_FLOW_MODE === 'agent' ? 4010 : 3001);

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WORKFLOWS_DIR = path.join(__dirname, 'workflows');
[UPLOADS_DIR, WORKFLOWS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

// Request trình duyệt thật luôn same-origin (Vite proxy /api sang backend ở mọi môi trường —
// frontend/vite.config.js) nên CORS restrictive không ảnh hưởng luồng đó; chỉ chặn site lạ gọi
// credentialed cross-origin. !origin cho phép request không có Origin header (curl, server-to-server).
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5174,http://localhost:2612')
  .split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || allowedOrigins.includes(origin)) ? cb(null, true) : cb(new Error('CORS: origin không được phép')),
  credentials: true,
}));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', require('./routes/auth'));

app.use('/api/nodes', requireAuth, requireCsrf, require('./routes/nodes'));
app.use('/api/local-nodes', requireAuth, requireCsrf, require('./routes/local-nodes'));
app.use('/api/registry/submissions', requireAuth, requireCsrf, require('./routes/registry-submissions'));
app.use('/api/registry/admin', requireAuth, requireAdmin, requireCsrf, require('./routes/registry-admin'));
app.use('/api/registry/public', requireAuth, requireCsrf, require('./routes/registry-public'));
app.use('/api/workflows', requireAuth, requireCsrf, require('./routes/workflows'));
app.use('/api/sheets', requireAuth, requireCsrf, require('./routes/sheets'));
app.use('/api/google-oauth', requireAuth, requireCsrf, require('./routes/google-oauth'));
app.use('/api/graph', requireAuth, requireCsrf, require('./routes/graph'));
app.use('/api/saved-graph-views', requireAuth, requireCsrf, require('./routes/saved-graph-views'));
app.use('/api/video-projects', requireAuth, requireCsrf, require('./routes/video-projects'));
app.use('/api/video-versions', requireAuth, requireCsrf, require('./routes/video-versions'));
app.use('/api/video-automation', requireAuth, requireCsrf, require('./routes/video-automation'));
app.use('/api/video-capcut', requireAuth, requireCsrf, require('./routes/video-capcut'));
app.use('/api/video-timeline-collections', requireAuth, requireCsrf, require('./routes/video-timeline-collections'));
app.use('/api/video-bulk-import', requireAuth, requireCsrf, require('./routes/video-bulk-import'));
app.use('/api/video-assets', requireAuth, requireCsrf, require('./routes/video-assets'));
app.use('/api/video-render', requireAuth, requireCsrf, require('./routes/video-render'));
app.use('/api/execute', requireAuth, requireCsrf, require('./routes/execute'));
app.use('/api/upload', requireAuth, requireCsrf, require('./routes/upload'));
app.use('/api/files', internalOrAuth, requireCsrf, relayToAgent({ only: ['/browse-folder', '/browse-file', '/resolve-drop', '/open-folder', '/list-dir', '/preview'] }), require('./routes/files'));
app.use('/api/capcut', internalOrAuth, requireCsrf, relayToAgent(), require('./routes/capcut'));
app.use('/api/video', internalOrAuth, requireCsrf, relayToAgent(), require('./routes/video'));
app.use('/api/resize-upload', internalOrAuth, requireCsrf, relayToAgent(), require('./routes/resize-upload'));
app.use('/api/resize-upload-v2', internalOrAuth, requireCsrf, resolveResizeUploadV2Run, relayToAgent({ only: ['/run', '/last-session'] }), require('./routes/resize-upload-v2'));
app.use('/api/system', internalOrAuth, requireCsrf, relayToAgent({ only: ['/status', '/update-deps', '/auto-update-config'] }), require('./routes/system'));
app.use('/api/schedule', requireAuth, requireCsrf, require('./routes/schedule'));
app.use('/api/credentials', requireAuth, requireCsrf, require('./routes/credentials'));
app.use('/api/local-services', internalOrAuth, requireAdmin, requireCsrf, relayToAgent(), require('./routes/local-services'));
app.use('/api/users', requireAuth, requireAdmin, requireCsrf, require('./routes/users'));
app.use('/api/agents', requireAuth, requireCsrf, require('./routes/agents'));
// Public (no requireAuth) — the setup script is fetched by `irm | iex` / a downloaded .bat
// running on the target machine, which never carries the browser's session cookie. Auth is the
// agent token itself (see routes/agent-install.js), same trust model as the WS register handshake.
app.use('/api/agent-install', require('./routes/agent-install'));

// Bắt lỗi chưa xử lý (vd CORS reject ném Error) để trả JSON gọn thay vì trang HTML mặc định của
// Express — trang đó lộ nguyên stack trace + đường dẫn file server ra client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  if (res.headersSent) return next(err);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.status || 500).json({ error: message });
});

// SPACE_FLOW_MODE=agent (mặc định): mọi node kể cả local-only chạy tại chỗ — hành vi hiện
// tại, không đổi gì. Nếu có server trung tâm để dial-out tới thì kết nối relay.
// SPACE_FLOW_MODE=server: đây LÀ server trung tâm — bật WebSocket nhận agent đăng ký/chuyển
// tiếp lệnh Run (backend/routes/execute.js đọc `runsOn` để quyết định relay hay chạy tại chỗ).
const SPACE_FLOW_MODE = process.env.SPACE_FLOW_MODE || 'agent';
const httpServer = require('http').createServer(app);

if (SPACE_FLOW_MODE === 'server') {
  require('./ws/agentServer').attachAgentServer(httpServer);
}

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Loi: port ${PORT} da bi tien trinh khac chiem (co the 1 agent cu van dang chay ngam) - tat tien trinh do roi chay lai.`);
  } else {
    console.error('Loi khoi dong server:', err.message);
  }
  process.exit(1);
});

httpServer.listen(PORT, () => {
  require('./routes/video-render').startRenderRecovery();
  console.log(`Space Flow backend (mode=${SPACE_FLOW_MODE}) running on http://localhost:${PORT}`);
  if (SPACE_FLOW_MODE === 'agent') {
    require('./agent/connection').connect(PORT);
    require('./agent/autoUpdate').start();
  }
  require('./graph/reindexQueue').start();
  require('./services/sheetSyncWorker').start();
});
