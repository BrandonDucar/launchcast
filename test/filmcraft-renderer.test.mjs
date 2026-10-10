import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FilmCraftRenderer } from "../src/core/FilmCraftRenderer.mjs";
import { VideoRenderer } from "../src/core/VideoRenderer.mjs";

function createSyntheticFixture(t, mode = "ok") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-filmcraft-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const mediaRoot = path.join(root, "media");
  const audioRoot = path.join(root, "audio");
  const outputDir = path.join(root, "out");
  fs.mkdirSync(mediaRoot);
  fs.mkdirSync(audioRoot);
  fs.mkdirSync(outputDir);

  // Valid PNG header (8 bytes) + dummy payload
  const validPng = path.join(mediaRoot, "synthetic.png");
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  fs.writeFileSync(validPng, pngHeader);

  // Valid WAV file
  const validWav = path.join(audioRoot, "synthetic.wav");
  fs.writeFileSync(validWav, "RIFF" + "0".repeat(100));

  const calls = [];
  const fakeCli = path.join(root, "fake-filmcraft-cli.exe");
  fs.writeFileSync(fakeCli, "MZ-FAKE-EXE");

  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd });
    if (mode === "timeout") throw new Error("FilmCraft timeout");

    // Handling inspect command
    if (args.includes("inspect")) {
      return JSON.stringify({
        project: {
          root: {
            children: [
              { item: 10, name: "media_beat_0.png", type: "Still Image" },
              { item: 20, name: "audio.wav", type: "Audio" }
            ]
          }
        }
      });
    }

    // Handling export command
    if (args.includes("export")) {
      const outIdx = args.indexOf("export") + 1;
      const exportDest = args[outIdx];
      if (mode === "missing-output") return;
      if (mode === "empty-output") {
        fs.writeFileSync(exportDest, "");
        return;
      }
      fs.writeFileSync(exportDest, "SYNTHETIC MP4 ARTIFACT");
      return;
    }

    // Handling run command (setup or timeline)
    if (args.includes("run")) {
      const projIdx = args.indexOf("--save-as");
      if (projIdx !== -1) {
        const projPath = args[projIdx + 1];
        fs.writeFileSync(projPath, '{"fcproj": true}');
      }
      return '{"ok": true}';
    }

    return "{}";
  };

  const storyboard = {
    totalDurationSec: 10.0,
    beats: [
      {
        beatId: "beat_1",
        headline: "Coastal Freeze Harvest",
        voiceoverScript: "Fresh local fruits in Florida.",
        durationSec: 10.0,
        mediaAsset: validPng
      }
    ]
  };

  const renderer = new FilmCraftRenderer({
    outputDir,
    allowedMediaRoots: [mediaRoot],
    allowedAudioRoots: [audioRoot],
    filmcraftCli: mode === "missing-binary" ? path.join(root, "nonexistent.exe") : fakeCli,
    runner
  });

  return { root, mediaRoot, audioRoot, outputDir, validPng, validWav, storyboard, renderer, calls, fakeCli };
}

test("FilmCraftRenderer: positive control creates sequence, places clips, and exports with receipt", async t => {
  const { renderer, storyboard, validWav, outputDir, calls } = createSyntheticFixture(t, "ok");
  const result = await renderer.render(storyboard, validWav, "vertical");

  assert.equal(result.renderer, "filmcraft");
  assert.equal(result.format, "vertical");
  assert.equal(result.resolution, "1080x1920");
  assert.equal(result.durationSec, 10.0);
  assert.match(result.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(result.outputMp4), true);

  // Verify that commands were invoked in proper sequence
  assert.equal(calls.length >= 4, true);
  assert.equal(calls[0].args.includes("--save-as"), true); // setup
  assert.equal(calls[1].args.includes("inspect"), true);   // inspect
  assert.equal(calls[2].args.includes("run"), true);       // timeline
  assert.equal(calls[3].args.includes("export"), true);    // export
});

