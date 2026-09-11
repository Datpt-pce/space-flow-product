import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../../store.js';
import { fetchMyAgents, createAgent, deleteAgent } from '../../lib/api.js';

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

# Dung Startup folder (khong can quyen admin) thay vi Scheduled Task - nhieu may cong ty
# chan Register-ScheduledTask cho user thuong ("Access is denied").
# Dung file .vbs (WshShell.Run windowStyle=0 = SW_HIDE that su) thay vi shortcut .lnk -
# .lnk chi ho tro Normal/Maximized/Minimized (WindowStyle=7 la Thu nho, khong phai An), nen
# van co the flash cua so console moi lan dang nhap Windows.
Write-Host "Dang ky agent tu khoi dong cung Windows (Startup folder)..."
$NodePath = (Get-Command node).Source
try {
  $StartupFolder = [Environment]::GetFolderPath("Startup")
  $OldShortcutPath = Join-Path $StartupFolder "SpaceFlowAgent.lnk"
  if (Test-Path $OldShortcutPath) { Remove-Item $OldShortcutPath -Force -ErrorAction SilentlyContinue }
  $VbsPath = Join-Path $StartupFolder "SpaceFlowAgent.vbs"
  $VbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$InstallDir\\backend"
WshShell.Run """$NodePath"" server.js", 0, False
"@
  Set-Content -Path $VbsPath -Value $VbsContent -Encoding ascii
  Write-Host "Da tao SpaceFlowAgent.vbs trong Startup folder - agent se tu chay AN moi lan dang nhap Windows."
} catch {
  Write-Host "Khong tao duoc file tu-khoi-dong ($($_.Exception.Message)) - ban can tu chay lai 'node server.js' trong $InstallDir\\backend moi lan can dung."
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
  Write-Host "XONG! Agent dang chay nen (PID $($Process.Id)), tu khoi dong lai moi lan dang nhap Windows."
  Write-Host "Kiem tra: mo $CentralServerUrl -> Settings -> Agent -> phai thay trang thai Online sau vai giay."
}
`;
}

const AGENT_STATUS_BADGE = {
  online: { label: 'Online', className: 'bg-green-50 text-green-600' },
  offline: { label: 'Offline', className: 'bg-[var(--n100,#f3f4f6)] text-[var(--n500,#6b7280)]' },
};

// My Nodes — Custom Node Platform Phase 5 (specs/space-flow-master-plan/01-custom-node-platform.md):
// LocalDraft / LocalInstalled listing. Editing a draft opens the separate, larger
// NodeBuilderModal (frontend/src/components/NodeBuilderModal.jsx) rather than living inside this
// 680x480 shell — a tabbed manifest+code editor + Test Console needs more room than a Settings tab.
export function AgentTab() {
  const currentUser = useStore(s => s.currentUser);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState(null); // { id, agentToken } — shown once right after creation
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);

  const load = () => fetchMyAgents().then(list => { setAgents(list); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const myAgent = agents.find(a => a.ownerId === currentUser?.id);
  const serverUrl = window.location.origin;

  // Backend serves the actual setup script (backend/utils/agentSetupScript.js) — this route is
  // public (auth by the token itself, not session) since it's fetched from the target machine via
  // `irm | iex` or a downloaded .bat, neither of which carries the browser's session cookie.
  const installUrl = (format) => {
    const base = `${serverUrl}/api/agent-install/${newToken.agentToken}?serverUrl=${encodeURIComponent(serverUrl)}`;
    return format ? `${base}&format=${format}` : base;
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await createAgent(`Máy của ${currentUser?.name || currentUser?.email || ''}`.trim());
      setNewToken(result);
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!myAgent) return;
    if (!confirm('Xoá agent hiện tại? Máy này sẽ không chạy được node local (CapCut, ComfyUI...) cho tới khi pairing lại với token mới.')) return;
    try {
      await deleteAgent(myAgent.id);
      setNewToken(null);
      load();
    } catch (e) {
      alert(e.message);
    }
  };

  const copyToken = () => {
    navigator.clipboard.writeText(newToken.agentToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const copyOneLiner = () => {
    navigator.clipboard.writeText(`irm "${installUrl()}" | iex`);
    setCopiedOneLiner(true);
    setTimeout(() => setCopiedOneLiner(false), 1500);
  };

  if (loading) return <p className="text-sm text-[var(--n400,#9ca3af)]">Đang tải...</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--n500,#6b7280)]">
        Node cần máy thật (CapCut, ComfyUI-local, Ollama, chọn file trên máy...) chỉ chạy được trên
        <b> máy bạn đang ngồi</b> — không phải máy chủ dùng chung. Pairing máy này 1 lần để dùng
        được các node đó.
      </p>

      {newToken && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-amber-700">
            Lưu token này ngay — chỉ hiện đúng 1 lần, không xem lại được.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-[var(--card,#fff)] border border-amber-200 rounded-lg px-2 py-1.5 truncate">
              {newToken.agentToken}
            </code>
            <button onClick={copyToken}
              className="h-7 px-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 shrink-0">
              {copied ? 'Đã copy' : 'Copy'}
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <button onClick={copyOneLiner}
              className="h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-xs font-medium hover:bg-[var(--n800,#1f2937)] self-start">
              {copiedOneLiner ? 'Đã copy lệnh' : 'Copy lệnh cài đặt (PowerShell)'}
            </button>
            <p className="text-xs text-[var(--sub,#4b5563)]">
              Mở PowerShell (nhấn <b>Win+X</b> → <b>Windows PowerShell</b>/<b>Terminal</b>), dán
              (Ctrl+V), Enter — không cần tải file, không cần chuột-phải hay chỉnh execution
              policy thủ công.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <a href={installUrl('bat')}
              className="h-8 px-3 rounded-lg border border-[var(--card-border,#d1d5db)] text-[var(--sub,#374151)] text-xs font-medium hover:bg-[var(--n50,#f9fafb)] self-start inline-flex items-center">
              Hoặc tải file .bat (double-click để chạy)
            </a>
            <p className="text-xs text-[var(--sub,#4b5563)]">
              Tải xong, double-click file trong Downloads — chạy ngay, không cần chuột-phải chọn
              "Run with PowerShell" như file .ps1. Lần đầu tải, Windows SmartScreen có thể hỏi
              "Windows protected your PC" → bấm <b>More info</b> → <b>Run anyway</b>.
            </p>
          </div>

          <p className="text-xs text-[var(--sub,#4b5563)]">
            Cả 2 cách trên tự cài Node.js/git/Python/ffmpeg nếu thiếu, tải code, điền sẵn token, và
            tự khởi động lại cùng Windows — không cần làm gì thêm.
          </p>

          <details className="text-xs text-[var(--n500,#6b7280)]">
            <summary className="cursor-pointer hover:text-[var(--sub,#374151)]">Hoặc tự làm tay</summary>
            <div className="text-xs text-[var(--sub,#4b5563)] leading-relaxed mt-1.5">
              <ol className="list-decimal list-inside flex flex-col gap-0.5">
                <li>Cài Node.js + git nếu chưa có, clone code Space Flow về máy.</li>
                <li>Tạo file <code className="bg-[var(--card,#fff)] px-1 rounded">backend/config/agent.json</code>:{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">{'{ "agentToken": "<token trên>" }'}</code></li>
                <li>Trong <code className="bg-[var(--card,#fff)] px-1 rounded">.env</code>, thêm:{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">SPACE_FLOW_MODE=agent</code> và{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">CENTRAL_SERVER_URL={serverUrl}</code></li>
                <li>Chạy <code className="bg-[var(--card,#fff)] px-1 rounded">npm run dev:backend</code> (hoặc{' '}
                  <code className="bg-[var(--card,#fff)] px-1 rounded">node backend/server.js</code>) — để chạy nền lâu dài.</li>
                <li>Hoặc tải trực tiếp{' '}
                  <a href={installUrl('ps1') + '&download=1'} className="underline hover:text-[var(--sub,#1f2937)]">
                    file .ps1 gốc
                  </a>{' '}
                  để đọc/tự chạy tay.</li>
              </ol>
            </div>
          </details>
        </div>
      )}

      {myAgent ? (
        <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-[var(--card-border,#f3f4f6)]">
          <div className="text-sm text-[var(--sub,#374151)]">
            <div className="flex items-center gap-1.5">
              <span>{myAgent.name || 'Agent của bạn'}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${AGENT_STATUS_BADGE[myAgent.status]?.className || AGENT_STATUS_BADGE.offline.className}`}>
                {AGENT_STATUS_BADGE[myAgent.status]?.label || myAgent.status}
              </span>
            </div>
            {myAgent.lastSeenAt && <div className="text-xs text-[var(--n400,#9ca3af)] mt-0.5">Lần cuối online: {myAgent.lastSeenAt}</div>}
          </div>
          <button onClick={handleDelete} className="h-7 px-2 rounded-lg border border-[var(--card-border,#e5e7eb)] text-xs text-red-500 hover:bg-red-50">
            Xoá & tạo lại
          </button>
        </div>
      ) : !newToken ? (
        <button onClick={handleCreate} disabled={creating}
          className="self-start h-8 px-3 rounded-lg bg-[var(--n900,#111827)] text-[var(--n0,#fff)] text-sm hover:bg-[var(--n800,#1f2937)] disabled:opacity-50">
          {creating ? 'Đang tạo...' : 'Tạo agent mới'}
        </button>
      ) : null}
    </div>
  );
}

