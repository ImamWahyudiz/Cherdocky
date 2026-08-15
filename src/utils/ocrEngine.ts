import { createWorker, type Worker } from 'tesseract.js';

export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  forceRedact?: boolean;
}

// Lazy singleton worker for region re-scans with Indonesian + English support
let _cachedWorker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!_cachedWorker) {
    _cachedWorker = await createWorker(['ind', 'eng']);
    await _cachedWorker.setParameters({
      preserve_interword_spaces: '1',
    });
  }
  return _cachedWorker;
}

/**
 * Advanced image preprocessing for OCR:
 * 1. Grayscale + high contrast to separate text from background security guilloche patterns.
 * 2. 3x3 Sharpening convolution filter to crispen text edges.
 */
async function preprocessImage(source: Blob | File): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(source);
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        return resolve(source instanceof Blob ? source : source);
      }

      // Grayscale + strong contrast boost
      ctx.filter = 'grayscale(100%) contrast(1.4) brightness(1.0)';
      ctx.drawImage(img, 0, 0);

      // Pixel-level sharpening pass
      try {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const width = canvas.width;
        const height = canvas.height;
        const output = new Uint8ClampedArray(data);

        // 3x3 sharpening kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const top = ((y - 1) * width + x) * 4;
            const bottom = ((y + 1) * width + x) * 4;
            const left = (y * width + (x - 1)) * 4;
            const right = (y * width + (x + 1)) * 4;

            for (let c = 0; c < 3; c++) {
              const val = 5 * data[idx + c] - data[top + c] - data[bottom + c] - data[left + c] - data[right + c];
              output[idx + c] = Math.min(255, Math.max(0, val));
            }
            output[idx + 3] = data[idx + 3];
          }
        }

        ctx.putImageData(new ImageData(output, width, height), 0, 0);
      } catch (err) {
        console.warn('Canvas pixel sharpening skipped (CORS/memory):', err);
      }

      canvas.toBlob((blob) => {
        if (typeof source !== 'string') {
          try { URL.revokeObjectURL(url); } catch (_) {}
        }
        resolve(blob ?? source);
      }, 'image/png', 1.0);
    };

    img.onerror = () => {
      if (typeof source !== 'string') {
        try { URL.revokeObjectURL(url); } catch (_) {}
      }
      resolve(source);
    };

    img.src = url;
  });
}

/**
 * Filter raw OCR words to eliminate facial contours, artifacts, and noise.
 * Requires high confidence for short tokens and discards non-alphanumeric gibberish.
 */
function filterValidOcrWords(rawWords: any[]): SpatialWord[] {
  return rawWords
    .filter((word) => {
      const text = (word.text || '').trim();
      const conf = word.confidence ?? 0;

      // 1. Discard empty or whitespace
      if (!text) return false;

      // 2. Discard purely non-alphanumeric noise (like ~, |, —, ©, °, ^, *, `, /) unless it's a delimiter ':' or '='
      const hasAlphaNum = /[a-zA-Z0-9]/.test(text);
      const isCleanDelimiter = text === ':' || text === '=';
      if (!hasAlphaNum && !isCleanDelimiter) return false;

      // 3. Discard tiny noisy bounding boxes (< 5px width or height)
      const w = word.bbox.x1 - word.bbox.x0;
      const h = word.bbox.y1 - word.bbox.y0;
      if (w < 5 || h < 5) return false;

      // 4. Strong numbers or date patterns: allow lower threshold (>= 30%)
      const isNumberOrDate = /^\d{2,16}$/.test(text) || /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(text);
      if (isNumberOrDate) {
        return conf >= 30;
      }

      // 5. Short tokens (1-2 characters):
      // Facial contours and texture artifacts frequently generate 1-2 char gibberish (e.g. 'pl', 'y', 'eo', 'oa', 'Ag').
      // Only keep 1-2 char tokens if confidence >= 55% AND it's not gibberish punctuation.
      if (text.length <= 2) {
        if (isCleanDelimiter) return true;
        if (conf < 55) return false;
      } else {
        if (conf < 40) return false;
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
  const worker = await createWorker(['ind', 'eng'], 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    }
  });

  await worker.setParameters({
    preserve_interword_spaces: '1',
  });

  const processedImage = await preprocessImage(file);
  const { data } = await worker.recognize(processedImage, {}, { blocks: true });
  await worker.terminate();

  const rawWords = data.blocks
    ? data.blocks.flatMap((b) => b.paragraphs).flatMap((p) => p.lines).flatMap((l) => l.words)
    : [];

  return filterValidOcrWords(rawWords);
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