test("FilmCraftRenderer: fallback to VideoRenderer when binary missing and fallback allowed", async t => {
  const { renderer, storyboard, validWav } = createSyntheticFixture(t, "missing-binary");
  let fallbackInvoked = false;
  renderer.fallbackRenderer = {
    render: async () => {
      fallbackInvoked = true;
      return { outputMp4: "fallback.mp4", format: "vertical", durationSec: 10.0 };
    }
  };

  const result = await renderer.render(storyboard, validWav, "vertical", { allowFallback: true });
  assert.equal(fallbackInvoked, true);
  assert.equal(result.renderer, "ffmpeg_fallback");
  assert.equal(result.fallbackReason, "FILMCRAFT_CLI_NOT_FOUND");
});

test("FilmCraftRenderer: throws when binary missing and fallback disallowed", async t => {
  const { renderer, storyboard, validWav } = createSyntheticFixture(t, "missing-binary");
  await assert.rejects(
    async () => renderer.render(storyboard, validWav, "vertical", { allowFallback: false }),
    /FilmCraft CLI executable not found/
  );
});

test("FilmCraftRenderer: rejects malformed storyboard and duration mismatches before invoking CLI", async t => {
  const { renderer, validWav, validPng, calls } = createSyntheticFixture(t, "ok");

  // Missing beats
  await assert.rejects(async () => renderer.render({ totalDurationSec: 5, beats: [] }, validWav));
  // Duration mismatch
  await assert.rejects(async () => renderer.render({
    totalDurationSec: 20,
    beats: [{ beatId: "b1", headline: "H", voiceoverScript: "S", durationSec: 5, mediaAsset: validPng }]
  }, validWav));

  assert.equal(calls.length, 0);
});

test("FilmCraftRenderer: rejects media outside allowed roots before executing commands", async t => {
  const { renderer, storyboard, validWav, root, calls } = createSyntheticFixture(t, "ok");
  const outsideMedia = path.join(root, "outside.png");
  fs.writeFileSync(outsideMedia, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));

  storyboard.beats[0].mediaAsset = outsideMedia;
  await assert.rejects(async () => renderer.render(storyboard, validWav), /outside/);
  assert.equal(calls.length, 0);
});

test("FilmCraftRenderer: rejects invalid formats", async t => {
  const { renderer, storyboard, validWav, calls } = createSyntheticFixture(t, "ok");
  await assert.rejects(async () => renderer.render(storyboard, validWav, "square"), /Invalid video format/);
  assert.equal(calls.length, 0);
});

test("FilmCraftRenderer: fails closed on runner timeout and cleans up workspace", async t => {
  const { renderer, storyboard, validWav, outputDir } = createSyntheticFixture(t, "timeout");
  await assert.rejects(async () => renderer.render(storyboard, validWav), /FilmCraft timeout/);

  // Check that temporary .render- directories were cleaned up
  const remaining = fs.readdirSync(outputDir).filter(f => f.startsWith(".render-"));
  assert.equal(remaining.length, 0);
});

test("FilmCraftRenderer: fails closed when export produces no artifact or empty file", async t => {
  for (const mode of ["missing-output", "empty-output"]) {
    const { renderer, storyboard, validWav, outputDir } = createSyntheticFixture(t, mode);
    await assert.rejects(async () => renderer.render(storyboard, validWav));
    const remaining = fs.readdirSync(outputDir).filter(f => f.startsWith(".render-"));
    assert.equal(remaining.length, 0);
  }
});

test("FilmCraftRenderer: preserves project file when preserveProject option is set", async t => {
  const { renderer, storyboard, validWav, outputDir } = createSyntheticFixture(t, "ok");
  const result = await renderer.render(storyboard, validWav, "vertical", { preserveProject: true });

  assert.ok(result.projectPath);
  assert.equal(fs.existsSync(result.projectPath), true);
  assert.equal(result.projectPath.endsWith(".fcproj"), true);
});
