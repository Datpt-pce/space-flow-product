const { spawn } = require('child_process');
const { findPythonExe } = require('../utils/pythonExe');

// Cache o module-level - findPythonExe spawn 1 process con (`--version`) moi lan goi, khong the
// lam viec do tren moi lan chay node Python (spawnPython goi rat thuong xuyen). Phai la CUNG mot
// ham resolve voi backend/routes/system.js (pipeline "Cap nhat") de tranh interpreter mismatch:
// truoc day noi nay goi cung literal 'python', trong khi pipeline Cap nhat uu tien 'py' - tren may
// co nhieu ban Python song song, 2 lenh nay co the tro toi 2 moi truong khac nhau, khien "Cap nhat"
// bao thanh cong nhung yt-dlp luc chay that van la ban cu (xem docs/issues tuong ung).
let cachedPythonExe = null;

function resolvePythonExe() {
  if (!cachedPythonExe) {
    cachedPythonExe = findPythonExe(process.cwd()) || 'python';
  }
  return cachedPythonExe;
}

function spawnPython(scriptPath, payload, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePythonExe(), [scriptPath], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let stderrLineBuffer = '';

    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();

    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => {
      stderr += d;
      if (!onLine) return;
      stderrLineBuffer += d;
      const lines = stderrLineBuffer.split('\n');
      stderrLineBuffer = lines.pop();
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    });

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `Python exited with code ${code}`));
      try {
        const result = JSON.parse(stdout);
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch {
        reject(new Error(`Invalid JSON from Python executor: ${stdout}`));
      }
    });

    proc.on('error', reject);
  });
}

// validateOutput() — Custom Node Platform Phase 4
// (specs/space-flow-master-plan/01-custom-node-platform.md): "Output validate theo port schema
// trước khi ghi results[nodeId] — bước chưa tồn tại hiện nay, kể cả cho built-in." Two
// deliberately different severities, not one:
//
// - Missing declared output ports -> WARNING (logged, never thrown). None of the 55 built-in
//   node.json manifests have ever had this checked before, so treating a mismatch as fatal now
//   would risk breaking real production workflows over a pre-existing, previously-silent gap
//   that isn't this change's to fix. Still worth surfacing — a node silently not producing a
//   port it declares is very often a real bug.
// - Exceeding limits.maxOutputMB -> THROWN (participates in the caller's existing
//   retry/continueOnFail handling, same as any other execution error). Built-in v1 node.json
//   manifests have no `limits` field at all, so this is a no-op for every built-in today — it
//   only takes effect for Manifest v2 packages (registry packages, Custom Node Platform Phase 2),
//   where `limits.maxOutputMB` is a REQUIRED field the package author explicitly chose.
function validateOutput(output, manifest) {
  const warnings = [];
  for (const port of (manifest.outputs || [])) {
    if (!output || !(port.id in output)) {
      warnings.push(`Output port "${port.id}" is declared in the manifest but missing from this run's result.`);
    }
  }

  const maxOutputMB = manifest.limits?.maxOutputMB;
  if (maxOutputMB) {
    const bytes = Buffer.byteLength(JSON.stringify(output ?? {}));
    const limitBytes = maxOutputMB * 1024 * 1024;
    if (bytes > limitBytes) {
      throw new Error(`Output size ${(bytes / 1024 / 1024).toFixed(2)}MB exceeds this node's limits.maxOutputMB (${maxOutputMB}MB).`);
    }
  }

  return { warnings };
}

module.exports = { spawnPython, validateOutput };
