import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import fs from 'fs'

// Vite plugin to serve .wasm files with correct MIME type from public directory
function wasmServePlugin() {
  const publicDir = path.resolve(__dirname, 'public')
  const wasmCache = new Map<string, Buffer>()

  return {
    name: 'wasm-serve',
    buildStart() {
      // Pre-load all WASM files at build start
      const wasmFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.wasm'))
      for (const file of wasmFiles) {
        const filePath = path.join(publicDir, file)
        wasmCache.set(file, fs.readFileSync(filePath))
      }
      console.log(`[wasm-serve] Loaded ${wasmCache.size} WASM files: ${Array.from(wasmCache.keys()).join(', ')}`)
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        // Match any .wasm file request
        const match = url.match(/\/([^/]+\.wasm)(?:\?|$)/)
        if (match && wasmCache.has(match[1])) {
          const wasmBuffer = wasmCache.get(match[1])!
          res.setHeader('Content-Type', 'application/wasm')
          res.setHeader('Cache-Control', 'public, max-age=31536000')
          res.end(wasmBuffer)
          return
        }
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), wasmServePlugin()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src')
    }
  },
  // Set base path for GitHub Pages (https://<username>.github.io/Cherdocky/)
  base: process.env.NODE_ENV === 'production' ? '/Cherdocky/' : '/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})