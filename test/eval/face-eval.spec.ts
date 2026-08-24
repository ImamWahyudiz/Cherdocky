import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DIR = path.resolve(__dirname, '..');
const METRICS_OUT = path.resolve(__dirname, '../../test-results/face-metrics.json');

// Dense grids: expected counts come from the filenames (12 / 15 faces).
const GRID_IMAGES = [
  { name: '12-face-photo.jpg', expected: 12 },
  { name: '15-face-photo.jpg', expected: 15 },
  { name: '15-face-photo1.jpg', expected: 15 },
  { name: '15-face-photo2.jpg', expected: 15 },
];

// ID-style documents: exactly one portrait each.
const SINGLE_FACE_DOCS = [
  'INDONESIAN_IDCARD_034415.jpg',
  'IDn, DOB, no keyword address, DD.jpg',
  'content under keyword-Name, DoB, no keyword id.jpg',
  'content under keyword-surname, given name, number, date of birth.png',
  'NIK, Nama, Alamat dll, Tempat.jpeg',
];

// Real-world group photos WITHOUT ground truth. Informational only — a single
// TV series must never steer tuning decisions (overfit guard).
function listFriendTestImages(): string[] {
  const dir = path.join(TEST_DIR, 'Friends', 'Test');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|gif)$/i.test(f))
    .sort()
    .filter((_, i) => i % 2 === 0)
    .map((f) => path.join(dir, f));
}

// Labeled single-person crops used ONLY to synthesize collages / rotations
// where the ground truth is defined by construction.
function listFriendTrainImages(): string[] {
  const root = path.join(TEST_DIR, 'Friends', 'Train');
  if (!fs.existsSync(root)) return [];
  const all: string[] = [];
  for (const person of fs.readdirSync(root).sort()) {
    const dir = path.join(root, person);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (/\.(jpe?g|png)$/i.test(f)) all.push(path.join(dir, f));
    }
  }
  return all.filter((_, i) => i % 10 === 0);
}

function b64(file: string): string {
  return fs.readFileSync(file).toString('base64');
}

interface FaceMetrics {
  grids: { name: string; expected: number; detected: number; coverage: number }[];
  gridMeanCoverage: number;
  idDocs: { name: string; detected: number; hit: boolean; extra: number; boxes?: { x: number; y: number; w: number; h: number }[] }[];
  idDocRecall: number;
  idDocOverdetectRate: number;
  collages: { gtCount: number; matched: number; detections: number; meanIoU: number }[];
  collageRecall: number;
  collagePrecision: number;
  rotated: Record<string, { hits: number; total: number; recall: number }>;
  negatives: { images: number; detections: number; detail: { kind: string; detections: number; scores: number[] }[] };
  friends: { images: number; detections: number; imagesWithDetection: number };
}

