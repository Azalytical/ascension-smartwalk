# Aidem pitch show on Windows. Finds Node.js 18+ (installed, the copy in node-win next to this folder, or a portable
# copy downloaded once from nodejs.org and checked against its SHA-256), then starts show.mjs. Started by START-Windows.cmd.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
try { $Host.UI.RawUI.WindowTitle = 'Aidem: показ питча (не закрывайте это окно)' } catch {}

$app = $PSScriptRoot
$pkg = Split-Path $app -Parent

function Test-Node([string]$exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  try { $v = & $exe -v 2>$null; return ($v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) } catch { return $false }
}

try {
  $node = $null
  $local = Join-Path $env:LOCALAPPDATA 'aidem-pitch\node'
  $installed = Get-Command node.exe -ErrorAction SilentlyContinue
  foreach ($candidate in @($(if ($installed) { $installed.Source }), (Join-Path $pkg 'node-win\node.exe'), (Join-Path $local 'node.exe'))) {
    if (Test-Node $candidate) { $node = $candidate; break }
  }
  if (-not $node) {
    Write-Host 'Node.js не найден. Скачиваю переносную версию с nodejs.org (около 30 МБ, один раз)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v22.x/'
    $sums = (Invoke-WebRequest -UseBasicParsing ($base + 'SHASUMS256.txt')).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { throw 'На nodejs.org не нашлась версия для Windows.' }
    $hash, $file = $line.Trim() -split '\s+'
    $root = Join-Path $env:LOCALAPPDATA 'aidem-pitch'
    New-Item -ItemType Directory -Force $root | Out-Null
    $zip = Join-Path $root $file
    Invoke-WebRequest -UseBasicParsing ($base + $file) -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $hash.ToLower()) { Remove-Item $zip -Force; throw 'Контрольная сумма Node.js не совпала: файл удалён.' }
    if (Test-Path $local) { Remove-Item $local -Recurse -Force }
    Expand-Archive $zip -DestinationPath $root -Force
    Rename-Item (Join-Path $root ($file -replace '\.zip$', '')) 'node'
    Remove-Item $zip -Force
    $node = Join-Path $local 'node.exe'
  }
  if (-not (Test-Path (Join-Path $app 'node_modules\playwright-core\package.json'))) {
    Write-Host 'Ставлю playwright-core (один раз, нужен интернет)...'
    $npm = Join-Path (Split-Path $node) 'npm.cmd'
    if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }
    Push-Location $app
    try { & $npm install --no-audit --no-fund } finally { Pop-Location }
  }
  & $node (Join-Path $app 'show.mjs') @args
  exit $LASTEXITCODE
} catch {
  Write-Host ''
  Write-Host ('Не запустилось: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Что делать: README.txt, раздел «Если не запускается».'
  exit 1
}
