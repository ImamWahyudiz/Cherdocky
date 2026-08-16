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
  { type: 'nik', label: 'NIK (KTP / KK)', description: 'Nomor Induk Kependudukan 16 digit' },
  { type: 'phone', label: 'Nomor Telepon', description: 'Nomor HP (08xx, +62) atau telepon rumah' },
  { type: 'email', label: 'Alamat Email', description: 'Format email standar' },
  { type: 'dob', label: 'Tanggal / Tgl Lahir', description: 'Format tanggal DD/MM/YYYY atau nama bulan' },
  { type: 'ttl', label: 'Tempat, Tanggal Lahir', description: 'Format Kota, Tanggal' },
  { type: 'npwp', label: 'NPWP / Pajak', description: 'Nomor Pokok Wajib Pajak 15/16 digit' },
  { type: 'bpjs', label: 'BPJS / KIS', description: 'Nomor BPJS 13 digit' },
  { type: 'bank', label: 'Nomor Rekening Bank', description: 'Nomor rekening 10–16 digit' },
  { type: 'id', label: 'Paspor / SIM / ID', description: 'Nomor Paspor atau identitas resmi' },
];

/**
 * Fuzzy normalization for digits: replaces common OCR misrecognitions.
 */
export function fuzzyNormalizeDigits(text: string): string {
  return text
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8');
}

/**
 * Clean text for regex matching.
 */
