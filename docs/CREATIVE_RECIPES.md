# Creative Recipe Engine

## Overview

The Creative Recipe engine (`src/core/CreativeRecipe.mjs`) provides declarative blueprints for repeatable, brand-aligned video reels using FilmCraft and LaunchCast. It decouples creative pacing, narrative beats, and brand constraints from local filesystem assets.

## Core Concepts

1. **Recipe Schema (`launchcast.creative-recipe.v1`)**:
   - `name`: Alphanumeric slug identifier.
   - `format`: `"vertical"` (1080x1920) or `"landscape"` (1920x1080).
   - `durationSec`: Total reel duration (bounded between 1s and 120s).
   - `beats`: Array of 1 to 8 narrative beats.
     - `role`: Semantic identifier (e.g., `kitchen-prep`, `freeze-drying`, `crisp-slices`).
     - `durationSec`: Exact beat duration in seconds (sum must equal total duration).
     - `headline`: Screen title / beat headline.
     - `caption`: Screen caption / voiceover narration text.

2. **Validation & Safety Rules**:
   - Strict duration validation: Beat durations must sum exactly to `durationSec`.
   - Role matching: All roles must be alphanumeric slugs.
   - Bounded strings: Headline and caption strings are bounded to 512 characters and reject control characters.
   - Path containment: Mapped assets must reside strictly within allowed media roots.

3. **Compiler & Preview**:
   - `compileRecipeStoryboard(recipe, mediaMap, allowedRoots)`: Maps concrete media paths to storyboard beats and returns a fully qualified LaunchCast storyboard.
   - `previewRecipe(recipe, mediaMap)`: Produces a high-level timeline preview of beats and asset mapping without requiring physical files on disk.

## Usage

### Previewing a Recipe
```bash
node scripts/compile-recipe.mjs docs/recipes/coastal-freeze-harvest-reel.recipe.json
```

### Compiling with Concrete Assets
```bash
node scripts/compile-recipe.mjs docs/recipes/coastal-freeze-harvest-reel.recipe.json asset-map.json
```
