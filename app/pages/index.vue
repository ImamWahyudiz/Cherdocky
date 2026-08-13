<script setup lang="ts">
import { ref } from 'vue'
import { useDropZone } from '@vueuse/core'

const { file, fileUrl, isProcessing, progress, result, handleFileUpload } = useDocumentIngestion()

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
  <UContainer class="py-12 flex flex-col min-h-screen">
    <div class="text-center mb-8 pt-10">
      <h1 class="text-4xl font-bold mb-4">Document Ingestion</h1>
      <p class="text-gray-500">Phase 1: Upload a document for 100% offline client-side spatial OCR.</p>
    </div>

    <!-- Dropzone -->
    <div
      ref="dropZoneRef"
      class="border-2 border-dashed rounded-xl p-12 text-center transition-colors flex flex-col items-center justify-center cursor-pointer mb-8 relative max-w-2xl mx-auto w-full"
      :class="isOverDropZone ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/20' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'"
      @click="fileInput?.click()"
    >
      <input 
        ref="fileInput"
        type="file" 
        accept="image/jpeg, image/png, application/pdf" 
        class="hidden" 
        @change="onFileSelect"
      />
      
      <UIcon name="i-lucide-upload-cloud" class="w-16 h-16 mb-4 text-gray-400" />
      <h3 class="text-xl font-medium mb-2">Drag & Drop your document here</h3>
      <p class="text-sm text-gray-500 mb-4">Supports JPEG, PNG, and PDF</p>
      
      <UButton color="primary" variant="subtle" size="md">
        Browse Files
      </UButton>
    </div>

    <!-- Processing State -->
    <UCard v-if="isProcessing || result.length > 0" class="w-full max-w-2xl mx-auto shadow-sm">
      <div v-if="isProcessing" class="space-y-4">
        <div class="flex items-center justify-between">
          <span class="font-medium text-sm flex items-center gap-2">
            <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
            Processing Document (Offline OCR Engine)
          </span>
          <span class="text-sm text-gray-500 font-mono">{{ Math.round(progress * 100) }}%</span>
        </div>
        <UProgress :value="progress * 100" color="primary" />
      </div>

      <div v-else-if="result.length > 0" class="space-y-4">
        <div class="flex items-center justify-between text-green-500 mb-4">
          <span class="font-medium flex items-center gap-2">
            <UIcon name="i-lucide-check-circle-2" class="w-5 h-5" />
            Processing Complete!
          </span>
          <UBadge color="success" variant="subtle">{{ result.length }} words extracted</UBadge>
        </div>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto font-mono text-xs shadow-inner">
          <pre class="text-gray-700 dark:text-gray-300">{{ JSON.stringify(result.slice(0, 5), null, 2) }}</pre>
          <div class="text-center mt-2 text-gray-500 border-t border-gray-200 dark:border-gray-800 pt-2 pb-1" v-if="result.length > 5">
            ... {{ result.length - 5 }} more items (Check browser console for full JSON array)
          </div>
        </div>
      </div>
    </UCard>
  </UContainer>
</template>
