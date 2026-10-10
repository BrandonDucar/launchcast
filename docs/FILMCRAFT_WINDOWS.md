# FilmCraft on another Windows laptop

LaunchCast contains our adapter, not a fork of FilmCraft or PhotoCraft. Install
the editors separately from their official releases. Signing into the same AI
account does not copy executables, photos, output bundles, or environment variables.
No cloud API key is needed for this local render workflow.

## Install

1. Install Node.js 22 and FFmpeg (including ffprobe) on PATH.
2. Clone `https://github.com/BrandonDucar/launchcast.git`, enter the checkout, and
   run `npm ci`. Use `npm test` to check the adapter's offline regressions.
3. Download `filmcraft-0.5.0-windows-x64-portable.zip` from the
   [official FilmCraft 0.5.0 release](https://github.com/storytold/filmcraft/releases/tag/v0.5.0).
   This guide qualifies Windows x64 only, not ARM or other releases.
4. Check the ZIP before extracting it into a new folder:

```powershell
Get-FileHash "$HOME/Downloads/filmcraft-0.5.0-windows-x64-portable.zip" -Algorithm SHA256
```

Expected SHA256:
`d4ce8aaa17826db1aaa4fceb51aaab5f6cdfdd75eeaa22b702bc95b8f39a6c44`

5. Set the path for this PowerShell session using your actual extraction folder:

```powershell
$env:FILMCRAFT_CLI_PATH = "$HOME/Tools/filmcraft-0.5.0-windows-x64-portable/filmcraft-cli.exe"
Get-AuthenticodeSignature $env:FILMCRAFT_CLI_PATH
& $env:FILMCRAFT_CLI_PATH --version
ffmpeg -version
ffprobe -version
```

The qualified executable reports `filmcraft-cli 0.5.0` and has a valid Windows
signature from Learning Machines Inc. Expected executable SHA256:
`1dc56e8f56a9d4d6333f6577f00efd5da21d252d0f3809a99ab7ff36012db4cb`.
Stop on a mismatch; do not bypass signature validation. This check establishes
artifact identity, not a comprehensive security audit.

## Make a real reel

Place approved JPEG/PNG/WebP photos in a local folder. From the LaunchCast checkout:

```powershell
node scripts/filmcraft-reel.mjs $env:FILMCRAFT_CLI_PATH "$HOME/Pictures/Coastal" ./output "$HOME/Pictures/Coastal/photo1.jpg" "$HOME/Pictures/Coastal/photo2.jpg" "$HOME/Pictures/Coastal/photo3.jpg"
```

This produces five seconds per photo, 1080x1920 H.264 video, a synthetic backing
track (not narration), a JSON receipt, and a retained `.render-*` project bundle.
It invents no product names or health claims. One to eight photos are supported.
Each image is limited to 20 MiB; subprocesses have execution deadlines. A slow
machine may time out. Originals are copied and their hashes checked, not edited.
The adapter probes the actual output and decodes the entire MP4 before success.
Neither those checks nor a receipt prove the video looks good: review it yourself.

For existing repo workflows, `node cli.mjs <local-repo> --renderer=filmcraft`
selects this renderer; every beat must contain approved raster media. The CLI
does not silently fall back to a different renderer if FilmCraft is missing.

## Move an editable project

Copy the entire `projectBundle` folder printed in the receipt, including hidden
`.render-*` directories, to the other laptop. Do not copy only `project.fcproj`.
The bundle contains relative references to its own image/audio copies. Start
FilmCraft from that bundle directory when reopening it. For a CLI preview:

```powershell
Set-Location <copied-bundle-directory>
& $env:FILMCRAFT_CLI_PATH --project ./project.fcproj render --seconds 1 --out ./preview.png --scale 0.5
```

Setup/timeline JSONL files are execution history, not relocation scripts: their
original setup paths must not be rerun on a different laptop. Use the saved
project or generate a fresh reel. Keep source photos and private receipts out of
public Git. Local output remains on this machine until explicitly copied/uploaded.

## PhotoCraft and Postiz

For PhotoCraft 0.6.0 and the draft-only Postiz bridge, see
[Creative Pipeline](CREATIVE_PIPELINE.md). Editor installation and GitHub delivery
do not upload a video or publish a post. Use an actual successful Postiz upload
result and current account/platform settings; independently read back the draft.
Never substitute a guessed uploads URL for an upload receipt. Google Drive and
YouTube upload adapters remain unimplemented.
