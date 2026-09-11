const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const executor = require('../engine/executor');
const { getManifest } = require('../utils/nodeManifests');
const artifacts = require('./artifacts');
const { uploads } = require('../utils/dataPaths');

async function execute(intent, user, send, context) {
  const { workflow, startNodeId, resume } = intent;
  const mode = process.env.SPACE_FLOW_MODE || 'agent';
  for (const node of workflow.nodes) {
    if (node.type === 'resize-upload-v3') node.config = require('../middleware/resolveResizeUploadV3').resolveConfig(node.config || {}, user.id);
  }
  const needsAgent = mode === 'server' && workflow.nodes.some(n => getManifest(n.type)?.runsOn === 'local');
  require('../analytics/jobLocation').recordJobLocation(db, 'workflow', context.runId, needsAgent ? 'agent' : 'server');
  const sendTracked = (event, data) => {
    if ((event === 'nodeComplete' && !data.pinned && !data.disabled) || event === 'nodeError') {
      const type = workflow.nodes.find(n => n.id === data.nodeId)?.type;
      if (type) db.prepare('INSERT INTO usage_events(id,user_id,kind,ref,status) VALUES (?,?,?,?,?)')
        .run(crypto.randomUUID(), user.id, 'node', type, event === 'nodeComplete' ? 'success' : 'error');
    }
    send(event, data);
  };
  if (needsAgent) {
    const agent = require('../ws/agentServer');
    if (!agent.isAgentOnline(user.id)) throw Object.assign(new Error('Local agent is offline'), { code: 'AGENT_OFFLINE' });
    for (const node of workflow.nodes) {
      if (node.type === 'resize-upload-v2') {
        node.config = node.config || {};
        node.config.__resolved_asana_pat = require('../utils/credentials').getCredential(node.config.asana_credential_name, user.id)?.data?.token || '';
        node.config.__resolved_links = require('../utils/linkCatalog').getLinkCatalog(user.id);
      }
    }
    // Mark all dispatched unsafe work conservatively before transport: old agents may not emit nodeStart.
    for (const node of workflow.nodes) if (!node.pinnedData && node.active !== false) send('nodeStart', { nodeId: node.id });
    const abort = () => agent.cancelJob(user.id, context.runId);
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      await agent.sendJob(user.id, { type: 'run', workflow, startNodeId, resume, requestId: context.requestId, correlationId: context.correlationId }, sendTracked, context.runId);
    } finally { context.signal.removeEventListener('abort', abort); }
    return;
  }
  const ownerRoot = path.join(uploads, 'runs', crypto.createHash('sha256').update(user.id).digest('hex'));
  let runRoot = path.join(ownerRoot, context.runId);
  if (resume) {
    const { decrypt } = require('../utils/encryption');
    const priorRuns = db.prepare("SELECT id,intent FROM flow_runs WHERE owner_id=? AND id<>? AND state IN ('unknown','failed','succeeded') ORDER BY created_at DESC LIMIT 100").all(user.id, context.runId);
    for (const prior of priorRuns) {
      if (JSON.stringify(JSON.parse(decrypt(prior.intent)).workflow) !== JSON.stringify(workflow)) continue;
      const event = db.prepare("SELECT data FROM run_events WHERE run_id=? AND event='runOutputRoot' ORDER BY seq DESC LIMIT 1").get(prior.id);
      if (event) {
        const candidate = path.resolve(JSON.parse(decrypt(event.data)).path);
        if (candidate.startsWith(ownerRoot + path.sep)) runRoot = candidate;
      }
      break;
    }
  }
  fs.mkdirSync(runRoot, { recursive: true });
  send('runOutputRoot', { path: runRoot });
  await executor.run(workflow, runRoot, sendTracked, startNodeId, resume, user.id, { ...context, executionLocation: 'server' });
  async function registerOutputs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.scratch', '.checkpoints'].includes(entry.name) || entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await registerOutputs(file);
      else if (entry.isFile()) {
        const artifact = await artifacts.register(file, user.id, { kind: 'workflow-output' });
        db.prepare('INSERT OR IGNORE INTO run_artifacts(run_id,artifact_id) VALUES(?,?)').run(context.runId, artifact.id);
      }
    }
  }
  await registerOutputs(runRoot);
}
const runs = require('./runService').createRunService(db, { execute });
module.exports = { runs, execute };
