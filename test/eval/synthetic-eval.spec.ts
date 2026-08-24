import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTH_DOCS } from './synthDocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_OUT = path.resolve(__dirname, '../../test-results/synthetic-metrics.json');

/**
 * Synthetic document benchmark for GENERIC text extraction quality.
 *
 * Renders realistic UI-style documents (bank mutation, social post, chat,
 * receipt, article, dark-mode UI) as screenshots with exact known
 * transcripts, then runs the real app OCR pipeline end-to-end and scores
 * word-level recall/precision plus digit-run recall.
 *
 * No local dataset required — fully self-contained, CI-friendly.
 */

// --- Scoring ----------------------------------------------------------------

/** Lowercase alphanumerics only — tolerant to punctuation differences. */
function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bagOf(text: string): Map<string, number> {
  const bag = new Map<string, number>();
  for (const raw of text.split(/\s+/)) {
    const t = normToken(raw);
    if (!t) continue;
    bag.set(t, (bag.get(t) ?? 0) + 1);
  }
  return bag;
}

/** Digit runs of length >= 2 — captures amounts, dates, times, phone bits. */
function digitRuns(text: string): Map<string, number> {
  const runs = new Map<string, number>();
  for (const r of text.match(/\d{2,}/g) ?? []) {
    runs.set(r, (runs.get(r) ?? 0) + 1);
  }
  return runs;
}

function multisetRecall(expected: Map<string, number>, detected: Map<string, number>): number {
  let hit = 0;
  let total = 0;
  for (const [k, n] of expected) {
    total += n;
    hit += Math.min(n, detected.get(k) ?? 0);
  }
  return total === 0 ? 1 : hit / total;
}

test.describe('Synthetic document extraction eval', () => {
  test('scores word/digit recall across rendered UI documents', async ({ page }) => {
    test.setTimeout(600_000); // 6 docs x up to ~60s OCR
    await page.goto('/test/eval/runner.html');
    await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, {
      timeout: 120_000,
    });

    const results: Record<
      string,
      { wordRecall: number; wordPrecision: number; digitRecall: number; detectedWords: number }
    > = {};

    for (const doc of SYNTH_DOCS) {
      await page.setContent(doc.html);
      const el = page.locator('#doc');
      const buf = await el.screenshot({ type: 'png' });

      const result = await page.evaluate(async ({ b64, name }: { b64: string; name: string }) => {
        const res = await fetch('data:application/octet-stream;base64,' + b64);
        const blob = await res.blob();
        const file = new File([blob], name + '.png');
        return await (window as any).runEval(file);
      }, { b64: buf.toString('base64'), name: doc.name });

      const detectedText: string = result.text ?? '';
      const expBag = bagOf(doc.transcript);
      const detBag = bagOf(detectedText);
      const wordRecall = multisetRecall(expBag, detBag);
      const wordPrecision = multisetRecall(detBag, expBag);
      const digitRecall = multisetRecall(digitRuns(doc.transcript), digitRuns(detectedText));

      results[doc.name] = {
        wordRecall,
        wordPrecision,
        digitRecall,
        detectedWords: detectedText.split(/\s+/).filter(Boolean).length,
      };

      console.log(
        `[${doc.name}] wordRecall=${(wordRecall * 100).toFixed(1)}% wordPrecision=${(wordPrecision * 100).toFixed(1)}% digitRecall=${(digitRecall * 100).toFixed(1)}% words=${results[doc.name].detectedWords}`
      );

      // Persist screenshots for manual inspection when things look off.
      const shotDir = path.resolve(__dirname, '../../test-results/synthetic');
      fs.mkdirSync(shotDir, { recursive: true });
      fs.writeFileSync(path.join(shotDir, doc.name + '.png'), buf);
    }

    const names = Object.keys(results);
    const agg = {
      wordRecall: names.reduce((s, n) => s + results[n].wordRecall, 0) / names.length,
      wordPrecision: names.reduce((s, n) => s + results[n].wordPrecision, 0) / names.length,
      digitRecall: names.reduce((s, n) => s + results[n].digitRecall, 0) / names.length,
    };
    const metrics = { images: names.length, docs: results, aggregate: agg };
    console.log(
      `\n=== Synthetic extraction metrics ===\n  wordRecall=${(agg.wordRecall * 100).toFixed(1)}%  wordPrecision=${(agg.wordPrecision * 100).toFixed(1)}%  digitRecall=${(agg.digitRecall * 100).toFixed(1)}%`
    );

    fs.mkdirSync(path.dirname(METRICS_OUT), { recursive: true });
    fs.writeFileSync(METRICS_OUT, JSON.stringify(metrics, null, 2));

    expect(names.length).toBeGreaterThan(0);
    expect(agg.wordRecall).toBeGreaterThan(0);
  });
});
