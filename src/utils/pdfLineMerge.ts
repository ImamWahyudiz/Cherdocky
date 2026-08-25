// Pure geometry helpers shared by pdfExtractor. Kept free of pdfjs imports so
// unit tests can exercise line reconstruction without a DOM or WASM worker.

export interface RawTextItem {
  str: string;
  x: number;
  baselineY: number;
  width: number;
  fontHeight: number;
}

export interface MergedLine {
  str: string;
  x: number;
  baselineY: number;
  width: number;
  fontHeight: number;
}

/**
 * Groups raw text items into visual lines and merges adjacent fragments.
 * Fragments whose gap is below ~0.2× the font height are kerning artifacts
 * and are concatenated directly; larger gaps become explicit spaces.
 */
export function mergePdfItemsIntoLines(items: RawTextItem[]): MergedLine[] {
  const usable = items.filter((it) => it.str && it.str.trim().length > 0);
  if (usable.length === 0) return [];

  const sorted = [...usable].sort((a, b) => a.baselineY - b.baselineY || a.x - b.x);

  let lineItems: RawTextItem[] = [];
  let lineBaseY = sorted[0].baselineY;
  let lineTol = Math.max(3, sorted[0].fontHeight * 0.35);
  const lines: MergedLine[] = [];

  const flush = () => {
    if (lineItems.length === 0) return;
    lineItems.sort((a, b) => a.x - b.x);
    const first = lineItems[0];
    const merged: MergedLine = {
      str: first.str,
      x: first.x,
      baselineY: first.baselineY,
      width: first.width,
      fontHeight: first.fontHeight,
    };
    for (let i = 1; i < lineItems.length; i++) {
      const cur = lineItems[i];
      const gap = cur.x - (merged.x + merged.width);
      const joiner = gap > 0.2 * merged.fontHeight ? ' ' : '';
      merged.str += joiner + cur.str;
      merged.width = Math.max(merged.width, cur.x + cur.width - merged.x);
      merged.fontHeight = Math.max(merged.fontHeight, cur.fontHeight);
    }
    lines.push(merged);
    lineItems = [];
  };

  for (const it of sorted) {
    if (lineItems.length > 0 && Math.abs(it.baselineY - lineBaseY) > lineTol) {
      flush();
    }
    if (lineItems.length === 0) {
      lineBaseY = it.baselineY;
      lineTol = Math.max(3, it.fontHeight * 0.35);
    }
    lineItems.push(it);
  }
  flush();

  return lines;
}
