import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AudioSynthesizer } from "../src/core/AudioSynthesizer.mjs";
import { FilmCraftRenderer } from "../src/core/FilmCraftRenderer.mjs";

const [cli, inputRoot, outputRoot, ...photos] = process.argv.slice(2);
if (!cli || !inputRoot || !outputRoot || photos.length < 1 || photos.length > 8) {
  console.error("Usage: node scripts/filmcraft-reel.mjs <filmcraft-cli.exe> <approved-input-root> <output-root> <photo> [photo ...] (1-8 photos)");
  process.exit(1);
}

const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
try {
  const renderer = new FilmCraftRenderer({
    filmcraftCli: path.resolve(cli), outputDir: outputRoot, allowedMediaRoots: [inputRoot]
  });
  // Validate inputs before starting either media subprocess.
  const inputs = photos.map(photo => renderer.mediaInput(photo));
  if (inputs.some(input => !input)) throw new Error("Every photo must be JPEG, PNG, or WebP");
  const before = inputs.map(input => hash(input.file));
  const storyboard = {
    totalDurationSec: photos.length * 5,
    beats: photos.map((photo, i) => ({
      beatId: `photo_${i + 1}`, headline: "", voiceoverScript: "",
      durationSec: 5, mediaAsset: photo
    }))
  };
  const audio = await new AudioSynthesizer({ outputDir: outputRoot }).synthesize(storyboard);
  const result = await renderer.render(storyboard, audio.audioPath, "vertical", { preserveProject: true });
  const sourceUnchanged = inputs.every((input, i) => hash(input.file) === before[i]);
  if (!sourceUnchanged) throw new Error("Source changed during render; review required");
  const receipt = {
    schema: "launchcast.filmcraft-local-render.v1", createdAt: new Date().toISOString(),
    ...result, executableSha256: hash(path.resolve(cli)), sourceSha256: before,
    sourceUnchanged, audioKind: audio.kind, narration: false,
    visuallyReviewed: false, uploaded: false, published: false
  };
  const receiptPath = `${result.outputMp4}.receipt.json`;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
