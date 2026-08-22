// Generates a self-contained PowerShell script that installs Node.js/git/Python/ffmpeg if missing
// (winget), clones the public product repo, wires up .env + backend/config/agent.json with this
// agent's own token, writes the system-tray helper (agent-tray.ps1/.vbs — see
// docs/issues/2026-08-21-agent-startup-visible-console-window.md), and registers a Startup folder
// shortcut so the agent auto-starts hidden on login.
//
// Lives here (not client-side) so backend/routes/agent-install.js can serve it directly for the
// `irm <url> | iex` one-liner and the `.bat` downloader — same script, one source of truth.
function buildAgentSetupScript(agentToken, serverUrl) {
  return `# Space Flow Agent - cai dat tu dong
# Tao boi Settings -> Agent. Chay 1 lan de pairing may nay lam agent cho ${serverUrl}
$ErrorActionPreference = "Stop"
$CentralServerUrl = "${serverUrl}"
$AgentToken = "${agentToken}"
$InstallDir = "$env:USERPROFILE\\space-flow-agent"
$RepoUrl = "https://github.com/Datpt-pce/space-flow-product.git"

function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

function Install-WingetPackage($PackageId, $FriendlyName) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "LOI: can cai $FriendlyName nhung may nay khong co winget (App Installer)."
    Write-Host "Cai 'App Installer' tu Microsoft Store (https://aka.ms/getwinget) roi chay lai script nay."
    exit 1
  }
  Write-Host "Dang cai $FriendlyName (winget)..."
  winget install $PackageId -e --accept-package-agreements --accept-source-agreements
  $WingetExitCode = $LASTEXITCODE
  # -1978335189 (0x8A15002B) = "khong co ban cap nhat ap dung duoc": winget tra ve ma nay khi
  # package da duoc cai san va thu upgrade nhung khong co ban moi hon - khong phai loi that.
  if ($WingetExitCode -ne 0 -and $WingetExitCode -ne -1978335189) {
    Write-Host "LOI: cai $FriendlyName that bai (ma loi $WingetExitCode)."
    exit 1
  }
  Refresh-Path
}

function Get-RealPythonExe {
  # Windows co san 1 "app execution alias" python.exe gia tro toi Microsoft Store.
  # Get-Command van thay no ton tai nen phai tu chay --version de biet la Python that hay khong.
  if (Get-Command py -ErrorAction SilentlyContinue) { return "py" }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    try {
      $out = & python --version 2>&1
      if ($LASTEXITCODE -eq 0 -and $out -match 'Python \d') { return "python" }
    } catch {}
  }
  return $null
}

function Test-NodeVersionOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  try {
    $NodeVer = [Version]((node --version) -replace '^v', '')
    return ($NodeVer -ge [Version]"22.13.0")
  } catch { return $false }
}

if (-not (Test-NodeVersionOk)) {
  Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js"
  if (-not (Test-NodeVersionOk)) {
    Write-Host ""
    Write-Host "LOI: da cai Node.js nhung khong tim thay ban >=22.13.0 trong PATH cua PowerShell nay."
    Write-Host "Hay dong cua so nay, mo PowerShell moi (de nhan PATH cap nhat), roi chay lai script."
    exit 1
  }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Install-WingetPackage "Git.Git" "Git" }
$PythonExe = Get-RealPythonExe
if (-not $PythonExe) { Install-WingetPackage "Python.Python.3.12" "Python"; $PythonExe = Get-RealPythonExe }
if (-not $PythonExe) {
  Write-Host ""
  Write-Host "LOI: da cai Python nhung khong tim thay python/py that trong PATH."
  Write-Host "Hay dong cua so PowerShell nay, mo lai (PATH moi), roi chay lai script."
  exit 1
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { Install-WingetPackage "Gyan.FFmpeg" "ffmpeg" }

if (-not (Test-Path $InstallDir)) {
  Write-Host "Tai code Space Flow ve $InstallDir..."
  git clone $RepoUrl $InstallDir
  if ($LASTEXITCODE -ne 0) { Write-Host "LOI: git clone that bai."; exit 1 }
} else {
  Write-Host "Da co $InstallDir, cap nhat code moi nhat..."
  Push-Location $InstallDir
  git fetch origin
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "LOI: git fetch that bai."; exit 1 }
  git reset --hard origin/main
  if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "LOI: git reset that bai."; exit 1 }
  Pop-Location
}

Set-Location $InstallDir

Write-Host "Cai dat Python packages cho cac node xu ly video/anh..."
$ErrorActionPreference = "Continue"
& $PythonExe -m pip install --quiet rembg Pillow requests certifi google-cloud-storage yt-dlp gdown==6.1.0
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: cai Python packages that bai (ma loi $LASTEXITCODE)."; exit 1 }

Write-Host "Cai dat dependencies (co the mat vai phut lan dau)..."
npm install --prefix backend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install backend that bai (ma loi $LASTEXITCODE)."; exit 1 }
npm install --prefix frontend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install frontend that bai (ma loi $LASTEXITCODE)."; exit 1 }
if (Test-Path "nodes\\package.json") {
  npm install --prefix nodes
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install nodes that bai (ma loi $LASTEXITCODE)."; exit 1 }
}
$ErrorActionPreference = "Stop"

Write-Host "Ghi cau hinh agent..."
New-Item -ItemType Directory -Force -Path "backend\\config" | Out-Null
"{ \`"agentToken\`": \`"$AgentToken\`" }" | Set-Content -Path "backend\\config\\agent.json" -Encoding ascii
if (-not (Test-Path ".env")) { New-Item -ItemType File ".env" | Out-Null }
$ExistingEnvLines = @(Get-Content ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^(SPACE_FLOW_MODE|CENTRAL_SERVER_URL)=' })
$ExistingEnvLines + @("SPACE_FLOW_MODE=agent", "CENTRAL_SERVER_URL=$CentralServerUrl") | Set-Content -Path ".env" -Encoding ascii

Write-Host "Ghi tray icon helper (an cua so console, chi hien icon khay he thong)..."
@'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$BackendDir = $PSScriptRoot
$NodePath = (Get-Command node).Source
$LogPath = Join-Path $BackendDir "agent-startup.log"
$ErrLogPath = "$LogPath.err"
$EnvPath = Join-Path (Split-Path $BackendDir -Parent) ".env"
$CentralServerUrl = "https://spaceflow.me.uk"
if (Test-Path $EnvPath) {
  $EnvLine = Get-Content $EnvPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^CENTRAL_SERVER_URL=' } | Select-Object -First 1
  if ($EnvLine) { $CentralServerUrl = ($EnvLine -split '=', 2)[1] }
}

function Get-AgentPid {
  $Conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($Conn) { return $Conn.OwningProcess }
  return $null
}

function Stop-Agent {
  $ProcId = Get-AgentPid
  if ($ProcId) {
    Stop-Process -Id $ProcId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
}

function Start-Agent {
  if (-not (Get-AgentPid)) {
    Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory $BackendDir -WindowStyle Hidden -RedirectStandardOutput $LogPath -RedirectStandardError $ErrLogPath
  }
}

Start-Agent

$AppIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($NodePath)

$Menu = New-Object System.Windows.Forms.ContextMenuStrip
$StatusItem = $Menu.Items.Add("Trang thai: dang kiem tra...")
$StatusItem.Enabled = $false
$Menu.Items.Add("-") | Out-Null
$RestartItem = $Menu.Items.Add("Khoi dong lai agent")
$ToggleItem = $Menu.Items.Add("Dung agent")
$Menu.Items.Add("-") | Out-Null
$LogItem = $Menu.Items.Add("Xem log")
$OpenItem = $Menu.Items.Add("Mo Space Flow")
$Menu.Items.Add("-") | Out-Null
$ExitItem = $Menu.Items.Add("Thoat (dung agent)")

$TrayIcon = New-Object System.Windows.Forms.NotifyIcon
$TrayIcon.Icon = $AppIcon
$TrayIcon.Text = "Space Flow Agent"
$TrayIcon.ContextMenuStrip = $Menu
$TrayIcon.Visible = $true

$Menu.add_Opening({
  $Running = [bool](Get-AgentPid)
  $StatusItem.Text = if ($Running) { "Trang thai: Dang chay" } else { "Trang thai: Da dung" }
  $ToggleItem.Text = if ($Running) { "Dung agent" } else { "Bat agent" }
})

$RestartItem.add_Click({
  Stop-Agent
  Start-Sleep -Seconds 1
  Start-Agent
})

$ToggleItem.add_Click({
  if (Get-AgentPid) { Stop-Agent } else { Start-Agent }
})

$LogItem.add_Click({
  if (Test-Path $LogPath) { Start-Process notepad.exe $LogPath }
})

$OpenItem.add_Click({
  Start-Process $CentralServerUrl
})

$ExitItem.add_Click({
  Stop-Agent
  $TrayIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$StatusTimer = New-Object System.Windows.Forms.Timer
$StatusTimer.Interval = 10000
$StatusTimer.add_Tick({
  $Running = [bool](Get-AgentPid)
  $TrayIcon.Text = if ($Running) { "Space Flow Agent - Online" } else { "Space Flow Agent - Offline" }
})
$StatusTimer.Start()

[System.Windows.Forms.Application]::Run()
'@ | Set-Content -Path "backend\\agent-tray.ps1" -Encoding ascii

@'
Dim WshShell, fso, scriptDir, psPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psPath = scriptDir & "\agent-tray.ps1"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & psPath & """", 0, False
'@ | Set-Content -Path "backend\\agent-tray-launcher.vbs" -Encoding ascii

# Dung Startup folder (khong can quyen admin) thay vi Scheduled Task - nhieu may cong ty
# chan Register-ScheduledTask cho user thuong ("Access is denied"). Shortcut tro vao
# wscript.exe + agent-tray-launcher.vbs (khong phai node.exe truc tiep) de agent chay AN
# HAN moi lan khoi dong Windows - khong con cua so console nao de vo y dong/click vao lam
# treo (QuickEdit) hay tat han agent; trang thai/dieu khien qua icon khay he thong thay the.
Write-Host "Dang ky agent tu khoi dong cung Windows (Startup folder)..."
$NodePath = (Get-Command node).Source
try {
  $StartupFolder = [Environment]::GetFolderPath("Startup")
  $ShortcutPath = Join-Path $StartupFolder "SpaceFlowAgent.lnk"
  $WshShellCom = New-Object -ComObject WScript.Shell
  $Shortcut = $WshShellCom.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = "$env:WINDIR\\System32\\wscript.exe"
  $Shortcut.Arguments = "\`"$InstallDir\\backend\\agent-tray-launcher.vbs\`""
  $Shortcut.WorkingDirectory = "$InstallDir\\backend"
  $Shortcut.Save()
  Write-Host "Da tao shortcut trong Startup folder - agent se tu chay an (icon khay he thong) moi lan dang nhap Windows."
} catch {
  Write-Host "Khong tao duoc shortcut tu-khoi-dong ($($_.Exception.Message)) - ban can tu chay lai 'node server.js' trong $InstallDir\\backend moi lan can dung."
}

# Chi xoa folder khong tat duoc tien trinh agent cu (van tu chay ngam qua Startup shortcut tu
# lan cai truoc) - no van giu port 3001 va khoa file DB WAL, khien process moi khoi dong xong
# chet ngay lap tuc (EADDRINUSE hoac SQLITE_BUSY khi mo DB o dong dau tien cua server.js).
Write-Host "Kiem tra + dung tien trinh agent cu (neu co) dang giu port 3001..."
try {
  $OldConns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $OldConns) {
    Write-Host "Dung tien trinh cu (PID $($c.OwningProcess)) dang chiem port 3001..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  if ($OldConns) { Start-Sleep -Seconds 1 }
} catch {}

Write-Host "Dang khoi dong agent ngay bay gio..."
$StartupLog = "$InstallDir\\backend\\agent-startup.log"
$Process = Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory "$InstallDir\\backend" -WindowStyle Hidden -PassThru -RedirectStandardOutput $StartupLog -RedirectStandardError "$StartupLog.err"
Start-Sleep -Seconds 3
if ($Process.HasExited) {
  Write-Host ""
  Write-Host "LOI: agent vua khoi dong da tu tat ngay. Log that:"
  Get-Content $StartupLog, "$StartupLog.err" -ErrorAction SilentlyContinue -Tail 20 | ForEach-Object { Write-Host "  $_" }
  Write-Host "Neu log o tren rong, mo PowerShell va chay: cd \`"$InstallDir\\backend\`"; node server.js  -- de xem loi truc tiep."
} else {
  Write-Host ""
  Write-Host "Dang bat icon khay he thong (system tray) de theo doi/dieu khien agent..."
  Start-Process -FilePath "$env:WINDIR\\System32\\wscript.exe" -ArgumentList "\`"$InstallDir\\backend\\agent-tray-launcher.vbs\`""
  Write-Host ""
  Write-Host "XONG! Agent dang chay nen (PID $($Process.Id)), tu khoi dong lai moi lan dang nhap Windows."
  Write-Host "Tim icon Space Flow Agent trong khay he thong (canh dong ho, co the an trong mui ten ^) de xem trang thai / khoi dong lai / dung agent."
  Write-Host "Kiem tra: mo $CentralServerUrl -> Settings -> Agent -> phai thay trang thai Online sau vai giay."
}
`;
}

module.exports = { buildAgentSetupScript };
