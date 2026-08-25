<template>
  <div class="fixed inset-0 w-full h-full bg-gray-950 z-50 flex flex-col overflow-hidden select-none text-gray-200 verification-theme">
    <!-- Top Header Bar: Sleek Dark Theme (Clean & Minimal: Title, Status, Cancel & Export) -->
    <header class="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-gray-800 bg-gray-900 flex justify-between items-center z-20 flex-shrink-0 shadow-md">
      <!-- Left: Title & Badge -->
      <div class="flex items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)]"></span>
        <h2 class="hidden sm:inline text-sm sm:text-base font-bold text-white tracking-tight">
          Verifikasi &amp; Sensor Dokumen
        </h2>
        <span class="text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-full bg-gray-800 text-gray-300 border border-gray-700 font-semibold uppercase tracking-wider">
          {{ documentType === 'text-pdf' ? 'PDF Teks' : documentType === 'image-pdf' ? 'PDF Scan' : 'Gambar' }}
        </span>
      </div>

      <!-- Right: Action Buttons (Cancel & Confirm Export) -->
      <div class="flex items-center gap-2">
        <!-- Cancel Button -->
        <button
          type="button"
          @click="$emit('cancel')"
          class="h-8 sm:h-9 px-3 sm:px-4 text-xs sm:text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 active:scale-95 rounded-lg transition-colors border border-gray-700 flex items-center justify-center gap-1.5 shadow-sm"
          title="Batal dan kembali ke beranda"
        >
          <X class="w-4 h-4 text-gray-400" />
          <span class="hidden xs:inline">Batal</span>
        </button>

        <!-- Confirm & Export Button -->
        <button
          type="button"
          @click="handleConfirm"
          class="h-8 sm:h-9 px-3.5 sm:px-4 text-xs sm:text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 rounded-lg shadow-md transition-all flex items-center justify-center gap-1.5"
          title="Konfirmasi sensor dan ekspor dokumen"
        >
          <Check class="w-4 h-4 text-white stroke-[2.5]" />
          <span>Konfirmasi &amp; Ekspor</span>
        </button>
      </div>
    </header>

    <!-- Main Workspace Area: Canvas Wrapper + Resizable Splitter + Collapsible Aside -->
    <div class="flex-1 flex flex-col lg:flex-row overflow-hidden relative min-h-0">
      
      <!-- Canvas Area Wrapper (Strictly bounds the scrollable canvas and its floating toolbar within the visible canvas frame) -->
      <div class="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-gray-950">
        
        <!-- In-Canvas Processing Overlay for Added Images (No page reload, smooth & centered) -->
        <transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 scale-95"
          enter-to-class="opacity-100 scale-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 scale-100"
          leave-to-class="opacity-0 scale-95"
        >
          <div
            v-if="isAddingImages"
            class="absolute inset-0 bg-gray-950/80 backdrop-blur-md z-40 flex flex-col items-center justify-center p-6 text-center"
          >
            <div class="bg-gray-900 border border-gray-700/80 p-6 sm:p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full">
              <div class="w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center mb-4 border border-blue-500/30">
                <Loader2 class="w-7 h-7 animate-spin text-blue-400" />
              </div>
              <h3 class="text-base font-bold text-white mb-1.5">
                Menambahkan Gambar Baru
              </h3>
              <p class="text-xs text-gray-300 font-medium leading-relaxed">
                {{ addImagesProgressText }}
              </p>
              <div class="mt-4 px-3 py-1.5 rounded-full bg-gray-800/80 border border-gray-700 text-[10px] text-gray-400">
                Seleksi &amp; sensor pada gambar sebelumnya tetap tersimpan aman
              </div>
            </div>
          </div>
        </transition>

        <!-- Scrollable Document Canvas Viewport -->
        <main
          ref="scrollContainer"
          class="w-full h-full overflow-auto p-3 sm:p-6 min-h-0 select-none relative custom-dark-scrollbar flex"
          :class="[
            interactionMode === 'pan' ? 'cursor-grab active:cursor-grabbing' :
            interactionMode === 'block' ? 'cursor-crosshair' : 'cursor-crosshair'
          ]"
          :style="{
            touchAction: interactionMode === 'pan' ? 'pan-x pan-y' : 'none'
          }"
          @scroll.passive="onViewportScroll"
          @wheel="onWheel"
          @pointerdown="onContainerPointerDown"
          @pointermove="onContainerPointerMove"
          @pointerup="onContainerPointerUp"
          @pointercancel="onContainerPointerCancel"
        >
          <!-- Outer Center Wrapper (Centers content when small, allows full left-to-right scroll without clipping when overflowing) -->
          <div class="m-auto flex flex-col items-center justify-start flex-shrink-0 transition-all duration-75">
            <!-- Scaled Boundary Box -->
            <div
              class="relative flex-shrink-0 origin-top-left transition-all duration-75"
              :style="{
                width: scaledContainerWidth + 'px',
                height: scaledContainerHeight + 'px',
              }"
            >
              <!-- Canvas Stack Container -->
              <div
                ref="canvasStack"
                class="absolute top-0 left-0 flex flex-col items-center gap-6 py-4 pb-28 sm:pb-32 origin-top-left transition-transform duration-75"
                :style="{
                  width: maxPageUnscaledWidth + 'px',
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'top left'
                }"
              >
                <!-- Multi-Page / Multi-Image Sheet List -->
                <div
                  v-for="(page, pIdx) in localPages"
                  :key="page.id"
                  :ref="(el) => { if (el) pageElements[page.id] = el as HTMLDivElement }"
                  class="relative bg-white shadow-2xl rounded-sm transition-all flex-shrink-0 mx-auto"
                  :style="{
                    width: page.width + 'px',
                    height: page.height + 'px'
                  }"
                  @pointerdown="(e) => onPagePointerDown(e, page)"
                  @pointermove="(e) => onPagePointerMove(e, page)"
                  @pointerup="(e) => onPagePointerUp(e, page)"
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
                    class="bg-gray-800 hover:bg-gray-700 text-gray-300 p-1 rounded transition-colors border border-gray-700 shadow"
                    title="Putar halaman ini 90°"
                  >
                    <RotateCw class="w-3.5 h-3.5" />
                  </button>
                  <button
                    v-if="localPages.length > 1 && documentType === 'image'"
                    type="button"
                    @click.stop="removeSinglePage(page.id)"
                    class="bg-red-950/80 hover:bg-red-900 text-red-300 p-1 rounded transition-colors border border-red-800 shadow"
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
              <!-- 1. Text Bounding Boxes -->
              <template v-for="word in getWordsForPage(page.pageIndex)" :key="'word-' + page.id + '-' + word.globalIndex">
                <div
                  class="absolute flex items-center justify-center overflow-visible group transition-all pointer-events-none"
                  :class="wordBoxClass(word)"
                  :style="{
                    left: word.x + 'px',
                    top: word.y + 'px',
                    width: word.width + 'px',
                    height: word.height + 'px'
                  }"
                >
                  <!-- Confidence / type badge for detected words -->
                  <div
                    v-if="wordBadge(word)"
                    class="absolute -top-4 left-0 text-[9px] px-1 rounded-sm font-medium shadow whitespace-nowrap pointer-events-none"
                    :class="wordBadge(word)?.auto ? 'bg-red-600 text-white' : 'bg-amber-500 text-black'"
                  >
                    {{ wordBadge(word)?.text }}
                  </div>
                  <!-- Tooltip hover on desktop -->
                  <div class="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-black/90 text-white text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap z-30 pointer-events-none shadow-lg">
                    {{ word.text }}
                  </div>
                </div>
              </template>

              <!-- 2. Face Detection Regions (Interactive Purple - Click to Toggle / Delete) -->
              <template v-if="enableFaceDetection">
                <div
                  v-for="(region, fIdx) in getFaceRegionsForPage(page.pageIndex)"
                  :key="'face-' + pIdx + '-' + fIdx"
                  class="absolute z-20 transition-all cursor-pointer pointer-events-none group"
                  :class="!isFaceActive(getFaceId(page.pageIndex, fIdx))
                    ? 'border-2 border-dashed border-gray-400 bg-gray-400/10 opacity-50 hover:opacity-80'
                    : 'border-2 border-purple-500 bg-purple-500/30 shadow-[0_0_10px_rgba(168,85,247,0.6)] hover:bg-purple-500/40'"
                  :style="{
                    left: region.x + 'px',
                    top: region.y + 'px',
                    width: region.w + 'px',
                    height: region.h + 'px'
                  }"
                  :title="isFaceActive(getFaceId(page.pageIndex, fIdx)) ? 'Klik untuk batal sensor wajah ini' : 'Klik untuk menyensor wajah ini'"
                >
                  <!-- Badge Tag -->
                  <div class="absolute -top-5 left-0 flex items-center gap-1 pointer-events-none">
                    <span
                      class="text-white text-[10px] px-1.5 py-0.5 rounded-sm whitespace-nowrap font-medium shadow flex items-center gap-1"
                      :class="isFaceActive(getFaceId(page.pageIndex, fIdx)) ? 'bg-purple-600' : 'bg-gray-600'"
                    >
                      <span>Wajah {{ fIdx + 1 }}</span>
                      <span v-if="!isFaceActive(getFaceId(page.pageIndex, fIdx))" class="text-[9px] opacity-85">(Dilewati)</span>
                    </span>
                  </div>

                  <!-- Quick Delete Button on Hover -->
                  <button
                    type="button"
                    @click.stop="deleteFaceRegion(page.pageIndex, fIdx)"
                    class="absolute -top-5 right-0 bg-red-600 hover:bg-red-700 text-white p-0.5 rounded text-[9px] shadow hidden group-hover:flex items-center justify-center pointer-events-auto transition-transform active:scale-95"
                    title="Hapus deteksi wajah ini"
                  >
                    <X class="w-3 h-3 stroke-[2.5]" />
                  </button>
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

              <!-- 4. Active Drag Selection Rectangle with Live Measurements & Animated Brackets -->
              <div
                v-if="activeDragPageId === page.id && isDrawing && selectionRect && (selectionRect.w > 1 || selectionRect.h > 1)"
                class="absolute z-30 pointer-events-none transition-none flex flex-col justify-between"
                :class="interactionMode === 'block'
                  ? 'border-2 border-dashed border-red-400 bg-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.5)] ring-1 ring-red-400/40'
                  : 'border-2 border-dashed border-blue-400 bg-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.5)] ring-1 ring-blue-400/40'"
                :style="{
                  left: selectionRect.x + 'px',
                  top: selectionRect.y + 'px',
                  width: selectionRect.w + 'px',
                  height: selectionRect.h + 'px'
                }"
              >
                <!-- Top Corner Measuring Brackets -->
                <div class="flex justify-between w-full pointer-events-none -mt-1 -mx-1">
                  <span class="w-2.5 h-2.5 border-t-2 border-l-2" :class="interactionMode === 'block' ? 'border-red-400' : 'border-blue-400'"></span>
                  <span class="w-2.5 h-2.5 border-t-2 border-r-2" :class="interactionMode === 'block' ? 'border-red-400' : 'border-blue-400'"></span>
                </div>

                <!-- Center Crosshair Target (if size is substantial) -->
                <div
                  v-if="selectionRect.w > 60 && selectionRect.h > 40"
                  class="self-center flex items-center justify-center opacity-40 pointer-events-none"
                >
                  <div class="w-3 h-0.5" :class="interactionMode === 'block' ? 'bg-red-400' : 'bg-blue-400'"></div>
                  <div class="h-3 w-0.5 -ml-1.5" :class="interactionMode === 'block' ? 'bg-red-400' : 'bg-blue-400'"></div>
                </div>

                <!-- Bottom Corner Measuring Brackets -->
                <div class="flex justify-between w-full pointer-events-none -mb-1 -mx-1">
                  <span class="w-2.5 h-2.5 border-b-2 border-l-2" :class="interactionMode === 'block' ? 'border-red-400' : 'border-blue-400'"></span>
                  <span class="w-2.5 h-2.5 border-b-2 border-r-2" :class="interactionMode === 'block' ? 'border-red-400' : 'border-blue-400'"></span>
                </div>

                <!-- Live Dimension & Tool Sizing Badge -->
                <div
                  class="absolute -top-7 left-0 px-2 py-0.5 rounded text-[10px] sm:text-[11px] font-mono font-bold text-white shadow-xl whitespace-nowrap flex items-center gap-1.5 pointer-events-none"
                  :class="interactionMode === 'block' ? 'bg-red-600 border border-red-400/50' : 'bg-blue-600 border border-blue-400/50'"
                >
                  <span>{{ interactionMode === 'block' ? 'Blok Manual' : 'Scan Area' }}</span>
                  <span class="opacity-70">•</span>
                  <span>{{ Math.round(selectionRect.w) }} × {{ Math.round(selectionRect.h) }} px</span>
                </div>
              </div>

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
        </div>
      </div>
    </main>

        <!-- Floating Glassmorphism Toolbar: Strictly ABSOLUTE inside Canvas Area, never overlaps sidebar or bottom panel -->
        <div class="absolute bottom-3 sm:bottom-5 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-16px)] sm:max-w-[calc(100%-32px)] pointer-events-none flex flex-col items-center gap-1.5">
          
          <!-- Dynamic Description Tooltip Banner (Shown on mobile touch/hold/select & desktop hover) -->
          <transition
            enter-active-class="transition duration-150 ease-out"
            enter-from-class="opacity-0 -translate-y-1 scale-95"
            enter-to-class="opacity-100 translate-y-0 scale-100"
            leave-active-class="transition duration-100 ease-in"
            leave-from-class="opacity-100 translate-y-0 scale-100"
            leave-to-class="opacity-0 -translate-y-1 scale-95"
          >
            <div
              v-if="activeToolInfo"
              class="pointer-events-none bg-gray-900/95 text-white text-[11px] sm:text-xs px-3 py-1 rounded-full border border-gray-700 shadow-2xl flex items-center gap-1.5 font-medium whitespace-nowrap backdrop-blur-md"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
              <span>{{ activeToolInfo }}</span>
            </div>
          </transition>

          <!-- Floating Pill Toolbar -->
          <div class="pointer-events-auto bg-gray-900/95 backdrop-blur-md border border-gray-700/80 shadow-[0_8px_30px_rgba(0,0,0,0.6)] rounded-full px-2 sm:px-3 py-1.5 flex items-center gap-1 sm:gap-1.5 text-gray-200 overflow-x-auto scrollbar-none max-w-full">
            
            <!-- Tool 1: Mode Geser / Pan -->
            <button
              type="button"
              @click="setInteractionMode('pan', 'Mode Geser / Pan: Navigasi dan geser dokumen dengan bebas')"
              @mouseenter="setToolInfo('Mode Geser: Navigasi dan geser dokumen dengan bebas')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Mode Geser: Navigasi dan geser dokumen dengan bebas', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all relative flex-shrink-0"
              :class="interactionMode === 'pan'
                ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400/40'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'"
            >
              <Hand class="w-4 h-4" />
            </button>

            <!-- Tool 2: Mode Blokir Manual -->
            <button
              type="button"
              @click="setInteractionMode('block', 'Mode Blokir: Tarik kotak untuk menyensor foto, tanda tangan, atau teks')"
              @mouseenter="setToolInfo('Mode Blokir: Tarik kotak untuk menyensor foto, tanda tangan, atau teks')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Mode Blokir: Tarik kotak untuk menyensor foto, tanda tangan, atau teks', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all relative flex-shrink-0"
              :class="interactionMode === 'block'
                ? 'bg-red-600 text-white shadow-md ring-2 ring-red-400/40'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'"
            >
              <Square class="w-4 h-4" />
            </button>

            <!-- Tool 3: Mode Scan Area (OCR Re-Scan) -->
            <button
              v-if="documentType !== 'text-pdf'"
              type="button"
              @click="setInteractionMode('scan', 'Mode Scan Area: Tarik kotak pada area buram untuk OCR ulang')"
              @mouseenter="setToolInfo('Mode Scan: Tarik kotak pada area buram untuk OCR ulang')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Mode Scan: Tarik kotak pada area buram untuk OCR ulang', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all relative flex-shrink-0"
              :class="interactionMode === 'scan'
                ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/40'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'"
            >
              <Scan class="w-4 h-4" />
            </button>

            <div class="h-5 w-px bg-gray-700 mx-0.5 flex-shrink-0"></div>

            <!-- Tool 4: Rotate 90° -->
            <button
              type="button"
              @click="rotateAllPagesClockwise"
              @mouseenter="setToolInfo('Putar Dokumen 90°')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Putar Dokumen 90°', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-gray-300 hover:bg-gray-800 hover:text-white transition-all relative flex-shrink-0"
            >
              <RotateCw class="w-4 h-4" />
            </button>

            <!-- Tool 5: Deteksi Wajah AI -->
            <button
              type="button"
              @click="toggleFaceDetection"
              @mouseenter="setToolInfo('Deteksi Wajah Otomatis (MediaPipe AI)')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Deteksi Wajah Otomatis (MediaPipe AI)', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all relative flex-shrink-0"
              :class="enableFaceDetection
                ? 'bg-purple-600 text-white shadow-md ring-2 ring-purple-400/40'
                : 'text-gray-300 hover:bg-gray-800 hover:text-white'"
            >
              <Loader2 v-if="isScanningFaces" class="w-4 h-4 animate-spin" />
              <UserCheck v-else class="w-4 h-4" />
            </button>

            <!-- Tool 6: Tambah Gambar (Khusus mode image) -->
            <label
              v-if="documentType === 'image'"
              @mouseenter="setToolInfo('Tambah Lembar Gambar Baru')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Tambah Lembar Gambar Baru', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-purple-400 hover:bg-purple-900/40 hover:text-purple-300 transition-all cursor-pointer relative flex-shrink-0"
            >
              <Plus class="w-4 h-4" />
              <input
                type="file"
                multiple
                accept="image/jpeg, image/png"
                class="hidden"
                @change="handleAdditionalFilesSelect"
              />
            </label>

            <!-- Tool 7: Zoom Out (Desktop Only) -->
            <button
              type="button"
              @click="zoomOut"
              @mouseenter="setToolInfo('Perkecil Tampilan (Zoom Out)')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Perkecil Tampilan (Zoom Out)', true)"
              @pointerup="clearToolInfoLater"
              class="hidden sm:flex w-8 h-8 sm:w-9 sm:h-9 rounded-full items-center justify-center text-gray-300 hover:bg-gray-800 hover:text-white transition-all relative flex-shrink-0"
            >
              <ZoomOut class="w-4 h-4" />
            </button>

            <!-- Tool 8: Zoom Reset / Auto-Fit -->
            <button
              type="button"
              @click="zoomReset"
              @mouseenter="setToolInfo('Pas ke Layar (Auto Fit)')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Pas ke Layar (Auto Fit)', true)"
              @pointerup="clearToolInfoLater"
              class="px-2 h-8 sm:h-9 rounded-full flex items-center justify-center text-xs font-mono font-bold text-gray-200 hover:bg-gray-800 transition-all relative gap-1 flex-shrink-0"
            >
              <Maximize2 class="w-3.5 h-3.5" />
              <span class="text-[11px]">{{ Math.round(zoomLevel * 100) }}%</span>
            </button>

            <!-- Tool 9: Zoom In (Desktop Only) -->
            <button
              type="button"
              @click="zoomIn"
              @mouseenter="setToolInfo('Perbesar Tampilan (Zoom In)')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo('Perbesar Tampilan (Zoom In)', true)"
              @pointerup="clearToolInfoLater"
              class="hidden sm:flex w-8 h-8 sm:w-9 sm:h-9 rounded-full items-center justify-center text-gray-300 hover:bg-gray-800 hover:text-white transition-all relative flex-shrink-0"
            >
              <ZoomIn class="w-4 h-4" />
            </button>

            <div class="h-5 w-px bg-gray-700 mx-0.5 flex-shrink-0"></div>

            <!-- Tool 10: Toggle Sidebar / Control Panel (Always Prioritized & Visible) -->
            <button
              type="button"
              @click="togglePanel"
              @mouseenter="setToolInfo(isPanelOpen ? 'Sembunyikan Panel Kontrol' : 'Buka Panel Kontrol & Filter')"
              @mouseleave="clearToolInfo"
              @pointerdown="setToolInfo(isPanelOpen ? 'Sembunyikan Panel Kontrol' : 'Buka Panel Kontrol & Filter', true)"
              @pointerup="clearToolInfoLater"
              class="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all relative flex-shrink-0"
              :class="isPanelOpen
                ? 'bg-gray-700 text-white'
                : 'text-amber-400 hover:bg-gray-800 ring-2 ring-amber-400/40 animate-pulse'"
            >
              <SlidersHorizontal class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <!-- Desktop Splitter Handle (Resize Width on Desktop) -->
      <div
        v-if="isPanelOpen"
        class="hidden lg:flex w-2 hover:w-2.5 bg-gray-800 hover:bg-blue-500 cursor-col-resize transition-all items-center justify-center flex-shrink-0 z-20 group"
        @pointerdown="startDesktopResize"
        title="Tarik untuk mengubah lebar panel kontrol"
      >
        <div class="w-0.5 h-8 bg-gray-600 group-hover:bg-white rounded-full"></div>
      </div>

      <!-- Resizable & Collapsible Aside / Bottom Sheet (Matching Dark Theme) -->
      <aside
        v-show="isPanelOpen"
        class="border-t lg:border-t-0 lg:border-l border-gray-800 bg-gray-900 text-gray-200 overflow-y-auto flex flex-col z-20 shadow-2xl transition-[width,height] duration-75 flex-shrink-0 custom-dark-scrollbar"
        :style="panelStyle"
      >
        <!-- Mobile Bottom Sheet Drag Handle (Dark Themed) -->
        <div
          class="lg:hidden flex flex-col items-center justify-center pt-2.5 pb-1.5 bg-gray-900 cursor-row-resize touch-none border-b border-gray-800 flex-shrink-0"
          @pointerdown="startMobileResize"
        >
          <div class="w-12 h-1.5 bg-gray-600 rounded-full mb-1.5"></div>
          <div class="flex items-center justify-between w-full px-4 text-[11px] text-gray-300 font-semibold">
            <span class="flex items-center gap-1.5">
              <SlidersHorizontal class="w-3.5 h-3.5 text-blue-400" />
              Panel Pengaturan Sensor
            </span>
            <button
              type="button"
              @click="isPanelOpen = false"
              class="p-1 hover:bg-gray-800 rounded text-gray-400 hover:text-white"
              title="Tutup Panel"
            >
              <ChevronDown class="w-4 h-4" />
            </button>
          </div>
        </div>

        <!-- Desktop Panel Header Bar (Dark Themed) -->
        <div class="hidden lg:flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
          <div class="flex items-center gap-1.5 text-xs font-bold text-gray-200">
            <SlidersHorizontal class="w-3.5 h-3.5 text-blue-400" />
            <span>Pengaturan &amp; Data Sensitif</span>
          </div>
          <button
            type="button"
            @click="isPanelOpen = false"
            class="p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            title="Sembunyikan Panel Samping"
          >
            <PanelRightClose class="w-4 h-4" />
          </button>
        </div>

        <!-- Panel Body Content (Dark Themed) -->
        <div class="p-4 space-y-4 flex-1 overflow-y-auto custom-dark-scrollbar">
          
          <!-- Redaction Color Selection -->
          <div class="border-b border-gray-800 pb-3.5">
            <label class="block text-xs font-semibold text-gray-300 mb-2">
              Warna Sensor / Penghalang:
            </label>
            <div class="flex items-center gap-2">
              <button
                v-for="c in colorPalette"
                :key="c.value"
                class="w-7 h-7 rounded-full border-2 transition-transform relative flex items-center justify-center"
                :class="selectedColor === c.value ? 'scale-110 border-blue-500 shadow-md ring-2 ring-blue-400/40' : 'border-gray-700 hover:scale-105'"
                :style="{ backgroundColor: c.value }"
                :title="c.label"
                @click="selectedColor = c.value"
              >
                <Check v-if="selectedColor === c.value" class="w-3.5 h-3.5" :class="c.value === '#ffffff' ? 'text-black' : 'text-white'" />
              </button>
              <span class="text-xs text-gray-400 ml-1.5 font-medium">
                {{ colorPalette.find(c => c.value === selectedColor)?.label }}
              </span>
            </div>
          </div>

          <!-- Face Detection Status & Manual Trigger -->
          <div class="border-b border-gray-800 pb-3.5">
            <label class="flex items-center justify-between cursor-pointer">
              <div class="flex items-center space-x-2.5">
                <input
                  type="checkbox"
                  v-model="enableFaceDetection"
                  @change="handleFaceDetectionToggle"
                  class="rounded border-gray-700 bg-gray-800 text-purple-600 focus:ring-purple-500 w-4 h-4"
                />
                <span class="text-xs sm:text-sm font-semibold text-gray-200">
                  Deteksi Wajah Otomatis
                </span>
              </div>
              <span v-if="isScanningFaces" class="text-xs text-purple-400 animate-pulse font-medium flex items-center gap-1">
                <Loader2 class="w-3.5 h-3.5 animate-spin" />
                Memindai…
              </span>
            </label>
            <p class="text-[11px] text-gray-400 mt-1">
              Pindai foto wajah atau pasfoto pada dokumen dan tandai untuk disensor.
            </p>
          </div>

          <!-- Detected Faces List (Interactive Selection & Deletion for false positives / duplicates) -->
          <div v-if="enableFaceDetection && allFaceRegionsWithIds.length > 0" class="flex flex-col border-b border-gray-800 pb-3.5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <UserCheck class="w-3.5 h-3.5 text-purple-400" />
                <h3 class="font-semibold text-xs text-gray-200 uppercase tracking-wider">
                  Wajah Terdeteksi ({{ activeFaceCount }}/{{ allFaceRegionsWithIds.length }})
                </h3>
              </div>
              <div class="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  class="text-purple-400 hover:underline font-medium"
                  @click="selectAllFaces"
                >Semua</button>
                <span class="text-gray-600">|</span>
                <button
                  type="button"
                  class="text-gray-400 hover:underline font-medium"
                  @click="deselectAllFaces"
                >Batal</button>
              </div>
            </div>

            <div class="space-y-1.5 max-h-40 overflow-y-auto pr-1 custom-dark-scrollbar">
              <div
                v-for="item in allFaceRegionsWithIds"
                :key="item.id"
                class="flex items-center justify-between p-2 rounded-md transition-colors border"
                :class="isFaceActive(item.id)
                  ? 'bg-purple-950/40 border-purple-800/60 text-purple-200'
                  : 'bg-gray-850/60 border-gray-800 opacity-60 text-gray-400'"
              >
                <label class="flex items-center space-x-2 min-w-0 cursor-pointer flex-1">
                  <input
                    type="checkbox"
                    :checked="isFaceActive(item.id)"
                    @change="toggleFaceSelection(item.id)"
                    class="rounded border-gray-700 bg-gray-800 text-purple-600 focus:ring-purple-500 w-4 h-4 flex-shrink-0"
                  />
                  <div class="truncate">
                    <span
                      class="text-xs font-semibold block truncate"
                      :class="isFaceActive(item.id) ? 'text-purple-200' : 'text-gray-400'"
                    >
                      Wajah {{ item.indexInPage + 1 }}
                    </span>
                    <span class="text-[10px] text-gray-400 block truncate">
                      Halaman {{ item.pageIndex }} • {{ Math.round(item.w) }} × {{ Math.round(item.h) }} px
                    </span>
                  </div>
                </label>

                <button
                  type="button"
                  @click.stop="deleteFaceRegion(item.pageIndex, item.indexInPage)"
                  class="text-gray-500 hover:text-red-400 p-1 rounded transition-colors ml-2 flex-shrink-0"
                  title="Hapus deteksi wajah ini"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <!-- Sensitive Data Patterns Detected via Regex -->
          <div class="flex flex-col border-b border-gray-800 pb-3.5">
            <div class="flex items-center justify-between mb-2">
              <h3 class="font-semibold text-xs text-gray-200 uppercase tracking-wider">
                Pola Sensitif Terdeteksi
              </h3>
              <div class="flex items-center gap-1.5 text-[11px]" v-if="foundSensitiveKeywords.length > 0">
                <button
                  class="text-blue-400 hover:underline font-medium"
                  @click="selectAllKeywords"
                >Semua</button>
                <span class="text-gray-600">|</span>
                <button
                  class="text-gray-400 hover:underline font-medium"
                  @click="deselectAllKeywords"
                >Batal</button>
              </div>
            </div>

            <p class="text-[10px] text-gray-400 mb-2 flex items-center gap-3" v-if="analysisMatches.length > 0">
              <span class="text-red-400 font-medium">● Otomatis: {{ autoRedactCount }}</span>
              <span class="text-amber-400 font-medium">● Perlu review: {{ reviewNeededCount }}</span>
            </p>

            <div v-if="foundSensitiveKeywords.length > 0" class="space-y-1.5 max-h-44 overflow-y-auto pr-1 custom-dark-scrollbar">
              <label
                v-for="item in foundSensitiveKeywords"
                :key="item.id"
                class="flex items-center justify-between p-2 rounded-md bg-gray-850 hover:bg-gray-800 cursor-pointer border border-gray-800 transition-colors"
              >
                <div class="flex items-center space-x-2 min-w-0">
                  <input
                    type="checkbox"
                    :checked="checkedKeywords.has(item.id)"
                    @change="toggleKeywordSelection(item.id)"
                    class="rounded border-gray-700 bg-gray-800 text-blue-600 focus:ring-blue-500 w-4 h-4 flex-shrink-0"
                  />
                  <div class="truncate">
                    <span class="text-xs font-semibold text-gray-200 block truncate">
                      {{ item.keyword }}
                    </span>
                    <span class="text-[10px] text-gray-400 block truncate">
                      {{ item.category }}
                    </span>
                  </div>
                </div>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300 font-bold ml-2 border border-blue-800/40">
                  {{ item.count }} kata
                </span>
              </label>
            </div>

            <div v-else class="p-3 bg-gray-850/50 rounded-md border border-dashed border-gray-800 text-center">
              <p class="text-xs text-gray-400">
                Tidak ada pola sensitif otomatis (NIK, Telepon, Email, Tanggal) yang terdeteksi.
              </p>
            </div>
          </div>

          <!-- Manual Selected Words Section -->
          <div v-if="manualSelectedWordsList.length > 0" class="flex flex-col border-b border-gray-800 pb-3.5">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                <h3 class="font-semibold text-xs text-gray-200 uppercase tracking-wider">
                  Kata Pilihan Manual ({{ manualSelectedWordsList.length }})
                </h3>
              </div>
              <button
                type="button"
                class="text-[11px] text-red-400 hover:underline font-medium"
                @click="clearAllManualSelectedWords"
              >
                Hapus Semua
              </button>
            </div>

            <div class="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1 custom-dark-scrollbar">
              <div
                v-for="item in manualSelectedWordsList"
                :key="item.text"
                class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-950/40 border border-red-800/60 text-red-200 text-xs shadow-sm"
              >
                <span class="font-medium max-w-[130px] truncate" :title="item.text">
                  {{ item.text }}
                </span>
                <span v-if="item.count > 1" class="text-[10px] bg-red-900/60 text-red-200 px-1 rounded-full font-bold">
                  {{ item.count }}x
                </span>
                <button
                  type="button"
                  @click.stop="removeManualSelectedWord(item.indices)"
                  class="text-red-400 hover:text-red-300 p-0.5 rounded transition-colors"
                  title="Batal sensor kata ini"
                >
                  <X class="w-3 h-3 stroke-[2.5]" />
                </button>
              </div>
            </div>
          </div>

          <!-- Custom Keyword Search & Auto Redact -->
          <div>
            <label class="block text-xs font-semibold text-gray-300 mb-1.5">
              Cari Kata atau kata kunci:
            </label>
            <input
              v-model="customPiiText"
              type="text"
              placeholder="Ketik teks yang ingin disensor..."
              class="block w-full rounded-md border-gray-700 bg-gray-800 text-white placeholder-gray-500 text-xs px-3 py-2 border outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm"
            />
          </div>

          <!-- Stats Summary -->
          <div class="text-[11px] text-gray-400 space-y-1.5 pt-2 border-t border-gray-800">
            <div class="flex justify-between">
              <span>Total Lembar / Halaman:</span>
              <span class="font-medium text-gray-200">{{ localPages.length }}</span>
            </div>
            <div class="flex justify-between">
              <span>Total Kata Terdeteksi:</span>
              <span class="font-medium text-gray-200">{{ editableWords.length }}</span>
            </div>
            <div class="flex justify-between">
              <span>Kata yang Disensor:</span>
              <span class="font-medium text-red-400">{{ totalRedactedWordsCount }} kata</span>
            </div>
            <div class="flex justify-between" v-if="allManualRegions.length > 0">
              <span>Blok Manual:</span>
              <span class="font-medium text-red-400">{{ allManualRegions.length }} area</span>
            </div>
            <div class="flex justify-between" v-if="enableFaceDetection && allFaceRegionsWithIds.length > 0">
              <span>Wajah Terdeteksi:</span>
              <span class="font-medium text-purple-400">{{ activeFaceCount }} / {{ allFaceRegionsWithIds.length }} wajah</span>
            </div>
          </div>

          <!-- Status Flash Message -->
          <div v-if="statusMessage" class="text-xs p-2.5 rounded-md shadow-sm" :class="statusMessageClass">
            {{ statusMessage }}
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
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
  Hand,
  UserCheck,
  SlidersHorizontal,
  ChevronDown,
  PanelRightClose,
} from 'lucide-vue-next';
import type { SpatialWord } from '~/utils/ocrEngine';
import { processRegion, processDocument } from '~/utils/ocrEngine';
import {
  extractFoundSensitiveKeywords,
  analyzeWords,
  PII_CATEGORIES,
  type PIIType,
  type FoundKeywordItem,
  type SensitiveMatch,
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
}>();

