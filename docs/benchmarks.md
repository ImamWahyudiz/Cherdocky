# Benchmarks & Regression Gate

Cherdocky's quality system: three benchmark suites, frozen baselines, and a gate script that fails loudly on regressions. If you touch `src/utils/ocrEngine.ts`, `piiDetector.ts`, `documentClassifier.ts`, or `faceDetector.ts`, run the gate.

## Suites

| Suite | Spec | What it measures | Baseline |
|-------|------|------------------|----------|
| KTP region | `test/eval/ktp-region-eval.spec.ts` | PII detection vs YOLO field boxes on 20 generated cards (stride-sampled) | `test/eval/baseline-ktp-metrics.json` |
| Synthetic multi-doc | `test/eval/synthetic-eval.spec.ts` + `synthDocs.ts` | position-aware word recall (strict + fragment-repaired), precision, digit recall, fragmentation rate on 8 deterministic renders + 4 degraded twins (bank mutation ×2, dense mutation, chats light/dark, receipt, social post, article, app screen; @half-scale / @jpeg70 / @blur twins) | `test/eval/baseline-synthetic-metrics.json` |
| Face detection | `test/eval/face-eval.spec.ts` | detection quality across constructed slices (below) | `test/eval/baseline-face-metrics.json` |

Plus unit tests (`npx vitest run`) for PII precision rules.

## Current numbers

```
KTP        overallRecall=67.5%  falseAutoRate=0%   (baseline was 50.8% / 4.8%)
Synthetic  wordRecall=90.5%  repairedRecall=90.7%  wordPrecision=88.2%  digitRecall=76.1%
Faces      gridCoverage=100%  rotations=100%  collage=100%/100%  negativesFP=0
```

**Extraction pipeline layers (2026-08-25)**: generic documents (non-KTP/ID-card)
now run two post-OCR token modules — `tokenRepair.ts` (numeric fragment
stitching + majority-rule confusion repair, all mutations flagged via
`repaired`/`repairedFrom`) and `tokenSanitizer.ts` (junk/aspect-ratio filters,
isolated-single-char filter, sub-35-conf hard floor on flagged tokens,
longest-first containment suppression of sparse-PSM fragments). Measured
trade: precision +3.3pts, recall −1.4pts vs the pre-sanitizer baseline.
Suppression never picks between equal-length rival reads by confidence —
on degraded text the confident read is often the wrong one (measured −2.7pts
recall in the first iteration); containment is ratio-capped so multi-word row
reads can't eat their own words. Card types keep verbatim reads.

**Attribution finding (Step-0 diagnosis)**: digit-run loss on hard instances
(chat timestamps, half-scale app screens) is ~100% ENGINE-side — raw Tesseract
never reads those glyphs; our pipeline discards nothing it was given. Filtering
moves along a recall↔precision Pareto curve but cannot create missing reads.
Consequence: the digitRecall ≥90% target requires an engine-level change
(pre-approved RapidOCR PP-OCRv4 ONNX trial behind `OCRProvider`).

## ONNX A/B Benchmark (2026-08-25) — REAL RESULTS

| Metric | Tesseract (frozen baseline) | ONNX PP-OCRv4 (Chinese model) | Delta |
|--------|----------------------------|-------------------------------|-------|
| wordRecall (strict) | **90.6%** | 6.7% | −83.9% |
| repairedRecall | **90.9%** | 26.5% | −64.4% |
| wordPrecision | **88.3%** | 37.5% | −50.8% |
| digitRecall | 77.6% | **95.9%** | +18.3% |
| fragRate | 0.0% | 0.0% | 0% |

| Metric | Tesseract | ONNX PP-OCRv4 | Notes |
|--------|-----------|---------------|-------|
| ocr-eval (5 real fixtures) | PASS | PASS | Both pass PII gate |

**Analysis**:
- **DigitRecall**: ONNX **dominates** (+18.3pp) — PP-OCRv4's CRNN recognizes digits extremely well, even on degraded/half-scale renders where Tesseract fails.
- **WordRecall/Precision**: Tesseract **dominates** on Latin-script UI documents — PP-OCRv4 is a Chinese model (trained on Chinese characters), so it fragments Latin words into single characters and produces many false-positive text lines (detecting UI elements as text).
- **Root cause**: PP-OCRv4's detection model (DBNet) and recognition model (CRNN) are trained on Chinese datasets. On Latin-script synthetic UI documents, it over-detects text regions and recognizes individual characters rather than words.

**Adoption Decision**: 
- **Default remains Tesseract** (frozen at 90.6/88.3/77.6) for Latin-script documents.
- **ONNX digitRecall of 95.9% is a breakthrough** for numeric-heavy documents (receipts, invoices, ID cards).
- **Next milestone**: Integrate a Latin-script optimized ONNX model (PP-OCRv4 English/en_PP-OCRv3, or RapidOCR's English models) and/or implement script-aware routing (Chinese → PP-OCRv4, Latin → English model).
- **Immediate value**: ONNX can be opted-in for digit-heavy documents (receipts, invoices) where its 95.9% digitRecall significantly outperforms Tesseract's 77.6%.

## Running

```bash
npm run eval            # everything (~15 min): OCR + synthetic + face
npm run eval:ktp        # KTP only (~5 min)
npm run eval:synthetic  # synthetic only (~3 min)
npx playwright test face-eval  # faces only (~5 min)
node scripts/eval/gate.mjs     # compare against baselines, fail on regression
```

**Ordering matters**: each Playwright run *wipes* `test-results/` (its output dir). The gate reads metric JSONs from there — always run the gate immediately after producing all three files, i.e. after a full `npm run eval`.

## The gate

`scripts/eval/gate.mjs` compares current vs baseline with tolerances:

- KTP field recalls / overallRecall: drop ≤ 5 pts; falseAutoRate rise ≤ 5 pts
- Synthetic metrics: drop ≤ 2 pts (deterministic renders get a strict bar); fragmentation rate capped at max(5%, baseline+3 pts)
- Faces: rate drops ≤ 5 pts; **false positives on face-free negatives capped absolutely at ~0**

All sections always run — failures are collected per section and reported together at the end, so one regression can't hide another.

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
