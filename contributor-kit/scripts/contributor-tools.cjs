const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const local = path.join(root, '.contributor-tools');
const windows = process.platform === 'win32';
const harness = path.join(root, 'scripts', 'bin', `harness-cli${windows ? '.exe' : ''}`);
const graph = path.join(local, 'python', windows ? 'Scripts/code-review-graph.exe' : 'bin/code-review-graph');
const python = path.join(local, 'python', windows ? 'Scripts/python.exe' : 'bin/python');
const version = '0.1.22';
const checksums = {
  'windows-x64.exe': '1be4be2d47dd8f76c28fed9a238897eab6f542f610e119a69d4281fe64f848b6',
  'linux-x64': '20c6c0ff444509593779e470bc055e83ef35506030a4d85ab90dd0398b199f6b',
  'linux-arm64': '404cd41a33ee02f0558070a3cbf3938724635424ad9941527f07418ba1b880c6',
  'macos-x64': '8d7a6593ca0f8c01f534c6aab1c175cfffc4fed0f2d057bad9e24a9dda25b90c',
  'macos-arm64': '0c5968ee487211c0c19374f50304690961342c0509937a895f08973b36639a26',
};
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status ?? result.error?.code}).`);
}
async function setup() {
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport().header.glibcVersionRuntime;
    const [major, minor] = (glibc || '0.0').split('.').map(Number);
    if (major < 2 || (major === 2 && minor < 39)) throw new Error('Harness 0.1.22 needs Linux glibc 2.39+ (for example Ubuntu 24.04). Use a supported contributor workstation; Debian Bookworm/Alpine are not supported by this binary.');
  }
  const platform = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
  const asset = `${platform}-${process.arch}${windows ? '.exe' : ''}`;
  if (!checksums[asset]) throw new Error('Unsupported OS/architecture. See docs/TOOLS.md.');
  if (!fs.existsSync(harness) || crypto.createHash('sha256').update(fs.readFileSync(harness)).digest('hex') !== checksums[asset]) {
    const response = await fetch(`https://github.com/hoangnb24/repository-harness/releases/download/harness-cli-v${version}/harness-cli-${asset}`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Harness download failed: ${response.status}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 12 * 1024 * 1024) throw new Error('Harness download exceeds size limit.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== checksums[asset]) throw new Error('Harness SHA-256 mismatch.');
    fs.mkdirSync(path.dirname(harness), { recursive: true });
    const temp = `${harness}.download-${process.pid}`;
    fs.writeFileSync(temp, bytes, { mode: 0o755 });
    fs.renameSync(temp, harness);
  }
  run(harness, ['init']); run(harness, ['migrate']);
  if (!fs.existsSync(python)) {
    const candidates = process.env.SF_TOOLS_PYTHON ? [process.env.SF_TOOLS_PYTHON] : windows ? ['python', 'python3'] : ['python3', 'python'];
    const found = candidates.find(command => spawnSync(command, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'], { windowsHide: true, stdio: 'ignore' }).status === 0);
    if (!found) throw new Error('Install Python 3.10+ or set SF_TOOLS_PYTHON to its executable, then rerun setup. Harness is ready.');
    fs.mkdirSync(local, { recursive: true });
    run(found, ['-m', 'venv', path.join(local, 'python')]);
  }
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'code-review-graph==2.3.8']);
  run(harness, ['tool', 'register', '--name', 'code-review-graph', '--command', path.relative(root, graph).replaceAll('\\', '/'), '--description', 'Local source dependency graph; verify edges with source and tests', '--responsibility', 'Verification', '--capability', 'impact-analysis', '--kind', 'binary', '--force']);
  run(harness, ['tool', 'check']);
  console.log('Ready. Run npm run graph -- build to index this checkout.');
}
async function main() {
  const command = process.argv[2];
  if (command === 'setup') return setup();
  if (command === 'doctor') {
    let missing = false;
    for (const [name, binary, args] of [['Harness', harness, ['--version']], ['Codegraph', graph, ['--version']]]) {
      if (!fs.existsSync(binary)) { console.error(`${name}: missing. Run npm run tools:setup.`); missing = true; }
      else run(binary, args);
    }
    if (missing) process.exitCode = 1;
    return;
  }
  if (command === 'graph') {
    if (!fs.existsSync(graph)) throw new Error('Codegraph is missing. Run npm run tools:setup.');
    return run(graph, process.argv.slice(3).length ? process.argv.slice(3) : ['--help']);
  }
  throw new Error('Use setup, doctor, or graph <command>.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
