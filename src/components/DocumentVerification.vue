<template>
  <div class="fixed inset-0 w-full h-full bg-gray-900 z-50 flex flex-col overflow-hidden select-none">
    <!-- Top Header Bar -->
    <header class="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex justify-between items-center z-20 flex-shrink-0 shadow-sm">
      <div class="flex items-center gap-3">
        <h2 class="text-base sm:text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-600"></span>
          Verifikasi & Sensor Dokumen
        </h2>
        <span class="hidden sm:inline text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium">
          {{ documentType.toUpperCase() }}
        </span>
      </div>

      <!-- Center / Header Actions: Rotate & Rescan Controls -->
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          @click="rotateCounterClockwise"
          class="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors border border-gray-300 dark:border-gray-700 flex items-center gap-1"
          title="Putar 90° Berlawanan Jarum Jam"
        >
          <span>↺</span>
          <span class="hidden sm:inline">Putar Kiri</span>
        </button>
        <button
          type="button"
          @click="rotateClockwise"
          class="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors border border-gray-300 dark:border-gray-700 flex items-center gap-1"
          title="Putar 90° Searah Jarum Jam"
        >
          <span>↻</span>
          <span class="hidden sm:inline">Putar Kanan</span>
        </button>
        <button
          type="button"
          @click="rescanFullDocument"
          :disabled="isScanningFull"
          class="px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-md transition-colors border border-blue-200 dark:border-blue-800 flex items-center gap-1.5 ml-1"
          title="Pindai ulang seluruh teks pada posisi gambar saat ini"
        >
          <span v-if="isScanningFull" class="animate-spin">⏳</span>
          <span v-else>🔍</span>
          <span>Pindai Ulang</span>
        </button>
      </div>

      <div class="flex items-center gap-2">
        <button
          class="px-3.5 py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors border border-gray-300 dark:border-gray-700"
          @click="$emit('cancel')"
        >
          Batal
        </button>
        <button
          class="px-4 py-1.5 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-sm transition-colors flex items-center gap-1.5"
          @click="handleConfirm"
        >
          <span>Konfirmasi & Ekspor</span>
        </button>
      </div>
    </header>
    
    <!-- Main Content Area: Left/Top Canvas, Right/Bottom Controls -->
    <div class="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
      <!-- Document Canvas Viewport -->
      <main
        ref="scrollContainer"
        class="overflow-auto p-4 sm:p-6 relative bg-gray-950 flex items-start justify-center flex-shrink-0 lg:flex-1 h-[46vh] sm:h-[52vh] lg:h-auto border-b lg:border-b-0 border-gray-800"
        :class="dragMode === 'block' ? 'cursor-crosshair' : 'cursor-default'"
        @wheel="onWheel"
      >
        <!-- Container for image and overlays -->
        <div
          ref="imageContainer"
          class="relative inline-block origin-top-left shadow-2xl transition-transform duration-75"
          :style="{
            width: imgWidth + 'px',
            height: imgHeight + 'px',
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top center'
          }"
          @mousedown.prevent="onMouseDown"
          @mousemove.prevent="onMouseMove"
          @mouseup.prevent="onMouseUp"
        >
          <img
            ref="docImage"
            :src="currentImageUrl"
            @load="onImageLoad"
            class="max-w-none shadow-md pointer-events-none bg-white block"
          />
          
          <template v-if="imageLoaded">
            <!-- Word bounding boxes: semi-transparent green for normal text, glowing red for redacted -->
            <div
              v-for="(word, index) in editableWords"
              :key="'word-' + index"
              class="absolute border flex items-center justify-center overflow-visible group pointer-events-none transition-all"
              :class="[
                isWordRedacted(index, word)
                  ? 'border-2 border-red-500 bg-red-500/50 z-20 shadow-[0_0_10px_rgba(239,68,68,0.85)] ring-1 ring-red-400/50'
                  : 'border border-emerald-500/50 bg-emerald-500/15 z-10'
              ]"
              :style="{
                left: word.x + 'px',
                top: word.y + 'px',
                width: word.width + 'px',
                height: word.height + 'px'
              }"
            >
              <!-- Tooltip showing extracted text on hover -->
              <div class="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-black/90 text-white text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap z-30 pointer-events-none shadow-lg">
                {{ word.text }}
              </div>
            </div>

            <!-- Auto-detected face regions (purple) -->
            <template v-if="enableFaceDetection">
              <div
                v-for="(region, index) in activeFaceRegions"
                :key="'auto-region-' + index"
                class="absolute pointer-events-none z-20 transition-opacity"
                :class="disabledAutoRegions.has(index)
                  ? 'border border-dashed border-gray-400 bg-gray-400/10 opacity-40'
                  : 'border-2 border-purple-500 bg-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.6)]'"
                :style="{
                  left: region.x + 'px',
                  top: region.y + 'px',
                  width: region.w + 'px',
                  height: region.h + 'px'
                }"
              >
                <span
                  v-if="!disabledAutoRegions.has(index)"
                  class="absolute -top-5 left-0 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap font-medium shadow"
                >
                  Wajah {{ index + 1 }}
                </span>
              </div>
            </template>

            <!-- Manual blocked regions (custom color / striped) -->
            <div
              v-for="(region, index) in manualRegions"
              :key="'manual-region-' + index"
              class="absolute pointer-events-none z-20 border-2"
              :style="{
                left: region.x + 'px',
                top: region.y + 'px',
                width: region.w + 'px',
                height: region.h + 'px',
                borderColor: selectedColor,
                backgroundColor: selectedColor === '#ffffff' ? 'rgba(255,255,255,0.7)' : `${selectedColor}40`,
                backgroundImage: 'repeating-linear-gradient(45deg, rgba(0,0,0,0.1), rgba(0,0,0,0.1) 4px, transparent 4px, transparent 8px)'
              }"
            >
              <span
                class="absolute -top-5 left-0 text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap font-medium shadow"
                :style="{ backgroundColor: selectedColor === '#ffffff' ? '#4b5563' : selectedColor }"
              >
                Blok Manual
              </span>
            </div>

            <!-- Drag selection rectangle -->
            <div
              v-if="isDragging && selectionRect"
              class="absolute border-2 border-dashed z-30 pointer-events-none"
              :class="dragMode === 'block'
                ? 'border-red-400 bg-red-400/20'
                : 'border-blue-400 bg-blue-400/20'"
              :style="{
                left: selectionRect.x + 'px',
                top: selectionRect.y + 'px',
                width: selectionRect.w + 'px',
                height: selectionRect.h + 'px'
              }"
            ></div>

            <!-- Re-scanning OCR indicator -->
            <div
              v-if="isReScanning && scanRect"
              class="absolute border-2 border-yellow-400 bg-yellow-400/25 z-30 pointer-events-none flex items-center justify-center"
              :style="{
                left: scanRect.x + 'px',
                top: scanRect.y + 'px',
                width: scanRect.w + 'px',
                height: scanRect.h + 'px'
              }"
            >
              <span class="bg-yellow-500 text-white text-xs px-2.5 py-1 rounded-full animate-pulse font-semibold shadow">
                Memindai Teks…
              </span>
            </div>
          </template>
        </div>
      </main>

      <!-- Sidebar / Bottom Controls: Placed naturally below canvas on mobile -->
      <aside
        class="w-full lg:w-84 xl:w-96 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 overflow-y-auto flex flex-col gap-4 flex-1 lg:flex-none flex-shrink-0 z-10 shadow-sm"
      >
        <!-- Mode Switcher -->
        <div class="bg-gray-100 dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700">
          <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 px-1">
            Mode Interaksi Kanvas
          </div>
          <div class="grid grid-cols-2 gap-1">
            <button
              class="px-2.5 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5"
              :class="dragMode === 'rescan'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'"
              @click="dragMode = 'rescan'"
            >
              <span>🔍 Scan Area</span>
            </button>
            <button
              class="px-2.5 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5"
              :class="dragMode === 'block'
                ? 'bg-red-600 text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'"
              @click="dragMode = 'block'"
            >
              <span>🚫 Blok Manual</span>
            </button>
          </div>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 px-1">
            {{ dragMode === 'block'
              ? 'Drag untuk memblokir langsung gambar/tabel/teks buram tanpa OCR.'
              : 'Drag untuk memindai ulang teks yang terlewat pada area yang dipilih.' }}
          </p>
        </div>

        <!-- Redaction Color Picker -->
        <div class="border-b border-gray-200 dark:border-gray-800 pb-3">
          <label class="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Warna Sensor / Redaksi:
          </label>
          <div class="flex items-center gap-2">
            <button
              v-for="c in colorPalette"
              :key="c.value"
              class="w-7 h-7 rounded-full border-2 transition-transform relative"
              :class="selectedColor === c.value ? 'scale-110 border-blue-500 shadow-md ring-2 ring-blue-400/40' : 'border-gray-300 dark:border-gray-600 hover:scale-105'"
              :style="{ backgroundColor: c.value }"
              :title="c.label"
              @click="selectedColor = c.value"
            >
              <span v-if="selectedColor === c.value" class="absolute inset-0 flex items-center justify-center text-xs" :class="c.value === '#ffffff' ? 'text-black' : 'text-white'">✓</span>
            </button>
            <span class="text-xs text-gray-500 dark:text-gray-400 ml-1.5 font-medium">
              {{ colorPalette.find(c => c.value === selectedColor)?.label }}
            </span>
          </div>
        </div>

        <!-- Face Detection On-Demand Trigger -->
        <div class="border-b border-gray-200 dark:border-gray-800 pb-3">
          <label class="flex items-center justify-between cursor-pointer">
            <div class="flex items-center space-x-2.5">
              <input
                type="checkbox"
                v-model="enableFaceDetection"
                @change="handleFaceDetectionToggle"
                class="rounded border-gray-300 dark:border-gray-600 text-purple-600 focus:ring-purple-500 dark:bg-gray-700 w-4 h-4"
              />
              <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                Deteksi Wajah Otomatis
              </span>
            </div>
            <span v-if="isScanningFaces" class="text-xs text-purple-600 dark:text-purple-400 animate-pulse font-medium">
              Memindai…
            </span>
          </label>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
            Pindai foto wajah atau pasfoto pada dokumen (termasuk ukuran kecil/banyak) dan tandai untuk disensor.
          </p>
        </div>

        <!-- Data-Driven Found Sensitive Keywords (data.csv) -->
        <div class="flex flex-col border-b border-gray-200 dark:border-gray-800 pb-3">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-xs text-gray-900 dark:text-white uppercase tracking-wider">
              Kata Sensitif Ditemukan (data.csv)
            </h3>
            <div class="flex items-center gap-1.5 text-[11px]" v-if="foundSensitiveKeywords.length > 0">
              <button
                class="text-blue-600 dark:text-blue-400 hover:underline"
                @click="selectAllKeywords"
              >Semua</button>
              <span class="text-gray-400">|</span>
              <button
                class="text-gray-500 dark:text-gray-400 hover:underline"
                @click="deselectAllKeywords"
              >Batal</button>
            </div>
          </div>

          <!-- Dynamic list of only detected keywords -->
          <div v-if="foundSensitiveKeywords.length > 0" class="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            <label
              v-for="item in foundSensitiveKeywords"
              :key="item.id"
              class="flex items-center justify-between p-2 rounded-md bg-gray-50 dark:bg-gray-800/80 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer border border-gray-200 dark:border-gray-700/60 transition-colors"
            >
              <div class="flex items-center space-x-2 min-w-0">
                <input
                  type="checkbox"
                  :checked="checkedKeywords.has(item.id)"
                  @change="toggleKeywordSelection(item.id)"
                  class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:bg-gray-700 w-4 h-4 flex-shrink-0"
                />
                <div class="truncate">
                  <span class="text-xs font-semibold text-gray-800 dark:text-gray-200 block truncate">
                    {{ item.keyword }}
                  </span>
                  <span class="text-[10px] text-gray-500 dark:text-gray-400 block truncate">
                    {{ item.category }}
                  </span>
                </div>
              </div>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-bold ml-2">
                {{ item.count }}x
              </span>
            </label>
          </div>

          <div v-else class="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-dashed border-gray-200 dark:border-gray-700 text-center">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Tidak ada kata kunci dari <code class="text-[11px] text-blue-500">data.csv</code> terdeteksi. Pola mandiri (NIK, nomor telepon, tanggal lahir) tetap otomatis disensor jika cocok.
            </p>
          </div>
        </div>

        <!-- Custom Keyword Input -->
        <div>
          <label class="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Kata Kunci Tambahan (Kustom):
          </label>
          <input
            v-model="customPiiText"
            type="text"
            placeholder="Ketik teks yang ingin disensor..."
            class="block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white text-xs px-3 py-2 border outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm"
          />
        </div>

        <!-- Status & Stats Summary -->
        <div class="text-[11px] text-gray-500 dark:text-gray-400 space-y-1 pt-1">
          <div class="flex justify-between">
            <span>Total Kata Terdeteksi:</span>
            <span class="font-medium text-gray-700 dark:text-gray-300">{{ editableWords.length }}</span>
          </div>
          <div class="flex justify-between">
            <span>Kata yang Disensor:</span>
            <span class="font-medium text-red-600 dark:text-red-400">{{ totalRedactedWordsCount }} kata</span>
          </div>
          <div class="flex justify-between" v-if="manualRegions.length > 0">
            <span>Blok Manual:</span>
            <span class="font-medium text-red-600 dark:text-red-400">{{ manualRegions.length }} area</span>
          </div>
          <div class="flex justify-between" v-if="enableFaceDetection && activeFaceRegions.length > 0">
            <span>Wajah Terdeteksi:</span>
            <span class="font-medium text-purple-600 dark:text-purple-400">{{ activeFaceRegions.length - disabledAutoRegions.size }} wajah</span>
          </div>
        </div>

        <!-- Status Flash Message -->
        <div v-if="statusMessage" class="text-xs p-2 rounded" :class="statusMessageClass">
          {{ statusMessage }}
        </div>
      </aside>
    </div>

    <!-- Bottom Status & Zoom Controls Bar -->
    <footer class="px-4 py-2.5 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center justify-between gap-2 z-20 flex-shrink-0">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="font-medium text-gray-800 dark:text-gray-200">
          {{ dragMode === 'block' ? '🚫 Klik untuk hapus blok. Drag untuk blokir area.' : '🔍 Klik untuk sensor/batal sensor kata. Drag untuk scan teks baru.' }}
        </span>
        <span class="hidden sm:inline text-gray-400">•</span>
        <span class="text-gray-500 dark:text-gray-400 hidden sm:inline">
          Scroll: Pan · Shift+Scroll: Horizontal · Ctrl+Scroll: Zoom
        </span>
      </div>

      <!-- Zoom Controls & Quick Rotate -->
      <div class="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          @click="rotateClockwise"
          class="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-medium transition-colors mr-1 flex items-center gap-1"
          title="Putar Dokumen 90°"
        >
          <span>↻</span>
          <span>Putar</span>
        </button>
        <button
          @click="zoomOut"
          class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold transition-colors"
        >−</button>
        <span class="font-mono w-11 text-center font-semibold text-gray-800 dark:text-gray-200">
          {{ Math.round(zoomLevel * 100) }}%
        </span>
        <button
          @click="zoomIn"
          class="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold transition-colors"
        >+</button>
        <button
          @click="zoomReset"
          class="px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-medium transition-colors ml-1"
        >Pas</button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { SpatialWord } from '~/utils/ocrEngine';
