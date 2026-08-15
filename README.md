# 🛡️ Cherdocky — Offline-First PII Auto-Redactor & Document Processor

> **Client-Side, Zero-Leak, True Pixel-Level Document Redaction & Spatial OCR**

Cherdocky adalah aplikasi pemroses dokumen berbasis web yang bekerja **100% secara offline di sisi klien (browser)** untuk mendeteksi dan menyensor Informasi Identitas Pribadi (PII - *Personally Identifiable Information*), foto wajah, tanda tangan, dan data sensitif lainnya dari dokumen gambar maupun PDF.

---

## ⚠️ Masalah Kritis: Mengapa Coretan Editor Bawaan Berbahaya?

Banyak orang menyensor KTP, slip gaji, surat berharga, atau foto dokumen menggunakan fitur coret (*markup/pen/draw tool*) pada aplikasi bawaan ponsel (Gallery, Screenshot Editor) atau software pembaca PDF standar. **Metode ini memiliki celah keamanan fatal (*Security Vulnerability*):**

| Celah Editor Bawaan / PDF Standar | Risiko Keamanan | Solusi Cherdocky |
| :--- | :--- | :--- |
| **1. Text Layer Vektor Tetap Ada**<br>*(Vector Overlay Leak)* | Menaruh kotak hitam di atas teks PDF hanya membuat layer visual baru. Teks asli di baliknya masih ada dan **dapat di-copy-paste, di-search, atau diekstrak** menggunakan script `pdftotext`, Python PDF parser, atau scraper. | **Zero Text Layer (Flat PDF)**: Seluruh halaman PDF di-rasterisasi menjadi pixel datar sebelum diekspor. PDF hasil akhir murni berupa image tanpa text layer yang bisa disalin. |
| **2. Rekonstruksi Opacity / Exposure**<br>*(Opacity Leak)* | Kuas/spidol pada editor foto bawaan sering memiliki tingkat transparansi (alpha channel). Dengan menaikkan *exposure*, *brightness*, atau *contrast*, **tulisan di balik coretan dapat dibaca kembali dengan mudah**. | **Physical Pixel Overwrite**: Nilai RGB dari pixel target di memori RAM browser diganti secara fisik (`ctx.fillRect`) menjadi hitam pekat (RGB `0,0,0,255`). Data pixel asli dihancurkan secara permanen. |
| **3. Objek & Layer Terpisah**<br>*(Layer Stripping)* | Pada file PDF atau format gambar tertentu, coretan disimpan sebagai objek anotasi terpisah. Siapapun bisa membuka dokumen tersebut di editor lain lalu **menghapus layer kotak hitam tersebut** untuk melihat isi aslinya. | **Destructive Rasterization**: Tidak ada sistem layer terpisah. Redaksi menyatu secara permanen ke dalam canvas pixel sebelum di-render ulang. |
| **4. Kebocoran Metadata & EXIF** | Foto dari kamera ponsel menyimpan informasi sensitif seperti koordinat GPS lokasi pengambilan foto, tipe perangkat, dan waktu pengambilan. | **Metadata Stripping**: Konversi canvas ke format baru secara otomatis membersihkan seluruh metadata EXIF dari gambar asli. |
| **5. Privasi Cloud / Server Leak** | Banyak alat redaksi online mengunggah dokumen Anda ke server pihak ketiga untuk diproses. | **100% Offline-First**: Pemrosesan OCR, deteksi wajah, dan redaksi berjalan sepenuhnya di browser pengguna tanpa lalu lintas jaringan ke server. |

---

## 🔬 Bagaimana Cherdocky Bekerja (True Pixel-Level Redaction)

Cherdocky menerapkan pipeline **Rasterization & Pixel Destruction** 3 tahap yang ketat:

```
[ Upload File (PDF / Gambar) ]
             │
             ▼
   [ Tahap A: Rasterisasi ]
   (pdfjs-dist / HTML5 Image ──> Off-Screen HTML5 Canvas)
   Mengubah seluruh halaman dokumen menjadi matriks pixel datar murni.
             │
             ▼
   [ Tahap B: Penimpaan Pixel (Pixel Overwrite) ]
   (Tesseract OCR + MediaPipe AI Face Detection + Koordinat Manual)
   Menjalankan ctx.fillRect() langsung ke buffer memori pixel canvas.
   Data asli dihancurkan secara permanen di RAM.
             │
             ▼
   [ Tahap C: Rekonstruksi & Re-Export ]
   (jsPDF / Canvas Blob)
   Membungkus canvas hasil redaksi menjadi PDF berbasis gambar datar
   tanpa layer teks sama sekali atau mengunduhnya sebagai gambar bersih.
```

