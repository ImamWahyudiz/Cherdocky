import { createWorker, type Worker } from 'tesseract.js';
import {
  blobToImageData,
  imageDataToBlob,
  assessQuality,
  applyMedianFilter,
  applyUnsharpMask,
  applyThreshold,
  applyFixedThreshold,
  applyInvert,
  applyGrayscale,
  detectSkew,
  rotateImage,
  type ImageQuality,
} from './imagePreprocessor';
import { preClassifyFromDimensions, isUiScreenshot, DocumentType } from './documentClassifier';
import { getTesseractConfig, getFallbackPSMs, type TesseractConfig } from './tesseractProfiles';
import {
  getConfidenceThresholds,
  passesThreshold,
  type ConfidenceThresholds,
} from './adaptiveThreshold';
import { isValidNik } from './piiDetector';
import { KTP_FIELD_PRIORS, isKtpLike, hasNikCorroboration } from './ktpLayoutPriors';

export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  forceRedact?: boolean;
  pageIndex?: number;
  isContextual?: boolean;
}

/**
 * Provider abstraction so a second OCR engine (e.g. PaddleOCR) can be plugged
 * in later without rewriting callers (useDocumentIngestion, DocumentVerification).
 */
export interface OCRProvider {
  processDocument(file: Blob | File, onProgress?: (progress: number) => void): Promise<SpatialWord[]>;
  processRegion(
    imageUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    existingWords?: SpatialWord[]
  ): Promise<SpatialWord[]>;
}

// Lazy persistent singleton worker for Indonesian + English OCR
let _cachedWorker: Worker | null = null;
let _workerInitializing: Promise<Worker> | null = null;

async function getWorker(onProgress?: (progress: number) => void): Promise<Worker> {
  if (_cachedWorker) return _cachedWorker;

  if (!_workerInitializing) {
    _workerInitializing = (async () => {
      const worker = await createWorker(['ind', 'eng'], 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(m.progress);
          }
        },
      });
      _cachedWorker = worker;
      return worker;
    })();
  }

  return _workerInitializing;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function resizeImageData(img: ImageData, w: number, h: number): ImageData {
  const tmp = document.createElement('canvas');
  tmp.width = img.width;
  tmp.height = img.height;
  tmp.getContext('2d')!.putImageData(img, 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function cropImageSource(
  source: Blob | string,
  rect: { x: number; y: number; w: number; h: number }
): Promise<Blob> {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w));
  canvas.height = Math.max(1, Math.round(rect.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context for crop');
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop to blob failed'))),
      'image/png'
    );
  });
}

// ---------------------------------------------------------------------------
// Tesseract parameter + filtering
// ---------------------------------------------------------------------------

// Broad whitelist used whenever a profile doesn't specify one. Always setting a
// whitelist guarantees the per-document config fully resets the worker state and
// prevents a digit-only whitelist from a previous numeric pass leaking through.
function buildParams(config: TesseractConfig, docType: DocumentType): Record<string, string> {
  const params: Record<string, string> = {
    tessedit_pageseg_mode: String(config.psm),
    preserve_interword_spaces: '1',
    // ALWAYS emit both charsets explicitly: setParameters MERGES into the
    // worker's persistent state, so omitting a key silently keeps whatever
    // the previous pass left there (e.g. a digit-only rescan whitelist
    // leaking into every subsequent document).
    tessedit_char_whitelist: config.whitelist ?? '',
    tessedit_char_blacklist: config.blacklist ?? '',
  };
  // Disable dictionaries for ID-style documents (mostly non-dictionary tokens)
  // so the decoder doesn't "fix" a 16-digit NIK into dictionary words.
  if (docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD) {
    params.load_freq_dawg = '0';
    params.load_system_dawg = '0';
  }
  return params;
}

