import type { OcrRawWord, RecognizeOptions } from './types';
import { Tensor } from 'onnxruntime-web';
import { splitIntoLineImages } from '@gutenye/ocr-common/splitIntoLineImages';
import '@gutenye/ocr-browser';

const RECOG_HEIGHT = 48;
const DET_THRESHOLD = 0.005;
const MAX_SIDE = 1920;

// Module-level singletons
let detSession: any = null;
let recogSession: any = null;
let recogDict: string[] = [];

async function initDet(): Promise<void> {
  if (detSession) return;
  const ort = await import('onnxruntime-web');
  detSession = await ort.InferenceSession.create('/models/ocr/ch_PP-OCRv4_det_infer.onnx');
  console.log('[ONNX-EN] Detection model loaded');
}

async function initRecog(): Promise<void> {
  if (recogSession) return;
  const ort = await import('onnxruntime-web');
  recogSession = await ort.InferenceSession.create('/models/ocr/en_PP-OCRv4_rec_mobile.onnx');
  const resp = await fetch('/models/ocr/en_dict.txt');
  const txt = await resp.text();
  const dict = txt.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0);
  if (dict.length === 95) dict.push(' ');
  recogDict = dict;
  console.log('[ONNX-EN] Recognition model loaded, dict:', recogDict.length, '(expected 96)');
}

function preprocessDet(img: HTMLCanvasElement): { input: Tensor; detW: number; detH: number } {
  const srcW = img.width, srcH = img.height;
  const maxSide = Math.max(srcW, srcH);
  const scale = maxSide > MAX_SIDE ? MAX_SIDE / maxSide : 1;
  let dstW = Math.round(srcW * scale);
  let dstH = Math.round(srcH * scale);
  dstW = Math.max(Math.ceil(dstW / 32) * 32, 32);
  dstH = Math.max(Math.ceil(dstH / 32) * 32, 32);

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = dstW;
  tmpCanvas.height = dstH;
  const ctx = tmpCanvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, dstW, dstH);

  const imgData = ctx.getImageData(0, 0, dstW, dstH);
  const data = imgData.data;
  const n = dstH * dstW;
  const chw = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    const si = i * 4;
    chw[i] = data[si + 2] / 255;     // B
    chw[n + i] = data[si + 1] / 255; // G
    chw[2 * n + i] = data[si] / 255; // R
  }
  return { input: new Tensor('float32', chw, [1, 3, dstH, dstW]), detW: dstW, detH: dstH };
}

function ctcGreedyDecode(logits: Float32Array, classCount: number): { text: string; confidence: number } {
  const T = logits.length / classCount;
  let prevIdx = -1;
  const chars: string[] = [];
  let confSum = 0, charCount = 0;
  for (let t = 0; t < T; t++) {
    const base = t * classCount;
    let maxIdx = 0, maxVal = -Infinity;
    for (let c = 0; c < classCount; c++) {
      const v = logits[base + c];
      if (v > maxVal) { maxVal = v; maxIdx = c; }
    }
    if (maxIdx !== 0 && maxIdx !== prevIdx) {
      const d = maxIdx - 1;
      if (d >= 0 && d < recogDict.length) {
        chars.push(recogDict[d]);
        confSum += maxVal;
        charCount++;
      }
    }
    prevIdx = maxIdx;
  }
  return { text: chars.join(''), confidence: charCount > 0 ? Math.round(confSum / charCount * 100) : 0 };
}

async function recognizeLineImage(lineImage: { image: { data: Uint8ClampedArray; width: number; height: number; resize: (opts: { height: number }) => Promise<{ data: Uint8ClampedArray; width: number; height: number }> }; box: number[][] }): Promise<{ text: string; confidence: number }> {
  if (!recogSession) throw new Error('Recog session not initialized');

  // Resize to 48px height using the line image's built-in resize
  const resized = await lineImage.image.resize({ height: RECOG_HEIGHT });
  let w = resized.width, h = resized.height;

  // For small crops (<24px), do an extra 2x upscale with high-quality to reduce blur
  if (h < 24) {
    const tmp = document.createElement('canvas');
    tmp.width = w * 2;
    tmp.height = h * 2;
    const ctx = tmp.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Create an ImageData from resized.data
    const imgData = new ImageData(new Uint8ClampedArray(resized.data), w, h);
    ctx.putImageData(imgData, 0, 0);
    ctx.drawImage(tmp, 0, 0, w * 2, h * 2);
    const newData = ctx.getImageData(0, 0, w * 2, h * 2);
    resized.data = newData.data;
    w = w * 2;
    h = h * 2;
  }

  const n = w * h;
  const chw = new Float32Array(3 * n);
  // BGR, (pixel-127.5)/127.5
  for (let i = 0; i < n; i++) {
    const si = i * 4;
    chw[i] = (resized.data[si + 2] - 127.5) / 127.5;
    chw[n + i] = (resized.data[si + 1] - 127.5) / 127.5;
    chw[2 * n + i] = (resized.data[si] - 127.5) / 127.5;
  }

  const inputTensor = new Tensor('float32', chw, [1, 3, h, w]);
  const inputName = recogSession.inputNames[0];
  const output = await recogSession.run({ [inputName]: inputTensor });
  const outputTensor = output[recogSession.outputNames[0]];
  return ctcGreedyDecode(outputTensor.data as Float32Array, outputTensor.dims[outputTensor.dims.length - 1]);
}

