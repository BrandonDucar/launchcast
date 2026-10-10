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
    if (args.includes("--version")) return mode === "wrong-version" ? "filmcraft-cli 99.0.0" : "filmcraft-cli 0.5.0";
    if (cmd === "ffprobe") return JSON.stringify({ format: { duration: mode === "wrong-duration" ? "1" : "10" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }, { codec_type: "audio" }] });
    if (cmd === "ffmpeg") { if (mode === "decode-failure") throw new Error("Decode failed"); return ""; }

    // Handling inspect command
    if (args.includes("inspect")) {
      return JSON.stringify({
        project: {
          root: {
            children: [
              { item: 10, name: mode === "missing-import" ? "wrong.png" : "media_beat_0.png", type: "Still Image" },
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
        fs.writeFileSync(projPath, JSON.stringify({project:{items:{
          10:{kind:{Media:{media:{File:{path:path.join(opts.cwd, 'media_beat_0.png')}}}}},
          30:{kind:{Sequence:{video_tracks:[{items:[{id:40}]}]}}}
        }}}));
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
  assert.equal(calls[1].args.includes("--save-as"), true); // setup
  assert.equal(calls[2].args.includes("inspect"), true);   // inspect
  assert.equal(calls[3].args.includes("run"), true);       // timeline
  assert.equal(calls[4].args.includes("run"), true);       // fit
  assert.equal(calls[5].args.includes("export"), true);    // export
  const fit = calls[4];
  assert.equal(path.basename(fit.args.at(-1)), "fit.jsonl");
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
  assert.ok(fs.existsSync(path.join(result.projectBundle, 'media_beat_0.png')));
  const project = JSON.parse(fs.readFileSync(result.projectPath));
  assert.equal(project.project.items[10].kind.Media.media.File.path, 'media_beat_0.png');
});

for (const mode of ['wrong-version', 'missing-import', 'wrong-duration', 'decode-failure']) {
  test(`FilmCraftRenderer fails closed on ${mode}`, async t => {
    const {renderer,storyboard,validWav} = createSyntheticFixture(t, mode);
    await assert.rejects(renderer.render(storyboard,validWav));
  });
}
test('FilmCraftRenderer default does not silently select fallback', async t => {
  const {renderer,storyboard,validWav} = createSyntheticFixture(t,'missing-binary');
  await assert.rejects(renderer.render(storyboard,validWav), /not found/);
});
test('FilmCraftRenderer rejects missing media instead of a black beat', async t => {
  const {renderer,storyboard,validWav,calls} = createSyntheticFixture(t);
  storyboard.beats[0].mediaAsset = null;
  await assert.rejects(renderer.render(storyboard,validWav), /raster/);
  assert.equal(calls.length,0);
});
