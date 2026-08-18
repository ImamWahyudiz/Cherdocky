<script setup lang="ts">
import { ref } from 'vue';
import { useDropZone } from '@vueuse/core';
import {
  redactImage,
  redactPdf,
  exportImagesAsMergedPdf,
  createZipBlob,
  type QualityPreset,
} from '~/utils/redactor';
import type { PIIType } from '~/utils/piiDetector';
import DocumentVerification from '~/components/DocumentVerification.vue';
import ExportSuccessPage, { type RedactionExportStats } from '~/components/ExportSuccessPage.vue';
import type { SpatialWord } from '~/utils/ocrEngine';
import type { DetectedRegion } from '~/utils/faceDetector';
import { useDocumentIngestion, type DocumentPageItem } from '~/composables/useDocumentIngestion';
import {
  UploadCloud,
  Loader2,
  FileText,
  Scan,
  Sparkles,
} from 'lucide-vue-next';

const {
  file,
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
  cleanupPageUrls,
} = useDocumentIngestion();

const isRedacting = ref(false);
const activePiiTypes = ref<PIIType[]>([]);
const customPiiText = ref('');
const redactionRegions = ref<DetectedRegion[]>([]);
const selectedRedactionColor = ref('#000000');
const verifiedPages = ref<DocumentPageItem[]>([]);

// State for Success / Download Page
const showSuccessPage = ref(false);
const exportedBlob = ref<Blob | null>(null);
const exportedFilename = ref('dokumen_redacted.pdf');
const exportedFileSize = ref(0);
const originalFileSize = ref(0);
const exportStats = ref<RedactionExportStats>({
  documentType: 'text-pdf',
  totalPages: 1,
  totalRedactedWords: 0,
  totalRedactedFaces: 0,
  totalManualRegions: 0,
  redactionColor: '#000000',
  redactedWordsList: [],
});

const handleVerificationConfirm = async (data: {
  pages: DocumentPageItem[];
  words: SpatialWord[];
  piiTypes: PIIType[];
  customText: string;
  regions: DetectedRegion[];
  redactionColor?: string;
}) => {
  verifiedPages.value = data.pages;
  result.value = data.words;
  activePiiTypes.value = data.piiTypes;
  customPiiText.value = data.customText;
  redactionRegions.value = data.regions;
  selectedRedactionColor.value = data.redactionColor || '#000000';

  // Compute original file size
  let origSize = file.value?.size || 0;
  if (origSize === 0) {
    origSize = data.pages.reduce((acc, p) => acc + (p.sourceBlob?.size || 0), 0);
  }
  originalFileSize.value = origSize;

  // Compute redacted words list
  const redactedWords = (data.words || [])
    .filter((w) => (w as any).forceRedact === true)
    .map((w) => w.text);

  // Compute faces vs manual regions
  const faceCount = (data.regions || []).filter((r) => (r as any).score !== undefined).length;
  const manualCount = (data.regions || []).filter((r) => (r as any).score === undefined).length;

  exportStats.value = {
    documentType: documentType.value,
    totalPages: data.pages.length || 1,
    totalRedactedWords: redactedWords.length,
    totalRedactedFaces: faceCount,
    totalManualRegions: manualCount,
    redactionColor: selectedRedactionColor.value,
    redactedWordsList: redactedWords,
  };

  // Close verification modal
  isVerified.value = true;

  // Execute redaction pipeline WITHOUT auto-download (autoDownload = false)
  if (documentType.value === 'image' && verifiedPages.value.length > 1) {
    await exportMultiImagesAsMergedPdfChoice('optimal', false);
  } else {
    await executeDirectRedaction('optimal', false);
  }
};

const handleVerificationCancel = () => {
  resetToHome();
};

const resetToHome = () => {
  showSuccessPage.value = false;
  exportedBlob.value = null;
  exportedFilename.value = '';
  exportedFileSize.value = 0;
  originalFileSize.value = 0;
  result.value = [];
  file.value = null;
  fileUrl.value = null;
  isVerified.value = false;
  redactionRegions.value = [];
  selectedRedactionColor.value = '#000000';
  verifiedPages.value = [];
  cleanupPageUrls();
};

const handleEditAgain = () => {
  showSuccessPage.value = false;
  isVerified.value = false;
};

const triggerDownloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a') as HTMLAnchorElement;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const executeDirectRedaction = async (
  qualityPreset: QualityPreset = 'optimal',
  autoDownload = false,
  forcedFormat?: 'image/jpeg' | 'image/png',
  customFilename?: string
) => {
  isRedacting.value = true;
  try {
    if (documentType.value === 'text-pdf' || documentType.value === 'image-pdf') {
      if (!file.value) return;
      const redactedBlob = await redactPdf(
        file.value,
        result.value,
        activePiiTypes.value,
        documentType.value,
        customPiiText.value,
        redactionRegions.value,
        selectedRedactionColor.value,
        qualityPreset
      );

      const fname = customFilename || 'redacted-pdf.pdf';
      exportedBlob.value = redactedBlob;
      exportedFilename.value = fname;
      exportedFileSize.value = redactedBlob.size;
      showSuccessPage.value = true;

      if (autoDownload) {
        triggerDownloadBlob(redactedBlob, fname);
      }
    } else {
      // Single image
      const targetPage = verifiedPages.value[0];
      const source = targetPage?.sourceBlob || file.value!;
      const pageWords = result.value.filter((w) => (w.pageIndex || 1) === (targetPage?.pageIndex || 1));
      const pageRegions = redactionRegions.value.filter(
        (r) => ((r as any).pageIndex || 1) === (targetPage?.pageIndex || 1)
      );

      const redactedBlob = await redactImage(
        targetPage?.previewUrl || source,
        pageWords,
        activePiiTypes.value,
        customPiiText.value,
        pageRegions,
        selectedRedactionColor.value,
        qualityPreset,
        forcedFormat
      );

      const ext = forcedFormat === 'image/png' ? 'png' : 'jpg';
      const fname = customFilename || `redacted-image.${ext}`;
      exportedBlob.value = redactedBlob;
      exportedFilename.value = fname;
      exportedFileSize.value = redactedBlob.size;
      showSuccessPage.value = true;

      if (autoDownload) {
        triggerDownloadBlob(redactedBlob, fname);
      }
    }
  } catch (error) {
    console.error('Redaction failed:', error);
    alert('Gagal menyensor dokumen. Periksa konsol untuk informasi selengkapnya.');
  } finally {
    isRedacting.value = false;
  }
};

const exportSingleImageAsPdf = async (qualityPreset: QualityPreset = 'optimal', autoDownload = true, customFilename?: string) => {
  isRedacting.value = true;
  try {
    const targetPage = verifiedPages.value[0];
    const source = targetPage?.sourceBlob || file.value!;
    const pageWords = result.value.filter((w) => (w.pageIndex || 1) === (targetPage?.pageIndex || 1));
    const pageRegions = redactionRegions.value.filter(
      (r) => ((r as any).pageIndex || 1) === (targetPage?.pageIndex || 1)
    );

    const redactedBlob = await redactImage(
      targetPage?.previewUrl || source,
      pageWords,
      activePiiTypes.value,
      customPiiText.value,
      pageRegions,
      selectedRedactionColor.value,
      qualityPreset
    );

    const pdfBlob = await exportImagesAsMergedPdf(
      [{ blob: redactedBlob, width: targetPage?.width || 800, height: targetPage?.height || 1000 }],
      qualityPreset
    );

    const fname = customFilename || 'redacted-image.pdf';
    exportedBlob.value = pdfBlob;
    exportedFilename.value = fname;
    exportedFileSize.value = pdfBlob.size;

    if (autoDownload) {
      triggerDownloadBlob(pdfBlob, fname);
    }
  } catch (error) {
    console.error('Export single image to PDF failed:', error);
    alert('Gagal mengonversi gambar ke PDF.');
  } finally {
    isRedacting.value = false;
  }
};

const exportMultiImagesAsMergedPdfChoice = async (qualityPreset: QualityPreset = 'optimal', autoDownload = false, customFilename?: string) => {
  isRedacting.value = true;

  try {
    const redactedImagesList: { blob: Blob; width: number; height: number }[] = [];

    for (const page of verifiedPages.value) {
      const pageWords = result.value.filter((w) => (w.pageIndex || 1) === page.pageIndex);
      const pageRegions = redactionRegions.value.filter(
        (r) => ((r as any).pageIndex || 1) === page.pageIndex
      );

      const redactedBlob = await redactImage(
        page.previewUrl,
        pageWords,
        activePiiTypes.value,
        customPiiText.value,
        pageRegions,
        selectedRedactionColor.value,
        qualityPreset
      );

      redactedImagesList.push({
        blob: redactedBlob,
        width: page.width,
        height: page.height,
      });
    }

    const pdfBlob = await exportImagesAsMergedPdf(redactedImagesList, qualityPreset);
    const fname = customFilename || 'redacted-images.pdf';
    exportedBlob.value = pdfBlob;
    exportedFilename.value = fname;
    exportedFileSize.value = pdfBlob.size;
    showSuccessPage.value = true;

    if (autoDownload) {
      triggerDownloadBlob(pdfBlob, fname);
    }
  } catch (error) {
    console.error('Merged PDF export failed:', error);
    alert('Gagal menggabungkan gambar ke PDF.');
  } finally {
    isRedacting.value = false;
  }
};

