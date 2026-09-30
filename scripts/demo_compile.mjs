import path from "node:path";
import { runLaunchCast } from "../src/index.mjs";

async function runDemo() {
  const targetRepo = path.resolve("..", "dreamnetopi-hackday");
  console.log(`\n============================================================`);
  console.log(`🎬 LAUNCHCAST DEMO: REPO-TO-BROADCAST 30s COMPILER`);
  console.log(`   Scanning: ${targetRepo}`);
  console.log(`============================================================\n`);

  const result = await runLaunchCast(targetRepo, {
    format: "vertical", // 1080x1920 Shorts/TikTok
    exportSlides: true,
    publish: false // set to true to trigger Drive & YouTube upload
  });

  console.log("------------------------------------------------------------");
  console.log("🏆 COMPILED 4-BEAT STORYBOARD:");
  result.storyboard.beats.forEach((b, i) => {
    console.log(`\n[Beat ${i + 1}] (${b.startTimeSec}s - ${b.endTimeSec}s) ${b.headline}`);
    console.log(`Voiceover: "${b.voiceoverScript}"`);
    console.log(`Directive: ${b.visualDirective}`);
  });
  console.log("\n------------------------------------------------------------");
  console.log(`📹 Output Video: ${result.videoResult.outputMp4}`);
  console.log(`⏱️ Compilation Time: ${result.durationTotalSec}s`);
  console.log("============================================================\n");
}

runDemo().catch(console.error);
