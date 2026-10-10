import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateRecipe, compileRecipeStoryboard, previewRecipe } from "../src/core/CreativeRecipe.mjs";

const sampleRecipe = {
  name: "coastal-freeze-harvest-reel",
  format: "vertical",
  durationSec: 15,
  beats: [
    { role: "kitchen-prep", headline: "Kitchen Prep", caption: "Behind the scenes at Coastal Freeze Co.", durationSec: 5 },
    { role: "freeze-drying", headline: "Freeze Drying", caption: "Small-batch freeze-drying in Jupiter, Florida.", durationSec: 5 },
    { role: "crisp-slices", headline: "Crisp Slices", caption: "Crisp, simple, and handcrafted.", durationSec: 5 }
  ],
  audio: { kind: "SYNTHETIC_BACKING_TRACK", narration: false }
};

test("CreativeRecipe: validateRecipe accepts valid recipe definition", () => {
  const result = validateRecipe(sampleRecipe);
  assert.equal(result.name, "coastal-freeze-harvest-reel");
  assert.equal(result.beats.length, 3);
});

test("CreativeRecipe: validateRecipe rejects duration mismatches and invalid fields", () => {
  assert.throws(() => validateRecipe({ ...sampleRecipe, durationSec: 20 }), /duration does not match/);
  assert.throws(() => validateRecipe({ ...sampleRecipe, name: "invalid name with spaces" }), /Invalid recipe name/);
  assert.throws(() => validateRecipe({ ...sampleRecipe, format: "square" }), /Recipe format must be vertical or landscape/);
  assert.throws(() => validateRecipe({ ...sampleRecipe, beats: [] }), /between 1 and 8 beats/);
});

test("CreativeRecipe: compileRecipeStoryboard produces valid storyboard from mapped assets", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const asset1 = path.join(root, "photo1.jpg");
  const asset2 = path.join(root, "photo2.jpg");
  const asset3 = path.join(root, "photo3.jpg");
  for (const f of [asset1, asset2, asset3]) {
    fs.writeFileSync(f, "FAKE_IMAGE_DATA");
  }

  const mediaMap = {
    "kitchen-prep": asset1,
    "freeze-drying": asset2,
    "crisp-slices": asset3
  };

  const storyboard = compileRecipeStoryboard(sampleRecipe, mediaMap, [root]);
  assert.equal(storyboard.totalDurationSec, 15);
  assert.equal(storyboard.beats.length, 3);
  assert.equal(storyboard.beats[0].mediaAsset, asset1);
  assert.equal(storyboard.beats[0].voiceoverScript, "Behind the scenes at Coastal Freeze Co.");
});

test("CreativeRecipe: compileRecipeStoryboard fails when required role is missing", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const asset1 = path.join(root, "photo1.jpg");
  fs.writeFileSync(asset1, "FAKE_IMAGE_DATA");

  assert.throws(
    () => compileRecipeStoryboard(sampleRecipe, { "kitchen-prep": asset1 }, [root]),
    /Missing media mapping for recipe role: "freeze-drying"/
  );
});

test("CreativeRecipe: previewRecipe formats time ranges and asset mapping", () => {
  const preview = previewRecipe(sampleRecipe, { "kitchen-prep": "IMG_6087.jpg" });
  assert.equal(preview.totalDurationSec, 15);
  assert.equal(preview.beats[0].timeRange, "0.0s - 5.0s (5s)");
  assert.equal(preview.beats[0].mappedAsset, "IMG_6087.jpg");
  assert.equal(preview.beats[1].timeRange, "5.0s - 10.0s (5s)");
});

test("CreativeRecipe: boundary check for 32-char role and bounded beatId", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const maxRole = "a".repeat(32);
  const validRecipe = {
    name: "boundary-recipe",
    format: "vertical",
    durationSec: 5,
    beats: [
      { role: maxRole, headline: "Max Role", caption: "Caption", durationSec: 5 }
    ]
  };

  assert.equal(validateRecipe(validRecipe).beats[0].role, maxRole);

  // Role > 32 chars must throw
  const overlengthRecipe = {
    ...validRecipe,
    beats: [{ role: "a".repeat(33), headline: "H", caption: "C", durationSec: 5 }]
  };
  assert.throws(() => validateRecipe(overlengthRecipe), /Invalid role/);

  // Compile with 32-char role and verify beatId <= 40 chars
  const asset = path.join(root, "valid.jpg");
  fs.writeFileSync(asset, "DATA");
  const storyboard = compileRecipeStoryboard(validRecipe, { [maxRole]: asset }, [root]);
  assert.equal(storyboard.beats[0].beatId.length <= 40, true);
  assert.equal(/^[A-Za-z0-9_-]{1,40}$/.test(storyboard.beats[0].beatId), true);
});

test("CreativeRecipe: portable roots enforce containment without hardcoded defaults", t => {
  const root1 = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-root1-"));
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-root2-"));
  t.after(() => {
    fs.rmSync(root1, { recursive: true, force: true });
    fs.rmSync(root2, { recursive: true, force: true });
  });

  const asset1 = path.join(root1, "asset1.jpg");
  const asset2 = path.join(root2, "asset2.jpg");
  fs.writeFileSync(asset1, "DATA1");
  fs.writeFileSync(asset2, "DATA2");

  const recipe = {
    name: "portable-recipe",
    format: "vertical",
    durationSec: 5,
    beats: [{ role: "beat1", headline: "H", caption: "C", durationSec: 5 }]
  };

  // Rejects asset2 when only root1 is allowed
  assert.throws(
    () => compileRecipeStoryboard(recipe, { beat1: asset2 }, [root1]),
    /Input is outside the allowed roots/
  );

  // Accepts asset2 when root2 is explicitly allowed
  const compiled = compileRecipeStoryboard(recipe, { beat1: asset2 }, [root2]);
  assert.equal(compiled.beats[0].mediaAsset, asset2);
});
