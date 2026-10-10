import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateRecipe, compileRecipeStoryboard, previewRecipe } from "../src/core/CreativeRecipe.mjs";
import { AudioSynthesizer } from "../src/core/AudioSynthesizer.mjs";
import { FilmCraftRenderer } from "../src/core/FilmCraftRenderer.mjs";
import { prepareOutputDir } from "../src/core/ProcessSafety.mjs";

const [cliPath, recipePath, mappingPath, outputDir, ...extraRoots] = process.argv.slice(2);

if (!cliPath || !recipePath || !mappingPath || !outputDir) {
  console.error("Usage: node scripts/render-recipe.mjs <filmcraft-cli.exe> <recipe.json> <mapping.json> <output-dir> [allowed-root ...]");
  process.exit(1);
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

try {
  const resolvedCli = path.resolve(cliPath);
  if (!fs.existsSync(resolvedCli)) {
    throw new Error(`FilmCraft CLI executable not found at: ${resolvedCli}`);
  }

  const recipeRaw = JSON.parse(fs.readFileSync(path.resolve(recipePath), "utf8"));
  const recipe = validateRecipe(recipeRaw);

  const mediaMap = JSON.parse(fs.readFileSync(path.resolve(mappingPath), "utf8"));

  // Build allowed roots covering asset parent directories plus explicit roots
  const assetDirs = Object.values(mediaMap)
    .filter(p => typeof p === "string")
    .map(p => path.dirname(path.resolve(p)));
  const allowedRoots = Array.from(new Set([
    process.cwd(),
    path.dirname(path.resolve(mappingPath)),
    ...assetDirs,
    ...extraRoots.map(r => path.resolve(r))
  ]));

  const preparedOutput = prepareOutputDir(path.resolve(outputDir));

  console.log(`[RecipeRenderer] Loaded recipe: "${recipe.name}" (${recipe.format}, ${recipe.durationSec}s, ${recipe.beats.length} beats)`);

  // 1. Compile Storyboard
  const storyboard = compileRecipeStoryboard(recipe, mediaMap, allowedRoots);

  // 2. Pre-flight integrity check: record source hashes
  const sourceHashes = {};
  for (const beat of storyboard.beats) {
    const assetFile = beat.mediaAsset.file || beat.mediaAsset;
    sourceHashes[assetFile] = sha256(assetFile);
  }

  // 3. Audio Synthesis
  console.log(`[RecipeRenderer] Synthesizing backing audio track (${recipe.durationSec}s)...`);
  const synthesizer = new AudioSynthesizer({ outputDir: preparedOutput });
  const audio = await synthesizer.synthesize(storyboard);

  // 4. Render Video via FilmCraft
  console.log(`[RecipeRenderer] Rendering video with FilmCraft 0.5.0 (burned captions enabled)...`);
  const renderer = new FilmCraftRenderer({
    filmcraftCli: resolvedCli,
    outputDir: preparedOutput,
    allowedMediaRoots: allowedRoots
  });

  const renderResult = await renderer.render(storyboard, audio.audioPath, recipe.format, {
    preserveProject: true
  });

  // 5. Post-render integrity verification
  for (const [filePath, expectedHash] of Object.entries(sourceHashes)) {
    const currentHash = sha256(filePath);
    if (currentHash !== expectedHash) {
      throw new Error(`Source asset was mutated during render: ${filePath}`);
    }
  }

  // 6. Audit Receipt
  const receipt = {
    schema: "launchcast.creative-recipe-render.v1",
    createdAt: new Date().toISOString(),
    recipeName: recipe.name,
    recipeFormat: recipe.format,
    totalDurationSec: recipe.durationSec,
    beats: recipe.beats.map((b, i) => ({
      index: i + 1,
      role: b.role,
      headline: b.headline,
      caption: b.caption,
      durationSec: b.durationSec,
      sourceAsset: storyboard.beats[i].mediaAsset.file || storyboard.beats[i].mediaAsset,
      sourceSha256: sourceHashes[storyboard.beats[i].mediaAsset.file || storyboard.beats[i].mediaAsset]
    })),
    render: renderResult,
    filmcraftCliSha256: sha256(resolvedCli),
    sourceIntegrityVerified: true,
    socialPublicationDraft: {
      postType: recipe.format === "vertical" ? "reel" : "video",
      headline: recipe.beats[0].headline,
      suggestedCaption: recipe.beats.map(b => b.caption).join(" ")
    }
  };

  const receiptPath = `${renderResult.outputMp4}.receipt.json`;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8" });

  console.log(`\n============================================================`);
  console.log(`✅ RECIPE RENDER COMPLETE`);
  console.log(`============================================================`);
  console.log(`Output MP4  : ${renderResult.outputMp4}`);
  console.log(`Dimensions  : ${renderResult.width}x${renderResult.height} (${recipe.format})`);
  console.log(`Duration    : ${renderResult.durationSec}s`);
  console.log(`File Size   : ${(renderResult.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`SHA-256     : ${renderResult.sha256}`);
  console.log(`Receipt     : ${receiptPath}`);
  console.log(`Project     : ${renderResult.projectBundle || "none"}`);
  console.log(`============================================================\n`);

} catch (err) {
  console.error(`[RecipeRenderer] Render failed:`, err.message);
  process.exitCode = 1;
}
