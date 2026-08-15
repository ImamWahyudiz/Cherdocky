import { jsPDF } from 'jspdf';
import type { SpatialWord } from './ocrEngine';
import { detectPII, findContextualPIIWordIndices, type PIIType } from './piiDetector';
import type { DocumentType } from '~/composables/useDocumentIngestion';
import type { DetectedRegion } from './faceDetector';

/**
 * Render scale used when rasterizing PDF pages to canvas.
 * Must match the scale used by rasterizePdfPage() in pdfExtractor.ts
 * so that coordinate systems align for image-based PDFs.
 */
const PDF_RENDER_SCALE = 2;

// --- Shared helpers ---

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function imageToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas to Blob failed'));
    }, type);
  });
}

function applyPixelRedaction(
  ctx: CanvasRenderingContext2D,
  words: SpatialWord[],
  activeTypes: PIIType[],
  coordScale: number,
  customText?: string,
  redactionColor: string = 'black',
): void {
  ctx.fillStyle = redactionColor || 'black';
  const autoIndices = findContextualPIIWordIndices(words, activeTypes, customText);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.forceRedact || autoIndices.has(i) || detectPII(word.text, activeTypes, customText)) {
      ctx.fillRect(
        word.x * coordScale,
        word.y * coordScale,
        word.width * coordScale,
        word.height * coordScale,
      );
    }
  }
}

/**
 * Apply pixel-level redaction for arbitrary rectangular regions
 * (faces, logos, signatures, manual blocks, etc.).
 */
function applyRegionRedaction(
  ctx: CanvasRenderingContext2D,
  regions: DetectedRegion[],
  coordScale: number,
  redactionColor: string = 'black',
): void {
  ctx.fillStyle = redactionColor || 'black';
  for (const r of regions) {
    ctx.fillRect(
      r.x * coordScale,
      r.y * coordScale,
      r.w * coordScale,
      r.h * coordScale,
    );
  }
}

/**
 * Release an off-screen canvas to free GPU / pixel-buffer memory.
 * Setting dimensions to 0 forces the browser to deallocate the backing store.
 */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

// --- Image redaction (pixel-level, destructive) ---

export async function redactImage(
  file: File | Blob,
  words: SpatialWord[],
  activeTypes: PIIType[],
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = 'black',
): Promise<Blob> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  ctx.drawImage(img, 0, 0);

  // Image coordinates are at native resolution — scale factor is 1
  applyPixelRedaction(ctx, words, activeTypes, 1, customText, redactionColor);
  if (regions?.length) {
    applyRegionRedaction(ctx, regions, 1, redactionColor);
  }

  const outputType = file instanceof File ? file.type : 'image/png';
  const blob = await imageToBlob(canvas, outputType || 'image/png');
  releaseCanvas(canvas);
  return blob;
}

// --- PDF redaction: true pixel-level rasterization pipeline ---

export async function redactPdf(
  file: File | Blob,
  words: SpatialWord[],
  activeTypes: PIIType[],
  documentType: DocumentType,
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = 'black',
): Promise<Blob> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  const coordScale = documentType === 'text-pdf' ? PDF_RENDER_SCALE : 1;

  let doc: jsPDF | null = null;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

    // --- Step A: Rasterize the page to an off-screen canvas ---
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Could not get 2d context for page ${pageNum}`);

    // Fill solid white background so transparent PDFs don't export with dark/transparent canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    // --- Step B: Pixel overwrite — destroy PII content with chosen color ---
    applyPixelRedaction(ctx, words, activeTypes, coordScale, customText, redactionColor);
    if (regions?.length) {
      applyRegionRedaction(ctx, regions, coordScale, redactionColor);
    }

    // --- Step C: Capture the flattened image and add to jsPDF ---
    const imgData = canvas.toDataURL('image/png');

    // Convert viewport pixels to mm for jsPDF
    const pageWidthMM = (viewport.width / PDF_RENDER_SCALE / 72) * 25.4;
    const pageHeightMM = (viewport.height / PDF_RENDER_SCALE / 72) * 25.4;

    if (pageNum === 1) {
      doc = new jsPDF({
        orientation: pageWidthMM > pageHeightMM ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidthMM, pageHeightMM],
      });
    } else {
      doc!.addPage([pageWidthMM, pageHeightMM],
        pageWidthMM > pageHeightMM ? 'landscape' : 'portrait');
    }

    doc!.addImage(imgData, 'PNG', 0, 0, pageWidthMM, pageHeightMM, undefined, 'FAST');

    releaseCanvas(canvas);
  }

  if (!doc) throw new Error('No pages found in PDF');

  return doc.output('blob');
}
