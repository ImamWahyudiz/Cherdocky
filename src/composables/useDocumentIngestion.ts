import { ref } from 'vue';
import { processDocument, type SpatialWord } from '~/utils/ocrEngine';
import { extractPdfText, isPdfTextBased, rasterizePdfPage } from '~/utils/pdfExtractor';
import type { DetectedRegion } from '~/utils/faceDetector';

export type DocumentType = 'image' | 'text-pdf' | 'image-pdf';

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

      if (uploadedFile.type === 'application/pdf') {
        const isTextBased = await isPdfTextBased(uploadedFile);

        if (isTextBased) {
          documentType.value = 'text-pdf';
          spatialData = await extractPdfText(uploadedFile, (p) => {
            progress.value = p;
          });

          // Rasterize page 1 at scale 1 for preview image
          const rasterBlob = await rasterizePdfPage(uploadedFile, 1, 1);
          
          if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
          fileUrl.value = URL.createObjectURL(rasterBlob);
        } else {
          // Image-based PDF: rasterize to image, then OCR
          documentType.value = 'image-pdf';
          const imageBlob = await rasterizePdfPage(uploadedFile, 1, RASTER_SCALE);
          
          if (fileUrl.value) URL.revokeObjectURL(fileUrl.value);
          fileUrl.value = URL.createObjectURL(imageBlob);

          spatialData = await processDocument(imageBlob, (p) => {
            progress.value = p;
          });
        }
      } else {
        documentType.value = 'image';
        spatialData = await processDocument(uploadedFile, (p) => {
          progress.value = p;
        });
      }

      result.value = spatialData;
      console.log('OCR Spatial Data:', spatialData);

      if (spatialData.length === 0) {
        console.warn('No text could be extracted from this document.');
      } else {
        console.log(`Extracted ${spatialData.length} words.`);
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
