<template>
  <div class="fixed inset-0 w-full h-full bg-gray-950 z-50 flex flex-col overflow-hidden select-none">
    <!-- Top Header Bar -->
    <header class="px-3 sm:px-4 py-2 sm:py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex justify-between items-center z-20 flex-shrink-0 shadow-sm">
      <!-- Left Controls: 3 uniform buttons on mobile -->
      <div class="flex items-center gap-1.5 sm:gap-2">
        <!-- Desktop Title -->
        <div class="hidden md:flex items-center gap-2 mr-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-600"></span>
          <h2 class="text-sm lg:text-base font-bold text-gray-900 dark:text-white">
            Verifikasi & Sensor Dokumen
          </h2>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-medium uppercase">
            {{ documentType === 'text-pdf' ? 'PDF Teks Asli' : documentType === 'image-pdf' ? 'PDF Scan (OCR)' : 'Gambar / Foto' }}
          </span>
        </div>

        <!-- 1. Rotate Button (Uniform size on mobile) -->
        <button
          type="button"
          @click="rotateAllPagesClockwise"
          class="w-9 h-9 sm:w-auto sm:px-2.5 sm:py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-700 flex items-center justify-center gap-1.5 shadow-sm"
          title="Putar Dokumen 90°"
        >
          <RotateCw class="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <span class="hidden sm:inline">Putar</span>
        </button>

        <!-- 2. Canvas Mode Toggle Button (Only for image / scanned documents) -->
        <button
          v-if="documentType !== 'text-pdf'"
          type="button"
          @click="toggleDragMode"
          class="w-9 h-9 sm:w-auto sm:px-2.5 sm:py-1.5 text-xs font-medium rounded-lg transition-colors border flex items-center justify-center gap-1.5 shadow-sm"
          :class="dragMode === 'block'
            ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800'
            : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800'"
          :title="dragMode === 'block' ? 'Mode: Blokir Manual (Klik untuk ubah ke Scan)' : 'Mode: Scan Area (Klik untuk ubah ke Blokir)'"
        >
          <Square v-if="dragMode === 'block'" class="w-4 h-4 text-red-600 dark:text-red-400" />
          <Scan v-else class="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span class="hidden sm:inline">{{ dragMode === 'block' ? 'Mode Blok' : 'Mode Scan' }}</span>
        </button>

        <!-- 3. Fit / Reset Zoom Button (Uniform size on mobile) -->
        <button
          type="button"
          @click="zoomReset"
          class="w-9 h-9 sm:w-auto sm:px-2.5 sm:py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-700 flex items-center justify-center gap-1.5 shadow-sm"
          title="Sesuaikan Ukuran Layar (Fit)"
        >
          <Maximize2 class="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <span class="hidden sm:inline">Pas Layar</span>
        </button>

        <!-- Add Image Button (if image mode) -->
        <label
          v-if="documentType === 'image'"
          class="hidden sm:flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/30 hover:bg-purple-100 dark:hover:bg-purple-900/50 rounded-lg transition-colors border border-purple-200 dark:border-purple-800 cursor-pointer shadow-sm"
          title="Tambah Gambar Baru"
        >
          <Plus class="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span>Tambah Gambar</span>
          <input
            type="file"
            multiple
            accept="image/jpeg, image/png"
            class="hidden"
            @change="handleAdditionalFilesSelect"
          />
        </label>
      </div>

      <!-- Right Controls: 2 buttons (Cancel is uniform, Confirm is prominent) -->
      <div class="flex items-center gap-1.5 sm:gap-2">
        <!-- 4. Cancel Button (Uniform size on mobile, text on sm+) -->
        <button
          type="button"
          @click="$emit('cancel')"
          class="w-9 h-9 sm:w-auto sm:px-3.5 sm:py-1.5 text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors border border-gray-300 dark:border-gray-700 flex items-center justify-center gap-1.5 shadow-sm"
          title="Batal dan kembali ke beranda"
        >
          <X class="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span class="hidden sm:inline">Batal</span>
        </button>

        <!-- 5. Confirm & Export Button (Distinct, prominent styling) -->
        <button
          type="button"
          @click="handleConfirm"
          class="h-9 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-md transition-all flex items-center justify-center gap-1.5"
          title="Konfirmasi sensor dan ekspor dokumen"
        >
          <Check class="w-4 h-4 text-white stroke-[2.5]" />
          <span>Konfirmasi & Ekspor</span>
        </button>
      </div>
    </header>

    <!-- Main Workspace Area -->
    <div class="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
      <!-- Document Canvas Viewport (Scrollable & Bounded) -->
      <main
        ref="scrollContainer"
        class="overflow-auto p-3 sm:p-6 relative bg-gray-950 flex-1 h-[48vh] sm:h-[54vh] lg:h-auto border-b lg:border-b-0 border-gray-800 flex justify-center items-start touch-none"
        :class="dragMode === 'block' ? 'cursor-crosshair' : 'cursor-default'"
        @wheel="onWheel"
      >
        <!-- Canvas Transform Container with Bounded Width -->
        <div
          ref="canvasStack"
          class="flex flex-col items-center gap-6 py-4 transition-transform duration-75 origin-top"
          :style="{
            transform: `scale(${zoomLevel})`,
            transformOrigin: 'top center'
          }"
        >
          <!-- Multi-Page / Multi-Image Sheet List -->
          <div
            v-for="(page, pIdx) in localPages"
            :key="page.id"
            :ref="(el) => { if (el) pageElements[page.id] = el as HTMLDivElement }"
            class="relative bg-white shadow-2xl rounded-sm transition-all flex-shrink-0"
            :style="{
              width: page.width + 'px',
              height: page.height + 'px'
            }"
            @pointerdown="(e) => onPointerDown(e, page)"
            @pointermove="(e) => onPointerMove(e, page)"
            @pointerup="(e) => onPointerUp(e, page)"
            @pointercancel="onPointerCancel"
          >
            <!-- Page Header Index Badge -->
            <div class="absolute -top-7 left-0 right-0 flex items-center justify-between text-xs text-gray-400 font-medium px-1 pointer-events-none">
              <div class="flex items-center gap-1.5">
                <span class="bg-gray-800 text-gray-200 text-[11px] px-2 py-0.5 rounded shadow border border-gray-700">
                  {{ page.label || `Halaman ${pIdx + 1}` }}
                </span>
                <span class="text-[11px] text-gray-400">
                  ({{ page.width }} × {{ page.height }} px)
                </span>
              </div>

              <!-- Per-Page Quick Actions -->
              <div class="flex items-center gap-1 pointer-events-auto">
                <button
                  type="button"
                  @click.stop="rotateSinglePage(page.id)"
                  class="bg-gray-800 hover:bg-gray-700 text-gray-300 p-1 rounded transition-colors border border-gray-700"
                  title="Putar halaman ini 90°"
                >
                  <RotateCw class="w-3.5 h-3.5" />
                </button>
                <button
                  v-if="localPages.length > 1 && documentType === 'image'"
                  type="button"
                  @click.stop="removeSinglePage(page.id)"
                  class="bg-red-950/80 hover:bg-red-900 text-red-300 p-1 rounded transition-colors border border-red-800"
                  title="Hapus gambar ini"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <!-- Page Background Preview Image -->
            <img
              :src="page.previewUrl"
              class="w-full h-full object-contain pointer-events-none block select-none bg-white"
              draggable="false"
            />

            <!-- Bounding Box Layer -->
            <!-- 1. Text Bounding Boxes (Clickable directly on any word) -->
            <template v-for="word in getWordsForPage(page.pageIndex)" :key="'word-' + page.id + '-' + word.globalIndex">
              <div
                class="absolute flex items-center justify-center overflow-visible group transition-all"
                :class="[
                  isWordRedacted(word.globalIndex, word)
                    ? 'border-2 border-red-500 bg-red-500/50 z-20 shadow-[0_0_10px_rgba(239,68,68,0.85)] ring-1 ring-red-400/50 cursor-pointer pointer-events-auto'
                    : documentType === 'text-pdf'
                      ? 'border border-transparent hover:border-blue-400/60 hover:bg-blue-400/15 cursor-pointer pointer-events-auto z-10'
                      : 'border border-emerald-500/15 bg-emerald-500/5 pointer-events-none z-10'
                ]"
                :style="{
                  left: word.x + 'px',
                  top: word.y + 'px',
                  width: word.width + 'px',
                  height: word.height + 'px'
                }"
                @pointerdown.stop
                @click.stop="toggleWord(word.globalIndex)"
              >
                <!-- Tooltip hover on desktop -->
                <div class="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-black/90 text-white text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap z-30 pointer-events-none shadow-lg">
                  {{ word.text }}
                </div>
              </div>
            </template>

            <!-- 2. Face Detection Regions (Purple) -->
            <template v-if="enableFaceDetection">
              <div
                v-for="(region, fIdx) in getFaceRegionsForPage(page.pageIndex)"
                :key="'face-' + pIdx + '-' + fIdx"
                class="absolute pointer-events-none z-20 transition-opacity"
                :class="disabledAutoRegions.has(region.globalIndex)
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
                  v-if="!disabledAutoRegions.has(region.globalIndex)"
                  class="absolute -top-5 left-0 bg-purple-600 text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap font-medium shadow"
                >
                  Wajah {{ fIdx + 1 }}
                </span>
              </div>
            </template>

            <!-- 3. Manual Block Regions (Selected Color / Striped) -->
            <div
              v-for="(region, mIdx) in getManualRegionsForPage(page.pageIndex)"
              :key="'manual-' + pIdx + '-' + mIdx"
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

            <!-- 4. Active Drag Selection Rectangle (Only on the interacting page) -->
            <div
              v-if="activeDragPageId === page.id && isDragging && selectionRect"
              class="absolute border-2 border-dashed z-30 pointer-events-none"
              :class="dragMode === 'block'
                ? 'border-red-400 bg-red-400/25'
                : 'border-blue-400 bg-blue-400/25'"
              :style="{
                left: selectionRect.x + 'px',
                top: selectionRect.y + 'px',
                width: selectionRect.w + 'px',
                height: selectionRect.h + 'px'
              }"
            ></div>

            <!-- 5. Active Region Re-Scan OCR Spinner -->
            <div
              v-if="isReScanning && scanPageId === page.id && scanRect"
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
          </div>
        </div>
      </main>

      <!-- Sidebar / Bottom Controls -->
      <aside class="w-full lg:w-84 xl:w-96 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 overflow-y-auto flex flex-col gap-4 flex-1 lg:flex-none flex-shrink-0 z-10 shadow-sm">
        <!-- Interactive Canvas Mode Switcher -->
        <div class="bg-gray-100 dark:bg-gray-800 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
          <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5 px-1">
            {{ documentType === 'text-pdf' ? 'Mode Interaksi PDF Teks' : 'Mode Interaksi Kanvas' }}
          </div>
          <div v-if="documentType !== 'text-pdf'" class="grid grid-cols-2 gap-1.5">
            <button
              class="px-2.5 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5"
              :class="dragMode === 'rescan'
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'"
              @click="dragMode = 'rescan'"
            >
              <Scan class="w-4 h-4" />
              <span>Scan Area</span>
            </button>
            <button
              class="px-2.5 py-2 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5"
              :class="dragMode === 'block'
                ? 'bg-red-600 text-white shadow-sm font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'"
              @click="dragMode = 'block'"
            >
              <Square class="w-4 h-4" />
              <span>Blok Manual</span>
            </button>
          </div>
          <div v-else class="flex items-center gap-2 p-2 bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-md">
            <CheckCircle2 class="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <span class="text-xs font-semibold text-blue-800 dark:text-blue-200">
              PDF Teks Digital (Tanpa OCR)
            </span>
          </div>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 px-1">
            {{ documentType === 'text-pdf'
              ? 'Seluruh teks digital telah dibaca otomatis. Klik langsung pada kata apa pun untuk menyensor/batal sensor, atau tarik kotak untuk memblokir teks & area.'
              : dragMode === 'block'
                ? 'Tarik/Drag untuk memblokir langsung gambar, tabel, atau teks buram.'
                : 'Tarik/Drag untuk memindai ulang teks yang terlewat pada area yang dipilih.' }}
          </p>
        </div>

        <!-- Redaction Color Selection -->
        <div class="border-b border-gray-200 dark:border-gray-800 pb-3">
          <label class="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Warna Sensor / Penghalang:
          </label>
          <div class="flex items-center gap-2">
            <button
              v-for="c in colorPalette"
              :key="c.value"
              class="w-7 h-7 rounded-full border-2 transition-transform relative flex items-center justify-center"
              :class="selectedColor === c.value ? 'scale-110 border-blue-500 shadow-md ring-2 ring-blue-400/40' : 'border-gray-300 dark:border-gray-600 hover:scale-105'"
              :style="{ backgroundColor: c.value }"
              :title="c.label"
              @click="selectedColor = c.value"
            >
              <Check v-if="selectedColor === c.value" class="w-3.5 h-3.5" :class="c.value === '#ffffff' ? 'text-black' : 'text-white'" />
            </button>
            <span class="text-xs text-gray-500 dark:text-gray-400 ml-1.5 font-medium">
              {{ colorPalette.find(c => c.value === selectedColor)?.label }}
            </span>
          </div>
        </div>

        <!-- Face Detection On-Demand Toggle -->
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
            <span v-if="isScanningFaces" class="text-xs text-purple-600 dark:text-purple-400 animate-pulse font-medium flex items-center gap-1">
              <Loader2 class="w-3.5 h-3.5 animate-spin" />
              Memindai…
            </span>
          </label>
          <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
            Pindai foto wajah atau pasfoto pada dokumen dan tandai untuk disensor.
          </p>
        </div>

        <!-- Sensitive Data Patterns Detected via Regex -->
        <div class="flex flex-col border-b border-gray-200 dark:border-gray-800 pb-3">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-xs text-gray-900 dark:text-white uppercase tracking-wider">
              Pola Sensitif Terdeteksi
            </h3>
            <div class="flex items-center gap-1.5 text-[11px]" v-if="foundSensitiveKeywords.length > 0">
              <button
                class="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                @click="selectAllKeywords"
              >Semua</button>
              <span class="text-gray-400">|</span>
              <button
                class="text-gray-500 dark:text-gray-400 hover:underline font-medium"
                @click="deselectAllKeywords"
              >Batal</button>
            </div>
          </div>

          <div v-if="foundSensitiveKeywords.length > 0" class="space-y-1.5 max-h-48 overflow-y-auto pr-1">
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
                {{ item.count }} kata
              </span>
            </label>
          </div>

          <div v-else class="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-dashed border-gray-200 dark:border-gray-700 text-center">
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Tidak ada pola sensitif otomatis (NIK, Telepon, Email, Tanggal) yang terdeteksi.
            </p>
          </div>
        </div>

        <!-- Manual Selected Words Section (Populates dynamically as user clicks/selects words on canvas) -->
        <div v-if="manualSelectedWordsList.length > 0" class="flex flex-col border-b border-gray-200 dark:border-gray-800 pb-3">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              <h3 class="font-semibold text-xs text-gray-900 dark:text-white uppercase tracking-wider">
                Kata Pilihan Manual ({{ manualSelectedWordsList.length }})
              </h3>
            </div>
            <button
              type="button"
              class="text-[11px] text-red-600 dark:text-red-400 hover:underline font-medium"
              @click="clearAllManualSelectedWords"
            >
              Hapus Semua
            </button>
          </div>

          <div class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
            <div
              v-for="item in manualSelectedWordsList"
              :key="item.text"
              class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-800 dark:text-red-200 text-xs shadow-sm"
            >
              <span class="font-medium max-w-[130px] truncate" :title="item.text">
                {{ item.text }}
              </span>
              <span v-if="item.count > 1" class="text-[10px] bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-200 px-1 rounded-full font-bold">
                {{ item.count }}x
              </span>
              <button
                type="button"
                @click.stop="removeManualSelectedWord(item.indices)"
                class="text-red-500 hover:text-red-700 dark:hover:text-red-300 p-0.5 rounded transition-colors"
                title="Batal sensor kata ini"
              >
                <X class="w-3 h-3 stroke-[2.5]" />
              </button>
            </div>
          </div>
        </div>

        <!-- Custom Keyword Input -->
        <div>
          <label class="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            Kata atau kata kunci:
          </label>
          <input
            v-model="customPiiText"
            type="text"
            placeholder="Ketik teks yang ingin disensor..."
            class="block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-white text-xs px-3 py-2 border outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm"
          />
        </div>

        <!-- Stats Summary -->
        <div class="text-[11px] text-gray-500 dark:text-gray-400 space-y-1 pt-1 border-t border-gray-200 dark:border-gray-800">
          <div class="flex justify-between">
            <span>Total Lembar / Halaman:</span>
            <span class="font-medium text-gray-700 dark:text-gray-300">{{ localPages.length }}</span>
          </div>
          <div class="flex justify-between">
            <span>Total Kata Terdeteksi:</span>
            <span class="font-medium text-gray-700 dark:text-gray-300">{{ editableWords.length }}</span>
          </div>
          <div class="flex justify-between">
            <span>Kata yang Disensor:</span>
            <span class="font-medium text-red-600 dark:text-red-400">{{ totalRedactedWordsCount }} kata</span>
          </div>
          <div class="flex justify-between" v-if="allManualRegions.length > 0">
            <span>Blok Manual:</span>
            <span class="font-medium text-red-600 dark:text-red-400">{{ allManualRegions.length }} area</span>
          </div>
          <div class="flex justify-between" v-if="enableFaceDetection && allFaceRegions.length > 0">
            <span>Wajah Terdeteksi:</span>
            <span class="font-medium text-purple-600 dark:text-purple-400">{{ allFaceRegions.length - disabledAutoRegions.size }} wajah</span>
          </div>
        </div>

        <!-- Status Flash Message -->
        <div v-if="statusMessage" class="text-xs p-2.5 rounded-md" :class="statusMessageClass">
          {{ statusMessage }}
        </div>
      </aside>
    </div>

    <!-- Bottom Status & Zoom Bar -->
    <footer class="px-4 py-2 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-between gap-2 z-20 flex-shrink-0">
      <div class="flex items-center gap-2 truncate">
        <span class="font-medium text-gray-800 dark:text-gray-200 truncate">
          {{ dragMode === 'block' ? 'Klik untuk hapus blok. Drag untuk blokir area.' : 'Klik untuk sensor/batal kata. Drag untuk scan teks baru.' }}
        </span>
      </div>

      <!-- Zoom Slider Controls -->
      <div class="flex items-center gap-1.5 ml-auto flex-shrink-0">
        <button
          @click="zoomOut"
          class="w-7 h-7 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold transition-colors"
        >
          <ZoomOut class="w-3.5 h-3.5" />
        </button>
        <span class="font-mono w-10 text-center font-semibold text-gray-800 dark:text-gray-200 text-xs">
          {{ Math.round(zoomLevel * 100) }}%
        </span>
        <button
          @click="zoomIn"
          class="w-7 h-7 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 font-bold transition-colors"
        >
          <ZoomIn class="w-3.5 h-3.5" />
        </button>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import {
  RotateCw,
  Scan,
  Square,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Check,
  X,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-vue-next';
import type { SpatialWord } from '~/utils/ocrEngine';
import { processRegion } from '~/utils/ocrEngine';
import {
  findContextualPIIWordIndices,
  extractFoundSensitiveKeywords,
  type PIIType,
  type FoundKeywordItem,
} from '~/utils/piiDetector';
import type { DocumentType, DocumentPageItem } from '~/composables/useDocumentIngestion';
import { detectFaces, type DetectedRegion } from '~/utils/faceDetector';

const props = defineProps<{
  pages: DocumentPageItem[];
  imageUrl?: string;
  words: SpatialWord[];
  documentType: DocumentType;
  detectedRegions?: DetectedRegion[];
}>();

const emit = defineEmits<{
  (e: 'confirm', data: {
    pages: DocumentPageItem[];
    words: SpatialWord[];
    piiTypes: PIIType[];
    customText: string;
    regions: DetectedRegion[];
    redactionColor: string;
  }): void;
  (e: 'cancel'): void;
  (e: 'add-images', files: File[]): void;
}>();

// --- Local Pages State ---
const localPages = ref<DocumentPageItem[]>([]);
const pageElements = ref<Record<string, HTMLDivElement>>({});
const editableWords = ref<(SpatialWord & { globalIndex: number })[]>([]);
const scrollContainer = ref<HTMLDivElement | null>(null);
const canvasStack = ref<HTMLDivElement | null>(null);

// --- Viewport & Zoom State ---
const zoomLevel = ref(1);
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.5;
const ZOOM_STEP = 0.15;

// --- Drag and Pointer State ---
type DragMode = 'rescan' | 'block';
const dragMode = ref<DragMode>('rescan');
const isDragging = ref(false);
const activeDragPageId = ref<string | null>(null);
const pointerStartX = ref(0);
const pointerStartY = ref(0);
const pointerCurrentX = ref(0);
const pointerCurrentY = ref(0);

const isReScanning = ref(false);
const scanPageId = ref<string | null>(null);
const scanRect = ref<{ x: number; y: number; w: number; h: number } | null>(null);

// --- Redaction Color Palette ---
const colorPalette = [
  { label: 'Hitam', value: '#000000' },
  { label: 'Putih', value: '#ffffff' },
  { label: 'Abu-abu', value: '#374151' },
  { label: 'Navy', value: '#1e3a8a' },
  { label: 'Merah', value: '#b91c1c' },
];
const selectedColor = ref<string>('#000000');

// --- Custom Text Search & Data Keywords ---
const customPiiText = ref('');
const checkedKeywords = ref<Set<string>>(new Set());
const manuallyRedactedIndices = ref<Set<number>>(new Set());
const unredactedIndices = ref<Set<number>>(new Set());

// --- Face Detection State ---
const enableFaceDetection = ref(false);
const isScanningFaces = ref(false);
const disabledAutoRegions = ref<Set<number>>(new Set());

// --- Status Flash Notification ---
const statusMessage = ref('');
const statusMessageClass = ref('bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300');

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
  }, 3500);
}

