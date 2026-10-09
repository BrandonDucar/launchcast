# LaunchCast

**Turn a repository into a storyboard and a locally rendered launch video.**

[Project homepage](https://brandonducar.github.io/BrandonDucar/projects/launchcast/) | [Contribute](CONTRIBUTING.md) | [Apache-2.0](LICENSE)

LaunchCast treats a short product video as a compilation pipeline:

```text
Repository metadata + raster assets -> storyboard -> synthetic audio -> FFmpeg MP4
```

Start with a local video you can inspect and edit. LaunchCast does not currently
deliver autonomous social uploads, spoken narration, or production Google
Workspace editing.

## Implementation Status

| Surface | Current boundary |
| --- | --- |
| Repository scanner | Local paths and public GitHub HTTPS URLs through the CLI; bounded metadata reads |
| Storyboard compiler | Structured beat sequence; generated claims still need human review |
| Local rendering | FFmpeg/ffprobe with raster assets and a synthetic backing track, not voiceover |
| Web Studio | Local single-user browser UI on `127.0.0.1:3344` |
| Google Docs / Slides | Prototype library adapters; Studio returns `501`, not real Google artifacts |
| Drive / YouTube upload | Not implemented; no fabricated provider IDs or public links |
| Farcaster | Explicit request, blocked without an accepted public upload |
| Publication verification | Provider acceptance is not independent public readback |

## Quickstart

Install Node.js 22+ and make `ffmpeg` and `ffprobe` available on your PATH.

```bash
git clone https://github.com/BrandonDucar/launchcast.git
cd launchcast
npm install
npm test

# Inspect metadata and storyboard before rendering.
node cli.mjs scan .
node cli.mjs compile .

# Render locally; use the equals-sign format accepted by the CLI.
node cli.mjs .
node cli.mjs . --format=landscape

# Local browser studio.
npm start
```

Open <http://127.0.0.1:3344>. Use a repository you trust, and review generated
claims against source evidence before using a video commercially.

## Studio Boundaries

Studio binds to loopback, rejects foreign Host/Origin requests, and requires a
temporary same-origin browser session for work and video downloads. Restarting
invalidates that session. Requests are limited to 64 KiB (4 MiB for full scan
metadata sent to compile), with one active operation.

By default only directories under the Studio's working directory can be scanned.
To add trusted local roots in PowerShell:

```powershell
$env:LAUNCHCAST_SCAN_ROOTS = '["C:/repos/project-one","C:/repos/project-two"]'
npm start
```

Remote cloning is CLI-only. Studio serves only completed MP4s from its current
process, not WAVs, intermediate files, or older output. Its bounded in-memory
media list needs a rescan after a restart or eviction.

## Publishing Is Not Yet Available

`--publish` requests Google uploads; it does not mean Farcaster. `--farcaster`
is separate. Requested but incomplete distribution exits nonzero while preserving
the local render. A render is not a publication receipt.

A future uploader must return a real provider ID, a matching provider URL, and
confirmed `publiclyAccessible: true`. Missing, private, failed, or mismatched
results must not be cast or embedded. The Neynar adapter reports `ACCEPTED` only
when it receives a valid cast hash, not independent public verification. Ambiguous
outcomes need reconciliation before retry. Missing credentials are
`NOT_CONFIGURED`, not simulated success.

## Tests And Limitations

`npm test` runs offline regressions without live posting. An optional local
FFmpeg canary uses explicitly synthetic inputs:

```bash
node test/render-canary.mjs <existing-evidence-directory>
```

It retains two one-second MP4s and audio under a unique directory. It never
publishes. Test artifacts are not customer outcomes or provider receipts.

Subprocesses use argument arrays, bounded inputs, and deadlines. Public GitHub
clones disable ambient Git credentials/configuration. Clone private or SSH repos
through a trusted workflow first, then pass local paths. Rendering accepts raster
files only within allowed media roots; audio defaults to the output directory.
Text is literal, not executable FFmpeg filter syntax; existing output files are
not overwritten. Storyboards permit 1-8 beats, 0.1-30 seconds each, totaling at
most 120 seconds.

These controls are not an OS sandbox. FFmpeg runs synchronously; aggregate disk,
remote checkout size, cumulative cache size, and decoder quotas remain gaps.
Another process running as the same OS user is outside the Studio boundary.
Do not put Studio behind a public proxy or expose it to a network.

## Roadmap

- Real upload adapters with provider receipts and independent readback.
- Narration and human-editable Workspace workflows with explicit consent.
- Resource quotas and stronger isolation before any multi-user hosting.

These are planned, not shipped. No retention uplift, conversion guarantee, or
measured editing-time saving is claimed.

## License

Apache-2.0, as already declared in package metadata. See [LICENSE](LICENSE).
Third-party tools, media, and dependencies retain their own licenses.
