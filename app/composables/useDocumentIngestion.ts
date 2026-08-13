import { ref } from 'vue';
import { processDocument, type SpatialWord } from '~/utils/ocrEngine';

export const useDocumentIngestion = () => {
  const file = ref<File | null>(null);
  const fileUrl = ref<string | null>(null);
  const isProcessing = ref(false);
  const progress = ref(0);
  const result = ref<SpatialWord[]>([]);

  const handleFileUpload = async (uploadedFile: File) => {
    file.value = uploadedFile;
    fileUrl.value = URL.createObjectURL(uploadedFile);
    isProcessing.value = true;
    progress.value = 0;
    result.value = [];

    try {
      const spatialData = await processDocument(uploadedFile, (p) => {
        progress.value = p;
      });
      result.value = spatialData;
      console.log('OCR Spatial Data:', spatialData);
    } catch (error) {
      console.error('OCR Error:', error);
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
    handleFileUpload
  };
};
