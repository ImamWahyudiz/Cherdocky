<template>
  <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
    <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700">
      <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-900 rounded-t-lg">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Verify Extracted Data</h2>
        <div class="space-x-2">
          <button class="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors" @click="$emit('cancel')">Cancel</button>
          <button class="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-750 dark:hover:bg-blue-700 rounded-md shadow-sm transition-colors" @click="handleConfirm">Confirm & Export</button>
        </div>
      </div>
      
      <div class="flex-1 flex overflow-hidden bg-gray-100 dark:bg-gray-950">
        <!-- Main content: image with overlays -->
        <div ref="scrollContainer" class="flex-1 overflow-auto p-4 relative bg-gray-100 dark:bg-gray-950" @wheel.prevent="onWheel">
          <!-- Container for image and overlays -->
          <div
            ref="imageContainer"
            class="relative inline-block origin-top-left select-none"
            :style="{ width: imgWidth + 'px', height: imgHeight + 'px', transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }"
            @mousedown.prevent="onMouseDown"
            @mousemove.prevent="onMouseMove"
            @mouseup.prevent="onMouseUp"
          >
            <img ref="docImage" :src="imageUrl" @load="onImageLoad" class="max-w-none shadow-md pointer-events-none" />
            
            <template v-if="imageLoaded">
              <!-- Existing word bounding boxes -->
              <div
                v-for="(word, index) in editableWords"
                :key="'word-' + index"
                class="absolute border border-solid flex items-center justify-center overflow-visible group pointer-events-none"
                :class="[
                  (manuallyRedactedIndices.has(index) || detectPII(word.text, activePiiTypes, customPiiText)) ? 'border-red-500 bg-red-500/40 z-20 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 
                  'border-green-500/10'
                ]"
                :style="{
                  left: word.x + 'px',
                  top: word.y + 'px',
                  width: word.width + 'px',
                  height: word.height + 'px'
                }"
              >
                <!-- Tooltip showing the extracted text on hover -->
                <div class="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-black text-white text-xs px-1 rounded whitespace-nowrap z-30">
                  {{ word.text }}
                </div>
              </div>

              <!-- Auto-detected face/shape regions (purple) -->
              <div
                v-for="(region, index) in detectedRegions"
                :key="'auto-region-' + index"
                class="absolute pointer-events-none z-20 transition-opacity"
                :class="disabledAutoRegions.has(index)
                  ? 'border border-dashed border-gray-400 bg-gray-400/10 opacity-40'
                  : 'border-2 border-purple-500 bg-purple-500/25 shadow-[0_0_10px_rgba(168,85,247,0.5)]'"
                :style="{
                  left: region.x + 'px',
                  top: region.y + 'px',
                  width: region.w + 'px',
                  height: region.h + 'px'
                }"
              >
                <span
                  v-if="!disabledAutoRegions.has(index)"
                  class="absolute -top-5 left-0 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap"
                >Face {{ index + 1 }}</span>
              </div>

              <!-- Manual blocked regions (red striped) -->
              <div
                v-for="(region, index) in manualRegions"
                :key="'manual-region-' + index"
                class="absolute pointer-events-none z-20 border-2 border-red-500"
                :style="{
                  left: region.x + 'px',
                  top: region.y + 'px',
                  width: region.w + 'px',
                  height: region.h + 'px',
                  backgroundImage: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.15), rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.35) 4px, rgba(239,68,68,0.35) 8px)'
                }"
              >
                <span class="absolute -top-5 left-0 bg-red-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap">Blocked</span>
              </div>

              <!-- Drag selection rectangle (color changes by mode) -->
              <div
                v-if="isDragging && selectionRect"
                class="absolute border-2 border-dashed z-30 pointer-events-none"
                :class="dragMode === 'block'
                  ? 'border-red-400 bg-red-400/10'
                  : 'border-blue-400 bg-blue-400/10'"
                :style="{
                  left: selectionRect.x + 'px',
                  top: selectionRect.y + 'px',
                  width: selectionRect.w + 'px',
                  height: selectionRect.h + 'px'
                }"
              ></div>

              <!-- Re-scanning indicator -->
              <div
                v-if="isReScanning && scanRect"
                class="absolute border-2 border-yellow-400 bg-yellow-400/20 z-30 pointer-events-none flex items-center justify-center"
                :style="{
                  left: scanRect.x + 'px',
                  top: scanRect.y + 'px',
                  width: scanRect.w + 'px',
                  height: scanRect.h + 'px'
                }"
              >
                <span class="bg-yellow-500 text-white text-xs px-2 py-1 rounded-full animate-pulse">Scanning...</span>
              </div>
            </template>
          </div>
        </div>

        <!-- Sidebar: settings -->
        <div class="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 overflow-y-auto flex flex-col gap-4 flex-shrink-0">
          <h3 class="font-medium text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Redaction Settings</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Select information to hide. Sensitive content is highlighted in bright red.</p>
          
          <div class="space-y-3">
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactNIK" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>NIK (16 Digits)</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactPhone" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>Phone Numbers</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactEmail" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>Email Addresses</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactID" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>ID / Passport</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactBank" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>Bank Account</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactPassword" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>Passwords / PINs</span></label>
            <label class="flex items-center space-x-2 text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"><input type="checkbox" v-model="redactCustom" class="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 dark:focus:ring-offset-gray-800 dark:bg-gray-700 w-4 h-4" /><span>Custom Text</span></label>
          </div>

          <div v-if="redactCustom" class="mt-2">
            <input v-model="customPiiText" type="text" placeholder="Text to redact..." class="block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border outline-none" />
          </div>

          <!-- Drag Mode toggle -->
          <div class="border-t border-gray-200 dark:border-gray-700 pt-3 mt-1">
            <h4 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Drag Mode</h4>
            <div class="flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-600">
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium transition-colors"
                :class="dragMode === 'rescan'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'"
                @click="dragMode = 'rescan'"
              >🔍 Re-scan</button>
              <button
                class="flex-1 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600"
                :class="dragMode === 'block'
                  ? 'bg-red-600 text-white'
                  : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'"
                @click="dragMode = 'block'"
              >🚫 Block</button>
            </div>
          </div>

          <!-- Region counts -->
          <div v-if="detectedRegions.length > 0 || manualRegions.length > 0" class="space-y-1">
            <div v-if="detectedRegions.length > 0" class="flex items-center justify-between text-xs">
              <span class="text-purple-600 dark:text-purple-400 font-medium">Auto-detected</span>
              <span class="text-gray-500 dark:text-gray-400">{{ detectedRegions.length - disabledAutoRegions.size }} / {{ detectedRegions.length }} faces</span>
            </div>
            <div v-if="manualRegions.length > 0" class="flex items-center justify-between text-xs">
              <span class="text-red-600 dark:text-red-400 font-medium">Manual blocks</span>
              <span class="text-gray-500 dark:text-gray-400">{{ manualRegions.length }} region(s)</span>
            </div>
          </div>

          <!-- Status messages -->
          <div v-if="statusMessage" class="mt-2 text-xs p-2 rounded" :class="statusMessageClass">
            {{ statusMessage }}
          </div>
        </div>
      </div>
      
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-lg text-sm text-gray-600 dark:text-gray-400 flex items-center justify-between">
        <span>{{ dragMode === 'block' ? 'Click region to unblock. Drag to block a shape or image.' : 'Click to redact. Drag to re-scan a missed area.' }}</span>
        <div class="flex items-center gap-2">
          <button @click="zoomOut" class="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-bold transition-colors">−</button>
          <span class="text-xs font-mono w-12 text-center">{{ Math.round(zoomLevel * 100) }}%</span>
          <button @click="zoomIn" class="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-bold transition-colors">+</button>
          <button @click="zoomReset" class="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs transition-colors">Fit</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { SpatialWord } from '~/utils/ocrEngine';
