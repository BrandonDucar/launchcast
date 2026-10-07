import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { RepoScanner, AudioSynthesizer, VideoRenderer } from "../src/index.mjs";
import { localScanTarget, parseJsonBody } from "../src/core/StudioHttp.mjs";

async function studio(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "launchcast-http-"));
  const publicDir = path.join(root, "public");
  const outputDir = path.join(root, "output");
  const repo = path.join(root, "repo");
  for (const dir of [publicDir, outputDir, repo]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(publicDir, "index.html"), "<h1>Synthetic Studio fixture</h1>");
  fs.writeFileSync(path.join(repo, "README.md"), "# Synthetic repository");
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("launchcast-http-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  let handler;
  let listenArgs;
  const fake = new EventEmitter();
  fake.address = () => ({ address: "127.0.0.1", port: 3344, family: "IPv4" });
  fake.listen = (...args) => { listenArgs = args; args.find(arg => typeof arg === "function")?.(); return fake; };
  t.mock.method(http, "createServer", (...args) => { handler = args.at(-1); return fake; });
  const mod = await import(`../server.mjs?fixture=${randomUUID()}`);
  if (mod.createStudioServer) mod.createStudioServer({ publicDir, outputDir, scanRoots: [repo] });
  const request = async ({ method = "GET", url = "/", headers = {}, body, raw, bodyChunks, bodyEvent = "end", rawHeaders, remoteAddress = "127.0.0.1" } = {}) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, headers: { host: "127.0.0.1:3344", ...headers }, rawHeaders, socket: { localPort: 3344, remoteAddress }, resume() {}, destroy() {} });
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.writeHead = (status, values = {}) => { res.statusCode = status; for (const [key, value] of Object.entries(values)) res.setHeader(key, value); return res; };
    const done = new Promise((resolve, reject) => { res.once("finish", resolve); res.once("error", reject); });
    const work = handler(req, res);
    queueMicrotask(() => {
      if (bodyChunks) { for (const chunk of bodyChunks) req.emit("data", chunk); }
      else if (raw !== undefined || body !== undefined) req.emit("data", Buffer.from(raw ?? JSON.stringify(body)));
      req.emit(bodyEvent, bodyEvent === "error" ? new Error("synthetic request failure") : undefined);
    });
    await work;
    await done;
    const text = Buffer.concat(chunks).toString("utf8");
    let data;
    try { data = JSON.parse(text); } catch {}
    return { status: res.statusCode, headers: res.headers, text, data, bytes: Buffer.concat(chunks) };
  };
  const session = async () => {
    const response = await request({ url: "/api/session" });
    return { "x-launchcast-session": response.data?.token || "baseline-no-session", "content-type": "application/json" };
  };
  return { root, publicDir, outputDir, repo, mod, request, session, listenArgs: () => listenArgs };
}

test("Studio entry point binds only the IPv4 loopback interface", async t => {
  const app = await studio(t);
  if (app.mod.startStudio) app.mod.startStudio({ port: 3344, scanRoots: [app.repo], outputDir: app.outputDir, publicDir: app.publicDir });
  assert.equal(app.listenArgs()?.[1], "127.0.0.1");
});

test("untrusted Host cannot reach Studio work", async t => {
  const app = await studio(t);
  const response = await app.request({ method: "POST", url: "/api/compile", headers: { host: "attacker.invalid:3344" }, body: { repoData: {} } });
  assert.equal(response.status, 403);
});

test("foreign Origin cannot reach Studio work", async t => {
  const app = await studio(t);
  const response = await app.request({ method: "POST", url: "/api/compile", headers: { origin: "https://attacker.invalid" }, body: { repoData: {} } });
  assert.equal(response.status, 403);
});

test("POST requires a process-local Studio session", async t => {
  const app = await studio(t);
  const response = await app.request({ method: "POST", url: "/api/compile", headers: { "content-type": "application/json" }, body: { repoData: {} } });
  assert.equal(response.status, 401);
});