import { processRegion, processDocument } from '~/utils/ocrEngine';
import {
  findContextualPIIWordIndices,
  extractFoundSensitiveKeywords,
  type PIIType,
  type FoundKeywordItem
} from '~/utils/piiDetector';
import type { DocumentType } from '~/composables/useDocumentIngestion';
import { detectFaces, type DetectedRegion } from '~/utils/faceDetector';

const props = defineProps<{
  imageUrl: string;
  words: SpatialWord[];
  documentType: DocumentType;
  detectedRegions?: DetectedRegion[];
}>();

const emit = defineEmits<{
  (e: 'confirm', data: {
    words: SpatialWord[];
    piiTypes: PIIType[];
    customText: string;
    regions: DetectedRegion[];
    redactionColor: string;
    rotatedImageUrl?: string;
  }): void;
  (e: 'cancel'): void;
}>();

const currentImageUrl = ref(props.imageUrl);
const editableWords = ref<SpatialWord[]>([]);
const imageContainer = ref<HTMLDivElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const docImage = ref<HTMLImageElement | null>(null);
const imageLoaded = ref(false);
const imgWidth = ref(0);
const imgHeight = ref(0);
const zoomLevel = ref(1);
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.15;
const totalRotation = ref(0);

// --- Redaction Color Palette ---
const colorPalette = [
  { label: 'Hitam', value: '#000000' },
  { label: 'Putih', value: '#ffffff' },
  { label: 'Abu-abu', value: '#374151' },
  { label: 'Navy', value: '#1e3a8a' },
  { label: 'Merah', value: '#b91c1c' },
];
const selectedColor = ref<string>('#000000');

