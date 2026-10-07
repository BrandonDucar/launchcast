import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { RepoScanner } from "../src/core/RepoScanner.mjs";
import { AudioSynthesizer } from "../src/core/AudioSynthesizer.mjs";
import { VideoRenderer } from "../src/core/VideoRenderer.mjs";
import { ScriptCompiler } from "../src/core/ScriptCompiler.mjs";
import { validateStoryboard, regularInput } from "../src/core/ProcessSafety.mjs";
import { StudioMediaScope } from "../src/core/StudioMediaScope.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "launchcast-safety-"));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("launchcast-safety-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function isolateProcesses(t) {
  const shell = t.mock.method(childProcess, "execSync", () => Buffer.alloc(0));
  const direct = t.mock.method(childProcess, "execFileSync", () => Buffer.alloc(0));
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return { shell, direct };
}

const beat = { beatId: "BEAT_01", headline: "Fixture", voiceoverScript: "Fixture text", durationSec: 1 };

test("remote scan rejects shell-shaped and non-GitHub targets before any process", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  for (const target of [
    'https://github.com/owner/repo" & echo inert-fixture',
    "https://localhost/repo", "http://github.com/owner/repo",
    "https://github.com/owner/repo?token=fixture", "git@github.com:owner/repo"
  ]) {
    await assert.rejects(new RepoScanner(target).resolve());
  }
  assert.equal(shell.mock.callCount(), 0);
  assert.equal(direct.mock.callCount(), 0);
});

test("audio rejects string durations before invoking a subprocess", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const audio = new AudioSynthesizer({ outputDir: fixture(t) });
  await assert.rejects(audio.synthesize({ totalDurationSec: "1 & echo inert-fixture", beats: [beat] }));
  assert.equal(shell.mock.callCount(), 0);
  assert.equal(direct.mock.callCount(), 0);
});

test("segment rendering rejects unbounded durations before invoking a subprocess", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  const renderer = new VideoRenderer({ outputDir: root });
  await assert.rejects(renderer.renderSegment({ ...beat, durationSec: 1e12 }, path.join(root, "segment.mp4"), 1080, 1920, true));
  assert.equal(shell.mock.callCount(), 0);
  assert.equal(direct.mock.callCount(), 0);
});

test("segment output cannot escape the configured directory", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  const renderer = new VideoRenderer({ outputDir: root });
  await assert.rejects(renderer.renderSegment(beat, path.join(root, "..", "outside.mp4"), 1080, 1920, true));
  assert.equal(shell.mock.callCount(), 0);
  assert.equal(direct.mock.callCount(), 0);
});

test("FFmpeg failure cannot return a fabricated audio artifact", async (t) => {
  isolateProcesses(t);
  const audio = new AudioSynthesizer({ outputDir: fixture(t) });
  await assert.rejects(audio.synthesize({ totalDurationSec: 1, beats: [beat] }));
});

test("audio executable lookup never inherits an untrusted repository working directory", async t => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  const repo = path.join(root, "untrusted-repo");
  const output = path.join(repo, "output");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(repo, "ffmpeg.exe"), "INERT FIXTURE, NEVER EXECUTED");
  fs.writeFileSync(path.join(output, "ffmpeg.exe"), "INERT FIXTURE, NEVER EXECUTED");
  let workingDirectory;
  direct.mock.mockImplementation((command, args, options) => {
    assert.equal(command, "ffmpeg");
    workingDirectory = options.cwd;
    assert.ok(workingDirectory, "Audio must not inherit the caller cwd");
    assert.equal(path.dirname(workingDirectory), output);
    assert.ok(path.basename(workingDirectory).startsWith(".render-"));
    assert.ok(!fs.existsSync(path.join(workingDirectory, "ffmpeg.exe")));
    assert.equal(options.shell, false);
    fs.writeFileSync(path.resolve(workingDirectory, args.at(-1)), "SYNTHETIC-NOT-A-WAV");
    return Buffer.alloc(0);
  });
  const previous = process.cwd();
  let result;
  try {
    process.chdir(repo);
    result = await new AudioSynthesizer({ outputDir: output }).synthesize({ totalDurationSec: 1, beats: [beat] });
  } finally { process.chdir(previous); }
  assert.ok(fs.existsSync(result.audioPath));
  assert.ok(!fs.existsSync(workingDirectory));
  assert.equal(fs.readFileSync(path.join(output, "ffmpeg.exe"), "utf8"), "INERT FIXTURE, NEVER EXECUTED");
});

test("public clone uses argument arrays and isolated Git configuration", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  direct.mock.mockImplementation((command, args, options) => {
    assert.equal(command, "git");
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 60000);
    assert.equal(options.env.GIT_CONFIG_NOSYSTEM, "1");
    assert.equal(options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(options.env.GIT_CONFIG_COUNT, undefined);
    assert.equal(options.env.GIT_SSH_COMMAND, undefined);
    assert.ok(args.includes("credential.helper="));
    assert.ok(args.includes("http.followRedirects=false"));
    assert.ok(args.includes("protocol.allow=never"));
    assert.deepEqual(args.slice(-3, -1), ["--", "https://github.com/example/fixture.git"]);
    fs.mkdirSync(args.at(-1));
    return Buffer.alloc(0);
  });
  const scanner = new RepoScanner("https://github.com/example/fixture.git", { cacheRoot: root });
  const resolved = await scanner.resolve();
  assert.equal(scanner.isCloned, true);
  assert.ok(resolved.startsWith(root + path.sep));
  assert.equal(shell.mock.callCount(), 0);
  assert.equal(direct.mock.callCount(), 1);
});

