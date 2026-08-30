import { type DocumentType } from '../documentClassifier';

export interface OcrRawWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrEngineCapabilities {
  psmSweep: boolean;
  whitelistRescan: boolean;
  nikRecovery: boolean;
}

export type OcrPhase = 'model-load' | 'preprocess' | 'detect' | 'recognize' | 'post';

export interface RecognizeOptions {
  psm?: number;
  whitelist?: string;
  blacklist?: string;
  docType?: DocumentType;
  disableDictionaries?: boolean;
  dpi?: string;
  onProgress?: (progress: number, phase?: OcrPhase) => void;
}

export interface OcrResult {
  tokens: OcrRawWord[];
  fullText: string;
  engine: string;
  executionTimeMs: number;
}

export interface IOcrEngine {
  readonly name: string;
  readonly capabilities: OcrEngineCapabilities;
  initialize(): Promise<void>;
  recognize(image: Blob, options?: RecognizeOptions): Promise<OcrRawWord[]>;
  terminate(): Promise<void>;
}

export type EngineProvider = 'tesseract' | 'onnx';
