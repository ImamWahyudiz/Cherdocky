/**
 * Enhanced image preprocessing for OCR accuracy improvement.
 * Implements adaptive thresholding, noise reduction, geometric corrections,
 * and quality assessment - all running 100% client-side via Canvas API.
 */

export type ThresholdMethod = 'otsu' | 'sauvola' | 'niblack';

export interface ImageQuality {
  score: number;
  contrast: number;
  noise: number;
  skew: number;
  brightness: number;
  resolution: number;
}

export interface PreprocessingOptions {
  enableThresholding?: boolean;
  enableDenoising?: boolean;
  enableDeskew?: boolean;
  enableContrast?: boolean;
  maxDimension?: number;
  thresholdMethod?: ThresholdMethod;
}

/**
 * Compute a single-pass integral image for fast local-mean/variance operations.
 */
function buildIntegralImage(data: Uint8ClampedArray, width: number, height: number): {
  sum: Float64Array;
  sqSum: Float64Array;
} {
  const sum = new Float64Array((width + 1) * (height + 1));
  const sqSum = new Float64Array((width + 1) * (height + 1));
  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    let rowSqSum = 0;
    for (let x = 1; x <= width; x++) {
      const i = ((y - 1) * width + (x - 1)) * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      rowSum += gray;
      rowSqSum += gray * gray;
      const idx = y * (width + 1) + x;
      sum[idx] = sum[(y - 1) * (width + 1) + x] + rowSum;
      sqSum[idx] = sqSum[(y - 1) * (width + 1) + x] + rowSqSum;
    }
  }
  return { sum, sqSum };
}

function rectIntegral(
  integral: Float64Array,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  const W = width + 1;
  const x2 = x + w;
  const y2 = y + h;
  return (
    integral[y2 * W + x2] -
    integral[y * W + x2] -
    integral[y2 * W + x] +
    integral[y * W + x]
  );
}

/**
 * Otsu's method - picks a global threshold that minimizes intra-class variance.
 * Cheap, fast, works well for clean scans.
 */
export function applyOtsuThreshold(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const histogram = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    histogram[Math.floor(gray)]++;
  }

  const total = width * height;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 127;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    const v = gray > threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
  return imageData;
}

/**
 * Sauvola's adaptive threshold - handles uneven illumination.
 * Better than Otsu for phone photos and unevenly-lit scans.
 */
export function applySauvolaThreshold(
  imageData: ImageData,
  windowSize: number = 25,
  k: number = 0.2,
  r: number = 128,
): ImageData {
  const { data, width, height } = imageData;
  const { sum, sqSum } = buildIntegralImage(data, width, height);
  const w = Math.max(3, windowSize);
  const half = Math.floor(w / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(width, x + half + 1);
      const y1 = Math.min(height, y + half + 1);
      const rw = x1 - x0;
      const rh = y1 - y0;
      const area = rw * rh;

      const s = rectIntegral(sum, width, x0, y0, rw, rh);
      const sq = rectIntegral(sqSum, width, x0, y0, rw, rh);
      const mean = s / area;
      const variance = Math.max(0, sq / area - mean * mean);
      const stddev = Math.sqrt(variance);
      const threshold = mean * (1 + k * ((stddev / r) - 1));

      const i = (y * width + x) * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = gray > threshold ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
  return imageData;
}

/**
 * Niblack's adaptive threshold - similar to Sauvola but simpler formula.
 */
export function applyNiblackThreshold(
  imageData: ImageData,
  windowSize: number = 25,
  k: number = -0.2,
): ImageData {
  const { data, width, height } = imageData;
  const { sum, sqSum } = buildIntegralImage(data, width, height);
  const w = Math.max(3, windowSize);
  const half = Math.floor(w / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half);
      const y0 = Math.max(0, y - half);
      const x1 = Math.min(width, x + half + 1);
      const y1 = Math.min(height, y + half + 1);
      const rw = x1 - x0;
      const rh = y1 - y0;
      const area = rw * rh;

      const s = rectIntegral(sum, width, x0, y0, rw, rh);
      const sq = rectIntegral(sqSum, width, x0, y0, rw, rh);
      const mean = s / area;
      const variance = Math.max(0, sq / area - mean * mean);
      const stddev = Math.sqrt(variance);
      const threshold = mean + k * stddev;

      const i = (y * width + x) * 4;
      const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const v = gray > threshold ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    }
  }
  return imageData;
}

