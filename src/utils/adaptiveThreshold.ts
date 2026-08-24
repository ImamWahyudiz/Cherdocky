export interface ConfidenceThresholds {
  min: number;
  good: number;
  strong: number;
}

const BASE_THRESHOLDS: Record<string, ConfidenceThresholds> = {
  excellent: { min: 25, good: 35, strong: 45 },
  good: { min: 35, good: 45, strong: 60 },
  poor: { min: 45, good: 60, strong: 80 },
  veryPoor: { min: 60, good: 75, strong: 100 },
};

const DOC_ADJUSTMENTS: Record<string, { min: number; good: number; strong: number }> = {
  'ktp-photo': { min: 10, good: 15, strong: 20 },
  'id-card': { min: 5, good: 10, strong: 15 },
  'face-photo': { min: 5, good: 10, strong: 15 },
  'scanned-pdf': { min: 0, good: 0, strong: 0 },
  'unknown': { min: 0, good: 0, strong: 0 },
};

function getQualityCategory(score: number): string {
  if (score > 0.85) return 'excellent';
  if (score > 0.6) return 'good';
  if (score > 0.35) return 'poor';
  return 'veryPoor';
}

export function getConfidenceThresholds(
  quality: { score: number; contrast: number; noise: number },
  docType: string,
): ConfidenceThresholds {
  const qualityKey = getQualityCategory(quality.score);
  const base = BASE_THRESHOLDS[qualityKey] || BASE_THRESHOLDS.good;
  const adj = DOC_ADJUSTMENTS[docType] || { min: 0, good: 0, strong: 0 };

  return {
    min: Math.min(100, base.min + adj.min),
    good: Math.min(100, base.good + adj.good),
    strong: Math.min(100, base.strong + adj.strong),
  };
}

export function getWordThresholdCategory(text: string): 'min' | 'good' | 'strong' {
  const isNumberOrDate =
    /^\d{2,16}$/.test(text) || /\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}/.test(text);
  const isShort = text.length <= 2;
  const isCleanDelimiter = text === ':' || text === '=';

  if (isNumberOrDate) return 'min';
  if (isCleanDelimiter) return 'min';
  if (isShort) return 'strong';
  return 'good';
}

export function passesThreshold(
  text: string,
  conf: number,
  thresholds: ConfidenceThresholds,
): boolean {
  const category = getWordThresholdCategory(text);
  return conf >= thresholds[category];
}