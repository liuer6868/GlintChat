@echo off
rem ===========================================================================
rem  GlintChat command entry (Windows wrapper)
rem  Real logic lives in glintchat.mjs; this file only locates a usable Node
rem  and forwards your arguments to it.
rem
rem  Usage (run in this folder, PowerShell or CMD):
rem    glintchat.cmd install     install dependencies
rem    glintchat.cmd dev         start backend + frontend
rem    glintchat.cmd build       build production bundles
rem    glintchat.cmd doctor      environment check
rem    glintchat.cmd node -v     run any command with the detected Node
rem
rem  NOTE: keep this file ASCII-only. cmd.exe reads .cmd in the console code
rem  page, so non-ASCII text here would be garbled.
rem ===========================================================================
setlocal

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

set "NODE_EXE="

rem 1) portable Node bundled in the project (downloaded by scripts\setup-node.ps1)
if exist "%PROJECT_DIR%\.tools\node\node.exe" set "NODE_EXE=%PROJECT_DIR%\.tools\node\node.exe"

rem 2) DSH bundled runtime (already present on this machine)
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

rem 3) whatever node is on PATH (glintchat.mjs re-checks the version)
if not defined NODE_EXE for %%I in (node.exe) do set "NODE_EXE=%%~$PATH:I"

if not defined NODE_EXE (
  echo [glintchat] Node not found. Install Node 20.19+ or run: pwsh -File scripts\setup-node.ps1
  exit /b 1
)

if "%~1"=="" (
  "%NODE_EXE%" "%PROJECT_DIR%\glintchat.mjs" --doctor
  exit /b %ERRORLEVEL%
)

if /I "%~1"=="doctor" (
  "%NODE_EXE%" "%PROJECT_DIR%\glintchat.mjs" --doctor
  exit /b %ERRORLEVEL%
)

"%NODE_EXE%" "%PROJECT_DIR%\glintchat.mjs" %*
exit /b %ERRORLEVEL%
