# hamyad one-line installer for Windows (PowerShell 5.1+ or 7):
#   irm https://mrzroot.github.io/hamyad/install.ps1 | iex
#
# 1. uses your Node.js 20+ if present, otherwise downloads official Node.js 24 LTS (portable zip) to %LOCALAPPDATA%\hamyad\node
# 2. installs the latest hamyad release into %LOCALAPPDATA%\hamyad and adds a `hamyad` command to your user PATH
# 3. asks before setting up the current folder, then runs `hamyad setup` (init --all, approvals, chat-app URL)
# No admin rights needed. Options via environment variables, same as install.sh:
#   HAMYAD_YES=1, HAMYAD_DIR, HAMYAD_NO_SETUP=1, HAMYAD_SETUP_ARGS, HAMYAD_VERSION, HAMYAD_TARBALL, HAMYAD_NODE=portable, HAMYAD_HOME
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Repo = 'mrzroot/hamyad'
$NodeVersion = if ($env:HAMYAD_NODE_VERSION) { $env:HAMYAD_NODE_VERSION } else { '24.21.0' }
$HomeDir = if ($env:HAMYAD_HOME) { $env:HAMYAD_HOME } else { Join-Path $env:LOCALAPPDATA 'hamyad' }
$Yes = $env:HAMYAD_YES -eq '1'
$Interactive = (-not $Yes) -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected

function Step($m) { Write-Host '==> ' -ForegroundColor Green -NoNewline; Write-Host $m }
function Die($m) { Write-Host "x $m" -ForegroundColor Red; throw $m }
function Ask($q, $def) {
  if (-not $Interactive) { return $def }
  $a = Read-Host $q
  if ([string]::IsNullOrWhiteSpace($a)) { return $def } else { return $a.Trim() }
}
function IsYes($a) { return $a -match '^(y|yes|1)$' }
function NodeOk($exe) {
  if (-not $exe -or -not (Test-Path $exe)) { return $false }
  try { $v = & $exe -p 'process.versions.node.split(".")[0]'; return [int]$v -ge 20 } catch { return $false }
}

Write-Host 'hamyad' -NoNewline -ForegroundColor White; Write-Host ' · one shared brain for every AI tool · https://mrzroot.github.io/hamyad/' -ForegroundColor DarkGray

# ------------------------------------------------------------------ 1. Node.js
$Node = $null
$sys = Get-Command node -ErrorAction SilentlyContinue
$portable = Join-Path $HomeDir 'node\node.exe'
if ($env:HAMYAD_NODE -ne 'portable' -and $sys -and (NodeOk $sys.Source)) {
  $Node = $sys.Source; Step "Using Node.js $(& $Node -v) ($Node)"
} elseif (NodeOk $portable) {
  $Node = $portable; Step "Using portable Node.js $(& $Node -v)"
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  $name = "node-v$NodeVersion-win-$arch"
  Step "Node.js 20+ not found: downloading portable Node.js v$NodeVersion ($arch) into $HomeDir\node"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("hamyad-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'node.zip'
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$NodeVersion/$name.zip" -OutFile $zip
  try {
    $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
    $want = ($sums -split "`n" | Where-Object { $_ -match " $name\.zip$" }) -replace ' .*$', ''
    $got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
    if ($want -and $want.Trim() -ne $got) { Die 'Node.js checksum mismatch' }
    Write-Host '  checksum ok' -ForegroundColor DarkGray
  } catch { if ($_.Exception.Message -match 'checksum') { throw } }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  if (Test-Path (Join-Path $HomeDir 'node')) { Remove-Item -Recurse -Force (Join-Path $HomeDir 'node') }
  Move-Item (Join-Path $tmp $name) (Join-Path $HomeDir 'node')
  Remove-Item -Recurse -Force $tmp
  $Node = $portable
  if (-not (NodeOk $Node)) { Die 'portable Node.js does not run on this system' }
}
$NodeDir = Split-Path $Node
$Npm = Join-Path $NodeDir 'npm.cmd'
if (-not (Test-Path $Npm)) { $c = Get-Command npm.cmd -ErrorAction SilentlyContinue; if ($c) { $Npm = $c.Source } else { Die "npm not found next to $Node" } }

# ------------------------------------------------------------------ 2. hamyad
$Src = if ($env:HAMYAD_TARBALL) { $env:HAMYAD_TARBALL } elseif ($env:HAMYAD_VERSION) { "https://github.com/$Repo/releases/download/$($env:HAMYAD_VERSION)/hamyad.tgz" } else { "https://github.com/$Repo/releases/latest/download/hamyad.tgz" }
Step "Installing hamyad from $Src"
$Prefix = Join-Path $HomeDir 'cli'
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
$env:Path = "$NodeDir;$env:Path"
& $Npm install --prefix $Prefix --global --no-fund --no-audit --loglevel=error $Src | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'npm install failed' }
$Js = Join-Path $Prefix 'node_modules\hamyad\dist\src\cli.js'
if (-not (Test-Path $Js)) { Die "install finished but $Js is missing" }

