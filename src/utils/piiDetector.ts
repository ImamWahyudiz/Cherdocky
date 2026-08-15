import sensitiveKeywordsRaw from '~/assets/data.csv?raw';

export type PIIType =
  | 'nik'
  | 'phone'
  | 'email'
  | 'id'
  | 'bank'
  | 'password'
  | 'dob'
  | 'ttl'
  | 'bpjs'
  | 'npwp'
  | 'address'
  | 'date'
  | 'custom'
  | 'sensitive_label';

export interface ParsedKeywordEntry {
  category: string;
  indonesianKeywords: string[];
  englishKeywords: string[];
}

export interface FoundKeywordItem {
  id: string;
  keyword: string;
  category: string;
  count: number;
  wordIndices: number[];
}

/**
 * List of document header, watermark, country/state titles that are NOT PII
 * and MUST STAY UNREDACTED (GREEN).
 */
const DOCUMENT_HEADER_IGNORE = new Set([
  'provinsi', 'kabupaten', 'kota', 'pemerintah', 'republic', 'of', 'utopia', 'identity', 'card',
  'identification', 'pass', 'proof', 'age', 'citizencard', 'citizen',
  'pennsylvania', 'not', 'for', 'real', 'purposes', 'visitpa', 'com', 'usa',
  'national', 'police', 'chiefs', 'council', 'security', 'industry', 'authority',
  'organ', 'donor', 'dups', 'dup', 'specimen', 'indonesia'
]);

/**
 * Field Labels that identify personal data fields (including common OCR misrecognitions).
 * RULE: The label itself MUST ALWAYS REMAIN UNREDACTED (GREEN).
 */
const KNOWN_LABELS = new Set([
  'nik', 'nama', 'name', 'surname', 'given', 'names', 'gvennames', 'givenname',
  'tempat', 'tgl', 'lahir', 'tempat/tgl', 'tempat/tgl.', 'ttl', 'dob', 'birth',
  'jenis', 'kelamin', 'sex', 'gender',
  'gol', 'darah', 'gol.', 'darah:', 'blood',
  'alamat', 'address', 'addr', 'jalan', 'street', 'st', 'ave', 'avenue', 'rd', 'road',
  'rt', 'rw', 'rt/rw', 'rtirw', 'rt.rw',
  'kel', 'desa', 'kel/desa', 'kelldesa', 'kelidesa', 'kelurahan', 'kecamatan', 'kel.desa', 'kell/desa', 'keli/desa',
  'agama', 'religion',
  'status', 'perkawinan', 'pernikahan', 'marital',
  'pekerjaan', 'occupation', 'profession',
  'kewarganegaraan', 'citizenship', 'nationality',
  'berlaku', 'hingga', 'masa', 'valid', 'until', 'expiry', 'expires', 'exp', 'issue', 'issued', 'ofissue',
  'nomor', 'number', 'no', 'doc', 'document', 'idn', 'dl', 'dln', 'dd', 'date',
  'signature', 'sign', 'scguature',
  'password', 'pin', 'otp', 'rekening', 'account', 'npwp', 'bpjs', 'paspor', 'passport', 'sim'
]);

/**
 * Dynamically parse data.csv at runtime.
 */