// --- Custom Text Search ---
const customPiiText = ref('');

// --- On-Demand Face Detection State ---
const enableFaceDetection = ref(false);
const isScanningFaces = ref(false);
const activeFaceRegions = ref<DetectedRegion[]>(props.detectedRegions ? [...props.detectedRegions] : []);
const disabledAutoRegions = ref<Set<number>>(new Set());

// --- Manual Block & Drag Mode ---
type DragMode = 'rescan' | 'block';
const dragMode = ref<DragMode>('rescan');
const manualRegions = ref<DetectedRegion[]>([]);
const manuallyRedactedIndices = ref<Set<number>>(new Set());
const unredactedIndices = ref<Set<number>>(new Set());

// --- Data-Driven Keywords from data.csv ---
const checkedKeywords = ref<Set<string>>(new Set());

const foundSensitiveKeywords = computed<FoundKeywordItem[]>(() => {
  return extractFoundSensitiveKeywords(editableWords.value);
});

// Reactively synchronize words and image from parent
watch(
  () => props.imageUrl,
  (newUrl) => {
    currentImageUrl.value = newUrl;
    totalRotation.value = 0;
  }
);

watch(
  () => props.words,
  (newWords) => {
    editableWords.value = JSON.parse(JSON.stringify(newWords || []));
    manuallyRedactedIndices.value.clear();
    unredactedIndices.value.clear();
    foundSensitiveKeywords.value.forEach((item) => {
      checkedKeywords.value.add(item.id);
    });
  },
  { immediate: true, deep: true }
);

