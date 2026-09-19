import { PDFDocument, rgb, PDFRawStream, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import type { SpatialWord } from './ocrEngine';
import { findContextualPIIWordIndices, type PIIType } from './piiDetector';

/**
 * Thrown when a sensitive string is partially redacted (redacted in some places but left unredacted in others).
 * Forcing Native PDF redaction in this state is insecure, as global removal would delete the unredacted instances.
 */
export class PartialRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartialRedactionError';
  }
}

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
    const isRedacted =
      word.forceRedact !== undefined ? word.forceRedact : autoIndices.has(i);
    if (isRedacted) {
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
 * Scrubs sensitive text from a single decoded PDF content stream string.
 *
 * Real PDFs encode text in TJ arrays where a single word is split across
 * multiple literal chunks interleaved with kerning numbers, e.g.:
 *   [(2410)18(60500)18(48)] TJ  → visible text "24106050048"
 *
 * A naive text.includes("24106050048") will never match because the digits
 * are never contiguous in the raw bytes. This function parses each TJ/Tj
 * operator, reconstructs the full visible string from its literal chunks,
 * finds sensitive tokens across chunk boundaries, and blanks only the
 * matched characters while leaving kerning numbers and PDF syntax intact.
 */
function scrubContentStreamText(contentText: string, sensitiveTexts: string[]): { result: string; modified: boolean } {
  let result = contentText;
  let modified = false;

  // --- Pass 1: TJ arrays  [ ... (chunk) kern (chunk) ... ] TJ ---
  result = result.replace(/\[([^\]]*)\]\s*TJ/g, (fullMatch: string, arrayContent: string) => {
    // Parse all literal string chunks inside the array
    interface TJChunk { chars: string[]; startInArray: number; endInArray: number }
    const chunks: TJChunk[] = [];
    let i = 0;
    while (i < arrayContent.length) {
      if (arrayContent[i] === '(') {
        const startInArray = i;
        i++; // skip '('
        const chars: string[] = [];
        while (i < arrayContent.length) {
          if (arrayContent[i] === '\\') {
            // Escaped character — treat as single logical char
            chars.push(arrayContent[i], arrayContent[i + 1] ?? '');
            i += 2;
          } else if (arrayContent[i] === ')') {
            i++; // skip ')'
            break;
          } else {
            chars.push(arrayContent[i++]);
          }
        }
        chunks.push({ chars, startInArray, endInArray: i });
      } else {
        i++;
      }
    }

    if (chunks.length === 0) return fullMatch;

    // Build charMap: position in reconstructed string → [chunkIdx, charIdx]
    const charMap: [number, number][] = [];
    for (let ci = 0; ci < chunks.length; ci++) {
      for (let ch = 0; ch < chunks[ci].chars.length; ch++) {
        charMap.push([ci, ch]);
      }
    }

    // Reconstruct visible text from all chunks — works for ASCII/latin1 text
    const plainText = chunks.map(c => c.chars.join('')).join('');

    let chunkModified = false;
    for (const sensitive of sensitiveTexts) {
      if (!sensitive) continue;
      let pos = 0;
      while (true) {
        const idx = plainText.indexOf(sensitive, pos);
        if (idx < 0) break;
        for (let k = idx; k < idx + sensitive.length; k++) {
          if (k >= charMap.length) break;
          const [ci, ch] = charMap[k];
          chunks[ci].chars[ch] = ' ';
          chunkModified = true;
        }
        pos = idx + sensitive.length;
      }
    }

    if (!chunkModified) return fullMatch;
    modified = true;

    // Rebuild the array content with blanked chunks
    let newArray = '';
    let lastEnd = 0;
    for (const chunk of chunks) {
      newArray += arrayContent.slice(lastEnd, chunk.startInArray);
      newArray += '(' + chunk.chars.join('') + ')';
      lastEnd = chunk.endInArray;
    }
    newArray += arrayContent.slice(lastEnd);
    return '[' + newArray + '] TJ';
  });

  // --- Pass 2: simple Tj  (text) Tj ---
  result = result.replace(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g, (fullMatch: string, literal: string) => {
    const chars = literal.split('');
    let chunkModified = false;
    for (const sensitive of sensitiveTexts) {
      if (!sensitive) continue;
      const text = chars.join('');
      let pos = 0;
      while (true) {
        const idx = text.indexOf(sensitive, pos);
        if (idx < 0) break;
        for (let k = idx; k < idx + sensitive.length; k++) chars[k] = ' ';
        chunkModified = true;
        pos = idx + sensitive.length;
      }
    }
    if (!chunkModified) return fullMatch;
    modified = true;
    return '(' + chars.join('') + ') Tj';
  });

  return { result, modified };
}

