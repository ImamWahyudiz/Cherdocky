// Pure geometry helpers shared by pdfExtractor. Kept free of pdfjs imports so
// unit tests can exercise line reconstruction without a DOM or WASM worker.

export interface RawTextItem {
  str: string;
  x: number;
  baselineY: number;
  width: number;
  fontHeight: number;
}

/**
 * A contiguous word-level segment built from one or more adjacent PDF.js glyph
 * run fragments. `x` and `width` come directly from PDF.js geometry — no font
 * fallback measurement is needed when splitting the line into word tokens.
 */
export interface LineSegment {
  str: string;
  /** Left edge in viewport pixels — exact from PDF.js item transform. */
  x: number;
  /** Pixel width derived from PDF.js item.width — not canvas-measured. */
  width: number;
}

export interface MergedLine {
  str: string;
  x: number;
  baselineY: number;
  width: number;
  fontHeight: number;
  /**
   * Word-level segments preserving PDF.js item boundaries.
   * Use these for per-word bbox calculation so widths come from the PDF's own
   * glyph metrics instead of browser Arial/Helvetica canvas measurement,
   * eliminating the cumulative horizontal drift in native-PDF mode.
   */
  segments: LineSegment[];
}

/**
 * Groups raw text items into visual lines and merges adjacent fragments.
 *
 * Merging strategy:
 *  - Items on the same baseline (within ±0.35× fontHeight) belong to the same
 *    visual line.
 *  - Within a line, items whose gap is < 0.2× fontHeight are kerning/ligature
 *    fragments of the SAME word and are fused into one segment (no space).
 *  - Items with a larger gap start a new segment (one space is inserted in the
 *    merged `str` for readability, matching existing behaviour).
 *
 * The resulting `segments` array lets callers recover exact per-word x/width
 * values without re-measuring the string in a browser canvas.
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

    // Build segments: contiguous items with small gaps are the same visual word.
    const segments: LineSegment[] = [];
    let seg: LineSegment = { str: lineItems[0].str, x: lineItems[0].x, width: lineItems[0].width };
    const fragThreshold = Math.max(3, lineItems[0].fontHeight * 0.2);

    for (let i = 1; i < lineItems.length; i++) {
      const cur = lineItems[i];
      const gap = cur.x - (seg.x + seg.width);
      if (gap < fragThreshold) {
        // Fragment of the same word: extend segment, widen to cover cur
        seg.str += cur.str;
        seg.width = Math.max(seg.width, cur.x + cur.width - seg.x);
      } else {
        // Word boundary: commit current segment, start new one
        segments.push(seg);
        seg = { str: cur.str, x: cur.x, width: cur.width };
      }
    }
    segments.push(seg);

    // Build the merged line, joining segments with a single space
    const first = segments[0];
    const last = segments[segments.length - 1];
    const merged: MergedLine = {
      str: segments.map((s) => s.str).join(' '),
      x: first.x,
      baselineY: lineItems[0].baselineY,
      width: last.x + last.width - first.x,
      fontHeight: Math.max(...lineItems.map((it) => it.fontHeight)),
      segments,
    };
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
