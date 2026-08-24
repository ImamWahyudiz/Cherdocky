/**
 * Enhanced spell checking for Indonesian OCR results.
 * Combines built-in core dictionary with dynamic correction.
 */

export const INDONESIAN_CORE_DICTIONARY = new Set([
  // Common words
  'dan', 'atau', 'tidak', 'adalah', 'ini', 'itu', 'yang', 'dengan', 'untuk',
  'pada', 'dalam', 'dari', 'ke', 'di', 'saat', 'ketika', 'seperti', 'sebagai',
  'akan', 'telah', 'sudah', 'belum', 'masih', 'juga', 'hanya', 'saja', 'bisa',
  // ID card specific
  'nik', 'nama', 'alamat', 'tempat', 'tanggal', 'jenis', 'kelamin', 'golongan',
  'darah', 'rt', 'rw', 'kelurahan', 'kecamatan', 'agama', 'status', 'perkawinan',
  'pekerjaan', 'kewarganegaraan', 'berlaku', 'hingga', 'provinsi', 'kabupaten',
  'kota', 'desa', 'kode', 'pos', 'prov', 'kab', 'kec', 'kel', 'dusun',
  'laki', 'perempuan', 'islam', 'kristen', 'katolik', 'hindu', 'budha', 'konghucu',
  'belum', 'kawin', 'cerai', 'hidup', 'wni', 'wna',
]);

/**
 * Levenshtein distance for fuzzy matching
 */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp = new Array(a.length + 1).fill(0).map(() => new Array(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return dp[a.length][b.length];
}

/**
 * Spell correct a single word against the dictionary
 */
export function spellCorrectWord(word: string, maxDistance: number = 2): { corrected: string; wasCorrected: boolean; distance: number } {
  const lower = word.toLowerCase();

  // Already in dictionary
  if (INDONESIAN_CORE_DICTIONARY.has(lower)) {
    return { corrected: word, wasCorrected: false, distance: 0 };
  }

  // Numbers and short tokens - don't correct
  if (/^\d+$/.test(word) || word.length <= 2) {
    return { corrected: word, wasCorrected: false, distance: 0 };
  }

  let bestMatch = word;
  let bestDistance = maxDistance + 1;

  for (const dictWord of INDONESIAN_CORE_DICTIONARY) {
    // Quick length filter
    if (Math.abs(dictWord.length - lower.length) > maxDistance) continue;

    const dist = levenshteinDistance(lower, dictWord);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = dictWord;
      if (dist === 1) break; // Early exit for distance 1
    }
  }

  return {
    corrected: bestDistance <= maxDistance ? bestMatch : word,
    wasCorrected: bestDistance <= maxDistance,
    distance: bestDistance,
  };
}

/**
 * Apply spell correction preserving original case
 */
export function applySpellCorrection(word: string): { text: string; wasCorrected: boolean; distance: number } {
  if (/^\d+$/.test(word)) return { text: word, wasCorrected: false, distance: 0 };

  const { corrected, wasCorrected, distance } = spellCorrectWord(word);
  if (!wasCorrected) return { text: word, wasCorrected: false, distance };

  // Preserve case pattern
  if (word === word.toUpperCase()) return { text: corrected.toUpperCase(), wasCorrected: true, distance };
  if (word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase()) {
    return { text: corrected[0].toUpperCase() + corrected.slice(1), wasCorrected: true, distance };
  }
  return { text: corrected, wasCorrected: true, distance };
}

/**
 * Batch spell check an array of words
 */
export function spellCheckWords(words: string[]): Array<{ original: string; corrected: string; wasCorrected: boolean; distance: number }> {
  return words.map(w => {
    const result = applySpellCorrection(w);
    return { original: w, corrected: result.text, wasCorrected: result.wasCorrected, distance: result.distance };
  });
}

/**
 * Check if a word is likely a valid Indonesian word (in dictionary or close match)
 */
export function isValidIndonesianWord(word: string, maxDistance: number = 2): boolean {
  if (/^\d+$/.test(word) || word.length <= 2) return true;
  const lower = word.toLowerCase();
  if (INDONESIAN_CORE_DICTIONARY.has(lower)) return true;

  for (const dictWord of INDONESIAN_CORE_DICTIONARY) {
    if (Math.abs(dictWord.length - lower.length) > maxDistance) continue;
    const a = lower;
    const b = dictWord;
    const dp = new Array(a.length + 1).fill(0).map(() => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    if (dp[a.length][b.length] <= maxDistance) return true;
  }
  return false;
}

/**
 * Get all dictionary words (for debugging/export)
 */
export function getDictionaryWords(): string[] {
  return Array.from(INDONESIAN_CORE_DICTIONARY).sort();
}

/**
 * Add custom words to dictionary (for user-specific terms)
 */
export function addToDictionary(words: string | string[]): void {
  const wordArray = Array.isArray(words) ? words : [words];
  for (const w of wordArray) {
    INDONESIAN_CORE_DICTIONARY.add(w.toLowerCase());
  }
}