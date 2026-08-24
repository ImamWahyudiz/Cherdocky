# Benchmarks & Regression Gate

Cherdocky's quality system: three benchmark suites, frozen baselines, and a gate script that fails loudly on regressions. If you touch `src/utils/ocrEngine.ts`, `piiDetector.ts`, `documentClassifier.ts`, or `faceDetector.ts`, run the gate.

## Suites

| Suite | Spec | What it measures | Baseline |
|-------|------|------------------|----------|
| KTP region | `test/eval/ktp-region-eval.spec.ts` | PII detection vs YOLO field boxes on 20 generated cards (stride-sampled) | `test/eval/baseline-ktp-metrics.json` |
| Synthetic multi-doc | `test/eval/synthetic-eval.spec.ts` + `synthDocs.ts` | word recall/precision, digit recall on 6 deterministic renders (bank mutation, chats light/dark, receipt, social post, article) | `test/eval/baseline-synthetic-metrics.json` |
| Face detection | `test/eval/face-eval.spec.ts` | detection quality across constructed slices (below) | `test/eval/baseline-face-metrics.json` |

Plus unit tests (`npx vitest run`) for PII precision rules.

## Current numbers

```
KTP        overallRecall=68.3%  falseAutoRate=0%   (baseline was 50.8% / 4.8%)
Synthetic  wordRecall=94.6%  wordPrecision=97.9%  digitRecall=73.1%
Faces      gridCoverage=95%  rotations=100%  collage=100%/100%  negativesFP=0
```

## Running

```bash
npm run eval            # everything (~7 min): OCR + synthetic + face
npm run eval:ktp        # KTP only (~5 min)
npm run eval:synthetic  # synthetic only (~2 min)
npx playwright test face-eval  # faces only (~2 min)
node scripts/eval/gate.mjs     # compare against baselines, fail on regression
```

**Ordering matters**: each Playwright run *wipes* `test-results/` (its output dir). The gate reads metric JSONs from there — always run the gate immediately after producing all three files, i.e. after a full `npm run eval`.

## The gate

`scripts/eval/gate.mjs` compares current vs baseline with tolerances:

- KTP field recalls / overallRecall: drop ≤ 5 pts; falseAutoRate rise ≤ 5 pts
- Synthetic metrics: drop ≤ 2 pts (deterministic renders get a strict bar)
- Faces: rate drops ≤ 5 pts; **false positives on face-free negatives capped absolutely at ~0**

Soft sections skip with a warning when their metric files are missing.

### Re-baselining

When you intentionally trade metrics (documented in the commit), copy current → baseline:

```powershell
Copy-Item test-results\ktp-region-metrics.json test\eval\baseline-ktp-metrics.json -Force
```

Rules for honest re-baselining:
1. The tradeoff must be understood and written down (commit message).
2. Overall direction must be positive, not just shifted loss.
3. Never re-baseline to make the gate green without understanding why it went red.

## How face-eval works (construction-based ground truth)

No hand-labeling — GT comes from how each image is built:

| Slice | Construction | Ground truth |
|-------|--------------|--------------|
| Dense grids | real grid images with counts in filenames (12/15 faces) | expected count |
| Collages | Friends crops pasted on canvas in known cells | paste rects |
| Rotations | single-face crops rotated ±15°/±30° onto gray canvas | ≥1 detection |
| ID docs | scans containing portrait(s) | ≥1 hit; extras recorded informationally* |
| Negatives | text documents + procedural texture fields (no faces) | 0 detections |
| Friends real | TV-series photos | none — informational only |

\* Pixel analysis showed "extra" boxes on some IDs have 60–88% skin-tone pixels — genuine secondary portraits. Over-redaction is the safe failure mode for a redactor, so extras are reported but not penalized.

**Overfit guard**: the Friends dataset is one TV series. It never steers tuning decisions and is excluded from strict metrics; slices that steer changes are constructed from geometry, not from any person's photos.

Scoring detail: collages match detections to cells by **center-in-cell**, not IoU — a tight face box inside a whole-person crop can't reach high IoU against the crop rect.
