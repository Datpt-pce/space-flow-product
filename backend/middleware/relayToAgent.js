// Relays an auxiliary local-machine REST call (folder/file dialogs, CapCut control, resize-upload
// run, local-services config...) to the requesting user's own paired agent instead of letting it
// execute on the shared central server — see specs/hosted-deployment-and-local-agent.md ("máy ai
// thì dùng tài nguyên máy người đó"). Mirrors the relay pattern routes/execute.js already uses
// for full workflow runs (backend/ws/agentServer.js `isAgentOnline`/`sendHttpProxy`).
//
// `only`: optional allowlist of sub-paths (relative to the mount point, e.g. '/browse-folder')
// to relay — everything else under that mount falls through and keeps running on the server
// (used by /api/files, where cleanup/download-zip operate on the shared uploads/ dir).
function relayToAgent({ only } = {}) {
  return function (req, res, next) {
    const mode = process.env.SPACE_FLOW_MODE || 'agent';
    if (mode !== 'server') return next(); // agent mode (default): unchanged, runs locally as today
    if (only && !only.includes(req.path)) return next();

    const agentServer = require('../ws/agentServer');
    if (!agentServer.isAgentOnline(req.user.id)) {
      return res.status(409).json({
        error: 'Thao tác này chạy trên máy local của bạn nhưng agent của bạn hiện không online — mở agent trên máy bạn rồi thử lại.',
      });
    }
    agentServer.sendHttpProxy(req.user.id, { method: req.method, path: req.originalUrl, body: req.body }, res)
      .catch(err => { if (!res.headersSent) res.status(502).json({ error: 'Lỗi chuyển tiếp yêu cầu sang agent: ' + err.message }); });
  };
}

module.exports = { relayToAgent };
