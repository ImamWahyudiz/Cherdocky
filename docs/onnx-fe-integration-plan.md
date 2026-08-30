# ONNX Engine — FE Integration Plan

**Objective**: Integrate the V5 ONNX engine (`en_PP-OCRv5_rec_mobile.onnx` + `ch_PP-OCRv4_det_infer.onnx`) into the production FE so it is:
- **User-selectable** (Tesseract vs ONNX)
- **Performant on all devices** (desktop, mobile, low-end)
- **Observable** (latency, active engine, fallback state)
- **Graceful** (auto-fallback, memory pressure recovery)

**Baseline**: V5 ONNX benchmarks already pass (95.4% wordRecall, 95.7% precision, 96.4% digitRecall). The engine is production-quality; the work here is UX & integration.

---

## Current Architecture (already in place)

```
useDocumentIngestion.ts
  └─> processDocument()  (ocrEngine.ts)
        └─> TesseractOCRProvider.getEngine()  (engineFactory.ts)
              └─> createOcrEngine({ provider?, enableFallback? })
                    ├─> TesseractEngine (IOcrEngine)
                    └─> OnnxEngine (IOcrEngine)  ← V5 ready
```

Config precedence: `?engine=` URL param → `window.__OCR_ENGINE` → `localStorage['cherdocky.ocr-engine']` → `'tesseract'`

Factory: `enableFallback: true` (default, silent fallback) / `false` (throws)

---

## Integration Workstreams

### Lane A — Engine Selection UI (Designer + Fixer)
**Owner**: @designer (visual/interaction) + @fixer (logic)
**Files**: `MainPage.vue`, `useDocumentIngestion.ts`, `engineFactory.ts`
**Deliverable**: User can pick engine; persists across sessions.

| Task | Detail |
|------|--------|
| A1 | Add **Engine Selector** dropdown in `MainPage.vue` header (next to file upload): `Auto` (default) / `Tesseract` / `ONNX (PP-OCRv5)`. `Auto` = config precedence above. |
| A2 | Persist choice to `localStorage['cherdocky.ocr-engine']`. On load, hydrate `window.__OCR_ENGINE` from localStorage so the factory sees it before first `processDocument`. |
| A3 | Show **active engine badge** in `DocumentVerification.vue` header (e.g. `ONNX v5` / `Tesseract` / `Auto → ONNX`). |
| A4 | Add `enableFallback` toggle (default ON). When ON and ONNX init fails, show a non-blocking toast: "ONNX unavailable, using Tesseract". |
| A5 | Add keyboard shortcut `Shift+E` to cycle engines (power user). |

**Acceptance**: Manual switch works, persists, badge updates, toast on fallback.

---

### Lane B — Latency & Progress UX (Fixer + Designer)
**Owner**: @fixer (perf) + @designer (progress UX)
**Files**: `useDocumentIngestion.ts`, `ocrEngine.ts`, `MainPage.vue`, `onnxEngine.ts`
**Deliverable**: Perceived latency < 2s on desktop, < 5s mobile; progress bar honest.

| Task | Detail |
|------|--------|
| B1 | **Model preload**: In `useDocumentIngestion.ts`, when file is dropped but before OCR starts, kick off `createOcrEngine({provider:'onnx'}).then(e=>e.initialize())` in background for ONNX (no-op for Tesseract). Cancels if user switches engine. |
| B2 | **Progress granularity**: `processDocument` already receives `onProgress`. Split into phases: `model-load` (0-0.15), `detect` (0.15-0.4), `recognize` (0.4-0.9), `post` (0.9-1.0). Update progress bar label: "Loading models…" / "Detecting text…" / "Reading words…" / "Finalizing…". |
| B3 | **Time-budget guard**: If single-page OCR > 8s (desktop) / 20s (mobile), show "Still working…" toast, not spinner only. |
| B4 | **Warm cache**: After first successful ONNX init, keep `detSession`/`recogSession` alive in module scope (already done in `onnxEngine.ts`). Ensure `terminate()` only called on explicit engine switch or memory pressure. |
| B5 | **Device tier detection**: `navigator.deviceMemory` + `navigator.hardwareConcurrency`. If `< 4GB` / `< 4 cores`, default to Tesseract unless user explicitly picks ONNX; show hint "ONNX may be slow on this device". |

**Acceptance**: Progress bar moves smoothly, phases labeled, no "frozen" >2s on desktop, device hint shown.

---

### Lane C — Device Variation & WASM Robustness (Fixer)
**Owner**: @fixer
**Files**: `onnxEngine.ts`, `vite.config.ts`, `MainPage.vue`
**Deliverable**: No crashes on iOS Safari, low-memory Android, Firefox.

| Task | Detail |
|------|--------|
| C1 | **WASM streaming compile**: Verify `vite.config.ts` `wasmMimeTypePlugin` + COOP/COEP headers serve `.wasm` as `application/wasm`. Test on Safari iOS 16+. |
| C2 | **WebGPU path (optional)**: Detect `navigator.gpu` → pass `executionProvider: 'webgpu'` to `InferenceSession.create`. Fall back to `wasm` if unavailable. |
| C3 | **Memory pressure handler**: Listen to `navigator.onLine` + custom `memory-warning` (via `performance.measureUserAgentSpecificMemory()` if available). On pressure: call `engine.terminate()`, clear model sessions, show "Freeing memory…" toast. |
| C4 | **Offline model cache**: Add service worker (`vite-plugin-pwa`) to cache `/models/ocr/*.onnx` + `/ort-wasm*.wasm`. On reload, models load from CacheStorage → instant init. |
| C5 | **Error boundaries**: Wrap `processDocument` in try/catch; on `OutOfMemoryError` or `CompileError`, auto-fallback to Tesseract with toast. |

