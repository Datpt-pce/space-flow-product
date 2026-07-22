# Cai Git truc tiep tu GitHub (khong qua winget/Store) cho may chua co san.
# Node.js/Python khong can cai o day nua - Docker image (Dockerfile.backend/.frontend)
# da dong goi san. Chay doc lap de test, hoac duoc SpaceFlow-Setup.exe tu goi.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Chay installer voi gioi han thoi gian - o dia ao / antivirus quet lan dau co the khien
# installer chay rat lau; sau timeout se huy tien trinh thay vi treo vo thoi han.
function Invoke-SilentInstall($FilePath, $Arguments, $TimeoutSec = 300) {
    $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru
    $completed = $proc.WaitForExit($TimeoutSec * 1000)
    if (-not $completed) {
        Write-Host "  [!] Cai dat qua $($TimeoutSec / 60) phut, dang huy..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        return $false
    }
    return $proc.ExitCode -eq 0
}

$tempDir = Join-Path $env:TEMP "spaceflow-prereqs"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

Write-Host "===== CAI GIT =====" -ForegroundColor Magenta

if (Test-Command git) {
    Write-Host "[OK] Git da co san." -ForegroundColor Green
    exit 0
}

Write-Host "Dang tim ban Git moi nhat..." -ForegroundColor Yellow
try {
    $release = Invoke-RestMethod "https://api.github.com/repos/git-for-windows/git/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -like "*64-bit.exe" } | Select-Object -First 1
    $dest = Join-Path $tempDir "git-installer.exe"
    Write-Host "  Dang tai Git ($($asset.name))..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -UseBasicParsing
    Write-Host "  Dang cai Git (silent)..."
    if (Invoke-SilentInstall $dest "/VERYSILENT /NORESTART /SUPPRESSMSGBOXES") {
        Write-Host "  [OK] Da cai Git." -ForegroundColor Green
    } else {
        Write-Host "  [X] Cai Git that bai hoac qua thoi gian cho." -ForegroundColor Red
    }
} catch {
    Write-Host "  [X] Loi cai Git: $($_.Exception.Message)" -ForegroundColor Red
}

$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

if (Test-Command git) { exit 0 } else { exit 1 }