function flattenWords(raw: any): { text: string; bbox: any; confidence: number }[] {
  if (!raw?.blocks) return [];
  return raw.blocks
    .flatMap((b: any) => b.paragraphs)
    .flatMap((p: any) => p.lines)
    .flatMap((l: any) => l.words);
}

function filterWords(
  rawWords: { text: string; bbox: any; confidence: number }[],
  thresholds: ConfidenceThresholds
): SpatialWord[] {
  const out: SpatialWord[] = [];
  for (const word of rawWords) {
    const text = (word.text || '').trim();
    const conf = word.confidence ?? 0;

    if (!text) continue;

    const hasAlphaNum = /[a-zA-Z0-9]/.test(text);
    const isCleanDelimiter = text === ':' || text === '=';
    if (!hasAlphaNum && !isCleanDelimiter) continue;

    const w = word.bbox.x1 - word.bbox.x0;
    const h = word.bbox.y1 - word.bbox.y0;
    if (w < 4 || h < 4) continue;

    // Mixed tokens (digits+letters like "32?750bb005?40014") bypass the
    // confidence threshold so reScanNumericWords can clean them up.
    const isMixedNumeric = /\d/.test(text) && /[A-Za-z]/.test(text);
    if (!isMixedNumeric && !passesThreshold(text, conf, thresholds)) continue;

    out.push({ text, x: word.bbox.x0, y: word.bbox.y0, width: w, height: h, confidence: conf });
  }
  return out;
}

async function recognizeToWords(
  worker: Worker,
  image: Blob,
  config: TesseractConfig,
  docType: DocumentType,
  quality: ImageQuality
): Promise<SpatialWord[]> {
  // Try primary PSM, then fallbacks — pick the pass that yields the most words
  // (a multi-field card on psm:8 returns nothing; fallback to psm:6/3 finds all).
  const candidates = [config.psm, ...getFallbackPSMs(docType)];
  const seen = new Set<number>();
  const psms: number[] = [];
  for (const p of candidates) {
    if (!seen.has(p)) { seen.add(p); psms.push(p); }
  }

  // Run every candidate PSM and keep the best pass by this rule:
  //
  // 1. A segmentation that can see long digit runs (NIK / rekening / card
  //    numbers) is preferred — but ONLY if it doesn't sacrifice generic
  //    content to do so (solid score >= DIGIT_PASS_FLOOR of the overall
  //    best). An unconditional preference was measured to trade whole TTL
  //    rows away for a better NIK read on some cards.
  // 2. Otherwise the highest solid score wins. Raw word count alone favors
  //    sparse-text fragmentation, so scoring counts only alnum-heavy words.
  const DIGIT_PASS_FLOOR = 0.85;
  let best: SpatialWord[] = [];
  let bestScore = -1;
  let bestSolidOverall = -1;
  let digitPass: { words: SpatialWord[]; score: number } | null = null;
  for (const psm of psms) {
    await worker.setParameters({ ...buildParams(config, docType), tessedit_pageseg_mode: String(psm) } as any);
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const rawWords = flattenWords(data);
    const thresholds = getConfidenceThresholds(quality, docType);
    const words = filterWords(rawWords, thresholds);
    const score = words.reduce((s, w) => {
      const t = w.text.replace(/[^0-9A-Za-z]/g, '');
      return s + (t.length >= 3 || /^\d{4,}$/.test(w.text) ? 1 : 0);
    }, 0);
    const hasLongDigit = words.some((w) => /\d{8,}/.test(w.text));
    if ((window as any).__OCR_DEBUG === true) {
      console.log('[psm]', psm, 'solid=' + score, 'words=' + words.length, 'longDigit=' + hasLongDigit);
    }
    if (score > bestSolidOverall) bestSolidOverall = score;
    if (hasLongDigit && score > (digitPass?.score ?? -1)) digitPass = { words, score };
    if (score > bestScore) {
      bestScore = score;
      best = words;
    }
  }
  if (
    digitPass &&
    digitPass.score >= DIGIT_PASS_FLOOR * Math.max(1, bestSolidOverall) &&
    digitPass.score > -1 &&
    digitPass.words !== best
  ) {
    best = digitPass.words;
  }
  return best;
}

