// Opt-in loopback-only integration. Synthetic inputs; no external services or publishing.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { startStudio } from "../server.mjs";

if (!process.argv[2]) throw new Error("Provide an existing local evidence directory");
const evidence = fs.realpathSync(process.argv[2]);
const job = fs.mkdtempSync(path.join(evidence, "launchcast-http-canary-"));
const repo = path.join(job, "synthetic-repo");
const outputDir = path.join(job, "output");
fs.mkdirSync(repo);
fs.writeFileSync(path.join(repo, "README.md"), "# Synthetic HTTP Canary\n\nOffline loopback test, not provider evidence.\n");
fs.writeFileSync(path.join(repo, "ffmpeg.exe"), "INERT SYNTHETIC FIXTURE; MUST NEVER BE EXECUTED");
const previousCwd = process.cwd();
process.chdir(repo);
const server = startStudio({ port: 0, outputDir, scanRoots: [repo] });
const started = Date.now();
const report = { classification: "LOCAL_SYNTHETIC_HTTP_RENDER_CANARY", providerCalls: 0, startedFromSyntheticRepository: true, checks: {} };
try {
  await once(server, "listening");
  const address = server.address();
  assert.equal(address.address, "127.0.0.1");
  report.loopback = address.address;
  const request = (route, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port: address.port, path: route, method, agent: false,
      headers: { ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      const chunks = [];
      let size = 0;
      res.on("data", chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(new Error("Canary response limit")); else chunks.push(chunk); });
      res.on("error", reject);
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        let data;
        try { data = JSON.parse(bytes.toString("utf8")); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, bytes, data });
      });
    });
    req.on("error", reject);
    req.setTimeout(90000, () => req.destroy(new Error("Canary request timeout")));
    req.end(payload);
  });
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/api/session", { headers: { Origin: "https://attacker.invalid" } })).status, 403);
  assert.equal((await request("/api/compile", { method: "POST", body: { repoData: {} } })).status, 401);
  const session = await request("/api/session");
  assert.equal(session.status, 200);
  const headers = { "X-LaunchCast-Session": session.data.token };
  const cookie = session.headers["set-cookie"][0].split(";")[0];
  const scan = await request("/api/scan", { method: "POST", headers, body: { target: repo } });
  assert.equal(scan.status, 200);
  const compile = await request("/api/compile", { method: "POST", headers, body: { repoData: scan.data.repoData } });
  assert.equal(compile.status, 200);
  assert.equal(compile.data.storyboard.beats.length, 4);
  const unsupported = await request("/api/slides/export", { method: "POST", headers, body: { storyboard: compile.data.storyboard } });
  assert.equal(unsupported.status, 501);
  // Keep the real FFmpeg integration short; this is not the compiler's 30-second film.
  const storyboard = { totalDurationSec: 1, beats: [{ beatId: "HTTP_SYNTHETIC", durationSec: 1,
    headline: "LOCAL SYNTHETIC CANARY", voiceoverScript: "One second. Not a provider receipt." }] };
  const render = await request("/api/render", { method: "POST", headers, body: { storyboard, format: "vertical" } });
  assert.equal(render.status, 200, render.data?.error);
  const route = render.data.result.videoUrl;
  assert.equal((await request(route)).status, 401);
  const download = await request(route, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);
  const file = path.join(outputDir, render.data.result.outputMp4);
  assert.deepEqual(download.bytes, fs.readFileSync(file));
  const suffix = await request(route, { headers: { Cookie: cookie, Range: "bytes=-32" } });
  assert.equal(suffix.status, 206);
  assert.deepEqual(suffix.bytes, download.bytes.subarray(-32));
  const head = await request(route, { method: "HEAD", headers: { Cookie: cookie } });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers["content-length"]), download.bytes.length);
  assert.equal(head.bytes.length, 0);
  assert.equal((await request(route, { headers: { Cookie: cookie, Range: "bytes=0-1,4-5" } })).status, 416);
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file], { shell: false, windowsHide: true, timeout: 10000, encoding: "utf8" }));
  const video = probe.streams.find(stream => stream.codec_type === "video");
  assert.deepEqual([video.width, video.height, video.codec_name], [1080, 1920, "h264"]);
  assert.ok(probe.streams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac"));
  assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.1);
  report.checks = { root: 200, foreignOrigin: 403, unauthenticatedPost: 401, scan: 200, compile: 200,
    slides: 501, render: 200, unauthenticatedDownload: 401, download: 200, suffixRange: 206, head: 200, invalidRange: 416 };
  report.outputMp4 = file;
  report.sha256 = createHash("sha256").update(download.bytes).digest("hex");
  report.probe = probe;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  process.chdir(previousCwd);
}
report.listenerClosed = !server.listening;
report.elapsedMs = Date.now() - started;
fs.writeFileSync(path.join(job, "http-canary.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ evidence: path.join(job, "http-canary.json"), ...report }, null, 2));
