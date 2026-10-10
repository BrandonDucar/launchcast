import fs from "node:fs";
import path from "node:path";
import { validateRecipe, compileRecipeStoryboard, previewRecipe } from "../src/core/CreativeRecipe.mjs";

const [recipePath, mappingJsonPath] = process.argv.slice(2);

if (!recipePath) {
  console.error("Usage: node scripts/compile-recipe.mjs <recipe.json> [asset-mapping.json]");
  process.exit(1);
}

try {
  const recipe = JSON.parse(fs.readFileSync(path.resolve(recipePath), "utf8"));
  validateRecipe(recipe);

  let mediaMap = {};
  if (mappingJsonPath) {
    mediaMap = JSON.parse(fs.readFileSync(path.resolve(mappingJsonPath), "utf8"));
  }

  const preview = previewRecipe(recipe, mediaMap);
  console.log("=== CREATIVE RECIPE PREVIEW ===");
  console.log(JSON.stringify(preview, null, 2));

  if (mappingJsonPath) {
    // If mappings provided, compile full storyboard
    const storyboard = compileRecipeStoryboard(recipe, mediaMap, [process.cwd(), "C:/Users/brand/.antigravity/dream-net", "C:/Users/brand/.dreamnet"]);
    console.log("\n=== COMPILED STORYBOARD ===");
    console.log(JSON.stringify(storyboard, null, 2));
  }
} catch (err) {
  console.error("Recipe validation/compilation error:", err.message);
  process.exitCode = 1;
}
