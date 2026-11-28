import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.PAJI_SKIP_PORTRAIT_ASSETS === '1') {
  console.warn('Skipping local portrait assets as configured. Opaque inputs require deployed portrait-model files.');
  process.exit(0);
}

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'public/portrait-model');
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('onnxruntime-web/wasm'));
const digest = '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8';
const model = join(target, 'u2netp.onnx');
const valid = bytes => bytes.length === 4_574_861 && createHash('sha256').update(bytes).digest('hex') === digest;

await mkdir(target, { recursive: true });
if (!await readFile(model).then(valid, () => false)) {
  const response = await fetch('https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx', { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error('Failed to download U²-NetP: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('U²-NetP checksum mismatch');
  await writeFile(model + '.tmp', bytes);
  await rename(model + '.tmp', model);
}
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(join(dist, file), join(target, file));
}
console.log('Portrait segmentation assets are ready (served by this app; no user image is uploaded).');