const exportMultiImagesAsZipChoice = async (autoDownload = true, customFilename?: string) => {
  isRedacting.value = true;

  try {
    const zipFiles: { name: string; blob: Blob }[] = [];

    for (let i = 0; i < verifiedPages.value.length; i++) {
      const page = verifiedPages.value[i];
      const pageWords = result.value.filter((w) => (w.pageIndex || 1) === page.pageIndex);
      const pageRegions = redactionRegions.value.filter(
        (r) => ((r as any).pageIndex || 1) === page.pageIndex
      );

      const redactedBlob = await redactImage(
        page.previewUrl,
        pageWords,
        activePiiTypes.value,
        customPiiText.value,
        pageRegions,
        selectedRedactionColor.value,
        'optimal'
      );

      const filename = `redacted-image-${i + 1}.jpg`;
      zipFiles.push({ name: filename, blob: redactedBlob });
    }

    const zipBlob = await createZipBlob(zipFiles);
    const fname = customFilename || 'redacted-images.zip';
    exportedBlob.value = zipBlob;
    exportedFilename.value = fname;
    exportedFileSize.value = zipBlob.size;
    showSuccessPage.value = true;

    if (autoDownload) {
      triggerDownloadBlob(zipBlob, fname);
    }
  } catch (error) {
    console.error('ZIP export failed:', error);
    alert('Gagal membuat arsip ZIP.');
  } finally {
    isRedacting.value = false;
  }
};

const handleDownloadOption = async (payload: string | { option: string; customFilename?: string }) => {
  const option = typeof payload === 'string' ? payload : payload.option;
  const customName = typeof payload === 'object' ? payload.customFilename : undefined;

  switch (option) {
    case 'image-optimal':
      await executeDirectRedaction('optimal', true, 'image/jpeg', customName);
      break;
    case 'image-max':
      await executeDirectRedaction('max', true, 'image/png', customName);
      break;
    case 'single-pdf-optimal':
      await exportSingleImageAsPdf('optimal', true, customName);
      break;
    case 'multi-pdf-optimal':
      await exportMultiImagesAsMergedPdfChoice('optimal', true, customName);
      break;
    case 'multi-pdf-max':
      await exportMultiImagesAsMergedPdfChoice('max', true, customName);
      break;
    case 'multi-zip':
      await exportMultiImagesAsZipChoice(true, customName);
      break;
    case 'scanned-pdf-optimal':
      await executeDirectRedaction('optimal', true, undefined, customName);
      break;
    case 'scanned-pdf-max':
      await executeDirectRedaction('max', true, undefined, customName);
      break;
    default:
      if (exportedBlob.value) {
        triggerDownloadBlob(exportedBlob.value, customName || exportedFilename.value);
      }
      break;
  }
};

const handleDownloadDirect = (customFilename?: string) => {
  if (exportedBlob.value) {
    const finalName = customFilename || exportedFilename.value;
    triggerDownloadBlob(exportedBlob.value, finalName);
  }
};

const dropZoneRef = ref<HTMLDivElement>();
const fileInput = ref<HTMLInputElement>();

const onDrop = (files: File[] | null) => {
  if (files && files.length > 0) {
    handleFileUpload(files);
  }
};

const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop,
});

const onFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const fileList = Array.from(target.files);
    handleFileUpload(fileList);
  }
};
</script>

