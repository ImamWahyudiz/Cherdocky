import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTH_DOCS } from './synthDocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ONNX app_screen@half diagnostic', async ({ page }) => {
  const ENGINE = (process.env.OCR_ENGINE as 'onnx' | 'tesseract') ?? 'tesseract';
  await page.goto(`/test/eval/runner.html?engine=${ENGINE}`);
  await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, { timeout: 120_000 });

  const doc = SYNTH_DOCS.find(d => d.name === 'app_screen')!;
  await page.setContent(doc.html);
  const el = page.locator('#doc');
  const buf = await el.screenshot({ type: 'png' });
  const b64 = buf.toString('base64');

  // Apply half-scale degrade
  const degraded = await page.evaluate(async ({ b64, mode }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    const f = 0.5;
    c.width = Math.max(1, Math.round(img.width * f));
    c.height = Math.max(1, Math.round(img.height * f));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), ext: 'png' };
  }, { b64, mode: 'half' });

  // Call runEval (full pipeline)
  const result = await page.evaluate(
    async ({ b64, name }: { b64: string; name: string }) => {
      const res = await fetch('data:application/octet-stream;base64,' + b64);
      const blob = await res.blob();
      const file = new File([blob], name);
      return await (window as any).runEval(file);
    },
    { b64: degraded.b64, name: 'app_screen@half' }
  );

  console.log('\n=== app_screen@half DIAG ===');
  console.log('transcript:');
  console.log(doc.transcript);
  console.log('--- detected words ---');
  for (const w of result.words ?? []) {
    console.log(`  [${Math.round(w.confidence)}] "${w.text}" @ (${Math.round(w.x)},${Math.round(w.y)}) ${Math.round(w.width)}x${Math.round(w.height)}`);
  }
  console.log('=== END ===');
});

export { };