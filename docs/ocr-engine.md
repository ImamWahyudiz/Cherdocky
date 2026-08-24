# OCR Engine Internals

How Cherdocky turns an image into redactable PII regions. All code lives in `src/utils/`; every claim below is backed by a benchmark in `test/eval/`.

## Pipeline overview

```
File / ImageData
      |
      v
[1] documentClassifier.ts   -- route to the right OCR profile
      |        (dimensions first, then content heuristics like isUiScreenshot)
      v
[2] ocrEngine.processDocument()
      |-- quality assessment (assessQuality)
      |-- preprocessing profile per DocumentType (tesseractProfiles.ts)
      |     * upscale factor, contrast, median filter (card docs only!), sauvola threshold
      |-- multi-PSM recognition sweep on ONE worker  [3]
      |-- rescan passes for weak lines / numeric fields [4]
      v
[5] piiDetector.analyzeWords() -- words -> typed, scored PII matches
      |
      v
redactor.ts  -- auto-redact high-confidence matches, offer manual for the rest
```

## [1] Document classification

Two-stage routing (`documentClassifier.ts`):

1. **Aspect ratio + dimensions** — cheap, catches obvious cases.
2. **Content check** — aspect ratios lie. A phone screenshot of a chat is portrait like an ID card; a scanned KTP can be nearly square.
   `isUiScreenshot()` builds a histogram of quantized RGB colors (12-bit buckets) and computes the dominant bucket's share. Flat-rendered UI backgrounds concentrate >45% of pixels into one bucket; photographs almost never exceed ~26%. Above the threshold the image is forced to the generic text path regardless of its shape.

Measured dominant-bucket share: UI documents 0.66–0.89, photos/cards 0.09–0.26. This single check fixed chat/receipt/social posts being misrouted into card OCR profiles.

## [2] Preprocessing profiles

`tesseractProfiles.ts` defines per-type params: language mix, whitelist/blacklist charsets, confidence thresholds.

**Critical implementation detail** (this caused our worst bug): `worker.setParameters()` **merges** into persistent Tesseract state. Omitting a key does NOT reset it — the previous value survives. Therefore `buildParams()` always emits *both* charsets explicitly:

```ts
'tessedit_char_whitelist': config.whitelist ?? '',
'tessedit_char_blacklist': config.blacklist ?? '',
```

Empty string = explicit "no restriction". Never rely on omission to unset a parameter.

### Median filter gating

Median denoising helps small card glyphs (dates, IDs) but erodes anti-aliased strokes in clean renders (screenshots, synthetic docs). The gate:

```ts
if (q2.noise > 0.3 && (isCardDoc || q2.score < 0.55)) working = applyMedianFilter(working);
```

Card-style documents keep the original noise-only gate; everything else additionally requires a low quality score. Removing median from cards collapsed TTL recall by 20 points — small date glyphs genuinely need it.

## [3] Multi-PSM sweep

One recognition never fits all layouts. The engine sweeps PSM modes `[6, 4, 11, 3]` on a single worker and picks the best pass:

- **Score**: count of *solid* words — alnum-heavy tokens (`>= 3` chars) or long digit runs (`\d{4,}`). Raw word count rewards fragmentation junk.
- **Digit bonus**: a pass containing `\d{8,}` wins ties against one without it, but only if it stays within **85% of the best solid score** (`DIGIT_PASS_FLOOR`). An unconditional digit preference traded whole TTL rows away for better NIK reads on some cards.

Why psm 11 (sparse text) matters: KTP generators sometimes render the NIK row such that block segmentation (psm 6) drops it entirely. Sparse mode sees it. Attribution experiment (`ktp-attrib` spec, since removed) proved only psm 11 recovered those NIKs.

## [4] Rescan passes

- `reScanWeakLines`: re-runs lines whose words are mostly low-confidence at psm 7 (single line). Cheap, targeted.
- `recoverNikFromLayout`: when no NIK matched anywhere, crops the region under the literal "NIK" header and re-OCRs it digit-whitelisted. Uses layout priors from `ktpLayoutPriors.ts` — geometry facts about real KTPs (NIK position relative to header), deliberately coarse to avoid overfitting one generator.

## [5] PII detection (precision-first)

`piiDetector.ts` classifies word sequences into types (`nik`, `nama`, `dob`, `address`, `bank`, …) with three evidence tiers:

| Tier | Evidence | Example |
|------|----------|---------|
| Structural | Checksums/patterns (Luhn, IBAN-ish, date grammar) | credit card, bank account |
| Layout | Position relative to labels ("NIK", "Tempat/Tgl Lahir") | KTP fields |
| Content | Value shape alone (gated behind context requirements) | bare numbers |

A long digit run sitting directly under a literal `NIK:` header is typed as `nik` by layout evidence even if its province checksum fails — generated test data uses random provinces. Rule strength 0.85 → auto-redact.

Confidence thresholds adapt to measured image quality (`getConfidenceThresholds`): noisy images get looser word filtering but stricter match requirements, keeping `falseAutoRate` near zero.

## Benchmarks (all green as of this writing)

| Benchmark | Metric | Value |
|-----------|--------|-------|
| KTP region eval (20 generated cards vs YOLO boxes) | overallRecall / falseAutoRate | 68.3% / 0% |
| Synthetic multi-doc (6 deterministic renders) | wordRecall / wordPrecision / digitRecall | 94.6% / 97.9% / 73.1% |

Run them:

```bash
npm run eval:ktp        # KTP field-region benchmark (~5 min)
npm run eval:synthetic  # generic extraction benchmark (~2 min)
npm run eval            # full Playwright suite incl. faces (~7 min)
node scripts/eval/gate.mjs  # regression gate vs frozen baselines
```

See [benchmarks.md](./benchmarks.md) for how the scoring works and what the gate enforces.
