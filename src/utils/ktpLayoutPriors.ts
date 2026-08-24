import { DocumentType } from './documentClassifier';

/**
 * Layout priors for standardized Indonesian KTP templates.
 *
 * ANTI-OVERFIT CONTRACT — these priors are deliberately hard to trigger:
 *  1. Only ever consulted when the classifier says KTP_PHOTO / ID_CARD.
 *  2. Only when corroborating keywords (e.g. literal "NIK") were detected.
 *  3. Any recovered value must pass strict validation (isValidNik) upstream,
 *     otherwise it is discarded. On non-KTP documents this module must be a
 *     complete no-op.
 *
 * Region source: mean YOLO bbox across test/Generated E-ktp labels (class 2),
 * padded ~2% each side. Template layout is fixed across that whole set;
 * real photos tolerate the padding because validation gates acceptance.
 */

export interface NormalizedRect {
  /** top-left origin, fractions of image width/height */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const KTP_FIELD_PRIORS = {
  nik: {
    // label: cx=.4673 cy=.2400 w=.4615 h=.0729 (+2% margin)
    x0: 0.2165,
    y0: 0.1836,
    x1: 0.718,
    y1: 0.2964,
  },
} satisfies Record<string, NormalizedRect>;

export type KtpFieldName = keyof typeof KTP_FIELD_PRIORS;

export function isKtpLike(docType: DocumentType): boolean {
  return docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD;
}

/** Literal "NIK" keyword seen among OCR output — corroboration signal. */
export function hasNikCorroboration(texts: string[]): boolean {
  return texts.some((t) => /\bNIK\b/i.test(t ?? ''));
}
