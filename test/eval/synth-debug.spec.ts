import { test } from '@playwright/test';
import { SYNTH_DOCS, type SynthDoc } from './synthDocs';

/**
 * Stage-attribution diagnostic: for the worst synthetic docs, compare
 *   raw   = Tesseract directly on the screenshot (no preprocess, no filter)
 *   final = full app pipeline output
 * and classify each missing transcript token as:
 *   raw-loss    — even raw OCR missed it (engine limitation)
 *   pipe-loss   — raw had it but the pipeline dropped/changed it (our fault)
 *
 * Uses only the stable dev hooks (runEval / runRaw) exposed by runner.ts.
 */

function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bag(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of text.split(/\s+/)) {
    const n = normToken(t);
    if (n) m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

const FOCUS = ['chat_light', 'chat_dark', 'receipt', 'social_post'];

test('attribute extraction loss: raw vs pipeline', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/test/eval/runner.html');
  await page.waitForFunction(
    () =>
      typeof (window as any).runEval === 'function' &&
      typeof (window as any).runRaw === 'function',
    null,
    { timeout: 120_000 }
  );

  for (const doc of SYNTH_DOCS.filter((d) => FOCUS.includes(d.name)) as SynthDoc[]) {
    await page.setContent(doc.html);
    const buf = await page.locator('#doc').screenshot({ type: 'png' });
    const b64 = buf.toString('base64');
    const name = doc.name;

    const [fin, raw] = await Promise.all([
      page.evaluate(async ({ b64, name }) => {
        const blob = await (await fetch('data:application/octet-stream;base64,' + b64)).blob();
        return (window as any).runEval(new File([blob], name + '.png'));
      }, { b64, name }),
      page.evaluate(async ({ b64, name }) => {
        const blob = await (await fetch('data:application/octet-stream;base64,' + b64)).blob();
        return (window as any).runRaw(new File([blob], name + '.png'));
      }, { b64, name }),
    ]);

    const exp = bag(doc.transcript);
    const finBag = bag(fin.text ?? '');
    const rawBag = bag(raw.text ?? '');

    let rawLoss = 0;
    let pipeLoss = 0;
    const rawMisses: string[] = [];
    const pipeMisses: { tok: string; conf: number }[] = [];
    const rawConf = new Map<string, number>();
    for (const w of raw.words ?? []) {
      const n = normToken(w.text ?? '');
      if (!n) continue;
      if (!rawConf.has(n) || (rawConf.get(n) ?? 0) < w.confidence) rawConf.set(n, w.confidence);
    }
    for (const [tok, n] of exp) {
      const inRaw = (rawBag.get(tok) ?? 0) >= n;
      const inFin = (finBag.get(tok) ?? 0) >= n;
      if (inRaw && !inFin) {
        pipeLoss += n;
        pipeMisses.push({ tok, conf: Math.round(rawConf.get(tok) ?? -1) });
      } else if (!inRaw) {
        rawLoss += n;
        rawMisses.push(tok);
      }
    }

    console.log(`\n[${name}] expected=${exp.size} final=${finBag.size} raw=${rawBag.size}`);
    console.log(`  raw-loss=${rawLoss}  pipe-loss=${pipeLoss}`);
    console.log(`  raw-missing tokens: ${rawMisses.slice(0, 18).join(', ') || '(none)'}`);
    console.log(
      `  pipe-dropped (token@conf): ${pipeMisses.slice(0, 14).map((p) => `${p.tok}@${p.conf}`).join(', ') || '(none)'}`
    );
  }
});
