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
                    const dataRes = await fetch(origin + dataUrl);
                    if (dataRes.ok) {
                        const graph = await dataRes.json();
                        self.postMessage({ type: 'DONE', graphData: graph });
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

            if (e.data.cmd === 'parse_file') {
                try {
                    let text = await e.data.file.text();
                
                const nodes = new Map(); // id (hex) -> nodeData
      const unmappedNodes = new Set();
      const linkMap = new Map(); // "A-B" -> {source, target, snrs: []}
      const routePaths = []; 
      const packetLog = []; // Terminal time-lapse
      
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
        
        if (packet.to && packet.to !== "!-1" && packet.to !== "!ffffffff") {
             getNode(packet.to).traffic_volume += 1;
        }

        if (!packet.portnum) return;
        
        const p = packet.payload || '';
        
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
        const allowedPorts = ['POSITION_APP', 'TELEMETRY_APP', 'NODEINFO_APP', 'TRACEROUTE_APP'];
        if (!allowedPorts.includes(packet.portnum)) return;

        if (packet.portnum === 'NODEINFO_APP' && p.startsWith('User{')) {
            const ln = p.match(/long_name=([^,}]+)/);
            const sn = p.match(/short_name=([^,}]+)/);
            const hw = p.match(/hw_model=([^,}]+)/);
            const idm = p.match(/id=(![0-9a-fA-F]+)/);
            
            if (ln) node.long_name = ln[1];
            if (sn) node.short_name = sn[1];
            if (hw) node.hw_model = hw[1];
            if (idm) node.hexId = idm[1];
        } 
        else if (packet.portnum === 'POSITION_APP' && p.startsWith('Position{')) {
            const latMatch = p.match(/latitude_i=(-?\d+)/);
            const lonMatch = p.match(/longitude_i=(-?\d+)/);
            const altMatch = p.match(/altitude=(-?\d+)/);
            
            if (latMatch && lonMatch) {
                node.lat = parseInt(latMatch[1], 10) / 1e7;
                node.lon = parseInt(lonMatch[1], 10) / 1e7;
                if (node.lat === 0 && node.lon === 0) {
                     delete node.lat;
                     delete node.lon;
                }
            }
            if (altMatch) node.altitude = parseInt(altMatch[1], 10);
        }
        else if (packet.portnum === 'TELEMETRY_APP' && p.startsWith('Telemetry{')) {
            let telem = {};
            
            const batMatch = p.match(/battery_level=(\d+)/);
            const volMatch = p.match(/voltage=([\d.]+)/);
            const chMatch = p.match(/channel_utilization=([\d.]+)/);
            const txMatch = p.match(/air_util_tx=([\d.]+)/);
            const tmpMatch = p.match(/temperature=([\d.]+)/);
            
            if (batMatch) telem.battery_level = parseInt(batMatch[1], 10);
            if (volMatch) telem.voltage = parseFloat(volMatch[1]);
            if (chMatch) telem.channel_utilization = parseFloat(chMatch[1]);
            if (txMatch) telem.air_util_tx = parseFloat(txMatch[1]);
            if (tmpMatch) telem.temperature = parseFloat(tmpMatch[1]);
            
            if (Object.keys(telem).length > 0) {
                telem.logRef = logEntry;
                node.telemetry.push(telem);
            }
        }
        else if (packet.portnum === 'TRACEROUTE_APP' && p.includes('Route traced')) {
            const hops = [];
            let currentHop = null;
            
            for (const line of p.split('\n')) {
                const idMatch = line.match(/!([0-9a-f]+)/);
                if (idMatch) {
                    if (currentHop) hops.push(currentHop);
                    currentHop = { id: "!" + idMatch[1], snr: null };
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
                validHops.forEach(h => getNode(h.id));
                routePaths.push({
                    from: packet.from,
                    hops: validHops
                });
                logEntry.hops = validHops; // Attach hops to terminal feed for animation
                
                for (let i = 0; i < validHops.length - 1; i++) {
                    const source = validHops[i].id;
                    const target = validHops[i+1].id;
                    const snr = validHops[i+1].snr;
                    
                    if (source === target) continue;
                    
                    const key = source < target ? `${source}-${target}` : `${target}-${source}`;
                    if (!linkMap.has(key)) {
                        linkMap.set(key, { source, target, snrs: [] });
                    }
                    if (snr !== null && snr !== '?') {
                        linkMap.get(key).snrs.push(snr);
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
                currentPacket = {
                    from: fromMatch ? toHexId(parseInt(fromMatch[1], 10)) : null,
                    to: toMatch ? toHexId(parseInt(toMatch[1], 10)) : null,
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
                
                processPacket({
                    from: hexId,
                    to: null,
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
      }

      const d3Edges = Array.from(linkMap.values()).map(link => {
          let avgSnr = null; // null = no SNR data (renders as grey)
          if (link.snrs.length > 0) {
              avgSnr = link.snrs.reduce((a, b) => a + b, 0) / link.snrs.length;
          }
          return { source: link.source, target: link.target, snr: avgSnr };
      });

      const graph = {
        nodes: Array.from(nodes.values()),
        edges: d3Edges,
        routePaths: routePaths,
        unmapped: Array.from(unmappedNodes),
        packetLog: packetLog
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
                        body: JSON.stringify({ isDemo: e.data.cmd === 'start_demo', graph: graph, token: e.data.turnstileToken })
                    });
                    if (cacheRes.ok) {
                        const cacheData = await cacheRes.json();
                        shareId = cacheData.id;
                        shortUrl = cacheData.shortUrl;
                    }
                } catch (e) {
                    console.error("Cache push failed", e);
                }
                
                self.postMessage({ type: 'DONE', graphData: graph, shareId: shareId, shortUrl: shortUrl });
                } catch (err) {
                    self.postMessage({ type: 'ERROR', error: err.message });
                }
            }
        };