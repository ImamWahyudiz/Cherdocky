/**
 * Token repair for OCR output — pure functions, no engine dependencies.
 *
 * Extraction-first policy: Tesseract misreads are corrected AFTER recognition
 * using majority-rule character statistics inside each token, and numeric
 * fragments split across a glyph boundary are stitched back together.
 * Every mutation is flagged so downstream stages (classification, redaction
 * highlight alignment) can distinguish repaired text from verbatim reads.
 */

export interface RepairMeta {
  /** How this token's text was mutated (absent = verbatim read). */
  repaired?: 'numeric' | 'alpha' | 'stitched';
  /** Original text before repair/stitching ('|'-joined for stitches). */
  repairedFrom?: string;
}

/** Spatial contract satisfied by ocrEngine.SpatialWord and pdf tokens alike. */
export interface RepairableToken {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Confusion dictionaries
// ---------------------------------------------------------------------------

/** Alpha → digit mapping for characters visually confusable with digits. */
export const OCR_CHAR_CONFUSIONS: Record<string, string> = {
  O: '0', o: '0', D: '0', Q: '0',
  I: '1', l: '1', '|': '1', '!': '1', i: '1',
  Z: '2', z: '2',
  E: '3',
  A: '4',
  S: '5', s: '5',
  G: '6', b: '6',
  B: '8',
  g: '9', q: '9',
};

/** Digit → alpha reverse mapping used by majority-alpha repair. */
export const DIGIT_TO_ALPHA: Record<string, { upper: string; lower: string }> = {
  '0': { upper: 'O', lower: 'o' },
  '1': { upper: 'I', lower: 'l' },
  '2': { upper: 'Z', lower: 'z' },
  '3': { upper: 'E', lower: 'e' },
  '4': { upper: 'A', lower: 'a' },
  '5': { upper: 'S', lower: 's' },
  '6': { upper: 'G', lower: 'g' },
  '8': { upper: 'B', lower: 'b' },
  '9': { upper: 'Q', lower: 'q' },
};

/** A fragment is numerically viable if it's digits/punctuation or digits
 *  mixed with lookalike misreads ("O02" is a broken "002"). */
function isNumericFragment(text: string): boolean {
  let hasDigit = false;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') hasDigit = true;
    else if (!(ch === '.' || ch === ',' || ch === ':' || ch === '-' || ch === '/' || ch in OCR_CHAR_CONFUSIONS)) return false;
  }
  return hasDigit;
}

// ---------------------------------------------------------------------------
// Majority-rule repairs (token-local, no dictionary)
// ---------------------------------------------------------------------------

export interface RepairResult {
  text: string;
  kind: 'numeric' | 'alpha';
}

/**
 * Majority numeric repair: token is ≥75% pure digits and every remaining
 * character is a known lookalike ("198O02" → "198002"). Tokens containing
 * separators that aren't lookalikes ("12.345") are left untouched.
 */
export function repairMajorityNumeric(text: string): RepairResult | null {
  if (text.length < 4) return null;
  let digits = 0;
  const chars = [...text];
  for (const ch of chars) {
    if (ch >= '0' && ch <= '9') digits++;
    else if (!(ch in OCR_CHAR_CONFUSIONS)) return null;
  }
  if (digits / chars.length < 0.75) return null;
  let out = '';
  for (const ch of chars) out += ch in OCR_CHAR_CONFUSIONS ? OCR_CHAR_CONFUSIONS[ch] : ch;
  if (out === text) return null;
  return { text: out, kind: 'numeric' };
}

/**
 * Majority alpha repair: alnum-only token dominated by letters with digit
 * substitutions restored to letters ("J4K4RT4" → "JaKaRTa"-cased properly,
 * "IND0NESIA" → "INDONESIA"). Replacement case follows the token's letter
 * majority. Pure numbers never qualify (letter ratio gate).
 */
export function repairMajorityAlpha(text: string): RepairResult | null {
  if (text.length < 4) return null;
  let letters = 0;
  let digits = 0;
  for (const ch of text) {
    if (/[a-zA-Z]/.test(ch)) letters++;
    else if (ch >= '0' && ch <= '9') {
      if (!(ch in DIGIT_TO_ALPHA)) return null;
      digits++;
    } else return null; // separators/punctuation disqualify
  }
  if (letters / text.length < 0.55 || digits === 0 || digits / text.length > 0.45) return null;
  const upperCount = (text.match(/[A-Z]/g) ?? []).length;
  const lowerCount = (text.match(/[a-z]/g) ?? []).length;
  const upperMajority = upperCount >= lowerCount;
  let out = '';
  for (const ch of text) {
    if (ch in DIGIT_TO_ALPHA) {
      const m = DIGIT_TO_ALPHA[ch];
      out += upperMajority ? m.upper : m.lower;
    } else out += ch;
  }
  if (out === text) return null;
  return { text: out, kind: 'alpha' };
}

