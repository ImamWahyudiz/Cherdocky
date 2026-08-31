export type PIIType =
  | 'nik'
  | 'phone'
  | 'email'
  | 'id'
  | 'bank'
  | 'dob'
  | 'ttl'
  | 'bpjs'
  | 'npwp'
  | 'date'
  | 'name'
  | 'address'
  | 'custom';

export interface FoundKeywordItem {
  id: string;
  keyword: string;
  category: string;
  count: number;
  wordIndices: number[];
}

export interface PiiCategoryMeta {
  type: PIIType;
  label: string;
  description: string;
}

export const PII_CATEGORIES: PiiCategoryMeta[] = [
  { type: 'nik', label: 'NIK (ID / Family Card)', description: '16-digit National Identification Number' },
  { type: 'phone', label: 'Phone Number', description: 'Mobile (+62, 08xx) or landline phone number' },
  { type: 'email', label: 'Email Address', description: 'Standard email address format' },
  { type: 'dob', label: 'Date of Birth', description: 'Date format DD/MM/YYYY or month name' },
  { type: 'ttl', label: 'Place, Date of Birth', description: 'City, Date of birth format' },
  { type: 'npwp', label: 'Tax ID (NPWP)', description: '15/16-digit Taxpayer Identification Number' },
  { type: 'bpjs', label: 'Health Insurance (BPJS / KIS)', description: '13-digit Health / Social Security ID' },
  { type: 'bank', label: 'Bank Account Number', description: '10-16 digit bank account number' },
  { type: 'id', label: 'Passport / License / ID', description: 'Passport or government ID number' },
  { type: 'name', label: 'Name', description: 'Name based on contextual label proximity' },
  { type: 'address', label: 'Address', description: 'Address based on contextual label proximity' },
];

const ALL_TYPES: PIIType[] = PII_CATEGORIES.map((c) => c.type);

// ---------------------------------------------------------------------------
// Scoped digit normalization (replaces the old global fuzzyNormalizeDigits)
// ---------------------------------------------------------------------------

/**
 * Normalizes OCR digit/letter confusions (0/O, 1/l, 5/S, 8/B) ONLY for tokens
 * that are predominantly numeric. Text like "OKTOBER" or "BANK" is never touched,
 * which prevents the old corruption that created false positives.
 */
function normalizeNumericToken(text: string): string {
  return text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8');
}

