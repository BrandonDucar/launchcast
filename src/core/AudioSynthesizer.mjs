import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareOutputDir, outputDestination, validateStoryboard, requireArtifact, runProcess } from "./ProcessSafety.mjs";

/** Local synthetic backing track only. No narration or provider TTS is implemented. */
export class AudioSynthesizer {
  constructor(options = {}) {
    this.outputDir = prepareOutputDir(options.outputDir || path.join(process.cwd(), "output"));
  }

  async synthesize(storyboard) {
    const duration = validateStoryboard(storyboard);
    const audioPath = outputDestination(this.outputDir, path.join(this.outputDir, `audio_${randomUUID()}.wav`));
    const music = "aevalsrc='0.08*sin(2*PI*55*t)+0.04*sin(2*PI*110*t)+0.02*sin(2*PI*220*t)+(between(mod(t,2),0,0.1)*0.08*(random(0)-0.5))+(between(mod(t,0.5),0,0.05)*0.04*sin(2*PI*880*t))':s=44100";
    try {
      runProcess("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-f", "lavfi", "-i", music,
        "-t", String(duration), "-af", "lowpass=f=2400,volume=1.8", "-threads", "2", audioPath]);
      requireArtifact(audioPath);
    } catch (error) {
      fs.rmSync(audioPath, { force: true });
      throw error;
    }
    return {
      audioPath, fullScript: storyboard.beats.map(beat => beat.voiceoverScript).join(" "),
      durationSec: duration, sampleRate: 44100, kind: "SYNTHETIC_BACKING_TRACK", narration: false
    };
  }
}
