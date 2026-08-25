/**
 * Multi-Scale & Tiled Face Detection using MediaPipe BlazeFace.
 *
 * Implements a hierarchical multi-scale scanning strategy:
 * 1. Global Pass: Scans the full document/image.
 * 2. 2x2 Tiled Pass: Scans 4 overlapping quadrants for dense multi-photo grids.
 * 3. 3x3 Tiled Pass: Scans 9 overlapping tiles for high-density grids (e.g. 12-15 photo sheets).
 * 4. 4x4 Tiled Pass: Scans 16 fine tiles — small faces in very dense sheets
 *    only reach the confidence floor at this effective resolution.
 * 5. First-Come / High-Confidence Deduplication:
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

interface CandidateBox {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  // Facial keypoints in image pixels: [rightEye, leftEye, noseTip,
  // mouthCenter, rightTragion, leftTragion].
  keypoints?: { x: number; y: number }[];
}

/**
 * Convert one raw MediaPipe detection into our candidate format, mapping
 * coordinates into full-image space (tile offsets included).
 */
function extractCandidate(detection: any, offsetX: number, offsetY: number, srcW: number, srcH: number, fallbackScore: number): CandidateBox {
  const bb = detection.boundingBox;
  const kps = (detection.keypoints ?? []).map((kp: any) => {
    // tasks-vision returns normalized [0..1] coordinates for detectors;
    // guard against runtimes that emit raw pixels instead.
    const normX = kp.x <= 1.5;
    const normY = kp.y <= 1.5;
    return {
      x: (normX ? kp.x * srcW : kp.x) + offsetX,
      y: (normY ? kp.y * srcH : kp.y) + offsetY,
    };
  });
  return {
    x: bb.originX + offsetX,
    y: bb.originY + offsetY,
    w: bb.width,
    h: bb.height,
    score: detection.categories?.[0]?.score || fallbackScore,
    keypoints: kps.length === 6 ? kps : undefined,
  };
}

/**
 * Geometric plausibility check on the six BlazeFace keypoints.
 *
 * Texture regions (foliage, fabric, busy patterns) occasionally trip the
 * classifier, but the resulting "faces" carry incoherent landmark layouts.
 * A real face satisfies all of these regardless of moderate roll/tilt:
 *   - inter-eye span is a sane fraction of the box width
 *   - ear-to-ear span exceeds the inter-eye span
 *   - nose sits below the eye line, mouth below the nose (with slack)
 *   - the eye line is not rotated beyond ~50 degrees
 */
export function keypointsLookLikeFace(kps: { x: number; y: number }[], box: { w: number; h: number }): boolean {
  const [rightEye, leftEye, nose, mouth, rightTragion, leftTragion] = kps;

  const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  const earDist = Math.hypot(leftTragion.x - rightTragion.x, leftTragion.y - rightTragion.y);

  const eyeRatio = eyeDist / Math.max(1, box.w);
  const earRatio = earDist / Math.max(1, eyeDist);
  const eyeY = (rightEye.y + leftEye.y) / 2;
  const boxH = Math.max(1, box.h);
  let eyeAngleDeg = (Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x) * 180) / Math.PI;
  if (eyeAngleDeg > 90) eyeAngleDeg = 180 - eyeAngleDeg;
  if (eyeAngleDeg < -90) eyeAngleDeg = -180 - eyeAngleDeg;

  if (eyeDist < 4) return false;
  if (eyeRatio < 0.12 || eyeRatio > 0.85) return false;
  if (earRatio < 0.9 || earRatio > 4.0) return false;
  if (!(mouth.y > eyeY + boxH * 0.02)) return false;
  if (!(nose.y > eyeY - boxH * 0.05 && nose.y < mouth.y + boxH * 0.15)) return false;
  const maxTilt = (55 * Math.PI) / 180;
  const eyeAngle = Math.abs(Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x));
  if (eyeAngle > maxTilt && Math.PI - eyeAngle > maxTilt) return false;

  return true;
}

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

const WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

let cachedDetector: any = null;

async function getDetector(): Promise<any> {
  if (cachedDetector) return cachedDetector;

  const vision = await import('@mediapipe/tasks-vision');
  const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_CDN);

  // GPU is faster but requires WebGL; headless browsers and some VMs have it
  // disabled, where creation throws — retry once on CPU instead of failing
  // detection entirely.
  const createWith = (delegate: 'GPU' | 'CPU') =>
    vision.FaceDetector.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate,
      },
      runningMode: 'IMAGE',
      // Measured separation (face-eval harness): real faces score >= 0.84,
      // textured-scene false positives cluster at 0.51-0.54. 0.6 keeps a
      // safety margin on both sides.
      minDetectionConfidence: 0.6,
      minSuppressionThreshold: 0.30,
    });

  try {
    cachedDetector = await createWith('GPU');
  } catch (e) {
    console.warn('GPU delegate unavailable for face detection, falling back to CPU:', e);
    cachedDetector = await createWith('CPU');
  }

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

    const candidateBoxes: CandidateBox[] = [];

    // --- Pass 1: Global full-image scan ---
    try {
      const fullRes = detector.detect(imageSource);
      for (const d of fullRes?.detections ?? []) {
        candidateBoxes.push(extractCandidate(d, 0, 0, imgW, imgH, 0.6));
      }
    } catch (e) {
      console.warn('Full-scale face detection error:', e);
    }

    // Create an off-screen canvas for tile cropping
    const tileCanvas = document.createElement('canvas');
    const tileCtx = tileCanvas.getContext('2d');

    // BlazeFace resizes its input to 128px, so each additional tiling level
    // raises the effective resolution per face. Dense ID-photo grids need the
    // finer levels: measured on a 900x600 5x3 sheet, three of fifteen faces
    // never reach the confidence floor in global/2x2/3x3 scans yet score
    // 0.75-0.83 in 4x4 tiles (probe: zz-probe-grid.spec.ts).
    const tiledScan = (
      numRows: number,
      numCols: number,
      minDim: number,
      fallbackScore: number
    ) => {
      if (!tileCtx || imgW < minDim || imgH < minDim) return;
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
            for (const d of tileRes?.detections ?? []) {
              candidateBoxes.push(extractCandidate(d, offsetX, offsetY, tileW, tileH, fallbackScore));
            }
          } catch (_) {}
        }
      }
    };

    // --- Pass 2: 2x2 Tiled Scan ---
    tiledScan(2, 2, 200, 0.55);

    // --- Pass 3: 3x3 Tiled Scan for dense grids ---
    tiledScan(3, 3, 400, 0.5);

    // --- Pass 4: 4x4 Tiled Scan for very dense photo sheets ---
    tiledScan(4, 4, 400, 0.5);

    // Clean up canvas
    tileCanvas.width = 0;
    tileCanvas.height = 0;

    // --- Filter invalid geometry, aspect ratios, sizes, and low confidence ---
    const pageArea = imgW * imgH;
    const filteredBoxes = candidateBoxes.filter((box) => {
      // Keypoint-geometry gate: texture false positives carry incoherent
      // landmarks. Detections without keypoints are kept (cannot judge).
      if (box.keypoints && !keypointsLookLikeFace(box.keypoints, box)) return false;
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

      // Score survives so callers can prioritize / filter by confidence.
      return { x, y, w, h, score: box.score };
    });
  } catch (error) {
    console.warn('Deteksi wajah tidak tersedia, beralih ke mode manual:', error);
    return [];
  }
}
