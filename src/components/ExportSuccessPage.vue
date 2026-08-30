<template>
  <div class="w-full max-w-4xl mx-auto px-4 py-8 sm:py-12 flex flex-col items-center select-none text-gray-200">
    
    <!-- Success Celebration Header -->
    <div class="text-center mb-8 animate-in fade-in zoom-in duration-300">
      <div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_30px_rgba(16,185,129,0.3)]">
        <CheckCircle2 class="w-9 h-9 sm:w-11 sm:h-11 stroke-[2.5]" />
      </div>
      <h1 class="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
        Dokumen Berhasil Diredaksi!
      </h1>
      <p class="text-xs sm:text-sm text-gray-400 max-w-lg mx-auto leading-relaxed">
        Seluruh data pribadi, wajah, dan area sensitif telah dihapus secara permanen di dalam peramban Anda. Dokumen siap diunduh dan aman untuk dibagikan.
      </p>
    </div>

    <!-- Main Download Action Box (With Customizable Filename) -->
    <div class="w-full bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-7 shadow-2xl mb-6">
      <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        
        <!-- File Info Summary & Customizable Filename Input -->
        <div class="flex items-start sm:items-center gap-4 w-full lg:w-auto flex-1 min-w-0">
          <div class="w-13 h-13 sm:w-14 sm:h-14 rounded-xl bg-blue-950/60 border border-blue-800/80 text-blue-400 flex items-center justify-center flex-shrink-0 shadow-inner mt-1 sm:mt-0">
            <FileText v-if="stats.documentType.includes('pdf')" class="w-7 h-7" />
            <Layers v-else-if="stats.documentType === 'image' && stats.totalPages > 1" class="w-7 h-7" />
            <FileImage v-else class="w-7 h-7" />
          </div>
          
          <div class="flex-1 min-w-0 w-full">
            <label class="block text-[11px] font-bold text-gray-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <span>Nama Berkas Unduhan:</span>
              <span class="text-[10px] text-blue-400 font-normal lowercase">(dapat diubah sesuai keinginan)</span>
            </label>
            
            <div class="relative flex items-center max-w-md w-full">
              <input
                type="text"
                v-model="userBaseFilename"
                :placeholder="getDefaultBaseName()"
                class="w-full bg-gray-950/90 border border-gray-700 hover:border-gray-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 text-white text-sm font-semibold rounded-xl pl-3.5 pr-16 py-2.5 transition-all outline-none font-mono"
                title="Ketik untuk mengubah nama berkas yang akan diunduh"
              />
              <span class="absolute right-2 px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-xs font-mono font-bold text-blue-400 pointer-events-none">
                {{ fileExtension }}
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-2 mt-2 text-xs text-gray-400">
              <span class="px-2 py-0.5 rounded bg-gray-800 border border-gray-700 font-semibold text-gray-300">
                {{ stats.documentType === 'text-pdf' ? 'PDF Teks Asli' : stats.documentType === 'image-pdf' ? 'PDF Visual Scan' : stats.totalPages > 1 ? `${stats.totalPages} Lembar Gambar` : 'Gambar' }}
              </span>
              <span>•</span>
              <span class="font-mono font-medium text-emerald-400 font-bold">
                {{ formatBytes(exportedFileSize) }}
              </span>
              <span v-if="originalFileSize > 0" class="text-[11px] text-gray-500">
                (Asli: {{ formatBytes(originalFileSize) }})
              </span>
            </div>
          </div>
        </div>

        <!-- Single Primary Download Button -->
        <div class="w-full lg:w-auto flex justify-end flex-shrink-0">
          <button
            type="button"
            @click="handleMainDownloadClick"
            class="w-full sm:w-auto h-12 px-8 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-bold rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2.5"
          >
            <Download class="w-5 h-5 stroke-[2.5]" />
            <span>Unduh Dokumen</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Audit & Redaction Statistics Dashboard (Dark Themed) -->
    <div class="w-full bg-gray-900 border border-gray-800 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-6 mb-8">
      
      <div class="flex items-center justify-between border-b border-gray-800 pb-4">
        <div class="flex items-center gap-2">
          <ShieldCheck class="w-5 h-5 text-blue-400" />
          <h3 class="text-sm sm:text-base font-bold text-white">
            Ringkasan Statistik &amp; Audit Redaksi
          </h3>
        </div>
        <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 font-semibold flex items-center gap-1.5 shadow-sm">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
          100% Bersih &amp; Terproteksi
        </span>
      </div>

      <!-- Quick Metrics Grid -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        
        <!-- Metric 1: Total Kata Disensor -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Kata Disensor</span>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-extrabold text-red-400 font-mono">{{ stats.totalRedactedWords }}</span>
            <span class="text-xs text-gray-500">kata</span>
          </div>
        </div>

        <!-- Metric 2: Wajah Disensor -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Wajah Disensor</span>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-extrabold text-purple-400 font-mono">{{ stats.totalRedactedFaces }}</span>
            <span class="text-xs text-gray-500">wajah</span>
          </div>
        </div>

        <!-- Metric 3: Blok Manual -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Blok Manual</span>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-extrabold text-amber-400 font-mono">{{ stats.totalManualRegions }}</span>
            <span class="text-xs text-gray-500">area</span>
          </div>
        </div>

        <!-- Metric 4: Total Lembar -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex flex-col justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Total Lembar</span>
          <div class="mt-2 flex items-baseline gap-1">
            <span class="text-2xl font-extrabold text-gray-100 font-mono">{{ stats.totalPages }}</span>
            <span class="text-xs text-gray-500">halaman</span>
          </div>
        </div>
      </div>

      <!-- Additional Details: Redaction Color, File Sizes & Engine -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-1">
        
        <!-- Redaction Color Swatch -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Warna Sensor Digunakan</span>
          <div class="flex items-center gap-2">
            <span
              class="w-5 h-5 rounded-full border border-gray-600 shadow-sm"
              :style="{ backgroundColor: stats.redactionColor || '#000000' }"
            ></span>
            <span class="text-xs font-semibold text-gray-200">
              {{ getColorName(stats.redactionColor) }}
            </span>
          </div>
        </div>

        <!-- File Compression / Difference -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">Ukuran File Ekspor</span>
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono font-bold text-white">
              {{ formatBytes(exportedFileSize) }}
            </span>
            <span v-if="originalFileSize > 0 && exportedFileSize < originalFileSize" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 font-bold">
              -{{ Math.round((1 - exportedFileSize / originalFileSize) * 100) }}%
            </span>
          </div>
        </div>

        <!-- OCR Engine Used -->
        <div class="bg-gray-850 border border-gray-750 rounded-xl p-3.5 flex items-center justify-between shadow-sm">
          <span class="text-xs text-gray-400 font-medium">OCR Engine</span>
          <div class="flex items-center gap-2">
            <component :is="activeEngine === 'onnx' ? Cpu : Loader2" class="w-4 h-4" />
            <span
              class="text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider"
              :class="engineBadgeClass"
            >
              {{ engineDisplayText }}
            </span>
          </div>
        </div>
      </div>

      <!-- Scrollable List of Redacted Words Content (Compact & Scrollable) -->
      <div class="pt-2 border-t border-gray-800">
        <div class="flex items-center gap-1.5 mb-2.5">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>
          <h4 class="text-xs font-bold text-gray-200 uppercase tracking-wider">
            Daftar Teks &amp; Kata yang Telah Disensor ({{ uniqueRedactedWordsList.length }} unik / {{ stats.totalRedactedWords }} total)
          </h4>
        </div>

        <!-- Scrollable Tag Box -->
        <div
          v-if="uniqueRedactedWordsList.length > 0"
          class="max-h-48 overflow-y-auto p-3 bg-gray-950/80 border border-gray-800 rounded-xl flex flex-wrap gap-1.5 custom-success-scrollbar"
        >
          <div
            v-for="item in uniqueRedactedWordsList"
            :key="item.text"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-950/40 border border-red-800/60 text-red-200 text-xs shadow-sm"
          >
            <span class="font-semibold max-w-[200px] truncate" :title="item.text">
              {{ item.text }}
            </span>
            <span v-if="item.count > 1" class="text-[10px] px-1 py-0.2 rounded-full bg-red-900/60 text-red-200 font-mono font-bold">
              {{ item.count }}x
            </span>
          </div>
        </div>

        <div v-else class="p-4 bg-gray-850/40 rounded-xl border border-dashed border-gray-800 text-center">
          <p class="text-xs text-gray-400">
            Tidak ada kata teks yang disensor (dokumen diproteksi melalui sensor blok manual / deteksi wajah).
          </p>
        </div>
      </div>

      <!-- Zero-Leak Privacy Stamp -->
      <div class="p-3.5 bg-blue-950/30 border border-blue-900/50 rounded-xl flex items-start gap-3">
        <Shield class="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
        <div class="text-xs text-blue-200 leading-relaxed">
          <span class="font-bold">Jaminan Keamanan 100% Client-Side:</span> Dokumen asli dan hasil sensor diproses seutuhnya di memori browser lokal perangkat Anda tanpa pernah dikirim, disimpan, atau dianalisis di server mana pun.
        </div>
      </div>

    </div>

    <!-- Navigation Action Buttons -->
    <div class="w-full flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
      
      <!-- Back to Verification / Edit Again -->
      <button
        type="button"
        @click="$emit('edit-again')"
        class="w-full sm:w-auto h-10 px-5 bg-gray-800 hover:bg-gray-750 active:scale-95 text-gray-300 text-xs sm:text-sm font-medium rounded-xl border border-gray-700 transition-all flex items-center justify-center gap-2 shadow-sm"
      >
        <Edit3 class="w-4 h-4 text-gray-400" />
        <span>Sesuaikan / Edit Ulang Dokumen Ini</span>
      </button>

      <!-- Clean Reset / New Document -->
      <button
        type="button"
        @click="$emit('new-document')"
        class="w-full sm:w-auto h-10 px-6 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs sm:text-sm font-semibold rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
      >
        <PlusCircle class="w-4 h-4" />
        <span>Sensor Dokumen Baru</span>
      </button>
    </div>

    <!-- Modal 1: Choice for Single Image Export (Optimal vs Max vs PDF) -->
    <div
      v-if="showSingleImageChoiceModal"
      class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div class="w-12 h-12 rounded-xl bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center mb-4">
          <FileImage class="w-6 h-6" />
        </div>
        <h3 class="text-lg font-bold text-white mb-1.5">
          Pilih Format &amp; Kualitas Unduhan
        </h3>
        <p class="text-xs text-gray-400 mb-5 leading-relaxed">
          Pilih versi berkas yang ingin Anda simpan:
        </p>

        <div class="space-y-3">
          <!-- Option 1: Gambar Optimal (Rekomendasi) -->
          <button
            type="button"
            @click="chooseOption('image-optimal')"
            class="w-full p-3.5 rounded-xl border border-blue-800/60 bg-blue-950/30 hover:bg-blue-900/50 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-blue-600 text-white flex-shrink-0 mt-0.5">
              <Sparkles class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-blue-300 flex items-center gap-1.5">
                <span>Gambar Optimal (Rekomendasi)</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-900/80 text-blue-200">Kompak &amp; Tajam</span>
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Teks tetap terbaca sangat jelas, ukuran file hemat dan pas untuk dikirim/diunggah.
              </div>
            </div>
          </button>

          <!-- Option 2: Gambar Kualitas Maksimal (HD) -->
          <button
            type="button"
            @click="chooseOption('image-max')"
            class="w-full p-3.5 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-800 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-gray-700 text-white flex-shrink-0 mt-0.5">
              <FileImage class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-gray-200">
                Gambar Kualitas Maksimal (HD / Lossless)
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Resolusi penuh tanpa kompresi (ukuran berkas lebih besar).
              </div>
            </div>
          </button>

          <!-- Option 3: Dokumen PDF -->
          <button
            type="button"
            @click="chooseOption('single-pdf-optimal')"
            class="w-full p-3.5 rounded-xl border border-purple-800/60 bg-purple-950/30 hover:bg-purple-900/50 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-purple-600 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-purple-300">
                Konversi Jadi Dokumen PDF
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Mengonversi gambar menjadi berkas PDF siap simpan / cetak.
              </div>
            </div>
          </button>
        </div>

        <button
          type="button"
          @click="showSingleImageChoiceModal = false"
          class="mt-4 w-full py-2 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          Batal
        </button>
      </div>
    </div>

    <!-- Modal 2: Choice for Multi-Image Export (Merged PDF vs ZIP) -->
    <div
      v-if="showMultiImageChoiceModal"
      class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div class="w-12 h-12 rounded-xl bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center mb-4">
          <Layers class="w-6 h-6" />
        </div>
        <h3 class="text-lg font-bold text-white mb-1.5">
          Pilihan Format Unduhan Multi-Lembar
        </h3>
        <p class="text-xs text-gray-400 mb-5 leading-relaxed">
          Anda menyensor {{ stats.totalPages }} lembar gambar. Silakan pilih format berkas unduhan:
        </p>

        <div class="space-y-3">
          <!-- Option 1: Merged PDF Optimal -->
          <button
            type="button"
            @click="chooseOption('multi-pdf-optimal')"
            class="w-full p-3.5 rounded-xl border border-blue-800/60 bg-blue-950/30 hover:bg-blue-900/50 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-blue-600 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-blue-300 flex items-center gap-1.5">
                <span>Gabung Jadi 1 File PDF (Optimal)</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-900/80 text-blue-200">Rekomendasi</span>
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Semua gambar dirangkum menjadi satu dokumen PDF dengan ukuran hemat &amp; teks tajam.
              </div>
            </div>
          </button>

          <!-- Option 2: Merged PDF HD -->
          <button
            type="button"
            @click="chooseOption('multi-pdf-max')"
            class="w-full p-3.5 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-800 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-gray-700 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-gray-200">
                Gabung Jadi 1 File PDF (Kualitas HD Penuh)
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Mempertahankan ketajaman visual maksimal tanpa kompresi agresif.
              </div>
            </div>
          </button>

          <!-- Option 3: ZIP Archive -->
          <button
            type="button"
            @click="chooseOption('multi-zip')"
            class="w-full p-3.5 rounded-xl border border-emerald-800/60 bg-emerald-950/30 hover:bg-emerald-900/50 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-emerald-600 text-white flex-shrink-0 mt-0.5">
              <Archive class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-emerald-300">
                Unduh Arsip ZIP (Gambar Terpisah)
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Menyimpan seluruh file gambar individual yang sudah disensor ke dalam satu paket ZIP.
              </div>
            </div>
          </button>
        </div>

        <button
          type="button"
          @click="showMultiImageChoiceModal = false"
          class="mt-4 w-full py-2 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          Batal
        </button>
      </div>
    </div>

    <!-- Modal 3: Choice for Scanned PDF Export (Optimal vs Max HD) -->
    <div
      v-if="showScannedPdfChoiceModal"
      class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    >
      <div class="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl text-gray-200 animate-in fade-in zoom-in-95 duration-150">
        <div class="w-12 h-12 rounded-xl bg-blue-950/70 border border-blue-800/80 text-blue-400 flex items-center justify-center mb-4">
          <FileText class="w-6 h-6" />
        </div>
        <h3 class="text-lg font-bold text-white mb-1.5">
          Pilih Kualitas Berkas PDF
        </h3>
        <p class="text-xs text-gray-400 mb-5 leading-relaxed">
          Tentukan profil ukuran &amp; kualitas untuk PDF hasil scan ini:
        </p>

        <div class="space-y-3">
          <!-- Option 1: PDF Scan Optimal -->
          <button
            type="button"
            @click="chooseOption('scanned-pdf-optimal')"
            class="w-full p-3.5 rounded-xl border border-blue-800/60 bg-blue-950/30 hover:bg-blue-900/50 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-blue-600 text-white flex-shrink-0 mt-0.5">
              <Sparkles class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-blue-300 flex items-center gap-1.5">
                <span>PDF Ukuran Optimal (Rekomendasi)</span>
                <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-900/80 text-blue-200">Cepat &amp; Jelas</span>
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Mengompresi halaman secara cerdas agar ukuran file seimbang dan teks tetap tajam.
              </div>
            </div>
          </button>

          <!-- Option 2: PDF Scan HD -->
          <button
            type="button"
            @click="chooseOption('scanned-pdf-max')"
            class="w-full p-3.5 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-800 text-left transition-colors flex items-start gap-3.5 group"
          >
            <div class="p-2.5 rounded-lg bg-gray-700 text-white flex-shrink-0 mt-0.5">
              <FileText class="w-4 h-4" />
            </div>
            <div>
              <div class="font-semibold text-sm text-white group-hover:text-gray-200">
                PDF Kualitas HD Maksimal
              </div>
              <div class="text-[11px] text-gray-400 mt-0.5">
                Resolusi tertinggi tanpa kompresi tambahan (cocok untuk cetak dokumen penting).
              </div>
            </div>
          </button>
        </div>

        <button
          type="button"
          @click="showScannedPdfChoiceModal = false"
          class="mt-4 w-full py-2 text-xs font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          Batal
        </button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import {
  CheckCircle2,
  Download,
  FileText,
  FileImage,
  Layers,
  Archive,
  ShieldCheck,
  Shield,
  Edit3,
  PlusCircle,
  Sparkles,
  Cpu,
  Loader2,
} from 'lucide-vue-next';

