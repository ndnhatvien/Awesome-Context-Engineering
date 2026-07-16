@echo off
echo ==================================================
echo   ACE (Awesome Context Engineering) Launcher
echo ==================================================
echo.
echo 1. Build project (pnpm build)
echo 2. Start MCP Server (stdio)
echo 3. Start MCP HTTP Server (SSE on port 3000)
echo 4. Run all Tests (pnpm test)
echo.
set /p choice="Select an option (1-4, default 1): "

if "%choice%"=="2" goto run_mcp
if "%choice%"=="3" goto run_mcp_http
if "%choice%"=="4" goto run_tests

:build
echo Building the project...
call pnpm build
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b %errorlevel%
)
echo Build succeeded!
echo.
goto end

:run_mcp
echo Building...
call pnpm build
echo Starting MCP stdio server...
node dist/index.js mcp
goto end

:run_mcp_http
echo Building...
call pnpm build
echo Starting MCP HTTP server on port 3000...
node dist/index.js mcp-http --port 3000
goto end

:run_tests
echo Running tests...
call pnpm test
goto end

:end
pause
