import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PhotoCraftProcessor } from '../src/core/PhotoCraftProcessor.mjs';
import { buildPostizDraft, stagePostizDraft } from '../src/core/PostizDraftBridge.mjs';

function fixture(t, mode = 'ok') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-photocraft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const inputRoot = path.join(root, 'in');
  fs.mkdirSync(inputRoot);
  const source = path.join(inputRoot, 'synthetic.jpg');
  fs.writeFileSync(source, 'SYNTHETIC INPUT - NOT AN IMAGE');
  const calls = [];
  const runner = (_, args) => {
    calls.push(args);
    if (args[0] === 'info') return JSON.stringify({ width: 1080, height: mode === 'wrong-size' && args[1].endsWith('processed.jpg') ? 1000 : 1440 });
    if (mode === 'timeout') throw new Error('synthetic timeout');
    const out = args[args.indexOf('--out') + 1];
    if (mode !== 'missing') fs.writeFileSync(out, mode === 'empty' ? '' : 'SYNTHETIC OUTPUT - NOT AN IMAGE');
    if (mode === 'changed') fs.appendFileSync(source, 'changed');
    if (mode === 'command-error') return '{"command":"image.imageSize","error":"synthetic"}';
    return '{"command":"image.imageSize","result":{}}\n{"command":"image.adjustments.brightnessContrast","result":null}\n';
  };
  return { source, root, calls, processor: new PhotoCraftProcessor({ executable: process.execPath, inputRoots: [inputRoot], outputDir: path.join(root, 'out'), runner }) };
}

test('synthetic adapter control: copied input, complete results and separate receipt', t => {
  const { processor, source, calls } = fixture(t);
  const result = processor.process(source);
  assert.equal(result.state, 'LOCAL_RENDERED');
  assert.equal(result.published, false);
  assert.equal(result.visualReview, 'REQUIRED');
  assert.equal(result.originalsPreserved, true);
  assert.match(result.outputSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(calls.find(args => args[0] === 'run')[1], source);
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath)).state, 'LOCAL_RENDERED');
});
for (const mode of ['timeout', 'missing', 'empty', 'changed', 'command-error', 'wrong-size']) {
  test(`fails closed on ${mode}`, t => {
    const { processor, source } = fixture(t, mode);
    assert.throws(() => processor.process(source));
  });
}
test('rejects path escape and unbounded recipe before execution', t => {
  const { processor, root, source, calls } = fixture(t);
  const outside = path.join(root, 'outside.jpg');
  fs.writeFileSync(outside, 'SYNTHETIC');
  assert.throws(() => processor.process(outside), /outside/);
  for (const options of [{ maxSide: Infinity }, { maxSide: 9000 }, { quality: 1 }, { contrast: 100 }, { maxSide: 1000.5 }]) {
    assert.throws(() => processor.process(source, options));
  }
  assert.equal(calls.length, 0);
});

const draft = { integrationId: 'synthetic-channel', content: 'Actual photo <not a claim>', media: [{ id: 'synthetic-upload', path: 'https://uploads.postiz.com/synthetic.jpg' }], settings: [{ key: 'post_type', value: 'post' }] };
test('draft-only even if caller supplies now; escapes content', () => {
  const payload = buildPostizDraft({ ...draft, type: 'now' });
  assert.equal(payload.socialPost[0].type, 'draft');
  assert.match(payload.socialPost[0].postsAndComments[0].content, /&lt;not a claim&gt;/);
});
for (const url of ['file:///photo.jpg', 'http://uploads.postiz.com/a.jpg', 'https://uploads.postiz.com.evil.test/a.jpg', 'https://uploads.postiz.com@evil.test/a.jpg', 'https://uploads.postiz.com/a.jpg?redirect=1', 'https://uploads.postiz.com/a.svg']) {
  test(`rejects unqualified attachment ${url}`, () => assert.throws(() => buildPostizDraft({ ...draft, media: [{ id: 'synthetic', path: url }] })));
}
test('requires media id and bounded text', () => {
  assert.throws(() => buildPostizDraft({ ...draft, media: [{ path: draft.media[0].path }] }));
  assert.throws(() => buildPostizDraft({ ...draft, content: '' }));
});
test('provider acceptance remains draft, readback still required', async () => {
  const receipt = await stagePostizDraft(draft, async () => ({ output: [{ postId: 'synthetic-post', integration: draft.integrationId }] }));
  assert.equal(receipt.state, 'DRAFT_ACCEPTED');
  assert.equal(receipt.readback, 'REQUIRED');
  assert.equal(receipt.published, false);
});
test('ambiguous transport and provider failures require reconciliation, never retry', async () => {
  for (const transport of [async () => { throw new Error('timeout'); }, async () => ({}), async () => ({ output: { errors: 'rejected' } }), async () => ({ output: [{ postId: 'x', integration: 'wrong' }] })]) {
    assert.equal((await stagePostizDraft(draft, transport)).state, 'OUTCOME_UNKNOWN');
  }
});
