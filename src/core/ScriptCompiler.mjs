/**
 * Compiles messy repository text and launch briefs into an exact 30-second, 4-beat broadcast storyboard.
 */
export class ScriptCompiler {
  constructor(options = {}) {
    this.targetDurationSec = options.targetDurationSec || 30;
    this.wordsPerSecond = 2.4; // Optimal kinetic voiceover cadence
  }

  /**
   * Compiles repo metadata + workspace context into a 4-beat Intermediate Representation (IR).
   * @param {object} repoMetadata - Output from RepoScanner
   * @param {object} [workspaceContext] - Output from WorkspaceConnector
   */
  compile(repoMetadata, workspaceContext = {}) {
    const name = repoMetadata.name || "Open-Source Innovation";
    const tagline = repoMetadata.tagline || repoMetadata.description || "The modern developer toolkit.";
    const topFeatures = (repoMetadata.features || []).slice(0, 3);
    const media = repoMetadata.mediaAssets || [];

    console.log(`[ScriptCompiler] Compiling 30s broadcast storyboard for: "${name}"...`);

    // ─── PASS 1: Extraction & Beat Assignment ──────────────────────────
    const beatsConfig = [
      {
        beatId: "BEAT_01_HOOK",
        name: "The Agony & The Friction",
        startTimeSec: 0,
        endTimeSec: 6,
        durationSec: 6,
        maxWords: 15,
        target: "Name the pain point or status-quo friction."
      },
      {
        beatId: "BEAT_02_MECHANISM",
        name: "The Product Introduction",
        startTimeSec: 6,
        endTimeSec: 14,
        durationSec: 8,
        maxWords: 20,
        target: "Introduce the solution and its core mechanism."
      },
      {
        beatId: "BEAT_03_PROOF",
        name: "Technical Proof in Action",
        startTimeSec: 14,
        endTimeSec: 22,
        durationSec: 8,
        maxWords: 20,
        target: "Demonstrate live features, terminal execution, or UI action."
      },
      {
        beatId: "BEAT_04_CLIMAX",
        name: "The Compounding Payoff & CTA",
        startTimeSec: 22,
        endTimeSec: 30,
        durationSec: 8,
        maxWords: 18,
        target: "Deliver the punchline, open-source link, or call-to-action."
      }
    ];

    // ─── PASS 2: Deterministic Script Compilation ──────────────────────
    const compiledBeats = beatsConfig.map(config => {
      let voiceoverScript = "";
      let headline = "";
      let visualDirective = "";
      let mediaAsset = null;

      switch (config.beatId) {
        case "BEAT_01_HOOK":
          headline = "THE STATUS QUO IS BROKEN";
          voiceoverScript = `Building and launching modern software is fast—until you have to explain it to the world.`;
          visualDirective = "RAPID_CUT_CHAOS_OR_CODE_DIFF";
          mediaAsset = media.find(m => /hero|cover|banner/i.test(m.name))?.path || null;
          break;

        case "BEAT_02_MECHANISM":
          headline = `INTRODUCING ${name.toUpperCase()}`;
          voiceoverScript = `Meet ${name}. ${tagline.replace(/^[a-z]/, c => c.toUpperCase())}`;
          visualDirective = "SMOOTH_ZOOM_OCTOPUS_OR_UI_HUD";
          mediaAsset = media.find(m => /demo|walkthrough|ui|dashboard/i.test(m.name))?.path || null;
          break;

        case "BEAT_03_PROOF":
          headline = topFeatures[0] ? topFeatures[0].title.toUpperCase() : "LIVE TECHNICAL EXECUTION";
          if (topFeatures.length >= 2) {
            voiceoverScript = `It automatically scans your codebase, compiles the narrative into deterministic playbooks, and coordinates execution with zero wasted tokens.`;
          } else {
            voiceoverScript = `Powered by autonomous multi-agent coordination, deterministic AST compilers, and instant verification ledgers.`;
          }
          visualDirective = "TERMINAL_EXECUTION_PULSE_AND_FEATURE_SPLIT";
          mediaAsset = media.find(m => /proof|receipt|terminal|graph/i.test(m.name))?.path || null;
          break;

        case "BEAT_04_CLIMAX":
          headline = "AVAILABLE ON GITHUB TODAY";
          voiceoverScript = `Stop wrestling with manual timelines. Star the repo on GitHub and compile your first launch video in 30 seconds.`;
          visualDirective = "KINETIC_CTA_BADGE_AND_GITHUB_LOGO";
          mediaAsset = media[0]?.path || null;
          break;
      }

      // Calculate word count
      const words = voiceoverScript.split(/\s+/).filter(Boolean);
      const wordCount = words.length;

      return {
        ...config,
        headline,
        voiceoverScript,
        wordCount,
        visualDirective,
        mediaAsset,
        subtitles: this.generateTimedSubtitles(words, config.startTimeSec, config.durationSec)
      };
    });

    const totalWords = compiledBeats.reduce((acc, b) => acc + b.wordCount, 0);

    return {
      title: `${name} — 30-Second Launch Reel`,
      projectName: name,
      tagline,
      totalDurationSec: this.targetDurationSec,
      totalWordCount: totalWords,
      pacingCadence: (totalWords / this.targetDurationSec).toFixed(2) + " words/sec",
      aspectRatios: ["9:16", "16:9"],
      beats: compiledBeats,
      compiledAt: new Date().toISOString()
    };
  }

  /**
   * Distributes words evenly across the beat duration for synchronized kinetic subtitles.
   */
  generateTimedSubtitles(words, startSec, durationSec) {
    if (!words.length) return [];
    const step = durationSec / words.length;
    return words.map((w, i) => ({
      word: w,
      startSec: +(startSec + i * step).toFixed(2),
      endSec: +(startSec + (i + 1) * step).toFixed(2)
    }));
  }
}
