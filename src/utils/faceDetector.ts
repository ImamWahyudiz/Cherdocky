/**
 * Multi-Scale & Tiled Face Detection using MediaPipe BlazeFace.
 *
 * Implements a hierarchical multi-scale scanning strategy:
 * 1. Global Pass: Scans the full document/image.
 * 2. 2x2 Tiled Pass: Scans 4 overlapping quadrants for dense multi-photo grids.
 * 3. 3x3 Tiled Pass: Scans 9 overlapping tiles for high-density grids (e.g. 12-15 photo sheets).
 * 4. First-Come / High-Confidence Deduplication:
 *    Keeps the best-fitted primary face box and drops duplicate selections that overlap
 *    with an already detected face.
 */

export interface DetectedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  score?: number;
}

let cachedDetector: any = null;

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

async function getDetector(): Promise<any> {
  if (cachedDetector) return cachedDetector;

  const vision = await import('@mediapipe/tasks-vision');
  const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_CDN);

  cachedDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.5,
    minSuppressionThreshold: 0.30,
  });

  return cachedDetector;
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for face detection'));
    };
    img.src = url;
  });
}

/**
 * Deduplicate candidate face boxes.
 * Prioritizes the highest-confidence fitted selection and discards any candidate
 * that covers or overlaps significantly with an already detected face.
 */
function deduplicateBoxes(boxes: DetectedRegion[]): DetectedRegion[] {
  // Sort by confidence score descending
  boxes.sort((a, b) => (b.score || 0) - (a.score || 0));
  const accepted: DetectedRegion[] = [];

  for (const cand of boxes) {
    let isDuplicate = false;

    for (const ex of accepted) {
      const xA = Math.max(cand.x, ex.x);
      const yA = Math.max(cand.y, ex.y);
      const xB = Math.min(cand.x + cand.w, ex.x + ex.w);
      const yB = Math.min(cand.y + cand.h, ex.y + ex.h);

      const interW = Math.max(0, xB - xA);
      const interH = Math.max(0, yB - yA);
      const interArea = interW * interH;

      if (interArea <= 0) continue;

      const candArea = cand.w * cand.h;
      const exArea = ex.w * ex.h;

      const overlapCand = interArea / candArea;
      const overlapEx = interArea / exArea;
      const iou = interArea / (candArea + exArea - interArea);

      // Check center distance
      const candCenterX = cand.x + cand.w / 2;
      const candCenterY = cand.y + cand.h / 2;
      const exCenterX = ex.x + ex.w / 2;
      const exCenterY = ex.y + ex.h / 2;
      const dist = Math.hypot(candCenterX - exCenterX, candCenterY - exCenterY);
      const avgSize = (Math.max(cand.w, cand.h) + Math.max(ex.w, ex.h)) / 4;

      // If one covers >= 50% of the other, or IoU > 0.20, or centers are very close -> duplicate
      if (overlapCand > 0.50 || overlapEx > 0.50 || iou > 0.20 || dist < avgSize * 0.65) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      accepted.push(cand);
    }
  }

  return accepted;
}

/**
 * Detect faces in an image using multi-scale tiled BlazeFace.
 * Finds all faces without creating duplicate oversized boxes.
 */
