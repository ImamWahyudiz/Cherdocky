<script setup lang="ts">
import { ref } from 'vue';
import { useDropZone } from '@vueuse/core';
import {
  redactImage,
  redactPdf,
  exportImagesAsMergedPdf,
  createZipBlob,
} from '~/utils/redactor';
import type { PIIType } from '~/utils/piiDetector';
import DocumentVerification from '~/components/DocumentVerification.vue';
import type { SpatialWord } from '~/utils/ocrEngine';
import type { DetectedRegion } from '~/utils/faceDetector';
import { useDocumentIngestion, type DocumentPageItem } from '~/composables/useDocumentIngestion';
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  Download,
  FileText,
  Scan,
  Archive,
  Layers,
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
  addMoreImages,
  cleanupPageUrls,
} = useDocumentIngestion();

const isRedacting = ref(false);
const activePiiTypes = ref<PIIType[]>([]);
const customPiiText = ref('');
const redactionRegions = ref<DetectedRegion[]>([]);
const selectedRedactionColor = ref('#000000');
const verifiedPages = ref<DocumentPageItem[]>([]);

// State for Multi-Image Export Modal
const showMultiImageExportModal = ref(false);

const handleVerificationConfirm = (data: {
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
  isVerified.value = true;
};

const handleVerificationCancel = () => {
  result.value = [];
  file.value = null;
  fileUrl.value = null;
  isVerified.value = false;
  redactionRegions.value = [];
  selectedRedactionColor.value = '#000000';
  verifiedPages.value = [];
  cleanupPageUrls();
};

const handleAddMoreImages = (files: File[]) => {
  addMoreImages(files);
};

const triggerDownloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a') as HTMLAnchorElement;
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const handleRedactAndDownload = async () => {
  if (!file.value && verifiedPages.value.length === 0) return;

  // If multiple images are verified, prompt choice between merged PDF vs ZIP
  if (documentType.value === 'image' && verifiedPages.value.length > 1) {
    showMultiImageExportModal.value = true;
    return;
  }

  await executeDirectRedaction();
};

const executeDirectRedaction = async () => {
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
        selectedRedactionColor.value
      );
      triggerDownloadBlob(redactedBlob, `redacted_${file.value.name}`);
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
        selectedRedactionColor.value
      );

      const filename = file.value ? file.value.name : 'image.png';
      triggerDownloadBlob(redactedBlob, `redacted_${filename}`);
    }
  } catch (error) {
    console.error('Redaction failed:', error);
    alert('Gagal menyensor dokumen. Periksa konsol untuk informasi selengkapnya.');
  } finally {
    isRedacting.value = false;
  }
};

const exportMultiImagesAsMergedPdfChoice = async () => {
  showMultiImageExportModal.value = false;
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
        selectedRedactionColor.value
      );

      redactedImagesList.push({
        blob: redactedBlob,
        width: page.width,
        height: page.height,
      });
    }

    const pdfBlob = await exportImagesAsMergedPdf(redactedImagesList);
    triggerDownloadBlob(pdfBlob, 'redacted_dokumen_gabungan.pdf');
  } catch (error) {
    console.error('Merged PDF export failed:', error);
    alert('Gagal menggabungkan gambar ke PDF.');
  } finally {
    isRedacting.value = false;
  }
};

