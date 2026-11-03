import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const viewerDist = './node_modules/@mlightcad/cad-simple-viewer/dist'
const dwgDist = './node_modules/@mlightcad/libredwg-converter/dist'

export default defineConfig({
  base: './',
  build: {
    modulePreload: false,
    chunkSizeWarningLimit: 6000
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${viewerDist}/mtext-renderer-worker.js`, dest: 'workers', rename: { stripBase: true } },
        { src: `${dwgDist}/libredwg-parser-worker.js`, dest: 'workers', rename: { stripBase: true } },
        { src: `${dwgDist}/libredwg-web.wasm`, dest: 'workers', rename: { stripBase: true } }
      ]
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'DWG Görüntüleyici',
        short_name: 'DWG',
        description: 'Çevrimdışı çalışan DWG/DXF görüntüleyici',
        lang: 'tr',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        background_color: '#111418',
        theme_color: '#111418',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,shx,woff,ttf,json,png,svg,webmanifest,ico}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      }
    })
  ]
})
