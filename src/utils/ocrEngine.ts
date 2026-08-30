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
import { repairTokens } from './tokenRepair';
import { sanitizeTokens } from './tokenSanitizer';
import type { IOcrEngine } from './ocr/types';
import { createOcrEngine } from './ocr/engineFactory';

export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  /** True when the read fell below the adaptive confidence floor. Extraction-
   *  first policy keeps the word (missing content is worse than noisy content)
   *  but flags it so pass scoring and downstream consumers can weigh it down. */
  lowConf?: boolean;
  forceRedact?: boolean;
  pageIndex?: number;
  isContextual?: boolean;
}

/**
 * Provider abstraction so a second OCR engine (e.g. PaddleOCR) can be plugged
 * in later without rewriting callers (useDocumentIngestion, DocumentVerification).
 */
export interface OCRProvider {
  processDocument(file: Blob | File, onProgress?: (progress: number, phase?: string) => void): Promise<SpatialWord[]>;
  processRegion(
    imageUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    existingWords?: SpatialWord[]
  ): Promise<SpatialWord[]>;
}

// Worker lifecycle and recognition are owned by IOcrEngine implementations
// (see src/utils/ocr/tesseractEngine.ts). This module orchestrates the pipeline
// — preprocessing, variant sweep, pass scoring, rescans, recovery, geometry,
// shared post-processing — and consumes an engine instance per document.

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

function filterWords(
  rawWords: { text: string; bbox: any; confidence: number }[],
  thresholds: ConfidenceThresholds,
  keepLowConf: boolean
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
    // Extraction-first: on generic documents sub-threshold words are KEPT but
    // flagged lowConf — silently dropping them loses whole real words.
    // Card types (KTP/ID) keep the strict drop: their layout-prior matching
    // degrades measurably when noise tokens sit between anchor fields.
    const isMixedNumeric = /\d/.test(text) && /[A-Za-z]/.test(text);
    const failsThreshold = !isMixedNumeric && !passesThreshold(text, conf, thresholds);
    if (failsThreshold && !keepLowConf) continue;

    out.push({
      text,
      x: word.bbox.x0,
      y: word.bbox.y0,
      width: w,
      height: h,
      confidence: conf,
      ...(failsThreshold ? { lowConf: true } : {}),
    });
  }
  return out;
}

