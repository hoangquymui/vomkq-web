import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import tailwindcss from '@tailwindcss/vite'
import { vectorAiLauncher } from './scripts/vectorAiLauncher.ts'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Plugin chặn request các tile bản đồ/địa hình offline không tồn tại trong thư mục public.
 * Tránh trường hợp SPA fallback của Vite trả về index.html (HTTP 200), khiến trình giải mã
 * Quantized-Mesh của CesiumTerrainProvider và UrlTemplateImageryProvider bị lỗi RangeError
 * hoặc không decode được ảnh.
 */
function offlineTile404Plugin(): Plugin {
  const publicRoot = path.join(__dirname, 'public')
  return {
    name: 'offline-tile-404',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url?.split('?')[0] || ''
        if (
          rawUrl.startsWith('/offline-') ||
          rawUrl.endsWith('.terrain') ||
          rawUrl.includes('/offline-terrain/') ||
          rawUrl.includes('/offline-terrain-map/') ||
          rawUrl.includes('/offline-satellite/')
        ) {
          try {
            const decodedPath = decodeURIComponent(rawUrl)
            const publicFilePath = path.resolve(publicRoot, '.' + decodedPath)
            if (
              !publicFilePath.startsWith(publicRoot + path.sep) ||
              !fs.existsSync(publicFilePath) ||
              fs.statSync(publicFilePath).isDirectory()
            ) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end('404 Not Found')
              return
            }
          } catch {
            res.statusCode = 404
            res.setHeader('Content-Type', 'text/plain; charset=utf-8')
            res.end('404 Not Found')
            return
          }
        }
        next()
      })
    },
  }
}

/**
 * Thay cho cơ chế copy public/ mặc định của Vite: bỏ qua các thư mục tile offline (hàng trăm nghìn file)
 * để build nhanh. Đặt COPY_OFFLINE_TILES=1 nếu muốn đóng gói kèm tile vào dist.
 */
function copyPublicWithoutTilesPlugin(): Plugin {
  let outDir = 'dist'
  return {
    name: 'copy-public-without-tiles',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const publicRoot = path.join(__dirname, 'public')
      const includeTiles = process.env.COPY_OFFLINE_TILES === '1'
      fs.cpSync(publicRoot, outDir, {
        recursive: true,
        filter: (src) => {
          if (includeTiles) return true
          const top = path.relative(publicRoot, src).split(path.sep)[0]
          return !(top.startsWith('offline-') && !top.endsWith('.json'))
        },
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    offlineTile404Plugin(),
    { ...vectorAiLauncher(), apply: 'serve' },
    react(),
    // @ts-ignore
    cesium(),
    tailwindcss(),
    copyPublicWithoutTilesPlugin(),
  ],
  build: {
    copyPublicDir: false,
  },
  // The app has one HTML entry; avoid crawling the offline tile archive for entries.
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
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
