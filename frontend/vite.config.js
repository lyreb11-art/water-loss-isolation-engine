import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // MapLibre ships an ES-module worker that Vite's pre-bundler breaks.
    // Excluding it tells Vite to leave maplibre-gl and its worker untouched.
    exclude: ['maplibre-gl'],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})