# Bat Hyper-V/VirtualMachinePlatform/WSL + cap nhat WSL kernel - dieu kien can de Docker
# Desktop chay duoc qua WSL2. Chay file nay (mot lan) TRUOC install-docker.ps1 tren may
# chua tung bat cac feature nay. Tu dong xin quyen Admin (UAC) neu chua chay voi quyen do.
# Idempotent: feature nao da bat san se duoc bo qua, khong lam gi them.

$ErrorActionPreference = 'Stop'

# Tu elevate len Admin neu chua co quyen, de user chi can double-click .bat, khong can
# tu mo PowerShell Admin thu cong.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
}

Write-Host "===== BAT HYPER-V / VIRTUALMACHINEPLATFORM / WSL =====" -ForegroundColor Magenta

function Enable-FeatureIfNeeded {
    param([string]$FeatureName, [string]$DisplayName)

    $feature = Get-WindowsOptionalFeature -Online -FeatureName $FeatureName -ErrorAction SilentlyContinue
    if ($null -eq $feature) {
        Write-Host "[!] Khong tim thay feature '$FeatureName' tren may nay, bo qua." -ForegroundColor Yellow
        return $false
    }
    if ($feature.State -eq 'Enabled') {
        Write-Host "[OK] $DisplayName da bat san." -ForegroundColor Green
        return $false
    }

    Write-Host "Dang bat $DisplayName..." -ForegroundColor Yellow
    dism.exe /online /enable-feature /featurename:$FeatureName /all /norestart | Out-Null
    return $true
}

$needsRestart = $false
if (Enable-FeatureIfNeeded 'Microsoft-Hyper-V' 'Hyper-V') { $needsRestart = $true }
if (Enable-FeatureIfNeeded 'VirtualMachinePlatform' 'Virtual Machine Platform') { $needsRestart = $true }
if (Enable-FeatureIfNeeded 'Microsoft-Windows-Subsystem-Linux' 'Windows Subsystem for Linux') { $needsRestart = $true }

# Go goi WSL kieu Appx cu (tu ban WSL1 hoac cai lan truoc bi loi) neu con ton tai.
$oldWsl = Get-AppxPackage *WindowsSubsystemForLinux* -ErrorAction SilentlyContinue
if ($oldWsl) {
    Write-Host "Dang go goi WSL (Appx) cu..." -ForegroundColor Yellow
    $oldWsl | Remove-AppxPackage -ErrorAction SilentlyContinue
}

Write-Host "Dang cap nhat WSL kernel (wsl --update)..." -ForegroundColor Yellow
try {
    wsl --update 2>&1 | ForEach-Object { Write-Host "    $_" }
} catch {
    Write-Host "[!] wsl --update loi - binh thuong neu feature WSL vua moi bat, se chay lai duoc sau khi restart may." -ForegroundColor Yellow
}

if ($needsRestart) {
    Write-Host "`n[!] Da bat them Windows feature moi - hay KHOI DONG LAI may, sau do moi cai Docker Desktop." -ForegroundColor Yellow
} else {
    Write-Host "`n[OK] May da san sang (Hyper-V/VirtualMachinePlatform/WSL da bat san). Co the cai Docker Desktop ngay." -ForegroundColor Green
}
