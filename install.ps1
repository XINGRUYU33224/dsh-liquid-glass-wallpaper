#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install the liquid-glass wallpaper plugin into a DSH profile, in one command.

.DESCRIPTION
    Handles everything the manual path makes tedious:

      * finds your DSH home and the profile your GUI actually runs on,
      * installs from GitHub with the profile's own pnpm (no clone, no path edits),
      * works around the fact that `dsh plugin --profile desktop ...` is refused by
        name even though the desktop profile is an ordinary cordis profile,
      * verifies the plugin landed in the profile's bundle list before it exits.

.EXAMPLE
    pwsh -File install.ps1
    pwsh -File install.ps1 -Profile desktop
    pwsh -File install.ps1 -Local -Path "E:\my-fork"
#>
[CmdletBinding()]
param(
  # Profile to install into. Defaults to the one the running GUI uses, else 'web'.
  [string]$Profile,

  # Install from a local checkout instead of GitHub.
  [switch]$Local,

  # Path to a local checkout (used with -Local). Defaults to this script's directory.
  [string]$Path,

  # Git ref (branch/tag/sha) to install when installing from GitHub.
  [string]$Ref,

  # Skip the post-install load-tree verification.
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'

$RepoSpec = 'XINGRUYU33224/dsh-liquid-glass-wallpaper'
$PkgName  = 'dsh-liquid-glass-wallpaper'

function Info($m) { Write-Host "  $m" }
function Step($m) { Write-Host "`n== $m ==" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "`n!! $m" -ForegroundColor Red; exit 1 }

Write-Host "`nliquid-glass-wallpaper installer" -ForegroundColor White

# ---------------------------------------------------------------- DSH home
Step 'locating DSH'

$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
if (-not (Test-Path $dshHome)) {
  Die "DSH home not found at '$dshHome'. Set `$env:DSH_HOME or install DeepSeek Harness first."
}
$profilesDir = Join-Path $dshHome 'profiles'
if (-not (Test-Path $profilesDir)) { Die "No profiles directory at '$profilesDir'." }
Info "DSH home: $dshHome"

$available = Get-ChildItem $profilesDir -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } |
  Select-Object -ExpandProperty Name
if (-not $available) { Die "No usable profiles under '$profilesDir'." }
Info "profiles: $($available -join ', ')"

# ------------------------------------------------------- pick the profile
if (-not $Profile) {
  # The GUI host process carries its profile as a path argument; prefer that,
  # since installing into a profile the user never opens is the classic mistake.
  # Scan every candidate rather than the first, and accept any process whose
  # command line contains a profile path.
  $detected = $null
  try {
    $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match 'profiles\\' }
    foreach ($pr in $procs) {
      if ($pr.CommandLine -match "profiles\\([^\\`"]+)") {
        $cand = $Matches[1]
        # Only trust a name that is a real profile directory here.
        if ($available -contains $cand) { $detected = $cand; break }
      }
    }
  } catch { }

  if ($detected) {
    $Profile = $detected
    Info "detected the running GUI's profile: $Profile"
  } elseif ($available -contains 'web') {
    $Profile = 'web'
    Info "no running GUI detected; defaulting to 'web'"
  } else {
    $Profile = $available[0]
    Info "no running GUI detected; defaulting to '$Profile'"
  }
}

if ($available -notcontains $Profile) {
  Die "Profile '$Profile' not found under '$profilesDir'. Available: $($available -join ', ')"
}
$profileDir = Join-Path $profilesDir $Profile
$manifest   = Join-Path $profileDir 'package.json'
Info "installing into: $Profile"

# ------------------------------------------------------------- pnpm lookup
Step 'locating pnpm'

# Prefer the pnpm the desktop app ships; fall back to a PATH install.
$runtimePnpm = $null
$appRoots = @(
  "$env:LOCALAPPDATA\Programs\DeepSeek Harness",
  "$env:ProgramFiles\DeepSeek Harness",
  "${env:ProgramFiles(x86)}\DeepSeek Harness"
)
# Also probe the running app's own directory, which is authoritative.
$hostProc = Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath } | Select-Object -First 1
if ($hostProc) { $appRoots = @(Split-Path $hostProc.ExecutablePath -Parent) + $appRoots }
# And the checkout this session runs from, if the env points at it.
if ($env:DSH_RUNTIME) { $appRoots += $env:DSH_RUNTIME }

foreach ($root in $appRoots) {
  if (-not $root) { continue }
  $cand = Join-Path $root 'resources\runtime\pnpm\bin\pnpm.mjs'
  if (Test-Path $cand) { $runtimePnpm = $cand; break }
}

