import { createWorker } from 'tesseract.js';

export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function processDocument(
  file: File, 
  onProgress?: (progress: number) => void
): Promise<SpatialWord[]> {
  const worker = await createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(m.progress);
      }
    }
  });

  const { data } = await worker.recognize(file);
  await worker.terminate();

  const words = data.blocks ? data.blocks.flatMap(b => b.paragraphs).flatMap(p => p.lines).flatMap(l => l.words) : [];

  return words.map((word) => ({
    text: word.text,
    x: word.bbox.x0,
    y: word.bbox.y0,
    width: word.bbox.x1 - word.bbox.x0,
    height: word.bbox.y1 - word.bbox.y0,
  }));
}
