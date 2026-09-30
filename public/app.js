document.addEventListener("DOMContentLoaded", () => {
  let currentRepoData = null;
  let currentStoryboard = null;
  let activeFormat = "vertical";

  // Elements
  const inputRepoPath = document.getElementById("input-repo-path");
  const inputDocId = document.getElementById("input-doc-id");
  const btnScanCompile = document.getElementById("btn-scan-compile");
  const btnExportSlides = document.getElementById("btn-export-slides");
  const btnRenderVideo = document.getElementById("btn-render-video");

  const storyboardSection = document.getElementById("storyboard-section");
  const storyboardTitle = document.getElementById("storyboard-title");
  const storyboardPacing = document.getElementById("storyboard-pacing");
  const formatToggles = document.querySelectorAll(".toggle-btn");

  const outputSection = document.getElementById("output-section");
  const masterVideoPlayer = document.getElementById("master-video-player");
  const outputVideoName = document.getElementById("output-video-name");
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

  // Format Toggle
  formatToggles.forEach(btn => {
    btn.addEventListener("click", () => {
      formatToggles.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
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

  // Scan & Compile Action
  btnScanCompile.addEventListener("click", async () => {
    const target = inputRepoPath.value.trim();
    const docId = inputDocId.value.trim();

    if (!target) {
      showToast("Please enter a GitHub URL or local repo path");
      return;
    }

    btnScanCompile.disabled = true;
    btnScanCompile.innerHTML = "<span>⏳</span> Scanning Codebase AST...";

    try {
      // 1. Scan
      const scanRes = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      const scanData = await scanRes.json();
      if (!scanData.ok) throw new Error(scanData.error);
      currentRepoData = scanData.repoData;

      // 2. Compile Storyboard
      btnScanCompile.innerHTML = "<span>⚙️</span> Compiling 4-Beat Script...";
      const compileRes = await fetch("/api/compile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoData: currentRepoData, docId })
      });
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
    storyboardTitle.textContent = `2. ${sb.projectName} — 4-Beat Broadcast Storyboard`;
    storyboardPacing.textContent = `Pacing: ${sb.pacingCadence} • Target Duration: ${sb.totalDurationSec}s • Word Count: ${sb.totalWordCount}`;

    const cards = document.querySelectorAll(".beat-card");
    sb.beats.forEach((beat, idx) => {
      const card = cards[idx];
      if (card) {
        card.querySelector(".beat-headline").value = beat.headline;
        card.querySelector(".beat-script").value = beat.voiceoverScript;
        card.querySelector(".word-counter").textContent = `${beat.wordCount} words`;
      }
    });
  }

  // Export to Google Slides
  btnExportSlides.addEventListener("click", async () => {
    if (!currentStoryboard) {
      // Build storyboard from current card inputs
      buildStoryboardFromDOM();
    }

    btnExportSlides.disabled = true;
    btnExportSlides.innerHTML = "<span>⏳</span> Exporting to Google Slides...";

    try {
      const res = await fetch("/api/slides/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboard: currentStoryboard })
      });
      const data = await res.json();
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
    buildStoryboardFromDOM();

    btnRenderVideo.disabled = true;
    btnRenderVideo.innerHTML = "<span>🎬</span> Rendering Master 1080p MP4 via FFmpeg...";
    showToast("Starting FFmpeg synthesis & kinetic subtitle burn...");

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyboard: currentStoryboard, format: activeFormat })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      const result = data.result;
      outputSection.style.display = "block";
      masterVideoPlayer.src = result.videoUrl;
      masterVideoPlayer.load();
      masterVideoPlayer.play();

      outputVideoName.textContent = result.outputMp4.split(/[\\\/]/).pop();
      outStatRes.textContent = result.resolution;
      outStatDur.textContent = `${result.durationSec}s`;
      outStatSize.textContent = `${result.fileSizeMb} MB`;
      btnDownloadVideo.href = result.videoUrl;

      outputSection.scrollIntoView({ behavior: "smooth" });
      showToast("🚀 Master Launch Video Rendered Successfully!");
    } catch (err) {
      console.error(err);
      showToast(`❌ Render Failed: ${err.message}`);
    } finally {
      btnRenderVideo.disabled = false;
      btnRenderVideo.innerHTML = "<span>🎬</span> Compile & Render 30s Launch MP4";
    }
  });
});