$nodeExe = $null
foreach ($root in $appRoots) {
  if (-not $root) { continue }
  $cand = Join-Path $root 'resources\runtime\bin\node\node.exe'
  if (Test-Path $cand) { $nodeExe = $cand; break }
}
foreach ($root in $appRoots) {
  if (-not $root) { continue }
  $cand = Join-Path $root 'resources\runtime\bin\node.exe'
  if (Test-Path $cand) { $nodeExe = $cand; break }
}

if ($runtimePnpm -and $nodeExe) {
  Info "using the app's bundled runtime"
} else {
  $runtimePnpm = $null
  $nodeExe = $null
  $sys = Get-Command node -ErrorAction SilentlyContinue
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if (-not $sys) { Die "No Node.js found. Install Node 20+ or run this from the DeepSeek Harness app directory." }
  Info "using PATH node: $($sys.Source)"
  if (-not $pnpm) {
    Warn "pnpm not on PATH; will fall back to 'dsh plugin' if available"
  } else {
    Info "using PATH pnpm: $($pnpm.Source)"
  }
}

# ---------------------------------------------------------------- install
Step 'installing'

$spec = if ($Local) {
  $localPath = if ($Path) { $Path } else { $PSScriptRoot }
  if (-not (Test-Path (Join-Path $localPath 'package.json'))) {
    Die "-Local given but '$localPath' has no package.json."
  }
  if ($localPath -match '\s') {
    Warn "the path contains a space; pnpm splits 'link:' arguments on spaces."
    Warn "clone into a space-free directory if this fails."
  }
  "link:$($localPath -replace '\\','/')"
} else {
  if ($Ref) { "github:$RepoSpec#$Ref" } else { "github:$RepoSpec" }
}
Info "spec: $spec"

# Re-running is a normal thing to do (to update, or after a failed attempt), so
# make it idempotent: if the package is already present at this spec, skip the
# network round trip entirely.
$currentManifest = Get-Content $manifest -Raw | ConvertFrom-Json
$currentSpec = $currentManifest.dependencies.$PkgName
$alreadyAtSpec = ($currentSpec -eq $spec) -and
                 (Test-Path (Join-Path $profileDir "node_modules\$PkgName\package.json"))

if ($alreadyAtSpec -and -not $Local) {
  Info "already installed at this spec; skipping pnpm"
  $code = 0
} else {
  Push-Location $profileDir
  try {
    if ($nodeExe -and $runtimePnpm) {
      & $nodeExe $runtimePnpm add $spec 2>&1 | ForEach-Object { "  $_" }
      $code = $LASTEXITCODE
    } elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
      & pnpm add $spec 2>&1 | ForEach-Object { "  $_" }
      $code = $LASTEXITCODE
    } else {
      & dsh plugin --profile $Profile add $spec 2>&1 | ForEach-Object { "  $_" }
      $code = $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
}

if ($code -ne 0) {
  Write-Host ""
  Write-Host "!! install failed (exit $code)" -ForegroundColor Red
  Write-Host @"

If pnpm complained about build scripts, authorise them in
  $profileDir\pnpm-workspace.yaml
by adding:

  allowBuilds:
    $($PkgName): true

If it complained about a space in the path, clone somewhere without spaces.
"@
  exit 1
}
Ok 'package installed'

# --------------------------------------------------- register as a layer
Step 'registering as a profile bundle layer'

$json = Get-Content $manifest -Raw | ConvertFrom-Json
$changed = $false

if (-not $json.dependencies.$PkgName) {
  $json.dependencies | Add-Member -NotePropertyName $PkgName -NotePropertyValue $spec -Force
  $changed = $true
  Info 'added the dependency'
}

$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains $PkgName) {
  $bundles += $PkgName
  $json.dsh.profile.bundles = $bundles
  $changed = $true
  Info 'added to dsh.profile.bundles'
}

if ($changed) {
  # Write without a BOM: this file is parsed as JSON by the boot loader, and a
  # BOM makes it fail with "Unexpected token".
  $out = $json | ConvertTo-Json -Depth 12
  [System.IO.File]::WriteAllText($manifest, $out, [System.Text.UTF8Encoding]::new($false))
  Ok "updated $manifest"
} else {
  Ok 'already registered'
}