// --- Local Pages State ---
const localPages = ref<DocumentPageItem[]>([]);
const pageElements = ref<Record<string, HTMLDivElement>>({});
const editableWords = ref<(SpatialWord & { globalIndex: number })[]>([]);
const scrollContainer = ref<HTMLDivElement | null>(null);
const canvasStack = ref<HTMLDivElement | null>(null);
const isInitialized = ref(false);

// --- In-Canvas Processing State for Added Images ---
const isAddingImages = ref(false);
const addImagesProgressText = ref('');

// --- Viewport & Zoom State ---
const zoomLevel = ref(1);
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 0.15;

const maxPageUnscaledWidth = computed(() => {
  if (localPages.value.length === 0) return 800;
  return Math.max(...localPages.value.map((p) => p.width || 800));
});

const totalPagesUnscaledHeight = computed(() => {
  if (localPages.value.length === 0) return 1000;
  const gapTotal = Math.max(0, localPages.value.length - 1) * 24; // 24px per gap-6
  const paddingOffset = 160; // py-4 + pb-28/pb-32
  const pagesSum = localPages.value.reduce((acc, p) => acc + (p.height || 1000), 0);
  return pagesSum + gapTotal + paddingOffset;
});

const scaledContainerWidth = computed(() => {
  return Math.ceil(maxPageUnscaledWidth.value * zoomLevel.value);
});