test("cross-origin preflight is rejected without wildcard CORS", async t => {
  const app = await studio(t);
  const response = await app.request({ method: "OPTIONS", url: "/api/render", headers: { origin: "https://attacker.invalid", "access-control-request-method": "POST" } });
  assert.equal(response.status, 403);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("request body limit applies even without Content-Length", async t => {
  const app = await studio(t);
  const headers = await app.session();
  const response = await app.request({ method: "POST", url: "/api/render", headers, body: { excess: "x".repeat(70000) } });
  assert.equal(response.status, 413);
  const compile = await app.request({ method: "POST", url: "/api/compile", headers, bodyChunks: [Buffer.alloc(2 * 1024 * 1024), Buffer.alloc(2 * 1024 * 1024 + 1)] });
  assert.equal(compile.status, 413);
});

test("session bootstrap is no-store, strict-cookie and same-origin only", async t => {
  const app = await studio(t);
  const response = await app.request({ url: "/api/session" });
  assert.equal(response.status, 200);
  assert.match(response.data.token, /^[a-f0-9]{64}$/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers["set-cookie"], /; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
  assert.ok(!(await app.request()).text.includes(response.data.token));
  assert.equal((await app.request({ url: "/api/session", headers: { origin: "null" } })).status, 403);
  assert.equal((await app.request({ url: "/api/session", headers: { origin: "http://127.0.0.1:3344", "sec-fetch-site": "same-origin" } })).status, 200);
});

test("all mutation routes reject missing, invalid and previous-process sessions", async t => {
  const app = await studio(t);
  const old = await app.session();
  app.mod.createStudioServer({ publicDir: app.publicDir, outputDir: app.outputDir, scanRoots: [app.repo] });
  for (const url of ["/api/scan", "/api/compile", "/api/render", "/api/slides/export"]) {
    for (const headers of [{}, old, { "x-launchcast-session": "x".repeat(64) }]) {
      assert.equal((await app.request({ method: "POST", url, headers, body: {} })).status, 401);
    }
  }
});

test("Host, peer, duplicate headers and browser context are admission boundaries", async t => {
  const app = await studio(t);
  for (const host of [undefined, "localhost", "localhost:3333", "127.1:3344", "2130706433:3344", "127.0.0.1:3344.attacker.invalid"]) {
    assert.equal((await app.request({ headers: { host, "x-forwarded-host": "127.0.0.1:3344" } })).status, 403);
  }
  for (const value of ["cross-site", "same-site"]) {
    assert.equal((await app.request({ headers: { "sec-fetch-site": value } })).status, 403);
  }
  assert.equal((await app.request({ remoteAddress: "192.0.2.1" })).status, 403);
  assert.equal((await app.request({ rawHeaders: ["Host", "127.0.0.1:3344", "host", "localhost:3344"] })).status, 400);
});

test("malformed paths and unsupported methods never reach file reads", async t => {
  const app = await studio(t);
  for (const url of ["//attacker.invalid/", "http://localhost/", "/%2e%2e/README.md", "/a/./b", "/%5csecret", "/%00", "/%ZZ", "/C:/private", "/#fragment"]) {
    assert.equal((await app.request({ url })).status, 400, url);
  }
  assert.equal((await app.request({ url: "/%252e%252e/private" })).status, 404);
  assert.equal((await app.request({ method: "PUT" })).status, 405);
  assert.equal((await app.request({ method: "POST", url: "/missing" })).status, 404);
  assert.equal((await app.request()).status, 200);
});

test("JSON parsing rejects unsupported media, malformed values and invalid UTF-8", async t => {
  const app = await studio(t);
  const headers = await app.session();
  const post = options => app.request({ method: "POST", url: "/api/compile", headers, ...options });
  assert.equal((await post({ headers: { ...headers, "content-type": "text/plain" }, body: {} })).status, 415);
  assert.equal((await post({ headers: { ...headers, "content-encoding": "gzip" }, body: {} })).status, 415);
  assert.equal((await post({ headers: { ...headers, "content-length": "5000000" }, body: {} })).status, 413);
  for (const raw of ["{", "null", "[]", '"text"', Buffer.from([0xff])]) {
    assert.equal((await post({ raw })).status, 400);
  }
  for (const bodyEvent of ["aborted", "error"]) assert.equal((await post({ raw: "{", bodyEvent })).status, 400);
  const utf8 = Buffer.from(JSON.stringify({ repoData: { name: "Synthetic \u00e9" } }));
  const response = await post({ bodyChunks: Array.from(utf8, byte => Buffer.from([byte])) });
  assert.equal(response.status, 200);
  assert.equal(response.data.storyboard.projectName, "Synthetic \u00e9");
});

test("slow request bodies time out and release parser listeners", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const req = new EventEmitter();
  req.headers = { "content-type": "application/json" };
  let resumed = false;
  req.resume = () => { resumed = true; };
  const pending = parseJsonBody(req);
  const rejected = assert.rejects(pending, { status: 408 });
  req.emit("data", Buffer.from("{"));
  t.mock.timers.tick(10001);
  await rejected;
  assert.equal(resumed, true);
  for (const event of ["data", "end", "error", "aborted"]) assert.equal(req.listenerCount(event), 0);
});

test("bounded configured-root scanning works; remote and out-of-root scans cannot invoke scanner", async t => {
  const app = await studio(t);
  const headers = await app.session();
  const allowed = await app.request({ method: "POST", url: "/api/scan", headers, body: { target: app.repo } });
  assert.equal(allowed.status, 200);
  const scanner = t.mock.method(RepoScanner.prototype, "scan", () => { throw new Error("must not run"); });
  for (const target of [app.root, "https://github.com/example/fixture", "git@github.com:example/fixture"]) {
    assert.equal((await app.request({ method: "POST", url: "/api/scan", headers, body: { target } })).status, 403);
  }
  assert.equal(scanner.mock.callCount(), 0);
  const sibling = path.join(app.root, "sibling");
  fs.mkdirSync(sibling);
  assert.equal(localScanTarget(sibling, [app.repo, sibling]), sibling);
  const link = path.join(app.repo, "escape");
  fs.symlinkSync(sibling, link, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => localScanTarget(link, [app.repo]), { status: 400 });
});

test("a full legal multibyte media scan round-trips through Studio compile", async t => {
  const app = await studio(t);
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(app.repo, `${"\u6d4b".repeat(120)}-${i}.png`), "synthetic scan fixture");
  const headers = await app.session();
  const scan = await app.request({ method: "POST", url: "/api/scan", headers, body: { target: app.repo } });
  assert.equal(scan.status, 200);
  assert.equal(scan.data.repoData.mediaAssets.length, 100);
  const body = { repoData: scan.data.repoData, docId: "" };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 65536);
  const compiled = await app.request({ method: "POST", url: "/api/compile", headers, body });
  assert.equal(compiled.status, 200);
  assert.equal(compiled.data.storyboard.beats.length, 4);
});

