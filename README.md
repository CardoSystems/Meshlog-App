<div align="center">
  <img src="public/icon.svg" width="100" height="100" alt="Meshlog Icon">
  <h1>Meshtastic Log Mapper (Meshlog)</h1>
  <p><b>Advanced Topology & Network Graph Analyzer for Meshtastic Networks</b></p>
</div>

---

<div align="center">
  <img src="Screenshot 2026-09-13 045301.png" alt="home" width="1080">
</div>

---

**Meshtastic Log Mapper** parses raw network log data to visualize node connectivity, signal strength, traffic volume, and device telemetry. Built with offline-first capabilities, it operates entirely as a Progressive Web App (PWA) even when you are off-grid.

## Features

- **Geographic Visualization**: Plots nodes with GPS coordinates on an interactive Leaflet map featuring a keyless blended dark basemap (CARTO Voyager + OSM France HOT) and offline tile caching.
- **Traceroutes Analysis**: Dedicated view rendering pure RF traceroute packets with forward and return hop paths, per-hop Signal-to-Noise Ratio (SNR) ratings, hop durations, and clickable node links.
- **Pure RF Longest Links**: Dedicated analyzer identifying and ranking direct radio links by verified distance and link metrics, strictly isolating physical RF hops from MQTT packets.
- **Logical Network Graph**: Renders a force-directed physics graph to visualize network topology, link clustering, and connection quality.
- **Unmapped Node Tracking**: Identifies and tracks active mesh nodes that lack GPS coordinates but participate in radio traffic.
- **Packet Inspection & Terminal**: Integrated terminal view for inspecting raw packet payloads, monitoring traffic logs, and filtering by Node ID.
- **Telemetry & Hardware Metrics**: Displays device models, battery percentages, and channel utilization metrics across nodes.
- **Offline & Local Storage**: Stores parsed sessions in local IndexedDB for fast retrieval, manages saved map history with deletion undo, and operates offline as a PWA.

## Usage

1. **Access the Application**: Visit [https://meshlog.camal.eu](https://meshlog.camal.eu) or install as a PWA for offline use.
2. **Upload Logs**: Provide a Meshtastic network log file (`.txt`) via the upload interface or drag-and-drop.
3. **Explore Views**:
   - **Geo Map**: Inspect geographic node placement, role markers, and RF hop connections.
   - **Logical Network**: Examine force-directed cluster topology and neighbor graphs.
   - **Longest Links**: Review verified direct RF line-of-sight distance rankings.
   - **Traceroutes**: Inspect packet route paths, hop SNR values, and return links.
4. **Inspect Packets**: Use the live terminal bar to search node IDs and inspect raw payloads.

## Licensing

This project is licensed under the **PolyForm Noncommercial License 1.0.0**. 

You are permitted to view, fork, and modify the software for personal, academic, or hobbyist purposes. **Commercial use** of this software, its derivatives, or its output is strictly prohibited. For complete legal terms, refer to the `LICENSE` file included in the repository.

### Map Engine Component (Apache-2.0)

> **Notice**: The Stacked Blended Map Tile Engine is derived from [PotatoMesh](https://github.com/l5yth/potato-mesh) and is distributed under the **Apache License, Version 2.0** (Copyright (c) 2025-2026 l5yth & contributors). It is exempt from PolyForm Noncommercial restrictions. See [`NOTICE`](NOTICE) and [`LICENSE-APACHE2.0`](LICENSE-APACHE2.0) for complete attribution and license details.

## Third-Party Credits

- **PotatoMesh Map Engine**: The stacked blended dual-layer basemap architecture and CSS filter pipeline are derived from [PotatoMesh](https://github.com/l5yth/potato-mesh) by l5yth & contributors, licensed under Apache-2.0. See [`NOTICE`](NOTICE) for full copyright notices.

## Copyright

Copyright (c) 2026 CardoSystems. All rights reserved.

