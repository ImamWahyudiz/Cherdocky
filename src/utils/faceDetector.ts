/**
 * Face detection using MediaPipe BlazeFace.
 *
 * Lazy-loads the WASM runtime and model from CDN on first use.
 * After initial download, files are served from browser cache (offline-capable).
 *
 * Gracefully returns an empty array if the runtime cannot be loaded
 * (e.g. no WASM support, CDN unreachable), so callers never need to
 * handle errors — they just get zero detections and fall back to manual blocking.
 */

export interface DetectedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Singleton detector instance — expensive to create, reusable across calls
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
  });

  return cachedDetector;
}

/**
 * Convert a Blob to an HTMLImageElement so MediaPipe can process it.
 */
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
 * Detect faces in an image using MediaPipe BlazeFace.
 *
 * @param source  An HTMLImageElement, HTMLCanvasElement, or Blob to scan.
 * @param onProgress  Optional callback for UI status updates.
 * @returns Bounding boxes in the input image's pixel coordinate space.
 *          Returns an empty array on any failure (never throws).
 */
export async function detectFaces(
  source: HTMLImageElement | HTMLCanvasElement | Blob,
  onProgress?: (status: string) => void,
): Promise<DetectedRegion[]> {
  try {
    onProgress?.('Loading face detection model…');
    const detector = await getDetector();

    let imageSource: HTMLImageElement | HTMLCanvasElement;
    if (source instanceof Blob) {
      imageSource = await blobToImage(source);
    } else {
      imageSource = source;
    }

    onProgress?.('Detecting faces…');
    const result = detector.detect(imageSource);

    if (!result?.detections?.length) return [];

    return result.detections.map((d: any) => ({
      x: d.boundingBox.originX,
      y: d.boundingBox.originY,
      w: d.boundingBox.width,
      h: d.boundingBox.height,
    }));
  } catch (error) {
    console.warn('Face detection unavailable, falling back to manual mode:', error);
    return [];
  }
}