const DIGIT_ONLY_WHITELIST = '0123456789-+() ';

/**
 * Second pass dedicated to numeric fields (NIK, phone, rekening, etc.).
 * Re-runs OCR on crops that mix digits and letters with a DIGIT-ONLY whitelist,
 * which eliminates the 0/O, 1/l, 5/S, 8/B confusion by construction rather than
 * by destructive post-processing.
 */
async function reScanNumericWords(
  worker: Worker,
  imageBlob: Blob,
  words: SpatialWord[],
  config: TesseractConfig,
  docType: DocumentType
): Promise<SpatialWord[]> {
  const numericCandidates = words.filter((w) => {
    const t = w.text.trim();
    if (t.length < 4) return false;
    const digits = (t.match(/\d/g) || []).length;
    const hasAlpha = /[A-Za-z]/.test(t);
    return digits >= 4 && hasAlpha;
  });

  if (numericCandidates.length === 0) return words;

  const result = words.slice();
  // The worker persists across documents: rescans temporarily override the
  // page params, so the finally block must restore the FULL profile set —
  // restoring only the PSM leaks a digit-only whitelist into every later
  // document's recognition.
  const baseParams = buildParams(config, docType);
  try {
    for (const w of numericCandidates) {
      const crop = await cropImageSource(imageBlob, { x: w.x, y: w.y, w: w.width, h: w.height });
      await worker.setParameters({ tessedit_char_whitelist: DIGIT_ONLY_WHITELIST } as any);
      const { data } = await worker.recognize(crop, {}, { blocks: true });
      const raw = flattenWords(data);
      const cleaned = raw
        .map((r) =>
          r.text.replace(/[oOlISB]/g, (m) => ({ o: '0', O: '0', l: '1', I: '1', S: '5', B: '8' }[m] ?? m))
        )
        .filter((t) => /^\d[\d\-+() ]*$/.test(t) && t.replace(/\D/g, '').length >= 4)
        .sort((a, b) => b.replace(/\D/g, '').length - a.replace(/\D/g, '').length)[0];

      if (cleaned) {
        const idx = result.indexOf(w);
        if (idx >= 0) {
          result[idx] = { ...w, text: cleaned, confidence: Math.max(w.confidence, 60) };
        }
      }
    }
  } finally {
    await worker.setParameters(baseParams as any);
  }

  return result;
}

/**
 * Layout-guided NIK recovery for KTP-like documents.
 *
 * Fires ONLY when (a) docType is KTP/ID_CARD, (b) no valid 16-digit NIK was
 * found by the generic pipeline, and (c) the literal keyword "NIK" was
 * detected — see ktpLayoutPriors for the anti-overfit contract.
 *
 * Strategy A repairs the tokens following the NIK keyword already present in
 * the page output (generated/stylized fonts confuse digits with letters).
 * Strategy B falls back to cropping the template NIK region and re-OCR'ing
 * with a digit-only whitelist. Both accept ONLY digits passing isValidNik;
 * otherwise nothing is emitted (no-op on any other document).
 */
