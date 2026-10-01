import test from "node:test";
import assert from "node:assert/strict";
import { DistributionEngine, distributeVideo } from "../src/core/DistributionEngine.mjs";
import { FarcasterBroadcaster } from "../src/core/FarcasterBroadcaster.mjs";

const storyboard = {
  projectName: "Offline fixture",
  title: "Offline fixture",
  beats: [{ voiceoverScript: "A test, not a published launch." }]
};

test("unimplemented Google uploads cannot manufacture success or provider IDs", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("No network is allowed in this test");
  });
  const engine = new DistributionEngine();
  const drive = await engine.uploadToGoogleDrive("missing-test-file.mp4");
  const youtube = await engine.publishToYouTube("missing-test-file.mp4");
  for (const result of [drive, youtube]) {
    assert.equal(result.success, false);
    assert.equal(result.status, "NOT_IMPLEMENTED");
    for (const key of ["fileId", "videoId", "shareableLink", "watchUrl", "publishedAt"]) {
      assert.equal(result[key], undefined);
    }
  }
  assert.equal(network.mock.callCount(), 0);
});

test("missing Farcaster credentials are unavailable, not simulated success", async () => {
  const broadcaster = new FarcasterBroadcaster();
  broadcaster.apiKey = undefined;
  broadcaster.signerUuid = undefined;
  const result = await broadcaster.broadcastCast(storyboard, "https://example.org/video.mp4");
  assert.equal(result.success, false);
  assert.equal(result.status, "NOT_CONFIGURED");
  assert.equal(result.castHash, undefined);
});

test("invalid video URLs cannot reach the Farcaster provider", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => ({
    ok: true, status: 200, json: async () => ({ cast: { hash: "0x" + "a".repeat(40) } })
  }));
  const broadcaster = new FarcasterBroadcaster({ neynarApiKey: "test-key", signerUuid: "test-signer" });
  for (const url of [undefined, "", "file:///private/video.mp4", "javascript:alert(1)", "http://example.org/video.mp4", "https://user:secret@example.org/video.mp4"]) {
    const result = await broadcaster.broadcastCast(storyboard, url);
    assert.equal(result.success, false);
    assert.equal(result.status, "INVALID_VIDEO_URL");
  }
  assert.equal(network.mock.callCount(), 0);
});

test("provider 200 without a valid cast hash is not publication evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, status: 200, json: async () => ({}) }));
  const broadcaster = new FarcasterBroadcaster({ neynarApiKey: "test-key", signerUuid: "test-signer" });
  const result = await broadcaster.broadcastCast(storyboard, "https://example.org/video.mp4");
  assert.equal(result.success, false);
  assert.equal(result.status, "OUTCOME_UNKNOWN");
  assert.equal(result.castHash, undefined);
});

test("a valid mocked cast response is acceptance, not independent verification", async (t) => {
  const hash = "0x" + "a".repeat(40);
  const network = t.mock.method(globalThis, "fetch", async (_url, request) => {
    assert.equal(request.method, "POST");
    assert.equal(JSON.parse(request.body).embeds[0].url, "https://example.org/video.mp4");
    assert.ok(request.signal);
    return { ok: true, status: 200, json: async () => ({ cast: { hash } }) };
  });
  const broadcaster = new FarcasterBroadcaster({ neynarApiKey: "test-key", signerUuid: "test-signer" });
  const result = await broadcaster.broadcastCast(storyboard, "https://example.org/video.mp4");
  assert.equal(result.success, true);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.castHash, hash);
  assert.equal(result.independentlyVerified, false);
  assert.equal(network.mock.callCount(), 1);
});

test("transport errors require reconciliation and do not leak provider errors", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("private-provider-detail"); });
  const broadcaster = new FarcasterBroadcaster({ neynarApiKey: "test-key", signerUuid: "test-signer" });
  const result = await broadcaster.broadcastCast(storyboard, "https://example.org/video.mp4");
  assert.deepEqual(result, { success: false, status: "OUTCOME_UNKNOWN", requiresReconciliation: true });
  assert.equal(JSON.stringify(result).includes("private-provider-detail"), false);
  assert.equal(network.mock.callCount(), 1);
});

for (const [status, expected, reconcile] of [[401, "REJECTED", false], [500, "OUTCOME_UNKNOWN", true]]) {
  test(`provider HTTP ${status} is not successful publication`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => ({ ok: false, status }));
    const broadcaster = new FarcasterBroadcaster({ neynarApiKey: "test-key", signerUuid: "test-signer" });
    const result = await broadcaster.broadcastCast(storyboard, "https://example.org/video.mp4");
    assert.equal(result.success, false);
    assert.equal(result.status, expected);
    assert.equal(result.requiresReconciliation, reconcile);
  });
}

// Accepted uploads below are deliberately synthetic adapter fixtures, never provider receipts.
const acceptedDrive = {
  success: true, publiclyAccessible: true, fileId: "fixture_drive_001",
  shareableLink: "https://drive.google.com/file/d/fixture_drive_001/view"
};
const acceptedYoutube = {
  success: true, publiclyAccessible: true, videoId: "fixture_yt1",
  watchUrl: "https://youtube.com/shorts/fixture_yt1"
};

