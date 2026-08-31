import { ref, onBeforeUnmount } from 'vue';
import { processDocument, type SpatialWord } from '~/utils/ocrEngine';
import {
  extractAllPdfText,
  inspectPdfContent,
  rasterizeAllPdfPages,
} from '~/utils/pdfExtractor';
import type { DetectedRegion } from '~/utils/faceDetector';
import { createOcrEngine, clearEngineCache } from '~/utils/ocr/engineFactory';
import { useToast } from '~/composables/useToast';

export type DocumentType = 'image' | 'text-pdf' | 'image-pdf';

export interface DocumentPageItem {
  id: string;
  pageIndex: number;
  label: string;
  type: 'pdf-page' | 'image';
  sourceBlob?: Blob | File;
  previewUrl: string;
  width: number;
  height: number;
  rotation: number;
  words: SpatialWord[];
  manualRegions: DetectedRegion[];
  faceRegions: DetectedRegion[];
}

export type IngestionPhase = 'model-load' | 'preprocess' | 'detect' | 'recognize' | 'post';

const RASTER_SCALE = 2;
const DESKTOP_TIME_BUDGET_MS = 8000;
const MOBILE_TIME_BUDGET_MS = 20000;

function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mem = (navigator as any).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  if (typeof mem === 'number' && mem < 4) return true;
  if (typeof cores === 'number' && cores < 4) return true;
  return false;
}

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function getTimeBudgetMs(): number {
  return isMobileDevice() ? MOBILE_TIME_BUDGET_MS : DESKTOP_TIME_BUDGET_MS;
}

function getImageDimensions(fileOrUrl: Blob | string): Promise<{ width: number; height: number; url: string }> {
  return new Promise((resolve) => {
    const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width || 800,
        height: img.naturalHeight || img.height || 1000,
        url,
      });
    };
    img.onerror = () => {
      resolve({
        width: 800,
        height: 1000,
        url,
      });
    };
    img.src = url;
  });
}

