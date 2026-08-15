<script setup lang="ts">
import { ref } from 'vue'
import { useDropZone } from '@vueuse/core'
import { redactImage, redactPdf } from '~/utils/redactor'
import type { PIIType } from '~/utils/piiDetector'
import DocumentVerification from '~/components/DocumentVerification.vue'
import type { SpatialWord } from '~/utils/ocrEngine'
import type { DetectedRegion } from '~/utils/faceDetector'
import { useDocumentIngestion } from '~/composables/useDocumentIngestion'
import { UploadCloud, Loader2, CheckCircle2, Download } from 'lucide-vue-next'

const { file, fileUrl, isProcessing, progress, result, isVerified, documentType, detectedRegions, handleFileUpload } = useDocumentIngestion()

const isRedacting = ref(false)
const activePiiTypes = ref<PIIType[]>([])
const customPiiText = ref('')
const redactionRegions = ref<DetectedRegion[]>([])

const handleVerificationConfirm = (data: { words: SpatialWord[], piiTypes: PIIType[], customText: string, regions: DetectedRegion[] }) => {
  result.value = data.words
  activePiiTypes.value = data.piiTypes
  customPiiText.value = data.customText
  redactionRegions.value = data.regions
  isVerified.value = true
}

const handleVerificationCancel = () => {
  result.value = []
  file.value = null
  fileUrl.value = null
  isVerified.value = false
  redactionRegions.value = []
}

const handleRedactAndDownload = async () => {
  if (!file.value || (result.value.length === 0 && redactionRegions.value.length === 0)) return
  
  isRedacting.value = true
  try {
    let redactedBlob: Blob
    if (file.value.type === 'application/pdf') {
      redactedBlob = await redactPdf(file.value, result.value, activePiiTypes.value, documentType.value, customPiiText.value, redactionRegions.value)
    } else {
      redactedBlob = await redactImage(file.value, result.value, activePiiTypes.value, customPiiText.value, redactionRegions.value)
    }

    const url = URL.createObjectURL(redactedBlob)
    const a = document.createElement('a')
    a.href = url
    a.download = `redacted_${file.value.name}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Redaction failed:', error)
    alert('Failed to redact document. Check console for details.')
  } finally {
    isRedacting.value = false
  }
}


const dropZoneRef = ref<HTMLDivElement>()
const fileInput = ref<HTMLInputElement>()

const onDrop = (files: File[] | null) => {
  if (files && files.length > 0) {
    const droppedFile = files[0]
    if (droppedFile && (droppedFile.type.startsWith('image/') || droppedFile.type === 'application/pdf')) {
      handleFileUpload(droppedFile)
    } else {
      alert('Please upload an image or PDF file.')
    }
  }
}

const { isOverDropZone } = useDropZone(dropZoneRef, {
  onDrop
})

const onFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    const file = target.files[0]
    if (file) handleFileUpload(file)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-12 flex flex-col min-h-screen relative">
    <!-- Document Verification Modal -->
    <DocumentVerification
      v-if="(result.length > 0 || detectedRegions.length > 0) && !isVerified && fileUrl"
      :image-url="fileUrl"
      :words="result"
      :document-type="documentType"
      :detected-regions="detectedRegions"
      @confirm="handleVerificationConfirm"
      @cancel="handleVerificationCancel"
    />

    <div class="text-center mb-8 pt-10">
      <h1 class="text-4xl font-bold mb-4 text-gray-900 dark:text-white">Document Ingestion & Redaction</h1>
      <p class="text-gray-500 dark:text-gray-400">Upload a document for 100% offline client-side spatial OCR and PII Redaction.</p>
    </div>

    <!-- Dropzone -->
    <div
      ref="dropZoneRef"
      class="border-2 border-dashed rounded-xl p-12 text-center transition-colors flex flex-col items-center justify-center cursor-pointer mb-8 relative max-w-2xl mx-auto w-full"
      :class="isOverDropZone ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'"
      @click="fileInput?.click()"
    >
      <input 
        ref="fileInput"
        type="file" 
        accept="image/jpeg, image/png, application/pdf" 
        class="hidden" 
        @change="onFileSelect"
      />
      
      <UploadCloud class="w-16 h-16 mb-4 text-gray-400 dark:text-gray-300" />
      <h3 class="text-xl font-medium mb-2 text-gray-900 dark:text-white">Drag & Drop your document here</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Supports JPEG, PNG, and PDF</p>
      
      <button class="bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 px-4 py-2 rounded-md font-medium text-sm transition-colors border border-blue-100 dark:border-blue-900/50">
        Browse Files
      </button>
    </div>

    <!-- Processing State -->
    <div v-if="isProcessing || ((result.length > 0 || redactionRegions.length > 0) && isVerified)" class="w-full max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div v-if="isProcessing" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="font-medium text-sm flex items-center gap-2 text-gray-900 dark:text-white">
            <Loader2 class="w-4 h-4 animate-spin text-blue-500 dark:text-blue-400" />
             Securely client side Processing Document 
          </span>
          <span class="text-sm text-gray-500 dark:text-gray-400 font-mono">{{ Math.round(progress * 100) }}%</span>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div class="bg-blue-500 dark:bg-blue-600 h-2 rounded-full transition-all duration-300" :style="{ width: `${progress * 100}%` }"></div>
        </div>
      </div>

      <div v-else-if="(result.length > 0 || redactionRegions.length > 0) && isVerified" class="space-y-4">
        <div class="flex items-center justify-between text-green-600 dark:text-green-400 mb-4">
          <span class="font-medium flex items-center gap-2">
            <CheckCircle2 class="w-5 h-5" />
            Processing Complete!
          </span>
          <button 
            class="flex items-center gap-2 bg-blue-600 dark:bg-blue-700 text-white px-6 py-2 rounded-md font-medium shadow-sm hover:bg-blue-700 dark:hover:bg-blue-800 disabled:opacity-50 transition-colors"
            :disabled="isRedacting"
            @click="handleRedactAndDownload"
          >
            <Loader2 v-if="isRedacting" class="w-5 h-5 animate-spin" />
            <Download v-else class="w-5 h-5" />
            {{ isRedacting ? 'Redacting ...' : 'Redact & Download' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
