@echo off
REM Script để revoke Augment sync permission cho workspace Orchids-2api

setlocal enabledelayedexpansion

set "WORKSPACE_STORAGE=C:\Users\ndnvi\AppData\Roaming\Code\User\workspaceStorage\a072ce2d5477b04276f60d17498b663f"

echo === Revoke Augment Sync Permission cho Orchids-2api ===
echo.
echo CANH BAO: Script nay se XOA TOAN BO workspace storage cho workspace nay
echo   - Orchids-2api: %WORKSPACE_STORAGE%
echo   - Bao gom: cache, settings, agent edits, checkpoints
echo.
echo PHAI DONG TAT CA VSCode TRUOC KHI CHAY!
echo.
pause

if not exist "%WORKSPACE_STORAGE%" (
    echo DA XOA. Workspace storage khong ton tai hoac da bi xoa.
    echo    Orchids-2api se khong con sync permission sau khi mo VSCode lai.
    pause
    exit /b 0
)

REM Backup
set "BACKUP_DIR=%WORKSPACE_STORAGE%.backup-%DATE:/=-%_%TIME::=-%"
set "BACKUP_DIR=!BACKUP_DIR: =0!"
echo.
echo Backup workspace storage -^> !BACKUP_DIR!
xcopy "%WORKSPACE_STORAGE%" "!BACKUP_DIR!\" /E /I /H /Y >nul

REM Delete workspace storage
echo.
echo Xoa workspace storage...
rd /s /q "%WORKSPACE_STORAGE%"

echo.
echo DA XOA workspace storage cho Orchids-2api!
echo.
echo Ket qua:
echo   - Sync permission: Revoked (workspace storage da xoa)
echo   - Cache: Cleared
echo   - Checkpoints: Cleared (281MB)
echo   - Backup: !BACKUP_DIR!
echo.
echo Tiep theo:
echo   1. Mo VSCode
echo   2. Mo workspace Orchids-2api
echo   3. Khi Augment hoi 'Sync this folder?'
echo      -^> Chon 'NOT NOW' hoac 'Don't ask again for this folder'
echo.
echo Neu van thay indexing loop, close workspace Orchids-2api hoan toan.
echo.
pause
