// Generates a self-contained PowerShell script that installs Node.js/git/Python/ffmpeg if missing
// (winget), clones the public product repo, wires up .env + backend/config/agent.json with this
// agent's own token, writes the system-tray helper (agent-tray.ps1/.vbs — see
// docs/issues/2026-08-21-agent-startup-visible-console-window.md), and registers a Startup folder
// shortcut so the agent auto-starts hidden on login.
//
// Lives here (not client-side) so backend/routes/agent-install.js can serve it directly for the
// `irm <url> | iex` one-liner and the `.bat` downloader — same script, one source of truth.
function buildAgentSetupScript(agentToken, serverUrl) {
  // Package the user-selected artwork with the installer; no dependency on ref-item at runtime.
  const trayIcon = require('fs').readFileSync(require('path').join(__dirname, '../agent/assets/tray.ico')).toString('base64');
  // Port rieng cho agent (khac dev 3001/5174 va product Docker 4001/2612) - tranh dev.bat va
  // agent tu kill nham nhau khi chay chung 1 may. Phai khop const PORT fallback trong server.js.
  const agentPort = 4010;
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

# Danh sach package phai giu dong bo voi PYTHON_PACKAGES trong backend/routes/system.js (dung cho
# nut "Cap nhat" + auto-update), Dockerfile.backend, va package.json setup:python (CLAUDE.md muc 12).
Write-Host "Cai dat Python packages cho cac node xu ly video/anh..."
$ErrorActionPreference = "Continue"
& $PythonExe -m pip install --quiet rembg Pillow requests certifi google-cloud-storage yt-dlp curl_cffi gdown==6.1.0 faster-whisper==1.2.1 numpy
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: cai Python packages that bai (ma loi $LASTEXITCODE)."; exit 1 }

Write-Host "Cai dat dependencies (co the mat vai phut lan dau)..."
# Dung npm.cmd (khong phai "npm" tran) - PowerShell resolve "npm" ve npm.ps1 truoc, bi chan boi
# Execution Policy tren nhieu may (vd "running scripts is disabled on this system") ma khong
# lam $LASTEXITCODE khac 0 (loi la PSSecurityException, khong phai exit code cua npm that), nen
# cac check ben duoi se khong bat duoc loi nay va script chay tiep tren dependency thieu/cu.
npm.cmd install --prefix backend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install backend that bai (ma loi $LASTEXITCODE)."; exit 1 }
npm.cmd install --prefix frontend
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install frontend that bai (ma loi $LASTEXITCODE)."; exit 1 }
if (Test-Path "nodes\\package.json") {
  npm.cmd install --prefix nodes
  if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = "Stop"; Write-Host "LOI: npm install nodes that bai (ma loi $LASTEXITCODE)."; exit 1 }
}
$ErrorActionPreference = "Stop"

