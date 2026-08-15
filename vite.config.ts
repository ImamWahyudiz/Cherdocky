import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src')
    }
  },
  // Set base path for GitHub Pages (https://<username>.github.io/Cherdocky/)
  base: process.env.NODE_ENV === 'production' ? '/Cherdocky/' : '/'
})
