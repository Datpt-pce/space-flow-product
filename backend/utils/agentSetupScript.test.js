const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { buildAgentSetupScript } = require('./agentSetupScript');

async function main() {
  const setup = buildAgentSetupScript('test-token', 'https://example.invalid');
  const blocks = [...setup.matchAll(/@'\r?\n([\s\S]*?)\r?\n'@ \| Set-Content/g)].map(match => match[1]);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[1].includes('scriptDir & "\\agent-tray.ps1"'));
  assert.ok(setup.includes('$Shortcut.TargetPath = "$env:WINDIR\\System32\\wscript.exe"'));
  assert.ok(setup.includes('GetFolderPath("Startup")'));
  if (process.platform !== 'win32') {
    console.log('PASS generated launcher contract; SKIP native Windows tray lifecycle');
    return;
  }
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const root = path.resolve(__dirname, '../../logs');
  fs.mkdirSync(root, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(root, 'agent-tray-test-'));
  try {
    fs.writeFileSync(path.join(fixture, 'setup.ps1'), setup);
    fs.mkdirSync(path.join(fixture, 'launcher'));
    fs.writeFileSync(path.join(fixture, 'launcher/agent-tray-launcher.vbs'), blocks[1]);
    fs.writeFileSync(path.join(fixture, 'launcher/agent-tray.ps1'), "'started' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'started.txt')");
    const startup = setup.slice(setup.indexOf('$NodePath = (Get-Command node).Source', setup.indexOf('# Dung Startup folder')),
      setup.indexOf('# Chi xoa folder'))
      .replace('[Environment]::GetFolderPath("Startup")', '$PSScriptRoot');
    fs.writeFileSync(path.join(fixture, 'startup.ps1'), '$InstallDir = $PSScriptRoot\n' + startup);
    fs.writeFileSync(path.join(fixture, 'server.js'), `require('http').createServer((req,res)=>res.end('fixture')).listen(${port}, '127.0.0.1');`);
    const tray = blocks[0].replaceAll('4010', String(port));
    fs.writeFileSync(path.join(fixture, 'duplicate.ps1'), tray);
    const checks = String.raw`
  function Assert-True($Value, $Message) { if (-not $Value) { throw $Message } }
  function Wait-Agent($Expected) {
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
      if ([bool](Get-AgentPid) -eq $Expected) { return }
      Start-Sleep -Milliseconds 200
    }
    throw "Agent running state did not become $Expected"
  }
  try {
    Wait-Agent $true
    Assert-True $TrayIcon.Visible 'Tray is not visible'
    Assert-True ($AppIcon.Width -eq 32) 'SF icon missing'
    Update-TrayStatus
    Assert-True ($StatusItem.Text -eq 'Trang thai: Dang chay') 'Running state incorrect'
    $DuplicatePath = Join-Path $BackendDir 'duplicate.ps1'
    $Duplicate = Start-Process powershell.exe -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "' + $DuplicatePath + '"') -WindowStyle Hidden -PassThru
    Assert-True ($Duplicate.WaitForExit(10000)) 'Duplicate tray did not exit'
    Assert-True ($Duplicate.ExitCode -eq 0) 'Duplicate tray failed'
    $Duplicate.Dispose()
    $ToggleItem.PerformClick()
    Wait-Agent $false
    Update-TrayStatus
    Assert-True ($ToggleItem.Text -eq 'Bat agent') 'Stop menu state incorrect'
    $ToggleItem.PerformClick()
    Wait-Agent $true
    $OldAgentPid = Get-AgentPid
    $RestartItem.PerformClick()
    Wait-Agent $true
    Assert-True ((Get-AgentPid) -ne $OldAgentPid) 'Restart did not replace process'
    Stop-Agent
    Wait-Agent $false
    function Get-Command { throw 'fixture: node unavailable' }
    Start-Agent
    Update-TrayStatus
    Assert-True $TrayIcon.Visible 'Tray disappeared after startup failure'
    Assert-True ($StatusItem.Text -match 'Khong khoi dong duoc') 'Failure not shown in menu'
    Remove-Item Function:\Get-Command
    $ToggleItem.PerformClick()
    Wait-Agent $true
    Update-TrayStatus
    # Run a real Forms message loop, show the actual native menu for visual inspection.
    $Menu.Show(100, 100)
    $ProofTimer = New-Object System.Windows.Forms.Timer
    $ProofTimer.Interval = 1500
    $ProofTimer.add_Tick({
      $ProofTimer.Stop()
      if ($env:SF_TRAY_VISUAL_PROOF -eq '1') {
        & python -c "from PIL import ImageGrab; ImageGrab.grab().save('tray-desktop.png')"
      }
      $ExitItem.PerformClick()
    })
    $ProofTimer.Start()
    [System.Windows.Forms.Application]::Run()
    $ProofTimer.Dispose()
    Wait-Agent $false
    Assert-True (-not $TrayIcon.Visible) 'Exit did not hide icon'
    Write-Output 'PASS native tray start/stop/restart/failure/retry/duplicate/exit'
  } finally { Stop-Agent }
`;
    fs.writeFileSync(path.join(fixture, 'smoke.ps1'), tray.replace('[System.Windows.Forms.Application]::Run()', checks));
    const preflight = String.raw`
$ErrorActionPreference = 'Stop'
$Tokens = $null; $ParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'setup.ps1'), [ref]$Tokens, [ref]$ParseErrors) | Out-Null
if ($ParseErrors.Count) { throw ($ParseErrors | Out-String) }
& (Join-Path $PSScriptRoot 'startup.ps1')
$Shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $PSScriptRoot 'SpaceFlowAgent.lnk'))
if ($Shortcut.TargetPath -ne "$env:WINDIR\System32\wscript.exe") { throw 'Startup shortcut target incorrect' }
if ($Shortcut.Arguments -ne ('"' + $PSScriptRoot + '\backend\agent-tray-launcher.vbs"')) { throw 'Startup shortcut arguments incorrect' }
Write-Output 'PASS Startup shortcut created and re-read from isolated fixture'
$LauncherPath = Join-Path $PSScriptRoot 'launcher\agent-tray-launcher.vbs'
Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList ('"' + $LauncherPath + '"') -WindowStyle Hidden -Wait
$MarkerPath = Join-Path $PSScriptRoot 'launcher\started.txt'
for ($Attempt = 0; $Attempt -lt 50 -and -not (Test-Path -LiteralPath $MarkerPath); $Attempt++) { Start-Sleep -Milliseconds 200 }
if (-not (Test-Path -LiteralPath $MarkerPath)) { throw 'VBS did not launch its adjacent tray script' }
Write-Output 'PASS generated VBS launches adjacent PowerShell helper'
& (Join-Path $PSScriptRoot 'smoke.ps1')
`;
    fs.writeFileSync(path.join(fixture, 'test.ps1'), preflight);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(fixture, 'test.ps1')],
      { cwd: fixture, encoding: 'utf8', windowsHide: true, timeout: 90000 });
    console.log(result.stdout || '');
    assert.equal(result.status, 0, (result.stderr || '') + (result.error?.message || ''));
    const screenshot = path.join(fixture, 'tray-desktop.png');
    if (fs.existsSync(screenshot)) {
      fs.copyFileSync(screenshot, path.join(root, 'agent-tray-desktop.png'));
      console.log('Screenshot: logs/agent-tray-desktop.png');
    }
  } finally {
    // Exact task-owned fixture directory, checked before recursive cleanup on Windows.
    assert.equal(path.dirname(path.resolve(fixture)), root);
    assert.ok(path.basename(fixture).startsWith('agent-tray-test-'));
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