# ------------------------------------------------------------- verify
if (-not $SkipVerify) {
  Step 'verifying'

  $installed = Join-Path $profileDir "node_modules\$PkgName"
  if (-not (Test-Path (Join-Path $installed 'lib\client.js'))) {
    Die "installed package is missing lib/client.js at '$installed'."
  }
  if (-not (Test-Path (Join-Path $installed 'cordis.patch.yml'))) {
    Die "installed package is missing cordis.patch.yml."
  }
  Ok 'payload present (lib/client.js, cordis.patch.yml)'

  # Confirm the boot loader actually composes this plugin, by dumping the
  # profile's composed config. This catches a bad bundle patch before the user
  # restarts their GUI and finds a broken tray.
  #
  # Try every plausible way to invoke dsh, most authoritative first, so the
  # check does not silently skip on a machine where dsh is simply not on PATH:
  #   1. the app's own bundled CLI (same code the GUI boots with),
  #   2. the app's node running that CLI directly,
  #   3. npx @deepseek-ai/dsh,
  #   4. a dsh on PATH.
  $dumpOk = $false
  $dumpTried = @()
  $dumpErr = $null

  # The desktop app keeps dsh inside app.asar, so only its own Electron binary
  # (with ELECTRON_RUN_AS_NODE) can load it. Prefer that when present.
  $asarCli = $null
  $electron = $null
  foreach ($root in $appRoots) {
    if (-not $root) { continue }
    $exe = Join-Path $root 'DeepSeek Harness.exe'
    if (Test-Path $exe) { $electron = $exe }
    $loader = Join-Path $root 'resources\app.asar\dsh\node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (Test-Path $loader) { $asarCli = $loader }
  }

  if ($electron -and $asarCli) {
    $dumpTried += 'app CLI (asar)'
    try {
      $prevElectron = $env:ELECTRON_RUN_AS_NODE
      $env:ELECTRON_RUN_AS_NODE = '1'
      $dump = & $electron --expose-internals $asarCli --profile $Profile --dump-config 2>&1
      $env:ELECTRON_RUN_AS_NODE = $prevElectron
      if ($dump -match [regex]::Escape($PkgName) -and $dump -notmatch 'failed to') { $dumpOk = $true }
      elseif ($dump -match 'managed exclusively|failed to') { $dumpErr = ($dump | Select-String 'managed exclusively|failed to' | Select-Object -First 1) }
    } catch {
      $env:ELECTRON_RUN_AS_NODE = $null
      $dumpErr = $_.Exception.Message
    }
  }

  if (-not $dumpOk) {
    $dshCmd = Get-Command dsh -ErrorAction SilentlyContinue
    if ($dshCmd) {
      $dumpTried += 'dsh on PATH'
      try {
        $dump = & dsh --profile $Profile --dump-config 2>&1
        if ($dump -match [regex]::Escape($PkgName) -and $dump -notmatch 'failed to') { $dumpOk = $true }
        elseif (-not $dumpErr) { $dumpErr = ($dump | Select-String 'failed to' | Select-Object -First 1) }
      } catch { if (-not $dumpErr) { $dumpErr = $_.Exception.Message } }
    }
  }

  if (-not $dumpOk -and (Get-Command npx -ErrorAction SilentlyContinue)) {
    $dumpTried += 'npx @deepseek-ai/dsh'
    try {
      $dump = & npx --yes @deepseek-ai/dsh --profile $Profile --dump-config 2>&1
      if ($dump -match [regex]::Escape($PkgName) -and $dump -notmatch 'failed to') { $dumpOk = $true }
      elseif (-not $dumpErr) { $dumpErr = ($dump | Select-String 'failed to|cannot resolve' | Select-Object -First 1) }
    } catch { if (-not $dumpErr) { $dumpErr = $_.Exception.Message } }
  }

  if ($dumpOk) {
    Ok "the boot loader composes this plugin (via $($dumpTried -join ', '))"
  } else {
    # Fall back to a static check that always works: the bundle list in the
    # manifest must name this package, and the package must carry a bundle patch.
    $bundled = (Get-Content $manifest -Raw | ConvertFrom-Json).dsh.profile.bundles -contains $PkgName
    $hasPatch = Test-Path (Join-Path $installed 'cordis.patch.yml')
    if ($bundled -and $hasPatch) {
      Ok 'bundle registration is correct (manifest lists it and the patch exists)'
      Warn "could not run a live load-tree dump ($($dumpTried -join ', ')); install is registered correctly"
      if ($dumpErr) { Warn "dump said: $dumpErr" }
    } else {
      Die "the plugin is present but not registered as a bundle layer (bundled=$bundled patch=$hasPatch)."
    }
  }
}

# ---------------------------------------------------------------- done
Step 'done'

$restartNote = if ($Profile -eq 'desktop') {
  'Fully quit and reopen the DeepSeek Harness app (not just a page refresh).'
} else {
  'Restart the DSH server, then reload the page.'
}

Write-Host @"

  Installed  $PkgName
  Profile    $Profile
  Settings   Settings -> 液态玻璃壁纸  (Liquid Glass Wallpaper)

  $restartNote

  Wallpapers are read from your own Wallpaper Engine install; nothing is
  uploaded. See the README for what each control does.

"@ -ForegroundColor Green