async function recoverNikFromLayout(
  worker: Worker,
  imageBlob: Blob,
  words: SpatialWord[],
  config: TesseractConfig,
  docType: DocumentType
): Promise<SpatialWord[]> {
  if (!isKtpLike(docType)) return words;
  if (words.some((w) => isValidNik(w.text))) return words;
  if (!hasNikCorroboration(words.map((w) => w.text))) return words;

  // --- Strategy A: repair the token run after the NIK keyword ---
  const repaired = extractNikCandidate(words);
  if (repaired) {
    const [text, x, y, width, height] = repaired;
    return [...words, { text, x, y, width, height, confidence: 60, pageIndex: 0 }];
  }

  // --- Strategy B: template-prior crop, enhance, digit whitelist rescan ---
  try {
    const img = await loadImage(imageBlob);
    const prior = KTP_FIELD_PRIORS.nik;
    const rect = {
      x: Math.floor(prior.x0 * img.width),
      y: Math.floor(prior.y0 * img.height),
      w: Math.max(1, Math.round((prior.x1 - prior.x0) * img.width)),
      h: Math.max(1, Math.round((prior.y1 - prior.y0) * img.height)),
    };

    const crop = await cropImageSource(imageBlob, rect);

    // Enhance: upscale the thin digit glyphs and binarize — stylized KTP
    // fonts read far better large and black-on-white than small-on-photo.
    let cropData = await blobToImageData(crop);
    const scale = Math.min(3, Math.max(2, 900 / Math.max(1, rect.h)));
    if (scale > 1.2) {
      cropData = resizeImageData(
        cropData,
        Math.round(cropData.width * scale),
        Math.round(cropData.height * scale)
      );
    }
    cropData = applyThreshold(cropData, 'otsu');
    const enhanced = await imageDataToBlob(cropData);

    const candidates: { digits: string; conf: number }[] = [];
    const collect = async (source: Blob, psms: string[]) => {
      for (const psm of psms) {
        await worker.setParameters({
          tessedit_char_whitelist: '0123456789',
          tessedit_pageseg_mode: psm,
        } as any);
        const { data } = await worker.recognize(source, {}, { blocks: true });
        const rawWords = flattenWords(data);
        const digits = rawWords
          .map((r) =>
            r.text.replace(/[oOlISB]/g, (m) => ({ o: '0', O: '0', l: '1', I: '1', S: '5', B: '8' }[m] ?? m))
          )
          .join('')
          .replace(/\D/g, '');
        if (!digits) continue;
        const conf = Math.max(60, ...rawWords.map((r) => r.confidence ?? 0));
        // Exact length wins immediately; otherwise keep best-effort windows.
        if (digits.length === 16 && isValidNik(digits)) {
          return { digits, conf };
        }
        for (let start = 0; start + 16 <= digits.length; start++) {
          const cand = digits.slice(start, start + 16);
          if (isValidNik(cand)) candidates.push({ digits: cand, conf });
        }
      }
      return null;
    };

    const direct = await collect(enhanced, ['7', '8', '6']);
    const found = direct ?? candidates[0];
    if (!found) return words;

    return [
      ...words,
      {
        text: found.digits,
        x: rect.x,
        y: rect.y,
        width: rect.w,
        height: rect.h,
        confidence: found.conf,
        pageIndex: 0,
      },
    ];
  } catch {
    return words;
  } finally {
    await worker.setParameters(buildParams(config, docType) as any);
  }
}

const NIK_CONFUSIONS: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  I: '1', i: '1', l: '1', '|': '1', '!': '1', ']': '1', '[': '1',
  Z: '2', z: '2',
  S: '5', s: '5',
  B: '8', E: '8',
  A: '4',
  G: '6',
  T: '7',
  g: '9', q: '9',
};

/** Next-label keywords that terminate the NIK value token run. */
const NIK_RUN_STOP = /^(?:nama|tempat|tempau|jenis|gol|alamat|agama|status|pekerjaan|kewarganegaraan|berlaku|rt|rtrw|kel|kecamatan)/i;

/**
 * Find "NIK [:]" in the word stream, concatenate the following token run
 * (until a next-field label), map OCR letter/digit confusions, and search
 * 16-digit windows for a checksum-valid NIK. Returns
 * `[text, x, y, width, height]` covering the consumed words, or null.
 */