/**
 * Apply any thresholding method.
 */
export function applyThreshold(
  imageData: ImageData,
  method: ThresholdMethod = 'sauvola',
): ImageData {
  switch (method) {
    case 'otsu':
      return applyOtsuThreshold(imageData);
    case 'niblack':
      return applyNiblackThreshold(imageData);
    case 'sauvola':
    default:
      return applySauvolaThreshold(imageData);
  }
}

/**
 * 3x3 box blur - cheap denoise for JPEG artifacts and salt/pepper.
 */
export function applyBoxBlur(imageData: ImageData, passes: number = 1): ImageData {
  const { data, width, height } = imageData;
  const copy = new Uint8ClampedArray(data);

  for (let pass = 0; pass < passes; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = ((y + dy) * width + (x + dx)) * 4;
            r += copy[j];
            g += copy[j + 1];
            b += copy[j + 2];
          }
        }
        data[i] = r / 9;
        data[i + 1] = g / 9;
        data[i + 2] = b / 9;
      }
    }
    copy.set(data);
  }
  return imageData;
}

/**
 * 3x3 median filter - kills salt-and-pepper noise while preserving edges.
 */
export function applyMedianFilter(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const r: number[] = [], g: number[] = [], b: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * width + (x + dx)) * 4;
          r.push(copy[j]);
          g.push(copy[j + 1]);
          b.push(copy[j + 2]);
        }
      }
      r.sort((a, b) => a - b);
      g.sort((a, b) => a - b);
      b.sort((a, b) => a - b);
      const i = (y * width + x) * 4;
      data[i] = r[4];
      data[i + 1] = g[4];
      data[i + 2] = b[4];
    }
  }
  return imageData;
}

/**
 * Unsharp mask - subtracts a blurred copy from the original to sharpen edges.
 */
export function applyUnsharpMask(
  imageData: ImageData,
  amount: number = 0.5,
  radius: number = 1,
): ImageData {
  const { data, width, height } = imageData;
  const copy = new Uint8ClampedArray(data);
  const blurred = new Uint8ClampedArray(data.length);
  const r = Math.max(1, radius);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sr = 0, sg = 0, sb = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            const j = (ny * width + nx) * 4;
            sr += copy[j];
            sg += copy[j + 1];
            sb += copy[j + 2];
            count++;
          }
        }
      }
      const i = (y * width + x) * 4;
      blurred[i] = sr / count;
      blurred[i + 1] = sg / count;
      blurred[i + 2] = sb / count;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, copy[i] + amount * (copy[i] - blurred[i])));
    data[i + 1] = Math.min(255, Math.max(0, copy[i + 1] + amount * (copy[i + 1] - blurred[i + 1])));
    data[i + 2] = Math.min(255, Math.max(0, copy[i + 2] + amount * (copy[i + 2] - blurred[i + 2])));
  }
  return imageData;
}

/**
 * CLAHE on luminance channel (approximated via local histogram equalization).
 * Heavy operation - use with care.
 */