$BinDir = Join-Path $HomeDir 'bin'
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Set-Content -Encoding ASCII -Path (Join-Path $BinDir 'hamyad.cmd') -Value "@echo off`r`n`"$Node`" `"$Js`" %*"
Set-Content -Encoding UTF8 -Path (Join-Path $BinDir 'hamyad.ps1') -Value "& `"$Node`" `"$Js`" @args`r`nexit `$LASTEXITCODE"
$Hamyad = Join-Path $BinDir 'hamyad.cmd'
Write-Host "  ✓ hamyad $(& $Hamyad --version) → $Hamyad" -ForegroundColor Green

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $BinDir)) {
  [Environment]::SetEnvironmentVariable('Path', ($(if ($userPath) { "$userPath;" } else { '' }) + $BinDir), 'User')
  Write-Host "  ! added $BinDir to your user PATH; open a new terminal to use 'hamyad' everywhere" -ForegroundColor Yellow
}
$env:Path = "$BinDir;$env:Path"

# ------------------------------------------------------------------ 3. set up the project
if ($env:HAMYAD_NO_SETUP -eq '1') { Write-Host "`nDone. In any project run:  hamyad setup"; return }
$Dir = if ($env:HAMYAD_DIR) { $env:HAMYAD_DIR } else { (Get-Location).Path }
if ($Dir -eq $HOME -or $Dir -eq [Environment]::GetFolderPath('UserProfile') -or $Dir -match '^[A-Za-z]:\\?$' -or $Dir -match '\\System32$') {
  if (-not $Interactive) { Write-Host "`nInstalled. cd into a project and run  hamyad setup"; return }
  $Dir = Ask 'Which project folder should hamyad set up? (path, empty = skip)' ''
  if (-not $Dir) { Write-Host 'Installed. Run  hamyad setup  inside a project any time.'; return }
}
if (-not (Test-Path $Dir -PathType Container)) { Die "no such folder: $Dir" }
$Dir = (Resolve-Path $Dir).Path
if (-not $Yes) {
  if (-not (IsYes (Ask "Set up hamyad for every AI tool in $Dir? [Y/n]" 'y'))) { Write-Host 'Skipped. Run  hamyad setup  inside a project any time.'; return }
}
Step "hamyad setup in $Dir"
Push-Location $Dir
try {
  $extra = if ($env:HAMYAD_SETUP_ARGS) { $env:HAMYAD_SETUP_ARGS -split '\s+' } elseif ($Interactive) { @() } else { @('--no-chat') }
  if ($Interactive) { & $Hamyad setup --init @extra } else { & $Hamyad setup --init -y @extra }
  if ($LASTEXITCODE -ne 0) { Write-Host "hamyad setup exited with $LASTEXITCODE" -ForegroundColor Yellow }
} finally { Pop-Location }