export interface RedactionExportStats {
  documentType: string;
  totalPages: number;
  totalRedactedWords: number;
  totalRedactedFaces: number;
  totalManualRegions: number;
  redactionColor: string;
  redactedWordsList: string[];
}

const props = defineProps<{
  blob: Blob | null;
  filename: string;
  originalFileSize: number;
  exportedFileSize: number;
  stats: RedactionExportStats;
}>();

const emit = defineEmits<{
  (e: 'download-direct', customFilename: string): void;
  (e: 'download-option', payload: { option: string; customFilename: string }): void;
  (e: 'edit-again'): void;
  (e: 'new-document'): void;
}>();

const userBaseFilename = ref('');

const fileExtension = computed(() => {
  const name = props.filename || 'dokumen_redacted.pdf';
  const lastDot = name.lastIndexOf('.');
  if (lastDot !== -1) {
    return name.substring(lastDot);
  }
  return props.stats.documentType.includes('pdf') ? '.pdf' : '.jpg';
});

// Engine info (reads from window.__OCR_ENGINE set by MainPage)
type EngineMode = 'auto' | 'tesseract' | 'onnx';

function getResolvedEngine(): 'tesseract' | 'onnx' {
  const w = typeof window !== 'undefined' ? (window as any).__OCR_ENGINE : undefined;
  if (w === 'onnx' || w === 'tesseract') return w;
  try {
    const stored = localStorage.getItem('cherdocky.ocr-engine');
    if (stored === 'onnx' || stored === 'tesseract') return stored;
  } catch (_) {}
  return 'tesseract';
}

