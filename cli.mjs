#!/usr/bin/env node
import { runLaunchCast, RepoScanner, ScriptCompiler } from "./src/index.mjs";
import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
🎬 LaunchCast CLI — Autonomous Repo-to-Broadcast Video Engine

Usage:
  launchcast <target> [options]
  launchcast scan <target>
  launchcast compile <target>
  launchcast ui

Commands:
  <target>          Local path or GitHub URL to scan and compile into video
  scan <target>     Only scan and print extracted technical & media signals
  compile <target>  Scan and compile the 30-second 4-beat storyboard JSON
  ui                Start the interactive local Web Studio on http://localhost:3344

Options:
  --format          "vertical" (1080x1920, default) or "landscape" (1920x1080)
  --slides          Export storyboard directly to Google Slides for team editing
  --publish         Auto-upload to Google Drive, YouTube Shorts, and inject into README
  --farcaster       Broadcast launch cast directly to Farcaster via Neynar
  --channel <name>  Farcaster channel (e.g. dev, launch, build, base; default: dev)
  --doc <docId>     Optional Google Doc ID containing PRD / launch copy

Examples:
  node cli.mjs ../dreamnetopi-hackday
  node cli.mjs https://github.com/BrandonDucar/dreamnetopi-hackday --farcaster --channel launch
  node cli.mjs ui
`);
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "ui") {
    console.log("🌐 Starting LaunchCast Web Studio...");
    const serverProcess = spawn("node", ["server.mjs"], { stdio: "inherit" });
    return;
  }

  if (command === "scan") {
    const target = args[1] || ".";
    const scanner = new RepoScanner(target);
    const data = await scanner.scan();
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (command === "compile") {
    const target = args[1] || ".";
    const scanner = new RepoScanner(target);
    const repoData = await scanner.scan();
    const compiler = new ScriptCompiler();
    const storyboard = compiler.compile(repoData);
    console.log(JSON.stringify(storyboard, null, 2));
    return;
  }

  // Default: Full end-to-end run
  const target = command;
  const format = args.includes("--landscape") ? "landscape" : (args.find(a => a.startsWith("--format="))?.split("=")[1] || "vertical");
  const exportSlides = args.includes("--slides");
  const publish = args.includes("--publish");
  const farcaster = args.includes("--farcaster");
  const channelId = args.find(a => a.startsWith("--channel="))?.split("=")[1] || "dev";

  await runLaunchCast(target, { format, exportSlides, publish, farcaster, channelId });
}

main().catch(err => {
  console.error("❌ [LaunchCast CLI Error]:", err.message);
  process.exit(1);
});