<template>
  <div class="container mx-auto px-4 py-12 flex flex-col min-h-screen relative">
    
    <!-- State 1: Verification Screen (Fullscreen Modal) -->
    <DocumentVerification
      v-if="!isProcessing && !isVerified && (pages.length > 0 || (fileUrl && (result.length > 0 || detectedRegions.length > 0 || file)))"
      :pages="pages"
      :image-url="fileUrl || undefined"
      :words="result"
      :document-type="documentType"
      :detected-regions="detectedRegions"
      @confirm="handleVerificationConfirm"
      @cancel="handleVerificationCancel"
    />

    <!-- State 2: Dedicated Export Success & Download Page -->
    <ExportSuccessPage
      v-else-if="showSuccessPage && exportedBlob"
      :blob="exportedBlob"
      :filename="exportedFilename"
      :original-file-size="originalFileSize"
      :exported-file-size="exportedFileSize"
      :stats="exportStats"
      @download-direct="handleDownloadDirect"
      @download-option="handleDownloadOption"
      @edit-again="handleEditAgain"
      @new-document="resetToHome"
    />

    <!-- State 3: Redaction In-Progress Fullscreen Backdrop -->
    <div
      v-else-if="isRedacting"
      class="fixed inset-0 bg-gray-950/80 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6 text-center"
    >
      <div class="bg-gray-900 border border-gray-800 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full">
        <div class="w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center mb-4 border border-blue-500/30">
          <Loader2 class="w-7 h-7 animate-spin text-blue-400" />
        </div>
        <h3 class="text-base font-bold text-white mb-1.5">
          Menyensor Dokumen
        </h3>
        <p class="text-xs text-gray-300 font-medium leading-relaxed">
          Memproses penghapusan teks, wajah, dan blok sensitif di memori lokal peramban…
        </p>
      </div>
    </div>

    <!-- State 4: Default Initial Upload / Home Screen -->
    <template v-else>
      <!-- Header Section -->
      <div class="text-center mb-8 pt-6">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
          <Sparkles class="w-3.5 h-3.5" />
          100% Offline &amp; Aman di Peramban Anda
        </div>
        <h1 class="text-3xl sm:text-4xl font-extrabold mb-3 text-gray-900 dark:text-white tracking-tight">
          Document Ingestion &amp; PII Redaction
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto leading-relaxed">
          Sensor data pribadi sensitif pada dokumen PDF multi-halaman dan gambar secara instan tanpa mengunggah ke server luar.
        </p>
      </div>

      <!-- Dropzone Area -->
      <div
        ref="dropZoneRef"
        class="border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all flex flex-col items-center justify-center cursor-pointer mb-8 relative max-w-2xl mx-auto w-full shadow-sm hover:shadow-md"
        :class="isOverDropZone ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.01]' : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 bg-white/50 dark:bg-gray-800/50'"
        @click="fileInput?.click()"
      >
        <input 
          ref="fileInput"
          type="file" 
          multiple
          accept="image/jpeg, image/png, application/pdf" 
          class="hidden" 
          @change="onFileSelect"
        />
        
        <div class="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
          <UploadCloud class="w-8 h-8" />
        </div>
        <h3 class="text-lg sm:text-xl font-bold mb-1.5 text-gray-900 dark:text-white">
          Tarik &amp; Lepaskan Dokumen di Sini
        </h3>
        <p class="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mb-4">
          Mendukung PDF (multi-halaman), JPEG, dan PNG. Bisa unggah banyak gambar sekaligus.
        </p>
        
        <button
          type="button"
          class="bg-blue-600 text-white hover:bg-blue-700 px-5 py-2.5 rounded-lg font-semibold text-xs sm:text-sm shadow-sm transition-all"
        >
          Pilih File Dokumen
        </button>
      </div>

      <!-- Ingestion / Processing Progress Card -->
      <div
        v-if="isProcessing"
        class="w-full max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 space-y-4"
      >
        <div class="flex items-center justify-between">
          <span class="font-semibold text-sm flex items-center gap-2 text-gray-900 dark:text-white">
            <Loader2 class="w-4 h-4 animate-spin text-blue-500" />
            Memproses dokumen secara aman di peramban…
          </span>
          <span class="text-sm text-gray-500 dark:text-gray-400 font-mono font-bold">{{ Math.round(progress * 100) }}%</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
          <div
            class="bg-blue-600 h-full rounded-full transition-all duration-300"
            :style="{ width: `${progress * 100}%` }"
          ></div>
        </div>
      </div>
    </template>

    <!-- Modal: Choice for PDF Mode (Scanned/Image-heavy vs Text) -->
    <div
      v-if="showPdfChoiceModal"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-800">
        <div class="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
          <FileText class="w-6 h-6" />
        </div>
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
          Pilih Metode Pemindaian PDF
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          PDF ini terdeteksi memiliki banyak gambar atau hasil scan. Silakan tentukan metode pemrosesan yang Anda inginkan:
        </p>

        <div class="space-y-3">
          <button
            @click="handlePdfChoice('text-pdf')"
            class="w-full p-3.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-left transition-colors flex items-start gap-3 group"
          >
            <div class="p-2 rounded bg-blue-600 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                Scan Teks PDF (Fast PDF Reader)
              </div>
              <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Membaca teks digital yang tertanam langsung dari struktur PDF. Sangat cepat dan mempertahankan teks vektor asli.
              </div>
            </div>
          </button>

          <button
            @click="handlePdfChoice('image-pdf')"
            class="w-full p-3.5 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 text-left transition-colors flex items-start gap-3 group"
          >
            <div class="p-2 rounded bg-purple-600 text-white flex-shrink-0 mt-0.5">
              <Scan class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400">
                Scan OCR Tesseract (Visual Scanner)
              </div>
              <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Merender halaman sebagai gambar dan memindai teks di dalam foto atau dokumen hasil scan fisik.
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>