watch(
  foundSensitiveKeywords,
  (newList) => {
    newList.forEach((item) => {
      if (!checkedKeywords.value.has(item.id)) {
        checkedKeywords.value.add(item.id);
      }
    });
  },
  { deep: true }
);

// --- Rotate Functions ---
function rotateClockwise() {
  if (!docImage.value || imgWidth.value === 0 || imgHeight.value === 0) return;
  const oldW = imgWidth.value;
  const oldH = imgHeight.value;

  const canvas = document.createElement('canvas');
  canvas.width = oldH;
  canvas.height = oldW;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.translate(oldH / 2, oldW / 2);
  ctx.rotate((90 * Math.PI) / 180);
  ctx.drawImage(docImage.value, -oldW / 2, -oldH / 2);

  currentImageUrl.value = canvas.toDataURL('image/png');
  imgWidth.value = oldH;
  imgHeight.value = oldW;

  editableWords.value = editableWords.value.map((w) => ({
    ...w,
    x: oldH - (w.y + w.height),
    y: w.x,
    width: w.height,
    height: w.width,
  }));

  activeFaceRegions.value = activeFaceRegions.value.map((r) => ({
    x: oldH - (r.y + r.h),
    y: r.x,
    w: r.h,
    h: r.w,
    score: r.score,
  }));

  manualRegions.value = manualRegions.value.map((r) => ({
    x: oldH - (r.y + r.h),
    y: r.x,
    w: r.h,
    h: r.w,
  }));

  totalRotation.value = (totalRotation.value + 90) % 360;
  showStatus('Dokumen diputar 90° searah jarum jam.', 'info');
}

