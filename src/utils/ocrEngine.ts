import { createWorker, type Worker } from 'tesseract.js';

export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  forceRedact?: boolean;
  pageIndex?: number;
}

// Lazy persistent singleton worker for Indonesian + English OCR
let _cachedWorker: Worker | null = null;
let _workerInitializing: Promise<Worker> | null = null;

async function getWorker(onProgress?: (progress: number) => void): Promise<Worker> {
  if (_cachedWorker) {
    return _cachedWorker;
  }

  if (!_workerInitializing) {
    _workerInitializing = (async () => {
      const worker = await createWorker(['ind', 'eng'], 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && onProgress) {
            onProgress(m.progress);
          }
        },
      });

      await worker.setParameters({
        preserve_interword_spaces: '1',
      });

      _cachedWorker = worker;
      return worker;
    })();
  }

  return _workerInitializing;
}

/**
 * Fast, hardware-accelerated image preprocessing for OCR:
 * 1. Grayscale + high contrast to separate text from guilloche patterns.
 * 2. Clamps dimensions to max 2400px so high-res phone photos don't freeze the browser.
 */
async function preprocessImage(source: Blob | File): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(source);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');

      let w = img.naturalWidth || img.width || 800;
      let h = img.naturalHeight || img.height || 1000;

      // Bound resolution to max 2400px for optimal speed and memory safety
      const MAX_DIM = 2400;
      if (w > MAX_DIM || h > MAX_DIM) {
        const scale = Math.min(MAX_DIM / w, MAX_DIM / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(source);

      // Hardware-accelerated contrast boost
      ctx.filter = 'grayscale(100%) contrast(1.35) brightness(1.05)';
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob((blob) => {
        resolve(blob ?? source);
      }, 'image/png');
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(source);
    };

    img.src = url;
  });
}

/**
 * Filter raw OCR words to eliminate facial contours, artifacts, and noise.
 */
function filterValidOcrWords(rawWords: any[]): SpatialWord[] {
  return rawWords
    .filter((word) => {
      const text = (word.text || '').trim();
      const conf = word.confidence ?? 0;

      // 1. Discard empty or whitespace
      if (!text) return false;

      // 2. Discard purely non-alphanumeric noise unless delimiter
      const hasAlphaNum = /[a-zA-Z0-9]/.test(text);
      const isCleanDelimiter = text === ':' || text === '=';
      if (!hasAlphaNum && !isCleanDelimiter) return false;

      // 3. Discard tiny noisy bounding boxes
      const w = word.bbox.x1 - word.bbox.x0;
      const h = word.bbox.y1 - word.bbox.y0;
      if (w < 4 || h < 4) return false;

      // 4. Strong numbers or date patterns
      const isNumberOrDate =
        /^\d{2,16}$/.test(text) || /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(text);
      if (isNumberOrDate) {
        return conf >= 25;
      }

      // 5. Short tokens (1-2 characters)
      if (text.length <= 2) {
        if (isCleanDelimiter) return true;
        if (conf < 50) return false;
      } else {
        if (conf < 35) return false;
      }

      return true;
    })
    .map((word) => ({
      text: word.text.trim(),
      x: word.bbox.x0,
      y: word.bbox.y0,
      width: word.bbox.x1 - word.bbox.x0,
      height: word.bbox.y1 - word.bbox.y0,
      confidence: word.confidence,
    }));
}

/**
 * Process an entire document image through OCR with bilingual ind+eng support.
 */
export async function processDocument(
  file: File | Blob,
  onProgress?: (progress: number) => void
): Promise<SpatialWord[]> {
  try {
    const worker = await getWorker(onProgress);
    const processedImage = await preprocessImage(file);
    const { data } = await worker.recognize(processedImage, {}, { blocks: true });

    if (onProgress) onProgress(1);

    const rawWords = data.blocks
      ? data.blocks.flatMap((b) => b.paragraphs).flatMap((p) => p.lines).flatMap((l) => l.words)
      : [];

    return filterValidOcrWords(rawWords);
  } catch (err) {
    console.error('Tesseract OCR error:', err);
    return [];
  }
}

/**
 * Process a rectangular region of an image through OCR.
 */
export async function processRegion(
  imageUrl: string,
  rect: { x: number; y: number; w: number; h: number },
  existingWords: SpatialWord[] = []
): Promise<SpatialWord[]> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image for region OCR'));
    el.src = imageUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context for region crop');

  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  const cropBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Crop to blob failed'));
    }, 'image/png');
  });

  const processed = await preprocessImage(cropBlob);
  const worker = await getWorker();
  const { data } = await worker.recognize(processed, {}, { blocks: true });

  const rawWords = data.blocks
    ? data.blocks.flatMap((b) => b.paragraphs).flatMap((p) => p.lines).flatMap((l) => l.words)
    : [];

  const filtered = filterValidOcrWords(rawWords);

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

  return filtered.map((word) => {
    let finalY = rect.y + word.y;
    let finalHeight = word.height;

    if (avgNeighborHeight && avgNeighborY !== null) {
      const heightRatio = word.height / avgNeighborHeight;
      if (heightRatio >= 0.65 && heightRatio <= 1.35) {
        finalHeight = avgNeighborHeight;
        finalY = avgNeighborY;
      }
    }

    return {
      text: word.text,
      x: rect.x + word.x,
      y: finalY,
      width: word.width,
      height: finalHeight,
      confidence: word.confidence,
    };
  });
}
