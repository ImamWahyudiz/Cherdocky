import { jsPDF } from 'jspdf';
import type { SpatialWord } from './ocrEngine';
import { detectPII, type PIIType } from './piiDetector';
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

/**
 * Apply pixel-level redaction to a canvas context for PII words.
 * Physically overwrites RGB pixel data with black rectangles — the original
 * pixel content is permanently destroyed in browser RAM.
 */
function applyPixelRedaction(
  ctx: CanvasRenderingContext2D,
  words: SpatialWord[],
  activeTypes: PIIType[],
  coordScale: number,
  customText?: string,
): void {
  ctx.fillStyle = 'black';
  for (const word of words) {
    if (word.forceRedact || detectPII(word.text, activeTypes, customText)) {
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
 * (faces, logos, signatures, etc.). Same pixel-destruction guarantee.
 */
function applyRegionRedaction(
  ctx: CanvasRenderingContext2D,
  regions: DetectedRegion[],
  coordScale: number,
): void {
  ctx.fillStyle = 'black';
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

// --- Image redaction (pixel-level, already secure) ---

export async function redactImage(
  file: File,
  words: SpatialWord[],
  activeTypes: PIIType[],
  customText?: string,
  regions?: DetectedRegion[],
): Promise<Blob> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  ctx.drawImage(img, 0, 0);

  // Image coordinates are at native resolution — scale factor is 1
  applyPixelRedaction(ctx, words, activeTypes, 1, customText);
  if (regions?.length) {
    applyRegionRedaction(ctx, regions, 1);
  }

  const blob = await imageToBlob(canvas, file.type);
  releaseCanvas(canvas);
  return blob;
}

// --- PDF redaction: true pixel-level rasterization pipeline ---
//
// Step A: pdfjs-dist renders each page entirely into an off-screen <canvas>.
//         This converts the full document (text + graphics) into flat pixels.
//
// Step B: ctx.fillRect() physically overwrites PII pixel data on the canvas.
//         The original text pixels are permanently destroyed in browser RAM.
//
// Step C: jsPDF wraps the flattened canvas images into a brand-new PDF that
//         contains ONLY raster images — zero selectable text layer.
//
// Security guarantee: the output PDF contains no text objects, no font
// subsets, no character maps. Tools like pdftotext return empty output.

export async function redactPdf(
  file: File,
  words: SpatialWord[],
  activeTypes: PIIType[],
  documentType: DocumentType,
  customText?: string,
  regions?: DetectedRegion[],
): Promise<Blob> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  // Determine coordinate scaling factor.
  //
  // • text-pdf:  SpatialWord coords come from extractPdfText() at scale=1 (native PDF units).
  //              Since we render at PDF_RENDER_SCALE, coords must be multiplied by it.
  //
  // • image-pdf: SpatialWord coords come from Tesseract on a rasterizePdfPage() blob
  //              that was already rendered at PDF_RENDER_SCALE. Coords already match the
  //              canvas pixel space — no additional scaling needed.
  //
  // Region coords follow the same convention: they are normalized in
  // useDocumentIngestion to match word coordinate space.
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

    await page.render({ canvasContext: ctx, viewport }).promise;

    // --- Step B: Pixel overwrite — destroy PII content ---
    applyPixelRedaction(ctx, words, activeTypes, coordScale, customText);
    if (regions?.length) {
      applyRegionRedaction(ctx, regions, coordScale);
    }

    // --- Step C: Capture the flattened image and add to jsPDF ---
    const imgData = canvas.toDataURL('image/png');

    // Page dimensions in points (1pt = 1/72 inch). jsPDF uses mm by default,
    // so we convert: viewport pixels / scale / 72 * 25.4 = mm
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

    // addImage fills the entire page — the image IS the page content
    doc!.addImage(imgData, 'PNG', 0, 0, pageWidthMM, pageHeightMM, undefined, 'FAST');

    // Release canvas memory immediately to prevent accumulation on large PDFs
    releaseCanvas(canvas);
  }

  if (!doc) throw new Error('No pages found in PDF');

  return doc.output('blob');
}