function rotateCounterClockwise() {
  if (!docImage.value || imgWidth.value === 0 || imgHeight.value === 0) return;
  const oldW = imgWidth.value;
  const oldH = imgHeight.value;

  const canvas = document.createElement('canvas');
  canvas.width = oldH;
  canvas.height = oldW;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.translate(oldH / 2, oldW / 2);
  ctx.rotate((-90 * Math.PI) / 180);
  ctx.drawImage(docImage.value, -oldW / 2, -oldH / 2);

  currentImageUrl.value = canvas.toDataURL('image/png');
  imgWidth.value = oldH;
  imgHeight.value = oldW;

  editableWords.value = editableWords.value.map((w) => ({
    ...w,
    x: w.y,
    y: oldW - (w.x + w.width),
    width: w.height,
    height: w.width,
  }));

  activeFaceRegions.value = activeFaceRegions.value.map((r) => ({
    x: r.y,
    y: oldW - (r.x + r.w),
    w: r.h,
    h: r.w,
    score: r.score,
  }));

  manualRegions.value = manualRegions.value.map((r) => ({
    x: r.y,
    y: oldW - (r.x + r.w),
    w: r.h,
    h: r.w,
  }));

  totalRotation.value = (totalRotation.value + 270) % 360;
  showStatus('Dokumen diputar 90° berlawanan arah jarum jam.', 'info');
}

const isScanningFull = ref(false);

async function rescanFullDocument() {
  if (!currentImageUrl.value) return;
  isScanningFull.value = true;
  showStatus('Memindai ulang seluruh teks pada orientasi gambar baru…', 'info');
  try {
    const res = await fetch(currentImageUrl.value);
    const blob = await res.blob();
    const words = await processDocument(blob);
    if (words && words.length > 0) {
      editableWords.value = words;
      manuallyRedactedIndices.value.clear();
      unredactedIndices.value.clear();
      foundSensitiveKeywords.value.forEach((item) => {
        checkedKeywords.value.add(item.id);
      });
      showStatus(`Berhasil mengekstrak ${words.length} kata!`, 'success');
    } else {
      showStatus('Tidak ditemukan teks tambahan pada orientasi ini.', 'warning');
    }
  } catch (err) {
    console.error('Full rescan error:', err);
    showStatus('Gagal memindai ulang dokumen.', 'error');
  } finally {
    isScanningFull.value = false;
  }
}

