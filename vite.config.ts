import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // @ts-ignore
    cesium(),
    tailwindcss()
  ],
  server: {
    port: 3000,
    open: false
  }
})
