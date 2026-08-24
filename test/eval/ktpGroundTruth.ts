import fs from 'node:fs';

/**
 * Ground-truth utilities for scoring KTP field detection against YOLO-format
 * bounding-box annotations (see `test/Generated E-ktp`).
 *
 * Labels: one line per box — `<classId> <cx> <cy> <w> <h>` (normalized 0..1,
 * center-origin). Classes listed in `classes.txt`.
 */

export const KTP_CLASSES = [
  'Provinsi',
  'Kabupaten/Kota',
  'NIK',
  'Nama',
  'Tempat Tanggal Lahir',
  'Jenis Kelamin',
  'Alamat',
  'RT/RW',
  'Kelurahan/Desa',
  'Kecamatan',
  'Agama',
  'Status Perkawinan',
  'Pekerjaan',
  'Kewarganegaraan',
  'Berlaku Hingga',
  'Gol. Darah',
  'Foto',
  'Kota Dibuat',
  'Tanggal KTP Dikeluarkan',
] as const;

export interface FieldBox {
  classId: number;
  className: string;
  /** pixel coords, top-left origin */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WordBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  piiTypes: Set<string>;
  autoRedact: boolean;
}

/** YOLO class id -> PII match types that count as detecting that field. */
export const CLASS_TO_PII_TYPES: Record<number, string[]> = {
  2: ['nik'],
  3: ['name'],
  4: ['ttl', 'dob', 'date'],
  6: ['address'],
  // Date-bearing fields: detecting these is correct behavior on an ID card,
  // so they must not inflate falseAutoRate.
  14: ['date', 'dob'], // Berlaku Hingga
  18: ['date', 'dob'], // Tanggal KTP Dikeluarkan
};

/** Classes with a usable text detector today — only these enter recall scoring. */
export const SCORED_CLASS_IDS = Object.keys(CLASS_TO_PII_TYPES).map(Number);

export function parseYoloLabel(labelPath: string, imgW: number, imgH: number): FieldBox[] {
  const raw = fs.readFileSync(labelPath, 'utf8');
  const boxes: FieldBox[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const [cls, cx, cy, bw, bh] = t.split(/\s+/).map(Number);
    if ([cls, cx, cy, bw, bh].some((v) => Number.isNaN(v))) continue;
    boxes.push({
      classId: cls,
      className: KTP_CLASSES[cls] ?? `class-${cls}`,
      x0: (cx - bw / 2) * imgW,
      y0: (cy - bh / 2) * imgH,
      x1: (cx + bw / 2) * imgW,
      y1: (cy + bh / 2) * imgH,
    });
  }
  return boxes;
}

function pointInBox(px: number, py: number, b: FieldBox): boolean {
  return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
}

/**
 * A word "covers" a GT field when its center falls inside the field box and
 * its PII type is accepted for that field class.
 */
export function findCoveredField(word: WordBox, fields: FieldBox[]): FieldBox | null {
  const cx = word.x + word.width / 2;
  const cy = word.y + word.height / 2;
  for (const f of fields) {
    const accepted = CLASS_TO_PII_TYPES[f.classId];
    if (!accepted || accepted.length === 0) continue;
    if (!pointInBox(cx, cy, f)) continue;
    if (word.piiTypes.size === 0) continue;
    for (const t of accepted) {
      if (word.piiTypes.has(t)) return f;
    }
  }
  return null;
}

export interface FieldScore {
  className: string;
  gtCount: number;
  detectedCount: number;
  recall: number;
}

export interface RegionMetrics {
  images: number;
  fields: Record<string, FieldScore>;
  /** Fields-with-detector coverage across all scored images */
  overallRecall: number;
  /** Share of auto-redacted words that landed OUTSIDE every GT PII field */
  falseAutoRate: number;
  autoWordCount: number;
}

export function scoreImages(
  runs: { fields: FieldBox[]; words: WordBox[] }[],
): RegionMetrics {
  const gtByClass = new Map<number, number>();
  const instanceHits = new Map<number, number>();
  let outsideAuto = 0;
  let autoTotal = 0;

  for (const run of runs) {
    for (const f of run.fields) {
      if (!CLASS_TO_PII_TYPES[f.classId]) continue;
      gtByClass.set(f.classId, (gtByClass.get(f.classId) ?? 0) + 1);
    }
    const hitFields = new Set<FieldBox>();
    for (const w of run.words) {
      const covered = findCoveredField(w, run.fields);
      if (covered) hitFields.add(covered);
      if (w.autoRedact) {
        autoTotal++;
        if (!covered && !inAnyPiiField(w, run.fields)) outsideAuto++;
      }
    }
    for (const f of hitFields) {
      instanceHits.set(f.classId, (instanceHits.get(f.classId) ?? 0) + 1);
    }
  }

  const fields: Record<string, FieldScore> = {};
  let instGt = 0;
  let instHit = 0;
  for (const [classId, total] of [...gtByClass.entries()].sort((a, b) => a[0] - b[0])) {
    const hits = Math.min(instanceHits.get(classId) ?? 0, total);
    const name = KTP_CLASSES[classId];
    fields[name] = { className: name, gtCount: total, detectedCount: hits, recall: total > 0 ? hits / total : 0 };
    instGt += total;
    instHit += hits;
  }

  return {
    images: runs.length,
    fields,
    overallRecall: instGt > 0 ? instHit / instGt : 0,
    falseAutoRate: autoTotal > 0 ? outsideAuto / autoTotal : 0,
    autoWordCount: autoTotal,
  };
}

function inAnyPiiField(w: WordBox, fields: FieldBox[]): boolean {
  const cx = w.x + w.width / 2;
  const cy = w.y + w.height / 2;
  return fields.some((f) => CLASS_TO_PII_TYPES[f.classId] && pointInBox(cx, cy, f));
}
