# Tai va cai Docker Desktop silent cho may chua co. Chay file nay TRUOC khi mo SpaceFlow-Setup.exe.
# Luu y: van co the hien UAC (Docker can quyen Admin de bat WSL2/Hyper-V), va co the yeu cau
# KHOI DONG LAI MAY sau khi cai xong (dac biet neu may chua bat WSL2 tu truoc).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host "===== CAI DOCKER DESKTOP =====" -ForegroundColor Magenta

if (Get-Command docker -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Docker da co san. Khong can cai." -ForegroundColor Green
    exit 0
}

$dest = Join-Path $env:TEMP "DockerDesktopInstaller.exe"
Write-Host "Dang tai Docker Desktop (~600MB, co the mat vai phut)..." -ForegroundColor Yellow
try {
    Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" `
        -OutFile $dest -UseBasicParsing
} catch {
    Write-Host "[X] Tai that bai: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "Dang cai Docker Desktop (silent, co the hien UAC - hay bam Yes)..." -ForegroundColor Yellow
$proc = Start-Process -FilePath $dest -ArgumentList "install --quiet --accept-license" -PassThru
$completed = $proc.WaitForExit(900000)
if (-not $completed) {
    Write-Host "[X] Cai qua 15 phut, dang huy..." -ForegroundColor Red
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

if ($proc.ExitCode -eq 0) {
    Write-Host "[OK] Da cai Docker Desktop." -ForegroundColor Green
    Write-Host "     Neu may yeu cau KHOI DONG LAI, hay restart roi moi mo Docker Desktop." -ForegroundColor Yellow
    Write-Host "     Sau khi Docker Desktop chay xong, moi chay SpaceFlow-Setup.exe / start.bat." -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "[X] Cai that bai (exit code $($proc.ExitCode))." -ForegroundColor Red
    Write-Host "    Hay tu tai va cai tai https://www.docker.com/products/docker-desktop" -ForegroundColor Red
    exit 1
}