test("compile validates input shape and Workspace placeholders fail explicitly", async t => {
  const app = await studio(t);
  const headers = await app.session();
  for (const repoData of [null, [], { name: 4 }, { features: [{}] }, { mediaAssets: [{ name: "x" }] }, { name: "\u0000" }]) {
    assert.equal((await app.request({ method: "POST", url: "/api/compile", headers, body: { repoData } })).status, 400);
  }
  for (const [url, body] of [["/api/compile", { repoData: {}, docId: "synthetic-doc" }], ["/api/slides/export", {}]]) {
    const response = await app.request({ method: "POST", url, headers, body });
    assert.equal(response.status, 501);
    assert.equal(response.data.ok, false);
    assert.ok(!response.text.includes("https://docs.google.com"));
  }
});

const storyboard = { totalDurationSec: 1, beats: [{ beatId: "FIXTURE_1", headline: "Synthetic", voiceoverScript: "Fixture only", durationSec: 1 }] };

test("render input admission precedes every synthesis operation", async t => {
  const app = await studio(t);
  const headers = await app.session();
  const audio = t.mock.method(AudioSynthesizer.prototype, "synthesize", () => { throw new Error("must not run"); });
  for (const body of [
    { storyboard, format: "not-a-format" },
    { storyboard: { ...storyboard, totalDurationSec: "1" } },
    { storyboard: { ...storyboard, beats: [{ ...storyboard.beats[0], mediaAsset: "C:/secret.png" }] } }
  ]) assert.equal((await app.request({ method: "POST", url: "/api/render", headers, body })).status, 400);
  assert.equal(audio.mock.callCount(), 0);
});

async function syntheticRender(t, app) {
  const name = `launch_reel_vertical_${randomUUID()}.mp4`;
  const bytes = Buffer.from("SYNTHETIC-NOT-A-REAL-MP4");
  t.mock.method(AudioSynthesizer.prototype, "synthesize", async () => ({ audioPath: "synthetic-audio" }));
  t.mock.method(VideoRenderer.prototype, "render", async () => {
    fs.writeFileSync(path.join(app.outputDir, name), bytes);
    return { outputMp4: path.join(app.outputDir, name), status: "SYNTHETIC_FIXTURE" };
  });
  const headers = await app.session();
  const response = await app.request({ method: "POST", url: "/api/render", headers, body: { storyboard } });
  assert.equal(response.status, 200);
  assert.equal(response.data.result.outputMp4, name);
  return { url: response.data.result.videoUrl, headers, bytes, name };
}

