import type { SpatialWord } from './ocrEngine';

/**
 * Detects whether a PDF has a real text layer or is just scanned images.
 * Checks the first page: if it has fewer than 5 text items, it's likely image-based.
 */
export async function isPdfTextBased(file: File): Promise<boolean> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();

  // Count non-empty text items
  const meaningfulItems = textContent.items.filter(
    (item) => 'str' in item && item.str.trim().length > 0
  );

  // If there are very few text items, it's likely a scanned/image PDF
  return meaningfulItems.length >= 5;
}

/**
 * Extract text from a text-based PDF using pdfjs-dist's native text layer.
 * Only call this for PDFs confirmed to be text-based.
 */
export async function extractPdfText(file: File, onProgress?: (progress: number) => void): Promise<SpatialWord[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const spatialWords: SpatialWord[] = [];
  const numPages = pdf.numPages;
  
  for (let i = 1; i <= numPages; i++) {
    if (onProgress) {
      onProgress(i / numPages);
    }
    
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    
    for (const item of textContent.items) {
      if ('str' in item) {
        const text = item.str.trim();
        if (!text) continue;
        
        // item.transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
        const x = item.transform[4];
        const y = item.transform[5];
        const width = item.width;
        const height = item.height;
        
        // pdf.js origin is bottom-left, invert Y to match top-left (browser/canvas) origin
        const adjustedY = viewport.height - y - height;
        
        spatialWords.push({
          text,
          x,
          y: adjustedY,
          width,
          height,
          confidence: 100, // Native extraction is perfectly confident
        });
      }
    }
  }
  
  return spatialWords;
}

/**
 * Rasterize the first page of a PDF to an image Blob for OCR processing.
 * Used for image-based (scanned) PDFs so we can feed them to Tesseract.
 */
export async function rasterizePdfPage(file: File, pageNum: number = 1, scale: number = 2): Promise<Blob> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context for PDF rasterization');

  // Fill solid white background so transparent PDFs don't appear black/dark
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
