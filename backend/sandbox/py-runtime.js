// Sandbox Host Python runtime — Custom Node Platform Phase 3
// (specs/space-flow-master-plan/01-custom-node-platform.md), Python track.
//
// Mirrors backend/sandbox/host-bwrap.js's bwrap-wrapped process-spawn approach, but unlike
// js-runtime.js (which bundles+runs inside an isolated-vm isolate as an additional in-process
// layer), Python has no such intermediate sandbox library (see 01-custom-node-platform.md §3:
// "không có 'vm2 tương đương' cho Python") — OS-level isolation via bwrap IS the only layer,
// same conclusion codejail (edX) reached. resource.setrlimit() (applied by py_adapter.py,
// inherited across its os.execv() into the real node) is the fork-bomb/memory/CPU backstop
// that isolated-vm's memoryLimit/timeout options played for the JS track.
//
// STDIN/STDOUT CONTRACT: deliberately NOT the ipc-protocol.js JSON-line protocol the JS track
// uses. Every existing Python node (advanced-renamer, capcut-generate, image-batch-resize,
// resize-upload, resize-upload-v2) already has its own working stdin-JSON-in /
// stdout-JSON-out contract via backend/engine/runner.js's spawnPython(), including a
// PROGRESS\t/ROWRESULT\t-prefixed stderr side-channel some of them use. Forcing all 5 through
// the newer {type,...} JSON-line shape would mean rewriting every one of those scripts for no
// behavioral gain — this runtime is a drop-in sandboxed replacement for spawnPython() instead,
// preserving the exact payload shape callers already pass (e.g. { inputs, config, settings,
// custom_links }), so existing execute.js wrappers do not change at all, only which function
// they call.
//
// CAPABILITY-DRIVEN MOUNTS (the piece host-bwrap.js's Phase 0.3 spike explicitly hard-coded
// and deferred — see docs/decisions/0013 Consequences): approvedPaths is the caller-resolved
// list of concrete host paths this specific run is allowed to touch, beyond scratchDir. This
// runtime does not itself decide which paths are legitimate for a given node/config — that
// judgment (reading manifest.capabilities.filesystem + the node's actual config values, e.g.
// advanced-renamer's `base_path`) belongs to whoever calls this (executor.js's registry-package
// branch in Phase 3/4 integration, or a test's fixture setup), matching the plan's capability
// model (backend/registry/manifest-schema.json's filesystem: 'none'|'scratch'|
// 'user-approved-path').
//
// NETWORK: bwrap's namespace isolation is binary (--unshare-net or not) — there is no
// per-domain allowlist at this layer. A node granted capabilities.network gets the host
// network namespace back in full; domain/SSRF-level mediation for context.http is Phase 4
// scope and does not apply here anyway, since these 5 nodes call requests/google-cloud-storage
// directly rather than through a context SDK. This is a real, documented gap (see
// docs/decisions/0026-sandbox-py-runtime.md) — accepted for now because these are pre-existing
// production nodes whose network calls go to a small number of fixed provider domains
// (Asana, GCS), not arbitrary user-supplied URLs.

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ADAPTER_PATH = path.join(__dirname, 'py_adapter.py');

// bwrap execs its trailing argv directly (no shell), so the python binary must be an
// absolute path — a bare 'python3' would depend on PATH surviving into the sandboxed
// exec environment, which host-bwrap.js's nodeBin=process.execPath convention deliberately
// doesn't rely on either. `command -v` (not backend/utils/pythonExe.js's findPythonExe,
// which is Windows-'py'-launcher-aware and returns bare names) resolves the real absolute
// path on the Linux container this runtime only ever runs on.
function resolveAbsolutePythonBin() {
  for (const candidate of ['python3', 'python']) {
    try {
      const out = execFileSync('/bin/sh', ['-c', `command -v ${candidate}`], { encoding: 'utf8' }).trim();
      if (out) return out;
    } catch {
      // candidate not on PATH — try the next one
    }
  }
  return '/usr/bin/python3';
}

// cpuSeconds (RLIMIT_CPU) deliberately has NO default here — it is opt-in only (see
// runPythonSandboxed below). RLIMIT_CPU counts CPU time summed across every thread in the
// process's thread group, not wall-clock time; a native subprocess like ffmpeg with
// threads="auto" can legitimately spawn 20-30+ encoder threads, so a couple wall-clock seconds
// of real encoding can consume many times that in cumulative CPU-seconds and falsely trip a
// blanket default (found via a real regression-test failure against resize-upload: default
// cpuSeconds=30 killed a ~2s encode using ~30 threads). timeoutSeconds (wall-clock SIGKILL,
// applied on every run) remains the actual backstop against runaway single- or multi-threaded
// compute; cpuSeconds stays available for callers who know a specific node is NOT a
// many-threaded native workload and want the extra kernel-level layer.
const DEFAULT_LIMITS = Object.freeze({
  timeoutSeconds: 30,
  memoryMB: 512,
  maxProcesses: 32,
  maxOpenFiles: 256,
});

// Walks up from p until it finds a directory that already exists on the host — bwrap's
// --bind requires SRC to exist, but a node's declared output path (e.g. resize-upload's
// output_folder) may not be created yet at sandbox-launch time; the script itself calls
// os.makedirs() after the sandbox starts. Binding the nearest existing ancestor read-write
// still lets that mkdir succeed, without requiring a specific bwrap version's --bind-try.
function nearestExistingAncestor(p) {
  let cur = path.resolve(p);
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached filesystem root without finding anything
    cur = parent;
  }
  return cur;
}