test("failed clone removes only its own cache directory and redacts process errors", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "existing.txt"), "preserve");
  direct.mock.mockImplementation(() => { throw new Error("SECRET_FIXTURE"); });
  await assert.rejects(new RepoScanner("https://github.com/example/fixture", { cacheRoot: root }).resolve(), /git failed or exceeded/);
  assert.deepEqual(fs.readdirSync(root), ["existing.txt"]);
});

test("local scan supports punctuation and does not execute project scripts", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  const repo = path.join(root, "author's project & notes");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "fixture", description: "test", scripts: { postinstall: "inert-fixture" } }));
  fs.writeFileSync(path.join(repo, "README.md"), "# Fixture\n> Synthetic test repo\n- **Feature**: test only");
  const result = await new RepoScanner(repo).scan();
  assert.equal(result.name, "Fixture");
  assert.equal(result.features.length, 1);
  assert.equal(shell.mock.callCount() + direct.mock.callCount(), 0);
});

test("metadata symlinks and oversized readmes are rejected", async (t) => {
  isolateProcesses(t);
  const root = fixture(t);
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, "not authorized metadata");
  fs.symlinkSync(outside, path.join(repo, "README.md"));
  await assert.rejects(new RepoScanner(repo).scan(), /symlinks/);
  fs.unlinkSync(path.join(repo, "README.md"));
  fs.writeFileSync(path.join(repo, "README.md"), Buffer.alloc(1024 * 1024 + 1));
  await assert.rejects(new RepoScanner(repo).scan(), /bounded regular file/);
});

test("stock compiler storyboard remains accepted by the render contract", () => {
  const storyboard = new ScriptCompiler().compile({ name: "Fixture", tagline: "Synthetic fixture", features: [], mediaAssets: [], techStack: [], architecture: [] }, { title: "Fixture" });
  assert.equal(validateStoryboard(storyboard), 30);
});

test("invalid storyboard, dimensions, FPS and format never launch FFmpeg", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  const renderer = new VideoRenderer({ outputDir: root });
  for (const value of [NaN, Infinity, -1, "30", 61, 1.5]) assert.throws(() => new VideoRenderer({ outputDir: root, fps: value }));
  for (const beats of [[], Array(9).fill(beat), [{ ...beat, beatId: "x':textfile=secret" }], [{ ...beat, headline: "x".repeat(513) }]]) {
    await assert.rejects(renderer.render({ beats, totalDurationSec: 1 }, "unused.wav"));
  }
  await assert.rejects(renderer.render({ beats: [beat], totalDurationSec: 2 }, "unused.wav"), /does not match/);
  await assert.rejects(renderer.render({ beats: [beat], totalDurationSec: 1 }, "unused.wav", "../../outside"), /format/);
  await assert.rejects(renderer.renderSegment(beat, path.join(root, "out.mp4"), "1080", 1920, true), /dimensions/);
  assert.equal(shell.mock.callCount() + direct.mock.callCount(), 0);
});

test("all UNC separator spellings are rejected before filesystem access", async (t) => {
  isolateProcesses(t);
  const realpath = t.mock.method(fs, "realpathSync", () => { throw new Error("filesystem-must-not-be-reached"); });
  for (const prefix of ["\\\\", "//", "\\/", "/\\"]) {
    const remote = prefix + "invalid.example/share/file.png";
    await assert.rejects(new RepoScanner(remote).resolve(), /Network paths/);
    assert.throws(() => regularInput(remote, [], 100), /Invalid input/);
    assert.ok(path.win32.isAbsolute(remote));
    assert.ok(path.win32.normalize(remote).startsWith("\\\\"));
  }
  assert.equal(realpath.mock.callCount(), 0);
});

test("scanner-sized names and descriptions survive compiler prefixes", () => {
  const storyboard = new ScriptCompiler().compile({ name: "N".repeat(200), description: "D".repeat(2000), features: [], mediaAssets: [] });
  assert.equal(validateStoryboard(storyboard), 30);
});

test("Studio API media round trip preserves sibling repo roots without accepting arbitrary files", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  const repo = path.join(root, "sibling-repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "hero.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const scanner = new RepoScanner(repo);
  const data = await scanner.scan();
  const scope = new StudioMediaScope();
  scope.register(scanner.localPath, data.mediaAssets);
  const storyboard = new ScriptCompiler().compile(data);
  const roots = scope.rootsFor(storyboard);
  assert.deepEqual(roots, [fs.realpathSync(repo)]);
  const renderer = new VideoRenderer({ outputDir: path.join(root, "output"), allowedMediaRoots: roots });
  assert.equal(renderer.mediaInput(storyboard.beats[0].mediaAsset).decoder, "png");
  assert.throws(() => scope.rootsFor({ beats: [{ ...beat, mediaAsset: path.join(root, "private.png") }] }), /not discovered/);
  assert.equal(direct.mock.callCount(), 0);
});