import { processRegion } from '~/utils/ocrEngine';
import { detectPII, type PIIType } from '~/utils/piiDetector';
import type { DocumentType } from '~/composables/useDocumentIngestion';
import type { DetectedRegion } from '~/utils/faceDetector';

const props = defineProps<{
  imageUrl: string;
  words: SpatialWord[];
  documentType: DocumentType;
  detectedRegions: DetectedRegion[];
}>();

const emit = defineEmits<{
  (e: 'confirm', data: { words: SpatialWord[], piiTypes: PIIType[], customText: string, regions: DetectedRegion[] }): void;
  (e: 'cancel'): void;
}>();

const editableWords = ref<SpatialWord[]>(JSON.parse(JSON.stringify(props.words)));
const imageContainer = ref<HTMLDivElement | null>(null);
const scrollContainer = ref<HTMLDivElement | null>(null);
const docImage = ref<HTMLImageElement | null>(null);
const imageLoaded = ref(false);
const imgWidth = ref(0);
const imgHeight = ref(0);
const zoomLevel = ref(1);
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.15;

const redactNIK = ref(true);
const redactPhone = ref(true);
const redactEmail = ref(true);
const redactID = ref(false);
const redactBank = ref(false);
const redactPassword = ref(false);
const redactCustom = ref(false);
const customPiiText = ref('');