const exportMultiImagesAsZipChoice = async () => {
  showMultiImageExportModal.value = false;
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
        selectedRedactionColor.value
      );

      const safeName = (page.label || `gambar_${i + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = safeName.endsWith('.png') || safeName.endsWith('.jpg') ? `redacted_${safeName}` : `redacted_${safeName}.png`;
      zipFiles.push({ name: filename, blob: redactedBlob });
    }

    const zipBlob = await createZipBlob(zipFiles);
    triggerDownloadBlob(zipBlob, 'redacted_gambar_dokumen.zip');
  } catch (error) {
    console.error('ZIP export failed:', error);
    alert('Gagal membuat arsip ZIP.');
  } finally {
    isRedacting.value = false;
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
    <!-- Document Verification Fullscreen Overlay -->
    <DocumentVerification
      v-if="!isProcessing && !isVerified && (pages.length > 0 || (fileUrl && (result.length > 0 || detectedRegions.length > 0 || file)))"
      :pages="pages"
      :image-url="fileUrl || undefined"
      :words="result"
      :document-type="documentType"
      :detected-regions="detectedRegions"
      @confirm="handleVerificationConfirm"
      @cancel="handleVerificationCancel"
      @add-images="handleAddMoreImages"
    />

    <!-- Modal: Choice for PDF Mode (Scanned/Image-heavy vs Text) -->
    <div
      v-if="showPdfChoiceModal"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150">
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

    <!-- Modal: Choice for Multi-Image Export (Merged PDF vs ZIP) -->
    <div
      v-if="showMultiImageExportModal"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl max-w-md w-full p-6 shadow-2xl border border-gray-200 dark:border-gray-800">
        <div class="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4">
          <Layers class="w-6 h-6" />
        </div>
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-1.5">
          Pilihan Format Unduhan
        </h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          Anda menyensor {{ verifiedPages.length }} gambar. Pilih bagaimana Anda ingin menyimpan hasil redaksi:
        </p>

        <div class="space-y-3">
          <button
            @click="exportMultiImagesAsMergedPdfChoice"
            class="w-full p-3.5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-left transition-colors flex items-start gap-3 group"
          >
            <div class="p-2 rounded bg-blue-600 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-blue-600">
                Gabung Jadi 1 File PDF
              </div>
              <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Semua gambar dirangkum menjadi satu dokumen PDF berurutan dan siap dibagikan.
              </div>
            </div>
          </button>

          <button
            @click="exportMultiImagesAsZipChoice"
            class="w-full p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-left transition-colors flex items-start gap-3 group"
          >
            <div class="p-2 rounded bg-emerald-600 text-white flex-shrink-0 mt-0.5">
              <Archive class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-gray-900 dark:text-white group-hover:text-emerald-600">
                Unduh Arsip ZIP (Gambar Terpisah)
              </div>
              <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                Menyimpan seluruh file gambar individual yang sudah disensor ke dalam satu paket ZIP.
              </div>
            </div>
          </button>
        </div>

        <button
          @click="showMultiImageExportModal = false"
          class="mt-4 w-full py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
        >
          Kembali
        </button>
      </div>
    </div>

    <!-- Header Section -->
    <div class="text-center mb-8 pt-6">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold mb-4">
        <Sparkles class="w-3.5 h-3.5" />
        100% Offline & Aman di Peramban Anda
      </div>
      <h1 class="text-3xl sm:text-4xl font-extrabold mb-3 text-gray-900 dark:text-white tracking-tight">
        Document Ingestion & PII Redaction
      </h1>
      <p class="text-sm text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
        Sensor data pribadi sensitif (NIK, Nama, Nomor HP, Wajah) pada dokumen PDF multi-halaman dan gambar secara instan tanpa mengunggah ke server luar.
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
        Tarik & Lepaskan Dokumen di Sini
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

    <!-- Processing & Result State Card -->
    <div
      v-if="isProcessing || ((result.length > 0 || redactionRegions.length > 0) && isVerified)"
      class="w-full max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
    >
      <div v-if="isProcessing" class="space-y-4">
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

      <div v-else-if="(result.length > 0 || redactionRegions.length > 0) && isVerified" class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold text-sm">
            <CheckCircle2 class="w-5 h-5 flex-shrink-0" />
            <span>Verifikasi selesai! Dokumen siap diekspor.</span>
          </div>
          <button 
            class="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-semibold text-sm shadow-md transition-all disabled:opacity-50"
            :disabled="isRedacting"
            @click="handleRedactAndDownload"
          >
            <Loader2 v-if="isRedacting" class="w-4 h-4 animate-spin" />
            <Download v-else class="w-4 h-4" />
            <span>{{ isRedacting ? 'Memproses Redaksi…' : 'Unduh Hasil Redaksi' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