function toggleKeywordSelection(id: string) {
  const item = foundSensitiveKeywords.value.find((k) => k.id === id);
  if (item) {
    item.wordIndices.forEach((idx) => {
      unredactedIndices.value.delete(idx);
      manuallyRedactedIndices.value.delete(idx);
    });
  }

  if (checkedKeywords.value.has(id)) {
    checkedKeywords.value.delete(id);
  } else {
    checkedKeywords.value.add(id);
  }
}

function selectAllKeywords() {
  foundSensitiveKeywords.value.forEach((item) => {
    checkedKeywords.value.add(item.id);
    item.wordIndices.forEach((idx) => {
      unredactedIndices.value.delete(idx);
      manuallyRedactedIndices.value.delete(idx);
    });
  });
}

function deselectAllKeywords() {
  foundSensitiveKeywords.value.forEach((item) => {
    item.wordIndices.forEach((idx) => {
      unredactedIndices.value.delete(idx);
      manuallyRedactedIndices.value.delete(idx);
    });
  });
  checkedKeywords.value.clear();
}

// Active PII Types including standalone patterns (phone, nik, dob, ttl, bpjs, npwp, bank, id, email)
const activePiiTypes = computed<PIIType[]>(() => {
  const types: PIIType[] = ['nik', 'phone', 'email', 'id', 'bank', 'password', 'dob', 'ttl', 'bpjs', 'npwp'];
  if (customPiiText.value.trim()) types.push('custom');
  return types;
});

// Compute all word indices that match active/checked criteria
const autoDetectedPiiIndices = computed<Set<number>>(() => {
  // 1. Gather all word indices that are tied to known keywords in foundSensitiveKeywords
  const uncheckedKeywordIndices = new Set<number>();

  for (const item of foundSensitiveKeywords.value) {
    if (!checkedKeywords.value.has(item.id)) {
      for (const idx of item.wordIndices) {
        uncheckedKeywordIndices.add(idx);
      }
    }
  }

  // 2. Standalone contextual PII words (dates, standalone numbers, emails without keyword labels)
  const standaloneIndices = findContextualPIIWordIndices(editableWords.value, activePiiTypes.value, customPiiText.value);

  const indices = new Set<number>();

  // Add standalone matches ONLY if they are NOT explicitly unchecked via a keyword checkbox
  for (const idx of standaloneIndices) {
    if (!uncheckedKeywordIndices.has(idx)) {
      indices.add(idx);
    }
  }

  // Add words associated ONLY with checked dynamic keywords
  for (const item of foundSensitiveKeywords.value) {
    if (checkedKeywords.value.has(item.id)) {
      for (const idx of item.wordIndices) {
        indices.add(idx);
      }
    }
  }

  // 3. Custom text search matching
  if (customPiiText.value.trim()) {
    const q = customPiiText.value.trim().toLowerCase();
    editableWords.value.forEach((w, i) => {
      if (w.text.toLowerCase().includes(q)) {
        indices.add(i);
      }
    });
  }

  return indices;
});

function isWordRedacted(index: number, _word?: SpatialWord): boolean {
  if (unredactedIndices.value.has(index)) return false;
  if (manuallyRedactedIndices.value.has(index)) return true;
  return autoDetectedPiiIndices.value.has(index);
}

const totalRedactedWordsCount = computed(() => {
  return editableWords.value.filter((w, i) => isWordRedacted(i, w)).length;
});

// --- Face Detection On-Demand Toggle Handler ---
async function handleFaceDetectionToggle() {
  if (enableFaceDetection.value) {
    if (activeFaceRegions.value.length === 0) {
      isScanningFaces.value = true;
      showStatus('Menjalankan deteksi wajah…', 'info');
      try {
        let faces: DetectedRegion[] = [];
        if (docImage.value) {
          faces = await detectFaces(docImage.value);
        } else {
          const res = await fetch(currentImageUrl.value);
          const blob = await res.blob();
          faces = await detectFaces(blob);
        }
        activeFaceRegions.value = faces;
        disabledAutoRegions.value.clear();
        if (faces.length > 0) {
          showStatus(`Ditemukan ${faces.length} wajah pada dokumen.`, 'success');
        } else {
          showStatus('Tidak ditemukan wajah pada dokumen ini.', 'info');
        }
      } catch (err) {
        showStatus('Gagal menjalankan deteksi wajah.', 'error');
      } finally {
        isScanningFaces.value = false;
      }
    } else {
      disabledAutoRegions.value.clear();
      showStatus('Deteksi wajah diaktifkan.', 'info');
    }
  } else {
    showStatus('Deteksi wajah dinonaktifkan.', 'info');
  }
}