test.describe('Face detection eval', () => {
  const friendTrain = listFriendTrainImages();
  const friendTest = listFriendTestImages();
  const haveAssets =
    GRID_IMAGES.every((g) => fs.existsSync(path.join(TEST_DIR, g.name))) && friendTrain.length >= 8;

  test.skip(!haveAssets, 'face eval assets not present');

  test('multi-scale detection quality across constructed slices', async ({ page }) => {
    console.log('FACE-EVAL-SPEC-MARKER-v2');
    test.setTimeout(900_000);

    await page.goto('/test/eval/runner.html');
    await page.waitForFunction(() => typeof (window as any).runFaces === 'function', null, {
      timeout: 120_000,
    });
    page.on('console', (msg) => {
      if (msg.text().includes('[facedbg]')) console.log(msg.text());
    });

    // Rotation sources: deterministic sample of labeled single-person crops.
    const rotSources = friendTrain.slice(0, 8);
    // Collage sources: next chunk.
    const collageSources = friendTrain.slice(8, 17);

    const files: Record<string, string> = {};
    for (const g of GRID_IMAGES) files[`grid:${g.name}`] = b64(path.join(TEST_DIR, g.name));
    for (const n of SINGLE_FACE_DOCS) files[`doc:${n}`] = b64(path.join(TEST_DIR, n));
    let i = 0;
    for (const f of rotSources) files[`rot:${i++}`] = b64(f);
    i = 0;
    for (const f of collageSources) files[`col:${i++}`] = b64(f);
    for (const f of friendTest) files[`friend:${path.basename(f)}`] = b64(f);

    const metrics: FaceMetrics & { debugLogs?: string[] } = await page.evaluate(async (payload) => {
      (window as any).__FACE_DEBUG = true;
      const __logs: string[] = [];
      const __orig = console.log.bind(console);
      console.log = (...a: unknown[]) => {
        const s = a.map(String).join(' ');
        if (s.includes('face')) __logs.push(s.slice(0, 140));
        __orig(...a);
      };
      (window as any).__logs = __logs;
      const runFaces = (window as any).runFaces as (s: File | HTMLCanvasElement | HTMLImageElement) => Promise<{ x: number; y: number; w: number; h: number }[]>;
      const toFile = async (b64str: string) =>
        new File([await (await fetch('data:image/jpeg;base64,' + b64str)).blob()], 'img.jpg');

      const imgs: Record<string, HTMLImageElement> = {};
      await Promise.all(
        Object.entries(payload.files).map(
          ([key, b64str]) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.onload = () => {
                imgs[key] = img;
                resolve();
              };
              img.onerror = () => resolve();
              img.src = 'data:image/jpeg;base64,' + b64str;
            }),
        ),
      );

      const out: FaceMetrics = {
        grids: [],
        gridMeanCoverage: 0,
        idDocs: [],
        idDocRecall: 0,
        idDocOverdetectRate: 0,
        collages: [],
        collageRecall: 0,
        collagePrecision: 0,
        rotated: {},
        negatives: { images: 0, detections: 0, detail: [] },
        friends: { images: 0, detections: 0, imagesWithDetection: 0 },
      };

      // --- Slice 1: dense grids ---
      for (const g of payload.grids) {
        const img = imgs['grid:' + g.name];
        if (!img) continue;
        const dets = await runFaces(img);
        out.grids.push({
          name: g.name,
          expected: g.expected,
          detected: dets.length,
          coverage: Math.min(1, dets.length / g.expected),
        });
      }
      out.gridMeanCoverage =
        out.grids.reduce((s, g) => s + g.coverage, 0) / Math.max(1, out.grids.length);

      // --- Slice 2: ID documents (exactly one portrait) ---
      let docHits = 0;
      let docExtra = 0;
      for (const name of payload.singleDocs) {
        const img = imgs['doc:' + name];
        if (!img) continue;
        const dets = await runFaces(img);
        const hit = dets.length >= 1;
        if (hit) docHits++;
        if (dets.length > 1) docExtra++;
        out.idDocs.push({
          name,
          detected: dets.length,
          hit,
          extra: Math.max(0, dets.length - 1),
          boxes: dets.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w), h: Math.round(d.h), score: Number(((d as any).score ?? 0).toFixed(3)) })),
        });
      }
      out.idDocRecall = docHits / Math.max(1, out.idDocs.length);
      out.idDocOverdetectRate = docExtra / Math.max(1, out.idDocs.length);

      // --- Slice 3: synthetic collages (paste boxes are ground truth) ---
      function makeCollage(sources: HTMLImageElement[], cols: number, rows: number) {
        const cell = 160;
        const cv = document.createElement('canvas');
        cv.width = cols * cell;
        cv.height = rows * cell;
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#f5f5f4';
        ctx.fillRect(0, 0, cv.width, cv.height);
        const boxes: { x: number; y: number; w: number; h: number }[] = [];
        let k = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const src = sources[k % sources.length];
            k++;
            const size = Math.min(src.naturalWidth, src.naturalHeight);
            const sx = (src.naturalWidth - size) / 2;
            const sy = (src.naturalHeight - size) / 2;
            const inset = cell * 0.05;
            const drawSize = cell - inset * 2;
            ctx.drawImage(src, sx, sy, size, size, c * cell + inset, r * cell + inset, drawSize, drawSize);
            boxes.push({ x: c * cell + inset, y: r * cell + inset, w: drawSize, h: drawSize });
          }
        }
        return { canvas: cv, boxes };
      }

      function matchBoxes(
        dets: { x: number; y: number; w: number; h: number }[],
        gt: { x: number; y: number; w: number; h: number }[],
      ) {
        // Center-in-cell counting: a pasted crop contains the person somewhere
        // inside it, so the tight face box will NOT reach high IoU against the
        // whole crop rect. A detection belongs to a cell when its center does;
        // IoU > 0.25 stays as a fallback for oversized/shifted boxes.
        const usedGt = new Set<number>();
        let matched = 0;
        let iouSum = 0;
        for (const d of dets) {
          const cx = d.x + d.w / 2;
          const cy = d.y + d.h / 2;
          let bestScore = 0;
          let bestIdx = -1;
          let bestIou = 0;
          gt.forEach((g, gi) => {
            if (usedGt.has(gi)) return;
            const inside = cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h;
            const xA = Math.max(d.x, g.x);
            const yA = Math.max(d.y, g.y);
            const xB = Math.min(d.x + d.w, g.x + g.w);
            const yB = Math.min(d.y + d.h, g.y + g.h);
            const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
            const union = d.w * d.h + g.w * g.h - inter;
            const iou = union > 0 ? inter / union : 0;
            const score = inside ? 1 + iou : iou;
            if (score > bestScore) {
              bestScore = score;
              bestIdx = gi;
              bestIou = iou;
            }
          });
          if (bestIdx >= 0 && bestScore > 0.25) {
            usedGt.add(bestIdx);
            matched++;
            iouSum += bestIou;
          }
        }
        return { matched, iouSum };
      }

      const colImgs = payload.collageKeys.map((k: string) => imgs[k]).filter(Boolean);
      const layouts = [
        { cols: 3, rows: 2 },
        { cols: 2, colsAlt: 2, rows: 2 },
        { cols: 3, rows: 3 },
      ] as any;
      let colGt = 0;
      let colMatched = 0;
      let colDet = 0;
      let colIouSum = 0;
      for (const layout of [layouts[0], layouts[2]]) {
        const { canvas, boxes } = makeCollage(colImgs, layout.cols, layout.rows);
        const dets = await runFaces(canvas);
        const { matched, iouSum } = matchBoxes(dets, boxes);
        colGt += boxes.length;
        colMatched += matched;
        colDet += dets.length;
        colIouSum += iouSum;
      }
      out.collages.push({ gtCount: colGt, matched: colMatched, detections: colDet, meanIoU: colMatched ? colIouSum / colMatched : 0 });
      out.collageRecall = colMatched / Math.max(1, colGt);
      out.collagePrecision = colMatched / Math.max(1, colDet);

      // --- Slice 4: rotations ---
      for (const angle of [-30, -15, 15, 30]) {
        const key = String(angle);
        out.rotated[key] = { hits: 0, total: 0, recall: 0 };
        for (let s = 0; s < payload.rotCount; s++) {
          const src = imgs[`rot:${s}`];
          if (!src) continue;
          const diag = Math.ceil(Math.hypot(src.naturalWidth, src.naturalHeight));
          const cv = document.createElement('canvas');
          cv.width = diag;
          cv.height = diag;
          const ctx = cv.getContext('2d')!;
          ctx.fillStyle = '#d4d4d8';
          ctx.fillRect(0, 0, diag, diag);
          ctx.translate(diag / 2, diag / 2);
          ctx.rotate((angle * Math.PI) / 180);
          ctx.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);
          const dets = await runFaces(cv);
          out.rotated[key].total++;
          if (dets.length >= 1) out.rotated[key].hits++;
        }
        out.rotated[key].recall = out.rotated[key].hits / Math.max(1, out.rotated[key].total);
      }

      // --- Slice 5: face-free negatives (text documents + textured fields) ---
      function makeTextDoc(): HTMLCanvasElement {
        const cv = document.createElement('canvas');
        cv.width = 900;
        cv.height = 1200;
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#111827';
        ctx.font = '16px sans-serif';
        const words = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore'.split(' ');
        for (let line = 0; line < 60; line++) {
          let x = 40;
          const y = 40 + line * 19;
          for (let w = 0; w < 9; w++) {
            const t = words[(line * 9 + w) % words.length];
            ctx.fillText(t, x, y);
            x += ctx.measureText(t).width + 6;
          }
        }
        return cv;
      }

      function makeTexture(seed: number): HTMLCanvasElement {
        const cv = document.createElement('canvas');
        cv.width = 800;
        cv.height = 800;
        const ctx = cv.getContext('2d')!;
        let s = seed;
        const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 0, cv.width, cv.height);
        const palette = ['#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#a855f7'];
        for (let n = 0; n < 220; n++) {
          ctx.beginPath();
          ctx.fillStyle = palette[Math.floor(rnd() * palette.length)];
          ctx.globalAlpha = 0.55;
          ctx.ellipse(rnd() * 800, rnd() * 800, 8 + rnd() * 60, 8 + rnd() * 60, rnd() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        return cv;
      }

      const negDets: { kind: string; detections: number; scores: number[] }[] = [];
      for (let n = 0; n < 3; n++) {
        const d = await runFaces(makeTextDoc());
        negDets.push({ kind: 'textdoc', detections: d.length, scores: d.map((x) => Number(((x as any).score ?? 0).toFixed(3))) });
      }
      for (let n = 1; n <= 5; n++) {
        const d = await runFaces(makeTexture(n));
        negDets.push({ kind: 'texture' + n, detections: d.length, scores: d.map((x) => Number(((x as any).score ?? 0).toFixed(3))) });
      }
      out.negatives.images = negDets.length;
      out.negatives.detections = negDets.reduce((a, b) => a + b.detections, 0);
      out.negatives.detail = negDets;

      // --- Slice 6: real group photos (informational, no GT) ---
      for (const key of Object.keys(imgs)) {
        if (!key.startsWith('friend:')) continue;
        const dets = await runFaces(imgs[key]);
        out.friends.images++;
        out.friends.detections += dets.length;
        if (dets.length > 0) out.friends.imagesWithDetection++;
      }

      const counts: Record<string, number> = {};
      for (const l of __logs) {
        const tag = l.slice(1, 10);
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
      (out as any).debugLogs = { counts, nonDbg: __logs.filter((l) => !l.includes('facedbg')).slice(0, 15) };
      return out;
    }, { files, grids: GRID_IMAGES, singleDocs: SINGLE_FACE_DOCS, rotCount: rotSources.length, collageKeys: collageSources.map((_, idx) => `col:${idx}`) });

    console.log('\n=== Face detection metrics ===');
    const dbg = (metrics as any).debugLogs ?? { counts: {}, nonDbg: [] };
    console.log('LOGCOUNTS:', JSON.stringify(dbg.counts));
    for (const l of dbg.nonDbg) console.log('PAGELOG:', l);
    for (const g of metrics.grids) {
      console.log(`  [grid] ${g.name.padEnd(28)} ${g.detected}/${g.expected}  coverage=${(g.coverage * 100).toFixed(0)}%`);
    }
    console.log(`  gridMeanCoverage=${(metrics.gridMeanCoverage * 100).toFixed(1)}%`);
    for (const d of metrics.idDocs) {
      console.log(`  [idoc] ${d.name.padEnd(50)} det=${d.detected} hit=${d.hit}`);
    }
    console.log(`  idDocRecall=${(metrics.idDocRecall * 100).toFixed(0)}%  idDocOverdetect=${(metrics.idDocOverdetectRate * 100).toFixed(0)}%`);
    console.log(`  collageRecall=${(metrics.collageRecall * 100).toFixed(1)}%  collagePrecision=${(metrics.collagePrecision * 100).toFixed(1)}%  meanIoU=${metrics.collages[0]?.meanIoU?.toFixed(2)}`);
    for (const [angle, r] of Object.entries(metrics.rotated)) {
      console.log(`  [rot ${String(angle).padStart(3)}deg] recall=${(r.recall * 100).toFixed(0)}% (${r.hits}/${r.total})`);
    }
    console.log(`  negatives: ${metrics.negatives.detections} false positives over ${metrics.negatives.images} images`);
    console.log(`  friends(real, informational): ${metrics.friends.detections} dets over ${metrics.friends.images} imgs, detRate=${((metrics.friends.imagesWithDetection / Math.max(1, metrics.friends.images)) * 100).toFixed(0)}%`);

    fs.mkdirSync(path.dirname(METRICS_OUT), { recursive: true });
    fs.writeFileSync(METRICS_OUT, JSON.stringify(metrics, null, 2));

    expect(metrics.grids.length).toBeGreaterThan(0);
    expect(metrics.negatives.images).toBeGreaterThan(0);
  });
});
