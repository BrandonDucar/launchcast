import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { boundedNumber, prepareOutputDir, regularInput, requireArtifact, runProcess } from './ProcessSafety.mjs';

const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function dimensions(info) {
  for (const key of ['width', 'height']) {
    if (!Number.isInteger(info?.[key]) || info[key] < 1 || info[key] > 16384) {
      throw new Error('Invalid image dimensions');
    }
  }
  if (info.width * info.height > 50000000) throw new Error('Image pixel budget exceeded');
  return { width: info.width, height: info.height };
}

/** A local, bounded PhotoCraft recipe. Does not upload, publish, or grant media rights. */
export class PhotoCraftProcessor {
  constructor({ executable, inputRoots, outputDir, runner = runProcess }) {
    this.executable = fs.realpathSync(executable);
    if (!fs.statSync(this.executable).isFile()) throw new Error('PhotoCraft executable required');
    this.inputRoots = inputRoots.map(root => fs.realpathSync(root));
    this.outputDir = prepareOutputDir(outputDir);
    this.runner = runner;
  }

  inspect(file) {
    return dimensions(JSON.parse(String(this.runner(this.executable, ['info', file, '--compact']))));
  }

  process(input, { maxSide = 1440, brightness = 2, contrast = 8, quality = 92 } = {}) {
    boundedNumber(maxSide, 'Maximum side', 256, 4096);
    boundedNumber(brightness, 'Brightness', -15, 15);
    boundedNumber(contrast, 'Contrast', -15, 20);
    boundedNumber(quality, 'JPEG quality', 70, 100);
    if (!Number.isInteger(maxSide) || !Number.isInteger(quality)) throw new Error('Integer size and quality required');
    const source = regularInput(input, this.inputRoots, MAX_IMAGE_BYTES);
    if (!/\.(jpe?g|png|webp)$/i.test(source)) throw new Error('Unsupported source format');
    const sourceSha256 = hash(source);
    const original = this.inspect(source);
    const ratio = Math.min(1, maxSide / Math.max(original.width, original.height));
    const expected = { width: Math.max(1, Math.round(original.width * ratio)), height: Math.max(1, Math.round(original.height * ratio)) };
    // Copy first: the editor never opens the original, even when a recipe fails.
    const job = fs.mkdtempSync(path.join(this.outputDir, 'photocraft-'));
    const copy = path.join(job, `source${path.extname(source).toLowerCase()}`);
    fs.copyFileSync(source, copy, fs.constants.COPYFILE_EXCL);
    if (hash(copy) !== sourceSha256) throw new Error('Source changed while copying');
    const output = path.join(job, 'processed.jpg');
    const recipe = [
      ['image.imageSize', { ...expected, resample: 'lanczos' }],
      ['image.adjustments.brightnessContrast', { brightness, contrast }],
    ];
    const args = ['run', copy];
    for (const [command, params] of recipe) args.push('--cmd', command, '--params', JSON.stringify(params));
    args.push('--out', output, '--quality', String(quality));
    const stdout = String(this.runner(this.executable, args));
    const results = stdout.split(/\r?\n/).filter(line => line.trim().startsWith('{')).map(line => JSON.parse(line));
    if (results.length !== recipe.length || results.some((r, i) => r.command !== recipe[i][0] || r.error || r.result?.error || r.result?.success === false)) {
      throw new Error('PhotoCraft command results incomplete or failed');
    }
    const stat = requireArtifact(output);
    if (stat.size > MAX_IMAGE_BYTES) throw new Error('Output byte budget exceeded');
    const actual = this.inspect(output);
    if (actual.width !== expected.width || actual.height !== expected.height) throw new Error('Output dimensions mismatch');
    if (hash(source) !== sourceSha256) throw new Error('Original changed during processing');
    const receipt = {
      schema: 'launchcast.photocraft.local-render.v1', state: 'LOCAL_RENDERED',
      createdAt: new Date().toISOString(), source, sourceSha256, original,
      output, outputSha256: hash(output), bytes: stat.size, dimensions: actual,
      executableSha256: hash(this.executable), recipe, quality,
      originalsPreserved: true, visualReview: 'REQUIRED', uploaded: false, published: false,
    };
    const receiptPath = path.join(job, 'receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { ...receipt, receiptPath };
  }
}