function extractNikCandidate(
  words: SpatialWord[]
): [string, number, number, number, number] | null {
  for (let i = 0; i < words.length; i++) {
    const t = (words[i].text ?? '').trim();
    if (!/^NIK\b/i.test(t)) continue;

    let run = '';
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = i + 1; j < Math.min(i + 6, words.length); j++) {
      const tok = (words[j].text ?? '').trim();
      if (!tok) continue;
      if (NIK_RUN_STOP.test(tok)) break;
      run += tok.replace(/[^0-9A-Za-z|\[\]!]/g, '');
      const w = words[j];
      x0 = Math.min(x0, w.x);
      y0 = Math.min(y0, w.y);
      x1 = Math.max(x1, w.x + w.width);
      y1 = Math.max(y1, w.y + w.height);
      if (run.replace(/./g, c => NIK_CONFUSIONS[c] ?? c).replace(/\D/g, '').length >= 16) break;
    }

    const mapped = [...run].map((c) => NIK_CONFUSIONS[c] ?? c).join('');
    const digits = mapped.replace(/\D/g, '');
    for (let start = 0; start + 16 <= digits.length; start++) {
      const cand = digits.slice(start, start + 16);
      if (isValidNik(cand)) {
        return [cand, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geometry-aware coordinate mapping
// ---------------------------------------------------------------------------

/**
 * Map a point from the OCR image space back to the target (original/crop) space.
 * `f` is the upscale factor, `dW/dH` are the deskewed-image dimensions (before
 * upscale), `preScale` is any downscale applied to very large inputs (target/dW),
 * `angle` is the deskew angle, `tW/tH` the target dimensions.
 */
function mapPoint(
  px: number,
  py: number,
  f: number,
  dW: number,
  dH: number,
  preScale: number,
  angle: number,
  tW: number,
  tH: number
): [number, number] {
  // back to deskewed space, then uniform pre-scale to target size
  const dsx = (px / f - dW / 2) * preScale + tW / 2;
  const dsy = (py / f - dH / 2) * preScale + tH / 2;
  // inverse rotation by +angle about target center
  const ox = tW / 2 + Math.cos(angle) * (dsx - tW / 2) - Math.sin(angle) * (dsy - tH / 2);
  const oy = tH / 2 + Math.sin(angle) * (dsx - tW / 2) + Math.cos(angle) * (dsy - tH / 2);
  return [ox, oy];
}

function mapBoxBack(
  w: SpatialWord,
  f: number,
  dW: number,
  dH: number,
  preScale: number,
  angle: number,
  tW: number,
  tH: number
): SpatialWord {
  const corners: [number, number][] = [
    [w.x, w.y],
    [w.x + w.width, w.y],
    [w.x, w.y + w.height],
    [w.x + w.width, w.y + w.height],
  ];
  const pts = corners.map((c) => mapPoint(c[0], c[1], f, dW, dH, preScale, angle, tW, tH));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(tW, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(tH, Math.max(...ys));
  return { ...w, x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Merge adjacent numeric words on the same line (e.g. a 16-digit NIK that
 * Tesseract splits into "327506500574" + "0014").  Keeps the merged text
 * and combines bounding boxes.
 */
// ---------------------------------------------------------------------------
// Shared OCR pipeline (operates on ImageData for full coordinate control)
// ---------------------------------------------------------------------------

async function runOcrPipeline(
  worker: Worker,
  source: ImageData,
  docType: DocumentType,
  targetW: number,
  targetH: number
): Promise<SpatialWord[]> {
  const config = getTesseractConfig(docType);

  let working = source;

  // --- Safety: downscale only pathologically large inputs to protect memory ---
  const MAX_DIM = 2600;
  if (Math.max(working.width, working.height) > MAX_DIM) {
    const f = MAX_DIM / Math.max(working.width, working.height);
    working = resizeImageData(
      working,
      Math.round(working.width * f),
      Math.round(working.height * f)
    );
  }

  const quality0 = assessQuality(working);

  // --- Geometric: deskew (record transform for inverse mapping) ---
  let skewAngle = 0;
  let deskewW = working.width;
  let deskewH = working.height;
  if (quality0.score < 0.85) {
    const detected = detectSkew(working, 5);
    // A reading at the top of the search range is almost always a false
    // positive (e.g. high-contrast UI rows aligning into phantom diagonals).
    const SKEW_MAX = 5;
    if (detected >= 0.3 && detected < SKEW_MAX * 0.95) {
      working = rotateImage(working, -detected);
      skewAngle = detected;
      deskewW = working.width;
      deskewH = working.height;
    }
  }

  // Uniform scale from deskewed space back to the original target space
  const preScale = targetW / deskewW;

  // --- Geometric: upscale very small images, but leave medium/large alone ---
  // Upscale only genuinely tiny crops (< 1200 px long edge). Larger images
  // (e.g. 1200x628) already have enough pixels; upscaling them just blurs.
  let upscaleFactor = 1;
  const longEdge = Math.max(working.width, working.height);
  let preUpscaleData: ImageData | null = null;
  if (longEdge < 1200) {
    upscaleFactor = Math.min(2400 / longEdge, 2);
    preUpscaleData = working;
    working = resizeImageData(
      working,
      Math.round(working.width * upscaleFactor),
      Math.round(working.height * upscaleFactor)
    );
  }

  // --- Appearance: geometry-preserving enhancement (gated by quality) ---
  // Keep preprocessing minimal — raw Tesseract often outperforms heavy
  // filtering on mid-resolution images. Only apply when genuinely needed.
  const q2 = assessQuality(working);
  // Denoise only genuinely bad images — clean UI screenshots/synthetic renders
  // have high "noise" readings from anti-aliased glyph edges, and a median
  // pass erodes exactly the strokes we need to read. Card-style documents
  // (KTP_PHOTO / ID_CARD) keep the original noise-only gate: their small
  // date/ID glyphs benefit from median denoising even when the overall
  // quality score is high (measured: TTL recall collapses without it).
  const isCardDoc = docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD;
  if (q2.noise > 0.3 && (isCardDoc || q2.score < 0.55)) working = applyMedianFilter(working);
  if (q2.contrast < 0.25) working = applyUnsharpMask(working, 0.3);
  if (q2.score < 0.4 && upscaleFactor <= 1.2) working = applyThreshold(working, 'sauvola');

  const processedBlob = await imageDataToBlob(working);

  // --- Recognition: variant sweep ---
  // Different documents need different preprocessing: upscaling rescues small
  // receipt text but blurs crisp UI screenshots; dark-mode UI needs inversion.
  // Instead of guessing, OCR a small set of candidates and keep whichever
  // yields the most words — each scored with ITS OWN quality assessment so
  // confidence filtering matches what the variant actually looks like.
  // Bounded: extra candidates only exist for small (<1200px) or dark images.
  interface Variant {
    data: ImageData;
    factor: number;
  }
  const variants: Variant[] = [{ data: working, factor: upscaleFactor }];
  if (preUpscaleData && upscaleFactor > 1.4) {
    variants.push({ data: preUpscaleData, factor: 1 });
  }
  if (q2.brightness < 0.42) {
    // Dark-mode UI: invert, then binarize hard — light-on-dark glyphs have
    // soft AA halos that plain inversion leaves behind. Percentile auto-levels
    // with a fixed midpoint slice avoid Otsu's failure mode of swallowing
    // whole UI panels into one black blob.
    let v = applyGrayscale(working);
    v = applyInvert(v);
    v = applyFixedThreshold(v);
    variants.push({ data: v, factor: upscaleFactor });
  }

  let bestWords: SpatialWord[] = [];
  let bestFactor = upscaleFactor;
  for (const v of variants) {
    const blob = await imageDataToBlob(v.data);
    const qv = assessQuality(v.data);
    const w = await recognizeToWords(worker, blob, config, docType, qv);
    if (w.length > bestWords.length) {
      bestWords = w;
      bestFactor = v.factor;
    }
  }

  let words = bestWords;
  words = await reScanNumericWords(worker, processedBlob, words, config, docType);
  words = await recoverNikFromLayout(worker, processedBlob, words, config, docType);

  return words.map((w) => mapBoxBack(w, bestFactor, deskewW, deskewH, preScale, skewAngle, targetW, targetH));
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

class TesseractOCRProvider implements OCRProvider {
  async processDocument(
    file: Blob | File,
    onProgress?: (progress: number) => void
  ): Promise<SpatialWord[]> {
  try {
    const worker = await getWorker(onProgress);
    if (onProgress) onProgress(0.05);

    const original = await blobToImageData(file);
    let docType = preClassifyFromDimensions(original.width, original.height).type;
    // Aspect-ratio guesses mislabel UI screenshots as ID cards / face photos.
    // A dominant flat background is a reliable screenshot signature (measured
    // gap: UI captures >= 0.66 vs photos <= 0.28) — route those to the generic
    // profile so card-specific whitelists never touch screen text.
    if (docType !== DocumentType.UNKNOWN && isUiScreenshot(original)) {
      docType = DocumentType.UNKNOWN;
    }

    const words = await runOcrPipeline(
      worker,
      original,
      docType,
      original.width,
      original.height
    );

      if (onProgress) onProgress(1);
      return words;
    } catch (err) {
      console.error('Tesseract OCR error:', err);
      return [];
    }
  }

  async processRegion(
    imageUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    existingWords: SpatialWord[] = []
  ): Promise<SpatialWord[]> {
    const worker = await getWorker();

    const img = await loadImage(imageUrl);
    const cropW = Math.max(1, Math.round(rect.w));
    const cropH = Math.max(1, Math.round(rect.h));
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2d context for region crop');
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, cropW, cropH);
    const cropImageData = ctx.getImageData(0, 0, cropW, cropH);

    const docType = preClassifyFromDimensions(cropW, cropH).type;
    let words = await runOcrPipeline(worker, cropImageData, docType, cropW, cropH);

    // Shift into page coordinate space
    words = words.map((w) => ({ ...w, x: w.x + rect.x, y: w.y + rect.y }));

    // Align re-scanned word height/position to neighboring line for visual consistency
    const neighborWords = existingWords.filter(
      (w) =>
        Math.abs(w.y - rect.y) < Math.max(rect.h * 1.5, 50) &&
        (Math.abs(w.x - (rect.x + rect.w)) < 80 || Math.abs(rect.x - (w.x + w.width)) < 80)
    );
    const avgNeighborHeight =
      neighborWords.length > 0
        ? neighborWords.reduce((sum, w) => sum + w.height, 0) / neighborWords.length
        : null;
    const avgNeighborY =
      neighborWords.length > 0
        ? neighborWords.reduce((sum, w) => sum + w.y, 0) / neighborWords.length
        : null;

    return words.map((word) => {
      let finalY = word.y;
      let finalHeight = word.height;
      if (avgNeighborHeight && avgNeighborY !== null) {
        const heightRatio = word.height / avgNeighborHeight;
        if (heightRatio >= 0.65 && heightRatio <= 1.35) {
          finalHeight = avgNeighborHeight;
          finalY = avgNeighborY;
        }
      }
      return { ...word, y: finalY, height: finalHeight };
    });
  }
}

// Singleton provider instance (swap here later for a PaddleOCR provider)
const _provider: OCRProvider = new TesseractOCRProvider();

export function getOCRProvider(): OCRProvider {
  return _provider;
}

export async function processDocument(
  file: Blob | File,
  onProgress?: (progress: number) => void
): Promise<SpatialWord[]> {
  return _provider.processDocument(file, onProgress);
}

export async function processRegion(
  imageUrl: string,
  rect: { x: number; y: number; w: number; h: number },
  existingWords: SpatialWord[] = []
): Promise<SpatialWord[]> {
  return _provider.processRegion(imageUrl, rect, existingWords);
}
