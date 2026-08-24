import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE = path.join(ROOT, 'test', 'eval', 'baseline-ktp-metrics.json');
const CURRENT = path.join(ROOT, 'test-results', 'ktp-region-metrics.json');
const SYNTH_BASELINE = path.join(ROOT, 'test', 'eval', 'baseline-synthetic-metrics.json');
const SYNTH_CURRENT = path.join(ROOT, 'test-results', 'synthetic-metrics.json');

// Regression tolerance (absolute percentage points).
const RECALL_DROP_TOLERANCE = 0.05;
const FALSEAUTO_RISE_TOLERANCE = 0.05;
// Synthetic docs are deterministic renders — hold them to a stricter bar.
const SYNTH_DROP_TOLERANCE = 0.02;

function fail(msg) {
  console.error(`\n[x] GATE FAILED: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(BASELINE)) fail(`baseline metrics missing: ${BASELINE}`);
if (!fs.existsSync(CURRENT)) {
  console.log('[gate] no current metrics — run `npm run eval:ktp` first. Gate skipped (soft).');
  process.exit(0);
}

const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const cur = JSON.parse(fs.readFileSync(CURRENT, 'utf8'));

let failures = 0;

console.log('\n=== KTP region gate ===');
const classes = new Set([...Object.keys(base.fields ?? {}), ...Object.keys(cur.fields ?? {})]);
for (const cls of classes) {
  const b = base.fields?.[cls];
  const c = cur.fields?.[cls];
  if (!b || !c) {
    console.log(`  ${cls.padEnd(24)} MISSING (${!b ? 'in baseline' : 'in current'})`);
    continue;
  }
  const delta = c.recall - b.recall;
  const bad = delta < -RECALL_DROP_TOLERANCE;
  if (bad) failures++;
  console.log(
    `  ${cls.padEnd(24)} recall ${(b.recall * 100).toFixed(0).padStart(3)}% -> ${(c.recall * 100).toFixed(0).padStart(3)}%  ` +
      `(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pts)${bad ? '  << REGRESSION' : ''}`,
  );
}

const dOverall = cur.overallRecall - base.overallRecall;
const overallBad = dOverall < -RECALL_DROP_TOLERANCE;
if (overallBad) failures++;
console.log(
  `  ${'overallRecall'.padEnd(24)} ${(base.overallRecall * 100).toFixed(1)}% -> ${(cur.overallRecall * 100).toFixed(1)}%  ` +
    `(${dOverall >= 0 ? '+' : ''}${(dOverall * 100).toFixed(1)}pts)${overallBad ? '  << REGRESSION' : ''}`,
);

const dFalse = cur.falseAutoRate - base.falseAutoRate;
const falseBad = dFalse > FALSEAUTO_RISE_TOLERANCE;
if (falseBad) failures++;
console.log(
  `  ${'falseAutoRate'.padEnd(24)} ${(base.falseAutoRate * 100).toFixed(1)}% -> ${(cur.falseAutoRate * 100).toFixed(1)}%  ` +
    `(${dFalse >= 0 ? '+' : ''}${(dFalse * 100).toFixed(1)}pts)${falseBad ? '  << REGRESSION' : ''}`,
);

if (failures > 0) fail(`${failures} metric regression(s) exceed tolerance`);
console.log('\n[ok] KTP gate passed');

// --- Synthetic multi-doc gate -------------------------------------------
// Deterministic rendered documents (bank mutation, chats, receipt, …)
// measuring generic text extraction — the mission-level benchmark.
if (!fs.existsSync(SYNTH_BASELINE) || !fs.existsSync(SYNTH_CURRENT)) {
  console.log('[gate] synthetic metrics missing — run synthetic-eval first. Synthetic section skipped (soft).');
} else {
  const sb = JSON.parse(fs.readFileSync(SYNTH_BASELINE, 'utf8'));
  const sc = JSON.parse(fs.readFileSync(SYNTH_CURRENT, 'utf8'));

  console.log('\n=== Synthetic extraction gate ===');
  let synthFailures = 0;
  for (const key of ['wordRecall', 'wordPrecision', 'digitRecall']) {
    const b = sb.aggregate?.[key];
    const c = sc.aggregate?.[key];
    if (typeof b !== 'number' || typeof c !== 'number') continue;
    const delta = c - b;
    const bad = delta < -SYNTH_DROP_TOLERANCE;
    if (bad) synthFailures++;
    console.log(
      `  ${key.padEnd(14)} ${(b * 100).toFixed(1).padStart(5)}% -> ${(c * 100).toFixed(1).padStart(5)}%  ` +
        `(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pts)${bad ? '  << REGRESSION' : ''}`,
    );
  }
  if (synthFailures > 0) fail(`${synthFailures} synthetic regression(s) exceed tolerance`);
  console.log('[ok] Synthetic gate passed');
}

// --- Face detection gate --------------------------------------------------
// Multi-scale BlazeFace pipeline measured on constructed slices (dense grids
// with known counts, synthetic collages, rotations, face-free negatives).
const FACE_BASELINE = path.join(ROOT, 'test', 'eval', 'baseline-face-metrics.json');
const FACE_CURRENT = path.join(ROOT, 'test-results', 'face-metrics.json');
const FACE_DROP_TOLERANCE = 0.05;

if (!fs.existsSync(FACE_BASELINE) || !fs.existsSync(FACE_CURRENT)) {
  console.log('[gate] face metrics missing — run `npx playwright test face-eval` first. Face section skipped (soft).');
} else {
  const fb = JSON.parse(fs.readFileSync(FACE_BASELINE, 'utf8'));
  const fc = JSON.parse(fs.readFileSync(FACE_CURRENT, 'utf8'));

  console.log('\n=== Face detection gate ===');
  let faceFailures = 0;
  const checkRate = (label, b, c) => {
    if (typeof b !== 'number' || typeof c !== 'number') return;
    const delta = c - b;
    const bad = delta < -FACE_DROP_TOLERANCE;
    if (bad) faceFailures++;
    console.log(
      `  ${label.padEnd(24)} ${(b * 100).toFixed(1).padStart(5)}% -> ${(c * 100).toFixed(1).padStart(5)}%  ` +
        `(${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pts)${bad ? '  << REGRESSION' : ''}`,
    );
  };

  checkRate('gridMeanCoverage', fb.gridMeanCoverage, fc.gridMeanCoverage);
  checkRate('idDocRecall', fb.idDocRecall, fc.idDocRecall);
  checkRate('collageRecall', fb.collageRecall, fc.collageRecall);
  for (const angle of Object.keys(fb.rotated ?? {})) {
    checkRate(`rotated ${angle}deg`, fb.rotated[angle]?.recall, fc.rotated?.[angle]?.recall);
  }

  // False positives on face-free negatives: absolute cap, not a delta —
  // any textured-scene hallucination redacts real user content.
  const fpBase = (fb.negatives?.detections ?? 0) / Math.max(1, fb.negatives?.images ?? 1);
  const fpCur = (fc.negatives?.detections ?? 0) / Math.max(1, fc.negatives?.images ?? 1);
  const fpBad = fpCur > Math.max(fpBase, 0.01);
  if (fpBad) faceFailures++;
  console.log(
    `  ${'negativesFPPerImage'.padEnd(24)} ${fpBase.toFixed(2).padStart(5)} -> ${fpCur.toFixed(2).padStart(5)}   ${fpBad ? '<< REGRESSION' : ''}`,
  );

  // Informational only: real group photos have no ground truth, and extra
  // boxes on ID docs may be genuine secondary portraits.
  const friendsRate = (fc.friends.imagesWithDetection / Math.max(1, fc.friends.images)) * 100;
  console.log(
    `  [info] friends(real): detRate=${friendsRate.toFixed(0)}% avgDets=${(fc.friends.detections / Math.max(1, fc.friends.images)).toFixed(1)} idDocOverdetect=${((fc.idDocOverdetectRate ?? 0) * 100).toFixed(0)}%`,
  );

  if (faceFailures > 0) fail(`${faceFailures} face regression(s) exceed tolerance`);
  console.log('[ok] Face gate passed');
}

console.log('\n[ok] GATE PASSED\n');
