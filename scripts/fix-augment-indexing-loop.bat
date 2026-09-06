@echo off
REM Script để fix Augment-BYOK indexing loop
REM PHẢI ĐÓNG TẤT CẢ VSCODE TRƯỚC KHI CHẠY

echo === Fix Augment-BYOK Indexing Loop ===
echo.
echo Nguyen nhan:
echo   - Workspace: d:\MCP\Orchids-2api
echo   - Cache size: 282MB (checkpoint-documents voi server.exe da bi xoa)
echo   - Trieu chung: Sync timeout 300s voi 288 files, 0 uploaded
echo.

echo CANH BAO: SCRIPT NAY PHAI CHAY KHI VSCode DA DONG!
echo.
pause

set AUGMENT_STORAGE=C:\Users\ndnvi\AppData\Roaming\Code\User\workspaceStorage\a072ce2d5477b04276f60d17498b663f\Augment.vscode-augment

if not exist "%AUGMENT_STORAGE%" (
    echo X Khong tim thay workspace storage: %AUGMENT_STORAGE%
    pause
    exit /b 1
)

REM Backup truoc khi xoa
set BACKUP_DIR=%AUGMENT_STORAGE%.backup-%DATE:/=-%_%TIME::=-%
set BACKUP_DIR=%BACKUP_DIR: =0%
echo Backup hien tai -> %BACKUP_DIR%
xcopy "%AUGMENT_STORAGE%" "%BACKUP_DIR%\" /E /I /H /Y >nul

REM Xoa cac thu muc cache lon
echo.
echo Xoa cache checkpoint-documents (281MB)...
rd /s /q "%AUGMENT_STORAGE%\augment-user-assets\checkpoint-documents" 2>nul

echo Xoa mtime-cache.json...
del /q "%AUGMENT_STORAGE%\d03d1f33104cfac1d63b43d91b43a4169a112d9b82607a71932c4521e2b890eb\mtime-cache.json" 2>nul

echo.
echo DA XOA CACHE. Khoi dong lai VSCode de extension re-index sach.
echo.
echo Neu van de van tiep dien:
echo   1. Mo VSCode Command Palette (Ctrl+Shift+P)
echo   2. Chay: 'Augment: Disable Syncing for This Folder'
echo   3. Hoac close workspace Orchids-2api
echo.
pause