const scaledContainerHeight = computed(() => {
  return Math.ceil(totalPagesUnscaledHeight.value * zoomLevel.value);
});

// --- Interaction Mode State ---
type InteractionMode = 'pan' | 'block' | 'scan';
const interactionMode = ref<InteractionMode>('pan');

// --- Active Tool Info / Tooltip Banner ---
const activeToolInfo = ref<string | null>(null);
let toolInfoTimer: any = null;

function setToolInfo(info: string, persistent: boolean = false) {
  if (toolInfoTimer) clearTimeout(toolInfoTimer);
  activeToolInfo.value = info;
  if (!persistent) {
    toolInfoTimer = setTimeout(() => {
      activeToolInfo.value = null;
    }, 2800);
  }
}

function clearToolInfo() {
  if (toolInfoTimer) clearTimeout(toolInfoTimer);
  activeToolInfo.value = null;
}

function clearToolInfoLater() {
  if (toolInfoTimer) clearTimeout(toolInfoTimer);
  toolInfoTimer = setTimeout(() => {
    activeToolInfo.value = null;
  }, 2000);
}

function setInteractionMode(mode: InteractionMode, label: string) {
  interactionMode.value = mode;
  setToolInfo(label);
}

// --- Panel Resize & Collapse State ---
const isPanelOpen = ref(true);