const foundSensitiveKeywords = computed<FoundKeywordItem[]>(() => {
  return extractFoundSensitiveKeywords(editableWords.value);
});

const activePiiTypes = computed<PIIType[]>(() => {
  const types: PIIType[] = ['nik', 'phone', 'email', 'id', 'bank', 'dob', 'ttl', 'bpjs', 'npwp', 'date'];
  if (customPiiText.value.trim()) types.push('custom');
  return types;
});

// Precompute standalone concrete regex matches only when words or types change
const standalonePiiIndices = computed<Set<number>>(() => {
  return findContextualPIIWordIndices(
    editableWords.value,
    activePiiTypes.value,
    customPiiText.value
  );
});

// Fast Set union combining standalone regexes and checked keyword indices
const autoDetectedPiiIndices = computed<Set<number>>(() => {
  const indices = new Set<number>(standalonePiiIndices.value);

  for (const item of foundSensitiveKeywords.value) {
    if (checkedKeywords.value.has(item.id)) {
      for (const idx of item.wordIndices) {
        indices.add(idx);
      }
    }
  }

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

function isWordRedacted(globalIndex: number, _word?: SpatialWord): boolean {
  if (unredactedIndices.value.has(globalIndex)) return false;
  if (manuallyRedactedIndices.value.has(globalIndex)) return true;
  return autoDetectedPiiIndices.value.has(globalIndex);
}

const totalRedactedWordsCount = computed(() => {
  return editableWords.value.filter((w) => isWordRedacted(w.globalIndex, w)).length;
});

function syncEditableWords() {
  const flattened: (SpatialWord & { globalIndex: number })[] = [];
  let indexCounter = 0;

  localPages.value.forEach((page) => {
    (page.words || []).forEach((w) => {
      flattened.push({
        ...w,
        pageIndex: page.pageIndex,
        globalIndex: indexCounter++,
      });
    });
  });

  editableWords.value = flattened;
  manuallyRedactedIndices.value.clear();
  unredactedIndices.value.clear();

  // Initialize checked keywords once on sync
  const initialIds = new Set<string>();
  foundSensitiveKeywords.value.forEach((item) => {
    initialIds.add(item.id);
  });
  checkedKeywords.value = initialIds;
}

// Synchronize pages and words from props
watch(
  () => props.pages,
  (newPages) => {
    if (newPages && newPages.length > 0) {
      localPages.value = JSON.parse(JSON.stringify(newPages));
    } else if (props.imageUrl) {
      localPages.value = [
        {
          id: 'page-1',
          pageIndex: 1,
          label: 'Halaman 1',
          type: 'image',
          previewUrl: props.imageUrl,
          width: 800,
          height: 1100,
          rotation: 0,
          words: props.words || [],
          manualRegions: [],
          faceRegions: props.detectedRegions || [],
        },
      ];
    }
    syncEditableWords();
  },
  { immediate: true, deep: true }
);

const allManualRegions = computed<DetectedRegion[]>(() => {
  return localPages.value.flatMap((p) =>
    (p.manualRegions || []).map((r) => ({ ...r, pageIndex: p.pageIndex }))
  );
});

const allFaceRegions = computed<DetectedRegion[]>(() => {
  return localPages.value.flatMap((p) =>
    (p.faceRegions || []).map((r) => ({ ...r, pageIndex: p.pageIndex }))
  );
});

function getWordsForPage(pageIndex: number) {
  return editableWords.value.filter((w) => (w.pageIndex || 1) === pageIndex);
}

function getFaceRegionsForPage(pageIndex: number) {
  return allFaceRegions.value
    .map((r, i) => ({ ...r, globalIndex: i }))
    .filter((r) => ((r as any).pageIndex || 1) === pageIndex);
}

function getManualRegionsForPage(pageIndex: number) {
  const page = localPages.value.find((p) => p.pageIndex === pageIndex);
  return page ? page.manualRegions || [] : [];
}

// --- Toggle / Selection Methods (Clean 0ms Instant Updates) ---
function toggleKeywordSelection(id: string) {
  const nextChecked = new Set(checkedKeywords.value);
  const item = foundSensitiveKeywords.value.find((k) => k.id === id);

  if (nextChecked.has(id)) {
    nextChecked.delete(id);
    if (item) {
      item.wordIndices.forEach((idx) => {
        unredactedIndices.value.add(idx);
        manuallyRedactedIndices.value.delete(idx);
      });
    }
  } else {
    nextChecked.add(id);
    if (item) {
      item.wordIndices.forEach((idx) => {
        unredactedIndices.value.delete(idx);
        manuallyRedactedIndices.value.delete(idx);
      });
    }
  }

  checkedKeywords.value = nextChecked;
}

function selectAllKeywords() {
  const nextChecked = new Set<string>();
  foundSensitiveKeywords.value.forEach((item) => {
    nextChecked.add(item.id);
    item.wordIndices.forEach((idx) => {
      unredactedIndices.value.delete(idx);
      manuallyRedactedIndices.value.delete(idx);
    });
  });
  checkedKeywords.value = nextChecked;
}

function deselectAllKeywords() {
  foundSensitiveKeywords.value.forEach((item) => {
    item.wordIndices.forEach((idx) => {
      unredactedIndices.value.add(idx);
      manuallyRedactedIndices.value.delete(idx);
    });
  });
  checkedKeywords.value = new Set();
}

function toggleDragMode() {
  dragMode.value = dragMode.value === 'rescan' ? 'block' : 'rescan';
}

function toggleWord(globalIndex: number) {
  const word = editableWords.value.find((w) => w.globalIndex === globalIndex);
  if (!word) return;
  const currentlyRedacted = isWordRedacted(globalIndex, word);

  const nextUnredacted = new Set(unredactedIndices.value);
  const nextManual = new Set(manuallyRedactedIndices.value);

  if (currentlyRedacted) {
    nextUnredacted.add(globalIndex);
    nextManual.delete(globalIndex);
    showStatus(`Batal menyensor "${word.text}"`, 'info');
  } else {
    nextUnredacted.delete(globalIndex);
    nextManual.add(globalIndex);
    showStatus(`Menyensor "${word.text}"`, 'success');
  }

  unredactedIndices.value = nextUnredacted;
  manuallyRedactedIndices.value = nextManual;
}

interface ManualSelectedItem {
  text: string;
  count: number;
  indices: number[];
  pageNumbers: number[];
}

const manualSelectedWordsList = computed<ManualSelectedItem[]>(() => {
  const map = new Map<string, { count: number; indices: number[]; pages: Set<number> }>();

  manuallyRedactedIndices.value.forEach((idx) => {
    const word = editableWords.value.find((w) => w.globalIndex === idx);
    if (word && word.text.trim()) {
      const key = word.text.trim();
      if (!map.has(key)) {
        map.set(key, { count: 0, indices: [], pages: new Set() });
      }
      const item = map.get(key)!;
      item.count++;
      item.indices.push(idx);
      item.pages.add(word.pageIndex || 1);
    }
  });

  return Array.from(map.entries()).map(([text, data]) => ({
    text,
    count: data.count,
    indices: data.indices,
    pageNumbers: Array.from(data.pages).sort((a, b) => a - b),
  }));
});

function removeManualSelectedWord(indices: number[]) {
  const nextManual = new Set(manuallyRedactedIndices.value);
  const nextUnredacted = new Set(unredactedIndices.value);

  indices.forEach((idx) => {
    nextManual.delete(idx);
    nextUnredacted.add(idx);
  });

  manuallyRedactedIndices.value = nextManual;
  unredactedIndices.value = nextUnredacted;
  showStatus('Kata pilihan manual dibatalkan.', 'info');
}

function clearAllManualSelectedWords() {
  const nextUnredacted = new Set(unredactedIndices.value);
  manuallyRedactedIndices.value.forEach((idx) => {
    nextUnredacted.add(idx);
  });

  unredactedIndices.value = nextUnredacted;
  manuallyRedactedIndices.value = new Set();
  showStatus('Semua pilihan kata manual dibersihkan.', 'info');
}

// --- Zoom & Navigation with Boundaries ---
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
  if (!scrollContainer.value || localPages.value.length === 0) {
    zoomLevel.value = 1;
    return;
  }
  const maxPageWidth = Math.max(...localPages.value.map((p) => p.width || 800));
  const containerWidth = scrollContainer.value.clientWidth - 48;
  zoomLevel.value = Math.min(1, Math.max(ZOOM_MIN, containerWidth / maxPageWidth));
}

// --- Rotation Methods (Mathematical 90° Transform without reloading) ---
function rotatePageCoords(page: DocumentPageItem) {
  const oldW = page.width;
  const oldH = page.height;

  // Swap canvas dimensions
  page.width = oldH;
  page.height = oldW;
  page.rotation = ((page.rotation || 0) + 90) % 360;

  // Transform words on this page
  editableWords.value = editableWords.value.map((w) => {
    if ((w.pageIndex || 1) !== page.pageIndex) return w;
    return {
      ...w,
      x: oldH - (w.y + w.height),
      y: w.x,
      width: w.height,
      height: w.width,
    };
  });

  // Transform manual regions
  page.manualRegions = (page.manualRegions || []).map((r) => ({
    x: oldH - (r.y + r.h),
    y: r.x,
    w: r.h,
    h: r.w,
  }));

  // Transform face regions
  page.faceRegions = (page.faceRegions || []).map((r) => ({
    x: oldH - (r.y + r.h),
    y: r.x,
    w: r.h,
    h: r.w,
    score: r.score,
  }));

  // Rotate preview image on an offscreen canvas
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = oldH;
    canvas.height = oldW;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.translate(oldH / 2, oldW / 2);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, -oldW / 2, -oldH / 2);
      page.previewUrl = canvas.toDataURL('image/png');
    }
  };
  img.src = page.previewUrl;
}

