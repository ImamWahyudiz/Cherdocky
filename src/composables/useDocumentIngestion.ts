import { ref } from 'vue';
import { processDocument, type SpatialWord } from '~/utils/ocrEngine';
import { extractPdfText, isPdfTextBased, rasterizePdfPage } from '~/utils/pdfExtractor';
import { detectFaces, type DetectedRegion } from '~/utils/faceDetector';

export type DocumentType = 'image' | 'text-pdf' | 'image-pdf';

/**
 * Render scale used when rasterizing PDF pages for OCR and face detection.
 * Must stay in sync with PDF_RENDER_SCALE in redactor.ts.
 */
const RASTER_SCALE = 2;

export const useDocumentIngestion = () => {
  const file = ref<File | null>(null);
  const fileUrl = ref<string | null>(null);
  const isProcessing = ref(false);
  const progress = ref(0);
  const result = ref<SpatialWord[]>([]);
  const isVerified = ref(false);
  const documentType = ref<DocumentType>('image');
  const detectedRegions = ref<DetectedRegion[]>([]);

  const handleFileUpload = async (uploadedFile: File) => {
    file.value = uploadedFile;
    fileUrl.value = URL.createObjectURL(uploadedFile);
    isProcessing.value = true;
    progress.value = 0;
    result.value = [];
    isVerified.value = false;
    detectedRegions.value = [];

    try {
      let spatialData: SpatialWord[] = [];

      // Track the image source for face detection and its coordinate divisor.
      // Face detection always runs on a rasterized image whose pixel coords
      // may differ from the word coordinate space. The divisor normalizes
      // detected face coords to match word coords.
      let faceSource: Blob | File = uploadedFile;
      let faceCoordDivisor = 1;

      if (uploadedFile.type === 'application/pdf') {
        // Detect if the PDF is text-based or image-based (scanned)
        const isTextBased = await isPdfTextBased(uploadedFile);

        if (isTextBased) {
          documentType.value = 'text-pdf';
          spatialData = await extractPdfText(uploadedFile, (p) => {
            progress.value = p;
          });

          // Rasterize for face detection — word coords are at scale=1
          // (native PDF units), but the raster will be at RASTER_SCALE.
          // Divide detected coords by RASTER_SCALE to align.
          const rasterBlob = await rasterizePdfPage(uploadedFile, 1, RASTER_SCALE);
          faceSource = rasterBlob;
          faceCoordDivisor = RASTER_SCALE;
        } else {
          // Image-based PDF: rasterize to image, then OCR
          documentType.value = 'image-pdf';
          const imageBlob = await rasterizePdfPage(uploadedFile, 1, RASTER_SCALE);
          
          // Replace fileUrl with the rasterized image so the preview shows the rendered page
          if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
          fileUrl.value = URL.createObjectURL(imageBlob);

          spatialData = await processDocument(imageBlob, (p) => {
            progress.value = p;
          });

          // Word coords and raster are both at RASTER_SCALE — no divisor needed
          faceSource = imageBlob;
          faceCoordDivisor = 1;
        }
      } else {
        documentType.value = 'image';
        spatialData = await processDocument(uploadedFile, (p) => {
          progress.value = p;
        });

        // Both words and face detection operate on the native image — no scaling
        faceSource = uploadedFile;
        faceCoordDivisor = 1;
      }

      result.value = spatialData;
      console.log('OCR Spatial Data:', spatialData);

      if (spatialData.length === 0) {
        console.warn('No text could be extracted from this document.');
      } else {
        console.log(`Extracted ${spatialData.length} words.`);
      }

      // --- Face detection (runs after OCR to avoid competing for GPU/WASM) ---
      const rawFaces = await detectFaces(faceSource);
      if (rawFaces.length > 0) {
        // Normalize detected face coordinates to match word coordinate space
        detectedRegions.value = rawFaces.map((f) => ({
          x: f.x / faceCoordDivisor,
          y: f.y / faceCoordDivisor,
          w: f.w / faceCoordDivisor,
          h: f.h / faceCoordDivisor,
        }));
        console.log(`Detected ${rawFaces.length} face(s).`);
      }
    } catch (error: any) {
      console.error('OCR Error:', error);
      alert(error.message || 'An error occurred during text extraction.');
    } finally {
      isProcessing.value = false;
    }
  };

  return {
    file,
    fileUrl,
    isProcessing,
    progress,
    result,
    isVerified,
    documentType,
    detectedRegions,
    handleFileUpload
  };
};