export async function detectFaces(
  source: HTMLImageElement | HTMLCanvasElement | Blob,
  onProgress?: (status: string) => void,
): Promise<DetectedRegion[]> {
  try {
    onProgress?.('Memuat model deteksi wajah…');
    const detector = await getDetector();

    let imageSource: HTMLImageElement | HTMLCanvasElement;
    if (source instanceof Blob) {
      imageSource = await blobToImage(source);
    } else {
      imageSource = source;
    }

    const imgW = imageSource.width || 1;
    const imgH = imageSource.height || 1;

    onProgress?.('Mendeteksi wajah pada dokumen…');

    const candidateBoxes: DetectedRegion[] = [];

    // --- Pass 1: Global full-image scan ---
    try {
      const fullRes = detector.detect(imageSource);
      if (fullRes?.detections) {
        for (const d of fullRes.detections) {
          candidateBoxes.push({
            x: d.boundingBox.originX,
            y: d.boundingBox.originY,
            w: d.boundingBox.width,
            h: d.boundingBox.height,
            score: d.categories?.[0]?.score || 0.6,
          });
        }
      }
    } catch (e) {
      console.warn('Full-scale face detection error:', e);
    }

    // Create an off-screen canvas for tile cropping
    const tileCanvas = document.createElement('canvas');
    const tileCtx = tileCanvas.getContext('2d');

    // --- Pass 2: 2x2 Tiled Scan (4 tiles with 25% overlap) ---
    if (tileCtx && imgW >= 200 && imgH >= 200) {
      const numRows = 2;
      const numCols = 2;
      const overlap = 0.25;

      const tileW = Math.ceil((imgW / numCols) * (1 + overlap));
      const tileH = Math.ceil((imgH / numRows) * (1 + overlap));
      const stepX = (imgW - tileW) / (numCols - 1 || 1);
      const stepY = (imgH - tileH) / (numRows - 1 || 1);

      tileCanvas.width = tileW;
      tileCanvas.height = tileH;

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const offsetX = Math.round(c * stepX);
          const offsetY = Math.round(r * stepY);

          tileCtx.clearRect(0, 0, tileW, tileH);
          tileCtx.drawImage(imageSource, offsetX, offsetY, tileW, tileH, 0, 0, tileW, tileH);

          try {
            const tileRes = detector.detect(tileCanvas);
            if (tileRes?.detections) {
              for (const d of tileRes.detections) {
                candidateBoxes.push({
                  x: d.boundingBox.originX + offsetX,
                  y: d.boundingBox.originY + offsetY,
                  w: d.boundingBox.width,
                  h: d.boundingBox.height,
                  score: d.categories?.[0]?.score || 0.55,
                });
              }
            }
          } catch (_) {}
        }
      }
    }

    // --- Pass 3: 3x3 Tiled Scan (9 tiles with 25% overlap) for dense grids ---
    if (tileCtx && imgW >= 400 && imgH >= 400) {
      const numRows3 = 3;
      const numCols3 = 3;
      const tileW3 = Math.ceil((imgW / numCols3) * 1.25);
      const tileH3 = Math.ceil((imgH / numRows3) * 1.25);
      const stepX3 = (imgW - tileW3) / (numCols3 - 1);
      const stepY3 = (imgH - tileH3) / (numRows3 - 1);

      tileCanvas.width = tileW3;
      tileCanvas.height = tileH3;

      for (let r = 0; r < numRows3; r++) {
        for (let c = 0; c < numCols3; c++) {
          const offsetX = Math.round(c * stepX3);
          const offsetY = Math.round(r * stepY3);

          tileCtx.clearRect(0, 0, tileW3, tileH3);
          tileCtx.drawImage(imageSource, offsetX, offsetY, tileW3, tileH3, 0, 0, tileW3, tileH3);

          try {
            const tileRes = detector.detect(tileCanvas);
            if (tileRes?.detections) {
              for (const d of tileRes.detections) {
                candidateBoxes.push({
                  x: d.boundingBox.originX + offsetX,
                  y: d.boundingBox.originY + offsetY,
                  w: d.boundingBox.width,
                  h: d.boundingBox.height,
                  score: d.categories?.[0]?.score || 0.5,
                });
              }
            }
          } catch (_) {}
        }
      }
    }

    // Clean up canvas
    tileCanvas.width = 0;
    tileCanvas.height = 0;

    // --- Filter invalid aspect ratios, sizes, and low confidence ---
    const pageArea = imgW * imgH;
    const filteredBoxes = candidateBoxes.filter((box) => {
      if (box.w < 12 || box.h < 12) return false;
      // Drop whole-document false positives: a real face never covers
      // most of the page (a KTP photo is typically < 20% of the area).
      if (box.w > imgW * 0.55 || box.h > imgH * 0.55) return false;
      if (box.w * box.h > pageArea * 0.35) return false;
      const ar = box.w / box.h;
      if (ar < 0.55 || ar > 1.8) return false;
      return true;
    });

    // --- Deduplicate: keep the best-fitted primary box and drop duplicates ---
    const acceptedBoxes = deduplicateBoxes(filteredBoxes);

    // --- Add modest expansion padding (+8% sides, +12% top, +6% bottom) ---
    const PAD_X = 0.08;
    const PAD_TOP = 0.12;
    const PAD_BOTTOM = 0.06;

    return acceptedBoxes.map((box) => {
      const padX = box.w * PAD_X;
      const padTop = box.h * PAD_TOP;
      const padBottom = box.h * PAD_BOTTOM;

      const x = Math.max(0, box.x - padX);
      const y = Math.max(0, box.y - padTop);
      const w = Math.min(imgW - x, box.w + padX * 2);
      const h = Math.min(imgH - y, box.h + padTop + padBottom);

      return { x, y, w, h };
    });
  } catch (error) {
    console.warn('Deteksi wajah tidak tersedia, beralih ke mode manual:', error);
    return [];
  }
}
