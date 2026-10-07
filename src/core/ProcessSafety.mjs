import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function boundedNumber(value, name, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function validateBeat(beat) {
  if (!beat || typeof beat !== "object" || typeof beat.beatId !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(beat.beatId)) {
    throw new Error("Invalid beat identity");
  }
  boundedNumber(beat.durationSec, "Beat duration", 0.1, 30);
  for (const [field, limit] of [["headline", 512], ["voiceoverScript", 4096]]) {
    if (typeof beat[field] !== "string" || beat[field].length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(beat[field])) {
      throw new Error(`Invalid ${field}`);
    }
  }
}

export function validateStoryboard(storyboard) {
  if (!Array.isArray(storyboard?.beats) || storyboard.beats.length < 1 || storyboard.beats.length > 8) {
    throw new Error("Storyboard must contain 1 to 8 beats");
  }
  storyboard.beats.forEach(validateBeat);
  const duration = boundedNumber(storyboard.totalDurationSec, "Storyboard duration", 0.1, 120);
  const sum = storyboard.beats.reduce((total, beat) => total + beat.durationSec, 0);
  if (Math.abs(sum - duration) > 0.01) throw new Error("Storyboard duration does not match its beats");
  return duration;
}

export function prepareOutputDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function outputDestination(root, destination) {
  const resolved = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(resolved));
  if (!isWithin(root, parent) || fs.existsSync(resolved)) throw new Error("Output must be a new file inside the output directory");
  // lstat also rejects dangling symlinks that existsSync cannot see.
  try { fs.lstatSync(resolved); throw new Error("Output already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return path.join(parent, path.basename(resolved));
}

export function regularInput(file, roots, maxBytes) {
  if (typeof file !== "string" || /[\x00-\x1f]/.test(file) || /^[\\/]{2}/.test(file)) throw new Error("Invalid input file");
  const resolved = fs.realpathSync(file);
  if (!roots.some(root => isWithin(root, resolved))) throw new Error("Input is outside the allowed roots");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error("Input must be a bounded regular file");
  return resolved;
}

export function requireArtifact(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size === 0) throw new Error("Process did not produce an artifact");
  return stat;
}

export function runProcess(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true,
      ...options, shell: false, stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    // Never echo private paths, URLs, environment, or raw subprocess diagnostics.
    throw new Error(`${command} failed or exceeded its execution limit`);
  }
}

export function removeJob(root, job) {
  if (!isWithin(root, job) || path.dirname(job) !== root || !path.basename(job).startsWith(".render-")) {
    throw new Error("Refusing cleanup outside this render job");
  }
  fs.rmSync(job, { recursive: true, force: true });
}
