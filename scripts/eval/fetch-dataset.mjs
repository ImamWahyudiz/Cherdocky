// Downloads the Indonesian OCR dataset from Kaggle into test/fixtures/kaggle/.
// Requires Kaggle API credentials via env: KAGGLE_USERNAME and KAGGLE_KEY
// (or a ~/.kaggle/kaggle.json). No files are shipped with the app.
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gunzipSync, unzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'kaggle');
const DATASET = 'appenlimited/ocr-image-data-of-indonesian-language-documents';

async function getCredentials() {
  if (process.env.KAGGLE_USERNAME && process.env.KAGGLE_KEY) {
    return Buffer.from(`${process.env.KAGGLE_USERNAME}:${process.env.KAGGLE_KEY}`).toString('base64');
  }
  try {
    const raw = execSync('cat ~/.kaggle/kaggle.json', { encoding: 'utf8' });
    const { username, key } = JSON.parse(raw);
    return Buffer.from(`${username}:${key}`).toString('base64');
  } catch {
    throw new Error('Kaggle credentials not found. Set KAGGLE_USERNAME/KAGGLE_KEY or ~/.kaggle/kaggle.json');
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const auth = await getCredentials();
  const url = `https://www.kaggle.com/api/v1/datasets/download/${DATASET}?archiveType=zip`;
  console.log(`Downloading ${DATASET} ...`);
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Kaggle download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zipPath = join(OUT_DIR, 'dataset.zip');
  await writeFile(zipPath, buf);
  console.log(`Saved ${zipPath} (${(buf.length / 1e6).toFixed(1)} MB)`);
  try {
    const files = unzipSync(buf);
    for (const [name, content] of Object.entries(files)) {
      const dest = join(OUT_DIR, name);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    }
    console.log('Extracted dataset.');
    await rm(zipPath);
  } catch (e) {
    console.warn('Auto-extract failed (zip may be gzip):', e.message);
    try {
      const inner = gunzipSync(buf);
      await writeFile(zipPath.replace('.zip', '.tar'), inner);
      console.log('Saved decompressed archive for manual extraction.');
    } catch {}
  }
  console.log(`Dataset ready at ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
