// Opt-in local FFmpeg canary. All inputs are synthetic; nothing is published.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AudioSynthesizer } from "../src/core/AudioSynthesizer.mjs";
import { VideoRenderer } from "../src/core/VideoRenderer.mjs";

if (!process.argv[2]) throw new Error("Provide an existing local evidence directory");
const root = fs.realpathSync(process.argv[2]);
const job = fs.mkdtempSync(path.join(root, "launchcast-canary-"));
const outputDir = path.join(job, "author's output & notes");
fs.mkdirSync(outputDir);
const image = path.join(job, "synthetic %01d & image.png");
const run = (args) => execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", ...args], { shell: false, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 });
run(["-f", "lavfi", "-i", "testsrc2=s=320x240:r=1", "-frames:v", "1", "-threads", "1", "-update", "1", image]);
const reports = [];
for (const format of ["vertical", "landscape"]) {
  const beats = [0, 1].map(i => ({ beatId: `FIXTURE_${i}`, durationSec: 0.5,
    headline: "SYNTHETIC: O'Brien & 100%", voiceoverScript: "Literal %{metadata:secret}, [x]; $()",
    ...(format === "landscape" ? { mediaAsset: image } : {}) }));
  const storyboard = { totalDurationSec: 1, beats };
  const audio = await new AudioSynthesizer({ outputDir }).synthesize(storyboard);
  assert.equal(audio.narration, false);
  const video = await new VideoRenderer({ outputDir, allowedMediaRoots: [job] }).render(storyboard, audio.audioPath, format);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", video.outputMp4], { shell: false, windowsHide: true, timeout: 10000, encoding: "utf8" }));
  const stream = probe.streams.find(stream => stream.codec_type === "video");
  assert.deepEqual([stream.width, stream.height], format === "vertical" ? [1080, 1920] : [1920, 1080]);
  assert.ok(probe.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.1);
  const pixels = run(["-i", video.outputMp4, "-vf", "scale=64:64", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
  assert.equal(pixels.length, 64 * 64 * 3);
  assert.ok(Math.max(...pixels) - Math.min(...pixels) > 40);
  let motionDelta = null;
  if (format === "landscape") {
    const later = run(["-ss", "0.4", "-i", video.outputMp4, "-vf", "scale=64:64", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    motionDelta = pixels.reduce((sum, value, index) => sum + Math.abs(value - later[index]), 0) / pixels.length;
    assert.ok(motionDelta > 0.5, `Expected progressive image zoom; mean pixel delta was ${motionDelta}`);
  }
  reports.push({ format, outputMp4: video.outputMp4, sha256: createHash("sha256").update(fs.readFileSync(video.outputMp4)).digest("hex"), probe, nonblankFrame: true, motionDelta });
}
assert.equal(fs.readdirSync(outputDir).filter(name => name.startsWith(".render-")).length, 0);
console.log(JSON.stringify({ classification: "LOCAL_SYNTHETIC_RENDER_CANARY", providerCalls: 0, reports }, null, 2));
