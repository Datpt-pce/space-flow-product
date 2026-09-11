const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

async function listSystemFonts() {
  let stdout;
  if (process.platform === 'win32') {
    ({ stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name | Sort-Object -Unique | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }));
    const values = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    return Array.isArray(values) ? values : [values];
  }
  ({ stdout } = await run('fc-list', ['--format=%{family}\n'], { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 }));
  return [...new Set(stdout.split(/[\n,]/).map(s => s.trim()).filter(Boolean))].sort();
}
module.exports = { listSystemFonts };
