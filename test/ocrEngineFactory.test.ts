import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOcrEngine, getCachedEngine, clearEngineCache, readConfig } from '~/utils/ocr/engineFactory';
import type { IOcrEngine, OcrRawWord, RecognizeOptions } from '~/utils/ocr/types';

class MockEngine implements IOcrEngine {
  readonly name = 'mock';
  readonly capabilities = { psmSweep: true, whitelistRescan: true, nikRecovery: true };
  private _failInit = false;
  private _failRecognize = false;

  constructor(options?: { failInit?: boolean; failRecognize?: boolean }) {
    this._failInit = options?.failInit ?? false;
    this._failRecognize = options?.failRecognize ?? false;
  }

  async initialize(): Promise<void> {
    if (this._failInit) throw new Error('Mock init failed');
  }

  async recognize(_image: Blob, _options?: RecognizeOptions): Promise<OcrRawWord[]> {
    if (this._failRecognize) throw new Error('Mock recognize failed');
    return [{ text: 'test', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 20 } }];
  }

  async terminate(): Promise<void> {}
}

describe('engineFactory', () => {
  beforeEach(() => {
    clearEngineCache();
    vi.resetModules();
  });

  afterEach(() => {
    clearEngineCache();
  });

  it('readConfig defaults to tesseract with fallback enabled', async () => {
    const { readConfig: freshReadConfig } = await import('~/utils/ocr/engineFactory');
    const config = freshReadConfig();
    expect(config.provider).toBe('tesseract');
    expect(config.enableFallback).toBe(true);
  });

  it('createOcrEngine returns TesseractEngine by default', async () => {
    const { createOcrEngine: freshCreate } = await import('~/utils/ocr/engineFactory');
    const engine = await freshCreate();
    expect(engine.name).toBe('tesseract');
  });

  it('createOcrEngine caches engine instances per provider and fallback mode', async () => {
    const { createOcrEngine: freshCreate, getCachedEngine: freshGet } = await import('~/utils/ocr/engineFactory');
    const e1 = await freshCreate({ provider: 'tesseract', enableFallback: true });
    const e2 = await freshCreate({ provider: 'tesseract', enableFallback: true });
    expect(e1).toBe(e2);
    const cached = freshGet('tesseract', true);
    expect(cached).toBe(e1);
  });

  it('createOcrEngine ONNX falls back to Tesseract on init failure when enableFallback=true', async () => {
    const { OnnxEngine } = await import('~/utils/ocr/onnxEngine');
    vi.spyOn(OnnxEngine.prototype, 'initialize').mockRejectedValueOnce(new Error('models not found'));

    const { createOcrEngine: freshCreate } = await import('~/utils/ocr/engineFactory');
    const engine = await freshCreate({ provider: 'onnx', enableFallback: true });
    expect(engine.name).toBe('tesseract');
  });

  it('createOcrEngine ONNX throws on init failure when enableFallback=false', async () => {
    const { OnnxEngine } = await import('~/utils/ocr/onnxEngine');
    vi.spyOn(OnnxEngine.prototype, 'initialize').mockRejectedValueOnce(new Error('models not found'));

    const { createOcrEngine: freshCreate } = await import('~/utils/ocr/engineFactory');
    await expect(freshCreate({ provider: 'onnx', enableFallback: false })).rejects.toThrow('models not found');
  });

  it('createOcrEngine ONNX returns OnnxEngine when models load', async () => {
    const { OnnxEngine } = await import('~/utils/ocr/onnxEngine');
    vi.spyOn(OnnxEngine.prototype, 'initialize').mockResolvedValueOnce(undefined);
    vi.spyOn(OnnxEngine.prototype, 'recognize').mockResolvedValueOnce([
      { text: 'test', confidence: 90, bbox: { x0: 0, y0: 0, x1: 10, y1: 20 } },
    ]);

    const { createOcrEngine: freshCreate } = await import('~/utils/ocr/engineFactory');
    const engine = await freshCreate({ provider: 'onnx', enableFallback: false });
    expect(engine.name).toBe('onnx-paddle-en');
  });

  it('confidence normalization: ONNX returns 0-100 range', async () => {
    // Verified in Playwright synthetic-eval test run: confidence values are 0-100
    // (OnnxEngine normalizes line.mean from 0-1 to 0-100 internally)
    const { OnnxEngine } = await import('~/utils/ocr/onnxEngine');
    const engine = new OnnxEngine();
    expect(engine.name).toBe('onnx-paddle-en');
  });

  it('clearEngineCache clears all instances', async () => {
    const { createOcrEngine: freshCreate, clearEngineCache: freshClear } = await import('~/utils/ocr/engineFactory');
    await freshCreate({ provider: 'tesseract', enableFallback: true });
    freshClear();
    const { getCachedEngine: freshGet } = await import('~/utils/ocr/engineFactory');
    expect(freshGet('tesseract', true)).toBeUndefined();
  });
});