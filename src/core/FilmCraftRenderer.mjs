import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  boundedNumber, validateStoryboard, prepareOutputDir, outputDestination,
  regularInput, requireArtifact, runProcess, removeJob
} from "./ProcessSafety.mjs";
import { VideoRenderer } from "./VideoRenderer.mjs";

const TICKS_PER_SEC = 254016000000;
const DEFAULT_FILMCRAFT_CLI = "";

export class FilmCraftRenderer {
  constructor(options = {}) {
    this.fps = boundedNumber(options.fps ?? 30, "FPS", 1, 60);
    if (!Number.isInteger(this.fps)) throw new Error("FPS must be an integer");
    this.outputDir = prepareOutputDir(options.outputDir || path.join(process.cwd(), "output"));
    this.mediaRoots = (options.allowedMediaRoots || [process.cwd()]).map(root => fs.realpathSync(root));
    this.audioRoots = (options.allowedAudioRoots || [this.outputDir]).map(root => fs.realpathSync(root));
    this.filmcraftCli = options.filmcraftCli || process.env.FILMCRAFT_CLI_PATH || DEFAULT_FILMCRAFT_CLI;
    this.runner = options.runner || runProcess;
    this.fallbackRenderer = options.fallbackRenderer || new VideoRenderer(options);
  }