const activeEngine = computed<'tesseract' | 'onnx'>(() => getResolvedEngine());

const engineDisplayText = computed(() => {
  const choice = (typeof window !== 'undefined' ? (window as any).__OCR_ENGINE : null) as EngineMode | null;
  if (choice === 'onnx') return 'ONNX v5';
  if (choice === 'tesseract') return 'Tesseract';
  if (choice === 'auto') return `Auto → ${activeEngine.value === 'onnx' ? 'ONNX' : 'Tesseract'}`;
  return `Auto → ${activeEngine.value === 'onnx' ? 'ONNX' : 'Tesseract'}`;
});

const engineBadgeClass = computed(() => {
  const choice = (typeof window !== 'undefined' ? (window as any).__OCR_ENGINE : null) as EngineMode | null;
  if (choice === 'onnx') return 'bg-blue-600 text-white border-blue-500/30';
  if (choice === 'tesseract') return 'bg-amber-600 text-black border-amber-500/30';
  return 'bg-gray-600 text-white border-gray-500/30';
});

function getDefaultBaseName(): string {
  if (props.stats.documentType.includes('pdf')) {
    return 'redacted-pdf';
  } else if (props.stats.totalPages > 1) {
    return 'redacted-images';
  } else {
    return 'redacted-image';
  }
}