export function applyCLAHE(
  imageData: ImageData,
  tileSize: number = 64,
  clipLimit: number = 2.0,
): ImageData {
  const { data, width, height } = imageData;
  const ts = Math.max(16, tileSize);

  for (let ty = 0; ty < height; ty += ts) {
    for (let tx = 0; tx < width; tx += ts) {
      const w = Math.min(ts, width - tx);
      const h = Math.min(ts, height - ty);
      const histogram = new Uint32Array(256);
      const pixels: number[] = [];

      for (let y = ty; y < ty + h; y++) {
        for (let x = tx; x < tx + w; x++) {
          const i = (y * width + x) * 4;
          const gray = Math.floor((data[i] + data[i + 1] + data[i + 2]) / 3);
          histogram[gray]++;
          pixels.push(i);
        }
      }

      const clipCount = Math.floor((clipLimit * w * h) / 256);
      let clipped = 0;
      for (let t = 0; t < 256; t++) {
        if (histogram[t] > clipCount) {
          clipped += histogram[t] - clipCount;
          histogram[t] = clipCount;
        }
      }
      const redistribute = Math.floor(clipped / 256);
      for (let t = 0; t < 256; t++) histogram[t] += redistribute;

      const lut = new Uint8Array(256);
      let cum = 0;
      const total = w * h;
      for (let t = 0; t < 256; t++) {
        cum += histogram[t];
        lut[t] = Math.round((cum * 255) / total);
      }

      for (const i of pixels) {
        const gray = Math.floor((data[i] + data[i + 1] + data[i + 2]) / 3);
        const v = lut[gray];
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    }
  }
  return imageData;
}

/**
 * Detect skew angle using horizontal projection profile on the luminance channel.
 * Returns angle in degrees; positive = clockwise tilt.
 */
export function detectSkew(imageData: ImageData, maxAngle: number = 10): number {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3;
  }

  let bestAngle = 0;
  let bestVariance = -1;

  for (let angle = -maxAngle; angle <= maxAngle; angle += 0.5) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const newWidth = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin));
    const newHeight = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos));
    const projection = new Float64Array(newHeight);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = Math.round(x * cos - y * sin + newWidth / 2);
        const ny = Math.round(x * sin + y * cos + newHeight / 2);
        if (nx >= 0 && nx < newWidth && ny >= 0 && ny < newHeight && gray[y * width + x] < 128) {
          projection[ny]++;
        }
      }
    }

    const mean = projection.reduce((a, b) => a + b, 0) / newHeight;
    const variance =
      projection.reduce((sum, v) => sum + (v - mean) ** 2, 0) / newHeight;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

/**
 * Rotate an image around its center by the given degrees.
 */
export function rotateImage(imageData: ImageData, degrees: number): ImageData {
  if (Math.abs(degrees) < 0.1) return imageData;
  const { width, height } = imageData;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const newWidth = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin));
  const newHeight = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos));

  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, newWidth, newHeight);

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = width;
  tmpCanvas.height = height;
  tmpCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

  ctx.translate(newWidth / 2, newHeight / 2);
  ctx.rotate(rad);
  ctx.drawImage(tmpCanvas, -width / 2, -height / 2);

  return ctx.getImageData(0, 0, newWidth, newHeight);
}

/**
 * Detect and correct skew. Skips correction if angle is below 0.3°.
 */
export function deskew(imageData: ImageData, maxAngle: number = 5): ImageData {
  const angle = detectSkew(imageData, maxAngle);
  if (Math.abs(angle) < 0.3) return imageData;
  return rotateImage(imageData, -angle);
}

/**
 * Quick quality score (0-1) using mean luminance spread + simple variance.
 * Cheap heuristic; good enough to skip preprocessing on already-clean images.
 */
export function assessQuality(imageData: ImageData): ImageQuality {
  const { data, width, height } = imageData;
  const sample = Math.min(width * height, 50000);
  const step = Math.max(1, Math.floor((width * height) / sample));
  let sum = 0, sumSq = 0, n = 0;
  let minV = 255, maxV = 0;

  for (let i = 0; i < data.length; i += 4 * step) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    sum += gray;
    sumSq += gray * gray;
    if (gray < minV) minV = gray;
    if (gray > maxV) maxV = gray;
    n++;
  }

  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const stddev = Math.sqrt(Math.max(0, variance));
  const contrast = (maxV - minV) / 255;
  const noise = Math.min(1, stddev / 64);
  const brightness = mean / 255;
  const resolution = Math.min(1, (width * height) / (1920 * 1080));

  const score =
    contrast * 0.4 +
    (1 - noise) * 0.3 +
    (1 - Math.abs(brightness - 0.5) * 2) * 0.15 +
    resolution * 0.15;

  return {
    score: Math.max(0, Math.min(1, score)),
    contrast,
    noise,
    skew: 0,
    brightness,
    resolution,
  };
}