// Reactive viewport breakpoint. panelStyle used to read window.innerWidth
// inside a computed, which never re-evaluates on resize — after crossing the
// lg breakpoint the panel kept stale desktop/mobile geometry (a dark block
// wedged over half the workspace). A reactive flag makes the style flip
// instantly; a debounced refit re-fits and re-centers the canvas afterwards.
const isDesktopViewport = ref(window.innerWidth >= 1024);
let viewportResizeTimer: ReturnType<typeof setTimeout> | null = null;

function onWindowResize() {
  isDesktopViewport.value = window.innerWidth >= 1024;
  if (!isInitialized.value) return;
  if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    zoomReset();
  }, 200);
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
  if (viewportResizeTimer) clearTimeout(viewportResizeTimer);
});

const sidebarWidth = ref(360); // Desktop width in px
const bottomSheetHeight = ref(45); // Mobile height in vh (%)
const isResizingDesktop = ref(false);
const isResizingMobile = ref(false);
const resizeStartY = ref(0);
const initialSheetHeight = ref(45);
const resizeStartX = ref(0);
const initialSidebarWidth = ref(360);

const panelStyle = computed(() => {
  if (isDesktopViewport.value) {
    return {
      width: isPanelOpen.value ? `${sidebarWidth.value}px` : '0px',
      minWidth: isPanelOpen.value ? '260px' : '0px',
      maxWidth: '600px',
    };
  } else {
    return {
      height: isPanelOpen.value ? `${bottomSheetHeight.value}vh` : '0px',
      maxHeight: '80vh',
    };
  }
});
function togglePanel() {
  isPanelOpen.value = !isPanelOpen.value;
  setToolInfo(isPanelOpen.value ? 'Panel Pengaturan Terbuka' : 'Panel Ditutup (Layar Kanvas Maksimal)');
  nextTick(() => {
    zoomReset();
  });
}

