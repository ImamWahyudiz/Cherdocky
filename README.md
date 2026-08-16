# Cherdocky — Offline-First PII Auto-Redactor & Document Processor

<p align="center">
  <img src="public/favicon.svg" alt="Cherdocky Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>Client-Side, Zero-Leak, Pixel-Level Document Redaction & Spatial OCR</strong>
</p>

<p align="center">
  <a href="https://imamwahyudiz.github.io/Cherdocky/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-2563eb?style=flat-square" alt="Live Demo on GitHub Pages" /></a>
  <img src="https://img.shields.io/badge/Privacy-100%25_Offline-16a34a?style=flat-square" alt="100% Offline" />
  <img src="https://img.shields.io/badge/Security-Flat_PDF_Output-dc2626?style=flat-square" alt="Flat PDF Output" />
  <img src="https://img.shields.io/badge/Vue-3.x-42b883?style=flat-square&logo=vue.js" alt="Vue 3" />
  <img src="https://img.shields.io/badge/License-MIT-gray?style=flat-square" alt="MIT License" />
</p>

---

## Akses Langsung (Live Demo)

Aplikasi dapat langsung dicoba melalui peramban web tanpa instalasi:

👉 **[Cherdocky Web App (GitHub Pages)](https://imamwahyudiz.github.io/Cherdocky/)**

> **Catatan Keamanan**: Seluruh proses pemindaian OCR, deteksi wajah, dan redaksi dokumen dieksekusi secara lokal di peramban web (sisi klien). Dokumen Anda tidak diunggah ke server eksternal.

---

## Daftar Isi

1. [Latar Belakang: Masalah pada Sensor Dokumen Konvensional](#latar-belakang-masalah-pada-sensor-dokumen-konvensional)
2. [Fitur Utama](#fitur-utama)
3. [Perbandingan dengan Metode Lain](#perbandingan-dengan-metode-lain)
4. [Cara Kerja Sistem](#cara-kerja-sistem)
5. [Dokumentasi Logika & Alur Sistem](#dokumentasi-logika--alur-sistem)
6. [Teknologi yang Digunakan](#teknologi-yang-digunakan)
7. [Panduan Penggunaan](#panduan-penggunaan)
8. [Menjalankan Proyek Secara Lokal](#menjalankan-proyek-secara-lokal)
9. [Lisensi](#lisensi)

---

## Latar Belakang: Masalah pada Sensor Dokumen Konvensional

Banyak pengguna menyensor dokumen (KTP, slip gaji, rekening, dll.) menggunakan fitur coret bawaan ponsel atau anotasi PDF standar. Metode ini sering kali menyisakan celah:

| Celah pada Metode Biasa | Potensi Masalah | Pendekatan Cherdocky |
| :--- | :--- | :--- |
| **Text Layer PDF Masih Ada**<br>*(Vector Overlay)* | Kotak hitam hanya menutupi visual. Teks asli di baliknya masih dapat disalin atau diekstrak dengan script parser PDF. | **Flat Image PDF**: Dokumen di-rasterisasi menjadi citra datar sehingga tidak menyisakan text layer yang bisa disalin. |
| **Transparansi Spidol/Kuas**<br>*(Opacity Issue)* | Spidol digital sering memiliki alpha/transparansi. Menaikkan brightness/kontras dapat menampakkan teks di baliknya. | **Pixel Overwrite**: Mengganti nilai RGB pixel pada memori canvas secara penuh dengan warna solid. |
| **Layer Anotasi Terpisah** | Coretan disimpan sebagai objek terpisah yang dapat dihapus menggunakan editor PDF lain. | **Destructive Rasterization**: Redaksi digabungkan langsung ke dalam pixel canvas sebelum file dibuat ulang. |
| **Metadata & EXIF** | Foto dokumen dari ponsel dapat memuat info koordinat GPS dan perangkat. | **Metadata Stripping**: Konversi canvas ke format baru secara otomatis membersihkan metadata EXIF. |
| **Privasi Cloud** | Alat sensor online umumnya mengunggah file pengguna ke server pihak ketiga. | **100% Offline-First**: Pemrosesan OCR dan deteksi berjalan di perangkat lokal pengguna. |

---

## Fitur Utama

- **Pemrosesan di Sisi Klien**: Seluruh alur kerja berjalan di browser pengguna tanpa lalu lintas dokumen ke server luar.
- **Dukungan Format Dokumen**:
  - **Gambar**: JPEG, PNG, WebP (termasuk unggah beberapa file sekaligus / batch).
  - **PDF Digital (Text-Based)**: Ekstraksi posisi teks cepat dari matriks dokumen.
  - **PDF Hasil Scan**: Rasterisasi halaman dokumen dan analisis OCR per halaman.
- **Deteksi Data Sensitif (PII)**:
  - NIK (16 digit dengan normalisasi karakter angka OCR).
  - Nomor Telepon (format seluler Indonesia, internasional, dan telepon rumah).
  - Alamat Email.
  - Tanggal Lahir (DOB) & Tempat Tanggal Lahir (TTL).
  - NPWP dan Nomor BPJS / KIS.
  - Nomor Rekening Bank dan Nomor Paspor / SIM / ID.
  - Deteksi berbasis kedekatan label (*contextual proximity*) untuk kata di samping atau di bawah label sensitif.
  - Pencarian kata kunci kustom (*Custom Keyword Search*).
- **Deteksi Wajah On-Device**:
  - Menggunakan model MediaPipe BlazeFace berbasis WebAssembly untuk mendeteksi foto wajah pada kartu identitas.
- **Alat Verifikasi & Koreksi Manual**:
  - **Click-to-Toggle**: Klik kotak teks atau wajah untuk mengaktifkan atau membatalkan sensor.
  - **Mode Blok Manual**: Drag area bebas untuk menyensor tanda tangan, cap stempel, atau logo.
  - **Mode Scan Area**: Drag area tertentu yang buram untuk OCR ulang dengan penyesuaian kontras.
  - **Rotasi Dokumen**: Putar halaman 90° dengan pembaruan posisi koordinat bounding box secara sinkron.
  - **Zoom & Pas Layar**: Kontrol pembesaran dokumen dan navigasi antar halaman.
- **Pilihan Ekspor**:
  - Ekspor ke Flat PDF (dokumen berbasis citra murni).
  - Ekspor ke format gambar (PNG / JPEG) atau arsip ZIP untuk dokumen multi-halaman.

---

## Perbandingan dengan Metode Lain

| Aspek | Editor Bawaan / Markup | PDF Reader Standar | Layanan Online Cloud | Cherdocky |
| :--- | :---: | :---: | :---: | :---: |
| **Lokasi Proses** | Lokal | Lokal | Server Cloud | **Lokal (Browser)** |
| **Text Layer PDF** | Rawan tertinggal | Tergantung fitur | Bervariasi | **Bebas Text Layer (Flat)** |
| **Penimpaan Pixel** | Berisiko transparansi | Anotasi terpisah | Bervariasi | **Solid Pixel Overwrite** |
| **Deteksi PII Otomatis** | Tidak ada | Manual | Ada (File diunggah) | **Otomatis (Lokal)** |
| **Deteksi Wajah AI** | Tidak ada | Tidak ada | Ada (File diunggah) | **MediaPipe AI (Lokal)** |
| **Metadata EXIF** | Tetap tersimpan | Tetap tersimpan | Bervariasi | **Dibersihkan otomatis** |

---

## Cara Kerja Sistem

Pipeline redaksi dokumen berjalan dalam 3 tahap:

<p align="center">
  <img src="public/redaction_flow.svg" alt="Diagram Alur Redaksi Cherdocky" width="100%" />
</p>

1. **Tahap 1: Ingestion & Rasterisasi** — Mengubah seluruh halaman dokumen (PDF / Gambar) menjadi bidang citra canvas datar tanpa layer teks terpisah.
2. **Tahap 2: Deteksi & Penimpaan Pixel Fisik** — Menjalankan deteksi teks spasial (OCR Tesseract.js), deteksi wajah (MediaPipe BlazeFace), dan input sensor manual. Pixel target ditimpa secara permanen dengan `ctx.fillRect` (RGB solid).
3. **Tahap 3: Penyusunan Dokumen Baru** — Membungkus canvas bersih menjadi Flat PDF (bebas text layer) atau file gambar murni dengan metadata EXIF yang dibersihkan.

---

## Dokumentasi Logika & Alur Sistem

Rincian mengenai alur data, arsitektur modul, struktur data, dan catatan evaluasi teknis tersedia pada dokumen berikut:

👉 **[SYSTEM_FLOW.md](SYSTEM_FLOW.md)**

---

## Teknologi yang Digunakan

- **Frontend**: Vue 3 (Composition API, TypeScript)
- **Build Tool**: Vite
- **Styling**: Tailwind CSS & Lucide Icons
- **OCR**: Tesseract.js (WebAssembly)
- **PDF Processing**: pdfjs-dist, jsPDF, dan pdf-lib
- **Face Detection**: Google MediaPipe Vision (BlazeFace Short-Range WASM)
- **Utilities**: VueUse

---

## Panduan Penggunaan

1. **Unggah Dokumen**: Masukkan file gambar (JPG, PNG, WebP) atau berkas PDF.
2. **Pilih Mode (Khusus PDF)**: Pilih mode teks cepat untuk PDF digital atau mode scan OCR untuk dokumen hasil pemindaian.
3. **Periksa & Sesuaikan Sensor**: Tinjau area yang terdeteksi otomatis, gunakan klik untuk toggle sensor, atau gunakan mode blok manual untuk menandai area tambahan.
4. **Ekspor**: Klik tombol konfirmasi ekspor dan pilih format output yang diinginkan (Flat PDF atau Gambar).

---

## Menjalankan Proyek Secara Lokal

### Prasyarat
- Node.js versi 18 atau lebih baru
- npm, pnpm, atau yarn

### Langkah Instalasi
```bash
# 1. Clone repositori
git clone https://github.com/ImamWahyudiz/Cherdocky.git
cd Cherdocky

# 2. Instal dependensi
npm install

# 3. Jalankan development server
npm run dev
```
Buka browser pada alamat `http://localhost:5173`.

### Build Produksi
```bash
npm run build
```
File hasil kompilasi akan tersimpan di direktori `dist/`.

---

## Lisensi

Proyek ini menggunakan [Lisensi MIT](LICENSE).