const activePiiTypes = computed<PIIType[]>(() => {
  const types: PIIType[] = [];
  if (redactNIK.value) types.push('nik');
  if (redactPhone.value) types.push('phone');
  if (redactEmail.value) types.push('email');
  if (redactID.value) types.push('id');
  if (redactBank.value) types.push('bank');
  if (redactPassword.value) types.push('password');
  if (redactCustom.value) types.push('custom');
  return types;
});

const manuallyRedactedIndices = ref<Set<number>>(new Set());

// --- Drag mode & region blocking ---
type DragMode = 'rescan' | 'block';
const dragMode = ref<DragMode>('rescan');
const manualRegions = ref<DetectedRegion[]>([]);
const disabledAutoRegions = ref<Set<number>>(new Set());

// --- Drag-to-select state ---
const isDragging = ref(false);
const dragStartX = ref(0);
const dragStartY = ref(0);
const dragEndX = ref(0);
const dragEndY = ref(0);
const mouseDownX = ref(0); // raw mousedown position for click/drag disambiguation
const mouseDownY = ref(0);
const isReScanning = ref(false);
const scanRect = ref<{ x: number; y: number; w: number; h: number } | null>(null);
const statusMessage = ref('');
const statusMessageClass = ref('bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300');

const CLICK_THRESHOLD = 5; // px - distinguishes click from drag
const MIN_DRAG_SIZE = 20;  // px - minimum selection to trigger re-scan

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
  }
};

/**
 * Get mouse coordinates relative to the image container, accounting for zoom.
 */
function getRelativeCoords(e: MouseEvent): { x: number; y: number } {
  if (!imageContainer.value) return { x: 0, y: 0 };
  const rect = imageContainer.value.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoomLevel.value,
    y: (e.clientY - rect.top) / zoomLevel.value
  };
}

function onWheel(e: WheelEvent) {
  // Scroll wheel zooms the image
  const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
  zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomLevel.value + delta));
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
  // Fit to container width
  const containerWidth = scrollContainer.value.clientWidth - 32; // minus padding
  zoomLevel.value = Math.min(1, containerWidth / imgWidth.value);
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

/**
 * Find the index of a region (auto-detected or manual) that contains the given point.
 */
function findAutoRegionAtPoint(px: number, py: number): number {
  for (let i = props.detectedRegions.length - 1; i >= 0; i--) {
    const r = props.detectedRegions[i];
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
    // Priority 1: check manual blocked regions
    const manualIdx = findManualRegionAtPoint(coords.x, coords.y);
    if (manualIdx >= 0) {
      manualRegions.value.splice(manualIdx, 1);
      showStatus('Removed manual block.', 'info');
      return;
    }

    // Priority 2: check auto-detected regions
    const autoIdx = findAutoRegionAtPoint(coords.x, coords.y);
    if (autoIdx >= 0) {
      if (disabledAutoRegions.value.has(autoIdx)) {
        disabledAutoRegions.value.delete(autoIdx);
        showStatus('Re-enabled auto-detected region.', 'success');
      } else {
        disabledAutoRegions.value.add(autoIdx);
        showStatus('Disabled auto-detected region.', 'info');
      }
      return;
    }

    // Priority 3: toggle word redaction
    const clickedIndex = findWordAtPoint(coords.x, coords.y);
    if (clickedIndex >= 0) {
      handleWordClick(clickedIndex);
    }
    return;
  }

  // Drag — compute the selection rectangle
  const rect = {
    x: Math.min(dragStartX.value, coords.x),
    y: Math.min(dragStartY.value, coords.y),
    w: Math.abs(coords.x - dragStartX.value),
    h: Math.abs(coords.y - dragStartY.value)
  };

  // Ignore tiny drags
  if (rect.w < MIN_DRAG_SIZE || rect.h < MIN_DRAG_SIZE) {
    showStatus('Selection too small. Drag a larger area.', 'warning');
    return;
  }

  // --- Block mode: add manual region ---
  if (dragMode.value === 'block') {
    manualRegions.value.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    showStatus('Region blocked for redaction.', 'success');
    return;
  }

  // --- Re-scan mode (existing behavior) ---

  // Text-based PDFs: native text layer already captured everything
  if (props.documentType === 'text-pdf') {
    showStatus('Text-based PDF — all text already extracted natively.', 'info');
    return;
  }

  // Smart skip: check if the region is already well-covered by existing words
  if (isRegionAlreadyCovered(rect)) {
    showStatus('Area already scanned — no new text expected.', 'info');
    return;
  }

  // Run region re-OCR
  await runRegionScan(rect);
}

