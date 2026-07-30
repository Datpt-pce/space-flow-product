# Space-Flow launcher - tu dong pull code moi + build/chay qua Docker tren MAY CUA BAN.
# Moi teammate chay file nay (qua start.bat) -> app dung tai nguyen may do, khong dung chung.
# Node.js/Python/pip deps deu nam trong Docker image, khong can cai gi tren may that
# ngoai Docker Desktop + Git.

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [!]  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    [X]  $msg" -ForegroundColor Red }

Write-Host "===== SPACE-FLOW LAUNCHER (Docker) =====" -ForegroundColor Magenta

# 1. Kiem tra Docker Desktop da chay chua
Step "Kiem tra Docker"
$dockerOk = $false
try {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
} catch {}

if (-not $dockerOk) {
    Fail "Khong tim thay Docker dang chay."
    Warn "Hay cai Docker Desktop (https://www.docker.com/products/docker-desktop) neu chua co,"
    Warn "hoac mo Docker Desktop len va cho no khoi dong xong roi chay lai start.bat."
    exit 1
}
Ok "Docker dang chay."

# 2. Auto-pull code moi nhat tu GitHub
Step "Cap nhat code moi nhat tu GitHub"
# May cong ty co proxy chan SSL (Zscaler, Fortinet...) khien git tu choi chung chi MITM vi
# Git for Windows mac dinh dung bo CA rieng thay vi kho chung chi Windows. Chuyen sang schannel
# de git tin tuong chung chi Windows da chap nhan san (khong lam yeu bao mat).
git config --global http.sslBackend schannel 2>$null

# Mot so may (chay qua remote session/Invoke-Command, hoac user khac so huu thu muc) khien git
# bao "detected dubious ownership" va tu choi chay. Tin thu muc nay cho session hien tai truoc
# khi goi cac lenh git ben duoi.
git config --global --add safe.directory ($root -replace '\\', '/') 2>$null
git config --global --add safe.directory $root 2>$null

# Repo product duoc publish lai tu dau moi lan (git init moi trong scripts/publish-product.sh)
# nen lich su git khong lien tuc voi ban truoc -> "git pull --ff-only" luon that bai theo thiet
# ke, khong dung duoc o day. Luon fetch + reset --hard thang ve origin/main (chi bo qua khi co
# thay doi chua commit, de khong mat du lieu test cua ban).
#
# Dung $ErrorActionPreference = 'Continue' quanh cac lenh git native: trong Windows PowerShell
# 5.1 (chay boi start.bat), capture "2>&1" cua git vao bien se bien MOI dong git in ra stderr
# (ke ca dong thong tin binh thuong, khong phai loi that) thanh loi terminating khi
# $ErrorActionPreference = 'Stop' (dat o dau file nay) -> nhay thang vao catch, bo qua am
# tham buoc dong bo ben duoi. Day chinh la nguyen nhan gay ra tinh trang "chay lai shortcut
# van khong thay code moi" ma khong co loi ro rang nao hien ra.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'

# Chi xet file TRACKED bi sua/xoa (--untracked-files=no): "git reset --hard" khong dung toi
# file untracked nen chung khong co nguy co mat du lieu gi - truoc day xet ca untracked khien
# cac file rac vo hai (vd unins000.dat/unins000.exe do Inno Setup uninstaller tao ra khi cai
# qua setup.iss) lam dong bo bi bo qua VINH VIEN, du user chua he tu sua file nao.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) {
    $headInfo = (git log -1 --format="%h %s" 2>&1) -join ' '
    Warn "Phat hien thay doi chua commit trong thu muc nay -> bo qua tu dong dong bo de khong mat du lieu."
    Warn "Dang o commit CU: $headInfo (se KHONG co code/fix moi nhat cho toi khi giai quyet xong)."
    Warn "Cac file dang bi coi la 'thay doi' (thuong la do dong CRLF/LF, khong phai ban tu sua):"
    ($dirty -split "`n" | Select-Object -First 10) | ForEach-Object { Warn "    $_" }
    Warn "Neu muon lay ban moi nhat: tu backup/commit thay doi roi chay 'git fetch origin; git reset --hard origin/main'."
} else {
    git fetch origin 2>&1 | ForEach-Object { Write-Host "    $_" }
    git reset --hard origin/main 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -eq 0) {
        $headInfo = (git log -1 --format="%h %s" 2>&1) -join ' '
        Ok "Da dong bo code (dang o commit: $headInfo)."
    } else {
        Fail "Dong bo that bai, app se chay voi code hien tai."
    }
}
$ErrorActionPreference = $prevEAP

