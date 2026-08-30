import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTH_DOCS } from './synthDocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../test-results/diag-snapshots');

test('dump synthetic doc snapshots to disk', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const doc of SYNTH_DOCS) {
    await page.setContent(doc.html);
    const el = page.locator('#doc');
    const buf = await el.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(OUT, doc.name + '.png'), buf);
    console.log('saved', doc.name, buf.length, 'bytes');
  }
  console.log('DONE to', OUT);
});