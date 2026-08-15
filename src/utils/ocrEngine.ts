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

// Lazy singleton worker for region re-scans (avoids ~2s init overhead per drag)
let _cachedWorker: Worker | null = null;

async function getWorker(): Promise<Worker> {
  if (!_cachedWorker) {
    _cachedWorker = await createWorker('eng');
  }
  return _cachedWorker;
}

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

      // Grayscale + mild contrast boost to improve OCR on colored text
      ctx.filter = 'grayscale(100%) contrast(1.2)';
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        resolve(blob ?? source);
      }, 'image/png', 1.0);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(source);
    };

    img.src = url;
  });
}

/**
 * Process an entire document image through OCR.
 * Creates and terminates its own worker (used for initial full-page scan).
 */
export async function processDocument(
  file: File | Blob,
  onProgress?: (progress: number) => void
): Promise<SpatialWord[]> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    }
  });

  const processedImage = await preprocessImage(file);
  const { data } = await worker.recognize(processedImage, {}, { blocks: true });
  await worker.terminate();

  const words = data.blocks
    ? data.blocks.flatMap(b => b.paragraphs).flatMap(p => p.lines).flatMap(l => l.words)
    : [];

  console.log('Extracted words count:', words.length);

  return words.map((word) => ({
    text: word.text,
    x: word.bbox.x0,
    y: word.bbox.y0,
    width: word.bbox.x1 - word.bbox.x0,
    height: word.bbox.y1 - word.bbox.y0,
    confidence: word.confidence,
  }));
}

/**
 * Process a rectangular region of an image through OCR.
 * Uses a cached singleton worker for speed.
 * Crops the region, preprocesses it, runs OCR, then offsets coordinates back to full-image space.
 */
export async function processRegion(
  imageUrl: string,
  rect: { x: number; y: number; w: number; h: number }
): Promise<SpatialWord[]> {
  // Load the full image
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to load image for region OCR'));
    el.src = imageUrl;
  });

  // Crop the selected rectangle
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

  // Preprocess the cropped region
  const processed = await preprocessImage(cropBlob);

  // OCR the cropped region using the cached worker
  const worker = await getWorker();
  const { data } = await worker.recognize(processed, {}, { blocks: true });

  const words = data.blocks
    ? data.blocks.flatMap(b => b.paragraphs).flatMap(p => p.lines).flatMap(l => l.words)
    : [];

  // Offset coordinates back to full-image space
  return words.map((word) => ({
    text: word.text,
    x: word.bbox.x0 + rect.x,
    y: word.bbox.y0 + rect.y,
    width: word.bbox.x1 - word.bbox.x0,
    height: word.bbox.y1 - word.bbox.y0,
    confidence: word.confidence,
  }));
}