async function recognizeToWords(
  engine: IOcrEngine,
  image: Blob,
  config: TesseractConfig,
  docType: DocumentType,
  quality: ImageQuality,
  onPassProgress?: (passIndex: number, totalPasses: number, tessProgress: number) => void
): Promise<SpatialWord[]> {
  // Try primary PSM, then fallbacks — pick the pass that yields the most words
  // (a multi-field card on psm:8 returns nothing; fallback to psm:6/3 finds all).
  const candidates = engine.capabilities.psmSweep
    ? [config.psm, ...getFallbackPSMs(docType)]
    : [config.psm];
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
  // Extraction-first: on generic documents every PSM pass keeps the words it
  // uniquely saw (geometrically deduped) instead of winner-takes-all — sparse
  // and block segmentations are complementary, not rivals. Card types keep
  // best-pass selection; their gates are tuned around it.
  const unionPasses = docType !== DocumentType.KTP_PHOTO && docType !== DocumentType.ID_CARD;
  const passResults: SpatialWord[][] = [];
  let best: SpatialWord[] = [];
  let bestScore = -1;
  let bestSolidOverall = -1;
  let digitPass: { words: SpatialWord[]; score: number } | null = null;
  for (const psm of psms) {
    const passIndex = psms.indexOf(psm);
    const rawWords = await engine.recognize(image, {
      psm,
      docType,
      onProgress: onPassProgress
        ? (p) => onPassProgress(passIndex, psms.length, p)
        : undefined,
    });
    const thresholds = getConfidenceThresholds(quality, docType);
    const words = filterWords(
      rawWords,
      thresholds,
      docType !== DocumentType.KTP_PHOTO && docType !== DocumentType.ID_CARD
    );
    passResults.push(words);
    // Pass selection must not reward noisy segmentations: low-confidence
    // padding inflates word counts without adding reliable content.
    const score = words.reduce((s, w) => {
      if (w.lowConf) return s;
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
  if (unionPasses) return dedupeWordUnion(passResults);
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

/**
 * Union of words across PSM passes with geometric dedup: two boxes merge when
 * they overlap strongly AND read the same text (the higher-confidence or
 * non-flagged variant wins). Disagreements are kept — for extraction, seeing
 * two competing reads beats losing one silently.
 */
function dedupeWordUnion(passes: SpatialWord[][]): SpatialWord[] {
  const all = passes.flat();
  const kept: SpatialWord[] = [];
  for (const w of all) {
    const cy = w.y + w.height / 2;
    const dupIdx = kept.findIndex((k) => {
      const kcy = k.y + k.height / 2;
      if (Math.abs(kcy - cy) > Math.max(k.height, w.height) * 0.6) return false;
      const ix = Math.max(0, Math.min(k.x + k.width, w.x + w.width) - Math.max(k.x, w.x));
      const iy = Math.max(0, Math.min(k.y + k.height, w.y + w.height) - Math.max(k.y, w.y));
      const inter = ix * iy;
      const smaller = Math.min(k.width * k.height, w.width * w.height);
      if (smaller <= 0 || inter / smaller < 0.55) return false;
      const a = w.text.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
      const b = k.text.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
      return a === b && a.length > 0;
    });
    if (dupIdx === -1) {
      kept.push(w);
    } else {
      const k = kept[dupIdx];
      const better =
        (!!k.lowConf && !w.lowConf) ||
        (k.lowConf === w.lowConf && w.confidence > k.confidence);
      if (better) kept[dupIdx] = w;
    }
  }
  return kept;
}

const DIGIT_ONLY_WHITELIST = '0123456789-+() ';

/**
 * Second pass dedicated to numeric fields (NIK, phone, rekening, etc.).
 * Re-runs OCR on crops that mix digits and letters with a DIGIT-ONLY whitelist,
 * which eliminates the 0/O, 1/l, 5/S, 8/B confusion by construction rather than
 * by destructive post-processing.
 */
async function reScanNumericWords(
  engine: IOcrEngine,
  imageBlob: Blob,
  words: SpatialWord[],
  _config: TesseractConfig,
  docType: DocumentType,
  onCandidateProgress?: (done: number, total: number, tessProgress: number) => void
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
  for (let ci = 0; ci < numericCandidates.length; ci++) {
    const w = numericCandidates[ci];
    const crop = await cropImageSource(imageBlob, { x: w.x, y: w.y, w: w.width, h: w.height });
    const raw = await engine.recognize(crop, {
      docType,
      whitelist: DIGIT_ONLY_WHITELIST,
      onProgress: onCandidateProgress
        ? (p) => onCandidateProgress(ci, numericCandidates.length, p)
        : undefined,
    });
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
  engine: IOcrEngine,
  imageBlob: Blob,
  words: SpatialWord[],
  _config: TesseractConfig,
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
        const rawWords = await engine.recognize(source, {
          docType,
          psm: parseInt(psm, 10),
          whitelist: '0123456789',
        });
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
  engine: IOcrEngine,
  source: ImageData,
  docType: DocumentType,
  targetW: number,
  targetH: number,
  onProgress?: (p: number, phase?: string) => void
): Promise<SpatialWord[]> {
  const config = getTesseractConfig(docType);

  let working = source;

  // --- Safety: downscale only pathologically large inputs to protect memory ---
  // 2600 was tuned when every pixel cost more; modern phone photos (4000px+)
  // were being crushed below the LSTM's usable glyph size before any variant
  // could rescue them. 3200 keeps the memory ceiling while preserving text.
  const MAX_DIM = 3200;
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
  // Upscale genuinely tiny inputs (< 1200 px long edge) hard: Tesseract's LSTM
  // wants glyphs around 30 px, and downscaled screenshots/WhatsApp forwards
  // land well below that. A 3x cap measured better recall on half-scale
  // renders than the old 2x ceiling without hurting any other slice.
  let upscaleFactor = 1;
  const longEdge = Math.max(working.width, working.height);
  let preUpscaleData: ImageData | null = null;
  if (longEdge < 1200) {
    upscaleFactor = Math.min(3000 / longEdge, 3);
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
  // Preprocessing chain done; recognition dominates the remaining time.
  onProgress?.(0.08, 'preprocess');

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

  // Allocate the recognition sweep (0.10–0.80 of pipeline progress) across
  // variants proportionally to their PSM pass counts, so the bar moves at a
  // steady rate regardless of how many variants are active.
  const SWEEP_START = 0.1;
  const SWEEP_END = 0.8;
  const passesPerVariant = variants.map(() => countPsmPasses(config, docType));
  const totalSweepPasses = passesPerVariant.reduce((a, b) => a + b, 0);
  let sweepCursor = SWEEP_START;

  for (let vi = 0; vi < variants.length; vi++) {
    const v = variants[vi];
    const blob = await imageDataToBlob(v.data);
    const qv = assessQuality(v.data);
    const slotSpan = (passesPerVariant[vi] / totalSweepPasses) * (SWEEP_END - SWEEP_START);
    const slotStart = sweepCursor;
    sweepCursor += slotSpan;
    onProgress?.(slotStart, 'recognize');
    const w = await recognizeToWords(engine, blob, config, docType, qv, (passIdx, totalPasses, tessP) => {
      const sub = (passIdx + tessP) / totalPasses;
      onProgress?.(slotStart + sub * slotSpan, passIdx === 0 && sub < 0.3 ? 'detect' : 'recognize');
    });
    if (w.length > bestWords.length) {
      bestWords = w;
      bestFactor = v.factor;
    }
  }

  let words = bestWords;
  const RESCAN_START = SWEEP_END;
  const RESCAN_END = 0.92;
  words = await reScanNumericWords(
    engine,
    processedBlob,
    words,
    config,
    docType,
    (done, total, tessP) => onProgress?.(RESCAN_START + ((done + tessP) / Math.max(1, total)) * (RESCAN_END - RESCAN_START), 'recognize')
  );
  onProgress?.(0.92, 'post');
  words = await recoverNikFromLayout(engine, processedBlob, words, config, docType);
  onProgress?.(0.97, 'post');

  // Token repair (stitch + majority rules) — generic documents only. Cards
  // keep verbatim reads: their layout matching and gates are tuned around
  // exactly what the engine emitted.
  const isCardDocType = docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD;
  if (!isCardDocType) {
    words = repairTokens(sanitizeTokens(words));
  }

  return words.map((w) => mapBoxBack(w, bestFactor, deskewW, deskewH, preScale, skewAngle, targetW, targetH));
}

function countPsmPasses(config: TesseractConfig, docType: DocumentType): number {
  return new Set([config.psm, ...getFallbackPSMs(docType)]).size;
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

class TesseractOCRProvider implements OCRProvider {
  private _engine: IOcrEngine | null = null;

  private async getEngine(): Promise<IOcrEngine> {
    if (!this._engine) {
      // Use config from window.__OCR_ENGINE (set by runner.html) or default
      this._engine = await createOcrEngine();
    }
    return this._engine;
  }

  async processDocument(
    file: Blob | File,
    onProgress?: (progress: number, phase?: string) => void
  ): Promise<SpatialWord[]> {
    try {
      const engine = await this.getEngine();
      if (onProgress) onProgress(0.05, 'model-load');

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
        engine,
        original,
        docType,
        original.width,
        original.height,
        (p, phase) => onProgress?.(0.05 + p * 0.93, phase)
      );

      if (onProgress) onProgress(1, 'post');
      return words;
    } finally {
      // Engine manages its own progress sink internally
    }
  }

  async processRegion(
    imageUrl: string,
    rect: { x: number; y: number; w: number; h: number },
    existingWords: SpatialWord[] = []
  ): Promise<SpatialWord[]> {
    const engine = await this.getEngine();

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
    let words = await runOcrPipeline(engine, cropImageData, docType, cropW, cropH);

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
  onProgress?: (progress: number, phase?: string) => void
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
