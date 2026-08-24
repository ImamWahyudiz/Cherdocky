import { DocumentType } from './documentClassifier';

export interface TesseractConfig {
  oem: number;
  psm: number;
  lang: string;
  whitelist?: string;
  blacklist?: string;
}

/**
 * Document-type specific Tesseract configurations optimized for each document type
 */
export const TESSERACT_CONFIGS: Record<DocumentType, TesseractConfig> = {
  [DocumentType.KTP_PHOTO]: {
    oem: 1,                    // LSTM only - best for handwriting
    psm: 6,                    // Single uniform text block
    lang: 'ind+eng',
    whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,:-/()',
    // The constrained charset is deliberate for the card's dot-matrix-style
    // font: it stops the LSTM from reading stylized digits as exotic letters.
  },
  [DocumentType.ID_CARD]: {
    oem: 1,
    psm: 6,                    // Single uniform text block (was psm:8 — too narrow for whole-card images)
    lang: 'ind+eng',
    blacklist: '.,;:!?@#$%^&*()[]{}',
  },
  [DocumentType.FACE_PHOTO]: {
    oem: 1,
    psm: 6,                    // Single text block
    lang: 'eng+ind',
  },
  [DocumentType.SCANNED_PDF]: {
    oem: 1,
    psm: 4,                    // Single column of text
    lang: 'ind+eng',
  },
  [DocumentType.UNKNOWN]: {
    oem: 1,
    psm: 3,                    // Fully automatic
    lang: 'ind+eng',
  },
};

/**
 * Fallback PSM modes to try if primary fails
 */
export const FALLBACK_PSM_MODES: Record<DocumentType, number[]> = {
  [DocumentType.KTP_PHOTO]: [6, 4, 11, 3],
  [DocumentType.ID_CARD]: [8, 7, 13, 6],
  [DocumentType.FACE_PHOTO]: [6, 11, 4, 3],
  [DocumentType.SCANNED_PDF]: [4, 6, 3, 1],
  [DocumentType.UNKNOWN]: [3, 6, 4, 11],
};

/**
 * Get Tesseract config for a document type
 */
export function getTesseractConfig(docType: DocumentType): TesseractConfig {
  return TESSERACT_CONFIGS[docType] || TESSERACT_CONFIGS[DocumentType.UNKNOWN];
}

/**
 * Get fallback PSM modes for a document type
 */
export function getFallbackPSMs(docType: DocumentType): number[] {
  return FALLBACK_PSM_MODES[docType] || FALLBACK_PSM_MODES[DocumentType.UNKNOWN];
}

/**
 * Generate a cache key for a Tesseract config
 */
export function getConfigKey(config: TesseractConfig): string {
  return `${config.lang}|${config.oem}|${config.psm}|${config.whitelist || ''}|${config.blacklist || ''}`;
}