/**
 * Encodes a latin1 JS string back to a Uint8Array (one byte per character).
 * Must be used instead of TextEncoder (which uses UTF-8 and corrupts bytes > 127).
 */
function latin1Encode(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Scrubs sensitive text strings from raw PDF content streams by parsing
 * TJ/Tj operators and blanking matched characters across kerning-split chunks.
 * Also handles legacy literal and hex-encoded fallbacks for simple PDFs.
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

      const streamRefs = contents instanceof PDFArray
        ? contents.asArray()
        : Array.isArray(contents)
        ? contents
        : [contents];
      for (const ref of streamRefs) {
        const stream = pdfDoc.context.lookup(ref);
        if (stream instanceof PDFRawStream) {
          let rawBytes: Uint8Array;
          try {
            rawBytes = decodePDFRawStream(stream).decode();
          } catch (_) {
            rawBytes = stream.getContents();
          }
          // Decode as latin1: each byte → one JS character (code 0–255, bijective)
          let text = new TextDecoder('latin1').decode(rawBytes);

          // --- Primary: TJ-aware scrubber (handles kerning-split text) ---
          const { result: tjResult, modified: tjModified } = scrubContentStreamText(text, uniqueTexts);
          if (tjModified) {
            text = tjResult;
          }

          // --- Fallback: plain literal and hex matches for non-TJ encoded content ---
          let fallbackModified = false;
          for (const s of uniqueTexts) {
            if (text.includes(s)) {
              text = text.split(s).join(' '.repeat(s.length));
              fallbackModified = true;
            }
            // Hex-encoded strings like <4e494b3a> in streams
            const hexS = Array.from(s).map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
            const hexUpper = hexS.toUpperCase();
            const hexLower = hexS.toLowerCase();
            const hexRep = '20'.repeat(s.length);
            if (text.includes(hexUpper)) {
              text = text.split(hexUpper).join(hexRep);
              fallbackModified = true;
            } else if (text.includes(hexLower)) {
              text = text.split(hexLower).join(hexRep);
              fallbackModified = true;
            }
          }

          if (tjModified || fallbackModified) {
            // CRITICAL: re-encode as latin1 (1 char → 1 byte), NOT UTF-8.
            // TextEncoder uses UTF-8 and corrupts bytes 128–255 which are
            // common in PDF binary content streams (font refs, operators etc.).
            const encoded = latin1Encode(text);
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
 * 1. Scrubs sensitive text literals from binary content streams (TJ-aware, handles kerning arrays).
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
        word.forceRedact !== undefined ? word.forceRedact : autoIndices.has(index);

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

  // Texts that belong to unredacted words must NEVER be scrubbed from the PDF text stream
  const unredactedWordTexts = new Set(
    words
      .filter((w, i) => {
        const isRedacted = w.forceRedact !== undefined ? w.forceRedact : autoIndices.has(i);
        return !isRedacted;
      })
      .map((w) => (w.text || '').trim().toLowerCase())
      .filter((t) => t.length > 0)
  );

  // Remove the >= 3 length filter — short tokens like "51", "01" are legitimate PII digits
  const safeStringsToScrub = sensitiveStringsToScrub.filter((t) => {
    const trimmed = t.trim();
    return trimmed.length >= 1 && !unredactedWordTexts.has(trimmed.toLowerCase());
  });

  const unsafeStrings = sensitiveStringsToScrub.filter((t) => {
    const trimmed = t.trim();
    return trimmed.length >= 1 && unredactedWordTexts.has(trimmed.toLowerCase());
  });

  if (unsafeStrings.length > 0) {
    throw new PartialRedactionError('Unredacted duplicates found for sensitive text');
  }

  if (safeStringsToScrub.length > 0) {
    scrubTextFromPdfDoc(pdfDoc, safeStringsToScrub);
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