function fakeAdapters(drive = acceptedDrive, youtube = acceptedYoutube) {
  const calls = [];
  return {
    calls,
    distributor: {
      async uploadToGoogleDrive() { calls.push("drive"); return drive; },
      async publishToYouTube() { calls.push("youtube"); return youtube; },
      generateReadmeEmbed(_title, url) { calls.push(["embed", url]); return "fixture embed"; },
      injectIntoReadme() { calls.push("readme"); return true; }
    },
    broadcaster: {
      async broadcastCast(_storyboard, url) { calls.push(["cast", url]); return { success: true, status: "ACCEPTED" }; }
    }
  };
}

test("render-only execution calls no distribution adapter", async () => {
  const adapters = fakeAdapters();
  assert.deepEqual(await distributeVideo("fixture.mp4", storyboard, {}, adapters), { status: "NOT_REQUESTED", success: null });
  assert.deepEqual(adapters.calls, []);
});

test("publish does not authorize Farcaster even when uploads succeed", async () => {
  const adapters = fakeAdapters();
  const result = await distributeVideo("fixture.mp4", storyboard, { publish: true, localPath: "fixture-repo" }, adapters);
  assert.equal(result.success, true);
  assert.equal(result.farcasterCast, undefined);
  assert.deepEqual(adapters.calls, ["drive", "youtube", ["embed", acceptedYoutube.watchUrl], "readme"]);
});

test("Farcaster-only request never authorizes Google uploads or README mutation", async () => {
  const adapters = fakeAdapters();
  const result = await distributeVideo("fixture.mp4", storyboard, { farcaster: true, localPath: "fixture-repo" }, adapters);
  assert.equal(result.success, false);
  assert.equal(result.farcasterCast.reason, "NO_ACCEPTED_PUBLIC_VIDEO");
  assert.deepEqual(adapters.calls, []);
});

test("real unimplemented adapters cannot reach social publishing or README writes", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { throw new Error("No network allowed"); });
  const distributor = new DistributionEngine();
  const readme = t.mock.method(distributor, "injectIntoReadme", () => { throw new Error("No file writes allowed"); });
  const result = await distributeVideo("missing-test-file.mp4", storyboard, {
    publish: true, farcaster: true, localPath: "fixture-repo", neynarApiKey: "test-key", signerUuid: "test-signer"
  }, { distributor });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.driveUpload.status, "NOT_IMPLEMENTED");
  assert.equal(result.ytShort.status, "NOT_IMPLEMENTED");
  assert.equal(result.farcasterCast.status, "BLOCKED");
  assert.equal(network.mock.callCount(), 0);
  assert.equal(readme.mock.callCount(), 0);
});

test("unaccepted, private, malformed or mismatched links cannot fan out", async () => {
  const badUploads = [
    { ...acceptedYoutube, success: false },
    { ...acceptedYoutube, publiclyAccessible: undefined },
    { ...acceptedYoutube, publiclyAccessible: false },
    { ...acceptedYoutube, videoId: undefined },
    { ...acceptedYoutube, watchUrl: "https://example.org/unrelated" },
    { ...acceptedYoutube, watchUrl: "https://youtube.com/shorts/different_id" },
    { ...acceptedYoutube, watchUrl: "javascript:alert(1)" },
    { ...acceptedYoutube, watchUrl: "https://secret:token@youtube.com/shorts/fixture_yt1" }
  ];
  for (const youtube of badUploads) {
    const adapters = fakeAdapters({ success: false }, youtube);
    const result = await distributeVideo("fixture.mp4", storyboard, { publish: true, farcaster: true, localPath: "fixture-repo" }, adapters);
    assert.equal(result.success, false);
    assert.equal(result.farcasterCast.status, "BLOCKED");
    assert.deepEqual(adapters.calls, ["drive", "youtube"]);
  }
});

test("explicit Farcaster request may use accepted Drive fallback without hiding partial failure", async () => {
  const adapters = fakeAdapters(acceptedDrive, { success: false, status: "NOT_IMPLEMENTED" });
  const result = await distributeVideo("fixture.mp4", storyboard, { publish: true, farcaster: true }, adapters);
  assert.equal(result.farcasterCast.status, "ACCEPTED");
  assert.equal(result.success, false);
  assert.equal(result.status, "INCOMPLETE");
  assert.deepEqual(adapters.calls, ["drive", "youtube", ["cast", acceptedDrive.shareableLink]]);
});

test("adapter exception does not manufacture a URL, leak details, or retry", async () => {
  const adapters = fakeAdapters({ success: false }, { success: false });
  adapters.distributor.uploadToGoogleDrive = async () => { adapters.calls.push("drive"); throw new Error("secret-detail"); };
  const result = await distributeVideo("fixture.mp4", storyboard, { publish: true, farcaster: true }, adapters);
  assert.equal(result.driveUpload.status, "OUTCOME_UNKNOWN");
  assert.equal(result.driveUpload.requiresReconciliation, true);
  assert.equal(result.farcasterCast.status, "BLOCKED");
  assert.equal(JSON.stringify(result).includes("secret-detail"), false);
  assert.deepEqual(adapters.calls, ["drive", "youtube"]);
});

test("a failed local README update cannot produce an overall complete status", async () => {
  const adapters = fakeAdapters();
  adapters.distributor.injectIntoReadme = () => { throw new Error("read-only"); };
  const result = await distributeVideo("fixture.mp4", storyboard, { publish: true, localPath: "fixture-repo" }, adapters);
  assert.equal(result.success, false);
  assert.equal(result.readmeUpdated, false);
  assert.equal(result.readmeError, "README_UPDATE_FAILED");
});
