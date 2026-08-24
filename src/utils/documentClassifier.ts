export enum DocumentType {
  KTP_PHOTO = 'ktp-photo',
  ID_CARD = 'id-card',
  FACE_PHOTO = 'face-photo',
  SCANNED_PDF = 'scanned-pdf',
  UNKNOWN = 'unknown',
}

export interface ClassificationResult {
  type: DocumentType;
  confidence: number;
  features: {
    aspectRatio: number;
    textDensity: number;
    avgConfidence: number;
    hasLongNumbers: boolean;
    hasIDKeywords: boolean;
  };
}

/**
 * Classify document type based on image features and OCR results
 */
export function classifyDocument(
  imageData: ImageData,
  words: { text: string; confidence: number }[],
): ClassificationResult {
  const { width, height } = imageData;
  const aspectRatio = width / height;

  const textDensity = words.length / ((width * height) / 10000);
  const avgConf = words.length > 0
    ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
    : 0;

  const hasLongNumbers = words.some(w => /^\d{10,}$/.test(w.text.trim()));
  const hasIDKeywords = words.some(w => /NIK|nik|ktp|KTP|KK|kk|paspor|PASPOR/i.test(w.text.trim()));

  if ((aspectRatio > 1.2 && aspectRatio < 1.8) && (textDensity > 5 || hasLongNumbers || hasIDKeywords)) {
    return { type: DocumentType.KTP_PHOTO, confidence: 0.85, features: { aspectRatio, textDensity, avgConfidence: avgConf, hasLongNumbers, hasIDKeywords } };
  }
  if (textDensity < 3) {
    return { type: DocumentType.FACE_PHOTO, confidence: 0.7, features: { aspectRatio, textDensity, avgConfidence: avgConf, hasLongNumbers, hasIDKeywords } };
  }
  if (textDensity > 10 && avgConf > 70) {
    return { type: DocumentType.SCANNED_PDF, confidence: 0.8, features: { aspectRatio, textDensity, avgConfidence: avgConf, hasLongNumbers, hasIDKeywords } };
  }
  if (aspectRatio > 1.5 && hasLongNumbers) {
    return { type: DocumentType.ID_CARD, confidence: 0.75, features: { aspectRatio, textDensity, avgConfidence: avgConf, hasLongNumbers, hasIDKeywords } };
  }

  return { type: DocumentType.UNKNOWN, confidence: 0.5, features: { aspectRatio, textDensity, avgConfidence: avgConf, hasLongNumbers, hasIDKeywords } };
}

/**
 * Quick classification from image dimensions only (before OCR)
 */
export function preClassifyFromDimensions(width: number, height: number): { type: DocumentType; confidence: number } {
  const aspectRatio = width / height;
  let suggestedType = DocumentType.UNKNOWN;

  if (aspectRatio > 1.2 && aspectRatio < 1.8) {
    suggestedType = DocumentType.KTP_PHOTO;
  } else if (aspectRatio > 1.5) {
    suggestedType = DocumentType.ID_CARD;
  } else if (aspectRatio < 0.9) {
    suggestedType = DocumentType.FACE_PHOTO;
  }

  return { type: suggestedType, confidence: 0.4 };
}

/**
 * Content check: does this image look like a UI screenshot / digital render?
 *
 * UI captures are dominated by one flat background color, while photos of
 * physical documents spread pixels across many color buckets. Measured on
 * synthetic UI captures vs generated+real ID photos, the dominant 12-bit
 * color bucket share separates them cleanly (UI >= 0.66, photos <= 0.28);
 * the 0.45 threshold sits far from both populations.
 *
 * Used to override the aspect-ratio guess so screen captures never receive
 * ID-card OCR profiles (whitelists etc. tuned for card fonts).
 */
export function isUiScreenshot(imageData: { data: Uint8ClampedArray }): boolean {
  const d = imageData.data;
  const step = 4 * Math.max(1, Math.floor(d.length / 4 / 100_000));
  const buckets = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < d.length; i += step) {
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    total++;
  }
  let top = 0;
  for (const n of buckets.values()) if (n > top) top = n;
  return total > 0 && top / total >= 0.45;
}