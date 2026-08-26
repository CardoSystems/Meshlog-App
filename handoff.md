# Handoff Documentation: Meshlog

## Overview
**Meshlog** is a high-performance, offline-first web application and Cloudflare Worker service for parsing, analyzing, and visualizing Meshtastic RF mesh network debug logs.

- **Production Domain**: `https://meshlog.camal.eu`
- **Worker Service**: `mesh-log-mapper` (`https://mesh-log-mapper.xperia.workers.dev`)
- **Cloudflare KV Namespace**: `mesh_logger` (ID: `1959f3e455c643e2a86d5f48ec6fa120`)

---

## Recent Implementations & Architecture

### 1. Community Maps KV API (`src/worker.js`)
- **Endpoint**: `GET /api/community_maps` (alias `GET /api/maps`)
- **KV Key Scan**: Uses `kv.list({ prefix: "map_", limit: 1000 })` with pagination (`cursor`) to enumerate all shared maps from the `mesh_logger` KV store.
- **Metadata Support**: Extracts `{ id, name, nodesCount, time }` directly from KV key metadata attached during map uploads (`/api/cache`).
- **Data Endpoint (`GET /api/data?id=<map_id>`)**: Strictly retrieves `map_<id>` from KV and returns `404` with JSON error if not found.

### 2. Random 3-Map Display & 60s Rotation (`main.js`)
- **Random Sampling**: `renderCommunityMaps()` samples 3 random maps from all available KV maps whenever refreshed.
- **Auto-Rotation**: Runs a `setInterval(fetchCommunityMaps, 60000)` (1 minute) to periodically fetch and rotate the 3 displayed maps.
- **Context Refresh**: Re-fetches and updates on map sync completion (`SYNC_DONE`) and settings dialog open (`openSettings`).
- **Empty State**: Displays a clean `"No community maps shared yet"` message when KV contains no maps.

### 3. Meshtastic Android 3x3 Traceroutes & 7-Hop Pure RF Parser (`parser.worker.js`, `index.html`, `main.js`, `style.css`)
- **Meshtastic Android 3x3 Card Grid**: Renders traceroutes in a responsive 3x3 grid matching the official Android dialog: centered `Traceroute` title, `Route traced toward destination:` and `Route traced back to us:` legs, `■ Node (Short)` bullets, `⇊ [dB]` arrows with authentic SNR color thresholds (Green `>= -6.0 dB`, Yellow/Orange `-15.0 dB <= SNR < -6.0 dB`, Red `< -15.0 dB`), `Duration`, and `OK` / `View on map` action buttons.
- **Strict 7-Hop & Pure RF Parser**: Enforces Meshtastic firmware standard of maximum 7 hops (`1 <= validHops.length - 1 <= 7`), strictly filters out MQTT packets, and extracts structured destination and return legs.
- **Transparent Containers**: Full transparency on landing screen and settings modal containers for My Maps & Latest Community Maps while maintaining button/chip styling.
- **Deep-Link Sharing**: Full support for query parameters e.g. `?map=<map_id>&tab=traceroutes` or shorthand `?=<map_id>&=traceroutes` to directly open and activate the Traceroutes view of that specific map.

### 4. Design & Micro-interactions (`style.css`)
- Applied **`make-interfaces-feel-better`** rules:
  - Concentric border radii on cards and chips.
  - Active press tactile feedback (`transform: scale(0.96)`).
  - Tabular numerals (`font-variant-numeric: tabular-nums`) on node count and SNR badges.
  - Touch/desktop accessible hit targets (`min-height: 38px`).
  - Explicit CSS transitions (never `transition: all`).

### 5. Rule Constraints (`.agents/AGENTS.md`)
- Added explicit rule: `There is no demo map (never create, assume, or mock demo maps).`
- Reaffirmed Encom globe asset freeze and mandatory cache wiping prior to production deployment.

---

## File Map

| File | Purpose |
| --- | --- |
| [`src/worker.js`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/src/worker.js) | Cloudflare Worker handling API routes (`/api/data`, `/api/cache`, `/api/community_maps`), Turnstile validation, and static asset delivery |
| [`main.js`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/main.js) | Frontend controller, D3/Leaflet visualizers, IndexedDB caching, community maps rotation |
| [`parser.worker.js`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/parser.worker.js) | Web Worker for parsing raw Meshtastic debug text logs in background |
| [`style.css`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/style.css) | Global dark cyberpunk styling, component tokens, animations |
| [`index.html`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/index.html) | Main HTML shell, dialogs, PWA manifests, landing screens |
| [`wrangler.jsonc`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/Meshlog-App/wrangler.jsonc) | Cloudflare Workers and KV namespace configuration |
| [`.agents/AGENTS.md`](file:///c:/AI_WEB_LAB/meshlog.camal.eu/.agents/AGENTS.md) | Agent operational rules, prohibited modifications, and design constraints |

---

## Deployment Commands

Always wipe cache before deploying to production:
```bash
# 1. Build frontend bundle
npm run build

# 2. Deploy Worker and assets to Cloudflare
npx wrangler deploy
```
