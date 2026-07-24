/*
Required Notice: Copyright (c) 2026 CardoSystems
*/
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  define: {
    __BUILD_TIMESTAMP__: Date.now(),
    'process.env': {},
    'process.env.NODE_ENV': '"production"'
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    cssCodeSplit: true,
    minify: 'esbuild'
  },
  esbuild: {
    pure: ['console.log', 'console.info', 'console.debug']
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Meshtastic Log Mapper',
        short_name: 'Mesh Mapper',
        description: 'Offline-capable topology and network graph analyzer for Meshtastic.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        display_override: ['window-controls-overlay'],
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png'
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ],
        file_handlers: [
          {
            action: '/',
            accept: {
              'text/plain': ['.txt']
            }
          }
        ],
        share_target: {
          action: '/',
          method: 'GET',
          params: {
            title: 'title',
            text: 'text',
            url: 'url'
          }
        },
        shortcuts: [
          {
            name: 'Load Demo Map',
            short_name: 'Demo',
            description: 'Load the default demo map',
            url: '/?map=30aexpfu',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }]
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,txt,wasm}'],
        runtimeCaching: [
          {
            urlPattern: /^\/api\/data/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              broadcastUpdate: {
                channelName: 'api-updates',
                options: {}
              },
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 7
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/(?:[a-z]\.basemaps\.cartocdn\.com|server\.arcgisonline\.com|[a-z]\.tile\.openstreetmap\.org|[a-z]\.tile\.opentopomap\.org)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'leaflet-tiles-cache',
              expiration: {
                maxEntries: 4000,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ]
});