function buildPyBwrapArgs({ scratchDir, repoRoot, pythonBin, targetScript, approvedPaths = [], allowNetwork = false }) {
  const args = [
    '--unshare-user', '--unshare-pid', '--die-with-parent',
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/usr/local', '/usr/local',
    '--ro-bind', repoRoot, repoRoot,
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--bind', scratchDir, scratchDir,
  ];

  // The dynamic linker's cache (built by ldconfig at package-install time) is what lets
  // ffmpeg/ffprobe find Debian "alternatives"-managed shared libraries (e.g.
  // /usr/lib/x86_64-linux-gnu/blas/libblas.so.3) that live outside glibc's compiled-in
  // default search path — without it, subprocess libraries the node's own code never
  // directly references (ffmpeg's own dependency tree) fail to load. This exposes only
  // library-path metadata, not file contents, so it's safe to always include regardless of
  // network capability.
  if (fs.existsSync('/etc/ld.so.cache')) args.push('--ro-bind', '/etc/ld.so.cache', '/etc/ld.so.cache');
  // Debian's update-alternatives symlink farm — /usr/lib/.../libblas.so.3 (and others) are
  // symlinks THROUGH /etc/alternatives/... back into /usr, so /usr alone isn't enough to
  // resolve them. Metadata-only (which package version is "active"), not sensitive.
  if (fs.existsSync('/etc/alternatives')) args.push('--ro-bind', '/etc/alternatives', '/etc/alternatives');

  const bound = new Set();
  for (const raw of approvedPaths) {
    const anchor = nearestExistingAncestor(raw);
    if (!anchor || bound.has(anchor)) continue;
    bound.add(anchor);
    args.push('--bind', anchor, anchor);
  }

  if (allowNetwork) {
    if (fs.existsSync('/etc/resolv.conf')) args.push('--ro-bind', '/etc/resolv.conf', '/etc/resolv.conf');
    if (fs.existsSync('/etc/ssl')) args.push('--ro-bind', '/etc/ssl', '/etc/ssl');
    if (fs.existsSync('/etc/hosts')) args.push('--ro-bind', '/etc/hosts', '/etc/hosts');
  } else {
    args.push('--unshare-net');
  }

  args.push('--chdir', scratchDir, '--', pythonBin, ADAPTER_PATH, targetScript);
  return args;
}

// runPythonSandboxed({ scriptPath, payload, capabilityGrants, limits, scratchDir, onLine,
//   repoRoot, pythonBin }) -> Promise<result>
//
// Drop-in sandboxed replacement for backend/engine/runner.js's spawnPython(scriptPath,
// payload, onLine) — same payload-in/result-out/onLine-per-stderr-line shape, run under bwrap
// with rlimits instead of directly on the host process pool.
function runPythonSandboxed({
  scriptPath,
  payload,
  capabilityGrants = {},
  limits = {},
  scratchDir,
  onLine,
  repoRoot = path.resolve(__dirname, '..', '..'),
  pythonBin,
  pythonPath,
}) {
  if (!scratchDir) throw new Error('runPythonSandboxed requires an explicit scratchDir');

  const resolvedLimits = { ...DEFAULT_LIMITS, ...limits };
  const approvedPaths = capabilityGrants.filesystem === 'user-approved-path'
    ? (capabilityGrants.approvedPaths || [])
    : [];
  const allowNetwork = Array.isArray(capabilityGrants.network) && capabilityGrants.network.length > 0;
  const resolvedPythonBin = pythonBin || resolveAbsolutePythonBin();

  const args = buildPyBwrapArgs({
    scratchDir,
    repoRoot,
    pythonBin: resolvedPythonBin,
    targetScript: scriptPath,
    approvedPaths,
    allowNetwork,
  });

  return new Promise((resolve, reject) => {
    const child = spawn('bwrap', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Points at backend/registry/dependencies.js's pyVendorDir() output
        // (<installPath>/.pydeps, populated by `pip install --target` at install time) — that
        // directory already sits inside repoRoot, which is bound read-only above, so no extra
        // bwrap mount is needed, just making Python look there. os.execv() in py_adapter.py
        // inherits this process's environment unchanged (execv, not execve), so the target
        // script's `import` sees it exactly like any other PYTHONPATH entry.
        ...(pythonPath ? { PYTHONPATH: pythonPath } : {}),
        SFPKG_LIMITS: JSON.stringify({
          memoryMB: resolvedLimits.memoryMB,
          ...(limits.cpuSeconds !== undefined ? { cpuSeconds: limits.cpuSeconds } : {}),
          maxProcesses: resolvedLimits.maxProcesses,
          maxOpenFiles: resolvedLimits.maxOpenFiles,
        }),
      },
    });

    let settled = false;
    let stdout = '';
    let stderr = '';
    let stderrLineBuffer = '';

    const timeoutMs = resolvedLimits.timeoutSeconds * 1000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`Sandboxed Python worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (!onLine) return;
      stderrLineBuffer += d;
      const lines = stderrLineBuffer.split('\n');
      stderrLineBuffer = lines.pop();
      lines.forEach(onLine);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || `Sandboxed Python worker exited ${code}`));
      try {
        const result = JSON.parse(stdout);
        if (result.error) return reject(new Error(result.error));
        resolve(result);
      } catch {
        reject(new Error(`Invalid JSON from sandboxed Python worker: ${stdout}`));
      }
    });
  });
}

module.exports = { runPythonSandboxed, buildPyBwrapArgs, nearestExistingAncestor, DEFAULT_LIMITS };
