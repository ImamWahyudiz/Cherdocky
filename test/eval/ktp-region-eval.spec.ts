import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseYoloLabel,
  scoreImages,
  type FieldBox,
  type WordBox,
  type RegionMetrics,
} from './ktpGroundTruth';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, '..');
const DATASET_DIR = path.join(TEST_DIR, 'Generated E-ktp');
const IMAGES_DIR = path.join(DATASET_DIR, 'images');
const LABELS_DIR = path.join(DATASET_DIR, 'labels');
const METRICS_OUT = path.resolve(__dirname, '../../test-results/ktp-region-metrics.json');

// Deterministic sample: every Nth image keeps runtime ~minutes, not hours.
const SAMPLE_STRIDE = 5;

function listDatasetImages(): string[] {
  if (!fs.existsSync(IMAGES_DIR)) return [];
  return fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => /\.png$/i.test(f))
    .sort()
    .filter((_, i) => i % SAMPLE_STRIDE === 0);
}

interface RunResult {
  width: number;
  height: number;
  words: { text: string; x: number; y: number; width: number; height: number }[];
  matches: {
    type: string;
    wordIndex: number;
    autoRedact: boolean;
  }[];
}

test.describe('KTP field-region eval (generated set)', () => {
  const images = listDatasetImages();
  // Dataset is local-only and gitignored — skip cleanly on fresh clones/CI.
  test.skip(images.length === 0, 'Generated E-ktp dataset not present');

  test('scores PII detection against YOLO field boxes', async ({ page }) => {
    test.setTimeout(1_800_000); // 20 images x ~20-60s OCR
    await page.goto('/test/eval/runner.html');
    await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, {
      timeout: 120_000,
    });

    const runs: { fields: FieldBox[]; words: WordBox[] }[] = [];

    for (const name of images) {
      const b64 = fs.readFileSync(path.join(IMAGES_DIR, name)).toString('base64');
      const result: RunResult = await page.evaluate(async ({ b64, name }) => {
        const res = await fetch('data:application/octet-stream;base64,' + b64);
        const blob = await res.blob();
        const file = new File([blob], name);
        return await (window as any).runEval(file);
      }, { b64, name });

      const labelPath = path.join(LABELS_DIR, name.replace(/\.png$/i, '.txt'));
      expect(fs.existsSync(labelPath), `missing label for ${name}`).toBe(true);
      const fields = parseYoloLabel(labelPath, result.width, result.height);

      // Fold match types onto word indices.
      const piiByIndex = new Map<number, Set<string>>();
      const autoByIndex = new Map<number, boolean>();
      for (const m of result.matches) {
        const set = piiByIndex.get(m.wordIndex) ?? new Set<string>();
        set.add(m.type);
        piiByIndex.set(m.wordIndex, set);
        if (m.autoRedact) autoByIndex.set(m.wordIndex, true);
      }

      const wordBoxes: WordBox[] = result.words.map((w, i) => ({
        text: w.text,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        piiTypes: piiByIndex.get(i) ?? new Set<string>(),
        autoRedact: autoByIndex.get(i) ?? false,
      }));

      runs.push({ fields, words: wordBoxes });
    }

    const metrics: RegionMetrics = scoreImages(runs);

    console.log(`\n=== KTP region metrics (${metrics.images} images) ===`);
    for (const f of Object.values(metrics.fields)) {
      console.log(
        `  ${f.className.padEnd(22)} recall=${(f.recall * 100).toFixed(0).padStart(3)}%  (${f.detectedCount}/${f.gtCount})`,
      );
    }
    console.log(`  overallRecall=${(metrics.overallRecall * 100).toFixed(1)}%  falseAutoRate=${(metrics.falseAutoRate * 100).toFixed(1)}%`);

    fs.mkdirSync(path.dirname(METRICS_OUT), { recursive: true });
    fs.writeFileSync(METRICS_OUT, JSON.stringify(metrics, null, 2));

    // Sanity floor — real gating lives in scripts/eval/gate.mjs.
    expect(metrics.images).toBeGreaterThan(0);
    expect(metrics.autoWordCount).toBeGreaterThan(0);
  });
});
