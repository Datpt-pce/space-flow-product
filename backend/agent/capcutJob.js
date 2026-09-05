const { spawn } = require('child_process');
const path = require('path');

function runCapcutJob(payload) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.PYTHON_EXECUTABLE || 'python', [path.resolve(__dirname, '../../nodes/capcut-generate/capcut_adapter.py')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('CapCut package operation timed out')); }, 120000);
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
    proc.on('close', code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(output);
        if (code || result.error) reject(new Error(result.error || error || 'CapCut adapter failed'));
        else resolve(result);
      } catch { reject(new Error(error || 'Invalid CapCut adapter response')); }
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(JSON.stringify(payload));
  });
}
module.exports = { runCapcutJob };