function parseKeywordsCsv(csvContent: string): {
  entries: ParsedKeywordEntry[];
  allKeywordsLower: Set<string>;
  categoryKeywordsMap: Map<PIIType, Set<string>>;
  keywordToCategoryMap: Map<string, string>;
} {
  const lines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const entries: ParsedKeywordEntry[] = [];
  const allKeywordsLower = new Set<string>();
  const categoryKeywordsMap = new Map<PIIType, Set<string>>();
  const keywordToCategoryMap = new Map<string, string>();

  categoryKeywordsMap.set('nik', new Set());
  categoryKeywordsMap.set('phone', new Set());
  categoryKeywordsMap.set('email', new Set());
  categoryKeywordsMap.set('id', new Set());
  categoryKeywordsMap.set('bank', new Set());
  categoryKeywordsMap.set('password', new Set());
  categoryKeywordsMap.set('dob', new Set());
  categoryKeywordsMap.set('ttl', new Set());
  categoryKeywordsMap.set('bpjs', new Set());
  categoryKeywordsMap.set('npwp', new Set());
  categoryKeywordsMap.set('address', new Set());
  categoryKeywordsMap.set('date', new Set());
  categoryKeywordsMap.set('sensitive_label', new Set());

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;

    const category = parts[0];
    const rawIndo = parts[1] || '';
    const rawEng = parts[2] || '';

    const indoKeywords = rawIndo.split('/').map((s) => s.trim()).filter(Boolean);
    const engKeywords = rawEng.split('/').map((s) => s.trim()).filter(Boolean);

    entries.push({
      category,
      indonesianKeywords: indoKeywords,
      englishKeywords: engKeywords,
    });

    const combined = [...indoKeywords, ...engKeywords];
    for (const kw of combined) {
      const lower = kw.toLowerCase();
      if (!lower) continue;
      if (DOCUMENT_HEADER_IGNORE.has(lower)) continue;

      allKeywordsLower.add(lower);
      keywordToCategoryMap.set(lower, category);

      const catLower = category.toLowerCase();
      if (lower.includes('nik') || lower.includes('kependudukan') || lower.includes('ssn')) {
        categoryKeywordsMap.get('nik')?.add(lower);
      } else if (lower.includes('telepon') || lower.includes('phone') || lower.includes('hp') || lower.includes('mobile')) {
        categoryKeywordsMap.get('phone')?.add(lower);
      } else if (lower.includes('email') || lower.includes('surel')) {
        categoryKeywordsMap.get('email')?.add(lower);
      } else if (lower.includes('ttl') || lower.includes('tempat/tgl')) {
        categoryKeywordsMap.get('ttl')?.add(lower);
      } else if (lower.includes('lahir') || lower.includes('birth') || lower.includes('dob')) {
        categoryKeywordsMap.get('dob')?.add(lower);
      } else if (lower.includes('tanggal') || lower.includes('date') || lower.includes('expiry') || lower.includes('issue') || lower.includes('berlaku')) {
        categoryKeywordsMap.get('date')?.add(lower);
      } else if (lower.includes('alamat') || lower.includes('address') || lower.includes('jalan') || lower.includes('street') || lower.includes('kelurahan') || lower.includes('kecamatan') || lower.includes('rt/rw')) {
        categoryKeywordsMap.get('address')?.add(lower);
      } else if (lower.includes('bpjs') || lower.includes('kis')) {
        categoryKeywordsMap.get('bpjs')?.add(lower);
      } else if (lower.includes('npwp') || lower.includes('tax')) {
        categoryKeywordsMap.get('npwp')?.add(lower);
      } else if (catLower.includes('kredensial') || lower.includes('pass') || lower.includes('pin') || lower.includes('otp') || lower.includes('sandi') || lower.includes('token') || lower.includes('key')) {
        categoryKeywordsMap.get('password')?.add(lower);
      } else if (catLower.includes('keuangan') || lower.includes('rekening') || lower.includes('bank') || lower.includes('kartu') || lower.includes('cvv') || lower.includes('iban')) {
        categoryKeywordsMap.get('bank')?.add(lower);
      } else if (lower.includes('ktp') || lower.includes('paspor') || lower.includes('passport') || lower.includes('sim') || lower.includes('kk') || lower.includes('id') || lower.includes('doc') || lower.includes('number') || lower.includes('dd') || lower.includes('discriminator')) {
        categoryKeywordsMap.get('id')?.add(lower);
      } else {
        categoryKeywordsMap.get('sensitive_label')?.add(lower);
      }
    }
  }

  return { entries, allKeywordsLower, categoryKeywordsMap, keywordToCategoryMap };
}

export const {
  entries: parsedCsvKeywords,
  allKeywordsLower: allCsvKeywordsLower,
  categoryKeywordsMap: csvCategoryKeywordsMap,
  keywordToCategoryMap: csvKeywordToCategoryMap,
} = parseKeywordsCsv(sensitiveKeywordsRaw);

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
 * Clean text for fuzzy keyword comparison.
 */
