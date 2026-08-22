require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
require('./db'); // opens/creates the sqlite DB + runs schema on startup

const { requireAuth, requireAdmin, internalOrAuth } = require('./middleware/auth');
const { relayToAgent } = require('./middleware/relayToAgent');

const app = express();
const PORT = process.env.PORT || 3001;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const WORKFLOWS_DIR = path.join(__dirname, 'workflows');
[UPLOADS_DIR, WORKFLOWS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', require('./routes/auth'));

app.use('/api/nodes', requireAuth, require('./routes/nodes'));
app.use('/api/workflows', requireAuth, require('./routes/workflows'));
app.use('/api/execute', requireAuth, require('./routes/execute'));
app.use('/api/upload', requireAuth, require('./routes/upload'));
app.use('/api/files', internalOrAuth, relayToAgent({ only: ['/browse-folder', '/browse-file', '/resolve-drop', '/open-folder', '/list-dir', '/preview'] }), require('./routes/files'));
app.use('/api/capcut', internalOrAuth, relayToAgent(), require('./routes/capcut'));
app.use('/api/video', internalOrAuth, relayToAgent(), require('./routes/video'));
app.use('/api/resize-upload', internalOrAuth, relayToAgent(), require('./routes/resize-upload'));
app.use('/api/resize-upload-v2', internalOrAuth, relayToAgent(), require('./routes/resize-upload-v2'));
app.use('/api/system', internalOrAuth, relayToAgent(), require('./routes/system'));
app.use('/api/schedule', requireAuth, require('./routes/schedule'));
app.use('/api/credentials', requireAuth, require('./routes/credentials'));
app.use('/api/local-services', internalOrAuth, requireAdmin, relayToAgent(), require('./routes/local-services'));
app.use('/api/users', requireAuth, requireAdmin, require('./routes/users'));
app.use('/api/agents', requireAuth, require('./routes/agents'));
// Public (no requireAuth) — the setup script is fetched by `irm | iex` / a downloaded .bat
// running on the target machine, which never carries the browser's session cookie. Auth is the
// agent token itself (see routes/agent-install.js), same trust model as the WS register handshake.
app.use('/api/agent-install', require('./routes/agent-install'));

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
  console.log(`Space Flow backend (mode=${SPACE_FLOW_MODE}) running on http://localhost:${PORT}`);
  if (SPACE_FLOW_MODE === 'agent') {
    require('./agent/connection').connect(PORT);
  }
});