export class OnnxEngine {
  readonly name = 'onnx-paddle-en';
  readonly capabilities = { psmSweep: false, whitelistRescan: false, nikRecovery: false };

  private _initialized = false;

  async initialize(): Promise<void> {
    if (this._initialized) return;
    console.log('[ONNX-EN] Loading detection model...');
    await initDet();
    console.log('[ONNX-EN] Loading recognition model...');
    await initRecog();
    this._initialized = true;
    console.log('[ONNX-EN] Models loaded successfully');
  }

  async recognize(image: Blob, _options?: RecognizeOptions): Promise<OcrRawWord[]> {
    await this.initialize();

    const url = URL.createObjectURL(image);
    try {
      const img = new Image();
      img.src = url;
      await new Promise<void>((r) => { img.onload = () => r(); });

      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      srcCanvas.getContext('2d')!.drawImage(img, 0, 0);

      // --- Detection: run model, threshold, get RGBA mask ---
      const { input, detW, detH } = preprocessDet(srcCanvas);
      const detInName = detSession.inputNames[0];
      const detOutput = await detSession.run({ [detInName]: input });
      const detOutTensor = detOutput[detSession.outputNames[0]];
      const probMap = detOutTensor.data as Float32Array;

      // Build RGBA mask (Uint8ClampedArray) for OpenCV findContours
      const maskData = new Uint8ClampedArray(detH * detW * 4);
      for (let i = 0; i < detH * detW; i++) {
        const v = probMap[i] > DET_THRESHOLD ? 255 : 0;
        const o = i * 4;
        maskData[o] = v;     // R
        maskData[o + 1] = v; // G
        maskData[o + 2] = v; // B
        maskData[o + 3] = 255; // A
      }

      const maskImage = { data: maskData, width: detW, height: detH };
      const sourceImage = { data: new Uint8ClampedArray(img.width * img.height * 4), width: img.width, height: img.height };
      // Fill sourceImage with original pixels (RGBA)
      const srcCtx = srcCanvas.getContext('2d')!;
      const srcImgData = srcCtx.getImageData(0, 0, img.width, img.height);
      sourceImage.data.set(srcImgData.data);

      console.log('[ONNX-EN] Running splitIntoLineImages...');
      const lineImages = await splitIntoLineImages(maskImage as any, sourceImage as any);
      console.log('[ONNX-EN] Detection found', lineImages.length, 'line(s)');

      // --- Recognition per line, split into words with proportional sub-bboxes ---
      const results: OcrRawWord[] = [];
      for (const lineImage of lineImages) {
        const { text, confidence } = await recognizeLineImage(lineImage as any);
        if (!text || !/[a-zA-Z0-9]/.test(text)) continue;

        const box = lineImage.box;
        const xs = box.map((p: number[]) => p[0]);
        const ys = box.map((p: number[]) => p[1]);
        const x0 = Math.max(0, Math.floor(Math.min(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys)));
        const x1 = Math.ceil(Math.max(...xs));
        const y1 = Math.ceil(Math.max(...ys));
        const lineW = x1 - x0;

        const tokens = text.split(/\s+/).filter(t => t.length > 0);
        if (tokens.length === 0) continue;

        // Proportional x-position by character count within the line
        const totalChars = tokens.reduce((s, t) => s + t.length, 0);
        let charCursor = 0;
        for (const token of tokens) {
          const tokenChars = token.length;
          const fracStart = totalChars > 0 ? charCursor / totalChars : 0;
          const fracEnd = totalChars > 0 ? (charCursor + tokenChars) / totalChars : 1;
          const tokX0 = Math.round(x0 + lineW * fracStart);
          const tokX1 = Math.round(x0 + lineW * fracEnd);
          charCursor += tokenChars + 1; // +1 for space

          results.push({
            text: token,
            confidence,
            bbox: { x0: tokX0, y0, x1: tokX1, y1 }
          });
        }
      }

      console.log('[ONNX-EN] Recognition output:', results.length, 'word(s)');
      if ((window as any).__OCR_DEBUG === true) {
        for (const w of results.slice(0, 5)) {
          console.log('[ONNX-EN] word:', JSON.stringify(w.text));
        }
      }
      return results;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async terminate(): Promise<void> {
    this._initialized = false;
    detSession = null;
    recogSession = null;
    recogDict = [];
  }
}

export { }