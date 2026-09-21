import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'
import { vectorAiLauncher } from './scripts/vectorAiLauncher.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vectorAiLauncher(),
    react(),
    // @ts-ignore
    cesium(),
    tailwindcss()
  ],
  // The app has one HTML entry; avoid crawling the offline tile archive for entries.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    port: 3000,
    open: false,
    // Tiles remain available as static files but do not need HMR file watchers.
    watch: {
      ignored: ['**/public/offline-*/**'],
    },
    // Proxy tới backend VECTOR AI local (FastAPI, loopback-only 127.0.0.1:8000).
    // Backend chỉ cho CORS origin http://127.0.0.1:3000 và http://localhost:1420, nên client
    // gọi qua đường dẫn tương đối /vector-ai để cùng origin với dev server, tránh CORS hoàn toàn.
    proxy: {
      '/vector-ai': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vector-ai/, ''),
      },
    },
  },
})