export const useDocumentIngestion = () => {
  const file = ref<File | null>(null);
  const uploadedFiles = ref<File[]>([]);
  const fileUrl = ref<string | null>(null);
  const isProcessing = ref(false);
  const progress = ref(0);
  const result = ref<SpatialWord[]>([]);
  const isVerified = ref(false);
  const documentType = ref<DocumentType>('image');
  const detectedRegions = ref<DetectedRegion[]>([]);
  const pages = ref<DocumentPageItem[]>([]);
  const processingPhase = ref<IngestionPhase>('model-load');

  // State for PDF choice modal
  const showPdfChoiceModal = ref(false);
  const pendingPdfFile = ref<File | null>(null);

  const toast = useToast();
  let timeBudgetTimer: ReturnType<typeof setTimeout> | null = null;
  let timeBudgetWarningShown = false;

  // B5: Detect low-end device for engine default
  const deviceIsLowEnd = isLowEndDevice();
  if (deviceIsLowEnd) {
    console.warn('[Ingestion] Low-end device detected, consider Tesseract for better performance');
  }

  // C3: Memory pressure handler
  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'hidden') {
      console.warn('[Ingestion] Tab hidden, clearing engine cache to free memory');
      clearEngineCache();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (timeBudgetTimer) {
      clearTimeout(timeBudgetTimer);
      timeBudgetTimer = null;
    }
  });

  // B1: Preload engine on file drop (fire-and-forget)
  function preloadEngine(): void {
    createOcrEngine().catch(() => {}); // no-op on failure
  }

  // B3: Time budget guard
  function startTimeBudgetGuard(onWarn: () => void): void {
    if (timeBudgetTimer) clearTimeout(timeBudgetTimer);
    timeBudgetWarningShown = false;
    const budget = getTimeBudgetMs();
    timeBudgetTimer = setTimeout(() => {
      if (isProcessing.value && !timeBudgetWarningShown) {
        timeBudgetWarningShown = true;
        onWarn();
      }
    }, budget);
  }

  function clearTimeBudgetGuard(): void {
    if (timeBudgetTimer) {
      clearTimeout(timeBudgetTimer);
      timeBudgetTimer = null;
    }
  }

  const cleanupPageUrls = () => {
    pages.value.forEach((p) => {
      if (p.previewUrl && p.previewUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch (_) {}
      }
    });
    pages.value = [];
  };

  const processPdfAsText = async (pdfFile: File) => {
    documentType.value = 'text-pdf';
    isProcessing.value = true;
    progress.value = 0.05;

    try {
      const { words: extractedWords } = await extractAllPdfText(pdfFile, (p) => {
        progress.value = 0.05 + p * 0.45;
      });

      const rasterPages = await rasterizeAllPdfPages(pdfFile, 1.5, (p) => {
        progress.value = 0.5 + p * 0.45;
      });

      cleanupPageUrls();

      const newPages: DocumentPageItem[] = [];
      for (let i = 0; i < rasterPages.length; i++) {
        const rPage = rasterPages[i];
        const pageNum = rPage.pageNum;
        const pageWords = extractedWords.filter((w) => (w.pageIndex || 1) === pageNum);

        newPages.push({
          id: `pdf-page-${pageNum}`,
          pageIndex: pageNum,
          label: `Page ${pageNum}`,
          type: 'pdf-page',
          sourceBlob: rPage.blob,
          previewUrl: URL.createObjectURL(rPage.blob || new Blob([])),
          width: rPage.width,
          height: rPage.height,
          rotation: 0,
          words: pageWords,
          manualRegions: [],
          faceRegions: [],
        });
      }

      pages.value = newPages;
      result.value = extractedWords;
      if (newPages.length > 0) {
        fileUrl.value = newPages[0].previewUrl;
      }
      progress.value = 1;
    } catch (error: any) {
      console.error('Process PDF as text error:', error);
      alert('Failed to extract PDF text: ' + (error?.message || error));
    } finally {
      isProcessing.value = false;
    }
  };

  const processPdfAsOcr = async (pdfFile: File) => {
    documentType.value = 'image-pdf';
    isProcessing.value = true;
    progress.value = 0.05;
    processingPhase.value = 'model-load';

    startTimeBudgetGuard(() => {
      toast.info('Still working… this may take a moment.', { duration: 5000 });
    });

    try {
      const rasterPages = await rasterizeAllPdfPages(pdfFile, RASTER_SCALE, (p) => {
        progress.value = 0.05 + p * 0.35;
      });

      cleanupPageUrls();

      const allWords: SpatialWord[] = [];
      const newPages: DocumentPageItem[] = [];

      for (let i = 0; i < rasterPages.length; i++) {
        const rPage = rasterPages[i];
        const pageNum = rPage.pageNum;

        const pageWords = await processDocument(rPage.blob!, (p, phase) => {
          const stepBase = 0.4 + (i / rasterPages.length) * 0.55;
          const stepSize = 0.55 / rasterPages.length;
          progress.value = Math.min(0.98, stepBase + p * stepSize);
          if (phase) processingPhase.value = phase as IngestionPhase;
        });

        const taggedWords = pageWords.map((w) => ({
          ...w,
          pageIndex: pageNum,
        }));
        allWords.push(...taggedWords);

        newPages.push({
          id: `pdf-page-${pageNum}`,
          pageIndex: pageNum,
          label: `Page ${pageNum}`,
          type: 'pdf-page',
          sourceBlob: rPage.blob,
          previewUrl: URL.createObjectURL(rPage.blob || new Blob([])),
          width: rPage.width,
          height: rPage.height,
          rotation: 0,
          words: taggedWords,
          manualRegions: [],
          faceRegions: [],
        });
      }

      pages.value = newPages;
      result.value = allWords;
      if (newPages.length > 0) {
        fileUrl.value = newPages[0].previewUrl;
      }
      progress.value = 1;
    } catch (error: any) {
      console.error('Process PDF as OCR error:', error);
      const errMsg = error?.message || String(error);
      const isMemoryError = /out of memory|allocation|oom|compile/i.test(errMsg);
      if (isMemoryError) {
        console.warn('[Ingestion] Memory/compile error detected, clearing engine cache for fallback');
        clearEngineCache();
      }
      toast.error('Failed to run OCR on PDF: ' + errMsg, { duration: 5000 });
    } finally {
      isProcessing.value = false;
      clearTimeBudgetGuard();
    }
  };

  const handlePdfChoice = async (choice: 'text-pdf' | 'image-pdf') => {
    showPdfChoiceModal.value = false;
    if (!pendingPdfFile.value) return;
    const target = pendingPdfFile.value;
    pendingPdfFile.value = null;

    if (choice === 'text-pdf') {
      await processPdfAsText(target);
    } else {
      await processPdfAsOcr(target);
    }
  };

  const processImages = async (imageFiles: File[]) => {
    documentType.value = 'image';
    isProcessing.value = true;
    progress.value = 0.05;
    processingPhase.value = 'model-load';

    startTimeBudgetGuard(() => {
      toast.info('Still working… this may take a moment.', { duration: 5000 });
    });

    try {
      cleanupPageUrls();
      const allWords: SpatialWord[] = [];
      const newPages: DocumentPageItem[] = [];

      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const pageNum = i + 1;

        // Preload image dimensions safely
        const imgMeta = await getImageDimensions(imgFile);

        const pageWords = await processDocument(imgFile, (p, phase) => {
          const stepBase = (i / imageFiles.length) * 0.9;
          const stepSize = 0.9 / imageFiles.length;
          progress.value = Math.min(0.95, stepBase + p * stepSize);
          if (phase) processingPhase.value = phase as IngestionPhase;
        });

        const taggedWords = pageWords.map((w) => ({
          ...w,
          pageIndex: pageNum,
        }));
        allWords.push(...taggedWords);

        newPages.push({
          id: `img-${pageNum}-${Date.now()}`,
          pageIndex: pageNum,
          label: imageFiles.length > 1 ? `Image ${pageNum} (${imgFile.name})` : imgFile.name,
          type: 'image',
          sourceBlob: imgFile,
          previewUrl: imgMeta.url,
          width: imgMeta.width,
          height: imgMeta.height,
          rotation: 0,
          words: taggedWords,
          manualRegions: [],
          faceRegions: [],
        });
      }

      pages.value = newPages;
      result.value = allWords;
      if (newPages.length > 0) {
        fileUrl.value = newPages[0].previewUrl;
      }
      progress.value = 1;
    } catch (error: any) {
      console.error('Process images error:', error);
      // C2: Error boundary — on OOM/compile errors, terminate engine and fall back
      const errMsg = error?.message || String(error);
      const isMemoryError = /out of memory|allocation|oom|compile/i.test(errMsg);
      if (isMemoryError) {
        console.warn('[Ingestion] Memory/compile error detected, clearing engine cache for fallback');
        clearEngineCache();
      }
      toast.error('Failed to process image: ' + errMsg, { duration: 5000 });
    } finally {
      isProcessing.value = false;
      clearTimeBudgetGuard();
    }
  };

  const addMoreImages = async (imageFiles: File[]) => {
    if (imageFiles.length === 0) return;
    isProcessing.value = true;
    progress.value = 0.1;
    try {
      const startIndex = pages.value.length;
      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const pageNum = startIndex + i + 1;

        const imgMeta = await getImageDimensions(imgFile);
        const pageWords = await processDocument(imgFile);
        const taggedWords = pageWords.map((w) => ({
          ...w,
          pageIndex: pageNum,
        }));

        pages.value.push({
          id: `img-${pageNum}-${Date.now()}`,
          pageIndex: pageNum,
          label: `Image ${pageNum} (${imgFile.name})`,
          type: 'image',
          sourceBlob: imgFile,
          previewUrl: imgMeta.url,
          width: imgMeta.width,
          height: imgMeta.height,
          rotation: 0,
          words: taggedWords,
          manualRegions: [],
          faceRegions: [],
        });

        result.value.push(...taggedWords);
      }
      progress.value = 1;
    } catch (error: any) {
      console.error('Add more images error:', error);
      alert('Failed to add images: ' + (error?.message || error));
    } finally {
      isProcessing.value = false;
    }
  };

  const handleFileUpload = async (inputFiles: File | File[]) => {
    const rawList = Array.isArray(inputFiles) ? inputFiles : [inputFiles];
    const validList = rawList.filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
    );

    if (validList.length === 0) return;

    // B1: Preload engine (fire-and-forget) while user reviews the file
    preloadEngine();

    uploadedFiles.value = validList;
    file.value = validList[0];
    isVerified.value = false;
    result.value = [];
    detectedRegions.value = [];

    // Check if the primary file is a PDF
    if (validList[0].type === 'application/pdf') {
      const pdfFile = validList[0];
      try {
        const inspection = await inspectPdfContent(pdfFile);

        if (inspection.isTextDominant) {
          // Native text-dominant PDF -> Fast PDF reader directly!
          await processPdfAsText(pdfFile);
        } else {
          // Scanned / Image-heavy PDF -> Prompt user to choose PDF reader or OCR
          pendingPdfFile.value = pdfFile;
          showPdfChoiceModal.value = true;
        }
      } catch (err) {
        console.warn('PDF inspection notice, offering choice modal:', err);
        pendingPdfFile.value = pdfFile;
        showPdfChoiceModal.value = true;
      }
    } else {
      // Images list
      await processImages(validList);
    }
  };

  return {
    file,
    uploadedFiles,
    fileUrl,
    pages,
    isProcessing,
    progress,
    result,
    isVerified,
    documentType,
    detectedRegions,
    showPdfChoiceModal,
    handlePdfChoice,
    handleFileUpload,
    addMoreImages,
    cleanupPageUrls,
  };
};