export function cleanTextForMatching(text: string): string {
  return text.toLowerCase().replace(/["'“”:=;,.\\/\\-_#()]/g, ' ').replace(/\s+/g, ' ').trim();
}

const MONTH_NAMES =
  '(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)';

const MONTH_NAMES_LIST = new Set([
  'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
  'january', 'february', 'march', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]);

/**
 * High-Confidence Pure Regex Patterns for Concrete PII Data.
 */
const regexMap: Partial<Record<PIIType, RegExp>> = {
  // Indonesian NIK: strictly 16 continuous digits or 4x4 spaced digits
  nik: /\b(?:(?:\d{4}[\s.-]){3}\d{4}|\d{16})\b/,

  // Indonesian Phone numbers (08xx or +62xx with 10-13 digits, or PSTN area codes)
  phone: /\b(?:\+?62[\s-]?8\d{8,11}|08\d{8,11}|\(?0\d{2,4}\)?[\s.-]?\d{6,8})\b/,

  // Standard RFC Email Address
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,

  // Date / DOB: DD/MM/YYYY or DD-MM-YYYY or DD Month YYYY with valid calendar days
  dob: new RegExp(
    `\\b(?:(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:0?[1-9]|1[012])[\\/\\-.](?:19|20)\\d{2}|(?:0?[1-9]|[12][0-9]|3[01])\\s+${MONTH_NAMES}\\s+(?:19|20)\\d{2})\\b`,
    'i'
  ),

  date: new RegExp(
    `\\b(?:(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:0?[1-9]|1[012])[\\/\\-.](?:19|20)\\d{2}|(?:0?[1-9]|[12][0-9]|3[01])\\s+${MONTH_NAMES}\\s+(?:19|20)\\d{2})\\b`,
    'i'
  ),

  // Tempat, Tanggal Lahir (TTL): e.g. "JAKARTA, 18-02-1985"
  ttl: new RegExp(
    `\\b[A-Za-z]{3,18},\\s*(?:(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:0?[1-9]|1[012])[\\/\\-.](?:19|20)\\d{2})\\b`,
    'i'
  ),

  // BPJS / KIS: exactly 13 digits starting with 000
  bpjs: /\b000\d{10}\b/,

  // NPWP: 15/16 digits grouped XX.XXX.XXX.X-XXX.XXX
  npwp: /\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b/,

  // Bank Account Numbers: 10 to 16 continuous digits
  bank: /\b\d{10,16}\b/,

  // Passport / Document ID: Letter + 7-8 digits (e.g. A1234567, X12345678)
  id: /\b[A-Z]{1,2}\d{7,8}\b/i,
};

/**
 * Check if a single token matches active regex patterns or custom search text.
 */
export function detectPII(text: string, activeTypes: PIIType[], customText?: string): boolean {
  if (!text) return false;

  // Skip isolated noise punctuation
  if (/^[-_~—|•*#:=;,.\\/]+$/.test(text)) {
    return false;
  }

  const normalizedDigits = fuzzyNormalizeDigits(text);
  const rawClean = cleanTextForMatching(text);

  for (const type of activeTypes) {
    if (type === 'custom') {
      if (customText && customText.trim().length > 0) {
        if (text.toLowerCase().includes(customText.trim().toLowerCase())) {
          return true;
        }
      }
      continue;
    }

    const regex = regexMap[type];
    if (regex) {
      if (regex.test(text) || regex.test(normalizedDigits) || regex.test(rawClean)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * High-precision regex extractor for all document words.
 * Groups detected PII indices into categories for the sidebar.
 */
export function extractFoundSensitiveKeywords(
  words: { text: string; x: number; y: number; width: number; height: number; pageIndex?: number }[]
): FoundKeywordItem[] {
  const result: FoundKeywordItem[] = [];
  if (!words || words.length === 0) return result;

  const categoryMap = new Map<PIIType, number[]>();
  PII_CATEGORIES.forEach((cat) => categoryMap.set(cat.type, []));

  // 1. Single-token regex detection
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const text = word.text.trim();
    if (!text || /^[-_~—|•*#:=;,.\\/]+$/.test(text)) continue;

    for (const cat of PII_CATEGORIES) {
      if (detectPII(text, [cat.type])) {
        categoryMap.get(cat.type)!.push(i);
      }
    }
  }

  // 2. Multi-token Date Detection within same page (e.g. "09" + "Nov" + "2002")
  for (let i = 0; i < words.length - 2; i++) {
    const p1 = words[i].pageIndex || 1;
    const p2 = words[i + 1].pageIndex || 1;
    const p3 = words[i + 2].pageIndex || 1;
    if (p1 !== p2 || p2 !== p3) continue;

    const w1 = words[i].text.replace(/[^0-9]/g, '');
    const w2 = words[i + 1].text.toLowerCase().replace(/[^a-z]/g, '');
    const w3 = words[i + 2].text.replace(/[^0-9]/g, '');

    const isDay = /^(?:0?[1-9]|[12][0-9]|3[01])$/.test(w1);
    const isMonth = MONTH_NAMES_LIST.has(w2);
    const isYear = /^(?:19|20)\d{2}$/.test(w3);

    const isSameLine =
      Math.abs(words[i + 1].y - words[i].y) < Math.max(words[i].height, 22) &&
      Math.abs(words[i + 2].y - words[i].y) < Math.max(words[i].height, 22);

    if (isDay && isMonth && isYear && isSameLine) {
      categoryMap.get('dob')!.push(i, i + 1, i + 2);
    }
  }

  // 3. Format into FoundKeywordItem for UI
  for (const cat of PII_CATEGORIES) {
    const indices = Array.from(new Set(categoryMap.get(cat.type) || []));
    if (indices.length > 0) {
      result.push({
        id: cat.type,
        keyword: cat.label,
        category: cat.description,
        count: indices.length,
        wordIndices: indices,
      });
    }
  }

  return result;
}

/**
 * Context-aware regex detector returning set of matching word indices.
 */
export function findContextualPIIWordIndices(
  words: { text: string; x: number; y: number; width: number; height: number; pageIndex?: number }[],
  activeTypes: PIIType[],
  customText?: string,
): Set<number> {
  const result = new Set<number>();
  if (!words || words.length === 0) return result;

  // Pass 1: Standalone regex patterns
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const text = word.text.trim();
    if (!text || /^[-_~—|•*#:=;,.\\/]+$/.test(text)) continue;

    if (detectPII(text, activeTypes, customText)) {
      result.add(i);
    }
  }

  // Pass 2: Multi-token Date Detection
  if (activeTypes.includes('dob') || activeTypes.includes('date')) {
    for (let i = 0; i < words.length - 2; i++) {
      const p1 = words[i].pageIndex || 1;
      const p2 = words[i + 1].pageIndex || 1;
      const p3 = words[i + 2].pageIndex || 1;
      if (p1 !== p2 || p2 !== p3) continue;

      const w1 = words[i].text.replace(/[^0-9]/g, '');
      const w2 = words[i + 1].text.toLowerCase().replace(/[^a-z]/g, '');
      const w3 = words[i + 2].text.replace(/[^0-9]/g, '');

      const isDay = /^(?:0?[1-9]|[12][0-9]|3[01])$/.test(w1);
      const isMonth = MONTH_NAMES_LIST.has(w2);
      const isYear = /^(?:19|20)\d{2}$/.test(w3);

      const isSameLine =
        Math.abs(words[i + 1].y - words[i].y) < Math.max(words[i].height, 22) &&
        Math.abs(words[i + 2].y - words[i].y) < Math.max(words[i].height, 22);

      if (isDay && isMonth && isYear && isSameLine) {
        result.add(i);
        result.add(i + 1);
        result.add(i + 2);
      }
    }
  }

  return result;
}
