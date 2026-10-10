import fs from "node:fs";
import path from "node:path";
import { boundedNumber, regularInput, isWithin, validateStoryboard } from "./ProcessSafety.mjs";

/**
 * CreativeRecipe defines a declarative blueprint for repeatable video reels.
 * Separates brand narrative and pacing rules from concrete local assets.
 */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") throw new Error("Invalid recipe object");
  if (typeof recipe.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(recipe.name)) {
    throw new Error("Invalid recipe name");
  }
  if (!["vertical", "landscape"].includes(recipe.format)) {
    throw new Error("Recipe format must be vertical or landscape");
  }
  if (!Array.isArray(recipe.beats) || recipe.beats.length < 1 || recipe.beats.length > 8) {
    throw new Error("Recipe must specify between 1 and 8 beats");
  }
  let sumDuration = 0;
  for (let i = 0; i < recipe.beats.length; i++) {
    const beat = recipe.beats[i];
    if (typeof beat.role !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(beat.role)) {
      throw new Error(`Invalid role for beat ${i + 1}`);
    }
    boundedNumber(beat.durationSec, `Beat ${i + 1} duration`, 0.5, 30);
    sumDuration += beat.durationSec;
    for (const field of ["headline", "caption"]) {
      if (typeof beat[field] !== "string" || beat[field].length > 512 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(beat[field])) {
        throw new Error(`Invalid ${field} for beat ${i + 1}`);
      }
    }
  }
  const total = boundedNumber(recipe.durationSec, "Recipe total duration", 1, 120);
  if (Math.abs(sumDuration - total) > 0.01) {
    throw new Error("Recipe total duration does not match beat durations");
  }
  return recipe;
}

export function compileRecipeStoryboard(recipe, mediaMap, allowedRoots = [process.cwd()]) {
  validateRecipe(recipe);
  if (!mediaMap || typeof mediaMap !== "object") throw new Error("Media mapping required");

  const beats = [];
  for (let i = 0; i < recipe.beats.length; i++) {
    const rBeat = recipe.beats[i];
    const assetPath = mediaMap[rBeat.role] || mediaMap[String(i)] || mediaMap[i];
    if (!assetPath) {
      throw new Error(`Missing media mapping for recipe role: "${rBeat.role}"`);
    }

    const resolved = regularInput(assetPath, allowedRoots, 25 * 1024 * 1024);
    // Bounded beatId to 40 characters maximum, adhering strictly to validateStoryboard
    const beatId = `b${i + 1}_${rBeat.role}`.slice(0, 40);
    beats.push({
      beatId,
      headline: rBeat.headline,
      voiceoverScript: rBeat.caption,
      durationSec: rBeat.durationSec,
      mediaAsset: resolved
    });
  }

  const storyboard = {
    totalDurationSec: recipe.durationSec,
    beats
  };

  // Downstream validation check against ProcessSafety
  validateStoryboard(storyboard);
  return storyboard;
}

export function previewRecipe(recipe, mediaMap = {}) {
  validateRecipe(recipe);
  let curSec = 0;
  const beatsPreview = recipe.beats.map((b, i) => {
    const start = curSec;
    const end = curSec + b.durationSec;
    curSec = end;
    return {
      index: i + 1,
      role: b.role,
      timeRange: `${start.toFixed(1)}s - ${end.toFixed(1)}s (${b.durationSec}s)`,
      headline: b.headline,
      caption: b.caption,
      mappedAsset: mediaMap[b.role] || null
    };
  });

  return {
    recipeName: recipe.name,
    format: recipe.format,
    totalDurationSec: recipe.durationSec,
    beats: beatsPreview
  };
}
