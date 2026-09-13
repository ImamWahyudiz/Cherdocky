import { createWorker, type Worker } from 'tesseract.js';
import { getTesseractConfig } from '../tesseractProfiles';
import { DocumentType } from '../documentClassifier';
import type { IOcrEngine, OcrRawWord, RecognizeOptions } from './types';

interface PooledWorker {
  id: number;
  worker: Worker;
  busy: boolean;
  progressSink: ((p: number) => void) | null;
}

function getOptimalConcurrency(): number {
  if (typeof navigator === 'undefined') return 2;
  const mem = (navigator as any).deviceMemory;
  const cores = navigator.hardwareConcurrency || 2;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile || (typeof mem === 'number' && mem < 4) || cores < 4) {
    return 2;
  }
  // Desktop with 4+ cores: allocate up to 3 workers for optimal performance & memory safety
  return Math.min(Math.max(2, Math.floor(cores / 2)), 3);
}

export class TesseractEngine implements IOcrEngine {
  readonly name = 'tesseract';
  readonly capabilities = {
    psmSweep: true,
    whitelistRescan: true,
    nikRecovery: true,
  } as const;

  private _pool: PooledWorker[] = [];
  private _maxWorkers: number = getOptimalConcurrency();
  private _nextWorkerId = 0;
  private _waitQueue: Array<{
    resolve: (worker: PooledWorker) => void;
    reject: (err: any) => void;
  }> = [];
  private _initPromise: Promise<void> | null = null;
  private _isTerminated = false;

  async initialize(): Promise<void> {
    if (this._isTerminated) {
      this._isTerminated = false;
    }
    if (this._pool.length > 0) return;

    if (!this._initPromise) {
      this._initPromise = (async () => {
        // Prewarm first worker
        await this._createPooledWorker();
      })();
    }

    await this._initPromise;
  }

  private async _createPooledWorker(): Promise<PooledWorker> {
    const pooled: PooledWorker = {
      id: ++this._nextWorkerId,
      worker: null as any,
      busy: false,
      progressSink: null,
    };

    const worker = await createWorker(['ind', 'eng'], 1, {
      logger: (m) => {
        if (pooled.progressSink) {
          if (m.status === 'loading tesseract core') pooled.progressSink(0.01);
          else if (m.status === 'initializing tesseract') pooled.progressSink(0.02);
          else if (m.status === 'loading language traineddata') pooled.progressSink(0.03);
          else if (m.status === 'recognizing text') pooled.progressSink(m.progress);
        }
      },
    });

    pooled.worker = worker;
    this._pool.push(pooled);
    return pooled;
  }

  private async _acquireWorker(): Promise<PooledWorker> {
    if (this._isTerminated) throw new Error('TesseractEngine is terminated');

    // 1. Check for an idle worker
    const idle = this._pool.find((w) => !w.busy);
    if (idle) {
      idle.busy = true;
      return idle;
    }

    // 2. Can we spin up a new worker up to maxWorkers?
    if (this._pool.length < this._maxWorkers) {
      const newWorker = await this._createPooledWorker();
      newWorker.busy = true;
      return newWorker;
    }

    // 3. Otherwise queue up and wait
    return new Promise<PooledWorker>((resolve, reject) => {
      this._waitQueue.push({ resolve, reject });
    });
  }

  private _releaseWorker(pooled: PooledWorker): void {
    pooled.progressSink = null;
    if (this._waitQueue.length > 0) {
      const next = this._waitQueue.shift()!;
      pooled.busy = true;
      next.resolve(pooled);
    } else {
      pooled.busy = false;
    }
  }

  async recognize(
    image: Blob,
    options?: RecognizeOptions
  ): Promise<OcrRawWord[]> {
    await this.initialize();
    const pooled = await this._acquireWorker();

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

    pooled.progressSink = options?.onProgress ?? null;

    try {
      await pooled.worker.setParameters(params as any);
      const { data } = await pooled.worker.recognize(image, {}, { blocks: true });
      return this.flattenWords(data);
    } finally {
      const baseParams = this.buildParams(config, docType);
      try {
        await pooled.worker.setParameters(baseParams as any);
      } catch (_) {}
      this._releaseWorker(pooled);
    }
  }

  async terminate(): Promise<void> {
    this._isTerminated = true;
    while (this._waitQueue.length > 0) {
      const pending = this._waitQueue.shift();
      pending?.reject(new Error('TesseractEngine terminated'));
    }
    const currentWorkers = [...this._pool];
    this._pool = [];
    this._initPromise = null;
    await Promise.allSettled(currentWorkers.map((w) => w.worker?.terminate()));
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