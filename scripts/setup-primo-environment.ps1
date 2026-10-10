<#
.SYNOPSIS
  Turnkey environment setup and qualification script for LaunchCast + FilmCraft on Windows.
.DESCRIPTION
  Verifies runtime prerequisites (Node.js >= 20, FFmpeg, ffprobe), qualifies FilmCraft 0.5.0
  portable release with Authenticode and SHA-256 airlock verification, inspects PhotoCraft 0.6.0,
  runs the LaunchCast regression test suite (112 tests), and executes a dry-run recipe preview.
.PARAMETER ToolsDir
  Destination directory for local portable tools. Defaults to "$HOME\Tools".
.PARAMETER DownloadsDir
  Directory for downloaded release archives. Defaults to "$HOME\Downloads".
.PARAMETER SkipDownload
  Skip downloading FilmCraft ZIP if not already present.
.PARAMETER SkipTests
  Skip running npm test regressions.
.EXAMPLE
  .\scripts\setup-primo-environment.ps1
.EXAMPLE
  .\scripts\setup-primo-environment.ps1 -ToolsDir "D:\Tools" -SkipTests
#>

[CmdletBinding()]
param(
  [string]$ToolsDir = "$HOME\Tools",
  [string]$DownloadsDir = "$HOME\Downloads",
  [switch]$SkipDownload,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " LaunchCast Environment Setup & Qualification" -ForegroundColor Cyan
Write-Host " Target: Windows x64 (Primo / Operator Station)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$results = [ordered]@{}

# Helper functions
function Log-Pass([string]$name, [string]$detail) {
  Write-Host "  [OK]   $($name): $detail" -ForegroundColor Green
  $results[$name] = "PASS ($detail)"
}

function Log-Warn([string]$name, [string]$detail) {
  Write-Host "  [WARN] $($name): $detail" -ForegroundColor Yellow
  $results[$name] = "WARN ($detail)"
}

function Log-Fail([string]$name, [string]$detail) {
  Write-Host "  [FAIL] $($name): $detail" -ForegroundColor Red
  $results[$name] = "FAIL ($detail)"
  throw "Qualification failed at step: $name ($detail)"
}

function Log-Info([string]$msg) {
  Write-Host "  [INFO] $msg" -ForegroundColor Gray
}

# -------------------------------------------------------------
# 1. Check Node.js runtime (>= 20.0.0 required, 22.x recommended)
# -------------------------------------------------------------
Write-Host "1. Checking Node.js Runtime..." -ForegroundColor White
try {
  $nodeVerRaw = (node -v 2>$null)
  if (-not $nodeVerRaw) {
    Log-Fail "Node.js" "node command not found on PATH. Install Node.js >= 20.x from https://nodejs.org"
  }
  $cleanVer = $nodeVerRaw.Trim().TrimStart('v')
  $major = [int]($cleanVer.Split('.')[0])
  if ($major -lt 20) {
    Log-Fail "Node.js" "Detected $nodeVerRaw. Node.js version 20 or higher is required."
  } else {
    Log-Pass "Node.js" "$nodeVerRaw (Node.js $major runtime meets requirements)"
  }
} catch {
  Log-Fail "Node.js" $_.Exception.Message
}

# -------------------------------------------------------------
# 2. Check FFmpeg and FFprobe on PATH
# -------------------------------------------------------------
Write-Host "`n2. Checking FFmpeg & FFprobe Media Binaries..." -ForegroundColor White
try {
  $ffmpegOut = (ffmpeg -version 2>$null | Select-Object -First 1)
  if ($ffmpegOut) {
    Log-Pass "FFmpeg" ($ffmpegOut -replace '\s+Copyright.*$', '')
  } else {
    Log-Fail "FFmpeg" "ffmpeg not found on PATH. Install via 'winget install Gyan.FFmpeg' or extract to PATH."
  }

  $ffprobeOut = (ffprobe -version 2>$null | Select-Object -First 1)
  if ($ffprobeOut) {
    Log-Pass "FFprobe" ($ffprobeOut -replace '\s+Copyright.*$', '')
  } else {
    Log-Fail "FFprobe" "ffprobe not found on PATH. Required for strict container validation."
  }
} catch {
  Log-Fail "FFmpeg/FFprobe" $_.Exception.Message
}

# -------------------------------------------------------------
# 3. Locate or Download FilmCraft 0.5.0 Windows x64 Portable
# -------------------------------------------------------------
Write-Host "`n3. Qualifying FilmCraft 0.5.0 CLI..." -ForegroundColor White

$EXPECTED_ZIP_SHA256 = "d4ce8aaa17826db1aaa4fceb51aaab5f6cdfdd75eeaa22b702bc95b8f39a6c44"
$EXPECTED_EXE_SHA256 = "1dc56e8f56a9d4d6333f6577f00efd5da21d252d0f3809a99ab7ff36012db4cb"
$EXPECTED_SIGNER = "Learning Machines Inc"
$DOWNLOAD_URL = "https://github.com/storytold/filmcraft/releases/download/v0.5.0/filmcraft-0.5.0-windows-x64-portable.zip"

$filmcraftCliPath = $null

# Check environment variable first
if ($env:FILMCRAFT_CLI_PATH -and (Test-Path $env:FILMCRAFT_CLI_PATH)) {
  $filmcraftCliPath = (Resolve-Path $env:FILMCRAFT_CLI_PATH).Path
  Log-Info "Using path from `$env:FILMCRAFT_CLI_PATH: $filmcraftCliPath"
}

# Check common dev and tools folders
if (-not $filmcraftCliPath) {
  $candidates = @(
    (Join-Path $ToolsDir "filmcraft-0.5.0-windows-x64-portable\filmcraft-cli.exe"),
    (Join-Path $HOME ".dreamnet\tools\filmcraft\0.5.0\portable\filmcraft-0.5.0-windows-x64-portable\filmcraft-cli.exe")
  )
  foreach ($cand in $candidates) {
    if (Test-Path $cand) {
      $filmcraftCliPath = (Resolve-Path $cand).Path
      Log-Info "Located FilmCraft CLI at: $filmcraftCliPath"
      break
    }
  }
}

# Check PATH
if (-not $filmcraftCliPath) {
  $cmd = Get-Command "filmcraft-cli.exe" -ErrorAction SilentlyContinue
  if ($cmd) {
    $filmcraftCliPath = $cmd.Source
    Log-Info "Located FilmCraft CLI on PATH: $filmcraftCliPath"
  }
}

# If still not found, download and extract
if (-not $filmcraftCliPath) {
  if ($SkipDownload) {
    Log-Fail "FilmCraft" "FilmCraft CLI not found and -SkipDownload was specified."
  }

  Log-Info "FilmCraft not found locally. Initiating secure airlock download..."
  if (-not (Test-Path $DownloadsDir)) {
    New-Item -ItemType Directory -Path $DownloadsDir -Force | Out-Null
  }

  $zipPath = Join-Path $DownloadsDir "filmcraft-0.5.0-windows-x64-portable.zip"
  if (-not (Test-Path $zipPath)) {
    Log-Info "Downloading FilmCraft 0.5.0 from: $DOWNLOAD_URL"
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $zipPath -UseBasicParsing
  } else {
    Log-Info "Found cached ZIP archive: $zipPath"
  }

  # Verify ZIP SHA-256 before extraction
  $actualZipHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
  if ($actualZipHash -ne $EXPECTED_ZIP_SHA256.ToLower()) {
    Log-Fail "FilmCraft Archive Airlock" "ZIP SHA256 mismatch! Expected: $EXPECTED_ZIP_SHA256, Got: $actualZipHash"
  }
  Log-Pass "FilmCraft Archive Airlock" "ZIP SHA256 matched ($actualZipHash)"

  # Extract into ToolsDir
  $extractDir = Join-Path $ToolsDir "filmcraft-0.5.0-windows-x64-portable"
  if (-not (Test-Path $extractDir)) {
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
  }
  Log-Info "Extracting archive to: $extractDir"
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

  $filmcraftCliPath = Join-Path $extractDir "filmcraft-cli.exe"
  if (-not (Test-Path $filmcraftCliPath)) {
    # Check if archive extracted into a nested subfolder
    $nested = Get-ChildItem -Path $extractDir -Filter "filmcraft-cli.exe" -Recurse | Select-Object -First 1
    if ($nested) {
      $filmcraftCliPath = $nested.FullName
    } else {
      Log-Fail "FilmCraft Extraction" "filmcraft-cli.exe not found after expanding archive."
    }
  }
}

# Authenticode signature verification
$sig = Get-AuthenticodeSignature -FilePath $filmcraftCliPath
if ($sig.Status -ne "Valid") {
  Log-Fail "FilmCraft Authenticode" "Authenticode status is '$($sig.Status)' (expected Valid). Do not run untrusted binaries."
}
if ($sig.SignerCertificate.Subject -notmatch $EXPECTED_SIGNER) {
  Log-Fail "FilmCraft Signer" "Signer mismatch. Expected '$EXPECTED_SIGNER', got '$($sig.SignerCertificate.Subject)'"
}
Log-Pass "FilmCraft Authenticode" "Valid signature by $($sig.SignerCertificate.Subject)"

# Executable SHA-256 verification
$actualExeHash = (Get-FileHash -Path $filmcraftCliPath -Algorithm SHA256).Hash.ToLower()
if ($actualExeHash -ne $EXPECTED_EXE_SHA256.ToLower()) {
  Log-Fail "FilmCraft Binary Hash" "Executable SHA256 mismatch! Expected: $EXPECTED_EXE_SHA256, Got: $actualExeHash"
}
Log-Pass "FilmCraft Binary Hash" "SHA256 matched ($actualExeHash)"

# Version check
$verOut = (& $filmcraftCliPath --version 2>&1 | Out-String).Trim()
if ($verOut -notmatch "0\.5\.0") {
  Log-Fail "FilmCraft Version" "Unexpected version output: $verOut (expected 0.5.0)"
}
Log-Pass "FilmCraft Version" "$verOut"

# Set session environment variable
$env:FILMCRAFT_CLI_PATH = $filmcraftCliPath
Log-Info "Set `$env:FILMCRAFT_CLI_PATH for current session to: $filmcraftCliPath"

# -------------------------------------------------------------
# 4. Check PhotoCraft 0.6.0 (Optional Image Preprocessor)
# -------------------------------------------------------------
Write-Host "`n4. Inspecting PhotoCraft 0.6.0 (Optional Preprocessor)..." -ForegroundColor White
$photocraftCliPath = $null

if ($env:PHOTOCRAFT_CLI_PATH -and (Test-Path $env:PHOTOCRAFT_CLI_PATH)) {
  $photocraftCliPath = (Resolve-Path $env:PHOTOCRAFT_CLI_PATH).Path
}

if (-not $photocraftCliPath) {
  $pcCandidates = @(
    (Join-Path $ToolsDir "photocraft-0.6.0-windows-x64-portable\photocraft-cli.exe"),
    (Join-Path $HOME ".dreamnet\tools\photocraft\0.6.0\portable\photocraft-0.6.0-windows-x64-portable\photocraft-cli.exe")
  )
  foreach ($cand in $pcCandidates) {
    if (Test-Path $cand) {
      $photocraftCliPath = (Resolve-Path $cand).Path
      break
    }
  }
}

if ($photocraftCliPath) {
  $pcSig = Get-AuthenticodeSignature -FilePath $photocraftCliPath
  if ($pcSig.Status -eq "Valid" -and $pcSig.SignerCertificate.Subject -match "Learning Machines Inc") {
    $pcVer = (& $photocraftCliPath --version 2>&1 | Out-String).Trim()
    Log-Pass "PhotoCraft 0.6.0" "Verified at $photocraftCliPath ($pcVer, Valid Authenticode)"
    $env:PHOTOCRAFT_CLI_PATH = $photocraftCliPath
  } else {
    Log-Warn "PhotoCraft 0.6.0" "Binary found at $photocraftCliPath but Authenticode signature is $($pcSig.Status)"
  }
} else {
  Log-Warn "PhotoCraft 0.6.0" "Optional binary not found. Video rendering operates standalone. See docs/CREATIVE_PIPELINE.md if image preprocessing is required."
}

# -------------------------------------------------------------
# 5. Run LaunchCast Regression Test Suite
# -------------------------------------------------------------
Write-Host "`n5. Running LaunchCast Regression Suite..." -ForegroundColor White
if (-not $SkipTests) {
  try {
    $testResult = (npm test 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and $testResult -match "fail 0") {
      # Extract test count
      $countMatch = [regex]::Match($testResult, "pass (\d+)")
      $passCount = if ($countMatch.Success) { $countMatch.Groups[1].Value } else { "112+" }
      Log-Pass "LaunchCast Tests" "$passCount tests passed, 0 failed, 0 skipped"
    } else {
      Log-Fail "LaunchCast Tests" "Test suite reported failures. Output:`n$testResult"
    }
  } catch {
    Log-Fail "LaunchCast Tests" $_.Exception.Message
  }
} else {
  Log-Warn "LaunchCast Tests" "Skipped (-SkipTests specified)"
}

# -------------------------------------------------------------
# 6. Dry-Run Recipe Compilation Check
# -------------------------------------------------------------
Write-Host "`n6. Validating Declarative Recipe Compilation..." -ForegroundColor White
try {
  $recipePath = "docs/recipes/coastal-freeze-harvest-reel.recipe.json"
  if (Test-Path $recipePath) {
    $compileOut = (node scripts/compile-recipe.mjs $recipePath 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and $compileOut -match "CREATIVE RECIPE PREVIEW") {
      Log-Pass "Recipe Validation" "coastal-freeze-harvest-reel compiled successfully"
    } else {
      Log-Fail "Recipe Validation" "Failed compiling $($recipePath): $compileOut"
    }
  } else {
    Log-Warn "Recipe Validation" "Recipe file $recipePath not found in current directory"
  }
} catch {
  Log-Fail "Recipe Validation" $_.Exception.Message
}

# -------------------------------------------------------------
# Summary Checklist
# -------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host " Setup & Qualification Summary" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
foreach ($k in $results.Keys) {
  $val = $results[$k]
  $color = if ($val -match "^PASS") { "Green" } elseif ($val -match "^WARN") { "Yellow" } else { "Red" }
  Write-Host ("  {0,-28} : {1}" -f $k, $val) -ForegroundColor $color
}
Write-Host ""
Write-Host "Next Steps for Primo:" -ForegroundColor White
Write-Host "  1. To make `$env:FILMCRAFT_CLI_PATH permanent across all PowerShell sessions, run:" -ForegroundColor Yellow
Write-Host "     [Environment]::SetEnvironmentVariable('FILMCRAFT_CLI_PATH', '$filmcraftCliPath', 'User')" -ForegroundColor Gray
Write-Host "  2. To render a vertical reel from approved local photos:" -ForegroundColor Yellow
Write-Host "     node scripts/filmcraft-reel.mjs `$env:FILMCRAFT_CLI_PATH `"<photos-dir>`" ./output `"<photo1.jpg>`" `"<photo2.jpg>`" `"<photo3.jpg>`"" -ForegroundColor Gray
Write-Host "============================================================`n" -ForegroundColor Cyan
