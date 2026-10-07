<#
.SYNOPSIS
  Install a portable Node.js inside this project (no PATH changes, no registry writes).

.DESCRIPTION
  This project needs Node >= 20.19 (Vite 7 uses crypto.hash). If the Node on this
  machine is too old (or missing), run this script: it downloads official Node and
  unpacks it into <project>\.tools\node. After that, .\glintchat.cmd and
  scripts\run.mjs will prefer that copy automatically.

  Download sources tried in order: npmmirror -> cdn.npmmirror -> nodejs.org

  NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 files using
  the ANSI code page unless they carry a UTF-8 BOM, so non-ASCII text here would
  break parsing. Chinese messages live in glintchat.mjs instead.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1
  powershell -ExecutionPolicy Bypass -File scripts\setup-node.ps1 -Version 22.20.0
#>
[CmdletBinding()]
param(
  # Node version to install (default: a current LTS line)
  [string]$Version = '24.11.0',
  # Target directory (default: <project>\.tools\node)
  [string]$Destination
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Destination) { $Destination = Join-Path $projectRoot '.tools\node' }

$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
$zipName = "node-v$Version-win-$arch.zip"
$cacheDir = Join-Path $projectRoot '.tools\_download'
$zipPath = Join-Path $cacheDir $zipName

$urls = @(
  "https://registry.npmmirror.com/-/binary/node/v$Version/$zipName",
  "https://cdn.npmmirror.com/binaries/node/v$Version/$zipName",
  "https://nodejs.org/dist/v$Version/$zipName"
)

Write-Host ''
Write-Host "  GlintChat portable Node installer" -ForegroundColor Cyan
Write-Host "  version : v$Version ($arch)"
Write-Host "  target  : $Destination"
Write-Host ''

$existing = Join-Path $Destination 'node.exe'
if (Test-Path $existing) {
  $current = & $existing -v
  Write-Host "  Already installed: Node $current" -ForegroundColor Green
  Write-Host "  ($existing) - delete the folder and re-run to reinstall."
  exit 0
}

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if (-not (Test-Path $zipPath)) {
  $downloaded = $false
  foreach ($url in $urls) {
    try {
      Write-Host "  downloading $url" -ForegroundColor DarkGray
      Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 300 -UseBasicParsing
      $downloaded = $true
      break
    } catch {
      Write-Warning "  download failed: $url -> $($_.Exception.Message)"
    }
  }

  if (-not $downloaded) {
    Write-Host ''
    Write-Error "Could not download Node. Options: (1) install Node 22 LTS from https://nodejs.org/zh-cn/download ; (2) download $zipName manually and unpack it to $Destination ; (3) retry behind a proxy."
    exit 1
  }
} else {
  Write-Host "  reusing cached archive: $zipPath" -ForegroundColor DarkGray
}

$tempExtract = Join-Path $cacheDir 'extract'
if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tempExtract | Out-Null

Write-Host '  extracting...' -ForegroundColor DarkGray
Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force

$inner = Get-ChildItem $tempExtract -Directory | Select-Object -First 1
if (-not $inner) {
  Write-Error 'Unexpected archive layout: no directory found after extraction.'
  exit 1
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
Move-Item -Path $inner.FullName -Destination $Destination
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

$nodeExe = Join-Path $Destination 'node.exe'
if (-not (Test-Path $nodeExe)) {
  Write-Error "Install failed: $nodeExe not found."
  exit 1
}

$versionText = & $nodeExe -v
Write-Host ''
Write-Host "  OK - Node $versionText installed" -ForegroundColor Green
Write-Host "  folder: $Destination"
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor Cyan
Write-Host '    .\glintchat.cmd install'
Write-Host '    .\glintchat.cmd dev'
Write-Host ''
