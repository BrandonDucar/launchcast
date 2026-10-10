import { PhotoCraftProcessor } from '../src/core/PhotoCraftProcessor.mjs';

const [executable, inputRoot, outputDir, ...images] = process.argv.slice(2);
if (!executable || !inputRoot || !outputDir || images.length < 1 || images.length > 10) {
  throw new Error('Usage: node scripts/photocraft-process.mjs <cli-executable> <input-root> <output-dir> <1-10-images>');
}
const processor = new PhotoCraftProcessor({ executable, inputRoots: [inputRoot], outputDir });
for (const image of images) console.log(JSON.stringify(processor.process(image)));