// --- Drag-to-Select State ---
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragEndX = ref(0);
const dragEndY = ref(0);
const mouseDownX = ref(0);
const mouseDownY = ref(0);
const isReScanning = ref(false);
const scanRect = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const statusMessage = ref('');
const statusMessageClass = ref('bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300');

const CLICK_THRESHOLD = 5;
const MIN_DRAG_SIZE = 15;

const selectionRect = computed(() => {
  if (!isDragging.value) return null;
  const x = Math.min(dragStartX.value, dragEndX.value);
  const y = Math.min(dragStartY.value, dragEndY.value);
  const w = Math.abs(dragEndX.value - dragStartX.value);
  const h = Math.abs(dragEndY.value - dragStartY.value);
  return { x, y, w, h };
});

const onImageLoad = () => {
  if (docImage.value) {
    imgWidth.value = docImage.value.naturalWidth;
    imgHeight.value = docImage.value.naturalHeight;
    imageLoaded.value = true;
    zoomReset();
  }
};

function getRelativeCoords(e: MouseEvent): { x: number; y: number } {
  if (!imageContainer.value) return { x: 0, y: 0 };
  const rect = imageContainer.value.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoomLevel.value,
    y: (e.clientY - rect.top) / zoomLevel.value,
  };
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel.value + delta));
  }
}

function zoomIn() {
  zoomLevel.value = Math.min(ZOOM_MAX, zoomLevel.value + ZOOM_STEP);
}

function zoomOut() {
  zoomLevel.value = Math.max(ZOOM_MIN, zoomLevel.value - ZOOM_STEP);
}

function zoomReset() {
  if (!scrollContainer.value || imgWidth.value === 0) {
    zoomLevel.value = 1;
    return;
  }
  const containerWidth = scrollContainer.value.clientWidth - 48;
  zoomLevel.value = Math.min(1, Math.max(ZOOM_MIN, containerWidth / imgWidth.value));
}

function onMouseDown(e: MouseEvent) {
  if (isReScanning.value) return;
  const coords = getRelativeCoords(e);
  mouseDownX.value = coords.x;
  mouseDownY.value = coords.y;
  dragStartX.value = coords.x;
  dragStartY.value = coords.y;
  dragEndX.value = coords.x;
  dragEndY.value = coords.y;
  isDragging.value = true;
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  const coords = getRelativeCoords(e);
  dragEndX.value = Math.max(0, Math.min(coords.x, imgWidth.value));
  dragEndY.value = Math.max(0, Math.min(coords.y, imgHeight.value));
}

function findAutoRegionAtPoint(px: number, py: number): number {
  if (!enableFaceDetection.value) return -1;
  for (let i = activeFaceRegions.value.length - 1; i >= 0; i--) {
    const r = activeFaceRegions.value[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return i;
    }
  }
  return -1;
}

function findManualRegionAtPoint(px: number, py: number): number {
  for (let i = manualRegions.value.length - 1; i >= 0; i--) {
    const r = manualRegions.value[i];
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return i;
    }
  }
  return -1;
}

async function onMouseUp(e: MouseEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;

  const coords = getRelativeCoords(e);
  const dx = Math.abs(coords.x - mouseDownX.value);
  const dy = Math.abs(coords.y - mouseDownY.value);

  // Click (not drag) — toggle regions or words
  if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
    const manualIdx = findManualRegionAtPoint(coords.x, coords.y);
    if (manualIdx >= 0) {
      manualRegions.value.splice(manualIdx, 1);
      showStatus('Blok manual dihapus.', 'info');
      return;
    }

    const autoIdx = findAutoRegionAtPoint(coords.x, coords.y);
    if (autoIdx >= 0) {
      if (disabledAutoRegions.value.has(autoIdx)) {
        disabledAutoRegions.value.delete(autoIdx);
        showStatus('Sensor wajah diaktifkan kembali.', 'success');
      } else {
        disabledAutoRegions.value.add(autoIdx);
        showStatus('Sensor wajah dinonaktifkan.', 'info');
      }
      return;
    }

    const clickedIndex = findWordAtPoint(coords.x, coords.y);
    if (clickedIndex >= 0) {
      handleWordClick(clickedIndex);
    }
    return;
  }

  const rect = {
    x: Math.min(dragStartX.value, coords.x),
    y: Math.min(dragStartY.value, coords.y),
    w: Math.abs(coords.x - dragStartX.value),
    h: Math.abs(coords.y - dragStartY.value),
  };

  if (rect.w < MIN_DRAG_SIZE || rect.h < MIN_DRAG_SIZE) {
    showStatus('Area terlalu kecil. Silakan drag area yang lebih luas.', 'warning');
    return;
  }

  // --- Mode Kanvas Manual (Zero-OCR direct block) ---
  if (dragMode.value === 'block') {
    manualRegions.value.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    showStatus('Area berhasil diblokir manual untuk disensor.', 'success');
    return;
  }

  // --- Mode Re-scan OCR ---
  await runRegionScan(rect);
}

