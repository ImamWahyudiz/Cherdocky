import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { SpatialWord } from './ocrEngine';

// Configure offline worker bundled by Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export const PDF_CANVAS_SCALE = 1.5;

export interface PdfPageMeta {
  pageNum: number;
  width: number;
  height: number;
  blob?: Blob;
}

export interface PdfInspectionResult {
  isTextDominant: boolean;
  totalPages: number;
  totalTextItems: number;
  hasImages: boolean;
}

// Shared offscreen canvas for proportional font metrics measurement
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (!_measureCtx && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    _measureCtx = canvas.getContext('2d');
  }
  return _measureCtx;
}

/**
 * Accurately calculates proportional character widths for any font.
 * Prevents horizontal drift across narrow ('i', 'l', 't') and wide ('M', 'W', 's', 'p') characters.
 */
function getAccurateCharWidths(
  text: string,
  totalWidth: number,
  fontName: string = 'sans-serif',
  fontSize: number = 12
): number[] {
  const len = text.length;
  if (len === 0) return [];
  if (len === 1) return [totalWidth];

  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = `${fontSize}px ${fontName || 'sans-serif'}, Arial, Helvetica, sans-serif`;
    const measured: number[] = new Array(len);
    let totalMeasured = 0;

    for (let i = 0; i < len; i++) {
      const char = text[i];
      const w = char === ' ' ? ctx.measureText(' ').width || fontSize * 0.28 : ctx.measureText(char).width;
      measured[i] = Math.max(w, 0.5);
      totalMeasured += measured[i];
    }

    if (totalMeasured > 0) {
      const scale = totalWidth / totalMeasured;
      return measured.map((w) => w * scale);
    }
  }

  // Fallback to equal distribution
  const avg = totalWidth / len;
  return new Array(len).fill(avg);
}

/**
 * Inspects a PDF file to detect text layer density and presence of scanned images.
 */
export async function inspectPdfContent(file: File): Promise<PdfInspectionResult> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  let totalTextItems = 0;
  let hasImages = false;

  const pagesToSample = Math.min(totalPages, 5);

  for (let i = 1; i <= pagesToSample; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const meaningfulItems = textContent.items.filter(
      (item) => 'str' in item && item.str.trim().length > 0
    );
    totalTextItems += meaningfulItems.length;

    try {
      const ops = await page.getOperatorList();
      for (const fn of ops.fnArray) {
        if (
          fn === pdfjsLib.OPS.paintImageXObject ||
          fn === pdfjsLib.OPS.paintInlineImageXObject ||
          fn === (pdfjsLib.OPS as any).paintImageMaskXObject
        ) {
          hasImages = true;
          break;
        }
      }
    } catch (_) {}
  }

  const avgTextPerPage = totalTextItems / pagesToSample;
  // If average text items per page is >= 8, consider it text dominant
  const isTextDominant = avgTextPerPage >= 8;

  return {
    isTextDominant,
    totalPages,
    totalTextItems,
    hasImages,
  };
}

/**
 * Legacy check: Detects whether page 1 has a text layer.
 */
export async function isPdfTextBased(file: File): Promise<boolean> {
  const inspection = await inspectPdfContent(file);
  return inspection.isTextDominant;
}

/**
 * Extract word-level text from all pages of a text-based PDF using pdfjs-dist.
 * Converts coordinates using PDF.js viewport projection at PDF_CANVAS_SCALE
 * with proportional character metrics and exact baseline alignment.
 */
