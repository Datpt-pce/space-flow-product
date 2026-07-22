@echo off
REM Bat Hyper-V/VirtualMachinePlatform/WSL. Chay file nay TRUOC install-docker.bat tren
REM may chua tung bat cac feature nay. Se tu xin quyen Admin (UAC).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-wsl-prereqs.ps1"
pause
