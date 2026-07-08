# Meshtastic Log Mapper (Meshlog)

Meshtastic Log Mapper is a topology and network graph analyzer designed for Meshtastic mesh networks. It parses network log data to visualize node connectivity, signal strength, traffic volume, and device telemetry. The application is designed to operate entirely offline as a Progressive Web App.

## Features

* Geographic Visualization: Plots nodes with GPS coordinates on an interactive map.
* Logical Network Graph: Renders a force-directed graph to visualize network topology, link quality, and signal-to-noise ratio.
* Unmapped Node Tracking: Identifies and tracks active nodes that lack GPS data but are participating in the network.
* Packet Inspection: Includes a terminal view for monitoring network traffic and inspecting packet payloads.
* Telemetry Analysis: Displays hardware models, battery levels, and channel utilization metrics for individual nodes.
* Offline Functionality: Can be installed locally to function without an internet connection.

## Usage

Access the application at https://meshlog.camal.eu. Provide a valid network log file via the upload interface to begin parsing. Navigate between the geographic map, the logical network graph, and the unmapped node list using the provided interface controls. The built-in terminal allows for monitoring of packet logs based on the uploaded data.

## Licensing

This project is licensed under the PolyForm Noncommercial License 1.0.0. 

You are permitted to view, fork, and modify the software for personal, academic, or hobbyist purposes. Commercial use of this software, its derivatives, or its output is strictly prohibited. For complete legal terms, refer to the LICENSE file included in the repository.

## Copyright

Copyright (c) 2026 CardoSystems. All rights reserved.