**Acceptance**: Loads on iOS Safari, Android Chrome (4GB RAM), Firefox desktop. No blank screen on OOM.

---

### Lane D — Visual Consistency & Polish (Designer)
**Owner**: @designer
**Files**: `MainPage.vue`, `DocumentVerification.vue`, `ExportSuccessPage.vue`, `style.css`
**Deliverable**: No visual regressions; ONNX-specific states look native.

| Task | Detail |
|------|--------|
| D1 | **Engine badge** style: consistent with existing badges (PDF type badge). Colors: ONNX = blue accent, Tesseract = amber, Auto = gray. |
| D2 | **Progress bar**: Add phase labels (see B2). Use existing `Loader2` icon + text. |
| D3 | **Toast system**: Use existing toast/alert pattern (currently `alert()`). Replace with a non-blocking toast component (top-right, auto-dismiss 4s, action button "Switch to Tesseract" on fallback). |
| D4 | **Empty/error states**: If OCR returns 0 words (e.g., blank page), show "No text detected — try Tesseract?" with one-click switch. |
| D5 | **ExportSuccessPage**: Add "Engine: ONNX v5" line to stats export. |

**Acceptance**: Visual QA on 375px / 768px / 1440px. No layout shift when badge appears. Toasts accessible.

---

### Lane E — Test & Validation (Fixer)
**Owner**: @fixer
**Files**: `test/eval/synthetic-eval.spec.ts`, new `test/integration/onnx-fe.spec.ts`
**Deliverable**: Automated guardrails.

| Task | Detail |
|------|--------|
| E1 | **Playwright integration spec**: Mount `MainPage.vue`, drop test image, assert engine badge = "ONNX v5" when `?engine=onnx`, assert progress reaches 100%, assert words > 0. |
| E2 | **Fallback test**: Mock `InferenceSession.create` to reject → assert toast "ONNX unavailable, using Tesseract", assert Tesseract words rendered. |
| E3 | **Device mock**: Mock `navigator.deviceMemory=2` → assert hint shown, default stays Tesseract. |
| E4 | **Regression**: Run full `npm run eval` gate after merge. |

**Acceptance**: All new tests pass; existing 66 vitest + synthetic eval still pass.

---

## Dependency Graph

```
A1-A3 (UI) ──────────────────┐
                             ├─→ A4 (toast fallback) ─→ D3 (toast component)
B1 (preload) ────────────────┤
B2 (progress phases) ────────┤
                             ├─→ C1-C5 (robustness) ─→ E1-E3 (tests)
B3 (time budget) ────────────┤
B4 (warm cache) ─────────────┤
B5 (device tier) ────────────┘
D1-D2, D5 (visual polish)
```

**Critical path**: A1-A3 → A4/D3 → B1-B4 → C1-C5 → E1-E4
- Designer unblocks Fixer on toast component (D3 → A4)
- Fixer unblocks Designer on progress phases (B2 → D2)
- Both converge on C/E for hardening

---

## Delegation Map

| Lane | Specialist | Context Files |
|------|------------|---------------|
| A (UI + selection logic) | @designer + @fixer | `MainPage.vue`, `useDocumentIngestion.ts`, `engineFactory.ts`, `DocumentVerification.vue` |
| B (latency/progress) | @fixer + @designer | `useDocumentIngestion.ts`, `ocrEngine.ts`, `onnxEngine.ts`, `MainPage.vue` |
| C (device/WASM) | @fixer | `onnxEngine.ts`, `vite.config.ts`, `MainPage.vue` |
| D (visual polish) | @designer | `MainPage.vue`, `DocumentVerification.vue`, `ExportSuccessPage.vue`, `style.css` |
| E (tests) | @fixer | `test/eval/synthetic-eval.spec.ts`, new `test/integration/onnx-fe.spec.ts` |

---

## Milestones

| Milestone | Target | Verification |
|-----------|--------|--------------|
| M1: Engine selector + badge | Day 1-2 | Manual: switch engines, badge updates, persists |
| M2: Preload + progress phases | Day 2-3 | Progress bar labeled, no >2s freeze |
| M3: Device tier + fallback | Day 3-4 | Low-mem hint, OOM → Tesseract toast |
| M4: Visual polish + toasts | Day 4-5 | QA on 3 viewports, no layout shift |
| M5: Integration tests + gate | Day 5-6 | `npm run eval` green, new tests pass |

---

## Notes for Specialists

- **Do not touch** `TesseractEngine`, `ocrEngine.ts` routing, frozen baselines. Scope is ONNX engine integration + FE.
- **ONNX engine is stable** — `src/utils/ocr/onnxEngine.ts` is the source of truth (V5, 438-class CTC, 48px, BGR (pixel-127.5)/127.5). Do not change recognition logic.
- **Config already wired** — `?engine=`, localStorage, factory. Just surface it in UI.
- **Design tokens**: Use existing Tailwind classes (`bg-blue-600`, `bg-amber-600`, `bg-gray-600`), existing `Loader2`/`Check`/`X` icons from `lucide-vue-next`.
- **Toast**: If no toast system exists, build minimal one (`<Transition>` + fixed top-right, 4s auto-dismiss, action button). Reuse in A4, B3, C3, C5.

---

## Kickoff

After this plan is approved, I'll dispatch:
1. @designer (A1-A3, D1-D5) — visual/interaction
2. @fixer (B1-B5, C1-C5, E1-E4) — logic/perf/tests