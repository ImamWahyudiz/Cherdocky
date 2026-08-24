# Debugging Chronicle

Real bugs from this project's development, told as case studies. Each one cost real time and taught something transferable. Read this before changing the OCR or face pipeline.

---

## Case 1: The 3% collapse — Tesseract's setParameters merges, it does not replace

**Symptom.** The KTP benchmark suddenly scored **3.3% overall recall** — down from ~50%. Only the *first* document in any multi-document session worked; documents two, three, four… returned 0–2 words each.

**The trap.** Every hypothesis about *image content* was wrong. The images were fine. The bug was state leakage between recognitions:

1. `recoverNikFromLayout` re-OCRs a cropped region with a **digit-only whitelist**: `tessedit_char_whitelist: '0123456789'`
2. Afterwards the code "restored" parameters by calling `setParameters` with the profile's params — but the restore object **omitted the whitelist key entirely**
3. tesseract.js `setParameters` performs a shallow **merge** into persistent worker state. Omitting a key = keep the old value
4. So every subsequent document on that worker ran with a digits-only whitelist → all alphabetic text vanished

**Fix.** `buildParams()` now always emits both charsets explicitly:

```ts
'tessedit_char_whitelist': config.whitelist ?? '',
'tessedit_char_blacklist': config.blacklist ?? '',
```

**Lessons.**
- When an API "sets" values, check whether it *replaces* or *merges*. Merge semantics make omission a silent no-op.
- A bug that only appears from the second item onward is almost always leftover state, not per-item logic.
- Write the invariant down at the callsite: future-you will "optimize" the explicit empty strings away otherwise.

---

## Case 2: Aspect ratios lie — screenshots classified as ID cards

**Symptom.** Chats, receipts, and social posts were occasionally routed into card OCR profiles (whitelists tuned for KTP glyphs), destroying their text quality.

**Investigation.** Classification used aspect ratio + dimensions. But a phone chat screenshot is portrait like a card; a scanned document can be nearly square. Dimensions alone cannot distinguish "flat rendered UI" from "photograph of paper".

**Fix.** Content-based override: quantize RGB to 12-bit color buckets and take the dominant bucket's share.

| Image type | dominant bucket share |
|------------|----------------------|
| UI screenshots / flat renders | 0.66 – 0.89 |
| photos / cards | 0.09 – 0.26 |

A 0.45 threshold separates the worlds cleanly (`isUiScreenshot()`). Cheap, deterministic, no ML.

**Lesson.** When cheap metadata (size, aspect) is ambiguous, look at one cheap content statistic before reaching for a classifier model.

---

## Case 3: Choosing between PSM passes — scoring what "solid" means

**Problem.** Running multiple PSM modes produces different segmentations; picking by raw word count favors junk fragmentation (symbols and split fragments outnumber real words).

**Evolution.**
1. Count alnum-heavy words ("solid score") — big improvement.
2. Prefer passes containing `\d{8,}` tokens unconditionally (NIK/rekening visibility) — helped NIK, silently traded TTL rows away on some cards (-20 pts).
3. Final rule: digit-rich pass wins only if its solid score is ≥ 85% of the best pass (`DIGIT_PASS_FLOOR`). Both fields survive.

**Method note.** Step 2→3 came from a single attribution experiment: log which PSM pass read which field on which image. Never tune selection rules against aggregate numbers alone; attribute wins/losses per field per image.

---

## Case 4: Median filter needed by dates, harmful elsewhere

**Symptom.** After gating median denoising behind a low quality score (to protect clean renders), KTP TTL recall fell 20 points while everything else improved.

**Root cause.** Small date glyphs on cards benefit from median denoising even when the image looks objectively clean (high quality score). Screenshots/synthetic docs have high noise readings from anti-aliased edges, where median erodes strokes.

**Fix.** Card doc types bypass the quality-score condition: `q2.noise > 0.3 && (isCardDoc || q2.score < 0.55)`.

**Lesson.** Preprocessing isn't globally good or bad — it's per-content-type. Gate filters by document class, not just image quality.

---

## Case 5: Face false positives — the console red herring

**Symptom.** BlazeFace detections fired on textured scenes (colored ellipse fields standing in for foliage/patterns) and produced extra boxes on ID scans.

**First fix attempt failed mysteriously.** Added a keypoint-geometry gate (real faces have rigidly consistent landmark layout). Metrics didn't move. Added logging inside the gate → **zero log lines**, though equivalent logging inside extraction produced hundreds. Concluded (wrongly) the gate never ran. Burned time on module-cache theories, stale Vite dev servers, duplicate files.

**Truth.** The gate ran on every candidate. Playwright's `page.on('console')` forwarding **silently drops messages under volume** — hundreds of per-candidate logs drowned everything except a lucky subset. The proof came from monkey-patching `console.log` inside the page to record into a `window.__logs` array returned with the test results: `facefilter: 678, facegeo: 678`.

**Actual root cause & fix.** False positives carried *geometrically coherent* keypoints (BlazeFace's landmark refiner fits a face template onto anything the backbone fires on) — geometry couldn't separate them. But their **confidence scores** did: FPs scored 0.51–0.54 while every real face in the benchmark scored ≥ 0.84. Raising `minDetectionConfidence` 0.5 → 0.6 killed all FPs with margin and zero recall loss.

**Bonus finding.** The remaining "overdetection" on ID docs turned out to be a *ground-truth error*: pixel analysis showed the extra box had 80% skin-tone pixels — a genuine second portrait on the card. Over-redaction is the safe failure mode for a privacy tool anyway.

**Lessons.**
- Never trust a logging pipeline you haven't validated end-to-end; capture state directly (return values > side channels).
- Model-internal features (landmarks) inherit the model's bias — the refiner will happily "find" coherent landmarks on garbage.
- Before fixing over-detection, verify the ground truth. Extra detections may be right.
- Confidence thresholds are the cheapest precision knob — measure the score distribution first, then place the cut with margin.

---

## Meta-lessons (process)

1. **Benchmarks before fixes.** Every case above was diagnosed because a benchmark existed that could be rerun in minutes. Build the harness first.
2. **One decisive experiment per hypothesis.** Log enough to confirm/refute in a single rerun. Avoid the loop of tweak-run-squint.
3. **Neutral changes are not free.** Two features were removed after measuring zero effect (line-level weak rescan; unconditional digit preference). Dead complexity compounds.
4. **Freeze baselines honestly.** Re-baselining is allowed when a tradeoff is understood and documented (TTL -5 vs +17.6 overall), never as a way to hide regressions — the gate compares current vs baseline and fails loudly.
