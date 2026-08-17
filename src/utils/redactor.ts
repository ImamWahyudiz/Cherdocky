import { PDFDocument, rgb, PDFRawStream } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import type { SpatialWord } from './ocrEngine';
import { detectPII, findContextualPIIWordIndices, type PIIType } from './piiDetector';
import type { DocumentType } from '~/composables/useDocumentIngestion';
import type { DetectedRegion } from './faceDetector';

const PDF_RENDER_SCALE = 1.8;

export type QualityPreset = 'optimal' | 'max' | 'compact';

export interface PageRedactionTarget {
  pageIndex: number;
  imageBlob: Blob;
  width: number;
  height: number;
  words: SpatialWord[];
  regions: DetectedRegion[];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let cleaned = hex.replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned.split('').map((c) => c + c).join('');
  }
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function loadImage(file: File | Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = typeof file === 'string' ? file : URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function imageToBlob(
  canvas: HTMLCanvasElement,
  type: string = 'image/jpeg',
  quality: number = 0.88
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas to Blob failed'));
    }, type, quality);
  });
}

function applyPixelRedaction(
  ctx: CanvasRenderingContext2D,
  words: SpatialWord[],
  activeTypes: PIIType[],
  coordScale: number,
  customText?: string,
  redactionColor: string = '#000000',
): void {
  ctx.fillStyle = redactionColor || '#000000';
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

function applyRegionRedaction(
  ctx: CanvasRenderingContext2D,
  regions: DetectedRegion[],
  coordScale: number,
  redactionColor: string = '#000000',
): void {
  ctx.fillStyle = redactionColor || '#000000';
  for (const r of regions) {
    ctx.fillRect(
      r.x * coordScale,
      r.y * coordScale,
      r.w * coordScale,
      r.h * coordScale,
    );
  }
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Scrubs sensitive text strings from raw PDF content streams.
 */
function scrubTextFromPdfDoc(pdfDoc: PDFDocument, sensitiveTexts: string[]) {
  const uniqueTexts = Array.from(
    new Set(sensitiveTexts.map((t) => t.trim()).filter((t) => t.length > 0))
  ).sort((a, b) => b.length - a.length);

  if (uniqueTexts.length === 0) return;

  const pages = pdfDoc.getPages();
  for (const page of pages) {
    try {
      const contents = (page.node as any).Contents();
      if (!contents) continue;

      const streamRefs = Array.isArray(contents) ? contents : [contents];
      for (const ref of streamRefs) {
        const stream = pdfDoc.context.lookup(ref);
        if (stream instanceof PDFRawStream) {
          const rawBytes = stream.getContents();
          let text = new TextDecoder('latin1').decode(rawBytes);
          let modified = false;

          for (const s of uniqueTexts) {
            if (text.includes(s)) {
              // Replace literal occurrences with spaces of identical length
              const replacement = ' '.repeat(s.length);
              text = text.split(s).join(replacement);
              modified = true;
            }
          }

          if (modified) {
            const encoded = new TextEncoder().encode(text);
            const newStream = pdfDoc.context.flateStream(encoded);
            pdfDoc.context.assign(ref, newStream);
          }
        }
      }
    } catch (_) {}
  }
}

/**
 * Redacts a text-based PDF while keeping it as a true vector PDF (no rasterization to image).
 * 1. Scrubs sensitive text literals from binary content streams.
 * 2. Draws solid blocker rectangles in front of the redacted text positions.
 */
export async function redactNativePdfText(
  file: File | Blob,
  words: SpatialWord[],
  activeTypes: PIIType[],
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = '#000000',
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const autoIndices = findContextualPIIWordIndices(words, activeTypes, customText);

  // Group words by pageIndex (1-indexed)
  const pageWordsMap = new Map<number, { word: SpatialWord; index: number }[]>();
  words.forEach((w, i) => {
    const p = w.pageIndex || 1;
    if (!pageWordsMap.has(p)) pageWordsMap.set(p, []);
    pageWordsMap.get(p)!.push({ word: w, index: i });
  });

  const { r, g, b } = hexToRgb(redactionColor || '#000000');
  const redactColorObj = rgb(r, g, b);

  const sensitiveStringsToScrub: string[] = [];

  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const page = pages[pageNum - 1];
    const pageHeight = page.getHeight();
    const pageWidth = page.getWidth();

    const pageWordEntries = pageWordsMap.get(pageNum) || [];

    for (const { word, index } of pageWordEntries) {
      const isRedacted =
        word.forceRedact || autoIndices.has(index) || detectPII(word.text, activeTypes, customText);

      if (isRedacted) {
        sensitiveStringsToScrub.push(word.text);

        // PDF coordinate system origin is bottom-left in points (Scale 1.0)
        const pdfY = pageHeight - (word.y + word.height) / 1.5;
        const pdfX = word.x / 1.5;
        const pdfW = word.width / 1.5;
        const pdfH = word.height / 1.5;

        page.drawRectangle({
          x: Math.max(0, pdfX - 1),
          y: Math.max(0, pdfY - 1),
          width: Math.min(pageWidth - pdfX + 2, pdfW + 2),
          height: Math.min(pageHeight - pdfY + 2, pdfH + 2),
          color: redactColorObj,
        });
      }
    }

    if (regions && regions.length > 0) {
      for (const reg of regions) {
        const regPage = (reg as any).pageIndex || 1;
        if (regPage === pageNum) {
          const pdfY = pageHeight - (reg.y + reg.h) / 1.5;
          const pdfX = reg.x / 1.5;
          const pdfW = reg.w / 1.5;
          const pdfH = reg.h / 1.5;
          page.drawRectangle({
            x: Math.max(0, pdfX),
            y: Math.max(0, pdfY),
            width: pdfW,
            height: pdfH,
            color: redactColorObj,
          });
        }
      }
    }
  }

  if (sensitiveStringsToScrub.length > 0) {
    scrubTextFromPdfDoc(pdfDoc, sensitiveStringsToScrub);
  }

  // Compress object streams to minimize vector PDF size
  const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

/**
 * Image redaction (pixel-level destructive overwrite with smart compression).
 */
export async function redactImage(
  file: File | Blob | string,
  words: SpatialWord[],
  activeTypes: PIIType[],
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = '#000000',
  qualityPreset: QualityPreset = 'optimal',
  forcedFormat?: 'image/jpeg' | 'image/png',
): Promise<Blob> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d context');

  // Fill white background in case of transparent background for JPEG output
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  applyPixelRedaction(ctx, words, activeTypes, 1, customText, redactionColor);
  if (regions?.length) {
    applyRegionRedaction(ctx, regions, 1, redactionColor);
  }

  let mime = forcedFormat;
  if (!mime) {
    if (file instanceof File && file.type === 'image/png') {
      mime = qualityPreset === 'max' ? 'image/png' : 'image/jpeg';
    } else {
      mime = 'image/jpeg';
    }
  }

  const quality = qualityPreset === 'max' ? 0.98 : qualityPreset === 'compact' ? 0.78 : 0.89;
  const blob = await imageToBlob(canvas, mime, quality);
  releaseCanvas(canvas);
  return blob;
}

/**
 * Redacts an image-based (scanned) PDF page-by-page with JPEG DCT stream compression.
 */
export async function redactScannedPdf(
  file: File | Blob,
  words: SpatialWord[],
  activeTypes: PIIType[],
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = '#000000',
  qualityPreset: QualityPreset = 'optimal',
): Promise<Blob> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = pdf.numPages;

  let doc: jsPDF | null = null;
  const quality = qualityPreset === 'max' ? 0.95 : qualityPreset === 'compact' ? 0.75 : 0.86;

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Could not get 2d context for page ${pageNum}`);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pageWords = words.filter((w) => (w.pageIndex || 1) === pageNum);
    const pageRegions = (regions || []).filter((r) => ((r as any).pageIndex || 1) === pageNum);

    applyPixelRedaction(ctx, pageWords, activeTypes, PDF_RENDER_SCALE, customText, redactionColor);
    if (pageRegions.length > 0) {
      applyRegionRedaction(ctx, pageRegions, PDF_RENDER_SCALE, redactionColor);
    }

    const imgData = canvas.toDataURL('image/jpeg', quality);
    const pageWidthMM = (viewport.width / PDF_RENDER_SCALE / 72) * 25.4;
    const pageHeightMM = (viewport.height / PDF_RENDER_SCALE / 72) * 25.4;

    if (pageNum === 1) {
      doc = new jsPDF({
        orientation: pageWidthMM > pageHeightMM ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidthMM, pageHeightMM],
        compress: true,
      });
    } else {
      doc!.addPage(
        [pageWidthMM, pageHeightMM],
        pageWidthMM > pageHeightMM ? 'landscape' : 'portrait'
      );
    }

    doc!.addImage(imgData, 'JPEG', 0, 0, pageWidthMM, pageHeightMM, undefined, 'FAST');
    releaseCanvas(canvas);
  }

  if (!doc) throw new Error('No pages found in PDF');
  return doc.output('blob');
}

/**
 * Universal PDF Redaction entrypoint.
 */
export async function redactPdf(
  file: File | Blob,
  words: SpatialWord[],
  activeTypes: PIIType[],
  documentType: DocumentType,
  customText?: string,
  regions?: DetectedRegion[],
  redactionColor: string = '#000000',
  qualityPreset: QualityPreset = 'optimal',
): Promise<Blob> {
  if (documentType === 'text-pdf') {
    return redactNativePdfText(file, words, activeTypes, customText, regions, redactionColor);
  } else {
    return redactScannedPdf(file, words, activeTypes, customText, regions, redactionColor, qualityPreset);
  }
}

/**
 * Combines multiple image blobs into a single multi-page PDF with high quality JPEG compression.
 */
export async function exportImagesAsMergedPdf(
  images: { blob: Blob; width: number; height: number }[],
  qualityPreset: QualityPreset = 'optimal',
): Promise<Blob> {
  if (images.length === 0) throw new Error('No images to export');

  let doc: jsPDF | null = null;
  const quality = qualityPreset === 'max' ? 0.96 : qualityPreset === 'compact' ? 0.76 : 0.88;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    
    // Draw on offscreen canvas to ensure high-efficiency JPEG compression inside PDF
    const img = await loadImage(item.blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context failed');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
    releaseCanvas(canvas);

    const widthMM = (item.width / 72) * 25.4;
    const heightMM = (item.height / 72) * 25.4;

    if (i === 0) {
      doc = new jsPDF({
        orientation: widthMM > heightMM ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [widthMM, heightMM],
        compress: true,
      });
    } else {
      doc!.addPage([widthMM, heightMM], widthMM > heightMM ? 'landscape' : 'portrait');
    }

    doc!.addImage(jpegDataUrl, 'JPEG', 0, 0, widthMM, heightMM, undefined, 'FAST');
  }

  return doc!.output('blob');
}

/**
 * Creates a lightweight uncompressed ZIP file containing multiple blobs without external libraries.
 */
export async function createZipBlob(
  files: { name: string; blob: Blob }[]
): Promise<Blob> {
  const entries: { nameBytes: Uint8Array; dataBytes: Uint8Array; crc: number; offset: number }[] = [];
  const parts: Uint8Array[] = [];
  let currentOffset = 0;

  function crc32(bytes: Uint8Array): number {
    let c = 0 ^ -1;
    for (let i = 0; i < bytes.length; i++) {
      c = (c >>> 8) ^ crcTable[(c ^ bytes[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  }

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const dataBuffer = await file.blob.arrayBuffer();
    const dataBytes = new Uint8Array(dataBuffer);
    const crc = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed
    lv.setUint16(6, 0, true); // Flags
    lv.setUint16(8, 0, true); // Compression: 0 = store
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0, true); // Mod date
    lv.setUint32(14, crc, true); // CRC32
    lv.setUint32(18, dataBytes.length, true); // Compressed size
    lv.setUint32(22, dataBytes.length, true); // Uncompressed size
    lv.setUint16(26, nameBytes.length, true); // File name length
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    entries.push({
      nameBytes,
      dataBytes,
      crc,
      offset: currentOffset,
    });

    parts.push(localHeader);
    parts.push(dataBytes);
    currentOffset += localHeader.length + dataBytes.length;
  }

  const centralDirStart = currentOffset;
  let centralDirSize = 0;

  for (const entry of entries) {
    const cdHeader = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0, true); // Flags
    cv.setUint16(10, 0, true); // Compression: 0
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0, true); // Mod date
    cv.setUint32(16, entry.crc, true); // CRC32
    cv.setUint32(20, entry.dataBytes.length, true); // Compressed size
    cv.setUint32(24, entry.dataBytes.length, true); // Uncompressed size
    cv.setUint16(28, entry.nameBytes.length, true); // File name length
    cv.setUint16(30, 0, true); // Extra field length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk #
    cv.setUint16(36, 0, true); // Internal attributes
    cv.setUint32(38, 0, true); // External attributes
    cv.setUint32(42, entry.offset, true); // Relative offset of local header
    cdHeader.set(entry.nameBytes, 46);

    parts.push(cdHeader);
    centralDirSize += cdHeader.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // EOCD signature
  ev.setUint16(4, 0, true); // Disk number
  ev.setUint16(6, 0, true); // Start disk
  ev.setUint16(8, entries.length, true); // Records on this disk
  ev.setUint16(10, entries.length, true); // Total records
  ev.setUint32(12, centralDirSize, true); // Central dir size
  ev.setUint32(16, centralDirStart, true); // Central dir offset
  ev.setUint16(20, 0, true); // Comment length
  parts.push(eocd);

  return new Blob(parts.map((p) => p.buffer as ArrayBuffer), { type: 'application/zip' });
}