# 3. Kiem tra .env (moi may tu dien ANTHROPIC_API_KEY rieng)
Step "Kiem tra file .env (API key)"
$envPath = Join-Path $root '.env'
if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $root '.env.example') $envPath
    Warn "Chua co .env -> da tao tu .env.example."
    Warn "Hay MO file .env va dien ANTHROPIC_API_KEY cua RIENG BAN (sk-ant-...)."
    Warn "Dien xong -> dong file va chay lai start.bat."
    Write-Host "`nNhan phim bat ky de mo .env..." -ForegroundColor Yellow
    [void][System.Console]::ReadKey($true)
    notepad $envPath
    exit 1
}
$envContent = Get-Content $envPath -Raw
if ($envContent -notmatch 'ANTHROPIC_API_KEY=sk-ant-') {
    Warn "ANTHROPIC_API_KEY trong .env co the chua duoc dien dung (can bat dau bang sk-ant-)."
    Warn "Cac node dung Claude se loi cho den khi dien key hop le."
} else {
    Ok ".env hop le."
}

# 4. Tao san thu muc CapCut tren host (neu chua co) de Docker mount duoc - thu muc rong
#    khong anh huong gi neu may chua cai CapCut, nhung tranh loi bind-mount "path khong ton tai".
Step "Chuan bi thu muc CapCut (cho node CapCut, khong bat buoc phai cai CapCut)"
$capcutDraftDir = Join-Path $env:LOCALAPPDATA "CapCut\User Data\Projects\com.lveditor.draft"
$capcutEffectDir = Join-Path $env:LOCALAPPDATA "CapCut\User Data\Cache\effect"
New-Item -ItemType Directory -Force -Path $capcutDraftDir | Out-Null
New-Item -ItemType Directory -Force -Path $capcutEffectDir | Out-Null
Ok "San sang."

# 5. Tu dong do o dia (tru C) de mount vao Docker, khong can khai tay .env
#    Nhan ca Fixed lan Removable vi o cung ngoai (USB) tuy driver/cong cam co the duoc Windows
#    bao la Removable thay vi Fixed - khong on dinh giua cac lan cam lai.
Step "Do o dia de mount vao Docker (tru o C)"
$candidateDrives = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -ne 'C:\' }
$drives = $candidateDrives | Where-Object {
    $_.IsReady -and ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable')
}
foreach ($d in $drives) {
    $letter = $d.Name.Substring(0,1).ToUpper()
    Set-Item -Path "env:HOST_DRIVE_$letter" -Value $d.Name
}
$skippedDrives = $candidateDrives | Where-Object { $drives -notcontains $_ }
foreach ($s in $skippedDrives) {
    $reason = if (-not $s.IsReady) { 'chua san sang (IsReady=false) - o co the dang spin-up/reconnect' }
              else { "loai o dia la $($s.DriveType) (khong phai Fixed/Removable)" }
    Warn ("Bo qua o $($s.Name): $reason")
}
if ($drives.Count -gt 0) {
    Ok ("Se mount: " + (($drives | ForEach-Object { $_.Name }) -join ", "))
} else {
    Ok "Khong co o dia nao khac ngoai C: - bo qua."
}

# 6. Don container CU dang giu port 4001/2612 (--remove-orphans o buoc 7 chi don container
#    thua TRONG CUNG project "space-flow"; neu tren may tung chay container tu 1 project name
#    khac - vd "spaceflow" tu truoc khi co dong "name: space-flow" trong docker-compose.yml -
#    container do van song va giu mat port, khien "docker compose up" bao loi "port is
#    already allocated" du container moi da duoc tao. Don thang theo port thay vi theo ten
#    project de khong phu thuoc container cu ten gi.
Step "Don container cu dang giu port 4001/2612 (neu co)"
$stalePorts = @(4001, 2612)
$foundStale = $false
foreach ($p in $stalePorts) {
    $ids = docker ps -q --filter "publish=$p"
    foreach ($id in ($ids -split "`n" | Where-Object { $_ })) {
        $cname = (docker inspect --format '{{.Name}}' $id 2>$null) -replace '^/', ''
        docker rm -f $id 2>&1 | Out-Null
        Ok "Da dung container cu '$cname' dang giu port $p."
        $foundStale = $true
    }
}
if (-not $foundStale) { Ok "Khong co container cu nao giu port." }

# 7. Build & khoi dong app qua Docker Compose
#    CACHEBUST doi moi moi lan chay de bat buoc layer COPY code (backend/, nodes/, frontend/)
#    luon lay dung source moi nhat - Docker Desktop tren Windows doi khi cache nham layer nay
#    du file host da doi, khien "chay lai shortcut van con code cu" ma khong bao loi gi (cac
#    layer cai dat deps nang o truoc ARG CACHEBUST trong Dockerfile van duoc cache binh thuong).
$env:CACHEBUST = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
Step "Build va khoi dong Space-Flow (lan dau co the mat vai phut de build image)"
Write-Host "    Backend:  http://localhost:4001" -ForegroundColor Green
Write-Host "    Frontend: http://localhost:2612  <-- MO LINK NAY TREN TRINH DUYET" -ForegroundColor Green
Write-Host "    (App chay tren MAY CUA BAN qua Docker. Nhan Ctrl+C de dung.)`n" -ForegroundColor DarkGray
docker compose up --build --remove-orphans
