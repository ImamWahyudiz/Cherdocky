import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTH_DOCS } from './synthDocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('ONNX single-doc diagnostic', async ({ page }) => {
  const ENGINE = (process.env.OCR_ENGINE as 'onnx' | 'tesseract') ?? 'tesseract';
  await page.goto(`/test/eval/runner.html?engine=${ENGINE}`);
  await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, { timeout: 120_000 });

  const doc = SYNTH_DOCS[0]; // bank_mutation
  await page.setContent(doc.html);
  const el = page.locator('#doc');
  const buf = await el.screenshot({ type: 'png' });
  const b64 = buf.toString('base64');

  const result = await page.evaluate(
    async ({ b64, name }: { b64: string; name: string }) => {
      const res = await fetch('data:application/octet-stream;base64,' + b64);
      const blob = await res.blob();
      const file = new File([blob], name);
      return await (window as any).runEval(file);
    },
    { b64, name: doc.name }
  );

  console.log('\n=== RAW OUTPUT ===');
  console.log('text:', result.text ?? '');
  console.log('---- words ----');
  for (const w of result.words ?? []) {
    console.log(`  [${Math.round(w.confidence)}] "${w.text}" @ (${Math.round(w.x)},${Math.round(w.y)}) ${Math.round(w.width)}x${Math.round(w.height)}`);
  }
  console.log('word count:', (result.words ?? []).length);
  // eslint-disable-next-line no-console
  console.log('=== DONE ===');
});