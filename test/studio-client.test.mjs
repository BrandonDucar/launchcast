import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function browserFixture() {
  const elements = new Map();
  const element = () => ({ value: "", style: {}, handlers: {}, children: [], dataset: {},
    classList: { add() {}, remove() {} }, addEventListener(name, fn) { this.handlers[name] = fn; },
    appendChild(child) { this.children.push(child); }, remove() {}, load() {}, play() {}, scrollIntoView() {} });
  const cards = Array.from({ length: 4 }, () => {
    const fields = new Map([".beat-headline", ".beat-script", ".word-counter"].map(name => [name, element()]));
    return { querySelector: name => fields.get(name) };
  });
  const document = { addEventListener: (event, fn) => fn(), createElement: element,
    getElementById: id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelectorAll: selector => selector === ".beat-card" ? cards : [] };
  const calls = [];
  const replies = [];
  const opened = [];
  const context = vm.createContext({ document, console: { error() {} }, setTimeout() {},
    window: { open: url => opened.push(url) },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      assert.ok(replies.length, `Unexpected browser request: ${url}`);
      const reply = replies.shift();
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.data };
    } });
  vm.runInContext(fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), context, { timeout: 1000 });
  elements.get("input-repo-path").value = ".";
  return { elements, calls, replies, opened, click: id => elements.get(id).handlers.click() };
}

test("Studio client establishes a session before scan and reuses it for compile/render", async () => {
  const app = browserFixture();
  app.replies.push(
    { status: 200, data: { ok: true, token: "synthetic-session" } },
    { status: 200, data: { ok: true, repoData: { name: "Fixture" } } },
    { status: 200, data: { ok: true, storyboard: { projectName: "Fixture", beats: [], totalDurationSec: 30 } } },
    { status: 200, data: { ok: true, result: { videoUrl: "/output/synthetic.mp4", outputMp4: "synthetic.mp4" } } }
  );
  await app.click("btn-scan-compile");
  await app.click("btn-render-video");
  assert.deepEqual(app.calls.map(call => call.url), ["/api/session", "/api/scan", "/api/compile", "/api/render"]);
  for (const call of app.calls.slice(1)) {
    assert.equal(call.options.headers["X-LaunchCast-Session"], "synthetic-session");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.ok(!call.url.includes("synthetic-session"));
  }
  assert.equal(app.elements.get("master-video-player").src, "/output/synthetic.mp4");
});

test("Studio client shows unavailable Slides error without opening a fabricated deck", async () => {
  const app = browserFixture();
  app.replies.push({ status: 200, data: { ok: true, token: "synthetic-session" } },
    { status: 501, data: { ok: false, error: "No deck was created" } });
  await app.click("btn-export-slides");
  assert.equal(app.opened.length, 0);
  assert.ok(app.elements.get("toast-container").children.some(toast => toast.textContent === "Export issue: No deck was created"));
});

test("expired local sessions clear without automatically retrying work", async () => {
  const app = browserFixture();
  app.replies.push({ status: 200, data: { ok: true, token: "old-synthetic" } }, { status: 401, data: { ok: false, error: "Reload Studio" } });
  await app.click("btn-scan-compile");
  assert.equal(app.calls.length, 2);
  app.replies.push({ status: 200, data: { ok: true, token: "new-synthetic" } }, { status: 501, data: { ok: false, error: "No deck" } });
  await app.click("btn-export-slides");
  assert.equal(app.calls[2].url, "/api/session");
  assert.equal(app.calls[3].options.headers["X-LaunchCast-Session"], "new-synthetic");
});
