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
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml'
          }
        ]
      },
      workbox: {
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
            urlPattern: /^https:\/\/unpkg\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'unpkg-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdn\.plot\.ly\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'plotly-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/d3js\.org\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'd3-cache',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'jsdelivr-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/(?:code\.jquery\.com|ajax\.googleapis\.com)\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'jquery-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
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
                statuses: [200]
              }
            }
          }
        ]
      }
    })
  ]
});
