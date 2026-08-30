import { TesseractEngine } from './tesseractEngine';
import type { IOcrEngine, EngineProvider } from './types';

export interface OcrEngineConfig {
  provider: EngineProvider;
  enableFallback?: boolean;
}

const STORAGE_KEY = 'cherdocky.ocr-engine';

export function readConfig(): OcrEngineConfig {
  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  const fromWindow = win?.__OCR_ENGINE as EngineProvider | undefined;
  if (fromWindow === 'tesseract' || fromWindow === 'onnx') {
    return { provider: fromWindow, enableFallback: true };
  }
  try {
    const stored = win?.localStorage?.getItem(STORAGE_KEY) as EngineProvider | null;
    if (stored === 'tesseract' || stored === 'onnx') {
      return { provider: stored, enableFallback: true };
    }
  } catch {
    // localStorage may be unavailable (SSR, private mode, restricted iframes)
  }
  return { provider: 'tesseract', enableFallback: true };
}

const _instances = new Map<string, IOcrEngine>();

export async function createOcrEngine(config?: Partial<OcrEngineConfig>): Promise<IOcrEngine> {
  const { provider, enableFallback = true } = { ...readConfig(), ...config };
  const cacheKey = `${provider}:${enableFallback}`;

  const cached = _instances.get(cacheKey);
  if (cached) return cached;

  if (provider === 'onnx') {
    let engine: IOcrEngine;
    try {
      engine = await loadOnnxEngine();
      await engine.initialize();
      console.log('[OCR Engine] Active Provider: ONNX (PP-OCRv4) | Models: det.onnx, rec.onnx');
    } catch (err) {
      if (!enableFallback) {
        throw err;
      }
      console.warn('[ocr-factory] ONNX engine unavailable, falling back to tesseract:', err);
      const fallback = new TesseractEngine();
      await fallback.initialize();
      _instances.set('tesseract:true', fallback);
      return fallback;
    }
    _instances.set(cacheKey, engine);
    return engine;
  }

  const tesseract = new TesseractEngine();
  await tesseract.initialize();
  console.log('[OCR Engine] Active Provider: Tesseract.js (ind+eng)');
  _instances.set(cacheKey, tesseract);
  return tesseract;
}

export function getCachedEngine(provider: EngineProvider, enableFallback = true): IOcrEngine | undefined {
  return _instances.get(`${provider}:${enableFallback}`);
}

export function clearEngineCache(): void {
  _instances.clear();
}

async function loadOnnxEngine(): Promise<IOcrEngine> {
  const mod = await import('./onnxEngine');
  return new mod.OnnxEngine();
}