// ---------------------------------------------------------------------------
// Numeric fragment stitching
// ---------------------------------------------------------------------------

function verticalCenter(t: RepairableToken): number {
  return t.y + t.height / 2;
}

interface StitchChunk<T extends RepairableToken> {
  headOriginal: T;
  headIndex: number;
  texts: string[];
  x0: number;
  x1: number;
  height: number;
  cy: number;
}

/**
 * Stitch adjacent pure-numeric fragments back into one token
 * ("0812"+"3456"+"7890" → "081234567890", "1."+"500.000" → "1.500.000").
 * Geometry gates: same visual line (center delta ≤ 0.15×height) and horizontal
 * gap ≤ 0.35×height. Both sides must be digits plus joining punctuation only.
 * Chains break at any non-numeric token ("Rp" stays separate from "32.000").
 */
export function stitchNumericFragments<T extends RepairableToken>(tokens: T[]): T[] {
  const indexed = tokens.map((t, i) => ({ t, i, cy: verticalCenter(t) }));
  const sorted = [...indexed].sort((a, b) => a.cy - b.cy || a.t.x - b.t.x);

  const mergedByHeadIndex = new Map<number, T>();
  const absorbedIndices = new Set<number>();
  let chunk: StitchChunk<T> | null = null;

  const finalize = () => {
    if (chunk && chunk.texts.length > 1) {
      const head = chunk.headOriginal;
      const joined = chunk.texts.join('');
      mergedByHeadIndex.set(chunk.headIndex, {
        ...head,
        text: joined,
        width: chunk.x1 - chunk.x0,
        height: chunk.height,
        repaired: 'stitched',
        repairedFrom: chunk.texts.join('|'),
      } as T);
    }
    chunk = null;
  };

  for (const it of sorted) {
    const numericOnly = isNumericFragment(it.t.text);
    if (
      chunk &&
      numericOnly &&
      Math.abs(it.cy - chunk.cy) <= Math.max(chunk.height, it.t.height) * 0.15 &&
      it.t.x - chunk.x1 >= -it.t.height * 0.35 &&
      it.t.x - chunk.x1 <= it.t.height * 0.35
    ) {
      chunk.texts.push(it.t.text);
      chunk.x1 = Math.max(chunk.x1, it.t.x + it.t.width);
      chunk.height = Math.max(chunk.height, it.t.height);
      chunk.cy = (chunk.cy + it.cy) / 2;
      absorbedIndices.add(it.i);
    } else {
      finalize();
      if (numericOnly) {
        chunk = {
          headOriginal: it.t,
          headIndex: it.i,
          texts: [it.t.text],
          x0: it.t.x,
          x1: it.t.x + it.t.width,
          height: it.t.height,
          cy: it.cy,
        };
      }
    }
  }
  finalize();

  if (mergedByHeadIndex.size === 0) return tokens;

  return indexed.flatMap(({ t, i }) => {
    if (absorbedIndices.has(i)) return [];
    const merged = mergedByHeadIndex.get(i);
    return [merged ?? t];
  });
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

/**
 * Apply stitching then majority repairs to a word list (mutates copies).
 * Order matters: stitch first so split fragments form whole candidates, then
 * run majority rules — including on stitched text, since fragments can carry
 * lookalike contamination ("198" + "O02" → "198O02" → "198002"). Provenance
 * lives in repairedFrom either way.
 */
export function repairTokens<T extends RepairableToken & Partial<RepairMeta>>(tokens: T[]): T[] {
  const stitched = stitchNumericFragments(tokens);
  return stitched.map((t) => {
    const meta = t as RepairMeta;
    if (meta.repaired === 'stitched') {
      const num = repairMajorityNumeric(t.text);
      if (num && meta.repairedFrom) {
        return {
          ...t,
          text: num.text,
          repairedFrom: `${meta.repairedFrom}=>${t.text}`,
        } as T;
      }
      return t;
    }
    const num = repairMajorityNumeric(t.text);
    if (num) return { ...t, text: num.text, repaired: 'numeric', repairedFrom: t.text } as T;
    const alpha = repairMajorityAlpha(t.text);
    if (alpha) return { ...t, text: alpha.text, repaired: 'alpha', repairedFrom: t.text } as T;
    return t;
  });
}
