import { processDocument } from '../../src/utils/ocrEngine';
import { analyzeWords, type OcrWord } from '../../src/utils/piiDetector';

// Dev-only eval hook: multi-scale tiled face detection on an image source.
(window as any).runFaces = async (source: File | HTMLCanvasElement | HTMLImageElement) => {
  const { detectFaces } = await import('../../src/utils/faceDetector');
  return detectFaces(source);
};

// Dev-only eval hook: raw Tesseract output with NO preprocessing and NO
// filtering — used to attribute text loss between the OCR engine itself and
// our pipeline stages (preprocess / filterWords).
(window as any).runRaw = async (file: File) => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('ind+eng');
  await worker.setParameters({ tessedit_pageseg_mode: '6' } as any);
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true });
    return {
      text: data.text ?? '',
      words: ((data as any).words ?? []).map((w: any) => ({
        text: w.text ?? '',
        confidence: w.confidence ?? 0,
      })),
    };
  } finally {
    await worker.terminate();
  }
};

// Dev-only eval hook: runs the real app OCR + PII pipeline on a file and
// returns the results so the Playwright eval spec can measure accuracy.
(window as any).runEval = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  const words = await processDocument(file);
  const matches = analyzeWords(words as OcrWord[], undefined, {
    requireContextForGated: true,
  });
  return {
    width,
    height,
    text: words.map((w) => w.text).join(' '),
    words: words.map((w) => ({
      text: w.text,
      x: w.x,
      y: w.y,
      width: w.width,
      height: w.height,
      confidence: w.confidence,
    })),
    matches,
  };
};