---

## ✨ Fitur Utama

- 🔒 **100% Offline-First & Private**: Dokumen Anda tidak pernah meninggalkan perangkat. Tidak ada API eksternal yang menerima isi dokumen Anda.
- 📑 **Dukungan Multi-Format**:
  - **Gambar**: JPEG, PNG, WebP (termasuk foto KTP, SIM, paspor, struk, dokumen scan).
  - **PDF Berbasis Teks**: Ekstraksi spasial langsung dengan konversi akhir anti-bocor.
  - **PDF Hasil Scan**: Rasterisasi otomatis halaman dan analisis OCR mendalam.
- 🤖 **Deteksi Otomatis PII (Spatial Regex)**:
  - 🆔 **NIK** (Nomor Induk Kependudukan 16 digit)
  - 📱 **Nomor Telepon** (Format Indonesia & Internasional)
  - 📧 **Alamat Email**
  - 🛂 **Nomor Paspor / ID**
  - 💳 **Nomor Rekening Bank**
  - 🔑 **Kata Sandi / PIN**
  - ✏️ **Custom Keyword** (Ketik kata tertentu yang ingin disensor otomatis)
- 👤 **Deteksi Otomatis Wajah & Foto Profil (On-Device AI)**:
  - Menggunakan model **MediaPipe BlazeFace** yang berjalan di browser via WebAssembly & WebGL.
  - Mendeteksi wajah pada foto dokumen (seperti foto pada KTP/Paspor/ID Card) dan menandainya otomatis untuk disensor.
- 🎨 **Verifikasi Interaktif & Manual Blocking**:
  - **Mode 🔍 Re-scan**: Drag area yang buram/tidak terbaca untuk menjalankan OCR ulang dengan kontras yang ditingkatkan.
  - **Mode 🚫 Block**: Drag area berbentuk bebas untuk menyensor foto, wajah yang luput, logo instansi, tanda tangan, atau cap/stempel.
  - **Click-to-Toggle**: Klik pada kata atau area sensor untuk mengaktifkan/menonaktifkan redaksi.
  - **Zoom & Pan**: Kontrol zoom presisi untuk memeriksa dokumen detail sebelum diekspor.

---

## 🛠️ Arsitektur & Teknologi

- **Frontend Framework**: [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`, TypeScript)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) & [Lucide Icons](https://lucide.dev/)
- **OCR Engine**: [Tesseract.js](https://github.com/naptha/tesseract.js) (Spatial word-level bounding box mapping)
- **PDF Engine**: [pdfjs-dist](https://mozilla.github.io/pdf.js/) (Rendering & text extraction)
- **Secure PDF Generator**: [jsPDF](https://github.com/parallax/jsPDF) (Flat image-only PDF builder)
- **Face Detection AI**: [@mediapipe/tasks-vision](https://developers.google.com/mediapipe/solutions/vision/face_detector) (BlazeFace Short-Range)
- **Utilities**: [@vueuse/core](https://vueuse.org/)

---

## 🚀 Memulai (Getting Started)

### Prasyarat

- [Node.js](https://nodejs.org/) versi 18.0.0 atau lebih baru
- `npm`, `pnpm`, atau `yarn`

### Instalasi & Menjalankan Lokal

1. **Clone repositori:**
   ```bash
   git clone https://github.com/ImamWahyudiz/Cherdocky.git
   cd Cherdocky
   ```

2. **Instal dependensi:**
   ```bash
   npm install
   ```

3. **Jalankan Development Server:**
   ```bash
   npm run dev
   ```
   Buka browser di `http://localhost:5173`.

4. **Build untuk Produksi:**
   ```bash
   npm run build
   ```
   Hasil build siap deploy akan tersedia di folder `dist/`.

---

## 📄 Lisensi

Proyek ini dilisensikan di bawah [Lisensi MIT](LICENSE) — bebas digunakan, dimodifikasi, dan didistribusikan untuk keperluan pribadi maupun komersial.
