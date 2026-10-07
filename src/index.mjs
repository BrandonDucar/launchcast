import { RepoScanner } from "./core/RepoScanner.mjs";
import { WorkspaceConnector } from "./core/WorkspaceConnector.mjs";
import { ScriptCompiler } from "./core/ScriptCompiler.mjs";
import { AudioSynthesizer } from "./core/AudioSynthesizer.mjs";
import { VideoRenderer } from "./core/VideoRenderer.mjs";
import { DistributionEngine, distributeVideo } from "./core/DistributionEngine.mjs";
import { FarcasterBroadcaster } from "./core/FarcasterBroadcaster.mjs";

export {
  RepoScanner,
  WorkspaceConnector,
  ScriptCompiler,
  AudioSynthesizer,
  VideoRenderer,
  DistributionEngine,
  FarcasterBroadcaster
};

/**
 * End-to-end runner that executes the entire LaunchCast pipeline.
 */
export async function runLaunchCast(targetPathOrUrl, options = {}) {
  console.log("\n[LaunchCast Engine] Starting local launch compilation...");
  const startTime = Date.now();

  // 1. Scan Repository
  const scanner = new RepoScanner(targetPathOrUrl);
  const repoData = await scanner.scan();
  console.log(`✅ [1/5] Repository Scanned: ${repoData.name} (${repoData.features.length} features, ${repoData.mediaAssets.length} media assets)`);

  // 2. Ingest Workspace Context (Google Docs, Drive)
  const workspace = new WorkspaceConnector(options);
  await workspace.init();
  const launchBrief = await workspace.fetchLaunchBrief(options.docId);
  console.log(`✅ [2/5] Workspace Ingested: ${launchBrief.title}`);

  // 3. Compile 4-Beat Storyboard
  const compiler = new ScriptCompiler(options);
  const storyboard = compiler.compile(repoData, launchBrief);
  console.log(`✅ [3/5] Storyboard Compiled: ${storyboard.beats.length} beats, ${storyboard.totalWordCount} words (${storyboard.pacingCadence})`);

  // (Optional) Export to Google Slides for collaborative team editing
  if (options.exportSlides) {
    const slidesDeck = await workspace.exportToGoogleSlides(storyboard);
    console.log(`🖼️ [Google Slides] Storyboard live at: ${slidesDeck.presentationUrl}`);
  }

  // 4. Synthesize Audio
  const synthesizer = new AudioSynthesizer(options);
  const audio = await synthesizer.synthesize(storyboard);
  console.log(`✅ [4/5] Audio Track Ready: ${audio.audioPath}`);

  // 5. Render Master Broadcast Video (FFmpeg)
  const renderer = new VideoRenderer({ ...options, allowedMediaRoots: [scanner.localPath] });
  const format = options.format || "vertical"; // or "landscape"
  const videoResult = await renderer.render(storyboard, audio.audioPath, format);
  console.log(`✅ [5/5] Master Video Rendered: ${videoResult.outputMp4} (${videoResult.fileSizeMb} MB)`);

  // 6. Distribution (Google Drive, YouTube, Farcaster, GitHub README PR)
  const distributionResult = await distributeVideo(videoResult.outputMp4, storyboard, {
    ...options,
    repoUrl: targetPathOrUrl.startsWith("http") ? targetPathOrUrl : undefined,
    localPath: targetPathOrUrl.startsWith("http") ? undefined : scanner.localPath
  });

  const durationTotal = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[LaunchCast Engine] Render complete in ${durationTotal}s. Video: ${videoResult.outputMp4}. Distribution: ${distributionResult.status}\n`);

  return {
    repoData,
    storyboard,
    videoResult,
    distributionResult,
    durationTotalSec: durationTotal
  };
}
