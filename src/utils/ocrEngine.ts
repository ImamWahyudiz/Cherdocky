import { createWorker, type Worker } from 'tesseract.js';
import {
  blobToImageData,
  imageDataToBlob,
  assessQuality,
  applyMedianFilter,
  applyUnsharpMask,
  applyThreshold,
  detectSkew,
  rotateImage,
  type ImageQuality,
} from './imagePreprocessor';
import { preClassifyFromDimensions, DocumentType } from './documentClassifier';
import { getTesseractConfig, getFallbackPSMs, type TesseractConfig } from './tesseractProfiles';
import {
  getConfidenceThresholds,
  passesThreshold,
  type ConfidenceThresholds,
} from './adaptiveThreshold';

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
const DEFAULT_WHITELIST =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ .,:-/()@#%&';

function buildParams(config: TesseractConfig, docType: DocumentType): Record<string, string> {
  const params: Record<string, string> = {
    tessedit_pageseg_mode: String(config.psm),
    preserve_interword_spaces: '1',
    tessedit_char_whitelist: config.whitelist || DEFAULT_WHITELIST,
  };
  if (config.blacklist) params.tessedit_char_blacklist = config.blacklist;
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

  let best: SpatialWord[] = [];
  for (const psm of psms) {
    await worker.setParameters({ ...buildParams(config, docType), tessedit_pageseg_mode: String(psm) } as any);
    const { data } = await worker.recognize(image, {}, { blocks: true });
    const rawWords = flattenWords(data);
    const thresholds = getConfidenceThresholds(quality, docType);
    const words = filterWords(rawWords, thresholds);
    if (words.length > best.length) best = words;
    if (words.length >= 3) break;  // good enough
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
  config: TesseractConfig
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
    await worker.setParameters({
      tessedit_char_whitelist: config.whitelist || DEFAULT_WHITELIST,
    } as any);
  }

  return result;
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
    if (Math.abs(detected) >= 0.3) {
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
  if (longEdge < 1200) {
    upscaleFactor = Math.min(2400 / longEdge, 3);
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
  if (q2.noise > 0.3) working = applyMedianFilter(working);   // only very noisy
  if (q2.contrast < 0.25) working = applyUnsharpMask(working, 0.3);
  if (q2.score < 0.4 && upscaleFactor <= 1.2) working = applyThreshold(working, 'sauvola');

  const processedBlob = await imageDataToBlob(working);

  let words = await recognizeToWords(worker, processedBlob, config, docType, q2);
  words = await reScanNumericWords(worker, processedBlob, words, config);

  return words.map((w) => mapBoxBack(w, upscaleFactor, deskewW, deskewH, preScale, skewAngle, targetW, targetH));
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
      const docType = preClassifyFromDimensions(original.width, original.height).type;

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
