const { spawn } = require('child_process');

function spawnPython(scriptPath, payload, onLine) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [scriptPath]);
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

module.exports = { spawnPython };