  isFilmCraftAvailable() {
    try {
      if (typeof this.filmcraftCli !== "string" || !fs.existsSync(this.filmcraftCli)) return false;
      const stat = fs.statSync(this.filmcraftCli);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  mediaInput(mediaAsset) {
    if (mediaAsset == null || mediaAsset === "") return null;
    if (typeof mediaAsset !== "string") throw new Error("Invalid media asset");
    if (!/\.(png|jpe?g|webp)$/i.test(mediaAsset)) return null;
    const file = regularInput(mediaAsset, this.mediaRoots, 20 * 1024 * 1024);
    const header = Buffer.alloc(12);
    const fd = fs.openSync(file, "r");
    try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
    const decoder = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
      : header[0] === 255 && header[1] === 216 && header[2] === 255 ? "jpg"
      : header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP" ? "webp" : null;
    if (!decoder) throw new Error("Unsupported media signature");
    return { file, decoder, ext: `.${decoder}` };
  }

  async render(storyboard, audioPath, format = "vertical", options = {}) {
    const duration = validateStoryboard(storyboard);
    if (!["vertical", "landscape"].includes(format)) throw new Error("Invalid video format");
    const audio = regularInput(audioPath, this.audioRoots, 64 * 1024 * 1024);
    const isVertical = format === "vertical";
    const [width, height] = isVertical ? [1080, 1920] : [1920, 1080];

    // Check if FilmCraft CLI is available
    if (!this.isFilmCraftAvailable()) {
      if (options.allowFallback === true) {
        const fallbackResult = await this.fallbackRenderer.render(storyboard, audioPath, format);
        return {
          ...fallbackResult,
          renderer: "ffmpeg_fallback",
          fallbackReason: "FILMCRAFT_CLI_NOT_FOUND"
        };
      }
      throw new Error("FilmCraft CLI executable not found");
    }

    const mediaInputs = storyboard.beats.map(beat => this.mediaInput(beat.mediaAsset));
    if (mediaInputs.some(media => !media)) throw new Error("FilmCraft requires a supported raster for every beat");
    const version = String(this.runner(this.filmcraftCli, ["--version"])).trim();
    if (version !== "filmcraft-cli 0.5.0") throw new Error("Unqualified FilmCraft version; expected 0.5.0");
    const outputMp4 = outputDestination(this.outputDir, path.join(this.outputDir, `launch_reel_${format}_${randomUUID()}.mp4`));
    let preservedProject = null;
    let keepJob = false;

    const job = fs.mkdtempSync(path.join(this.outputDir, ".render-"));
    try {
      const projectPath = path.join(job, "project.fcproj");
      const setupScript = path.join(job, "setup.jsonl");
      const timelineScript = path.join(job, "timeline.jsonl");

      // Copy media assets to job workspace so original sources remain read-only
      const importedPaths = [];
      const beatMediaNames = [];
      for (let i = 0; i < storyboard.beats.length; i++) {
        const beat = storyboard.beats[i];
        const media = mediaInputs[i];
        if (media) {
          const destName = `media_beat_${i}${media.ext}`;
          const destPath = path.join(job, destName);
          fs.copyFileSync(media.file, destPath);
          importedPaths.push(destPath);
          beatMediaNames.push(destName);
        } else {
          beatMediaNames.push(null);
        }
      }

      const audioJobCopy = path.join(job, "audio.wav");
      fs.copyFileSync(audio, audioJobCopy);
      importedPaths.push(audioJobCopy);

      // 1. Setup script: create sequence and import assets
      const setupCommands = [
        {
          id: "file.newSequence",
          params: {
            name: "LaunchCast Reel",
            width,
            height,
            fps: this.fps,
            video: 3,
            audio: 3
          }
        },
        {
          id: "file.import",
          params: { paths: importedPaths }
        }
      ];

      fs.writeFileSync(setupScript, setupCommands.map(c => JSON.stringify(c)).join("\n") + "\n", { encoding: "utf8", flag: "wx" });
      this.runner(this.filmcraftCli, ["--save-as", projectPath, "run", setupScript], { cwd: job });
      requireArtifact(projectPath);

      // 2. Inspect project to map item names to item IDs
      const inspectOutput = this.runner(this.filmcraftCli, ["--project", projectPath, "inspect"], { cwd: job });
      let projData;
      try {
        projData = typeof inspectOutput === "string" ? JSON.parse(inspectOutput) : JSON.parse(inspectOutput.toString("utf8"));
      } catch {
        throw new Error("Failed to parse FilmCraft project inspection");
      }

      const rootChildren = projData?.project?.root?.children || [];
      const itemMap = new Map();
      for (const child of rootChildren) {
        if (child && child.name && child.item != null) {
          itemMap.set(child.name, child.item);
        }
      }
      for (const name of [...beatMediaNames, "audio.wav"]) {
        if (!itemMap.has(name)) throw new Error("FilmCraft import incomplete");
      }

      // 3. Assemble timeline: place video clips, audio, and captions
      const timelineCommands = [];
      let currentSeconds = 0;

      for (let i = 0; i < storyboard.beats.length; i++) {
        const beat = storyboard.beats[i];
        const mediaName = beatMediaNames[i];
        const beatDuration = beat.durationSec;
        const durationTicks = Math.round(beatDuration * TICKS_PER_SEC);

        if (mediaName && itemMap.has(mediaName)) {
          timelineCommands.push({
            id: "timeline.place",
            params: {
              item: itemMap.get(mediaName),
              track: "V1",
              seconds: currentSeconds,
              duration: durationTicks,
              insert: false
            }
          });
        }

        currentSeconds += beatDuration;
      }

      // Place audio track on A1
      if (itemMap.has("audio.wav")) {
        timelineCommands.push({
          id: "timeline.place",
          params: {
            item: itemMap.get("audio.wav"),
            track: "A1",
            seconds: 0.0,
            sourceIn: 0,
            duration: Math.round(duration * TICKS_PER_SEC),
            insert: false,
            video: false,
            audio: true
          }
        });
      }

      // Add Subtitle track and captions
      timelineCommands.push({
        id: "captions.newTrack",
        params: {
          format: "Subtitle",
          name: "LaunchCast Captions"
        }
      });

      let captionSeconds = 0;
      for (let i = 0; i < storyboard.beats.length; i++) {
        const beat = storyboard.beats[i];
        const text = (beat.voiceoverScript || beat.headline || "").slice(0, 140);
        if (text) {
          timelineCommands.push({
            id: "captions.add",
            params: {
              track: "C1",
              text,
              seconds: captionSeconds + Math.min(0.2, beat.durationSec / 10),
              durationSeconds: beat.durationSec - 2 * Math.min(0.2, beat.durationSec / 10)
            }
          });
        }
        captionSeconds += beat.durationSec;
      }

      fs.writeFileSync(timelineScript, timelineCommands.map(c => JSON.stringify(c)).join("\n") + "\n", { encoding: "utf8", flag: "wx" });
      this.runner(this.filmcraftCli, ["--project", projectPath, "--save", "run", timelineScript], { cwd: job });

      // Select only our video clips before fitting them; native-size stills crop.
      const assembled = JSON.parse(fs.readFileSync(projectPath, "utf8"));
      const clips = Object.values(assembled.project?.items || {}).flatMap(item =>
        (item.kind?.Sequence?.video_tracks || []).flatMap(track => track.items || []));
      if (clips.length !== storyboard.beats.length || clips.some(clip => !Number.isSafeInteger(clip.id))) {
        throw new Error("FilmCraft video clip mapping incomplete");
      }
      const fitScript = path.join(job, "fit.jsonl");
      fs.writeFileSync(fitScript, [
        { id: "timeline.select", params: { clips: clips.map(clip => clip.id), add: false, toggle: false } },
        { id: "clip.scaleToFrameSize", params: {} }
      ].map(command => JSON.stringify(command)).join("\n") + "\n", { flag: "wx" });
      this.runner(this.filmcraftCli, ["--project", projectPath, "--save", "run", fitScript], { cwd: job });

      // 4. Export the sequence
      const exportFile = path.join(job, "export.mp4");
      this.runner(this.filmcraftCli, [
        "--project", projectPath,
        "export", exportFile,
        "--format", "h264",
        "--start", "0",
        "--end", String(duration)
      ], { cwd: job });

      requireArtifact(exportFile);
      const probe = JSON.parse(String(this.runner("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", exportFile], { cwd: job })));
      const video = probe.streams?.find(stream => stream.codec_type === "video");
      const audioStream = probe.streams?.find(stream => stream.codec_type === "audio");
      const measuredDuration = Number(probe.format?.duration);
      if (video?.width !== width || video?.height !== height || video?.codec_name !== "h264" || !audioStream || !Number.isFinite(measuredDuration) || Math.abs(measuredDuration - duration) > 0.15) {
        throw new Error("FilmCraft output metadata mismatch");
      }
      this.runner("ffmpeg", ["-nostdin", "-v", "error", "-xerror", "-i", exportFile, "-f", "null", "-"], { cwd: job });

      if (options.preserveProject) {
        // Keep the source bundle and store relative media references for relocation.
        const project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
        for (const item of Object.values(project.project?.items || {})) {
          const file = item.kind?.Media?.media?.File;
          if (file) {
            const name = path.basename(file.path);
            if (![...beatMediaNames, "audio.wav"].includes(name)) throw new Error("Unexpected project media reference");
            file.path = name;
          }
        }
        fs.writeFileSync(projectPath, JSON.stringify(project));
        preservedProject = projectPath;
      }
      fs.copyFileSync(exportFile, outputMp4, fs.constants.COPYFILE_EXCL);
      const stats = requireArtifact(outputMp4);
      keepJob = Boolean(preservedProject);

      // Compute hash of output
      const hash = createHash("sha256");
      const stream = fs.readFileSync(outputMp4);
      hash.update(stream);
      const outputSha256 = hash.digest("hex");

      return {
        outputMp4,
        projectPath: preservedProject,
        format,
        resolution: `${width}x${height}`,
        durationSec: measuredDuration,
        fileSizeMb: (stats.size / (1024 * 1024)).toFixed(2),
        outputSha256,
        renderer: "filmcraft",
        version: version.replace("filmcraft-cli ", ""),
        projectBundle: preservedProject ? job : null,
        decoded: true,
        beatsCount: storyboard.beats.length
      };
    } finally {
      if (!keepJob) removeJob(this.outputDir, job);
    }
  }
}
