/**
 * OCR Performance Metrics Collection
 * Tracks processing time, accuracy, and quality metrics for monitoring
 */

export interface OCRMetricsInput {
  documentType: string;
  quality: { score: number; contrast: number; noise: number; skew: number; brightness: number; resolution: number };
  preprocessingTime: number;
  ocrTime: number;
  accuracy: number;
  memoryUsage: number;
}

export interface OCRMetricsSummary {
  totalDocuments: number;
  avgPreprocessingTime: number;
  avgOCRTime: number;
  avgTotalTime: number;
  avgAccuracy: number;
  avgMemoryUsage: number;
  byDocumentType: Record<string, {
    count: number;
    avgAccuracy: number;
    avgPreprocessingTime: number;
    avgOCRTime: number;
  }>;
  qualityDistribution: {
    excellent: number;
    good: number;
    poor: number;
    veryPoor: number;
  };
}

/**
 * In-memory metrics storage (can be extended to persist to localStorage or send to analytics)
 */
const metricsStore: OCRMetricsInput[] = [];

/**
 * Record OCR processing metrics
 */
export async function recordOCRMetrics(input: OCRMetricsInput): Promise<void> {
  metricsStore.push(input);

  // Keep only last 1000 entries to prevent memory growth
  if (metricsStore.length > 1000) {
    metricsStore.shift();
  }

  // Log summary every 10 documents
  if (metricsStore.length % 10 === 0) {
    console.log('[OCR Metrics]', getMetricsSummary());
  }
}

/**
 * Get metrics summary for display/debugging
 */
export function getMetricsSummary(): OCRMetricsSummary {
  if (metricsStore.length === 0) {
    return {
      totalDocuments: 0,
      avgPreprocessingTime: 0,
      avgOCRTime: 0,
      avgTotalTime: 0,
      avgAccuracy: 0,
      avgMemoryUsage: 0,
      byDocumentType: {},
      qualityDistribution: { excellent: 0, good: 0, poor: 0, veryPoor: 0 },
    };
  }

  const total = metricsStore.length;
  const byDocumentType: Record<string, { count: number; sumAccuracy: number; sumPreTime: number; sumOCRTime: number }> = {};
  let qualityCounts = { excellent: 0, good: 0, poor: 0, veryPoor: 0 };

  let sumPreTime = 0;
  let sumOCRTime = 0;
  let sumAccuracy = 0;
  let sumMemory = 0;

  for (const m of metricsStore) {
    sumPreTime += m.preprocessingTime;
    sumOCRTime += m.ocrTime;
    sumAccuracy += m.accuracy;
    sumMemory += m.memoryUsage;

    const q = m.quality.score;
    if (q > 0.85) qualityCounts.excellent++;
    else if (q > 0.6) qualityCounts.good++;
    else if (q > 0.35) qualityCounts.poor++;
    else qualityCounts.veryPoor++;

    const dt = m.documentType;
    if (!byDocumentType[dt]) {
      byDocumentType[dt] = { count: 0, sumAccuracy: 0, sumPreTime: 0, sumOCRTime: 0 };
    }
    byDocumentType[dt].count++;
    byDocumentType[dt].sumAccuracy += m.accuracy;
    byDocumentType[dt].sumPreTime += m.preprocessingTime;
    byDocumentType[dt].sumOCRTime += m.ocrTime;
  }

  const byTypeSummary: Record<string, { count: number; avgAccuracy: number; avgPreprocessingTime: number; avgOCRTime: number }> = {};
  for (const [dt, data] of Object.entries(byDocumentType)) {
    byTypeSummary[dt] = {
      count: data.count,
      avgAccuracy: data.sumAccuracy / data.count,
      avgPreprocessingTime: data.sumPreTime / data.count,
      avgOCRTime: data.sumOCRTime / data.count,
    };
  }

  return {
    totalDocuments: total,
    avgPreprocessingTime: sumPreTime / total,
    avgOCRTime: sumOCRTime / total,
    avgTotalTime: (sumPreTime + sumOCRTime) / total,
    avgAccuracy: sumAccuracy / total,
    avgMemoryUsage: sumMemory / total,
    byDocumentType: byTypeSummary,
    qualityDistribution: qualityCounts,
  };
}

/**
 * Get metrics for a specific document type
 */
export function getMetricsByType(documentType: string): OCRMetricsInput[] {
  return metricsStore.filter(m => m.documentType === documentType);
}

/**
 * Clear metrics store (for testing)
 */
export function clearMetrics(): void {
  metricsStore.length = 0;
}

/**
 * Export metrics as JSON for export/debugging
 */
export function exportMetrics(): string {
  return JSON.stringify({
    summary: getMetricsSummary(),
    raw: metricsStore,
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

/**
 * Import metrics from JSON (for restoring session)
 */
export function importMetrics(json: string): void {
  try {
    const data = JSON.parse(json);
    if (data.raw && Array.isArray(data.raw)) {
      metricsStore.length = 0;
      metricsStore.push(...data.raw);
    }
  } catch (e) {
    console.warn('Failed to import metrics:', e);
  }
}