Write-Host "Ghi cau hinh agent..."
New-Item -ItemType Directory -Force -Path "backend\\config" | Out-Null
"{ \`"agentToken\`": \`"$AgentToken\`" }" | Set-Content -Path "backend\\config\\agent.json" -Encoding ascii
if (-not (Test-Path ".env")) { New-Item -ItemType File ".env" | Out-Null }
$ExistingEnvLines = @(Get-Content ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^(SPACE_FLOW_MODE|CENTRAL_SERVER_URL|PORT)=' })
$ExistingEnvLines + @("SPACE_FLOW_MODE=agent", "CENTRAL_SERVER_URL=$CentralServerUrl", "PORT=${agentPort}") | Set-Content -Path ".env" -Encoding ascii

Write-Host "Ghi tray icon helper (an cua so console, chi hien icon khay he thong)..."
@'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$BackendDir = $PSScriptRoot
# One tray per installation in this interactive session, including repeated Startup launches.
$PathHash = [System.Security.Cryptography.SHA256]::Create()
$TrayKey = [BitConverter]::ToString($PathHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($BackendDir.ToLowerInvariant()))).Replace('-', '')
$PathHash.Dispose()
$TrayMutex = New-Object System.Threading.Mutex($false, "Local\\SpaceFlowAgentTray-$TrayKey")
try { $OwnsTray = $TrayMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $OwnsTray = $true }
if (-not $OwnsTray) { $TrayMutex.Dispose(); exit 0 }

$NodePath = $null
$StartError = $null
$LogPath = Join-Path $BackendDir "agent-startup.log"
$ErrLogPath = "$LogPath.err"
$EnvPath = Join-Path (Split-Path $BackendDir -Parent) ".env"
$CentralServerUrl = "https://spaceflow.me.uk"
if (Test-Path $EnvPath) {
  $EnvLine = Get-Content $EnvPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^CENTRAL_SERVER_URL=' } | Select-Object -First 1
  if ($EnvLine) { $CentralServerUrl = ($EnvLine -split '=', 2)[1] }
}

function Get-AgentPid {
  $Conn = Get-NetTCPConnection -LocalPort ${agentPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
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
  $script:StartError = $null
  try {
    if (-not (Get-AgentPid)) {
      $script:NodePath = (Get-Command node -ErrorAction Stop).Source
      Start-Process -FilePath $NodePath -ArgumentList "server.js" -WorkingDirectory $BackendDir -WindowStyle Hidden -RedirectStandardOutput $LogPath -RedirectStandardError $ErrLogPath -ErrorAction Stop
    }
  } catch {
    $script:StartError = "Khong khoi dong duoc - xem log"
    try { $_.Exception.Message | Add-Content -LiteralPath $ErrLogPath -ErrorAction Stop } catch {}
  }
}

# Artwork selected by the user: ref-item/icon/5.webp, converted to a multi-size ICO.
$IconBytes = [Convert]::FromBase64String('${trayIcon}')
$IconStream = New-Object System.IO.MemoryStream(,$IconBytes)
$BorrowedIcon = New-Object System.Drawing.Icon($IconStream, 32, 32)
$AppIcon = $BorrowedIcon.Clone()
$BorrowedIcon.Dispose()
$IconStream.Dispose()

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

function Update-TrayStatus {
  $Running = [bool](Get-AgentPid)
  $State = if ($Running) { "Dang chay" } elseif ($script:StartError) { $script:StartError } else { "Da dung - xem log neu bat that bai" }
  $StatusItem.Text = "Trang thai: $State"
  $ToggleItem.Text = if ($Running) { "Dung agent" } else { "Bat agent" }
  $TrayIcon.Text = "Space Flow Agent - $State"
}

$Menu.add_Opening({ Update-TrayStatus })

$RestartItem.add_Click({
  Stop-Agent
  Start-Sleep -Seconds 1
  Start-Agent
})

$ToggleItem.add_Click({
  if (Get-AgentPid) { Stop-Agent } else { Start-Agent }
})

$LogItem.add_Click({
  if (Test-Path $LogPath) { Start-Process notepad.exe -ArgumentList ('"' + $LogPath + '"') }
  if (Test-Path $ErrLogPath) { Start-Process notepad.exe -ArgumentList ('"' + $ErrLogPath + '"') }
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
$StatusTimer.add_Tick({ Update-TrayStatus })
$StatusTimer.Start()

try {
  Start-Agent
  Update-TrayStatus
  [System.Windows.Forms.Application]::Run()
} finally {
  $StatusTimer.Stop()
  $StatusTimer.Dispose()
  $TrayIcon.Visible = $false
  $TrayIcon.Dispose()
  $Menu.Dispose()
  $AppIcon.Dispose()
  $TrayMutex.ReleaseMutex()
  $TrayMutex.Dispose()
}
'@ | Set-Content -Path "backend\\agent-tray.ps1" -Encoding ascii

@'
Dim WshShell, fso, scriptDir, psPath
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psPath = scriptDir & "\\agent-tray.ps1"
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
  throw "Khong dang ky duoc tu-khoi-dong: $($_.Exception.Message). Hay chay lai setup de tao Startup shortcut."
}

# Chi xoa folder khong tat duoc tien trinh agent cu (van tu chay ngam qua Startup shortcut tu
# lan cai truoc) - no van giu port ${agentPort} va khoa file DB WAL, khien process moi khoi dong xong
# chet ngay lap tuc (EADDRINUSE hoac SQLITE_BUSY khi mo DB o dong dau tien cua server.js).
Write-Host "Kiem tra + dung tien trinh agent cu (neu co) dang giu port ${agentPort}..."
# Replace the generated tray too, including older helpers without a single-instance mutex.
$TrayScriptPattern = '(?i)-File\\s+"' + [regex]::Escape("$InstallDir\\backend\\agent-tray.ps1") + '"(?:\\s|$)'
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object {
  $_.CommandLine -match $TrayScriptPattern -and $_.ProcessId -ne $PID
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }
try {
  $OldConns = Get-NetTCPConnection -LocalPort ${agentPort} -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $OldConns) {
    Write-Host "Dung tien trinh cu (PID $($c.OwningProcess)) dang chiem port ${agentPort}..."
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
  if ($OldConns) { Start-Sleep -Seconds 1 }
} catch {}

Write-Host "Dang khoi dong agent ngay bay gio..."
$StartupLog = "$InstallDir\\backend\\agent-startup.log"
Start-Process -FilePath "$env:WINDIR\\System32\\wscript.exe" -ArgumentList "\`"$InstallDir\\backend\\agent-tray-launcher.vbs\`"" -WindowStyle Hidden
Start-Sleep -Seconds 3
$AgentListener = Get-NetTCPConnection -LocalPort ${agentPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $AgentListener) {
  Write-Host ""
  Write-Host "Agent chua san sang. Dung icon SF de xem log / thu khoi dong lai. Log hien tai:"
  Get-Content $StartupLog, "$StartupLog.err" -ErrorAction SilentlyContinue -Tail 20 | ForEach-Object { Write-Host "  $_" }
  Write-Host "Neu log o tren rong, mo PowerShell va chay: cd \`"$InstallDir\\backend\`"; node server.js  -- de xem loi truc tiep."
} else {
  Write-Host ""
  Write-Host "XONG! Agent dang chay nen (PID $($AgentListener.OwningProcess)), tu khoi dong lai moi lan dang nhap Windows."
  Write-Host "Tim icon Space Flow Agent trong khay he thong (canh dong ho, co the an trong mui ten ^) de xem trang thai / khoi dong lai / dung agent."
  Write-Host "Kiem tra: mo $CentralServerUrl -> Settings -> Agent -> phai thay trang thai Online sau vai giay."
}
`;
}

module.exports = { buildAgentSetupScript };
