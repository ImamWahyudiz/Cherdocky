import { createWorker, type Worker } from 'tesseract.js';
import { getTesseractConfig } from '../tesseractProfiles';
import { DocumentType } from '../documentClassifier';
import type { IOcrEngine, OcrRawWord, RecognizeOptions } from './types';

export class TesseractEngine implements IOcrEngine {
  readonly name = 'tesseract';
  readonly capabilities = {
    psmSweep: true,
    whitelistRescan: true,
    nikRecovery: true,
  } as const;

  private _worker: Worker | null = null;
  private _workerInitializing: Promise<Worker> | null = null;
  private _progressSink: ((p: number) => void) | null = null;

  async initialize(): Promise<void> {
    if (this._worker) return;

    if (!this._workerInitializing) {
      this._workerInitializing = (async () => {
        const worker = await createWorker(['ind', 'eng'], 1, {
          logger: (m) => {
            if (this._progressSink) {
              if (m.status === 'loading tesseract core') this._progressSink(0.01);
              else if (m.status === 'initializing tesseract') this._progressSink(0.02);
              else if (m.status === 'loading language traineddata') this._progressSink(0.03);
              else if (m.status === 'recognizing text') this._progressSink(m.progress);
            }
          },
        });
        this._worker = worker;
        return worker;
      })();
    }

    await this._workerInitializing;
  }

  async recognize(
    image: Blob,
    options?: RecognizeOptions
  ): Promise<OcrRawWord[]> {
    await this.initialize();
    if (!this._worker) throw new Error('Tesseract worker not initialized');

    const docType = options?.docType ?? DocumentType.UNKNOWN;
    const config = getTesseractConfig(docType);

    const params: Record<string, string> = {
      tessedit_pageseg_mode: String(options?.psm ?? config.psm),
      preserve_interword_spaces: '1',
      user_defined_dpi: options?.dpi ?? '150',
      tessedit_char_whitelist: options?.whitelist ?? config.whitelist ?? '',
      tessedit_char_blacklist: options?.blacklist ?? config.blacklist ?? '',
    };

    if (options?.disableDictionaries || docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD) {
      params.load_freq_dawg = '0';
      params.load_system_dawg = '0';
    }

    const prevSink = this._progressSink;
    this._progressSink = options?.onProgress ?? null;

    try {
      await this._worker.setParameters(params as any);
      const { data } = await this._worker.recognize(image, {}, { blocks: true });
      return this.flattenWords(data);
    } finally {
      this._progressSink = prevSink;
      const baseParams = this.buildParams(config, docType);
      await this._worker.setParameters(baseParams as any);
    }
  }

  async terminate(): Promise<void> {
    if (this._worker) {
      await this._worker.terminate();
      this._worker = null;
      this._workerInitializing = null;
    }
  }

  private buildParams(config: ReturnType<typeof getTesseractConfig>, docType: DocumentType): Record<string, string> {
    return {
      tessedit_pageseg_mode: String(config.psm),
      preserve_interword_spaces: '1',
      user_defined_dpi: '150',
      tessedit_char_whitelist: config.whitelist ?? '',
      tessedit_char_blacklist: config.blacklist ?? '',
      ...(docType === DocumentType.KTP_PHOTO || docType === DocumentType.ID_CARD
        ? { load_freq_dawg: '0', load_system_dawg: '0' }
        : {}),
    };
  }

  private flattenWords(raw: any): OcrRawWord[] {
    if (!raw?.blocks) return [];
    return raw.blocks
      .flatMap((b: any) => b.paragraphs)
      .flatMap((p: any) => p.lines)
      .flatMap((l: any) => l.words)
      .map((w: any) => ({
        text: w.text ?? '',
        confidence: w.confidence ?? 0,
        bbox: {
          x0: w.bbox?.x0 ?? 0,
          y0: w.bbox?.y0 ?? 0,
          x1: w.bbox?.x1 ?? 0,
          y1: w.bbox?.y1 ?? 0,
        },
      }));
  }
}