# System Architecture, Logic, & Workflow (System Flow) — Cherdocky

This document details the **technical architecture, algorithmic logic, data flows, state management**, and **engineering evolution / design decision history** of **Cherdocky**.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [End-to-End Workflow Flowchart](#2-end-to-end-workflow-flowchart)
3. [Core Module Logic & Algorithms](#3-core-module-logic--algorithms)
   - [A. Document Ingestion & Routing Module](#a-document-ingestion--routing-module)
   - [B. Spatial OCR Engine (`ocrEngine.ts`)](#b-spatial-ocr-engine-ocrenginets)
   - [C. Contextual Spatial PII Detector (`piiDetector.ts`)](#c-contextual-spatial-pii-detector-piidetectorts)
   - [D. On-Device AI Face Detector (`faceDetector.ts`)](#d-on-device-ai-face-detector-facedetectorts)
   - [E. Interactive Canvas & Spatial Coordinate Engine (`DocumentVerification.vue`)](#e-interactive-canvas--spatial-coordinate-engine-documentverificationvue)
   - [F. Destructive Rasterization & Pixel Redactor (`redactor.ts`)](#f-destructive-rasterization--pixel-redactor-redactorts)
4. [State Management & Data Model](#4-state-management--data-model)
5. [Problem Log & Architectural Decision History](#5-problem-log--architectural-decision-history)
6. [Security Principles & Privacy Guarantee (Zero-Leak Guarantee)](#6-security-principles--privacy-guarantee-zero-leak-guarantee)

---

## 1. System Architecture Overview

Cherdocky is engineered with a strict **100% Offline-First Client-Side Execution** principle. All compute-intensive operations (PDF rendering, Tesseract / ONNX OCR, MediaPipe Face AI, pixel-level canvas manipulation, and PDF reconstruction) run entirely in the user's browser memory (RAM) via WebAssembly, WebGL, and the HTML5 Canvas API.

<p align="center">
  <img src="public/system_architecture.svg" alt="Cherdocky System Architecture Diagram" width="100%" />
</p>

---

## 2. End-to-End Workflow Flowchart

<p align="center">
  <img src="public/workflow_flowchart.svg" alt="Cherdocky Workflow Flowchart" width="100%" />
</p>

---

## 3. Core Module Logic & Algorithms

### A. Document Ingestion & Routing Module
- **File**: `src/composables/useDocumentIngestion.ts`
- **Role**: Serves as the primary orchestrator that accepts single or multi-file inputs, analyzes file characteristics, manages object URL lifecycles (`URL.createObjectURL` & `URL.revokeObjectURL`), and dispatches files to the optimal processing pipeline.
- **Intelligent Routing**:
  1. When a PDF is uploaded, `inspectPdfContent` inspects whether the document contains selectable digital text (`hasText`) and calculates its total page count.
  2. If the PDF contains native digital text, the system provides a modal choice:
     - **Native Text Mode (Ultra Fast)**: Directly extracts word geometry matrices from PDF streams without triggering heavy OCR computation.
     - **OCR Scan Mode (Deep)**: Rasterizes each page into high-DPI canvases and runs full OCR to capture handwritten text, physical stamps, or degraded scans.

### B. Spatial OCR Engine (`ocrEngine.ts`)
- **File**: `src/utils/ocrEngine.ts`
- **Role**: Executes local OCR via WebAssembly workers (Tesseract.js and ONNX Runtime Web) with fine-grained word-level bounding box calculations.
- **Key Capabilities**:
  - Emits word tokens with absolute spatial coordinates `(x, y, width, height)` alongside confidence scores.
  - Features `reScanRegion()` with localized adaptive preprocessing (contrast enhancement & binarization) when the user performs targeted re-scanning over blurry text regions.

### C. Contextual Spatial PII Detector (`piiDetector.ts`)
- **File**: `src/utils/piiDetector.ts`
- **Algorithmic Logic**:
  1. **Fuzzy Digit Normalization**:
     Scanned document OCR frequently misinterprets visually similar glyphs:
     - Letter `O`/`o` $\rightarrow$ Digit `0`
     - Letter `I`/`l`/`|` $\rightarrow$ Digit `1`
     - Letter `S`/`s` $\rightarrow$ Digit `5`
     - Letter `B` $\rightarrow$ Digit `8`
     `fuzzyNormalizeDigits()` sanitizes token strings prior to regular expression pattern testing.
  2. **Pattern Matching Regex**:
     - **NIK**: 16 isolated digits (Indonesian National Identification Number).
     - **Phone Numbers**: Indonesian mobile formats (`08xx`, `+628xx`, `628xx`), landlines (`(021)xxx`), and international numbers.
     - **Email**: RFC 5322 compliant email strings.
     - **Tax IDs (NPWP)**: 15-digit or 16-digit tax identifiers.
     - **Health & Social Security (BPJS)**: 13-digit registration numbers.
     - **Dates / DOB**: Formats including `DD/MM/YYYY`, `DD-MM-YYYY`, or full month names (Indonesian / English).
  3. **Contextual Spatial Proximity (Label-Adjacent Detection)**:
     Sensitive identifiers like *Full Name*, *Street Address*, or *Birth Place* do not follow fixed numeric regex patterns. The system detects key label words (e.g., `"Name"`, `"Nama"`, `"Address"`, `"Alamat"`, `"DOB"`, `"TTL"`) and automatically captures neighboring tokens situated immediately **to the right** ($|\Delta y| \le \text{threshold}$) or **directly beneath** on adjacent rows.

### D. On-Device AI Face Detector (`faceDetector.ts`)
- **File**: `src/utils/faceDetector.ts`
- **Role**: Loads the **Google MediaPipe BlazeFace Short-Range** model (`@mediapipe/tasks-vision`) running on WebAssembly/WebGL.
- **Logic**:
  - Consumes canvas or image bitmap elements.
  - Produces sub-pixel face coordinates normalized against document dimensions.
  - Automatically adds a dynamic padding margin (10–15%) around detected faces to guarantee full coverage of portraits and ID photos.

### E. Interactive Canvas & Spatial Coordinate Engine (`DocumentVerification.vue`)
- **File**: `src/components/DocumentVerification.vue`
- **Interactive Capabilities**:
  - **Responsive Coordinate Mapping**: Converts screen `clientX`/`clientY` points into document-space coordinates while accounting for `zoomLevel`, `rotation`, and scroll offsets.
  - **Manual Redaction Blocks**: Enables users to draw freehand rectangular redaction masks using pointer events.
  - **Targeted Area Re-Scan**: Allows drawing arbitrary selection boxes over blurry zones to trigger localized contrast-boosted OCR re-analysis.
  - **Mathematical Rotation Transforms**: When a page rotates 90° clockwise:
    $$x' = \text{height} - (y + h), \quad y' = x, \quad w' = h, \quad h' = w$$
    All spatial words and manual regions are recalculating instantaneously, preserving exact alignment.

### F. Destructive Rasterization & Pixel Redactor (`redactor.ts`)
- **File**: `src/utils/redactor.ts`
- **Anti-Leak Execution Logic**:
  1. Spawns an offscreen HTML5 Canvas configured at high resolution (`RASTER_SCALE` = 2x).
  2. Draws the base document page onto the canvas surface.
  3. Dispatches `ctx.fillStyle = redactionColor` and `ctx.fillRect(x, y, w, h)` directly to the target pixel memory.
  4. Replaces all original pixel buffer bytes with solid, 100% opaque color (RGB `0,0,0,255` or user choice).
  5. Compiles canvas buffers into flat image blobs or weaves them into a new Flat PDF via `jsPDF` / `pdf-lib`.
  6. The resultant PDF contains **exclusively flat raster image layers** with zero vector text, zero isolated markup objects, and zero residual EXIF metadata.

---

## 4. State Management & Data Model

Primary data models utilized across the interface and processing pipeline:

```typescript
// Supported Document Types
export type DocumentType = 'image' | 'text-pdf' | 'image-pdf';

// Spatial Word Token Representation
export interface SpatialWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  forceRedact?: boolean;   // User manual override (true = redact, false = keep)
  pageIndex?: number;
  isContextual?: boolean;  // Tagged via proximity to sensitive label
}

// Detected Region Representation (Faces or Manual Redaction Boxes)
export interface DetectedRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: 'face' | 'manual';
  label?: string;
  confidence?: number;
  pageIndex?: number;
}

// Multi-Page Document Item Representation
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
```

---

## 5. Problem Log & Architectural Decision History

Throughout development, several critical challenges were addressed with intentional architectural decisions:

| No | Technical Challenge | Vulnerability / Impact | Design Decision & Final Solution |
| :--- | :--- | :--- | :--- |
| **1** | **PDF Vector Overlay Leak** | Drawing black rectangular annotations in standard PDF editors leaves underlying text vectors intact. Attackers can copy text with Ctrl+C or extract it via `pdftotext`. | Implemented **Destructive Rasterization**. The entire document is converted into flat canvas images, physical pixels are overwritten via `ctx.fillRect`, and exported as pure image-based Flat PDFs. |
| **2** | **Marker Transparency (Alpha Channel Leak)** | Digital brushes in native mobile markups often have fractional opacity. Adjusting brightness and contrast reveals obscured text. | Redactions use **Hard Pixel Replacement** (alpha = 1.0, solid RGB). Previous pixel byte values are wiped from memory before file compilation. |
| **3** | **OCR Performance Bottlenecks on Clean PDFs** | Native digital PDFs with embedded text matrices were needlessly subjected to heavy OCR processing (10–30s per page). | Designed a **Dual Ingestion Router**. The system detects native text layers and offers instant geometric extraction via `pdfjs-dist` (<1s per page). |
| **4** | **OCR Glyph Misrecognition on Identity Cards** | Characters like `0`/`O`, `1`/`l`/`I`, and `5`/`S` frequently cause 16-digit ID pattern matching to fail. | Introduced `fuzzyNormalizeDigits()` combined with **Contextual Label Proximity** scanning. |
| **5** | **Bounding Box Misalignment on Rotation** | Rotating documents 90° or 180° caused bounding box coordinates to drift from their visual targets. | Implemented linear coordinate transformation formulas mapped synchronously to all `SpatialWord` and `DetectedRegion` objects upon rotation. |
| **6** | **Memory Bloat on Large Documents** | Concurrently loading dozens of high-res image files or large PDFs risked browser memory exhaustion. | Structured **Sequential Processing Pipelines** with progress indicators, explicit URL revoking (`URL.revokeObjectURL`), and canvas buffer deallocation. |
| **7** | **False Positives & Variable Redaction Needs** | Automated detection cannot anticipate all specialized signatures, seal stamps, or atypical names. | Equipped users with **Click-to-Toggle** on every token, **Live Custom Keyword Search**, and **Manual Block Redaction**. |

---

## 6. Security Principles & Privacy Guarantee (Zero-Leak Guarantee)

<p align="center">
  <img src="public/zero_leak_guarantee.svg" alt="Cherdocky Zero-Leak Guarantee" width="100%" />
</p>