/**
 * Find the index of a word whose bounding box contains the given point.
 */
function findWordAtPoint(px: number, py: number): number {
  for (let i = editableWords.value.length - 1; i >= 0; i--) {
    const w = editableWords.value[i];
    if (px >= w.x && px <= w.x + w.width && py >= w.y && py <= w.y + w.height) {
      return i;
    }
  }
  return -1;
}

const handleWordClick = (index: number) => {
  if (manuallyRedactedIndices.value.has(index)) {
    manuallyRedactedIndices.value.delete(index);
  } else {
    manuallyRedactedIndices.value.add(index);
  }
};

/**
 * Check if a region is already well-covered by existing word bounding boxes.
 * "Well-covered" means >60% of the region area is occupied by existing words.
 */
function isRegionAlreadyCovered(rect: { x: number; y: number; w: number; h: number }): boolean {
  const regionArea = rect.w * rect.h;
  if (regionArea === 0) return true;

  let coveredArea = 0;
  for (const word of editableWords.value) {
    const overlapX = Math.max(0, Math.min(rect.x + rect.w, word.x + word.width) - Math.max(rect.x, word.x));
    const overlapY = Math.max(0, Math.min(rect.y + rect.h, word.y + word.height) - Math.max(rect.y, word.y));
    coveredArea += overlapX * overlapY;
  }

  return (coveredArea / regionArea) > 0.6;
}

/**
 * Compute Intersection over Union between two bounding boxes.
 */
function computeIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = overlapX * overlapY;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Run OCR on a selected rectangular region, de-duplicate, and merge results.
 */
async function runRegionScan(rect: { x: number; y: number; w: number; h: number }) {
  isReScanning.value = true;
  scanRect.value = rect;
  showStatus('Scanning selected region...', 'info');

  try {
    const newWords = await processRegion(props.imageUrl, rect);

    if (newWords.length === 0) {
      showStatus('No text found in the selected region.', 'warning');
      return;
    }

    // De-duplicate: discard new words that overlap >70% with existing words
    const uniqueWords = newWords.filter((nw) => {
      return !editableWords.value.some((ew) => computeIoU(nw, ew) > 0.7);
    });

    if (uniqueWords.length === 0) {
      showStatus('Region already fully scanned — no new text found.', 'info');
      return;
    }

    // Merge new words into the list
    editableWords.value.push(...uniqueWords);
    showStatus(`Found ${uniqueWords.length} new word(s) in the selected region!`, 'success');
  } catch (error) {
    console.error('Region scan failed:', error);
    showStatus('Region scan failed. Try again.', 'error');
  } finally {
    isReScanning.value = false;
    scanRect.value = null;
  }
}

function showStatus(msg: string, type: 'info' | 'success' | 'warning' | 'error') {
  statusMessage.value = msg;
  const classes: Record<string, string> = {
    info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    warning: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    error: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  };
  statusMessageClass.value = classes[type] || classes.info;

  // Auto-clear after 4 seconds
  setTimeout(() => {
    statusMessage.value = '';
  }, 4000);
}

const handleConfirm = () => {
  const wordsWithRedaction = editableWords.value.map((w, i) => ({
    ...w,
    forceRedact: manuallyRedactedIndices.value.has(i)
  }));

  // Merge active auto-detected regions with manual blocks
  const activeAutoRegions = props.detectedRegions
    .filter((_, i) => !disabledAutoRegions.value.has(i));
  const allRegions = [...activeAutoRegions, ...manualRegions.value];

  emit('confirm', {
    words: wordsWithRedaction,
    piiTypes: activePiiTypes.value,
    customText: customPiiText.value,
    regions: allRegions,
  });
};
</script>