function findWordAtPoint(px: number, py: number): number {
  for (let i = editableWords.value.length - 1; i >= 0; i--) {
    const w = editableWords.value[i];
    if (px >= w.x && px <= w.x + w.width && py >= w.y && py <= w.y + w.height) {
      return i;
    }
  }
  return -1;
}

function handleWordClick(index: number) {
  const currentlyRedacted = isWordRedacted(index, editableWords.value[index]);
  if (currentlyRedacted) {
    unredactedIndices.value.add(index);
    manuallyRedactedIndices.value.delete(index);
    showStatus(`Batal menyensor "${editableWords.value[index].text}"`, 'info');
  } else {
    unredactedIndices.value.delete(index);
    manuallyRedactedIndices.value.add(index);
    showStatus(`Menyensor "${editableWords.value[index].text}"`, 'success');
  }
}

async function runRegionScan(rect: { x: number; y: number; w: number; h: number }) {
  isReScanning.value = true;
  scanRect.value = rect;
  showStatus('Memindai teks pada area pilihan…', 'info');

  try {
    const newWords = await processRegion(currentImageUrl.value, rect, editableWords.value);

    if (newWords.length === 0) {
      showStatus('Tidak ditemukan teks tambahan pada area ini.', 'warning');
      return;
    }

    const uniqueWords = newWords.filter((nw) => {
      return !editableWords.value.some((ew) => {
        const overlapX = Math.max(0, Math.min(ew.x + ew.width, nw.x + nw.width) - Math.max(ew.x, nw.x));
        const overlapY = Math.max(0, Math.min(ew.y + ew.height, nw.y + nw.height) - Math.max(ew.y, nw.y));
        const overlapArea = overlapX * overlapY;
        const nwArea = nw.width * nw.height;
        return overlapArea > nwArea * 0.5;
      });
    });

    if (uniqueWords.length === 0) {
      showStatus('Teks pada area ini sudah terdata.', 'info');
      return;
    }

    editableWords.value.push(...uniqueWords);

    foundSensitiveKeywords.value.forEach((item) => {
      if (!checkedKeywords.value.has(item.id)) {
        checkedKeywords.value.add(item.id);
      }
    });

    showStatus(`Berhasil mengekstrak ${uniqueWords.length} kata baru!`, 'success');
  } catch (error) {
    console.error('Region scan failed:', error);
    showStatus('Gagal memindai area. Silakan coba lagi.', 'error');
  } finally {
    isReScanning.value = false;
    scanRect.value = null;
  }
}

function showStatus(msg: string, type: 'info' | 'success' | 'warning' | 'error') {
  statusMessage.value = msg;
  const classes: Record<string, string> = {
    info: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    success: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    warning: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300',
    error: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',
  };
  statusMessageClass.value = classes[type] || classes.info;

  setTimeout(() => {
    statusMessage.value = '';
  }, 4000);
}

const handleConfirm = () => {
  const wordsWithRedaction = editableWords.value.map((w, i) => ({
    ...w,
    forceRedact: isWordRedacted(i, w),
  }));

  const activeAutoRegions = enableFaceDetection.value
    ? activeFaceRegions.value.filter((_, i) => !disabledAutoRegions.value.has(i))
    : [];

  const allRegions = [...activeAutoRegions, ...manualRegions.value];

  emit('confirm', {
    words: wordsWithRedaction,
    piiTypes: activePiiTypes.value,
    customText: customPiiText.value,
    regions: allRegions,
    redactionColor: selectedColor.value,
    rotatedImageUrl: currentImageUrl.value,
  });
};
</script>