test("only completed current-process renders are downloadable with a session", async t => {
  const app = await studio(t);
  const render = await syntheticRender(t, app);
  assert.equal((await app.request({ url: render.url })).status, 401);
  assert.deepEqual((await app.request({ url: render.url, headers: render.headers })).bytes, render.bytes);
  const cookie = `launchcast_session_3344=${render.headers["x-launchcast-session"]}`;
  assert.equal((await app.request({ url: render.url, headers: { cookie } })).status, 200);
  assert.equal((await app.request({ url: render.url, headers: { cookie: cookie + "; " + cookie } })).status, 401);
  for (const name of ["soundtrack.wav", "private.txt", ".render-fixture/beat.mp4", `launch_reel_vertical_${randomUUID()}.mp4`]) {
    assert.equal((await app.request({ url: `/output/${name}`, headers: render.headers })).status, 404);
  }
  app.mod.createStudioServer({ publicDir: app.publicDir, outputDir: app.outputDir, scanRoots: [app.repo] });
  assert.equal((await app.request({ url: render.url, headers: await app.session() })).status, 404);
  assert.ok(fs.existsSync(path.join(app.outputDir, render.name)));
});

test("video range handling preserves closed, open, suffix and HEAD downloads", async t => {
  const app = await studio(t);
  const render = await syntheticRender(t, app);
  for (const [range, start, end] of [["bytes=0-3", 0, 3], ["bytes=4-", 4, render.bytes.length - 1], ["bytes=-4", render.bytes.length - 4, render.bytes.length - 1], ["bytes=2-999", 2, render.bytes.length - 1], ["bytes=-999", 0, render.bytes.length - 1]]) {
    const response = await app.request({ url: render.url, headers: { ...render.headers, range } });
    assert.equal(response.status, 206);
    assert.deepEqual(response.bytes, render.bytes.subarray(start, end + 1));
    assert.equal(response.headers["content-range"], `bytes ${start}-${end}/${render.bytes.length}`);
  }
  for (const range of ["bytes=", "bytes=-", "bytes=-0", "bytes=9-1", "bytes=999-", "bytes=0-1,4-5", "bytes=0-4junk", "bytes=999999999999999999999-"]) {
    const response = await app.request({ url: render.url, headers: { ...render.headers, range } });
    assert.equal(response.status, 416, range);
    assert.equal(response.headers["content-range"], `bytes */${render.bytes.length}`);
  }
  const head = await app.request({ method: "HEAD", url: render.url, headers: render.headers });
  assert.equal(head.status, 200);
  assert.equal(head.bytes.length, 0);
  assert.equal(head.headers["content-length"], render.bytes.length);
});

test("static routes are allowlisted and cannot follow an escape link", async t => {
  const app = await studio(t);
  fs.writeFileSync(path.join(app.publicDir, "private.txt"), "synthetic private fixture");
  assert.equal((await app.request({ url: "/private.txt" })).status, 404);
  // Model realpath resolution of a link without requiring Windows symlink privilege.
  const realpath = fs.realpathSync;
  t.mock.method(fs, "realpathSync", file => file === path.join(app.publicDir, "app.js") ? path.join(app.repo, "README.md") : realpath(file));
  assert.equal((await app.request({ url: "/app.js" })).status, 404);
  assert.equal((await app.request({ method: "HEAD" })).bytes.length, 0);
});

test("busy admission bounds queued work and failures redact private errors", async t => {
  const app = await studio(t);
  const headers = await app.session();
  let release;
  const scanner = t.mock.method(RepoScanner.prototype, "scan", () => new Promise(resolve => { release = resolve; }));
  const first = app.request({ method: "POST", url: "/api/scan", headers, body: { target: app.repo } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await app.request({ method: "POST", url: "/api/compile", headers, body: { repoData: {} } })).status, 429);
  release({ name: "Synthetic", mediaAssets: [] });
  assert.equal((await first).status, 200);
  scanner.mock.mockImplementation(() => { throw new Error("SECRET-FIXTURE C:/private/path"); });
  const response = await app.request({ method: "POST", url: "/api/scan", headers, body: { target: app.repo } });
  assert.equal(response.status, 500);
  assert.ok(!/SECRET|private/.test(response.text));
  assert.equal((await app.request({ method: "POST", url: "/api/compile", headers, body: { repoData: {} } })).status, 200);
});
