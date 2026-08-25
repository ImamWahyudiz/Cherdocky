/**
 * Token sanitization for OCR output — pure functions, no engine dependencies.
 *
 * Precision-recovery layer for extraction-first pipelines: union-of-passes and
 * lenient confidence retention admit noise tokens that bag-matching counts as
 * false positives. Three surgical filters plus greedy conflicting-duplicate
 * suppression remove obvious garbage WITHOUT touching legitimate content:
 *
 *  1. Garbage-line filter   — extreme aspect ratios on non-alphanumeric text
 *  2. Isolated-token filter — lone single characters below 80 conf
 *  3. Junk regex            — punctuation-only residue
 *  4. Conflict suppression  — overlapping same-line boxes reading DIFFERENT
 *                             text keep only the most confident read
 */

export interface SanitizableToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  pageIndex?: number;
  /** ocrEngine flag: this word fell below the adaptive confidence floor. */
  lowConf?: boolean;
}

/**
 * Absolute floor for FLAGGED low-confidence tokens on generic documents.
 * Sub-35 reads at glyph scale are overwhelmingly segmentation debris; real
 * words read that badly are recovered by the ONNX provider path instead.
 * Never applies to unflagged tokens or card documents.
 */
const LOWCONF_HARD_FLOOR = 35;

/** Non-alphanumeric residue ("___", "---", ".."). */
const JUNK_TOKEN_RE = /^[^a-zA-Z0-9]+$|^[.,\-|_~`']{1,2}$/;

/** Validator patterns exported for rescue-eligibility checks and test asserts.
 *  NEVER use these as drop rules against free prose. */
export const GENERIC_PATTERNS = {
  STRICT_NUMERIC_SEQUENCE: /^[0-9]{4,20}$/,
  NUMERIC_CURRENCY_OR_DECIMAL: /^[0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{1,2})?$/,
  // DD/MM/YYYY · DD-MM-YY · YYYY-MM-DD (the draft regex rejected its own
  // documented ISO form via day-group backtracking)
  GENERIC_DATE:
    /^(?:(?:0?[1-9]|[12][0-9]|3[01])[/\-.](?:0?[1-9]|1[012])[/\-.](?:19|20)?\d{2}|(?:19|20)\d{2}[-/.](?:0?[1-9]|1[012])[-/.](?:0?[1-9]|[12][0-9]|3[01]))$/,
  ALPHANUMERIC_CODE: /^[A-Z0-9]{2,8}(?:[-/][A-Z0-9]{2,8})+$/i,
  JUNK_NOISE_TOKEN: JUNK_TOKEN_RE,
};

function overlapsSmaller(a: SanitizableToken, b: SanitizableToken, frac: number): boolean {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && inter / smaller >= frac;
}

function sameLine(a: SanitizableToken, b: SanitizableToken): boolean {
  const ca = a.y + a.height / 2;
  const cb = b.y + b.height / 2;
  return Math.abs(ca - cb) <= Math.max(a.height, b.height) * 0.7;
}

/**
 * Pass 1 filters. `neighbors` = all tokens (pre-filter) used for the
 * loneliness radius so a valid dense neighborhood protects its members.
 */
export function filterGarbage<T extends SanitizableToken>(tokens: T[]): T[] {
  const kept: T[] = [];
  for (const t of tokens) {
    const w = t.width;
    const h = t.height;
    if (h <= 0 || w <= 0) continue;

    // 1. Garbage line artifacts: extreme aspect ratio + no real content.
    if (JUNK_TOKEN_RE.test(t.text)) {
      if (w / h > 10 || h / w > 8) continue;
      // short pure-punctuation residue ("-", "..") drops regardless of shape
      if (/^[.,\-|_~`']{1,2}$/.test(t.text)) continue;
    }

    // 2. Lone single characters below 80 conf with no neighbor nearby.
    //    Ellipse biased horizontally (4h × 1.5h): measured that a pure radial
    //    2.5h radius killed legitimate trailing singles like the "7" in
    //    "jam 7?" whose word neighbor sits just outside a circle.
    if (
      t.text.length === 1 &&
      /[a-zA-Z0-9]/.test(t.text) &&
      (t.confidence ?? 100) < 80
    ) {
      const cx = t.x + t.width / 2;
      const cy = t.y + t.height / 2;
      const rx = t.height * 4;
      const ry = t.height * 1.5;
      const hasNeighbor = tokens.some((o) => {
        if (o === t) return false;
        const ox = o.x + o.width / 2;
        const oy = o.y + o.height / 2;
        const nx = (ox - cx) / rx;
        const ny = (oy - cy) / ry;
        return nx * nx + ny * ny <= 1;
      });
      if (!hasNeighbor) continue;
    }

    // 3. Hard floor for flagged tokens (see LOWCONF_HARD_FLOOR).
    if (t.lowConf === true && (t.confidence ?? 100) < LOWCONF_HARD_FLOOR) continue;

    kept.push(t);
  }
  return kept;
}

/**
 * Pass 2: fragment suppression — greedy LONGEST-FIRST. A read fully contained
 * inside an already-accepted longer overlapping same-line read is a partial
 * re-scan of the same glyphs (sparse-PSM debris) and drops. Direction is
 * asymmetric by design: a confident short fragment must never delete its own
 * fuller read, and equal-length rivals are NEVER suppressed (on degraded text
 * the higher-confidence read is often a confident misread — choosing between
 * them measurably deleted correct words: article@half −15pts).
 */
export function suppressConflicts<T extends SanitizableToken>(tokens: T[]): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sorted = [...tokens].sort((a, b) => b.text.length - a.text.length);
  const accepted: T[] = [];
  for (const t of sorted) {
    const tNorm = norm(t.text);
    const clash =
      tNorm.length >= 2 &&
      accepted.some((a) => {
        if ((a.pageIndex ?? 0) !== (t.pageIndex ?? 0)) return false;
        if (!sameLine(a, t) || !overlapsSmaller(a, t, 0.55)) return false;
        const aNorm = norm(a.text);
        // Ratio cap: a genuinely fuller read of the SAME glyphs is modestly
        // longer. Much-longer accepted reads are multi-word row
        // concatenations ("gulapasir1kg14500") whose "fragments" are the
        // individual real words — suppressing those deleted whole rows.
        if (aNorm.length > tNorm.length * 2 + 2) return false;
        return aNorm.length > tNorm.length && aNorm.includes(tNorm);
      });
    if (!clash) accepted.push(t);
  }
  return accepted;
}

/** Combined entry point: garbage filters, then conflict suppression. */
export function sanitizeTokens<T extends SanitizableToken>(tokens: T[]): T[] {
  return suppressConflicts(filterGarbage(tokens));
}
