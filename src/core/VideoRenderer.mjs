import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Composites storyboard beats, screenshots, kinetic subtitles, and audio into broadcast MP4.
 */
export class VideoRenderer {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(process.cwd(), "output");
    this.fps = options.fps || 30;
    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  /**
   * Renders the complete 30-second launch video.
   * @param {object} storyboard - The 4-beat compiled storyboard
   * @param {string} audioPath - Path to master audio track
   * @param {string} [format="vertical"] - "vertical" (1080x1920) or "landscape" (1920x1080)
   */
  async render(storyboard, audioPath, format = "vertical") {
    const isVertical = format === "vertical";
    const width = isVertical ? 1080 : 1920;
    const height = isVertical ? 1920 : 1080;
    const outputMp4 = path.join(this.outputDir, `launch_reel_${format}_${Date.now()}.mp4`);

    console.log(`\n[VideoRenderer] 🎬 Starting FFmpeg Render: ${width}x${height} (${format.toUpperCase()})...`);

    // Create individual beat segments
    const segmentPaths = [];
    for (let i = 0; i < storyboard.beats.length; i++) {
      const beat = storyboard.beats[i];
      const segPath = path.join(this.outputDir, `seg_${i}_${Date.now()}.mp4`);
      await this.renderSegment(beat, segPath, width, height, isVertical);
      segmentPaths.push(segPath);
    }

    // Concatenate segments
    const concatListFile = path.join(this.outputDir, `concat_${Date.now()}.txt`);
    const fileContent = segmentPaths.map(p => `file '${p.replace(/\\/g, "/")}'`).join("\n");
    fs.writeFileSync(concatListFile, fileContent, "utf8");

    const tempMergedVideo = path.join(this.outputDir, `merged_video_${Date.now()}.mp4`);
    const concatCmd = `ffmpeg -y -f concat -safe 0 -i "${concatListFile}" -c copy "${tempMergedVideo}"`;
    execSync(concatCmd, { stdio: "ignore" });

    // Final mux with master audio
    console.log(`[VideoRenderer] Muxing audio track and rendering final master MP4...`);
    const muxCmd = `ffmpeg -y -i "${tempMergedVideo}" -i "${audioPath}" -c:v copy -c:a aac -b:a 192k -shortest "${outputMp4}"`;
    execSync(muxCmd, { stdio: "ignore" });

    // Cleanup temporary segment files
    try {
      fs.unlinkSync(concatListFile);
      fs.unlinkSync(tempMergedVideo);
      for (const seg of segmentPaths) fs.unlinkSync(seg);
    } catch (e) {}

    const stats = fs.statSync(outputMp4);
    const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`✅ [VideoRenderer] Launch Video Rendered: ${outputMp4} (${sizeMb} MB)`);

    return {
      outputMp4,
      format,
      resolution: `${width}x${height}`,
      durationSec: storyboard.totalDurationSec,
      fileSizeMb: sizeMb
    };
  }

  /**
   * Renders a single beat segment with kinetic motion and styled typography.
   */
  async renderSegment(beat, outputPath, width, height, isVertical) {
    const duration = beat.durationSec || 7;
    const totalFrames = duration * this.fps;

    // Background: Color gradient or image asset
    let inputClause = `-f lavfi -i "color=c=0x07090e:s=${width}x${height}:d=${duration}"`;
    if (beat.mediaAsset && fs.existsSync(beat.mediaAsset) && /\.(png|jpg|webp)$/i.test(beat.mediaAsset)) {
      try {
        const head = fs.readFileSync(beat.mediaAsset, { encoding: "utf8" }).slice(0, 60);
        if (!head.includes("<svg")) {
          inputClause = `-loop 1 -t ${duration} -i "${beat.mediaAsset}"`;
        }
      } catch (e) {
        inputClause = `-loop 1 -t ${duration} -i "${beat.mediaAsset}"`;
      }
    }

    // Sanitize text for FFmpeg drawtext
    const cleanHeadline = (beat.headline || "").replace(/['":\\]/g, "");
    const cleanScript = (beat.voiceoverScript || "").replace(/['":\\]/g, "").slice(0, 110);
    const badgeText = `ONESHOT VIDEO • BEAT ${beat.beatId.slice(0, 7)}`;

    // Build FFmpeg video filters
    const vfParts = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `zoompan=z='min(zoom+0.0008,1.15)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${this.fps}`,
      // Vignette & dark glass overlay
      `drawbox=x=0:y=0:w=${width}:h=${height}:color=black@0.45:t=fill`,
      // Top badge
      `drawtext=text='${badgeText}':fontcolor=0x00f2fe:fontsize=${isVertical ? 32 : 24}:x=(w-text_w)/2:y=${isVertical ? 180 : 80}:shadowcolor=black:shadowx=2:shadowy=2`,
      // Big Headline
      `drawtext=text='${cleanHeadline}':fontcolor=white:fontsize=${isVertical ? 56 : 46}:x=(w-text_w)/2:y=${isVertical ? 250 : 130}:shadowcolor=black@0.8:shadowx=3:shadowy=3`,
      // Script / Subtitles
      `drawtext=text='${cleanScript}':fontcolor=0x94a3b8:fontsize=${isVertical ? 36 : 28}:x=(w-text_w)/2:y=${isVertical ? height - 320 : height - 160}:shadowcolor=black:shadowx=2:shadowy=2`,
      `format=yuv420p`
    ];

    const cmd = `ffmpeg -y ${inputClause} -vf "${vfParts.join(",")}" -t ${duration} -c:v libx264 -preset fast -pix_fmt yuv420p "${outputPath}"`;
    execSync(cmd, { stdio: "ignore" });
  }
}
