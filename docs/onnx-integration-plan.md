# ONNX OCR Engine Integration Plan (Next Milestone)

**Status**: scoped, not started. **Trigger**: Step-0 attribution proved digit-run
loss on hard inputs (chat timestamps, half-scale app screens) is ~100%
engine-side — raw Tesseract never reads those glyphs. No amount of Tesseract
tuning reaches the digitRecall ≥90% target; measured Pareto ceiling is
~90.5% recall / ~88.2% precision / ~76.1% digits (frozen 2026-08-25).

## Goal

Trial RapidOCR-class PP-OCRv4 (det + rec) via onnxruntime-web behind the
existing provider seam. Adopt only if measurably better on the frozen
synthetic suite; keep Tesseract as selectable fallback either way.

## Entry points in this repo

| What | Where |
|------|-------|
| Provider contract | `src/utils/ocrEngine.ts` → `export interface OCRProvider` (`processDocument`, `processRegion`) |
| Swap point | bottom of `ocrEngine.ts`: `_provider` singleton + `getOCRProvider()` (comment marks the intended PaddleOCR slot) |
| Consumers (no changes needed) | `useDocumentIngestion`, `DocumentVerification.vue` — they call `getOCRProvider()` only |
| Word shape | `SpatialWord` (text/x/y/width/height/confidence + optional flags) — map detector boxes onto it |
| Eval hooks | `test/eval/runner.ts` (`runEval`, `runRaw`, `runDiag` pattern) — add `runEvalOnnx` returning the same shape |
| Scorer reuse | position-aware matcher lives inline in `synthetic-eval.spec.ts` (`matchPositionAware`, `detLines`) — extract to a shared module before writing the A/B spec |

## Implementation outline

1. **Deps**: `onnxruntime-web` (wasm SIMD backend). Vendor models locally under
   `public/models/ocr/` — offline-first is a hard requirement, no CDN fetches:
   - PP-OCRv4 det (~4.7 MB, ch_PP-OCRv4_det_infer.onnx)
   - PP-OCRv4 rec (~10.8 MB, ch_PP-OCRv4_rec_infer.onnx)
   - `ppocr_keys_v1.txt` dictionary (~450 KB)
2. **Pipeline lib**: prefer `@gutenye/ocr-browser` (bundles DB-postprocess,
   box unclip, CTC decode) before hand-rolling; Apache-2.0. Fallback: raw ort +
   port of RapidOCR's JS postprocess.
3. **Branching**: when the ONNX provider is selected, `processDocument` skips
   the Tesseract variant/PSM sweep entirely (no PSM equivalent) but REUSES
   `imagePreprocessor` outputs so A/B measures recognition only, fairly.
   Confidence semantics differ (0–1 vs 0–100) — normalize at the boundary.
4. **Threading**: main-thread first, measure jank on large images; move ort to
   a web worker only if needed.
5. **Measurement**: add `runEvalOnnx`; clone `synthetic-eval.spec.ts` scoring
   loop into `synthetic-ab.spec.ts` running BOTH providers over the 12
   instances; report side-by-side aggregates. Spot-check the real fixtures
   (`ocr-eval` set) manually.

## Adoption criteria (decide by numbers, pre-committed)

- Jointly reach wordRecall ≥93% AND precision ≥90% AND digitRecall ≥85%
  (stretch 90%) on the synthetic suite, OR beat Tesseract on every axis by
  ≥3pts at comparable runtime.
- Bundle cost must stay ≤ ~20MB total models + wasm, loaded lazily
  (first-use), never blocking initial page load.
- If adopted: Tesseract stays behind a settings flag as fallback provider;
  card-type paths may remain Tesseract until ONNX proves out on ID photos too.

## Known risks

- iOS Safari wasm memory limits on large images (mitigation: keep MAX_DIM
  downscale for the ONNX path).
- det-model box granularity differs from Tesseract words (lines vs words);
  may need line→word splitting for redaction-box parity — measure before
  wiring UI.
- Indonesian ('ind') support: PP-OCRv4 default dict is Latin-friendly but not
  Indonesia-tuned; expect mixed results vs Tesseract 'ind+eng' on prose —
  that is exactly what the A/B suite quantifies.