export function cleanTextForMatching(text: string): string {
  return text.toLowerCase().replace(/["'“”:=;,.\\/\\-_#()]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Returns true if a token is a known label/keyword (or punctuation delimiter).
 * LABELS NEVER GET REDACTED.
 */
export function isLabelOrKeyword(text: string): boolean {
  if (!text) return false;
  const raw = text.trim().toLowerCase();
  if (raw === ':' || raw === '=' || raw === '-' || raw === '~' || raw === '—|' || raw === '©') return true;

  const clean = cleanTextForMatching(text);
  if (!clean) return false;

  // Exact match in KNOWN_LABELS or CSV
  if (KNOWN_LABELS.has(clean)) return true;
  if (allCsvKeywordsLower.has(clean)) return true;

  // Fuzzy match for Kel/Desa variations (kelidesa, kelldesa, kell/desa, etc.)
  if (/^kell?[i\/.]?desa$/i.test(raw.replace(/[\s/.]/g, ''))) return true;

  // Fuzzy match for RT/RW variations (rtirw, rt/rw, rt.rw, etc.)
  if (/^rt[i\/.]?rw$/i.test(raw.replace(/[\s/.]/g, ''))) return true;

  // Check composite labels
  for (const part of clean.split(/\s+/)) {
    if (KNOWN_LABELS.has(part)) return true;
  }

  // AAMVA Driver license field labels (1, 2, 3, 4a, 4b, 4d, 8, DD, EXP, ISS, DOB, IDN)
  if (/^(?:1|2|3|4a|4b|4d|8|dd|exp|iss|dob|idn)$/i.test(raw.replace(/[:.]/g, ''))) {
    return true;
  }

  return false;
}

/**
 * Returns true if the token is a document header/watermark to be ignored.
 */
export function isDocumentHeaderIgnore(text: string): boolean {
  const clean = cleanTextForMatching(text);
  if (!clean) return false;
  if (DOCUMENT_HEADER_IGNORE.has(clean)) return true;

  for (const part of clean.split(/\s+/)) {
    if (DOCUMENT_HEADER_IGNORE.has(part)) return true;
  }

  return false;
}

/**
 * Check if a word is part of an administrative document header line
 * (e.g. "PROVINSI JAWA BARAT", "KABUPATEN BANYUWANGI", "REPUBLIC OF INDONESIA")
 * which is public administrative metadata and should NEVER be marked as sensitive.
 */
export function isTopAdministrativeHeader(
  index: number,
  words: { text: string; x: number; y: number; width: number; height: number }[]
): boolean {
  const word = words[index];
  if (!word) return false;

  // Find all words on the same line (within vertical threshold)
  const lineWords = words.filter((w) => Math.abs(w.y - word.y) < Math.max(word.height, 22));

  // Check if this line begins with or contains administrative header prefixes
  const hasAdminPrefix = lineWords.some((w) => {
    const clean = cleanTextForMatching(w.text);
    return (
      clean === 'provinsi' ||
      clean === 'kabupaten' ||
      clean === 'kota' ||
      clean === 'pemerintah' ||
      clean === 'republic' ||
      clean === 'state'
    );
  });

  // If it has administrative prefix and NO colon ':' delimiter, it is a document header line
  if (hasAdminPrefix) {
    const hasColon = lineWords.some((w) => w.text.includes(':') || w.text === '=');
    if (!hasColon) {
      return true;
    }
  }

  return false;
}

const MONTH_NAMES =
  '(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)';

const MONTH_NAMES_LIST = new Set([
  'januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
  'january', 'february', 'march', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]);

/**
 * Standalone High-Confidence PII Value Regexes.
 * Targets ONLY concrete data patterns (digits, dates, emails).
 */
const regexMap: Partial<Record<PIIType, RegExp>> = {
  // Indonesian NIK: 16 digits
  nik: /\b(?:(?:\d{4}[\s.-]?){3}\d{4}|\d{16}|\d{2}\.\d{2}\.\d{2}\.\d{6}\.\d{4}|\d{6}-\d{6}-\d{4})\b/i,

  // Phone numbers (10-13 digits or +62/+1)
  phone: /(?:(?:\+?62|08|\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?)[0-9\s.-]{7,14}\b|\b08\d{8,11}\b|\b\(0\d{2,3}\)[\s.-]?\d{6,8}\b)/i,

  // Standard Email
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,

  // Standalone Date / DOB: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, 30Apr2028, 0113112026
  dob: new RegExp(
    `(?:\\b(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:0?[1-9]|1[012])[\\/\\-.](?:19|20)\\d{2}\\b|\\b(?:0?[1-9]|1[012])[\\/\\-.](?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:19|20)\\d{2}\\b|\\b\\d{2}${MONTH_NAMES}\\d{4}\\b)`,
    'i'
  ),

  date: new RegExp(
    `(?:\\b(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:0?[1-9]|1[012])[\\/\\-.](?:19|20)\\d{2}\\b|\\b(?:0?[1-9]|1[012])[\\/\\-.](?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.](?:19|20)\\d{2}\\b|\\b\\d{2}${MONTH_NAMES}\\d{4}\\b)`,
    'i'
  ),

  // Tempat, Tanggal Lahir (TTL): e.g. "JAKARTA, 18:02-1985"
  ttl: new RegExp(
    `\\b[A-Za-z\\s]{3,20},\\s*(?:(?:0?[1-9]|[12][0-9]|3[01])[\\/\\-.:](?:0?[1-9]|1[012])[\\/\\-.:](?:19|20)\\d{2})\\b`,
    'i'
  ),

  // BPJS / KIS: 13 digits starting with 000
  bpjs: /\b000\d{10}\b/i,

  // NPWP: 15/16 digits grouped
  npwp: /\b\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}\b/i,

  // Bank Account Numbers: 10 to 16 continuous digits
  bank: /\b\d{10,16}\b/i,

  // Standalone ID / Card / Document Number:
  // - 8 to 10 continuous digits: e.g. 99999999
  // - 16 hex characters: e.g. 5e43216619642484
  // - Letter + 5 to 7 digits: e.g. AA00001
  id: /\b(?:[A-Z]{1,2}\d{5,8}|[a-f0-9]{16}|\d{8,10})\b/i,
};

/**
 * Check if a single word / token matches any active standalone pattern rule or custom text.
 * Never marks labels or document headers as sensitive.
 */
export function detectPII(text: string, activeTypes: PIIType[], customText?: string): boolean {
  if (!text) return false;

  // Labels and Document Headers must NEVER be marked sensitive standalone
  if (isLabelOrKeyword(text) || isDocumentHeaderIgnore(text)) {
    return false;
  }

  const normalizedDigits = fuzzyNormalizeDigits(text);
  const rawClean = cleanTextForMatching(text);

  for (const type of activeTypes) {
    if (type === 'custom') {
      if (customText && text.toLowerCase().includes(customText.toLowerCase())) {
        return true;
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

interface IndexedWord {
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Extract sensitive keywords from data.csv that appear in the document,
 * and track ONLY their associated VALUE words (not the label itself).
 * Unifies multi-word labels (e.g. Status Perkawinan) into single entities
 * and strictly isolates per line to eliminate cross-field crosstalk.
 */
export function extractFoundSensitiveKeywords(
  words: { text: string; x: number; y: number; width: number; height: number }[]
): FoundKeywordItem[] {
  const foundMap = new Map<string, { category: string; count: number; wordIndices: number[] }>();

  if (!words || words.length === 0) return [];

  // 1. Tag words with original indices and sort visually by Y, then X
  const indexedWords: IndexedWord[] = words.map((w, index) => ({
    index,
    text: w.text,
    x: w.x,
    y: w.y,
    width: w.width,
    height: w.height,
  }));

  // 2. Group words into horizontal lines with strict vertical center threshold
  const lines: IndexedWord[][] = [];
  const sorted = [...indexedWords].sort((a, b) => a.y - b.y || a.x - b.x);

  for (const w of sorted) {
    let placed = false;
    for (const line of lines) {
      const lineCenterY = line.reduce((sum, item) => sum + item.y + item.height / 2, 0) / line.length;
      const wCenterY = w.y + w.height / 2;
      const avgH = line.reduce((sum, item) => sum + item.height, 0) / line.length;

      // Words belong to same line only if their vertical centers are within 35% of word height (typically <= 6px)
      if (Math.abs(wCenterY - lineCenterY) < Math.min(avgH, w.height) * 0.4) {
        line.push(w);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lines.push([w]);
    }
  }

  // Sort each line horizontally from left to right
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
  }

  // 3. Process each line to find unified label-value pairs
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Check if line is header to ignore
    if (line.length > 0 && isTopAdministrativeHeader(line[0].index, words)) {
      continue;
    }

    // Scan through words in this line
    let i = 0;
    while (i < line.length) {
      const currentWord = line[i];

      // Check if currentWord starts a label
      if (isLabelOrKeyword(currentWord.text) && !isDocumentHeaderIgnore(currentWord.text) && currentWord.text !== ':' && currentWord.text !== '=') {
        // Collect ALL consecutive label tokens on this line (e.g. "Status" + "Perkawinan", "Tempat/Tgl" + "Lahir")
        const labelTokens: string[] = [currentWord.text];
        let labelEnd = i + 1;

        while (labelEnd < line.length) {
          const nextTok = line[labelEnd];
          if (nextTok.text === ':' || nextTok.text === '=') {
            break; // Stop at colon delimiter
          }
          if (isLabelOrKeyword(nextTok.text) && !isDocumentHeaderIgnore(nextTok.text)) {
            labelTokens.push(nextTok.text);
            labelEnd++;
          } else {
            break;
          }
        }

        const unifiedLabelClean = cleanTextForMatching(labelTokens.join(' '));
        const displayLabel = labelTokens.join(' ').replace(/[^\w\s/.-]/g, '').toUpperCase().trim();
        const matchedCategory = csvKeywordToCategoryMap.get(unifiedLabelClean) || 'Identitas Pribadi';

        // Collect value words strictly after this unified label (and after any colon)
        let valPtr = labelEnd;
        if (valPtr < line.length && (line[valPtr].text === ':' || line[valPtr].text === '=')) {
          valPtr++;
        }

        const valueIndices: number[] = [];
        while (valPtr < line.length) {
          const nextW = line[valPtr];
          // Stop if we encounter another label on the same line (e.g. "Gol. Darah" on the same line as "Jenis Kelamin")
          if (isLabelOrKeyword(nextW.text) && nextW.text !== ':' && nextW.text !== '=') {
            break;
          }
          if (!isDocumentHeaderIgnore(nextW.text)) {
            valueIndices.push(nextW.index);
          }
          valPtr++;
        }

        // If no value on this line, check if value is on immediate next line (vertical format)
        if (valueIndices.length === 0 && lineIdx + 1 < lines.length) {
          const nextLine = lines[lineIdx + 1];
          const nextLineHasLabel = nextLine.some((w) => isLabelOrKeyword(w.text) && w.text !== ':' && w.text !== '=');
          if (!nextLineHasLabel) {
            for (const nw of nextLine) {
              if (!isDocumentHeaderIgnore(nw.text)) {
                valueIndices.push(nw.index);
              }
            }
          }
        }

        if (valueIndices.length > 0 && displayLabel) {
          const existing = foundMap.get(displayLabel) || {
            category: matchedCategory,
            count: 0,
            wordIndices: [],
          };
          existing.count++;
          existing.wordIndices.push(...valueIndices);
          foundMap.set(displayLabel, existing);
        }

        i = valPtr;
      } else {
        i++;
      }
    }
  }

  return Array.from(foundMap.entries()).map(([keyword, data]) => ({
    id: keyword.toLowerCase().replace(/[^\w]/g, '_'),
    keyword,
    category: data.category,
    count: data.count,
    wordIndices: Array.from(new Set(data.wordIndices)),
  }));
}

/**
 * Context-aware multi-token detection.
 * KEY RULE:
 * 1. The keyword/label itself is NEVER marked as sensitive (stays GREEN).
 * 2. Document header titles/watermarks are NEVER marked as sensitive.
 * 3. ONLY the content/values associated with the field are marked as sensitive (RED).
 */
export function findContextualPIIWordIndices(
  words: { text: string; x: number; y: number; width: number; height: number }[],
  activeTypes: PIIType[],
  customText?: string,
): Set<number> {
  const result = new Set<number>();

  // Pass 1: Standalone high-confidence regex patterns (numbers, dates, emails)
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (isTopAdministrativeHeader(i, words) || isDocumentHeaderIgnore(word.text) || isLabelOrKeyword(word.text)) {
      continue;
    }

    if (detectPII(word.text, activeTypes, customText)) {
      result.add(i);
    }
  }

  // Pass 2: Multi-token Date Detection (e.g. "09" + "Nov" + "2002")
  for (let i = 0; i < words.length - 2; i++) {
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

  // Pass 3: US Driver License / AAMVA standard numerical field labels (1, 2, 4a, 4b, 4d, 8)
  for (let i = 0; i < words.length; i++) {
    const raw = words[i].text.trim().toLowerCase().replace(/[:.]/g, '');
    const isAamvaLabel = /^(?:1|2|4a|4b|4d|8|dd)$/i.test(raw);

    if (isAamvaLabel) {
      for (let j = i + 1; j < words.length; j++) {
        const nextWord = words[j];
        const isSameLine = Math.abs(nextWord.y - words[i].y) < Math.max(words[i].height, 22);
        const isToTheRight = nextWord.x > words[i].x;

        if (!isSameLine || !isToTheRight) break;
        if (isLabelOrKeyword(nextWord.text) || isDocumentHeaderIgnore(nextWord.text) || isTopAdministrativeHeader(j, words)) break;

        result.add(j);
      }
    }
  }

  return result;
}