// --- Desktop Splitter Drag ---
function startDesktopResize(e: PointerEvent) {
  isResizingDesktop.value = true;
  resizeStartX.value = e.clientX;
  initialSidebarWidth.value = sidebarWidth.value;

  const onMove = (moveEvt: PointerEvent) => {
    if (!isResizingDesktop.value) return;
    const deltaX = resizeStartX.value - moveEvt.clientX;
    sidebarWidth.value = Math.max(260, Math.min(600, initialSidebarWidth.value + deltaX));
  };

  const onUp = () => {
    isResizingDesktop.value = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// --- Mobile Bottom Sheet Drag ---
function startMobileResize(e: PointerEvent) {
  isResizingMobile.value = true;
  resizeStartY.value = e.clientY;
  initialSheetHeight.value = bottomSheetHeight.value;

  const onMove = (moveEvt: PointerEvent) => {
    if (!isResizingMobile.value) return;
    const deltaY = resizeStartY.value - moveEvt.clientY;
    const deltaVh = (deltaY / window.innerHeight) * 100;
    bottomSheetHeight.value = Math.max(20, Math.min(80, initialSheetHeight.value + deltaVh));
  };

  const onUp = () => {
    isResizingMobile.value = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// --- Pointer & Multi-Touch Gesture State ---
const activePointers = new Map<number, { clientX: number; clientY: number }>();
let initialPinchDistance = 0;
let initialPinchZoom = 1;

// Pan state for 1-finger canvas drag
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

// Drawing state for block/scan
const isDrawing = ref(false);
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

// --- Face Detection & Interactive Selection State ---
const enableFaceDetection = ref(false);
const isScanningFaces = ref(false);
const disabledFaceIds = ref<Set<string>>(new Set());

function getFaceId(pageIndex: number, faceIndex: number): string {
  return `face-${pageIndex}-${faceIndex}`;
}

function isFaceActive(faceId: string): boolean {
  return !disabledFaceIds.value.has(faceId);
}

function toggleFaceSelection(faceId: string) {
  const next = new Set(disabledFaceIds.value);
  if (next.has(faceId)) {
    next.delete(faceId);
    setToolInfo('Wajah diaktifkan untuk disensor');
  } else {
    next.add(faceId);
    setToolInfo('Sensor wajah dibatalkan (dilewati)');
  }
  disabledFaceIds.value = next;
}

function selectAllFaces() {
  disabledFaceIds.value = new Set();
  setToolInfo('Semua wajah diaktifkan untuk disensor');
}

function deselectAllFaces() {
  const allIds = new Set<string>();
  allFaceRegionsWithIds.value.forEach((f) => {
    allIds.add(f.id);
  });
  disabledFaceIds.value = allIds;
  setToolInfo('Semua sensor wajah dibatalkan');
}

function deleteFaceRegion(pageIndex: number, faceIndex: number) {
  const page = localPages.value.find((p) => p.pageIndex === pageIndex);
  if (page && page.faceRegions && page.faceRegions[faceIndex]) {
    page.faceRegions.splice(faceIndex, 1);
    setToolInfo('Deteksi wajah dihapus');
  }
}

// --- Status Flash Notification ---
const statusMessage = ref('');
const statusMessageClass = ref('bg-blue-600 text-white');

function showStatus(msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  statusMessage.value = msg;
  const classes = {
    info: 'bg-blue-900/90 text-blue-100 border border-blue-700',
    success: 'bg-emerald-900/90 text-emerald-100 border border-emerald-700',
    warning: 'bg-amber-900/90 text-amber-100 border border-amber-700',
    error: 'bg-red-900/90 text-red-100 border border-red-700',
  };
  statusMessageClass.value = classes[type] || classes.info;

  setTimeout(() => {
    statusMessage.value = '';
  }, 3500);
}

const foundSensitiveKeywords = computed<FoundKeywordItem[]>(() => {
  // Same type set as the redaction path, so every auto-redacted word has a
  // panel entry (the previous default ALL_TYPES silently dropped 'date').
  return extractFoundSensitiveKeywords(editableWords.value, activePiiTypes.value);
});

// Per-word precision analysis (confidence + auto/review flag) for the review UI.
const analysisMatches = computed<SensitiveMatch[]>(() =>
  analyzeWords(editableWords.value, activePiiTypes.value)
);

const analysisByWord = computed<Map<number, SensitiveMatch>>(() => {
  const m = new Map<number, SensitiveMatch>();
  for (const a of analysisMatches.value) {
    const prev = m.get(a.wordIndex);
    if (!prev || a.combined > prev.combined) m.set(a.wordIndex, a);
  }
  return m;
});

const autoRedactCount = computed(
  () => analysisMatches.value.filter((a) => a.autoRedact).length
);
const reviewNeededCount = computed(
  () => analysisMatches.value.filter((a) => !a.autoRedact).length
);

function getWordAnalysis(globalIndex: number): SensitiveMatch | undefined {
  return analysisByWord.value.get(globalIndex);
}

function piiShortLabel(type: PIIType): string {
  return PII_CATEGORIES.find((c) => c.type === type)?.label ?? type;
}

function wordBoxClass(word: SpatialWord & { globalIndex: number }): string {
  if (isWordRedacted(word.globalIndex, word)) {
    return 'border-2 border-red-500 bg-red-500/50 z-20 shadow-[0_0_10px_rgba(239,68,68,0.85)] ring-1 ring-red-400/50 cursor-pointer';
  }
  const a = getWordAnalysis(word.globalIndex);
  if (a && !a.autoRedact) {
    return 'border-2 border-dashed border-amber-400 bg-amber-400/20 z-20';
  }
  return props.documentType === 'text-pdf'
    ? 'border border-transparent hover:border-blue-400/60 hover:bg-blue-400/15 cursor-pointer z-10'
    : 'border border-emerald-500/25 bg-emerald-500/10 z-10';
}

function wordBadge(word: SpatialWord & { globalIndex: number }): { text: string; auto: boolean } | null {
  const a = getWordAnalysis(word.globalIndex);
  if (!a) return null;
  return { text: `${piiShortLabel(a.type)} ${Math.round(a.combined * 100)}%`, auto: a.autoRedact };
}

const activePiiTypes = computed<PIIType[]>(() => {
  const types: PIIType[] = ['nik', 'phone', 'email', 'id', 'bank', 'dob', 'ttl', 'bpjs', 'npwp', 'date'];
  if (customPiiText.value.trim()) types.push('custom');
  return types;
});

// Single source of truth for auto-redaction: a word is redacted iff a CHECKED
// detection entry covers it (plus custom-text matches). Standalone regex hits
// used to be force-added outside the panel, so unchecking an entry appeared
// to do nothing whenever the word also matched such a pattern, and 'date'-only
// matches were redacted with no panel entry at all. foundSensitiveKeywords is
// built from the same analysis with the same type set, so every automatic
// selection now traces to exactly one listed checkbox.
const autoDetectedPiiIndices = computed<Set<number>>(() => {
  const indices = new Set<number>();

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

// Synchronize pages and words from props on initial load
watch(
  () => props.pages,
  (newPages) => {
    if (isInitialized.value) return;
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
    isInitialized.value = true;
    nextTick(() => {
      zoomReset();
    });
  },
  { immediate: true, deep: true }
);

const allManualRegions = computed<DetectedRegion[]>(() => {
  return localPages.value.flatMap((p) =>
    (p.manualRegions || []).map((r) => ({ ...r, pageIndex: p.pageIndex }))
  );
});

const allFaceRegionsWithIds = computed(() => {
  return localPages.value.flatMap((p) =>
    (p.faceRegions || []).map((r, fIdx) => ({
      ...r,
      id: getFaceId(p.pageIndex, fIdx),
      pageIndex: p.pageIndex,
      indexInPage: fIdx,
    }))
  );
});

const activeFaceCount = computed(() => {
  return allFaceRegionsWithIds.value.filter((f) => isFaceActive(f.id)).length;
});

function getWordsForPage(pageIndex: number) {
  return editableWords.value.filter((w) => (w.pageIndex || 1) === pageIndex);
}

function getFaceRegionsForPage(pageIndex: number) {
  const page = localPages.value.find((p) => p.pageIndex === pageIndex);
  return page ? page.faceRegions || [] : [];
}

function getManualRegionsForPage(pageIndex: number) {
  const page = localPages.value.find((p) => p.pageIndex === pageIndex);
  return page ? page.manualRegions || [] : [];
}

function toggleWord(globalIndex: number) {
  const currentlyRedacted = isWordRedacted(globalIndex);
  if (currentlyRedacted) {
    unredactedIndices.value.add(globalIndex);
    manuallyRedactedIndices.value.delete(globalIndex);
  } else {
    unredactedIndices.value.delete(globalIndex);
    manuallyRedactedIndices.value.add(globalIndex);
  }
}

function toggleKeywordSelection(keywordId: string) {
  const next = new Set(checkedKeywords.value);
  if (next.has(keywordId)) {
    next.delete(keywordId);
  } else {
    next.add(keywordId);
  }
  checkedKeywords.value = next;
}

function selectAllKeywords() {
  const allIds = new Set<string>();
  foundSensitiveKeywords.value.forEach((item) => {
    allIds.add(item.id);
  });
  checkedKeywords.value = allIds;
}

function deselectAllKeywords() {
  checkedKeywords.value = new Set();
}

const manualSelectedWordsList = computed(() => {
  const map = new Map<string, { count: number; indices: number[]; pages: Set<number> }>();

  manuallyRedactedIndices.value.forEach((idx) => {
    const word = editableWords.value[idx];
    if (word) {
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

// --- Zoom & Auto-Fit Navigation ---
function applyZoom(nextZoom: number, anchorClientX?: number, anchorClientY?: number) {
  const boundedZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +nextZoom.toFixed(2)));
  if (!scrollContainer.value || boundedZoom === zoomLevel.value) {
    zoomLevel.value = boundedZoom;
    return;
  }

  const container = scrollContainer.value;
  const oldZoom = zoomLevel.value;
  const containerRect = container.getBoundingClientRect();

  // Anchor point relative to viewport
  const ax = anchorClientX !== undefined ? (anchorClientX - containerRect.left) : (container.clientWidth / 2);
  const ay = anchorClientY !== undefined ? (anchorClientY - containerRect.top) : (container.clientHeight / 2);

  // Content coordinates before zoom
  const contentX = (container.scrollLeft + ax) / oldZoom;
  const contentY = (container.scrollTop + ay) / oldZoom;

  zoomLevel.value = boundedZoom;

  nextTick(() => {
    container.scrollLeft = Math.max(0, contentX * boundedZoom - ax);
    container.scrollTop = Math.max(0, contentY * boundedZoom - ay);
  });
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    applyZoom(zoomLevel.value + delta, e.clientX, e.clientY);
  }
}

function zoomIn() {
  applyZoom(zoomLevel.value + ZOOM_STEP);
  setToolInfo(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
}

function zoomOut() {
  applyZoom(zoomLevel.value - ZOOM_STEP);
  setToolInfo(`Zoom: ${Math.round(zoomLevel.value * 100)}%`);
}

function zoomReset() {
  if (!scrollContainer.value || localPages.value.length === 0) {
    zoomLevel.value = 1;
    return;
  }
  const maxPageWidth = Math.max(...localPages.value.map((p) => p.width || 800));
  const maxPageHeight = Math.max(...localPages.value.map((p) => p.height || 1000));
  
  const containerW = scrollContainer.value.clientWidth - (window.innerWidth < 640 ? 24 : 48);
  const containerH = scrollContainer.value.clientHeight - (window.innerWidth < 640 ? 110 : 90);

  const scaleW = containerW / maxPageWidth;
  const scaleH = containerH / maxPageHeight;
  
  const targetScale = Math.min(scaleW, scaleH > 0.3 ? scaleH : scaleW);
  zoomLevel.value = Math.min(1.2, Math.max(ZOOM_MIN, +targetScale.toFixed(2)));
  setToolInfo(`Pas Layar (${Math.round(zoomLevel.value * 100)}%)`);
  nextTick(() => {
    if (scrollContainer.value) {
      scrollContainer.value.scrollLeft = 0;
      scrollContainer.value.scrollTop = 0;
    }
  });
}

// --- Rotation Methods (Mathematical 90° Transform) ---
function rotatePageCoords(page: DocumentPageItem) {
  const oldW = page.width;
  const oldH = page.height;

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
    setToolInfo(`${page.label} diputar 90°`);
  }
}

function rotateAllPagesClockwise() {
  localPages.value.forEach((page) => {
    rotatePageCoords(page);
  });
  setToolInfo('Semua halaman diputar 90°');
}

function removeSinglePage(pageId: string) {
  const idx = localPages.value.findIndex((p) => p.id === pageId);
  if (idx >= 0) {
    const removed = localPages.value.splice(idx, 1)[0];
    syncEditableWords();
    showStatus(`${removed.label} telah dihapus.`, 'info');
  }
}

// In-Place Image Ingestion without Page Refresh or Selection Reset
async function handleAdditionalFilesSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files || target.files.length === 0) return;
  const fileList = Array.from(target.files);
  target.value = '';

  isAddingImages.value = true;
  addImagesProgressText.value = `Memproses 1 dari ${fileList.length} gambar...`;
  setToolInfo(`Menambahkan ${fileList.length} gambar baru...`, true);

  try {
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      addImagesProgressText.value = `Mengekstrak teks gambar ${i + 1} dari ${fileList.length} (${file.name})...`;

      // 1. Load image natural dimensions & preview URL
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = objectUrl;
      });

      const width = img.naturalWidth || img.width || 800;
      const height = img.naturalHeight || img.height || 1000;
      const newPageIndex = localPages.value.length + 1;

      // 2. Run OCR directly without reloading/resetting existing pages
      const rawWords = await processDocument(file);
      const taggedWords = rawWords.map((w) => ({
        ...w,
        pageIndex: newPageIndex,
      }));

      // 3. Run Face Detection automatically if enabled on new image
      let newFaceRegions: DetectedRegion[] = [];
      if (enableFaceDetection.value) {
        addImagesProgressText.value = `Mendeteksi wajah pada gambar ${i + 1} dari ${fileList.length}...`;
        try {
          newFaceRegions = await detectFaces(img);
        } catch (err) {
          console.error('Face detection error on added image:', err);
        }
      }

      // 4. Construct new page item
      const newPage: DocumentPageItem = {
        id: `img-${newPageIndex}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        pageIndex: newPageIndex,
        label: `Gambar ${newPageIndex} (${file.name})`,
        type: 'image',
        sourceBlob: file,
        previewUrl: objectUrl,
        width,
        height,
        rotation: 0,
        words: taggedWords,
        manualRegions: [],
        faceRegions: newFaceRegions,
      };

      // 5. Append to localPages
      localPages.value.push(newPage);

      // 6. Append new words to editableWords with unique globalIndex
      const startGlobalIndex = editableWords.value.length;
      const newEditableWords = taggedWords.map((w, idx) => ({
        ...w,
        globalIndex: startGlobalIndex + idx,
      }));
      editableWords.value.push(...newEditableWords);

      // 7. Auto-detect sensitive keywords from new words and select them
      const newFoundKeywords = extractFoundSensitiveKeywords(newEditableWords, activePiiTypes.value);
      newFoundKeywords.forEach((item) => {
        checkedKeywords.value.add(item.id);
      });
    }

    setToolInfo(`Berhasil menambahkan ${fileList.length} gambar baru!`);
    showStatus(`${fileList.length} gambar baru berhasil ditambahkan tanpa menghilangkan seleksi sebelumnya.`, 'success');
  } catch (error: any) {
    console.error('Error adding images:', error);
    setToolInfo('Gagal menambahkan gambar');
    showStatus('Gagal memproses gambar tambahan: ' + (error?.message || error), 'error');
  } finally {
    isAddingImages.value = false;
  }
}

// --- Face Detection Toggle ---
function toggleFaceDetection() {
  enableFaceDetection.value = !enableFaceDetection.value;
  handleFaceDetectionToggle();
}

async function handleFaceDetectionToggle() {
  if (enableFaceDetection.value) {
    if (allFaceRegionsWithIds.value.length === 0) {
      isScanningFaces.value = true;
      setToolInfo('Memindai wajah dengan AI…', true);
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
        disabledFaceIds.value.clear();
        const totalFaces = allFaceRegionsWithIds.value.length;
        if (totalFaces > 0) {
          setToolInfo(`Ditemukan ${totalFaces} wajah pada dokumen`);
        } else {
          setToolInfo('Tidak ditemukan wajah pada dokumen');
        }
      } catch (err) {
        setToolInfo('Gagal menjalankan deteksi wajah');
      } finally {
        isScanningFaces.value = false;
      }
    } else {
      disabledFaceIds.value.clear();
      setToolInfo('Deteksi wajah diaktifkan');
    }
  } else {
    setToolInfo('Deteksi wajah dinonaktifkan');
  }
}

// --- Multi-Touch, Tap vs Scroll Discrimination & Pointer Event Handling ---
const TAP_MAX_DISTANCE_TOUCH = 14; // pixels on screen for mobile touch
const TAP_MAX_DISTANCE_MOUSE = 8;  // pixels on screen for mouse click
const TAP_MAX_TIME_MS = 380;       // max ms duration for single tap
const MIN_DRAG_RECT_SIZE = 12;     // min rect dimension (px) to confirm drag box creation

// Interaction tracking
let touchStartTime = 0;
let screenStartX = 0;
let screenStartY = 0;
let hasScrolled = false;
let pointerDownPageId: string | null = null;
let pointerDownPageCoords = { x: 0, y: 0 };

function onViewportScroll() {
  hasScrolled = true;
}

function getPageRelativeCoords(clientX: number, clientY: number, pageEl: HTMLElement): { x: number; y: number } {
  const rect = pageEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoomLevel.value,
    y: (clientY - rect.top) / zoomLevel.value,
  };
}

const selectionRect = computed(() => {
  if (!isDrawing.value) return null;
  const x = Math.min(pointerStartX.value, pointerCurrentX.value);
  const y = Math.min(pointerStartY.value, pointerCurrentY.value);
  const w = Math.abs(pointerCurrentX.value - pointerStartX.value);
  const h = Math.abs(pointerCurrentY.value - pointerStartY.value);
  return { x, y, w, h };
});

function getPinchDistance(p1: { clientX: number; clientY: number }, p2: { clientX: number; clientY: number }): number {
  return Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
}

// Global Viewport Pan & Pinch Handlers
function onContainerPointerDown(e: PointerEvent) {
  activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

  // 2-Finger Pinch Zoom Detection
  if (activePointers.size === 2) {
    isDrawing.value = false;
    isPanning = false;
    hasScrolled = true;
    pointerDownPageId = null;
    const pts = Array.from(activePointers.values());
    initialPinchDistance = getPinchDistance(pts[0], pts[1]);
    initialPinchZoom = zoomLevel.value;
    return;
  }

  // 1-Finger Pan / Scroll when in 'pan' mode
  if (interactionMode.value === 'pan' && scrollContainer.value) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panScrollLeft = scrollContainer.value.scrollLeft;
    panScrollTop = scrollContainer.value.scrollTop;
  }
}

function onContainerPointerMove(e: PointerEvent) {
  activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

  // 2-Finger Pinch Zoom
  if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values());
    const currentDist = getPinchDistance(pts[0], pts[1]);
    if (initialPinchDistance > 0) {
      const scaleRatio = currentDist / initialPinchDistance;
      zoomLevel.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(initialPinchZoom * scaleRatio).toFixed(2)));
    }
    return;
  }

  const screenDist = Math.hypot(e.clientX - screenStartX, e.clientY - screenStartY);
  const tapThreshold = e.pointerType === 'touch' ? TAP_MAX_DISTANCE_TOUCH : TAP_MAX_DISTANCE_MOUSE;

  if (screenDist > tapThreshold) {
    if (interactionMode.value === 'pan') {
      hasScrolled = true;
    }
  }

  // 1-Finger Pan Movement
  if (isPanning && scrollContainer.value && activePointers.size === 1) {
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (Math.hypot(dx, dy) > tapThreshold) {
      hasScrolled = true;
    }
    scrollContainer.value.scrollLeft = panScrollLeft - dx;
    scrollContainer.value.scrollTop = panScrollTop - dy;
    return;
  }

  // Drawing Redaction / Scan Box (only when in block/scan mode and moved past tap threshold)
  if (activeDragPageId.value && (interactionMode.value === 'block' || interactionMode.value === 'scan')) {
    if (screenDist > tapThreshold) {
      isDrawing.value = true;
    }
    if (isDrawing.value) {
      const pageEl = pageElements.value[activeDragPageId.value];
      const page = localPages.value.find((p) => p.id === activeDragPageId.value);
      if (pageEl && page) {
        const coords = getPageRelativeCoords(e.clientX, e.clientY, pageEl);
        pointerCurrentX.value = Math.max(0, Math.min(coords.x, page.width));
        pointerCurrentY.value = Math.max(0, Math.min(coords.y, page.height));
      }
    }
  }
}

async function onContainerPointerUp(e: PointerEvent) {
  const duration = performance.now() - touchStartTime;
  const screenDist = Math.hypot(e.clientX - screenStartX, e.clientY - screenStartY);
  const tapThreshold = e.pointerType === 'touch' ? TAP_MAX_DISTANCE_TOUCH : TAP_MAX_DISTANCE_MOUSE;
  const isTap = !hasScrolled && screenDist <= tapThreshold && duration <= TAP_MAX_TIME_MS;

  const targetPageId = pointerDownPageId || activeDragPageId.value;
  const page = targetPageId ? localPages.value.find((p) => p.id === targetPageId) : null;
  const pageEl = targetPageId ? pageElements.value[targetPageId] : null;

  activePointers.delete(e.pointerId);
  isPanning = false;

  // Case 1: Genuine Instant Tap/Click across ALL modes (pan, block, scan)
  if (isTap && page) {
    handleTapOnPage(page, pointerDownPageCoords);
  }
  // Case 2: Drag Box Completed (block or scan mode)
  else if (isDrawing.value && page && pageEl && (interactionMode.value === 'block' || interactionMode.value === 'scan')) {
    const coords = getPageRelativeCoords(e.clientX, e.clientY, pageEl);
    const rect = {
      x: Math.min(pointerStartX.value, coords.x),
      y: Math.min(pointerStartY.value, coords.y),
      w: Math.abs(coords.x - pointerStartX.value),
      h: Math.abs(coords.y - pointerStartY.value),
    };

    if (rect.w >= MIN_DRAG_RECT_SIZE && rect.h >= MIN_DRAG_RECT_SIZE) {
      if (interactionMode.value === 'scan') {
        await runPageRegionScan(page, rect);
      } else {
        if (!page.manualRegions) page.manualRegions = [];
        page.manualRegions.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        setToolInfo('Area berhasil diblokir manual');
      }
    }
  }

  isDrawing.value = false;
  activeDragPageId.value = null;
  pointerDownPageId = null;
}

function onContainerPointerCancel(e: PointerEvent) {
  activePointers.delete(e.pointerId);
  isPanning = false;
  isDrawing.value = false;
  activeDragPageId.value = null;
  pointerDownPageId = null;
}

// Page Specific Pointer Handlers
function onPagePointerDown(e: PointerEvent, page: DocumentPageItem) {
  if (isReScanning.value || activePointers.size > 1) return;
  const pageEl = pageElements.value[page.id];
  if (!pageEl) return;

  activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

  // Record initial gesture state
  hasScrolled = false;
  touchStartTime = performance.now();
  screenStartX = e.clientX;
  screenStartY = e.clientY;
  pointerDownPageId = page.id;
  activeDragPageId.value = page.id;

  const coords = getPageRelativeCoords(e.clientX, e.clientY, pageEl);
  pointerStartX.value = coords.x;
  pointerStartY.value = coords.y;
  pointerCurrentX.value = coords.x;
  pointerCurrentY.value = coords.y;
  pointerDownPageCoords = { x: coords.x, y: coords.y };

  if (interactionMode.value !== 'pan') {
    isDrawing.value = false;
    try {
      pageEl.setPointerCapture(e.pointerId);
    } catch (_) {}
  }
}

function onPagePointerMove(e: PointerEvent, _page: DocumentPageItem) {
  onContainerPointerMove(e);
}

async function onPagePointerUp(e: PointerEvent, page: DocumentPageItem) {
  const pageEl = pageElements.value[page.id];
  if (pageEl) {
    try {
      pageEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
  }
  await onContainerPointerUp(e);
}

function handleTapOnPage(page: DocumentPageItem, coords: { x: number; y: number }) {
  // 1. Check tap on face regions
  if (enableFaceDetection.value && page.faceRegions) {
    const facePadding = 4;
    for (let i = page.faceRegions.length - 1; i >= 0; i--) {
      const f = page.faceRegions[i];
      if (
        coords.x >= f.x - facePadding &&
        coords.x <= f.x + f.w + facePadding &&
        coords.y >= f.y - facePadding &&
        coords.y <= f.y + f.h + facePadding
      ) {
        const faceId = getFaceId(page.pageIndex, i);
        toggleFaceSelection(faceId);
        return;
      }
    }
  }

  // 2. Check tap on manual region to delete
  const manualList = page.manualRegions || [];
  const manualPadding = 4;
  for (let i = manualList.length - 1; i >= 0; i--) {
    const r = manualList[i];
    if (
      coords.x >= r.x - manualPadding &&
      coords.x <= r.x + r.w + manualPadding &&
      coords.y >= r.y - manualPadding &&
      coords.y <= r.y + r.h + manualPadding
    ) {
      page.manualRegions.splice(i, 1);
      setToolInfo('Blok manual dihapus');
      return;
    }
  }

  // 3. Check tap on word to toggle redaction (with mobile finger touch tolerance)
  const pageWords = getWordsForPage(page.pageIndex);
  let matchedWord: (SpatialWord & { globalIndex: number }) | null = null;
  let minDistance = Infinity;
  const wordPadding = 5;

  for (let i = pageWords.length - 1; i >= 0; i--) {
    const w = pageWords[i];
    if (
      coords.x >= w.x - wordPadding &&
      coords.x <= w.x + w.width + wordPadding &&
      coords.y >= w.y - wordPadding &&
      coords.y <= w.y + w.height + wordPadding
    ) {
      const centerX = w.x + w.width / 2;
      const centerY = w.y + w.height / 2;
      const dist = Math.hypot(coords.x - centerX, coords.y - centerY);
      if (dist < minDistance) {
        minDistance = dist;
        matchedWord = w;
      }
    }
  }

  if (matchedWord) {
    toggleWord(matchedWord.globalIndex);
    const isRedactedNow = isWordRedacted(matchedWord.globalIndex, matchedWord);
    setToolInfo(isRedactedNow ? `Menyensor "${matchedWord.text}"` : `Batal sensor "${matchedWord.text}"`);
    return;
  }
}

async function runPageRegionScan(
  page: DocumentPageItem,
  rect: { x: number; y: number; w: number; h: number }
) {
  isReScanning.value = true;
  scanPageId.value = page.id;
  scanRect.value = rect;
  setToolInfo('Memindai teks pada area pilihan…', true);

  try {
    const pageExistingWords = getWordsForPage(page.pageIndex);
    const newWords = await processRegion(page.previewUrl, rect, pageExistingWords);

    if (newWords.length === 0) {
      setToolInfo('Tidak ditemukan teks tambahan pada area ini');
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
      setToolInfo('Teks pada area ini sudah terdata');
      return;
    }

    // Add new words to this page
    if (!page.words) page.words = [];
    page.words.push(...uniqueWords.map((w) => ({ ...w, pageIndex: page.pageIndex })));

    syncEditableWords();
    setToolInfo(`Berhasil mengekstrak ${uniqueWords.length} kata baru!`);
  } catch (error) {
    console.error('Region scan failed:', error);
    setToolInfo('Gagal memindai area');
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
    ? allFaceRegionsWithIds.value
        .filter((f) => isFaceActive(f.id))
        .map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h, score: f.score, pageIndex: f.pageIndex }))
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
  nextTick(() => {
    zoomReset();
  });
});
</script>

<style scoped>
/* Custom Dark Glassmorphism Scrollbars */
.custom-dark-scrollbar::-webkit-scrollbar,
.verification-theme ::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.custom-dark-scrollbar::-webkit-scrollbar-track,
.verification-theme ::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.6);
}

.custom-dark-scrollbar::-webkit-scrollbar-thumb,
.verification-theme ::-webkit-scrollbar-thumb {
  background: rgba(75, 85, 99, 0.7);
  border-radius: 9999px;
}

.custom-dark-scrollbar::-webkit-scrollbar-thumb:hover,
.verification-theme ::-webkit-scrollbar-thumb:hover {
  background: rgba(107, 114, 128, 0.95);
}

.custom-dark-scrollbar,
.verification-theme * {
  scrollbar-width: thin;
  scrollbar-color: rgba(75, 85, 99, 0.7) rgba(15, 23, 42, 0.6);
}

/* Smooth scrollbar hide utility */
.scrollbar-none::-webkit-scrollbar {
  display: none;
}
.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