function rotateSinglePage(pageId: string) {
  const page = localPages.value.find((p) => p.id === pageId);
  if (page) {
    rotatePageCoords(page);
    showStatus(`${page.label} diputar 90°.`, 'info');
  }
}

function rotateAllPagesClockwise() {
  localPages.value.forEach((page) => {
    rotatePageCoords(page);
  });
  showStatus('Semua halaman diputar 90°.', 'info');
}

function removeSinglePage(pageId: string) {
  const idx = localPages.value.findIndex((p) => p.id === pageId);
  if (idx >= 0) {
    const removed = localPages.value.splice(idx, 1)[0];
    syncEditableWords();
    showStatus(`${removed.label} telah dihapus.`, 'info');
  }
}

function handleAdditionalFilesSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const fileList = Array.from(target.files);
    emit('add-images', fileList);
    target.value = '';
  }
}

// --- Face Detection Toggle ---
async function handleFaceDetectionToggle() {
  if (enableFaceDetection.value) {
    if (allFaceRegions.value.length === 0) {
      isScanningFaces.value = true;
      showStatus('Menjalankan deteksi wajah…', 'info');
      try {
        for (const page of localPages.value) {
          const img = new Image();
          await new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = page.previewUrl;
          });
          const faces = await detectFaces(img);
          page.faceRegions = faces;
        }
        disabledAutoRegions.value.clear();
        const totalFaces = allFaceRegions.value.length;
        if (totalFaces > 0) {
          showStatus(`Ditemukan ${totalFaces} wajah pada dokumen.`, 'success');
        } else {
          showStatus('Tidak ditemukan wajah pada dokumen.', 'info');
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

// --- Pointer Events for Universal Touch & Mouse Drag ---
const CLICK_THRESHOLD = 8;
const MIN_DRAG_SIZE = 12;

function getPageRelativeCoords(e: PointerEvent, pageEl: HTMLElement): { x: number; y: number } {
  const rect = pageEl.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoomLevel.value,
    y: (e.clientY - rect.top) / zoomLevel.value,
  };
}

const selectionRect = computed(() => {
  if (!isDragging.value) return null;
  const x = Math.min(pointerStartX.value, pointerCurrentX.value);
  const y = Math.min(pointerStartY.value, pointerCurrentY.value);
  const w = Math.abs(pointerCurrentX.value - pointerStartX.value);
  const h = Math.abs(pointerCurrentY.value - pointerStartY.value);
  return { x, y, w, h };
});

function onPointerDown(e: PointerEvent, page: DocumentPageItem) {
  if (isReScanning.value) return;
  const pageEl = pageElements.value[page.id];
  if (!pageEl) return;

  activeDragPageId.value = page.id;
  const coords = getPageRelativeCoords(e, pageEl);
  pointerStartX.value = coords.x;
  pointerStartY.value = coords.y;
  pointerCurrentX.value = coords.x;
  pointerCurrentY.value = coords.y;
  isDragging.value = true;

  try {
    pageEl.setPointerCapture(e.pointerId);
  } catch (_) {}
}

function onPointerMove(e: PointerEvent, page: DocumentPageItem) {
  if (!isDragging.value || activeDragPageId.value !== page.id) return;
  const pageEl = pageElements.value[page.id];
  if (!pageEl) return;

  const coords = getPageRelativeCoords(e, pageEl);
  pointerCurrentX.value = Math.max(0, Math.min(coords.x, page.width));
  pointerCurrentY.value = Math.max(0, Math.min(coords.y, page.height));
}

function onPointerCancel() {
  isDragging.value = false;
  activeDragPageId.value = null;
}

async function onPointerUp(e: PointerEvent, page: DocumentPageItem) {
  if (!isDragging.value || activeDragPageId.value !== page.id) return;
  isDragging.value = false;

  const pageEl = pageElements.value[page.id];
  if (pageEl) {
    try {
      pageEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }

  const coords = pageEl ? getPageRelativeCoords(e, pageEl) : { x: pointerCurrentX.value, y: pointerCurrentY.value };
  const dx = Math.abs(coords.x - pointerStartX.value);
  const dy = Math.abs(coords.y - pointerStartY.value);

  // Click / Tap (not drag)
  if (dx < CLICK_THRESHOLD && dy < CLICK_THRESHOLD) {
    activeDragPageId.value = null;

    // Check manual region tap to delete
    const manualList = page.manualRegions || [];
    for (let i = manualList.length - 1; i >= 0; i--) {
      const r = manualList[i];
      if (coords.x >= r.x && coords.x <= r.x + r.w && coords.y >= r.y && coords.y <= r.y + r.h) {
        page.manualRegions.splice(i, 1);
        showStatus('Blok manual dihapus.', 'info');
        return;
      }
    }

    // Check word tap to toggle redaction
    const pageWords = getWordsForPage(page.pageIndex);
    for (let i = pageWords.length - 1; i >= 0; i--) {
      const w = pageWords[i];
      if (coords.x >= w.x && coords.x <= w.x + w.width && coords.y >= w.y && coords.y <= w.y + w.height) {
        const currentlyRedacted = isWordRedacted(w.globalIndex, w);
        if (currentlyRedacted) {
          unredactedIndices.value.add(w.globalIndex);
          manuallyRedactedIndices.value.delete(w.globalIndex);
          showStatus(`Batal menyensor "${w.text}"`, 'info');
        } else {
          unredactedIndices.value.delete(w.globalIndex);
          manuallyRedactedIndices.value.add(w.globalIndex);
          showStatus(`Menyensor "${w.text}"`, 'success');
        }
        return;
      }
    }
    return;
  }

  // Drag completed
  const rect = {
    x: Math.min(pointerStartX.value, coords.x),
    y: Math.min(pointerStartY.value, coords.y),
    w: Math.abs(coords.x - pointerStartX.value),
    h: Math.abs(coords.y - pointerStartY.value),
  };

  activeDragPageId.value = null;

  if (rect.w < MIN_DRAG_SIZE || rect.h < MIN_DRAG_SIZE) {
    showStatus('Area terlalu kecil. Silakan drag area yang lebih luas.', 'warning');
    return;
  }

  // For text-pdf: check if drag intersects existing words or creates manual block
  if (props.documentType === 'text-pdf') {
    const pageWords = getWordsForPage(page.pageIndex);
    const intersectedWords = pageWords.filter(
      (w) =>
        w.x + w.width >= rect.x &&
        w.x <= rect.x + rect.w &&
        w.y + w.height >= rect.y &&
        w.y <= rect.y + rect.h
    );

    if (intersectedWords.length > 0) {
      const nextUnredacted = new Set(unredactedIndices.value);
      const nextManual = new Set(manuallyRedactedIndices.value);
      intersectedWords.forEach((w) => {
        nextUnredacted.delete(w.globalIndex);
        nextManual.add(w.globalIndex);
      });
      unredactedIndices.value = nextUnredacted;
      manuallyRedactedIndices.value = nextManual;
      showStatus(`${intersectedWords.length} kata disensor.`, 'success');
      return;
    }

    if (!page.manualRegions) page.manualRegions = [];
    page.manualRegions.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    showStatus('Area berhasil diblokir manual.', 'success');
    return;
  }

  // Block Mode
  if (dragMode.value === 'block') {
    if (!page.manualRegions) page.manualRegions = [];
    page.manualRegions.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    showStatus('Area berhasil diblokir manual.', 'success');
    return;
  }

  // Rescan OCR Mode
  await runPageRegionScan(page, rect);
}

async function runPageRegionScan(
  page: DocumentPageItem,
  rect: { x: number; y: number; w: number; h: number }
) {
  isReScanning.value = true;
  scanPageId.value = page.id;
  scanRect.value = rect;
  showStatus('Memindai teks pada area pilihan…', 'info');

  try {
    const pageExistingWords = getWordsForPage(page.pageIndex);
    const newWords = await processRegion(page.previewUrl, rect, pageExistingWords);

    if (newWords.length === 0) {
      showStatus('Tidak ditemukan teks tambahan pada area ini.', 'warning');
      return;
    }

    const uniqueWords = newWords.filter((nw) => {
      return !pageExistingWords.some((ew) => {
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

    // Add new words to this page
    if (!page.words) page.words = [];
    page.words.push(...uniqueWords.map((w) => ({ ...w, pageIndex: page.pageIndex })));

    syncEditableWords();
    showStatus(`Berhasil mengekstrak ${uniqueWords.length} kata baru!`, 'success');
  } catch (error) {
    console.error('Region scan failed:', error);
    showStatus('Gagal memindai area.', 'error');
  } finally {
    isReScanning.value = false;
    scanPageId.value = null;
    scanRect.value = null;
  }
}

// --- Confirm & Emit Handler ---
function handleConfirm() {
  const wordsWithRedaction = editableWords.value.map((w) => ({
    ...w,
    forceRedact: isWordRedacted(w.globalIndex, w),
  }));

  const allManual = allManualRegions.value;
  const activeFaces = enableFaceDetection.value
    ? allFaceRegions.value.filter((_, i) => !disabledAutoRegions.value.has(i))
    : [];

  const allRegions = [...activeFaces, ...allManual];

  emit('confirm', {
    pages: localPages.value,
    words: wordsWithRedaction,
    piiTypes: activePiiTypes.value,
    customText: customPiiText.value,
    regions: allRegions,
    redactionColor: selectedColor.value,
  });
}

onMounted(() => {
  setTimeout(() => {
    zoomReset();
  }, 100);
});
</script>
