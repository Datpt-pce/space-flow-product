#!/usr/bin/env node
const { ReviewConfig } = require('../backend/contributions/config');
const { ModelRunner } = require('../backend/contributions/models');
require('../backend/node_modules/dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function main() {
  const config = new ReviewConfig(); const command = process.argv[2] || 'doctor';
  if (command === 'staging-setup') {
    const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
    const current = config.initialize(); const id = `local-${current.machineId.slice(0, 8)}`;
    if (current.releaseTargets.some(target => target.id === id)) return console.log('Target staging đã được cấu hình.');
    const directory = path.join(current.workspaceRoot, 'targets', id); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const envFile = path.join(directory, 'runtime.env');
    fs.writeFileSync(envFile, `CREDENTIALS_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}\nSIGNING_KEY_PASSPHRASE=${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    config.write({ ...current, releaseTargets: [...current.releaseTargets, { id, name: `Staging Docker · ${current.machineName}`, kind: 'docker-staging', platform: 'linux/amd64', machineId: current.machineId, backendPort: 4182, envFile }] });
    return console.log('Đã cấu hình target staging Docker cục bộ. Chỉ chạy khi owner duyệt và bấm áp dụng.');
  }
  if (command === 'doctor') return console.log(JSON.stringify(await new ModelRunner(config).doctor(), null, 2));
  if (command === 'sandbox-setup') {
    config.initialize();
    const source = await require('../backend/contributions/source').sourceFiles(config.read().sourceRoot);
    const sandbox = new (require('../backend/contributions/docker').DockerSandbox)(config);
    return console.log(JSON.stringify(await sandbox.setup(source.files), null, 2));
  }
  if (command === 'sandbox-runtime-probe') {
    const { DockerSandbox, httpProof } = require('../backend/contributions/docker');
    const imageId = process.argv[3]; if (!/^sha256:[a-f0-9]{64}$/.test(imageId || '')) throw new Error('Cần image ID đầy đủ.');
    const sandbox = new DockerSandbox(config); const runtime = await sandbox.startRuntime({ imageId }, { ttlMs: 120000 });
    try { console.log(JSON.stringify(await httpProof(runtime.backendUrl), null, 2)); } finally { await sandbox.stopRuntime(runtime); }
    return;
  }
  if (['connect', 'baseline-prepare', 'baseline-publish', 'worker'].includes(command)) {
    const runtime = require('../backend/contributions/runtime'); const settings = runtime.service.config.initialize();
    if (!settings.ownerEmail) throw new Error('Cần SF_REVIEW_OWNER_EMAIL hoặc ADMIN_EMAILS trước khi cấu hình.');
    const owner = { id: 'local-owner-cli', email: settings.ownerEmail, name: 'Owner CLI', role: 'admin', status: 'active' };
    if (command === 'connect') return console.log(JSON.stringify(await runtime.service.connect(owner), null, 2));
    if (command === 'baseline-prepare') return console.log(JSON.stringify(await runtime.distribution.prepare(owner), null, 2));
    if (command === 'baseline-publish') return console.log(JSON.stringify(await runtime.distribution.publish(owner, process.argv[3]), null, 2));
    runtime.service.config.update({ workerEnabled: true }); runtime.worker.start();
    console.log('Review worker chạy trên máy ' + settings.machineName + '. Ctrl+C để dừng.');
    const keepAlive = setInterval(() => {}, 60000);
    const stop = async () => { clearInterval(keepAlive); await runtime.worker.stop(); process.exit(0); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (command === 'model-probe') {
    const { createJob, queue } = require('../backend/contributions/jobs');
    const { validatePolicy } = require('../backend/contributions/policy');
    const provider = process.argv[3] || 'codex';
    let job = createJob({ title: 'Kiểm tra kết nối review', description: 'Chỉ xác nhận đầu vào có tiêu đề; không có source hay test để đánh giá.', author: { userId: 'local-probe' } });
    job = queue(job, 1, 'local-probe', validatePolicy({ provider, maxCallMs: 60000 }));
    const result = await new ModelRunner(config).run(job, job.tasks[0]);
    console.log(JSON.stringify({ provider, actualModel: result.actualModel, modelVerified: result.modelVerified, usage: result.usage, durationMs: result.durationMs, report: result.report }, null, 2)); return;
  }
  throw new Error('Lệnh hợp lệ: doctor, model-probe [codex|claude], sandbox-setup, staging-setup, connect, baseline-prepare, baseline-publish <id>, worker');
}
main().catch(error => { console.error(JSON.stringify({ code: error.code || 'FAILED', message: error.message, diagnostic: error.diagnostic || undefined })); process.exitCode = 1; });
