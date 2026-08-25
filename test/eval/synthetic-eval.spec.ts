import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYNTH_DOCS, DEGRADE_TWINS, type DegradeMode, type SynthDoc } from './synthDocs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_OUT = path.resolve(__dirname, '../../test-results/synthetic-metrics.json');

/**
 * Synthetic document benchmark for GENERIC text extraction quality.
 *
 * Renders realistic UI-style documents as screenshots, optionally applies a
 * degradation (50% downscale / JPEG q70 / blur) to mimic real-world inputs,
 * then runs the real app OCR pipeline end-to-end.
 *
 * Scoring is position-aware: detected words are grouped into lines by their
 * y-coordinates and matched against ground-truth transcript tokens. Beyond
 * strict bag recall we measure FRAGMENTATION (a GT word arriving split across
 * several detected fragments), MERGING (two GT words read as one token), and
 * PARTIAL reads (a prefix of the word — "kenanga" for "kenangan").
 */

// --- Normalization -----------------------------------------------------------

/** Lowercase alphanumerics only — tolerant to punctuation differences. */
function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface Tok {
  t: string; // normalized
  line: number;
}

function gtTokens(transcript: string): Tok[] {
  const out: Tok[] = [];
  transcript.split(/\n/).forEach((lineText, li) => {
    for (const raw of lineText.split(/\s+/)) {
      const t = normToken(raw);
      if (t) out.push({ t, line: li });
    }
  });
  return out;
}

/** Group detected words into visual lines by vertical center proximity.
 *  Returns arrays of tokens annotated with their line ordinal. */
function detLines(
  words: { text: string; x: number; y: number; width: number; height: number }[]
): Tok[][] {
  const sorted = [...words]
    .map((w) => ({ ...w, cy: w.y + w.height / 2 }))
    .sort((a, b) => a.cy - b.cy);
  const lines: { toks: Tok[]; cy: number; h: number }[] = [];
  for (const w of sorted) {
    const t = normToken(w.text);
    if (!t) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.cy - last.cy) <= Math.max(last.h, w.height) * 0.7) {
      last.toks.push({ t, line: lines.length - 1 });
      last.cy = (last.cy * (last.toks.length - 1) + w.cy) / last.toks.length;
      last.h = Math.max(last.h, w.height);
    } else {
      lines.push({ toks: [{ t, line: lines.length }], cy: w.cy, h: w.height });
    }
  }
  return lines.map((l) => l.toks);
}

// --- Digit runs --------------------------------------------------------------

function digitRuns(text: string): Map<string, number> {
  const runs = new Map<string, number>();
  for (const r of text.match(/\d{2,}/g) ?? []) {
    runs.set(r, (runs.get(r) ?? 0) + 1);
  }
  return runs;
}

function multisetRecall(expected: Map<string, number>, detected: Map<string, number>): number {
  let hit = 0;
  let total = 0;
  for (const [k, n] of expected) {
    total += n;
    hit += Math.min(n, detected.get(k) ?? 0);
  }
  return total === 0 ? 1 : hit / total;
}

// --- Position-aware matching ---------------------------------------------------

export interface MatchResult {
  gtTotal: number;
  detTotal: number;
  exactHits: number;
  splitHits: number; // GT words recovered by concatenating adjacent fragments
  mergeHitTokens: number; // GT words recovered inside a merged detection
  partials: number; // informational: prefix reads ("kenanga" for "kenangan")
  splits: number; // count of fragmentation events
  merges: number; // count of merge events
}

/** Consecutive unconsumed detections on one line whose concatenation equals target. */
function findSplitWindow(
  lineIds: number[],
  det: Tok[],
  consumed: boolean[],
  target: string
): number[] | null {
  for (let s = 0; s + 1 < lineIds.length; s++) {
    for (let len = 2; len <= 4 && s + len <= lineIds.length; len++) {
      const win = lineIds.slice(s, s + len);
      if (win.some((i) => consumed[i])) continue;
      let concat = '';
      for (const i of win) concat += det[i].t;
      if (concat === target) return win;
    }
  }
  return null;
}

/** Consecutive unconsumed GT tokens on one line whose concatenation equals target. */
function findMergeWindow(
  lineGtIds: number[],
  gt: Tok[],
  gConsumed: boolean[],
  target: string
): number[] | null {
  for (let s = 0; s + 1 < lineGtIds.length; s++) {
    for (let len = 2; len <= 3 && s + len <= lineGtIds.length; len++) {
      const win = lineGtIds.slice(s, s + len);
      if (win.some((i) => gConsumed[i])) continue;
      let concat = '';
      for (const i of win) concat += gt[i].t;
      if (concat === target) return win;
    }
  }
  return null;
}

