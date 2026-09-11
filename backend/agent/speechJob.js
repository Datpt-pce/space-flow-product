const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { machineId } = require('./mediaDelivery');
let active;
const root = () => path.join(require('../utils/dataPaths').uploads, 'bcl-speech');
function liveLock() {
  const lock = path.join(root(), 'worker.json');
  if (!fs.existsSync(lock)) return null;
  const value = JSON.parse(fs.readFileSync(lock, 'utf8'));
  try { process.kill(value.pid, 0); return value; }
  catch (error) { if (error.code === 'EPERM') return value; fs.unlinkSync(lock); return null; }
}
function python() {
  const local = path.join(root(), 'runtime', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return process.env.SPEECH_PYTHON_EXECUTABLE || (fs.existsSync(local) ? local : process.env.PYTHON_EXECUTABLE || require('../utils/pythonExe').findPythonExe(path.resolve(__dirname, '../..')) || 'python');
}
async function runSpeechJob(payload) {
  if (!/^[a-f0-9-]{36}$/.test(payload.id)) throw new Error('Invalid speech job ID');
  const dir = path.join(root(), 'jobs', payload.id), statePath = path.join(dir, 'state.json');
  const read = () => {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (['queued', 'running'].includes(state.status) && liveLock()?.id !== payload.id) {
      state.status = 'failed'; state.error = 'Worker đã dừng. Chạy lại tác vụ.';
      fs.writeFileSync(statePath, JSON.stringify(state));
    }
    return { ...state, machineId:machineId() };
  };
  if (payload.operation === 'status') return read();
  if (payload.operation === 'cancel') {
    if (liveLock()?.id === payload.id) fs.writeFileSync(path.join(dir, 'cancel'), '1');
    return read();
  }
  if (payload.operation !== 'start') throw new Error('Unknown speech operation');
  if (fs.existsSync(statePath)) return read();
  if (active || liveLock()) throw new Error('Máy đang xử lý voice/captions. Chờ tác vụ hiện tại hoàn tất.');
  fs.mkdirSync(dir, { recursive:true });
  fs.writeFileSync(path.join(dir, 'input.json'), JSON.stringify({ ...payload, cacheDir:path.join(root(), 'cache'),
    seedVcDir:process.env.SEED_VC_DIR || path.join(root(), 'seed-vc'),
    comfyUrl:require('../utils/localServices').getLocalServiceUrl('comfyui') || 'http://127.0.0.1:8188' }));
  fs.writeFileSync(statePath, JSON.stringify({ id:payload.id, status:'queued', phase:'Đang khởi động AI local' }));
  const lockPath = path.join(root(), 'worker.json');
  fs.writeFileSync(lockPath, JSON.stringify({ id:payload.id, pid:process.pid }), { flag:'wx' });
  const proc = spawn(python(), [path.resolve(__dirname, '../../nodes/local-speech/bootstrap.py'), dir], {
    windowsHide:true, stdio:['ignore', 'ignore', 'pipe'], env:{ ...process.env, SF_UPLOADS_DIR:require('../utils/dataPaths').uploads, PYTHONUTF8:'1', PYTHONIOENCODING:'utf-8' },
  });
  active = { id:payload.id, proc };
  if (proc.pid) fs.writeFileSync(lockPath, JSON.stringify({ id:payload.id, pid:proc.pid }));
  let error = '';
  proc.stderr.on('data', chunk => { error = (error + chunk).slice(-3000); });
  const finish = message => {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (['queued', 'running'].includes(state.status)) fs.writeFileSync(statePath, JSON.stringify({ ...state, status:'failed', error:message || error || 'Worker đã dừng.' }));
    if (active?.id === payload.id) active = null;
    if (fs.existsSync(lockPath) && JSON.parse(fs.readFileSync(lockPath, 'utf8')).id === payload.id) fs.unlinkSync(lockPath);
  };
  proc.on('error', e => finish(e.message)); proc.on('close', () => finish());
  return read();
}
module.exports = { runSpeechJob };
