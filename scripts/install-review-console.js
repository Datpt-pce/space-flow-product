#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { ReviewConfig } = require('../backend/contributions/config');
const { runProcess, executable } = require('../backend/contributions/process');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const store = new ReviewConfig(); let config = store.initialize();
  // Explorer's PATH can differ from VS Code's terminal PATH. Persist the actual
  // CLI binaries discovered at installation so the Desktop shortcut works alone.
  const pinned = {};
  for (const key of ['codexPath', 'claudePath']) { try { pinned[key] = executable(config[key]); } catch { /* doctor reports unavailable CLI */ } }
  config = store.write({ ...config, ...pinned });
  const directory = path.join(config.workspaceRoot, 'launcher'); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const entry = path.resolve(__dirname, 'review-console-start.js');
  if (process.platform !== 'win32') {
    console.log('Console sẵn sàng. Mở bằng npm run review:open; worker bằng npm run review:worker.'); return;
  }
  const vbs = path.join(directory, 'open-console.vbs');
  const command = `"${process.execPath}" "${entry}"`;
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${command.replaceAll('"', '""')}", 0, False\r\n`, { mode: 0o600 });
  const quoted = value => `'${value.replaceAll("'", "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'\n$reviewShell = New-Object -ComObject WScript.Shell\n` +
    `$reviewDesktop = $reviewShell.SpecialFolders('Desktop')\n$reviewLinkPath = Join-Path $reviewDesktop 'Space Flow Control Center.lnk'\n` +
    `$reviewLink = $reviewShell.CreateShortcut($reviewLinkPath)\n` +
    `if ((Test-Path -LiteralPath $reviewLinkPath) -and $reviewLink.Arguments -and ($reviewLink.Arguments -ne ${quoted('"' + vbs + '"')})) { throw 'Shortcut cùng tên thuộc cài đặt khác.' }\n` +
    `$reviewLink.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'\n$reviewLink.Arguments = ${quoted('"' + vbs + '"')}\n` +
    `$reviewLink.WorkingDirectory = ${quoted(path.resolve(__dirname, '..'))}\n$reviewLink.Description = 'Space Flow owner contribution console'\n$reviewLink.WindowStyle = 7\n$reviewLink.Save()\n` +
    `Write-Output $reviewLinkPath\n`;
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, timeoutMs: 15000 });
  if (result.code !== 0) throw new Error('Chưa tạo được shortcut: ' + result.stderr.slice(-500));
  console.log('Đã tạo shortcut: ' + result.output.trim());
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
