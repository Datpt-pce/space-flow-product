@echo off
REM Tai va cai Docker Desktop silent. Chay file nay TRUOC, sau do moi mo SpaceFlow-Setup.exe.
REM Luu y: co the hien UAC va yeu cau khoi dong lai may sau khi cai xong.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-docker.ps1"
pause