watch(
  () => props.filename,
  (newVal) => {
    if (newVal) {
      const lastDot = newVal.lastIndexOf('.');
      userBaseFilename.value = lastDot !== -1 ? newVal.substring(0, lastDot) : newVal;
    } else {
      userBaseFilename.value = getDefaultBaseName();
    }
  },
  { immediate: true }
);

function getCleanBaseName(): string {
  const base = userBaseFilename.value.trim() || getDefaultBaseName();
  return base.replace(/[/\\?%*:|"<>]/g, '_');
}

function getFinalFilename(customExt?: string): string {
  const cleanBase = getCleanBaseName();
  const ext = customExt || fileExtension.value;
  const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
  return `${cleanBase}${normalizedExt}`;
}

const showSingleImageChoiceModal = ref(false);
const showMultiImageChoiceModal = ref(false);
const showScannedPdfChoiceModal = ref(false);

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getColorName(hex: string): string {
  const colors: Record<string, string> = {
    '#000000': 'Hitam',
    '#ffffff': 'Putih',
    '#374151': 'Abu-abu',
    '#1e3a8a': 'Navy',
    '#b91c1c': 'Merah',
  };
  return colors[hex?.toLowerCase()] || hex || 'Hitam';
}

const uniqueRedactedWordsList = computed(() => {
  const map = new Map<string, number>();
  (props.stats.redactedWordsList || []).forEach((text) => {
    const trimmed = text.trim();
    if (trimmed) {
      map.set(trimmed, (map.get(trimmed) || 0) + 1);
    }
  });

  return Array.from(map.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count);
});

function handleMainDownloadClick() {
  // Case 1: Native Vector PDF -> Direct Download (already small and lossless)
  if (props.stats.documentType === 'text-pdf') {
    emit('download-direct', getFinalFilename('.pdf'));
    return;
  }

  // Case 2: Scanned PDF -> Choice between Optimal vs HD
  if (props.stats.documentType === 'image-pdf') {
    showScannedPdfChoiceModal.value = true;
    return;
  }

  // Case 3: Single Image -> Choice between Optimal Image, Max HD Image, and PDF
  if (props.stats.documentType === 'image' && props.stats.totalPages <= 1) {
    showSingleImageChoiceModal.value = true;
    return;
  }

  // Case 4: Multiple Images -> Choice between Merged PDF (Optimal / HD) and ZIP
  if (props.stats.documentType === 'image' && props.stats.totalPages > 1) {
    showMultiImageChoiceModal.value = true;
    return;
  }

  emit('download-direct', getFinalFilename());
}

function chooseOption(option: string) {
  showSingleImageChoiceModal.value = false;
  showMultiImageChoiceModal.value = false;
  showScannedPdfChoiceModal.value = false;

  let ext = '.pdf';
  if (option === 'image-optimal') ext = '.jpg';
  else if (option === 'image-max') ext = '.png';
  else if (option === 'multi-zip') ext = '.zip';
  else if (option.includes('pdf')) ext = '.pdf';

  const customFilename = getFinalFilename(ext);
  emit('download-option', { option, customFilename });
}
</script>

<style scoped>
.custom-success-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-success-scrollbar::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.4);
  border-radius: 9999px;
}
.custom-success-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(75, 85, 99, 0.6);
  border-radius: 9999px;
}
.custom-success-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(107, 114, 128, 0.9);
}
.custom-success-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(75, 85, 99, 0.6) rgba(15, 23, 42, 0.4);
}
</style>
