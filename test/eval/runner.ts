import { processDocument } from '../../src/utils/ocrEngine';
import { analyzeWords, type OcrWord } from '../../src/utils/piiDetector';

// Dev-only eval hook: runs the real app OCR + PII pipeline on a file and
// returns the results so the Playwright eval spec can measure accuracy.
(window as any).runEval = async (file: File) => {
  const words = await processDocument(file);
  const matches = analyzeWords(words as OcrWord[], undefined, {
    requireContextForGated: true,
  });
  return {
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
