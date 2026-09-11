const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ReviewError, requireValue } = require('./errors');

function cleanEnv() {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|LANG|LC_ALL|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
}
function executable(name) {
  if (path.isAbsolute(name) && fs.existsSync(name) && !/\.(cmd|bat)$/i.test(name)) return name;
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    for (const suffix of process.platform === 'win32' ? ['.exe', ''] : ['']) {
      const target = path.join(directory, name + suffix);
      if (fs.existsSync(target) && fs.statSync(target).isFile() && (process.platform !== 'win32' || suffix === '.exe')) return target;
    }
  }
  // npm's Windows shim cannot be invoked with shell:false. Resolve its signed native package.
  if (process.platform === 'win32' && name === 'claude') {
    const target = path.join(process.env.APPDATA || '', 'npm/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-x64/claude.exe');
    if (fs.existsSync(target)) return target;
  }
  throw new ReviewError('CLI_MISSING', `Chưa tìm thấy ${path.basename(name)}. Cấu hình đường dẫn CLI trên máy.`, 503);
}
function stopProcess(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', shell: false });
    killer.on('error', () => child.kill());
  } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
}
function startProcess(command, args, options = {}) {
  return spawn(command, args, { cwd: options.cwd, env: options.env || cleanEnv(), shell: false,
    windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
}
function runProcess(command, args, { input = '', cwd, env, signal, timeoutMs = 30000, maxBytes = 256000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = startProcess(command, args, { cwd, env });
    let output = ''; let stderr = ''; let failure; let size = 0;
    const stop = error => { failure ||= error; stopProcess(child); };
    const abort = () => stop(new ReviewError('CANCELLED', 'Tác vụ đã dừng.'));
    const timer = setTimeout(() => stop(new ReviewError('PROCESS_TIMEOUT', 'Tác vụ vượt giới hạn thời gian.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    for (const [stream, isError] of [[child.stdout, false], [child.stderr, true]]) stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) return stop(new ReviewError('OUTPUT_LIMIT', 'Kết quả vượt giới hạn dung lượng.'));
      if (isError) stderr += chunk; else output += chunk;
    });
    child.stdin.on('error', () => {});
    child.on('error', () => { failure ||= new ReviewError('PROCESS_START', 'Không khởi động được công cụ trên máy.', 503); });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve({ code, output, stderr });
    });
    child.stdin.end(input);
  });
}
function within(root, target) {
  const base = path.resolve(root); const resolved = path.resolve(target);
  requireValue(resolved.startsWith(base + path.sep) && resolved !== base, 'WORKSPACE_PATH', 'Đường dẫn vượt workspace.');
  return resolved;
}
function removeWorkspace(root, target) { fs.rmSync(within(root, target), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
module.exports = { cleanEnv, executable, stopProcess, startProcess, runProcess, within, removeWorkspace };