export function matchPositionAware(gt: Tok[], lines: Tok[][]): MatchResult {
  // Flatten detections, keeping per-line index views into the flat array.
  const det: Tok[] = [];
  const lineIds: number[][] = lines.map((toks) =>
    toks.map((t) => {
      det.push(t);
      return det.length - 1;
    })
  );
  const dConsumed = new Array(det.length).fill(false);
  const gConsumed = new Array(gt.length).fill(false);

  // Pass 0: exact match, preferring same-line identity.
  const byText = new Map<string, number[]>();
  gt.forEach((g, i) => {
    if (!byText.has(g.t)) byText.set(g.t, []);
    byText.get(g.t)!.push(i);
  });
  let exactHits = 0;
  for (let di = 0; di < det.length; di++) {
    const cands = byText.get(det[di].t);
    if (!cands) continue;
    const pick =
      cands.find((gi) => !gConsumed[gi] && gt[gi].line === det[di].line) ??
      cands.find((gi) => !gConsumed[gi]);
    if (pick === undefined) continue;
    gConsumed[pick] = true;
    dConsumed[di] = true;
    exactHits++;
  }

  // Pass 1: splits — one GT word spread over consecutive fragments on a line.
  let splitHits = 0;
  let splits = 0;
  for (let gi = 0; gi < gt.length; gi++) {
    if (gConsumed[gi]) continue;
    const target = gt[gi].t;
    if (target.length < 3) continue;
    for (const ids of lineIds) {
      const win = findSplitWindow(ids, det, dConsumed, target);
      if (win) {
        win.forEach((i) => (dConsumed[i] = true));
        splitHits++;
        splits++;
        gConsumed[gi] = true;
        break;
      }
    }
  }

  // Pass 2: merges — two/three consecutive GT words read as one token.
  let merges = 0;
  let mergeHitTokens = 0;
  const gtLineIdx = new Map<number, number[]>();
  gt.forEach((g, i) => {
    if (!gtLineIdx.has(g.line)) gtLineIdx.set(g.line, []);
    gtLineIdx.get(g.line)!.push(i);
  });
  for (let di = 0; di < det.length; di++) {
    if (dConsumed[di]) continue;
    const d = det[di];
    if (d.t.length < 5) continue;
    for (const [, idxs] of gtLineIdx) {
      const win = findMergeWindow(idxs, gt, gConsumed, d.t);
      if (win) {
        win.forEach((gi) => (gConsumed[gi] = true));
        dConsumed[di] = true;
        merges++;
        mergeHitTokens += win.length;
        break;
      }
    }
  }

  // Pass 3: partial reads (informational only, no recall credit).
  let partials = 0;
  for (let gi = 0; gi < gt.length; gi++) {
    if (gConsumed[gi] || gt[gi].t.length < 5) continue;
    if (
      det.some((d, di) => !dConsumed[di] && d.t.length >= 4 && gt[gi].t.startsWith(d.t))
    ) {
      partials++;
    }
  }

  return {
    gtTotal: gt.length,
    detTotal: det.length,
    exactHits,
    splitHits,
    mergeHitTokens,
    partials,
    splits,
    merges,
  };
}

// --- Degradation helpers (run in-browser on the rasterized PNG) ---------------

async function degradeToB64(
  page: import('@playwright/test').Page,
  pngB64: string,
  mode: DegradeMode
): Promise<{ b64: string; ext: string }> {
  if (mode !== 'half' && mode !== 'jpeg') return { b64: pngB64, ext: 'png' };
  return await page.evaluate(async ({ b64, mode }) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    const f = mode === 'half' ? 0.5 : 1;
    c.width = Math.max(1, Math.round(img.width * f));
    c.height = Math.max(1, Math.round(img.height * f));
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob: Blob =
      mode === 'jpeg'
        ? await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.7))
        : await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return { b64: btoa(s), ext: mode === 'jpeg' ? 'jpg' : 'png' };
  }, { b64: pngB64, mode });
}

// --- Instances -----------------------------------------------------------------

interface Instance {
  name: string;
  doc: SynthDoc;
  mode?: DegradeMode;
}

function buildInstances(): Instance[] {
  const list: Instance[] = SYNTH_DOCS.map((doc) => ({ name: doc.name, doc }));
  for (const twin of DEGRADE_TWINS) {
    const doc = SYNTH_DOCS.find((d) => d.name === twin.docName);
    if (doc) list.push({ name: `${doc.name}@${twin.mode}`, doc, mode: twin.mode });
  }
  return list;
}

// --- Test ----------------------------------------------------------------------

