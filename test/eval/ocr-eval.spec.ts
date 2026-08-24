import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(__dirname, '..');

function listImages(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !/face|runner|test_runner/i.test(f));
}

// Character Error Rate (CER) via Levenshtein distance.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function cer(ocr: string, gt: string): number {
  const a = ocr.replace(/\s+/g, ' ').trim();
  const b = gt.replace(/\s+/g, ' ').trim();
  if (b.length === 0) return 0;
  return levenshtein(a, b) / b.length;
}

const IMAGES = listImages(FIXTURES);

test.describe('Cherdocky OCR + PII eval', () => {
  // Fixtures are local-only (gitignored personal/dataset media) — skip the
  // whole suite gracefully on a fresh clone / CI where they are absent.
  test.skip(IMAGES.length === 0, 'No local fixture images found');

  test.beforeAll(async ({ browser }) => {
    expect(IMAGES.length).toBeGreaterThan(0);
  });

  for (const name of IMAGES) {
    test(`evaluates ${name}`, async ({ page }) => {
      await page.goto('/test/eval/runner.html');
      await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, {
        timeout: 120_000,
      });
      const b64 = fs.readFileSync(path.join(FIXTURES, name)).toString('base64');

      const result = await page.evaluate(async ({ b64, name }) => {
        const res = await fetch('data:application/octet-stream;base64,' + b64);
        const blob = await res.blob();
        const file = new File([blob], name);
        return await (window as any).runEval(file);
      }, { b64, name });

      const gtPath = path.join(FIXTURES, name.replace(/\.[^.]+$/, '.gt.txt'));
      let cerValue: number | null = null;
      if (fs.existsSync(gtPath)) {
        cerValue = cer(result.text, fs.readFileSync(gtPath, 'utf8'));
      }

      const auto = result.matches.filter((m: any) => m.autoRedact).length;
      const review = result.matches.length - auto;

      console.log(
        `[${name}] words=${result.words.length} pii=${result.matches.length} auto=${auto} review=${review}` +
          (cerValue !== null ? ` cer=${(cerValue * 100).toFixed(1)}%` : ' cer=n/a'),
      );

      // Smoke: OCR should return text on a real document image. A 0-word
      // result is an OCR failure worth surfacing (recorded, not a hard crash).
      if (result.text.trim().length === 0) {
        console.warn(`[${name}] OCR returned 0 words — preprocessing/OCR failure`);
        const out = path.join(FIXTURES, name.replace(/\.[^.]+$/, '.eval.json'));
        fs.writeFileSync(out, JSON.stringify({ name, ocrFailed: true, words: 0, matches: [] }, null, 2));
        test.info().annotations.push({ type: 'warning', description: `OCR failed (0 words): ${name}` });
        return;
      }

      // Persist a per-file record.
      const out = path.join(FIXTURES, name.replace(/\.[^.]+$/, '.eval.json'));
      fs.writeFileSync(
        out,
        JSON.stringify(
          { name, cer: cerValue, words: result.words.length, text: result.text, matches: result.matches },
          null,
          2,
        ),
      );
    });
  }
});
