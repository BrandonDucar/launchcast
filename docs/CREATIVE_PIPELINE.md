# PhotoCraft and Postiz draft integration

PhotoCraft is an optional, separately installed local editor. It is not bundled
with LaunchCast. Qualify an official release and its checksums before running it.
The initial Windows qualification used PhotoCraft 0.6.0, with valid Authenticode
signatures from Learning Machines Inc. This is not a complete security audit.

## Local image preparation

```powershell
node scripts/photocraft-process.mjs <photocraft-cli.exe> <approved-input-root> <output-root> <image.jpg>
```

One to ten images per invocation. The processor accepts bounded JPEG, PNG and
WebP files under the configured root. Each job copies its source, fits to 1440px
without enlargement/cropping, applies brightness +2 / contrast +8, and exports
JPEG quality 92. The library exposes bounded overrides, not arbitrary commands.
Recipe changes should be visually qualified on the intended media.

Receipts bind source/output/executable hashes, dimensions and the recipe.
Original hashes are checked after processing. Failed jobs are retained for
inspection; they are not automatically retried or claimed successful. This is
process/path containment, not an OS sandbox for hostile image codecs. Treat
untrusted inputs separately. Original rights and factual labels are not inferred.

## Postiz boundary

`src/core/PostizDraftBridge.mjs` exports `buildPostizDraft` and
`stagePostizDraft`. These accept an actual Postiz upload result (`id`, `path`),
freshly listed integration ID, reviewed plain-text copy, and settings from the
current platform schema. They produce the Postiz MCP scheduling payload with
`type: draft` hardcoded. Supply the MCP scheduling function to `stagePostizDraft`
in a tool-capable host, or send the built payload with that tool explicitly.

Upload a local result with the authenticated Postiz CLI first:

```powershell
postiz upload <processed.jpg>
```

The current hosted-media allowlist is deliberately restricted to
`https://uploads.postiz.com` raster images/MP4. Self-hosted instances require an
explicit reviewed change; arbitrary URLs and local filenames are rejected.
No upload is fabricated from a local filename. Upload IDs are transport evidence,
not cryptographic authenticity. Independently list/read the resulting draft;
provider acceptance alone does not prove publication. Ambiguous outcomes require
reconciliation before retry. No autonomous live publication was added.

The image/Postiz integration is available as a local CLI/library workflow, not
yet a Studio UI control or default `runLaunchCast` stage. The optional FilmCraft
0.5.0 renderer is documented in [Windows setup](FILMCRAFT_WINDOWS.md), including
the photo-to-reel command and editable project bundles. It is not bundled here.

## Tests

`npm test` includes synthetic runner and provider fixtures. These test failure
boundaries, not actual editor output or live social publishing. Qualification
requires a real render, visual review, provider upload, and independent draft
readback in addition to tests. Never commit private customer images or credentials.