function getNormalized(text: string): string {
  const digits = (text.match(/\d/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (digits >= 4 && letters <= Math.max(2, Math.ceil(digits * 0.5))) {
    return normalizeNumericToken(text);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const NIK_PREFIX = new Set<string>([
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '21',
  '31', '32', '33', '34', '35', '36',
  '51', '52', '53',
  '61', '62', '63', '64', '65',
  '71', '72', '73', '74', '75', '76',
  '81', '82',
  '91', '92', '93', '94', '95', '96',
]);

function daysInMonth(month: number, year: number): number {
  return new Date(2000 + (year % 100), month, 0).getDate();
}

/**
 * Validates a 16-digit NIK:
 *  - valid 2-digit province prefix
 *  - digits 7-12 encode birth date DDMMYY (females have day + 40, per Dukcapil spec)
 */
export function isValidNik(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 16) return false;
  if (!NIK_PREFIX.has(digits.slice(0, 2))) return false;

  let dd = parseInt(digits.slice(6, 8), 10);
  const mm = parseInt(digits.slice(8, 10), 10);
  const yy = parseInt(digits.slice(10, 12), 10);
  if (mm < 1 || mm > 12) return false;
  if (dd > 40) dd -= 40; // female encoding
  if (dd < 1 || dd > daysInMonth(mm, yy)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Matchers (regex on normalized text)
// ---------------------------------------------------------------------------

const DOB_RE = /(?:0?[1-9]|[12][0-9]|3[01])[/.-](?:0?[1-9]|1[012])[/.-](?:19|20)\d{2}|(?:0?[1-9]|[12][0-9]|3[01])\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(?:19|20)\d{2}/i;

const TTL_RE = /\b[A-Za-z]{3,18},\s*(?:(?:0?[1-9]|[12][0-9]|3[01])[/.-](?:0?[1-9]|1[012])[/.-](?:19|20)\d{2})\b/i;

const PHONE_RE = /\b(?:\+?62[\s-]?8\d{8,11}|08\d{8,11}|\(?0\d{2,4}\)?[\s.-]?\d{6,8})\b/;

const NPWP_RE = /\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b/;

const BPJS_RE = /^000\d{10}$/;

const BANK_RE = /\b\d{10,16}\b/;

const ID_RE = /\b[A-Z]{1,2}\d{6,8}\b|\b\d{1,2}[A-Z]\d{5,7}\b/i;

type Matcher = (norm: string, raw: string) => boolean;

const MATCHERS: Partial<Record<PIIType, Matcher>> = {
  nik: (_n, raw) => isValidNik(raw),
  phone: (n) => PHONE_RE.test(n),
  email: (_n, raw) => /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(raw),
  dob: (n) => DOB_RE.test(n),
  date: (n) => DOB_RE.test(n),
  ttl: (n) => TTL_RE.test(n),
  npwp: (n) => NPWP_RE.test(n),
  bpjs: (n) => BPJS_RE.test(n),
  bank: (n) => BANK_RE.test(n) && !isValidNik(n) && !PHONE_RE.test(n),
  id: (n) => ID_RE.test(n),
};

const RULE_STRENGTH: Record<PIIType, number> = {
  nik: 0.95, npwp: 0.95, bpjs: 0.9, email: 0.95,
  phone: 0.85, ttl: 0.85, dob: 0.75, date: 0.7,
  bank: 0.5, id: 0.5, name: 0.8, address: 0.8, custom: 0.95,
};

const CONTEXT_GATED: Partial<Record<PIIType, RegExp>> = {
  bank: /\b(rekening|rek|bank|account|no\.?\s*rek|nomor rekening)\b/i,
  id: /\b(paspor|passport|sim|surat izin mengemudi)\b/i,
};

function hasContext(
  words: { text: string; x: number; y: number; width: number; height: number }[],
  i: number,
  keywordRe: RegExp,
): boolean {
  const w = words[i];
  const within = 260;
  for (let j = 0; j < words.length; j++) {
    if (j === i) continue;
    const o = words[j];
    if (Math.abs(o.y - w.y) > Math.max(20, w.height)) continue;
    if (Math.abs(o.x - w.x) > within) continue;
    if (keywordRe.test(o.text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Geometry- and context-aware analysis
// ---------------------------------------------------------------------------

export interface OcrWord {
  text: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  confidence?: number;
}

export interface SensitiveMatch {
  type: PIIType;
  wordIndex: number;
  text: string;
  ruleStrength: number;
  ocrConf: number;
  combined: number;
  autoRedact: boolean;
  source: 'regex' | 'label' | 'context';
}

const LABEL_CONTEXT: Record<'name' | 'address', RegExp> = {
  name: /\b(nama|name|surname|given|first\s*name|last\s*name)\b/i,
  address: /\b(alamat|address|street|jl\.?|jalan)\b/i,
};

function findLabelProximityMatches(words: OcrWord[]): Map<number, 'name' | 'address'> {
  const result = new Map<number, 'name' | 'address'>();
  // For each label word (e.g. "Nama", "Alamat"), mark the word immediately
  // after it on the same line — skipping punctuation like ":".  This prevents
  // false positives where unrelated words on the same line get matched.
  for (let j = 0; j < words.length; j++) {
    const o = words[j];
    const ot = (o.text ?? '').trim();
    let labelType: 'name' | 'address' | null = null;
    for (const key of Object.keys(LABEL_CONTEXT) as ('name' | 'address')[]) {
      if (LABEL_CONTEXT[key].test(ot)) { labelType = key; break; }
    }
    if (!labelType) continue;
    // Scan forward from j+1, skip punctuation, grab the first real word
    for (let i = j + 1; i < words.length && i <= j + 3; i++) {
      const w = words[i];
      const wt = (w.text ?? '').trim();
      if (wt.length === 0) continue;
      if (/^[^\p{L}\p{N}]+$/u.test(wt)) continue; // skip punctuation
      const dy = Math.abs((w.y ?? 0) - (o.y ?? 0));
      if (dy > Math.max(20, (o.height ?? 20))) break; // different line → stop
      result.set((w as any).globalIndex ?? i, labelType);
      break;
    }
  }
  return result;
}

export interface AnalyzeOptions {
  requireContextForGated?: boolean;
  autoRedactThreshold?: number;
}

export function analyzeWords(
  words: OcrWord[],
  activeTypes: PIIType[] = ALL_TYPES,
  options: AnalyzeOptions = {},
): SensitiveMatch[] {
  const { requireContextForGated = true, autoRedactThreshold = 0.6 } = options;
  const labelMap = findLabelProximityMatches(words);
  const matches: SensitiveMatch[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const idx = (w as any).globalIndex ?? i;
    const raw = (w.text ?? '').trim();
    if (raw.length === 0) continue;
    const norm = getNormalized(raw);
    const ocrConf = typeof w.confidence === 'number' ? w.confidence : 80;

    const labelType = labelMap.get(i);
    if (labelType && activeTypes.includes(labelType)) {
      const combined = (ocrConf / 100) * RULE_STRENGTH[labelType];
      matches.push({
        type: labelType,
        wordIndex: idx,
        text: raw,
        ruleStrength: RULE_STRENGTH[labelType],
        ocrConf,
        combined,
        autoRedact: combined >= autoRedactThreshold,
        source: 'label',
      });
      continue;
    }

    for (const type of activeTypes) {
      const matcher = MATCHERS[type];
      if (!matcher) continue;
      if (!matcher(norm, raw)) continue;

      const combined = (ocrConf / 100) * RULE_STRENGTH[type];
      let auto: boolean;
      if (CONTEXT_GATED[type]) {
        // Weak signal (bank/id): only auto-redact when a corroborating
        // keyword (e.g. "Rekening") is nearby. Without context it is
        // flagged for review instead of being silently (mis)redacted.
        auto = requireContextForGated
          ? hasContext(words as any, i, CONTEXT_GATED[type] as RegExp)
          : combined >= autoRedactThreshold;
      } else {
        auto = combined >= autoRedactThreshold;
      }
      matches.push({
        type,
        wordIndex: idx,
        text: raw,
        ruleStrength: RULE_STRENGTH[type],
        ocrConf,
        combined,
        autoRedact: auto,
        source: 'regex',
      });
    }
  }

  // --- Label-corroborated NIK (layout evidence over checksum) ---
  // Generated/stylized IDs frequently carry province/date codes that fail
  // strict NIK validation, yet a long digit run directly under a literal
  // "NIK" header is an ID number by layout. Type it as nik and demote
  // weaker numeric guesses (bank/id) made earlier on the same words.
  if (activeTypes.includes('nik')) {
    const nikLabelRe = /^NIK:?$/;
    for (let i = 0; i < words.length; i++) {
      if (!nikLabelRe.test((words[i].text ?? '').trim())) continue;
      const digits: string[] = [];
      const hitIdx: number[] = [];
      for (let j = i + 1; j < words.length && j <= i + 4 && digits.join('').length < 16; j++) {
        const t = (words[j].text ?? '').trim();
        const d = t.replace(/\D/g, '');
        if (!d || d.length !== t.replace(/[^0-9A-Za-z]/g, '').length) break;
        digits.push(d);
        hitIdx.push((words[j] as any).globalIndex ?? j);
      }
      const joined = digits.join('');
      if (joined.length < 12 || joined.length > 18) continue;
      for (let k = matches.length - 1; k >= 0; k--) {
        if (hitIdx.includes(matches[k].wordIndex) && (matches[k].type === 'bank' || matches[k].type === 'id')) {
          matches.splice(k, 1);
        }
      }
      let conf = 0;
      for (const idx of hitIdx) {
        const wj = words.find((x) => ((x as any).globalIndex ?? 0) === idx);
        conf = Math.max(conf, typeof wj?.confidence === 'number' ? wj.confidence : 80);
      }
      const combined = (conf / 100) * 0.85;
      for (const idx of hitIdx) {
        matches.push({
          type: 'nik',
          wordIndex: idx,
          text: joined,
          ruleStrength: 0.85,
          ocrConf: conf,
          combined,
          autoRedact: combined >= autoRedactThreshold,
          source: 'label',
        });
      }
    }
  }

  // --- Multi-token date scan (e.g. "09 Nov 2002" across 3 consecutive words) ---
  const monthRe = /^(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)$/i;
  const dayRe = /^(?:0?[1-9]|[12][0-9]|3[01])$/;
  const yearRe = /^(?:19|20)\d{2}$/;

  for (let i = 0; i < words.length - 2; i++) {
    const w1 = words[i], w2 = words[i + 1], w3 = words[i + 2];
    const t1 = (w1.text ?? '').trim(), t2 = (w2.text ?? '').trim(), t3 = (w3.text ?? '').trim();
    if (!dayRe.test(t1) || !monthRe.test(t2) || !yearRe.test(t3)) continue;
    const dy1 = Math.abs((w2.y ?? 0) - (w1.y ?? 0));
    const dy2 = Math.abs((w3.y ?? 0) - (w1.y ?? 0));
    if (dy1 > 25 || dy2 > 25) continue;
    const idx1 = (w1 as any).globalIndex ?? i;
    const already = matches.some((m) => m.wordIndex === idx1 && (m.type === 'dob' || m.type === 'date'));
    if (already) continue;
    const avgConf = ((w1.confidence ?? 80) + (w2.confidence ?? 80) + (w3.confidence ?? 80)) / 3;
    const combined = (avgConf / 100) * 0.8;
    for (const w of [w1, w2, w3]) {
      matches.push({
        type: 'dob',
        wordIndex: (w as any).globalIndex ?? i,
        text: `${t1} ${t2} ${t3}`,
        ruleStrength: 0.8,
        ocrConf: avgConf,
        combined,
        autoRedact: combined >= autoRedactThreshold,
        source: 'regex',
      });
    }
  }

  // --- Split NIK detection (e.g. "327506500574" + "0014" on the same line) ---
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i], w2 = words[i + 1];
    const d1 = (w1.text ?? '').replace(/\D/g, '');
    const d2 = (w2.text ?? '').replace(/\D/g, '');
    if (d1.length < 4 || d2.length < 4) continue;
    const dy = Math.abs((w2.y ?? 0) - (w1.y ?? 0));
    if (dy > 25) continue;
    const gap = (w2.x ?? 0) - ((w1.x ?? 0) + (w1.width ?? 0));
    if (gap > 40) continue;
    const combinedDigits = d1 + d2;
    if (combinedDigits.length === 16 && isValidNik(combinedDigits)) {
      const idx1 = (w1 as any).globalIndex ?? i;
      const idx2 = (w2 as any).globalIndex ?? i + 1;
      // Remove any prior regex matches for these word indices (e.g. false bank)
      for (let k = matches.length - 1; k >= 0; k--) {
        if (matches[k].wordIndex === idx1 || matches[k].wordIndex === idx2) {
          matches.splice(k, 1);
        }
      }
      const avgConf = Math.max(w1.confidence ?? 0, w2.confidence ?? 0);
      const combined = (avgConf / 100) * 0.95;
      matches.push({
        type: 'nik',
        wordIndex: idx1,
        text: `${w1.text.trim()} ${w2.text.trim()}`,
        ruleStrength: 0.95,
        ocrConf: avgConf,
        combined,
        autoRedact: combined >= autoRedactThreshold,
        source: 'regex',
      });
    }
  }

  return matches;
}

export function findContextualPIIWordIndices(
  words: OcrWord[],
  activeTypes: PIIType[],
  customText: string = '',
): Set<number> {
  const set = new Set<number>();
  const matches = analyzeWords(words, activeTypes);
  for (const m of matches) {
    if (m.autoRedact) set.add(m.wordIndex);
  }
  const customTokens = (customText || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (customTokens.length) {
    for (let i = 0; i < words.length; i++) {
      const t = (words[i].text || '').trim().toLowerCase();
      if (customTokens.includes(t)) set.add(i);
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// Backward-compatible single-word / keyword helpers
// ---------------------------------------------------------------------------

export function detectPII(
  text: string,
  activeTypes: PIIType[],
  customText: string = '',
): boolean {
  const customTokens = (customText || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (customTokens.includes((text || '').trim().toLowerCase())) return true;

  const matches = analyzeWords([{ text }], activeTypes, { requireContextForGated: false });
  return matches.some((m) => m.autoRedact && !CONTEXT_GATED[m.type]);
}

export function extractFoundSensitiveKeywords(
  words: OcrWord[],
  activeTypes: PIIType[] = ALL_TYPES,
  customText: string = '',
): FoundKeywordItem[] {
  const matches = analyzeWords(words, activeTypes);
  const byType = new Map<PIIType, { count: number; wordIndices: number[] }>();

  for (const m of matches) {
    const entry = byType.get(m.type) || { count: 0, wordIndices: [] };
    entry.count++;
    entry.wordIndices.push(m.wordIndex);
    byType.set(m.type, entry);
  }

  const result: FoundKeywordItem[] = [];
  for (const [type, entry] of byType) {
    const meta = PII_CATEGORIES.find((c) => c.type === type);
    result.push({
      id: type,
      keyword: meta ? meta.label : type,
      category: type,
      count: entry.count,
      wordIndices: entry.wordIndices,
    });
  }

  const customTokens = (customText || '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const ct of customTokens) {
    if (words.some((w) => (w.text || '').toLowerCase().includes(ct.toLowerCase()))) {
      result.push({ id: 'custom', keyword: ct, category: 'custom', count: 1, wordIndices: [] });
    }
  }
  return result;
}

