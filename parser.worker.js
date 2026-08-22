/*
Created on Fri May 29 15:26:44 2026

@author: CardoSystems 'aka' NXDOMAIN
Required Notice: Copyright (c) 2026 CardoSystems 
*/

self.onmessage = async function(e) {
            const origin = e.data.origin;
            
            if (e.data.cmd === 'start') {
                try {
                    const dataUrl = e.data.id ? `/api/data?id=${e.data.id}` : `/api/data`;
                    // ponytail: fast timeout so offline/flaky Android doesn't hang on 'CHECKING CACHE...'
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), e.data.id ? 15000 : 3000);
                    const dataRes = await fetch(origin + dataUrl, { signal: controller.signal });
                    clearTimeout(timer);
                    if (dataRes.ok) {
                        const graph = await dataRes.json();
                        self.postMessage({ type: 'DONE', graphData: graph, shareId: e.data.id });
                        return;
                    } else {
                        self.postMessage({ type: 'NO_CACHE' });
                        return;
                    }
                } catch (err) {
                    self.postMessage({ type: 'NO_CACHE' });
                    return;
                }
            }

            if (e.data.cmd === 'sync') {
                try {
                    const cacheRes = await fetch(origin + '/api/cache', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isDemo: false, graph: e.data.graph, token: e.data.turnstileToken })
                    });
                    if (cacheRes.ok) {
                        const cacheData = await cacheRes.json();
                        self.postMessage({ type: 'SYNC_DONE', shareId: cacheData.id, shortUrl: cacheData.shortUrl });
                    }
                } catch (err) {}
                return;
            }

            if (e.data.cmd === 'parse_file') {
                try {
                    let text = await e.data.file.text();
                    
                    // ponytail: native hash for deduplication
                    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
                    const fileHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);

                    // ponytail: check server first to avoid parsing/uploading dupes
                    try {
                        const existRes = await fetch(`${origin}/api/data?id=${fileHash}`);
                        if (existRes.ok) {
                            const existingGraph = await existRes.json();
                            self.postMessage({ type: 'DONE', graphData: existingGraph, shareId: fileHash, isDuplicate: true, shortUrl: `https://meshlog.camal.eu/?map=${fileHash}` });
                            return;
                        }
                    } catch (e) { /* ignore offline/network errors and proceed to parse */ }
                
                const nodes = new Map(); // id (hex) -> nodeData
      const unmappedNodes = new Set();
      const linkMap = new Map(); // "A-B" -> {source, target, snrs: []}
      const routePaths = []; 
      const packetLog = []; // Terminal time-lapse
      const hopStats = { hop1: 0, hop2: 0, hop3Plus: 0, total: 0 };

      function getDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return Math.round((R * c) * 100) / 100;
      }
      
      const getNode = (id) => {
        if (!nodes.has(id)) {
          nodes.set(id, { id, telemetry: [], traffic_volume: 0 });
        }
        return nodes.get(id);
      };

      const toHexId = (intId) => {
        return "!" + (intId >>> 0).toString(16).padStart(8, '0');
      };

      const processPacket = (packet) => {
        try {
        if (!packet.from) return;
        
        const node = getNode(packet.from);
        node.traffic_volume += 1;
        
        const p = packet.payload || '';
        if (packet.via_mqtt) {
            node.mqtt_packets_count = (node.mqtt_packets_count || 0) + 1;
        } else {
            node.rf_packets_count = (node.rf_packets_count || 0) + 1;
        }

        if (p.includes('is_gateway=true') || p.includes('is_gateway=1')) {
            node.is_gateway = true;
        }
        const gwMatch = p.match(/gateway_id=(![0-9a-fA-F]+)/);
        if (gwMatch) {
            getNode(gwMatch[1]).is_gateway = true;
        }

        if (packet.to && packet.to !== "!-1" && packet.to !== "!ffffffff") {
             getNode(packet.to).traffic_volume += 1;
        }

        if (!packet.portnum) return;
        
        // Push to terminal feed (include non-allowed ports for reality effect)
        let summary = p.replace(/\n/g, ' ');
        
        let pktTime = null;
        const timeMatch = p.match(/time=(\d+)/);
        if (timeMatch) {
            const t = parseInt(timeMatch[1], 10) * 1000;
            if (t > 1500000000000 && t < 2000000000000) pktTime = t; // Sanity check year 2017-2033
        }
        
        const logEntry = { port: packet.portnum, from: packet.from, to: packet.to, sum: summary, time: pktTime };
        packetLog.push(logEntry);
        
        // NOISE FILTERING for parsing
        const allowedPorts = ['POSITION_APP', 'TELEMETRY_APP', 'NODEINFO_APP', 'TRACEROUTE_APP', 'ADMIN_APP'];
        if (!allowedPorts.includes(packet.portnum)) return;

        if (packet.portnum === 'ADMIN_APP' && p.includes('role=')) {
            const roleMatch = p.match(/role=([A-Z_]+)/);
            if (roleMatch) node.role = roleMatch[1];
        }
        else if (packet.portnum === 'NODEINFO_APP' && p.startsWith('User{')) {
            const ln = p.match(/long_name=([^,}]+)/);
            const sn = p.match(/short_name=([^,}]+)/);
            const hw = p.match(/hw_model=([^,}]+)/);
            const idm = p.match(/id=(![0-9a-fA-F]+)/);
            const rm = p.match(/role=([A-Z_]+)/);
            
            if (ln) node.long_name = ln[1];
            if (sn) node.short_name = sn[1];
            if (hw) node.hw_model = hw[1];
            if (idm) node.hexId = idm[1];
            if (rm) node.role = rm[1];
        } 
        else if (packet.portnum === 'POSITION_APP' && p.startsWith('Position{')) {
            const latMatch = p.match(/latitude_i=(-?\d+)/);
            const lonMatch = p.match(/longitude_i=(-?\d+)/);
            const altMatch = p.match(/altitude=(-?\d+)/);
            const pdopMatch = p.match(/PDOP=(\d+)/);
            const satsMatch = p.match(/sats_in_view=(\d+)/);
            
            if (latMatch && lonMatch) {
                node.lat = parseInt(latMatch[1], 10) / 1e7;
                node.lon = parseInt(lonMatch[1], 10) / 1e7;
                if (node.lat === 0 && node.lon === 0) {
                     delete node.lat;
                     delete node.lon;
                }
            }
            if (altMatch) node.altitude = parseInt(altMatch[1], 10);
            if (pdopMatch) node.pdop = parseInt(pdopMatch[1], 10);
            if (satsMatch) node.sats_in_view = parseInt(satsMatch[1], 10);
        }
        else if (packet.portnum === 'TELEMETRY_APP' && p.startsWith('Telemetry{')) {
            let telem = {};
            
            const batMatch = p.match(/battery_level=(\d+)/);
            const volMatch = p.match(/voltage=([\d.]+)/);
            const chMatch = p.match(/channel_utilization=([\d.]+)/);
            const txMatch = p.match(/air_util_tx=([\d.]+)/);
            const tmpMatch = p.match(/temperature=([\d.]+)/);
            const upMatch = p.match(/uptime_seconds=(\d+)/);
            
            if (batMatch) telem.battery_level = parseInt(batMatch[1], 10);
            if (volMatch) telem.voltage = parseFloat(volMatch[1]);
            if (chMatch) telem.channel_utilization = parseFloat(chMatch[1]);
            if (txMatch) telem.air_util_tx = parseFloat(txMatch[1]);
            if (tmpMatch) telem.temperature = parseFloat(tmpMatch[1]);
            if (upMatch) telem.uptime_seconds = parseInt(upMatch[1], 10);
            
            if (Object.keys(telem).length > 0) {
                telem.logRef = logEntry;
                node.telemetry.push(telem);
            }
        }
        else if (packet.portnum === 'TRACEROUTE_APP' && p.includes('Route traced')) {
            const isPacketMqtt = !!packet.via_mqtt;
            // Split into separate route legs (toward destination vs back to us)
            const routeSections = p.split(/Route traced (?:toward destination|back to us):/i);
            
            for (const section of routeSections) {
                if (!section.trim()) continue;
                const hops = [];
                let currentHop = null;
                
                for (const line of section.split('\n')) {
                    const idMatch = line.match(/!([0-9a-f]+)/i);
                    if (idMatch) {
                        if (currentHop) hops.push(currentHop);
                        currentHop = { id: "!" + idMatch[1].toLowerCase(), snr: null };
                    } else if (line.includes('dB') && currentHop) {
                        // Format: "⇊ -14.5 dB" or "⇊ ? dB"
                        if (line.includes('?')) {
                            currentHop.snr = null;
                        } else {
                            const snrMatch = line.match(/([-\d.]+)\s*dB/);
                            if (snrMatch) {
                                currentHop.snr = parseFloat(snrMatch[1]);
                            }
                        }
                    }
                }
                if (currentHop) hops.push(currentHop);
                
                const validHops = hops.filter(h => h.id !== '!ffffffff' && h.id !== '!-1');
                
                if (validHops.length > 1) {
                    if (!isPacketMqtt) {
                        validHops.forEach(h => {
                            const n = getNode(h.id);
                            n.has_rf_link = true;
                        });
                        const numHops = validHops.length - 1;
                        if (numHops === 1) hopStats.hop1++;
                        else if (numHops === 2) hopStats.hop2++;
                        else if (numHops >= 3) hopStats.hop3Plus++;
                        hopStats.total++;
                    }
                    
                    routePaths.push({
                        from: packet.from,
                        hops: validHops,
                        via_mqtt: isPacketMqtt
                    });
                    logEntry.hops = validHops; // Attach hops to terminal feed for animation
                    
                    for (let i = 0; i < validHops.length - 1; i++) {
                        const source = validHops[i].id;
                        const target = validHops[i+1].id;
                        const snr = validHops[i].snr;
                        
                        if (source === target) continue;
                        
                        const key = source < target ? `${source}-${target}` : `${target}-${source}`;
                        if (!linkMap.has(key)) {
                            linkMap.set(key, { 
                                source, 
                                target, 
                                snrs: [], 
                                rf_count: 0, 
                                mqtt_count: 0 
                            });
                        }
                        const link = linkMap.get(key);
                        const isRfHop = !isPacketMqtt && snr !== null && !isNaN(snr);
                        if (isRfHop) {
                            link.snrs.push(snr);
                            link.rf_count++;
                        } else {
                            link.mqtt_count++;
                        }
                    }
                }
            }
        }
        } catch (err) { console.error("Error in processPacket", err); }
      };

      let currentPacket = null;
      let inDecodedPayload = false;
      let decodedPayloadText = "";

      let currentBaseDate = new Date();
      currentBaseDate.setUTCHours(0, 0, 0, 0);
      let lastTimeMs = -1;

      const lines = text.split('\n');
      for (const rawLine of lines) {
        try {
            const line = rawLine.trimEnd();
            
            const singleMatch = line.match(/^\[([0-9:.]+)\]\[([A-Z_]+)\]FROM:\s*(.*?)(User\{|Position\{|Telemetry\{|AdminMessage\{|Data\{|Route traced)(.*)/);
            
            if (line.startsWith('MeshPacket{')) {
                const fromMatch = line.match(/from=(-?\d+)/);
                const toMatch = line.match(/to=(-?\d+)/);
                const mqttMatch = line.match(/via_mqtt=(true|false)/);
                const isMqtt = (mqttMatch && mqttMatch[1] === 'true') || line.includes('TRANSPORT_MQTT') || line.includes('via_mqtt=true');
                currentPacket = {
                    from: fromMatch ? toHexId(parseInt(fromMatch[1], 10)) : null,
                    to: toMatch ? toHexId(parseInt(toMatch[1], 10)) : null,
                    via_mqtt: isMqtt,
                    portnum: null,
                    payload: ""
                };
                inDecodedPayload = false;
            } else if (singleMatch) {
                const timeStr = singleMatch[1];
                const portnum = singleMatch[2];
                const fromStr = singleMatch[3].trim() || "UNKNOWN";
                const payloadType = singleMatch[4];
                let payloadBody = singleMatch[5];
                
                let hexId = fromStr; 
                if (payloadType === 'User{') {
                    const idMatch = payloadBody.match(/id=(![0-9a-fA-F]+)/);
                    if (idMatch) hexId = idMatch[1];
                }
                
                const timeParts = timeStr.split(':');
                const msSinceMidnight = (parseInt(timeParts[0], 10) * 3600 + parseInt(timeParts[1], 10) * 60 + parseFloat(timeParts[2])) * 1000;
                
                if (lastTimeMs !== -1 && msSinceMidnight < lastTimeMs - 12 * 3600 * 1000) {
                    currentBaseDate.setUTCDate(currentBaseDate.getUTCDate() + 1);
                }
                lastTimeMs = msSinceMidnight;
                const rcvTime = currentBaseDate.getTime() + msSinceMidnight;
                
                if (rcvTime) {
                    payloadBody += ` time=${Math.floor(rcvTime/1000)}`;
                }
                
                const isSingleMqtt = line.includes('via_mqtt=true') || line.includes('TRANSPORT_MQTT') || line.includes('[MQTT]');
                processPacket({
                    from: hexId,
                    to: null,
                    via_mqtt: isSingleMqtt,
                    portnum: portnum,
                    payload: payloadType + payloadBody
                });
            } else if (currentPacket && line.includes('Data{portnum=')) {
                const portMatch = line.match(/portnum=([A-Z_]+)/);
                if (portMatch) currentPacket.portnum = portMatch[1];
            } else if (currentPacket && line === 'Decoded Payload:') {
                inDecodedPayload = true;
                decodedPayloadText = "";
            } else if (inDecodedPayload) {
                if (line.trim().startsWith('}')) {
                    currentPacket.payload = decodedPayloadText.trim();
                    processPacket(currentPacket);
                    currentPacket = null;
                    inDecodedPayload = false;
                } else if (line !== '{') {
                    decodedPayloadText += line + "\n";
                }
            }
        } catch (globalErr) { console.error("Critical parse error for line", globalErr); }
      }
      
      for (const [id, node] of nodes.entries()) {
        if (node.lat === undefined || node.lon === undefined) {
          unmappedNodes.add(id);
        }
        const nameStr = ((node.long_name || '') + ' ' + (node.short_name || '')).toUpperCase();
        if (/\bGW\b|\bGATEWAY\b|[-_\[(]GW[-_\])]/i.test(nameStr)) {
            node.is_gateway = true;
        }

        const hasMqtt = (node.mqtt_packets_count || 0) > 0;
        const hasRf = (node.rf_packets_count || 0) > 0 || (node.has_rf_link && !node.via_mqtt);
        if (hasMqtt && hasRf) {
            node.transport_type = 'HYBRID';
            node.via_mqtt = false;
        } else if (hasMqtt) {
            node.transport_type = 'MQTT';
            node.via_mqtt = true;
        } else {
            node.transport_type = 'RF';
            node.via_mqtt = false;
        }
      }

      const d3Edges = Array.from(linkMap.values()).map(link => {
          let avgSnr = null; // null = no SNR data (renders as grey)
          if (link.snrs.length > 0) {
              avgSnr = link.snrs.reduce((a, b) => a + b, 0) / link.snrs.length;
          }
          return { 
              source: link.source, 
              target: link.target, 
              snr: avgSnr,
              is_rf: link.rf_count > 0,
              rf_count: link.rf_count,
              mqtt_count: link.mqtt_count
          };
      });

      const longestLinks = [];
      d3Edges.forEach(edge => {
          const src = nodes.get(edge.source);
          const tgt = nodes.get(edge.target);
          if (src && tgt && src.lat !== undefined && tgt.lat !== undefined) {
              const dist = getDistanceKm(src.lat, src.lon, tgt.lat, tgt.lon);
              edge.distanceKm = dist;
              
              // Pure RF Direct/Traced Link Criteria:
              // 1) Link MUST have verified direct RF traceroute reception (rf_count > 0)
              // 2) Link MUST have valid numeric RF SNR (snr !== null)
              // 3) Neither endpoint can be an MQTT-only node (transport_type !== 'MQTT')
              // 4) Both endpoints must have verified direct RF packet transmissions (rf_packets_count > 0)
              const hasRfPackets = (src.rf_packets_count || 0) > 0 && (tgt.rf_packets_count || 0) > 0;
              const notMqttOnly = src.transport_type !== 'MQTT' && tgt.transport_type !== 'MQTT';
              const isPureRfLink = edge.is_rf && edge.rf_count > 0 && edge.snr !== null && notMqttOnly && hasRfPackets;
              
              if (dist > 0 && isPureRfLink) {
                  longestLinks.push({
                      source: src.id,
                      target: tgt.id,
                      sourceName: src.long_name || src.short_name || src.id,
                      targetName: tgt.long_name || tgt.short_name || tgt.id,
                      distanceKm: dist,
                      snr: edge.snr
                  });
              }
          }
      });
      longestLinks.sort((a, b) => b.distanceKm - a.distanceKm);

      const graph = {
          nodes: Array.from(nodes.values()),
          edges: d3Edges,
          routePaths: routePaths,
          unmapped: Array.from(unmappedNodes),
          packetLog: packetLog,
          longestLinks: longestLinks.slice(0, 100),
          hopStats: hopStats,
          customMapName: e.data.customName
      };

      // --- ATOMIC TIME INTERPOLATION ---
      let lastTime = new Date("2026-06-18T13:27:58").getTime();
      let lastTimeIdx = -1;
      
      for (let i = 0; i < packetLog.length; i++) {
          if (packetLog[i].time) {
              const realTime = packetLog[i].time;
              if (lastTimeIdx !== -1) {
                  const gap = i - lastTimeIdx;
                  const timeDiff = realTime - lastTime;
                  for (let j = 1; j < gap; j++) {
                      packetLog[lastTimeIdx + j].time = lastTime + (timeDiff * (j / gap));
                  }
              } else {
                  for (let j = 0; j < i; j++) {
                      packetLog[j].time = realTime - (i - j) * 1000; 
                  }
              }
              lastTime = realTime;
              lastTimeIdx = i;
          }
      }
      
      if (lastTimeIdx !== -1 && lastTimeIdx < packetLog.length - 1) {
          for (let i = lastTimeIdx + 1; i < packetLog.length; i++) {
              packetLog[i].time = lastTime + (i - lastTimeIdx) * 1000;
          }
      } else if (lastTimeIdx === -1) {
          for (let i = 0; i < packetLog.length; i++) {
              packetLog[i].time = lastTime + i * 1000;
          }
      }
      
      packetLog.sort((a, b) => a.time - b.time);

      // --- FIX TELEMETRY TIMES ---
      for (const node of nodes.values()) {
          node.telemetry = node.telemetry.filter(t => t.logRef && t.logRef.time).map(t => {
              t.time = Math.floor(t.logRef.time / 1000);
              delete t.logRef;
              return t;
          });
          node.telemetry.sort((a, b) => a.time - b.time);
      }
                
                // Cache the final parsed graph
                let shareId = null;
                let shortUrl = null;
                try {
                    const cacheRes = await fetch(origin + '/api/cache', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isDemo: e.data.cmd === 'start_demo', graph: graph, token: e.data.turnstileToken, fileHash: fileHash })
                    });
                    if (cacheRes.ok) {
                        const cacheData = await cacheRes.json();
                        shareId = cacheData.id;
                        shortUrl = cacheData.shortUrl;
                    }
                } catch (e) {
                    console.error("Cache push failed", e);
                }
                
                if (!shareId && e.data.cmd !== 'start_demo') {
                    shareId = 'local_' + Math.random().toString(36).substring(2, 10);
                    self.postMessage({ type: 'DONE', graphData: graph, shareId: shareId, pendingSync: true });
                } else {
                    self.postMessage({ type: 'DONE', graphData: graph, shareId: shareId, shortUrl: shortUrl });
                }
                } catch (err) {
                    self.postMessage({ type: 'ERROR', error: err.message });
                }
            }
        };