test("Studio scan provenance has a bounded cache", () => {
  const scope = new StudioMediaScope();
  for (let i = 0; i < 1100; i++) scope.register("fixture-root", [{ path: `fixture-${i}.png` }]);
  assert.equal(scope.assets.size, 1000);
  assert.equal(scope.assets.has("fixture-0.png"), false);
});

test("literal copy never enters filter grammar or the shell", async (t) => {
  const { shell, direct } = isolateProcesses(t);
  const root = fixture(t);
  const output = path.join(root, "author's output & notes");
  fs.mkdirSync(output);
  const copy = "O'Brien: [x], y; $() & %{metadata:secret} ";
  direct.mock.mockImplementation((command, args, options) => {
    assert.equal(command, "ffmpeg");
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 120000);
    assert.ok(!args.some(arg => arg.includes(copy)));
    assert.equal(fs.readFileSync(path.join(options.cwd, "headline.txt"), "utf8"), copy);
    const filter = args[args.indexOf("-vf") + 1];
    assert.equal((filter.match(/expansion=none/g) || []).length, 3);
    fs.writeFileSync(path.join(options.cwd, args.at(-1)), "synthetic-output-not-video");
    return Buffer.alloc(0);
  });
  await new VideoRenderer({ outputDir: output }).renderSegment({ ...beat, headline: copy }, path.join(output, "result.mp4"), 1080, 1920, true);
  assert.equal(shell.mock.callCount(), 0);
  assert.deepEqual(fs.readdirSync(output), ["result.mp4"]);
});

test("render failure leaves no artifact and cleans only its own jobs", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "preserve.mp4"), "existing");
  direct.mock.mockImplementation(() => { throw new Error("PRIVATE_DIAGNOSTIC"); });
  await assert.rejects(new VideoRenderer({ outputDir: root }).renderSegment(beat, path.join(root, "out.mp4"), 1080, 1920, true), /ffmpeg failed or exceeded/);
  assert.deepEqual(fs.readdirSync(root), ["preserve.mp4"]);
});

test("existing destinations and symlink escapes cannot overwrite files", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  const output = path.join(root, "output");
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const renderer = new VideoRenderer({ outputDir: output });
  fs.writeFileSync(path.join(output, "existing.mp4"), "preserve");
  fs.symlinkSync(outside, path.join(output, "escape"), "junction");
  await assert.rejects(renderer.renderSegment(beat, path.join(output, "existing.mp4"), 1080, 1920, true));
  await assert.rejects(renderer.renderSegment(beat, path.join(output, "escape", "out.mp4"), 1080, 1920, true));
  assert.equal(direct.mock.callCount(), 0);
  assert.equal(fs.readFileSync(path.join(output, "existing.mp4"), "utf8"), "preserve");
});

test("media must be a bounded raster inside the approved root", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  const media = path.join(root, "media");
  fs.mkdirSync(media);
  const outside = path.join(root, "outside.png");
  fs.writeFileSync(outside, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(path.join(media, "fake.png"), "<svg>not a raster</svg>");
  fs.symlinkSync(outside, path.join(media, "link.png"));
  const renderer = new VideoRenderer({ outputDir: root, allowedMediaRoots: [media] });
  for (const file of [outside, path.join(media, "fake.png"), path.join(media, "link.png")]) {
    await assert.rejects(renderer.renderSegment({ ...beat, mediaAsset: file }, path.join(root, "out.mp4"), 1080, 1920, true));
  }
  assert.equal(direct.mock.callCount(), 0);
});

test("concat manifests use only generated relative paths and safe mode", async (t) => {
  const { direct } = isolateProcesses(t);
  const root = fixture(t);
  const audio = path.join(root, "fixture.wav");
  fs.writeFileSync(audio, "synthetic-not-real-audio");
  const manifests = [];
  direct.mock.mockImplementation((command, args, options) => {
    if (args.includes("concat")) {
      assert.equal(args[args.indexOf("-safe") + 1], "1");
      manifests.push(fs.readFileSync(path.join(options.cwd, "concat.txt"), "utf8"));
    }
    fs.writeFileSync(path.join(options.cwd, args.at(-1)), "synthetic-not-real-video");
    return Buffer.alloc(0);
  });
  const result = await new VideoRenderer({ outputDir: root }).render({ totalDurationSec: 2, beats: [beat, { ...beat, beatId: "BEAT_02" }] }, audio, "landscape");
  assert.deepEqual(manifests, ["file 'segment-0.mp4'\nfile 'segment-1.mp4'"]);
  assert.equal(result.resolution, "1920x1080");
  assert.equal(fs.readdirSync(root).filter(name => name.startsWith(".render-")).length, 0);
});