test.describe('Synthetic document extraction eval', () => {
  test('scores word/digit recall across rendered UI documents', async ({ page }) => {
    test.setTimeout(900_000); // 12 instances x up to ~60s OCR
    await page.goto('/test/eval/runner.html');
    await page.waitForFunction(() => typeof (window as any).runEval === 'function', null, {
      timeout: 120_000,
    });

    interface DocScore {
      degrade?: DegradeMode;
      wordRecall: number;
      repairedRecall: number;
      wordPrecision: number;
      digitRecall: number;
      splits: number;
      merges: number;
      partials: number;
      gtWords: number;
      detectedWords: number;
    }

    const results: Record<string, DocScore> = {};
    const shotDir = path.resolve(__dirname, '../../test-results/synthetic');
    fs.mkdirSync(shotDir, { recursive: true });

    for (const inst of buildInstances()) {
      await page.setContent(inst.doc.html);
      if (inst.mode === 'blur') {
        await page.evaluate(() => {
          (document.getElementById('doc') as HTMLElement).style.filter = 'blur(0.6px)';
        });
      }
      const el = page.locator('#doc');
      const buf = await el.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(shotDir, inst.name.replace('@', '_') + '.png'), buf);

      const degraded =
        inst.mode === 'half' || inst.mode === 'jpeg'
          ? await degradeToB64(page, buf.toString('base64'), inst.mode)
          : { b64: buf.toString('base64'), ext: 'png' };

      const result = await page.evaluate(
        async ({ b64, name }: { b64: string; name: string }) => {
          const res = await fetch('data:application/octet-stream;base64,' + b64);
          const blob = await res.blob();
          const file = new File([blob], name);
          return await (window as any).runEval(file);
        },
        { b64: degraded.b64, name: inst.name }
      );

      const detectedText: string = result.text ?? '';
      const gt = gtTokens(inst.doc.transcript);
      const m = matchPositionAware(gt, detLines(result.words ?? []));

      const wordRecall = m.gtTotal ? m.exactHits / m.gtTotal : 1;
      const repairedRecall = m.gtTotal
        ? (m.exactHits + m.splitHits + m.mergeHitTokens) / m.gtTotal
        : 1;
      const matchedDets = m.exactHits + m.splits + m.merges;
      const wordPrecision = m.detTotal ? Math.min(1, matchedDets / m.detTotal) : 1;
      const digitRecall = multisetRecall(
        digitRuns(inst.doc.transcript),
        digitRuns(detectedText)
      );

      results[inst.name] = {
        degrade: inst.mode,
        wordRecall,
        repairedRecall,
        wordPrecision,
        digitRecall,
        splits: m.splits,
        merges: m.merges,
        partials: m.partials,
        gtWords: m.gtTotal,
        detectedWords: m.detTotal,
      };

      console.log(
        `[${inst.name}] strict=${(wordRecall * 100).toFixed(1)}% repaired=${(repairedRecall * 100).toFixed(1)}% prec=${(wordPrecision * 100).toFixed(1)}% digits=${(digitRecall * 100).toFixed(1)}% splits=${m.splits} merges=${m.merges} partial=${m.partials}`
      );
    }

    const names = Object.keys(results);
    const agg = {
      wordRecall: names.reduce((s, n) => s + results[n].wordRecall, 0) / names.length,
      wordPrecision: names.reduce((s, n) => s + results[n].wordPrecision, 0) / names.length,
      digitRecall: names.reduce((s, n) => s + results[n].digitRecall, 0) / names.length,
      repairedRecall: names.reduce((s, n) => s + results[n].repairedRecall, 0) / names.length,
      fragRate:
        names.reduce((s, n) => s + results[n].splits, 0) /
        Math.max(1, names.reduce((s, n) => s + results[n].gtWords, 0)),
    };
    console.log(
      `\n=== Synthetic extraction metrics ===\n` +
        `  wordRecall=${(agg.wordRecall * 100).toFixed(1)}%  repaired=${(agg.repairedRecall * 100).toFixed(1)}%  precision=${(agg.wordPrecision * 100).toFixed(1)}%\n` +
        `  digitRecall=${(agg.digitRecall * 100).toFixed(1)}%  fragRate=${(agg.fragRate * 100).toFixed(1)}%`
    );

    fs.mkdirSync(path.dirname(METRICS_OUT), { recursive: true });
    fs.writeFileSync(
      METRICS_OUT,
      JSON.stringify({ images: names.length, docs: results, aggregate: agg }, null, 2)
    );

    expect(names.length).toBeGreaterThan(0);
    expect(agg.wordRecall).toBeGreaterThan(0);
  });
});
