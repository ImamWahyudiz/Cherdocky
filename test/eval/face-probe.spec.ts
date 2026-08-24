import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, '..');

test('pixel statistics of detection boxes', async ({ page }) => {
  await page.goto('/test/eval/runner.html');
  await page.waitForFunction(() => typeof (window as any).runFaces === 'function', null, { timeout: 120_000 });

  const docs = ['IDn, DOB, no keyword address, DD.jpg', 'INDONESIAN_IDCARD_034415.jpg'];
  const b64s = docs.map((d) => fs.readFileSync(path.join(TEST_DIR, d)).toString('base64'));

  const out = await page.evaluate(async (b64s) => {
    function boxStats(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
      const data = ctx.getImageData(x, y, w, h).data;
      let skin = 0;
      let total = 0;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y2 = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        // Generous multi-skin-tone YCbCr window
        if (cb >= 77 && cb <= 130 && cr >= 132 && cr <= 180 && y2 > 40 && y2 < 250) skin++;
        total++;
        sum += y2;
        sumSq += y2 * y2;
      }
      const mean = sum / total;
      return {
        skinFrac: +(skin / total).toFixed(3),
        lumMean: +mean.toFixed(1),
        lumStd: +Math.sqrt(sumSq / total - mean * mean).toFixed(1),
      };
    }

    const results: any[] = [];
    for (const b64str of b64s) {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = 'data:image/jpeg;base64,' + b64str; });
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const dets = await (window as any).runFaces(img);
      results.push({
        w: img.naturalWidth,
        h: img.naturalHeight,
        dets: dets.map((d: any) => ({ ...d, stats: boxStats(ctx, Math.round(d.x), Math.round(d.y), Math.round(d.w), Math.round(d.h)) })),
      });
    }
    return results;
  }, b64s);

  console.log(JSON.stringify(out, null, 1));
});
