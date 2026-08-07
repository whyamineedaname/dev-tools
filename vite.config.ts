import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  base: './',
  server: {
    port: 33445,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  },
  optimizeDeps: {
    exclude: ['@imgly/background-removal', 'foliate-js']
  },
  assetsInclude: ['**/*.wasm']
})
