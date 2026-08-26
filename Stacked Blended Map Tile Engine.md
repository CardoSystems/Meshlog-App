# Stacked Blended Map Tile Engine: Implementation Guide

A keyless, resilient, dark-mode Leaflet map tile engine that eliminates map tile pop-in, prevents light/dark checkerboarding, and avoids rate limits or API key watermarks.

---

## How It Works

1. **Base Layer (`zIndex: 1`)**: CARTO Voyager raster tiles load instantly via CDN for global coverage.
2. **Overlay Layer (`zIndex: 2`)**: OpenStreetMap France (HOT) tiles load on top with rich building and street vectors.
3. **Hardware CSS Filter**: Both layers receive the exact same static dark filter (`grayscale` + `invert` + `brightness` + `contrast`). When HOT tiles load, they dissolve smoothly over the CARTO base with zero visual jump.
4. **Pane Isolation**: The CSS filter targets *only* the `#map .leaflet-tile-pane`, keeping all node markers, polylines, and popups 100% untouched at native color and vibrancy.

---

## Step-by-Step Implementation

### Step 1: Preconnect CDN Links (`index.html`)

Add preconnect tags inside your `<head>` to eliminate TLS/DNS handshake latency:

```html
<!-- Tile CDN Preconnect Hints -->
<link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin />
<link rel="preconnect" href="https://a.tile.openstreetmap.fr" crossorigin />
```

---

### Step 2: Add CSS Tile Filter (`style.css`)

Add this to your stylesheet. It scopes the filter strictly to the tile container:

```css
/* --- Stacked Blended Basemap Tile Engine --- */

/* Base container background to avoid white flashes */
.leaflet-container {
    background: #111111 !important;
}

/* Dimming veil applied to the tile pane */
#map .leaflet-tile-pane {
    opacity: 0.75;
}

/* Static dark filter applied identically to both tile providers */
#map .leaflet-layer.map-tiles-hot,
#map .leaflet-layer.map-tiles-fallback {
    filter: grayscale(1) invert(1) brightness(0.9) contrast(1.08);
    -webkit-filter: grayscale(1) invert(1) brightness(0.9) contrast(1.08);
}
```

---

### Step 3: Configure Leaflet Layers (`main.js`)

Instantiate both tile layers and bundle them into an `L.layerGroup`:

```javascript
import L from 'leaflet';

// 1. Base Layer: CARTO Voyager (Fast CDN & Fallback)
const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    className: 'map-tiles-fallback',
    crossOrigin: 'anonymous',
    subdomains: 'abcd',
    detectRetina: true,
    zIndex: 1
});

// 2. Overlay Layer: OSM France HOT (Rich Humanitarian OSM Data)
const osmHot = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Tiles by <a href="https://www.hotosm.org/">HOT</a>',
    maxZoom: 19,
    className: 'map-tiles-hot',
    crossOrigin: 'anonymous',
    subdomains: 'abc',
    zIndex: 2
});

// 3. Combine both into a single layer group
const blendedDarkTiles = L.layerGroup([cartoVoyager, osmHot]);

// 4. Initialize Map with the Blended Layer as default
const map = L.map('map', {
    layers: [blendedDarkTiles],
    zoomControl: true
}).setView([39.5, -8.0], 7);

// 5. (Optional) Register in Layer Switcher
const baseMaps = {
    "Dark (OSM Blend)": blendedDarkTiles,
    // Add other layers if needed:
    "OpenStreetMap Standard": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 })
};

L.control.layers(baseMaps).addTo(map);
```

---

### Step 4 (Optional): Offline & PWA Caching (`vite.config.js`)

If using `vite-plugin-pwa` (or Workbox), configure `CacheFirst` runtime caching:

```javascript
runtimeCaching: [
  {
    urlPattern: /^https:\/\/(?:[a-z]\.basemaps\.cartocdn\.com|[a-z]\.tile\.openstreetmap\.fr|[a-z]\.tile\.openstreetmap\.org)\/.*/i,
    handler: 'CacheFirst',
    options: {
      cacheName: 'leaflet-tiles-cache',
      expiration: {
        maxEntries: 4000,
        maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
      },
      cacheableResponse: {
        statuses: [0, 200]
      }
    }
  }
]
```

---

## Standalone Minimal Example (`index.html`)

Copy and paste this into an `index.html` file to test the engine standalone in any browser:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Blended Map Engine Demo</title>
    
    <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin />
    <link rel="preconnect" href="https://a.tile.openstreetmap.fr" crossorigin />
    
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <style>
        html, body, #map {
            margin: 0;
            padding: 0;
            width: 100vw;
            height: 100vh;
            background: #111;
        }

        #map .leaflet-tile-pane {
            opacity: 0.75;
        }

        #map .leaflet-layer.map-tiles-hot,
        #map .leaflet-layer.map-tiles-fallback {
            filter: grayscale(1) invert(1) brightness(0.9) contrast(1.08);
            -webkit-filter: grayscale(1) invert(1) brightness(0.9) contrast(1.08);
        }
    </style>
</head>
<body>
    <div id="map"></div>

    <script>
        const cartoVoyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO, &copy; OpenStreetMap',
            maxZoom: 19,
            className: 'map-tiles-fallback',
            crossOrigin: 'anonymous',
            subdomains: 'abcd',
            detectRetina: true,
            zIndex: 1
        });

        const osmHot = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap, Tiles by HOT',
            maxZoom: 19,
            className: 'map-tiles-hot',
            crossOrigin: 'anonymous',
            subdomains: 'abc',
            zIndex: 2
        });

        const blendedTiles = L.layerGroup([cartoVoyager, osmHot]);
        const map = L.map('map', { layers: [blendedTiles] }).setView([39.5, -8.0], 7);

        // Example marker (remains in full vivid color above the dark map)
        L.circleMarker([39.5, -8.0], {
            radius: 12,
            color: '#00e5ff',
            fillColor: '#00bcd4',
            fillOpacity: 0.8
        }).addTo(map).bindPopup('<b>Mesh Node</b><br>Full color preserved!');
    </script>
</body>
</html>
```
