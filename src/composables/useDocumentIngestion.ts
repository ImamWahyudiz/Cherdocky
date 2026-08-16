import { ref } from 'vue';
import { processDocument, type SpatialWord } from '~/utils/ocrEngine';
import {
  extractAllPdfText,
  inspectPdfContent,
  rasterizeAllPdfPages,
} from '~/utils/pdfExtractor';
import type { DetectedRegion } from '~/utils/faceDetector';

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

const RASTER_SCALE = 2;

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

  // State for PDF choice modal
  const showPdfChoiceModal = ref(false);
  const pendingPdfFile = ref<File | null>(null);

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
          label: `Halaman ${pageNum}`,
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
      alert('Gagal mengekstrak teks PDF: ' + (error?.message || error));
    } finally {
      isProcessing.value = false;
    }
  };

  const processPdfAsOcr = async (pdfFile: File) => {
    documentType.value = 'image-pdf';
    isProcessing.value = true;
    progress.value = 0.05;

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

        const pageWords = await processDocument(rPage.blob!, (p) => {
          const stepBase = 0.4 + (i / rasterPages.length) * 0.55;
          const stepSize = 0.55 / rasterPages.length;
          progress.value = Math.min(0.98, stepBase + p * stepSize);
        });

        const taggedWords = pageWords.map((w) => ({
          ...w,
          pageIndex: pageNum,
        }));
        allWords.push(...taggedWords);

        newPages.push({
          id: `pdf-page-${pageNum}`,
          pageIndex: pageNum,
          label: `Halaman ${pageNum}`,
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
      alert('Gagal menjalankan OCR pada PDF: ' + (error?.message || error));
    } finally {
      isProcessing.value = false;
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

    try {
      cleanupPageUrls();
      const allWords: SpatialWord[] = [];
      const newPages: DocumentPageItem[] = [];

      for (let i = 0; i < imageFiles.length; i++) {
        const imgFile = imageFiles[i];
        const pageNum = i + 1;

        // Preload image dimensions safely
        const imgMeta = await getImageDimensions(imgFile);

        const pageWords = await processDocument(imgFile, (p) => {
          const stepBase = (i / imageFiles.length) * 0.9;
          const stepSize = 0.9 / imageFiles.length;
          progress.value = Math.min(0.95, stepBase + p * stepSize);
        });

        const taggedWords = pageWords.map((w) => ({
          ...w,
          pageIndex: pageNum,
        }));
        allWords.push(...taggedWords);

        newPages.push({
          id: `img-${pageNum}-${Date.now()}`,
          pageIndex: pageNum,
          label: imageFiles.length > 1 ? `Gambar ${pageNum} (${imgFile.name})` : imgFile.name,
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
      alert('Gagal memproses gambar: ' + (error?.message || error));
    } finally {
      isProcessing.value = false;
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
          label: `Gambar ${pageNum} (${imgFile.name})`,
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
      alert('Gagal menambahkan gambar: ' + (error?.message || error));
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
