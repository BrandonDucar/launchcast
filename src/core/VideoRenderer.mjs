import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  boundedNumber, validateBeat, validateStoryboard, prepareOutputDir, outputDestination,
  regularInput, requireArtifact, runProcess, removeJob
} from "./ProcessSafety.mjs";

const FFMPEG = ["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-max_alloc", "67108864", "-filter_threads", "2"];

export class VideoRenderer {
  constructor(options = {}) {
    this.fps = boundedNumber(options.fps ?? 30, "FPS", 1, 60);
    if (!Number.isInteger(this.fps)) throw new Error("FPS must be an integer");
    this.outputDir = prepareOutputDir(options.outputDir || path.join(process.cwd(), "output"));
    this.mediaRoots = (options.allowedMediaRoots || [process.cwd()]).map(root => fs.realpathSync(root));
    this.audioRoots = (options.allowedAudioRoots || [this.outputDir]).map(root => fs.realpathSync(root));
  }

  async render(storyboard, audioPath, format = "vertical") {
    const duration = validateStoryboard(storyboard);
    if (!["vertical", "landscape"].includes(format)) throw new Error("Invalid video format");
    const audio = regularInput(audioPath, this.audioRoots, 64 * 1024 * 1024);
    const isVertical = format === "vertical";
    const [width, height] = isVertical ? [1080, 1920] : [1920, 1080];
    const outputMp4 = outputDestination(this.outputDir, path.join(this.outputDir, `launch_reel_${format}_${randomUUID()}.mp4`));
    const job = fs.mkdtempSync(path.join(this.outputDir, ".render-"));
    try {
      const segments = [];
      for (let i = 0; i < storyboard.beats.length; i++) {
        const name = `segment-${i}.mp4`;
        await this.renderSegment(storyboard.beats[i], path.join(job, name), width, height, isVertical);
        segments.push(name);
      }
      // The manifest contains only generated relative basenames, never caller paths.
      fs.writeFileSync(path.join(job, "concat.txt"), segments.map(name => `file '${name}'`).join("\n"), { flag: "wx" });
      runProcess("ffmpeg", [...FFMPEG, "-protocol_whitelist", "file", "-f", "concat", "-safe", "1", "-i", "concat.txt", "-c", "copy", "merged.mp4"], { cwd: job });
      runProcess("ffmpeg", [...FFMPEG, "-protocol_whitelist", "file", "-i", "merged.mp4", "-protocol_whitelist", "file", "-f", "wav", "-i", audio,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(duration), "-shortest", "final.mp4"], { cwd: job });
      requireArtifact(path.join(job, "final.mp4"));
      fs.copyFileSync(path.join(job, "final.mp4"), outputMp4, fs.constants.COPYFILE_EXCL);
      const stats = requireArtifact(outputMp4);
      return { outputMp4, format, resolution: `${width}x${height}`, durationSec: duration, fileSizeMb: (stats.size / (1024 * 1024)).toFixed(2) };
    } finally {
      removeJob(this.outputDir, job);
    }
  }

  mediaInput(mediaAsset) {
    if (mediaAsset == null || mediaAsset === "") return null;
    if (typeof mediaAsset !== "string") throw new Error("Invalid media asset");
    // Unsupported repository assets (SVG/video) retain the color-background fallback.
    if (!/\.(png|jpe?g|webp)$/i.test(mediaAsset)) return null;
    const file = regularInput(mediaAsset, this.mediaRoots, 20 * 1024 * 1024);
    const header = Buffer.alloc(12);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    const decoder = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : header[0] === 255 && header[1] === 216 && header[2] === 255 ? "mjpeg"
      : header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    if (!decoder) throw new Error("Unsupported media signature");
    return { file, decoder };
  }

  async renderSegment(beat, outputPath, width, height, isVertical) {
    validateBeat(beat);
    if (!((width === 1080 && height === 1920 && isVertical === true) || (width === 1920 && height === 1080 && isVertical === false))) {
      throw new Error("Invalid render dimensions");
    }
    const destination = outputDestination(this.outputDir, outputPath);
    const media = this.mediaInput(beat.mediaAsset);
    const job = fs.mkdtempSync(path.join(this.outputDir, ".render-"));
    try {
      for (const [file, text] of [["badge.txt", `LAUNCHCAST - BEAT ${beat.beatId}`], ["headline.txt", beat.headline], ["script.txt", beat.voiceoverScript.slice(0, 110)]]) {
        fs.writeFileSync(path.join(job, file), text, { encoding: "utf8", flag: "wx" });
      }
      const input = media
        ? ["-protocol_whitelist", "file", "-f", "image2", "-pattern_type", "none", "-c:v", media.decoder, "-loop", "1", "-framerate", String(this.fps), "-i", media.file]
        : ["-f", "lavfi", "-i", `color=c=0x07090e:s=${width}x${height}:r=${this.fps}:d=${beat.durationSec}`];
      // Untrusted copy is literal UTF-8, never filter syntax or expansions.
      const filters = [
        `scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`,
        `zoompan=z='min(1+on*0.0008,1.15)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${this.fps}`,
        `drawbox=x=0:y=0:w=${width}:h=${height}:color=black@0.45:t=fill`,
        `drawtext=textfile=badge.txt:expansion=none:fontcolor=0x00f2fe:fontsize=${isVertical ? 32 : 24}:x=(w-text_w)/2:y=${isVertical ? 180 : 80}`,
        `drawtext=textfile=headline.txt:expansion=none:fontcolor=white:fontsize=${isVertical ? 56 : 46}:x=(w-text_w)/2:y=${isVertical ? 250 : 130}`,
        `drawtext=textfile=script.txt:expansion=none:fontcolor=0x94a3b8:fontsize=${isVertical ? 36 : 28}:x=(w-text_w)/2:y=${isVertical ? height - 320 : height - 160}`,
        "format=yuv420p"
      ];
      runProcess("ffmpeg", [...FFMPEG, ...input, "-vf", filters.join(","), "-t", String(beat.durationSec), "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-pix_fmt", "yuv420p", "segment.mp4"], { cwd: job });
      requireArtifact(path.join(job, "segment.mp4"));
      fs.copyFileSync(path.join(job, "segment.mp4"), destination, fs.constants.COPYFILE_EXCL);
    } finally {
      removeJob(this.outputDir, job);
    }
  }
}