export async function extractAllPdfText(
  file: File,
  onProgress?: (progress: number) => void
): Promise<{ words: SpatialWord[]; pagesMeta: PdfPageMeta[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const spatialWords: SpatialWord[] = [];
  const pagesMeta: PdfPageMeta[] = [];
  const numPages = pdf.numPages;

  for (let i = 1; i <= numPages; i++) {
    if (onProgress) {
      onProgress(i / numPages);
    }

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_CANVAS_SCALE });

    pagesMeta.push({
      pageNum: i,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    });

    const textContent = await page.getTextContent();

    for (const item of textContent.items) {
      if ('str' in item && typeof item.str === 'string') {
        const rawStr = item.str;
        if (!rawStr.trim()) continue;

        const [scaleX, skewY, , , tx, ty] = item.transform;
        const fontSize = Math.hypot(scaleX, skewY) * PDF_CANVAS_SCALE;
        const fontHeight = Math.max(item.height * PDF_CANVAS_SCALE, fontSize, 10);
        const itemWidth = item.width * PDF_CANVAS_SCALE;

        // Convert base anchor point (baseline) to viewport pixels
        const [vx, vy] = viewport.convertToViewportPoint(tx, ty);

        // Accurate typography bounds:
        // Baseline sits at `vy`.
        // Ascender / Cap-height is approx 0.80 of font height.
        // Descender is approx 0.20 of font height.
        const topY = vy - fontHeight * 0.82;
        const totalHeight = fontHeight * 1.08;

        // Proportional character metrics for the current font
        const charWidths = getAccurateCharWidths(rawStr, itemWidth, (item as any).fontName, fontSize);

        // Split text item into individual tokens (preserving delimiters and whitespace offsets)
        const tokens = rawStr.split(/(\s+)/);
        let charIndex = 0;

        for (const token of tokens) {
          const trimmed = token.trim();
          const tokenLen = token.length;

          if (trimmed.length > 0) {
            const leadingSpaces = token.indexOf(trimmed);
            const wordStartChar = charIndex + leadingSpaces;
            const wordEndChar = wordStartChar + trimmed.length;

            // Compute exact word start X position by summing preceding character widths
            let wordStartX = vx;
            for (let c = 0; c < wordStartChar; c++) {
              wordStartX += charWidths[c] || 0;
            }

            // Compute exact word width by summing constituent character widths
            let wordWidth = 0;
            for (let c = wordStartChar; c < wordEndChar; c++) {
              wordWidth += charWidths[c] || 0;
            }

            // Ignore isolated noise punctuation like purely '-', '_', '~', '—', '|'
            const isPurePunctuation = /^[-_~—|•*#:=;,.\\/]+$/.test(trimmed);
            if (!isPurePunctuation) {
              // Add a slight 1.5px horizontal and 1px vertical safety margin
              // so the blocker box cleanly covers all glyph edges without cutting off serifs or letters
              const padX = 1.5;
              const padY = 1.0;

              spatialWords.push({
                text: trimmed,
                x: Math.round(wordStartX - padX),
                y: Math.max(0, Math.round(topY - padY)),
                width: Math.round(wordWidth + padX * 2),
                height: Math.round(totalHeight + padY * 2),
                confidence: 100,
                pageIndex: i,
              });
            }
          }

          charIndex += tokenLen;
        }
      }
    }
  }

  return { words: spatialWords, pagesMeta };
}

/**
 * Legacy wrapper for single/all words extraction.
 */
export async function extractPdfText(
  file: File,
  onProgress?: (progress: number) => void
): Promise<SpatialWord[]> {
  const res = await extractAllPdfText(file, onProgress);
  return res.words;
}

/**
 * Rasterize all pages of a PDF to image Blobs at PDF_CANVAS_SCALE.
 */
export async function rasterizeAllPdfPages(
  file: File,
  scale: number = PDF_CANVAS_SCALE,
  onProgress?: (p: number) => void
): Promise<PdfPageMeta[]> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;

  const results: PdfPageMeta[] = [];

  for (let i = 1; i <= numPages; i++) {
    if (onProgress) {
      onProgress(i / numPages);
    }

    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Could not get 2d context for PDF page ${i}`);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error(`PDF rasterization to blob failed on page ${i}`));
      }, 'image/png');
    });

    results.push({
      pageNum: i,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      blob,
    });
  }

  return results;
}

/**
 * Rasterize a single page of a PDF to an image Blob.
 */
export async function rasterizePdfPage(
  file: File,
  pageNum: number = 1,
  scale: number = PDF_CANVAS_SCALE
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context for PDF rasterization');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PDF rasterization to blob failed'));
    }, 'image/png');
  });
}
