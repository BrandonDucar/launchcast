document.addEventListener("DOMContentLoaded", () => {
  let currentRepoData = null;
  let currentStoryboard = null;
  let activeFormat = "vertical";
  let activeMode = "codebase";
  let activeRenderer = "filmcraft";
  let sessionToken;

  async function studioPost(url, payload) {
    if (!sessionToken) {
      const response = await fetch("/api/session", { cache: "no-store" });
      const session = await response.json();
      if (!response.ok || !session.ok) throw new Error(session.error || "Local Studio session unavailable");
      sessionToken = session.token;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-LaunchCast-Session": sessionToken },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) sessionToken = undefined;
    return response;
  }

  // Elements
  const tabCodebaseMode = document.getElementById("tab-codebase-mode");
  const tabRecipeMode = document.getElementById("tab-recipe-mode");
  const sectionCodebaseMode = document.getElementById("section-codebase-mode");
  const sectionRecipeMode = document.getElementById("section-recipe-mode");

  const inputRepoPath = document.getElementById("input-repo-path");
  const inputDocId = document.getElementById("input-doc-id");
  const btnScanCompile = document.getElementById("btn-scan-compile");
  const btnExportSlides = document.getElementById("btn-export-slides");
  const btnRenderVideo = document.getElementById("btn-render-video");

  const recipeSelector = document.getElementById("recipe-selector");
  const btnRefreshRecipes = document.getElementById("btn-refresh-recipes");
  const recipeNameBadge = document.getElementById("recipe-name-badge");
  const recipeTagFormat = document.getElementById("recipe-tag-format");
  const recipeTagDuration = document.getElementById("recipe-tag-duration");
  const recipeTagBeats = document.getElementById("recipe-tag-beats");
  const recipeDesc = document.getElementById("recipe-desc");
  const recipeMappingGrid = document.getElementById("recipe-mapping-grid");
  const btnCompileRecipe = document.getElementById("btn-compile-recipe");
  const btnLoadMapping = document.getElementById("btn-load-mapping");

  const storyboardSection = document.getElementById("storyboard-section");
  const storyboardTitle = document.getElementById("storyboard-title");
  const storyboardPacing = document.getElementById("storyboard-pacing");
  const formatToggles = document.querySelectorAll(".toggle-btn");
  const rendererBtns = document.querySelectorAll(".renderer-btn");

  const outputSection = document.getElementById("output-section");
  const masterVideoPlayer = document.getElementById("master-video-player");
  const outputVideoName = document.getElementById("output-video-name");
  const outStatEngine = document.getElementById("out-stat-engine");
  const outStatRes = document.getElementById("out-stat-res");
  const outStatDur = document.getElementById("out-stat-dur");
  const outStatSize = document.getElementById("out-stat-size");
  const btnDownloadVideo = document.getElementById("btn-download-video");
  const toastContainer = document.getElementById("toast-container");

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // Mode Switcher
  let recipesLoaded = false;
  let availableRecipes = [];
  let currentRecipe = null;

  async function switchMode(mode) {
    activeMode = mode;
    if (mode === "codebase") {
      tabCodebaseMode?.classList?.add("active");
      tabRecipeMode?.classList?.remove("active");
      if (sectionCodebaseMode) sectionCodebaseMode.style.display = "block";
      if (sectionRecipeMode) sectionRecipeMode.style.display = "none";
    } else {
      tabRecipeMode?.classList?.add("active");
      tabCodebaseMode?.classList?.remove("active");
      if (sectionCodebaseMode) sectionCodebaseMode.style.display = "none";
      if (sectionRecipeMode) sectionRecipeMode.style.display = "block";
      if (!recipesLoaded) await loadRecipes();
    }
  }

  tabCodebaseMode?.addEventListener("click", () => switchMode("codebase"));
  tabRecipeMode?.addEventListener("click", () => switchMode("recipe"));

  // Renderer Switcher
  rendererBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      rendererBtns.forEach(b => b.classList?.remove("active"));
      btn.classList?.add("active");
      activeRenderer = btn.dataset.renderer || "filmcraft";
      showToast(`Renderer switched to: ${activeRenderer === "filmcraft" ? "FilmCraft 0.5.0 Timeline" : "Native FFmpeg"}`);
    });
  });

  // Format Toggle
  formatToggles.forEach(btn => {
    btn.addEventListener("click", () => {
      formatToggles.forEach(b => b.classList?.remove("active"));
      btn.classList?.add("active");
      activeFormat = btn.dataset.format;
      showToast(`Switched format to: ${activeFormat.toUpperCase()}`);
    });
  });

  // Dynamic Word Counter
  function attachWordCounters() {
    const cards = document.querySelectorAll(".beat-card");
    cards.forEach(card => {
      const textarea = card.querySelector(".beat-script");
      const counter = card.querySelector(".word-counter");
      if (textarea && counter) {
        textarea.addEventListener("input", () => {
          const count = textarea.value.trim().split(/\s+/).filter(Boolean).length;
          counter.textContent = `${count} words`;
        });
      }
    });
  }
  attachWordCounters();

  // Recipe Engine Integration
  async function loadRecipes() {
    try {
      const res = await fetch("/api/recipes");
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to load recipes");
      availableRecipes = data.recipes || [];
      recipesLoaded = true;

      if (recipeSelector) {
        recipeSelector.innerHTML = "";
        if (availableRecipes.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "No recipes found in docs/recipes";
          recipeSelector.appendChild(opt);
          return;
        }
        availableRecipes.forEach(r => {
          const opt = document.createElement("option");
          opt.value = r.name;
          opt.textContent = `${r.name} (${r.durationSec}s ${r.format})`;
          recipeSelector.appendChild(opt);
        });
        recipeSelector.value = availableRecipes[0].name;
        selectRecipe(availableRecipes[0].name);
      }
      showToast(`Loaded ${availableRecipes.length} creative recipes`);
    } catch (err) {
      console.error(err);
      showToast(`Recipe load error: ${err.message}`);
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function selectRecipe(name) {
    const recipe = availableRecipes.find(r => r.name === name);
    if (!recipe) return;
    currentRecipe = recipe;

    if (recipeNameBadge) recipeNameBadge.textContent = recipe.name;
    if (recipeTagFormat) recipeTagFormat.textContent = recipe.format === "vertical" ? "📱 9:16 Vertical" : "🖥️ 16:9 Landscape";
    if (recipeTagDuration) recipeTagDuration.textContent = `⏱️ ${recipe.durationSec}s`;
    if (recipeTagBeats) recipeTagBeats.textContent = `🎬 ${recipe.beats.length} Beats`;
    if (recipeDesc) recipeDesc.textContent = recipe.description || "Declarative brand reel formula.";

    // Sync active format with recipe
    activeFormat = recipe.format || "vertical";
    formatToggles.forEach(b => {
      if (b.dataset.format === activeFormat) b.classList?.add("active");
      else b.classList?.remove("active");
    });

    // Populate beat role mapping cards
    if (recipeMappingGrid) {
      recipeMappingGrid.innerHTML = "";
      recipe.beats.forEach((b, idx) => {
        const card = document.createElement("div");
        card.className = "recipe-beat-card";
        card.dataset.role = b.role;
        card.innerHTML = `
          <div class="recipe-beat-header">
            <span class="recipe-beat-pill">Beat ${b.index || idx + 1} • ${b.role}</span>
            <span class="recipe-beat-duration">${b.durationSec}s</span>
          </div>
          <div class="recipe-beat-role">${escapeHtml(b.headline)}</div>
          <div class="recipe-beat-preview">"${escapeHtml(b.caption)}"</div>
          ${b.visualDescription ? `<div class="recipe-beat-cue">👁️ ${escapeHtml(b.visualDescription)}</div>` : ""}
          <label style="font-size:0.75rem; color:var(--text-secondary); margin-top:4px;">Local Asset Path (PNG / JPG / WEBP):</label>
          <input type="text" class="recipe-asset-input" data-role="${b.role}" placeholder="c:\\path\\to\\media.jpg">
        `;
        recipeMappingGrid.appendChild(card);
      });
    }
  }

  recipeSelector?.addEventListener("change", e => {
    selectRecipe(e.target.value);
  });

  btnRefreshRecipes?.addEventListener("click", () => {
    loadRecipes();
  });

  btnLoadMapping?.addEventListener("click", () => {
    if (!currentRecipe) return;
    const inputs = document.querySelectorAll(".recipe-asset-input");
    inputs.forEach(input => {
      const role = input.dataset.role;
      input.value = `docs/recipes/mappings/${role}.jpg`;
    });
    showToast("Loaded example role paths. Adjust to your local files.");
  });

  btnCompileRecipe?.addEventListener("click", async () => {
    if (!currentRecipe) {
      showToast("Please select a recipe first");
      return;
    }

    const inputs = document.querySelectorAll(".recipe-asset-input");
    const mediaMap = {};
    let missingRoles = [];

    inputs.forEach(input => {
      const role = input.dataset.role;
      const val = input.value.trim();
      if (!val) missingRoles.push(role);
      else mediaMap[role] = val;
    });

    if (missingRoles.length > 0) {
      showToast(`Missing assets for: ${missingRoles.join(", ")}`);
      return;
    }

    btnCompileRecipe.disabled = true;
    btnCompileRecipe.innerHTML = "<span>⏳</span> Compiling Recipe Storyboard...";

    try {
      const res = await studioPost("/api/recipe/compile", {
        recipeName: currentRecipe.name,
        mediaMap
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      currentStoryboard = data.storyboard;
      renderStoryboard(currentStoryboard);
      showToast(`✅ Recipe compiled: ${currentStoryboard.beats.length} beats (${currentStoryboard.totalDurationSec}s)`);
      storyboardSection.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      console.error(err);
      showToast(`❌ Recipe compile error: ${err.message}`);
    } finally {
      btnCompileRecipe.disabled = false;
      btnCompileRecipe.innerHTML = "<span>⚡</span> Compile Recipe Storyboard";
    }
  });

  // Scan & Compile Action (Codebase Mode)
  btnScanCompile.addEventListener("click", async () => {
    const target = inputRepoPath.value.trim();
    const docId = inputDocId.value.trim();

    if (!target) {
      showToast("Please enter a local repository path");
      return;
    }

    btnScanCompile.disabled = true;
    btnScanCompile.innerHTML = "<span>⏳</span> Scanning Codebase AST...";

    try {
      // 1. Scan
      const scanRes = await studioPost("/api/scan", { target });
      const scanData = await scanRes.json();
      if (!scanData.ok) throw new Error(scanData.error);
      currentRepoData = scanData.repoData;

      // 2. Compile Storyboard
      btnScanCompile.innerHTML = "<span>⚙️</span> Compiling 4-Beat Script...";
      const compileRes = await studioPost("/api/compile", { repoData: currentRepoData, docId });
      const compileData = await compileRes.json();
      if (!compileData.ok) throw new Error(compileData.error);
      currentStoryboard = compileData.storyboard;

      // Update UI with compiled storyboard
      renderStoryboard(currentStoryboard);
      showToast(`✅ Storyboard compiled: ${currentStoryboard.totalWordCount} words (${currentStoryboard.pacingCadence})`);
    } catch (err) {
      console.error(err);
      showToast(`❌ Error: ${err.message}`);
    } finally {
      btnScanCompile.disabled = false;
      btnScanCompile.innerHTML = "<span>⚡</span> Scan Codebase & Compile Storyboard";
    }
  });

  function renderStoryboard(sb) {
    const titleName = sb.projectName || sb.title || currentRecipe?.name || "Broadcast";
    storyboardTitle.textContent = `2. ${titleName} — Broadcast Storyboard`;
    const cadence = sb.pacingCadence || `${(sb.totalWordCount ? (sb.totalWordCount / sb.totalDurationSec).toFixed(1) : 2.4)} w/s`;
    storyboardPacing.textContent = `Pacing: ${cadence} • Target Duration: ${sb.totalDurationSec}s • Beats: ${sb.beats.length}`;

    const cards = document.querySelectorAll(".beat-card");
    sb.beats.forEach((beat, idx) => {
      const card = cards[idx];
      if (card) {
        const headlineEl = card.querySelector(".beat-headline");
        if (headlineEl) headlineEl.value = beat.headline;
        const scriptEl = card.querySelector(".beat-script");
        if (scriptEl) scriptEl.value = beat.voiceoverScript;
        const counterEl = card.querySelector(".word-counter");
        if (counterEl) counterEl.textContent = `${beat.wordCount || beat.voiceoverScript.trim().split(/\s+/).filter(Boolean).length} words`;
      }
    });
  }

  // Export to Google Slides
  btnExportSlides.addEventListener("click", async () => {
    if (!currentStoryboard) {
      buildStoryboardFromDOM();
    }

    btnExportSlides.disabled = true;
    btnExportSlides.innerHTML = "<span>⏳</span> Exporting to Google Slides...";

    try {
      const res = await studioPost("/api/slides/export", { storyboard: currentStoryboard });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Slides export unavailable");
      if (data.ok) {
        showToast("🖼️ Google Slides Storyboard Deck Created!");
        window.open(data.deck.presentationUrl, "_blank");
      }
    } catch (err) {
      showToast(`Export issue: ${err.message}`);
    } finally {
      btnExportSlides.disabled = false;
      btnExportSlides.innerHTML = "<span>🖼️</span> Export to Google Slides Storyboard";
    }
  });

  function buildStoryboardFromDOM() {
    const cards = document.querySelectorAll(".beat-card");
    const beats = [];
    cards.forEach((card, idx) => {
      const headline = card.querySelector(".beat-headline").value;
      const script = card.querySelector(".beat-script").value;
      const words = script.trim().split(/\s+/).filter(Boolean).length;
      beats.push({
        beatId: `BEAT_0${idx + 1}`,
        durationSec: idx === 0 ? 6 : 8,
        headline,
        voiceoverScript: script,
        wordCount: words
      });
    });

    currentStoryboard = {
      title: `${inputRepoPath.value} Launch Reel`,
      projectName: inputRepoPath.value.split(/[\\\/]/).pop(),
      totalDurationSec: 30,
      beats
    };
  }

  // Render Master MP4
  btnRenderVideo.addEventListener("click", async () => {
    if (activeMode === "codebase" || !currentStoryboard) {
      buildStoryboardFromDOM();
    }

    btnRenderVideo.disabled = true;
    const engineLabel = activeRenderer === "filmcraft" ? "FilmCraft 0.5.0" : "FFmpeg";
    btnRenderVideo.innerHTML = `<span>🎬</span> Rendering via ${engineLabel}...`;
    showToast(`Starting ${engineLabel} rendering pipeline...`);

    try {
      const res = await studioPost("/api/render", {
        storyboard: currentStoryboard,
        format: activeFormat,
        renderer: activeRenderer
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const result = data.result;
      outputSection.style.display = "block";
      masterVideoPlayer.src = result.videoUrl;
      masterVideoPlayer.load();
      masterVideoPlayer.play();

      outputVideoName.textContent = result.outputMp4.split(/[\\\/]/).pop();
      if (outStatEngine) outStatEngine.textContent = result.renderer || engineLabel;
      outStatRes.textContent = result.resolution;
      outStatDur.textContent = `${result.durationSec}s`;
      outStatSize.textContent = `${result.fileSizeMb} MB`;
      btnDownloadVideo.href = result.videoUrl;

      outputSection.scrollIntoView({ behavior: "smooth" });
      showToast(`🚀 Master Video Rendered Successfully (${result.renderer || engineLabel})!`);
    } catch (err) {
      console.error(err);
      showToast(`❌ Render Failed: ${err.message}`);
    } finally {
      btnRenderVideo.disabled = false;
      btnRenderVideo.innerHTML = "<span>🎬</span> Compile & Render 30s Launch MP4";
    }
  });
});

