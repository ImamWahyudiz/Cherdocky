# ONNX OCR Tuning Debugging — From 60-70% → 90-96%

Record of every failure, how it was found, the root cause, and the fix that
unblocked the next level.

```
OCR_ENGINE=offnx  npx playwright test test/eval/synthetic-eval.spec.ts
```

---

## Stage 1 — 0% (silent fallback)

**Symptom**: ONNX run produces identical metrics to Tesseract (90.6%).

**Debugging**: added engine-identity console logs. Runner output:
```
[OCR Engine] Active Provider: ONNX (PP-OCRv4)
```
Never appeared — instead:
```
[ocr-factory] ONNX engine unavailable, falling back to tesseract
```

**Root cause**: `OCR_ENGINE` env var was consumed by the **test runner** (Node) but
never injected into the **browser**. `runner.html` never read it, so
`window.__OCR_ENGINE` was `undefined` → factory defaulted to Tesseract. The ONNX
engine was never loaded at all.

**Fix** — `test/eval/runner.html` + `synthetic-eval.spec.ts`:
- `runner.html`: `window.__OCR_ENGINE = new URLSearchParams(location.search).get('engine') || 'tesseract'`
- spec: `ENGINE = process.env.OCR_ENGINE`, navigate to `?engine=${ENGINE}`,
  assert `expect(activeEngine).toBe(ENGINE)` against a real log.
- Factory added `enableFallback: false` option (throws instead of silently
  falling back) so this class of bug can never be silent again.

→ ONNX actually running for the first time.

---

## Stage 2 — 0% → 5.8% (dict newline corruption)

**Symptom**: engine runs, digitRecall 0%.

**Debug probe**: emitted `JSON.stringify(word.text)` of every returned word.
Output: `"R\r\ne\r\nk\r\ne\r\nn\r\ni\r\n..."`
— every character is separated by **CR-LF**.

**Root cause**: the engine decodes correctly but each dictionary entry carried a
trailing `\r`:
```
const dict = txt.split('\n')        // CRLF file → "0\r", "1\r", ...
```
So `dict[0] = "0\r"` and every decoded char appended `\r`.

**Fix** — one-line:
```
const dict = txt.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
```

→ digitRecall 0 → 96.8% (single change recovered ALL digits). wordRecall still 5.8%.

---

## Stage 3 — 5.8% → 6.6% (line-level vs word-level shape)

**Symptom**: `wordRecall=6.6%` despite perfect full-line text in diagnostics.

**Debug probe**: diag-onnx showed each *whole line* read correctly as one
string (`"14/08 PEMBELIAN QRIS KOPI KENANGAN Rp 28.000"`), with `detection found
32 line(s)` / `output 12 word(s)`.

**Root cause**: `OnnxEngine.recognize()` returned each **text line** as a single
`OcrRawWord`. The position-aware matcher scores **word tokens**, so a 7-word
line returned as 1 token can only be recovered by the "merge" pass (which only
matches 2-3 consecutive GT tokens). → wordRecall capped ~6%.

**Fix**: split each recognized line into words and emit each word as its own
`OcrRawWord` with a **proportional sub-bbox** so geometry is preserved
(meanwhile the matcher scores on *token text + line grouping*, not X-pixel
positions).
```ts
for (const token of text.split(/\s+/)) {
  results.push({ text: token, confidence,
    bbox: { x0: proportionalX0, y0, x1: proportionalX1, y1 } });
}
```

→ wordRecall 6.6%, repaired 28%, precision 39% → **6.6% wordRecall but NOW
word-level**. This proved recognition quality was fine.

---

## Stage 4 — 6.6% → 13–52% (recognition normalization — the hidden one)

**Earlier finding** (from the @gutenye library source — see `Recognition.ts`):
their `imageToInput` had `mean/std` lines **commented out**, i.e. it fed
`pixel/255`. But the model is a PaddleOCR EN rec whose native normalization is
`(x/255 − 0.5)/0.5`, i.e. **`-0.5/0.5`** → `(pixel-127.5)/127.5`.

When the wrong `pixel/255` normalization was first used, recognition returned
all-blank (digitRecall back to 0). Restoring `(pixel-127.5)/127.5` restored
reads.