/**
 * Decode a Blob/File to ImageData using the canvas.
 */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load image'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Encode ImageData back to PNG Blob.
 */
export function imageDataToBlob(imageData: ImageData): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas to Blob failed'))),
      'image/png',
    );
  });
}

/**
 * Resize if larger than maxDimension on the long edge.
 */
export async function resizeIfNeeded(
  imageData: ImageData,
  maxDimension: number = 2400,
): Promise<ImageData> {
  const { width, height } = imageData;
  if (Math.max(width, height) <= maxDimension) return imageData;

  const scale = maxDimension / Math.max(width, height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(await imageDataToImageBitmap(imageData), 0, 0, newWidth, newHeight);
  return ctx.getImageData(0, 0, newWidth, newHeight);
}

async function imageDataToImageBitmap(imageData: ImageData): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
  return await createImageBitmap(canvas);
}

/**
 * Main preprocessing pipeline. Tries to be conservative by default -
 * heavy steps only kick in when quality is low.
 */
export async function preprocessImageData(
  blob: Blob,
  options: PreprocessingOptions = {},
): Promise<{ blob: Blob; quality: ImageQuality }> {
  const opts: Required<PreprocessingOptions> = {
    enableThresholding: options.enableThresholding ?? false,
    enableDenoising: options.enableDenoising ?? true,
    enableDeskew: options.enableDeskew ?? true,
    enableContrast: options.enableContrast ?? true,
    maxDimension: options.maxDimension ?? 2400,
    thresholdMethod: options.thresholdMethod ?? 'sauvola',
  };

  try {
    let imageData = await blobToImageData(blob);
    const quality = assessQuality(imageData);

    // Resize first - all other operations scale with image size
    if (opts.maxDimension > 0) {
      imageData = await resizeIfNeeded(imageData, opts.maxDimension);
    }

    // Order matters: deskew first (geometry), then denoise (after geometry),
    // contrast last (it's the most document-dependent).
    if (opts.enableDeskew && quality.score < 0.85) {
      try {
        imageData = deskew(imageData, 5);
      } catch (e) {
        console.warn('Deskew failed, continuing without:', e);
      }
    }

    if (opts.enableDenoising && quality.noise > 0.15) {
      try {
        imageData = applyMedianFilter(imageData);
      } catch (e) {
        console.warn('Denoise failed, continuing without:', e);
      }
    }

    if (opts.enableContrast && quality.contrast < 0.4) {
      try {
        imageData = applyUnsharpMask(imageData, 0.4);
      } catch (e) {
        console.warn('Contrast enhancement failed, continuing without:', e);
      }
    }

    if (opts.enableThresholding && quality.score < 0.5) {
      try {
        imageData = applyThreshold(imageData, opts.thresholdMethod);
      } catch (e) {
        console.warn('Thresholding failed, continuing without:', e);
      }
    }

    const processedBlob = await imageDataToBlob(imageData);
    return { blob: processedBlob, quality };
  } catch (e) {
    console.warn('Preprocessing failed, falling back to original:', e);
    return {
      blob,
      quality: { score: 0.5, contrast: 0.5, noise: 0.5, skew: 0, brightness: 0.5, resolution: 0.5 },
    };
  }
}

/**
 * Light preprocessing that preserves color information.
 * Used when thresholding isn't appropriate (e.g. document with color seals).
 */
export async function lightPreprocess(blob: Blob): Promise<Blob> {
  try {
    let imageData = await blobToImageData(blob);
    imageData = await resizeIfNeeded(imageData, 2400);
    const quality = assessQuality(imageData);
    if (quality.noise > 0.15) imageData = applyBoxBlur(imageData, 1);
    if (quality.contrast < 0.4) imageData = applyUnsharpMask(imageData, 0.3);
    return await imageDataToBlob(imageData);
  } catch (e) {
    console.warn('Light preprocessing failed, using original:', e);
    return blob;
  }
}