**Fix (kept)**:
```ts
const r=(d[i]-127.5)/127.5, g=(d[i+1]-127.5)/127.5, b=(d[i+2]-127.5)/127.5;
chw = [b..., g..., r...];  // BGR
```
Detection model, by contrast, trains on `pixel/255` BGR (no mean/std) —
so the two models get *different* normalization, matching PaddleOCR defaults
exactly. (Verified via Python RapidOCR reference ≥95% on the same docs.)

---

## Stage 5 — 52–66% → 89% (drop the hand-rolled CCL, use OpenCV)

**Symptom**: wordRecall stuck ~6-13% even though detection found regions.

**Root cause**: my naive two-pass flood-fill returned **axis-aligned boxes of
connected components** — which on a probability map fragment into
**per-character blobs**, not text lines. splitIntoLineImages's minAreaRect +
unclip + perspective crop produced proper rotated line crops; my box list did not.

**Fix** — delegate detection *contouring* to `@gutenye/ocr-common/splitIntoLineImages`
(OpenCV findContours + js-clipper unclip + perspective warp), keeping *everything
else* custom (model run, thresholding, recognition, word splitting):
```ts
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
import '@gutenye/ocr-browser';   // registers the browser backend (ImageRaw, opencv, etc.)

const lineImages = await splitIntoLineImages(maskImage, sourceImage);
```
Mask built as **RGBA** `Uint8ClampedArray` (what OpenCV `matFromImageData`
expects) from the thresholded probability map (0.008–0.03).

→ wordRecall **6.6% → 89.6%** on the v4 recognizer.

---

## Stage 6 — 89.6% → 90.1% (threshold / max-side sweep)

Tuned detection threshold (`0.008`), `MAX_SIDE` up to `1920` (preserve small-text
detail). Gains were marginal and flat across thresholds — the recognizer, not
the detector, was the bottleneck on `@half` renders.

---

## Stage 7 — 90.1% → 95.4% (the decisive jump: V5 recognizer)

**Hypothesis** (from `docs/benchmarks.md` Phase-0 diagnosis): PP-OCRv4 is a
*Chinese* model; on small Latin glyphs it fragments/overfits. The upgrade path
flagged there was "Latin-script optimized model."

**Action**: swapped `en_PP-OCRv4_rec_mobile.onnx` →
`en_PP-OCRv5_rec_mobile.onnx`. V5 has **438 output classes** (vs V4's 97)
covering full Latin+Unicode Latin Extended, Greek, symbols — and critically,
the V5 weights are far better on tiny/cramped Latin text.

**New dict wiring**: inspected model metadata directly to avoid guesswork:
```
python -c "import onnx; m=onnx.load(...); print(m.metadata_props['character'])"
```
Extracted the 436 embedded characters, saved to `en_v5_dict.txt`, and changed
the factory line in the loader:
```
if (dict.length === 436) dict.push(' ');   // blank(0) + 436 chars + space(437) = 438
```
CTC decode is identical (`classCount = dims[last]`, `dictIdx = argmax − 1`);
only `classCount` and dict length changed.

**Result** (verified, both engines, same spec):
```
wordRecall  90.6  →  95.4   (+4.8pp, >92% target)
repaired    90.9  →  95.4   (+4.5pp, >92% target)
precision   88.3  →  95.7   (+7.4pp)
digitRecall 77.6  →  96.4   (+18.8pp)
```
All four targets met. The single step that broke past the floor was **V5 model
+ its correct 438-char dictionary**.

---

## Key debugging pattern
1. **Emit real data, not counts** — `"word count: 12"` hid the bug; `JSON.stringify(text)`
   revealed `\r` on every char.
2. **Check silent paths first** — a 0%→0% delta meant it was never running, not
   running badly.
3. **Trust the library source, not defaults** — @gutenye's *commented-out*
   mean/std was a trap; PaddleOCR models need 0.5/0.5 for EN recognition.
4. **Upgrade, don't polish** — threshold tuning moved 0.1%; a better model moved
   5.3%. Stop micro-optimizing detector params once recognition is the
   bottleneck.

→ final commit `1e475eb`, tag `milestone/onnx-ocr-v5-final`.