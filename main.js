/*
Required Notice: Copyright (c) 2026 CardoSystems
*/
import { registerSW } from 'virtual:pwa-register';
import { initThreeBg, disposeThreeBg } from './src/three-bg.js';
// ponytail: native vite worker handling
import ParserWorker from './parser.worker.js?worker';

window.updatePending = false;
const updateSW = registerSW({
    onNeedRefresh() {
        console.log("New version detected.");
        window.updatePending = true;
        const btnCheckUpdates = document.getElementById('btn-check-updates');
        if (btnCheckUpdates) {
            btnCheckUpdates.innerText = 'Install Update';
            btnCheckUpdates.style.background = '#e91e63';
        }
        if (confirm("A new version is available! Refresh now to apply the update?")) {
            updateSW(true);
        }
    },
    onOfflineReady() {
        console.log("App ready to work offline.");
    },
});


let worker;
// ponytail: lazy raw IDB wrapper, skip idb-keyval dep

const idb = {
    open: () => new Promise(r => { 
        try {
            let q = indexedDB.open('m_db',1); 
            q.onupgradeneeded = () => { try{q.result.createObjectStore('kv')}catch(e){} }; 
            q.onsuccess = () => r(q.result); 
            q.onerror = q.onblocked = () => r(null);
        } catch(e) { r(null); }
    }),
    get: k => Promise.race([
        new Promise(r => setTimeout(() => r(null), 1000)),
        (async () => {
            try {
                const db = await idb.open();
                if (!db) return null;
                return await new Promise(r => {
                    let req = db.transaction('kv').objectStore('kv').get(k);
                    req.onsuccess = e => r(e.target.result);
                    req.onerror = () => r(null);
                });
            } catch (e) { return null; }
        })()
    ]),
    set: (k,v) => Promise.race([
        new Promise(r => setTimeout(() => r(null), 1500)),
        (async () => {
            try {
                const db = await idb.open();
                if (!db) return null;
                return await new Promise(r => {
                    let req = db.transaction('kv','readwrite').objectStore('kv').put(v,k);
                    req.onsuccess = req.onerror = () => r(true);
                });
            } catch (e) { return null; }
        })()
    ])
};
const escapeHTML = str => String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

// ponytail: shared helpers
function setupShareButton() {
    const shareBtn = document.getElementById('btn-share');
    if (!shareBtn) return;
    shareBtn.style.display = '';
    shareBtn.onclick = () => {
        navigator.clipboard.writeText(window.location.href).catch(() => { });
        const old = shareBtn.innerText;
        shareBtn.innerText = '✅ Copied!';
        setTimeout(() => shareBtn.innerText = old, 2000);
    };
}

function showLoadingScreen() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        mainContent.style.opacity = '0';
        mainContent.style.pointerEvents = 'none';
    }
    document.getElementById('loading-screen').style.display = 'flex';
    document.getElementById('loading-screen').style.opacity = '1';
    document.getElementById('file-picker-container').style.display = 'none';
    document.getElementById('loading-spinner-container').style.display = 'flex';
}
function getTurnstileToken() {
    return new Promise((resolve) => {
        if (!window.turnstile) return resolve(null);
        document.getElementById('loading-text').innerText = "VERIFYING SECURITY...";
        
        // ponytail: stop hanging forever on locked Android WebViews
        let done = false;
        const to = setTimeout(() => {
            if(!done) { done = true; try { window.turnstile.remove('#cf-turnstile-widget'); } catch(e){} resolve(null); }
        }, 6000);
        
        try {
            window.turnstile.render('#cf-turnstile-widget', {
                sitekey: '0x4AAAAAADoa_6pJqFVy3kJU',
                action: 'turnstile-spin-v1',
                callback: function (token) {
                    if(!done) { done = true; clearTimeout(to); try{window.turnstile.remove('#cf-turnstile-widget');}catch(e){} resolve(token); }
                },
                'error-callback': function () {
                    if(!done) { done = true; clearTimeout(to); resolve(null); }
                },
                'timeout-callback': function () {
                    if(!done) { done = true; clearTimeout(to); resolve(null); }
                }
            });
        } catch (e) {
            if(!done) { done = true; clearTimeout(to); resolve(null); }
        }
    });
}

    // ponytail: native PWA install prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const btn = document.getElementById('btn-install');
        if (btn) {
            btn.style.display = 'block';
            btn.onclick = async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') btn.style.display = 'none';
                deferredPrompt = null;
            };
        }
    });

    // ponytail: native wake lock to keep screen alive
    let wakeLock = null;
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            }
        } catch (err) {}
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
    });
    requestWakeLock();

window.addEventListener('load', () => {
    initThreeBg();
    const tsEl = document.getElementById('build-timestamp');
    if (tsEl && typeof __BUILD_TIMESTAMP__ !== 'undefined') {
        tsEl.innerText = "Build: " + __BUILD_TIMESTAMP__;
    }

    worker = new ParserWorker();

    // ponytail: workbox broadcast update listener
    const bc = new BroadcastChannel('api-updates');
    bc.onmessage = (e) => {
        if (e.data.type === 'CACHE_UPDATED') {
            const toast = document.createElement('div');
            toast.innerText = 'Map data updated in background. Click to reload.';
            toast.style = 'position:fixed;bottom:20px;right:20px;background:#4caf50;color:#000;padding:10px;border-radius:5px;z-index:9999;font-weight:bold;cursor:pointer;';
            toast.onclick = () => location.reload();
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 10000);
        }
    };

    const urlParams = new URLSearchParams(window.location.search);
    let mapId = urlParams.get('map');

    window.loadMap = function(id) {
        window.history.pushState({}, '', '?map=' + id);
        document.getElementById('file-picker-container').style.display = 'none';
        document.getElementById('loading-spinner-container').style.display = 'flex';
        document.getElementById('loading-text').innerText = "DOWNLOADING SHARED MAP...";
        worker.postMessage({ cmd: 'start', id: id, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin) });
    };

    // ponytail: memory logic
    let recent = JSON.parse(localStorage.getItem('recentMaps') || '[]');
    if (mapId && !recent.includes(mapId)) {
        recent = [mapId, ...recent].slice(0, 5);
        localStorage.setItem('recentMaps', JSON.stringify(recent));
    }
    const rmDiv = document.getElementById('recent-maps');
    if (rmDiv) {
        rmDiv.innerHTML = `<div style="width:100%;text-align:center;color:#888;font-size:12px;">Recent Maps:</div>` + 
            (recent.length > 0 
                ? recent.map(id => `<a href="javascript:void(0)" onclick="window.loadMap('${id}')" style="color:#4caf50;text-decoration:none;border:1px solid #4caf50;padding:4px 8px;border-radius:4px;font-size:12px;">${id}</a>`).join('')
                : `<span style="color:#555;font-size:12px;">None yet. Open a map to save it here.</span>`);
    }

    if (mapId) {
        document.getElementById('loading-text').innerText = "DOWNLOADING SHARED MAP...";
        // ponytail: check IDB history first before network!
        idb.get(`history_${mapId}`).then(localGraph => {
            if (localGraph) {
                document.getElementById('loading-spinner-container').style.display = 'flex';
                document.getElementById('file-picker-container').style.display = 'none';
                document.getElementById('loading-text').innerText = "RESTORING LOCAL HISTORY...";
                setTimeout(() => initializeDashboard(localGraph), 100);
            } else {
                worker.postMessage({ cmd: 'start', id: mapId, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin) });
            }
        });
    } else {
        idb.get('autoSave').then(data => {
            if (data) {
                if (data.shareId) window.history.replaceState({}, '', '?map=' + data.shareId);
                document.getElementById('loading-spinner-container').style.display = 'flex';
                document.getElementById('file-picker-container').style.display = 'none';
                document.getElementById('loading-text').innerText = "RESTORING LOCAL SESSION...";
                setTimeout(() => initializeDashboard(data), 100);
            } else {
                // ponytail: skip the 3-second dead fetch for legacy global cache. Show UI instantly.
                document.getElementById('loading-spinner-container').style.display = 'none';
                document.getElementById('file-picker-container').style.display = 'flex';
            }
        });
    }

    // ponytail: observer to disable share button when offline
    const updateOfflineState = async () => {
        const isOffline = !navigator.onLine;
        const shareBtn = document.getElementById('btn-share');
        if (shareBtn) shareBtn.disabled = isOffline;
        const banner = document.getElementById('offline-banner');
        if (banner) banner.style.display = isOffline ? 'block' : 'none';

        // ponytail: force dark mode map offline to avoid broken satellite tiles
        if (window.leafletMap) {
            if (isOffline) {
                // We don't remove other layers automatically because the map might not be visible,
                // but we disable them in the control
                document.querySelectorAll('.leaflet-control-layers-list label').forEach(el => {
                    if (!el.innerText.includes('Offline')) {
                        el.classList.add('offline-disabled-layer');
                    }
                });
            } else {
                document.querySelectorAll('.leaflet-control-layers-list label').forEach(el => {
                    el.classList.remove('offline-disabled-layer');
                });
            }
        }

        if (!isOffline && worker) {
            const pending = await idb.get('syncQueue');
            if (pending) {
                const token = await getTurnstileToken();
                if (token && token !== 'offline-bypass') {
                    worker.postMessage({ cmd: 'sync', graph: pending, turnstileToken: token, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin) });
                    await idb.set('syncQueue', null);
                }
            }
        }
    };
    window.addEventListener('online', updateOfflineState);
    window.addEventListener('offline', updateOfflineState);
    updateOfflineState();

    // ponytail: hyper-focus cache on Portugal bounding box up to zoom 12 (~3500 tiles) progressively
    if ('serviceWorker' in navigator) {
        setTimeout(() => {
            const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
            const lat2tile = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
            
            // Portugal Bounding Box
            const nLat = 42.2, sLat = 36.9, wLon = -9.6, eLon = -6.1;
            const tileQueue = [];
            
            // ponytail: hyper-focus cache on Portugal bounding box up to zoom 12 (~3500 tiles) progressively
            const maxZ = parseInt(localStorage.getItem('offline_zoom_level') || '10', 10);
            const activeUrl = Object.values(window.leafletMap?._layers || {}).find(l => l._url)?._url || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

            for(let z=0; z<=maxZ; z++) {
                const xMin = lon2tile(wLon, z);
                const xMax = lon2tile(eLon, z);
                const yMin = lat2tile(nLat, z); // lower Y is higher Lat
                const yMax = lat2tile(sLat, z);

                for(let x=xMin; x<=xMax; x++) {
                    for(let y=yMin; y<=yMax; y++) {
                        tileQueue.push(activeUrl.replace('{s}', 'a').replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{r}', ''));
                    }
                }
            }

            const totalTiles = tileQueue.length;
            const startTime = Date.now();
            let tilesDone = 0;

            const processQueue = async () => {
                while(tileQueue.length > 0) {
                    if (!navigator.onLine) { await new Promise(r=>setTimeout(r,5000)); continue; }
                    fetch(tileQueue.shift(), {mode:'cors'}).catch(()=>{});
                    tilesDone++;
                    
                    const pBar = document.getElementById('cache-progress');
                    const pStats = document.getElementById('cache-stats');
                    const pEta = document.getElementById('cache-eta');
                    if (pBar && pStats && pEta) {
                        pBar.max = totalTiles;
                        pBar.value = tilesDone;
                        pStats.innerText = `${tilesDone} / ${totalTiles} tiles`;
                        
                        if (tilesDone > 5 && tileQueue.length > 0) {
                            const elapsed = Date.now() - startTime;
                            const msPerTile = elapsed / tilesDone;
                            const remaining = tileQueue.length * msPerTile;
                            const sec = Math.floor(remaining / 1000);
                            pEta.innerText = sec > 60 ? `ETA: ${Math.floor(sec/60)}m ${sec%60}s` : `ETA: ${sec}s`;
                        } else if (tileQueue.length === 0) {
                            pEta.innerText = 'Completed';
                            pEta.style.color = '#4caf50';
                        }
                    }

                    await new Promise(r=>setTimeout(r,50)); // 50ms trickle to avoid network blasting
                }
            };
            processQueue();
        }, 3000);
    }

    // If loaded via a shared ?map= URL, the current URL is already shareable
    if (mapId) {
        setupShareButton();
    }

    worker.onmessage = function (e) {
        if (e.data.type === 'DONE') {
            if (e.data.pendingSync) {
                idb.set('syncQueue', e.data.graphData);
            }
            if (e.data.shareId) {
                // ponytail: save full history
                idb.set(`history_${e.data.shareId}`, e.data.graphData);
                
                window.history.replaceState({}, '', '?map=' + e.data.shareId);
                // ponytail: always use app link instead of localhost
                const appUrl = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') || window.location.origin.includes('capacitor')) ? 'https://meshlog.camal.eu' : window.location.origin;
                navigator.clipboard.writeText(e.data.shortUrl || (appUrl + '?map=' + e.data.shareId)).catch(() => { });
                setupShareButton();
                const btn = document.getElementById('btn-upload');
                if (btn && !window.location.search.includes(e.data.shareId)) {
                    btn.innerText = "Link Copied!";
                    setTimeout(() => btn.innerText = "Upload Log", 2000);
                }
            }
            
            // ponytail: show duplicate warning toast
            if (e.data.isDuplicate) {
                const toast = document.getElementById('centered-toast');
                if (toast) {
                    toast.innerText = "⚠️ Duplicate log detected. Redirected to original.";
                    toast.style.display = 'block';
                    setTimeout(() => toast.style.display = 'none', 5000);
                }
            }

            // Inject shareId so autoSave remembers the URL
            if (e.data.shareId) e.data.graphData.shareId = e.data.shareId;

            // ponytail: uncollapse UI on new log upload
            const vc = document.getElementById('view-controls');
            const tc = document.getElementById('terminal-container');
            if (vc) vc.classList.remove('collapsed');
            if (tc) tc.classList.remove('collapsed');

            // If offline local upload inside existing dashboard, tear down old map
            const mapEl = document.getElementById('map');
            if (mapEl && mapEl._leaflet_id) {
                if (window.leafletMap) {
                    window.leafletMap.remove();
                    window.leafletMap = null;
                }
                mapEl.outerHTML = '<div id="map"></div>';

                if (window.d3Simulation) {
                    window.d3Simulation.stop();
                    window.d3Simulation = null;
                }
                document.getElementById('d3-container').innerHTML = '<div id="d3-tooltip"></div>';
                document.getElementById('terminal-output').innerHTML = '';
                window.d3Initialized = false;
                if (window._tickAnimFrame) cancelAnimationFrame(window._tickAnimFrame);
            }

            document.getElementById('loading-text').innerText = "RENDERING TOPOLOGY...";
            setTimeout(() => {
                try {
                    initializeDashboard(e.data.graphData);
                } catch (err) {
                    document.getElementById('loading-text').innerText = "ERROR: " + err.message;
                    console.error("Dashboard error", err);
                }
            }, 100);
        } else if (e.data.type === 'SYNC_DONE') {
            window.history.replaceState({}, '', '?map=' + e.data.shareId);
            if (typeof graphData !== 'undefined' && graphData) {
                graphData.shareId = e.data.shareId;
                idb.set('autoSave', graphData);
                idb.set(`history_${e.data.shareId}`, graphData);
            }
            setupShareButton();
        } else if (e.data.type === 'NO_CACHE') {
            document.getElementById('loading-spinner-container').style.display = 'none';
            document.getElementById('file-picker-container').style.display = 'flex';
        } else if (e.data.type === 'ERROR') {
            document.getElementById('loading-text').innerText = "ERROR: " + e.data.error;
        }
    };


    document.getElementById('log-file-input').addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        document.getElementById('file-picker-container').style.display = 'none';
        document.getElementById('loading-spinner-container').style.display = 'flex';
        const token = await getTurnstileToken();
        document.getElementById('loading-text').innerText = "NUCLEAR REACTOR 4 STARTING...";
        worker.postMessage({ cmd: 'parse_file', file: file, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
    });

    // Global drag and drop support
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
    });
    
    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files[0];
        if (!file) return;

        showLoadingScreen();

        const token = await getTurnstileToken();
        document.getElementById('loading-text').innerText = "NUCLEAR REACTOR 4 STARTING...";
        worker.postMessage({ cmd: 'parse_file', file: file, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
    });

    // Test environment mock trigger
    setTimeout(() => {
        if (window.__MOCK_DEMO_DATA__) {
            const btn = document.getElementById('btn-load-demo');
            btn.style.display = 'inline-block';
            btn.addEventListener('click', async () => {
                document.getElementById('file-picker-container').style.display = 'none';
                document.getElementById('loading-spinner-container').style.display = 'flex';
                const token = await getTurnstileToken();
                document.getElementById('loading-text').innerText = "DOWNLOADING DEMO LOG...";
                const blob = new Blob([window.__MOCK_DEMO_DATA__], { type: 'text/plain' });
                worker.postMessage({ cmd: 'parse_file', file: blob, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
            });
        }
    }, 500);


});

// ponytail: request persistent storage so the OS never deletes our cached map tiles when low on space. 
// Android (Capacitor) grants this automatically since it's a native app. PWAs often get denied.
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(granted => {
        if (granted) console.log("Storage will not be cleared except by explicit user action");
    });
}

function initializeDashboard(graphData) {
    idb.set('autoSave', graphData); // ponytail: auto-save locally to survive refresh
    // ponytail: simple scan for central node
    const maxVolNodeId = graphData.nodes.reduce((m, n) => (n.traffic_volume || 0) > (m.traffic_volume || 0) ? n : m, graphData.nodes[0] || {}).id;

    // --- DASHBOARD UPLOAD LOGIC ---
    const btnUpload = document.getElementById('btn-upload');
    const hiddenUpload = document.getElementById('dashboard-upload-input');
    if (btnUpload && hiddenUpload) {
        btnUpload.onclick = () => hiddenUpload.click();
        hiddenUpload.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            showLoadingScreen();

            const token = await getTurnstileToken();

            document.getElementById('loading-text').innerText = "NUCLEAR REACTOR 4 STARTING...";

            worker.postMessage({ cmd: 'parse_file', file: file, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
        };
    }

    // --- VIEW TOGGLE LOGIC ---
    const btnMap = document.getElementById('btn-map');
    const btnNet = document.getElementById('btn-net');
    const btnSidebar = document.getElementById('btn-sidebar');
    const mapDiv = document.getElementById('map');
    const d3Div = document.getElementById('d3-container');
    const sidebarDiv = document.getElementById('sidebar');

    // --- NODE SEARCH ---
    const datalist = document.getElementById('node-datalist');
    const searchInput = document.getElementById('node-filter');
    if (datalist && searchInput) {
        let optionsHtml = '';
        graphData.nodes.forEach(n => {
            const name = n.long_name || n.short_name || n.id;
            optionsHtml += `<option value="${name}"></option>`;
            if (name !== n.id) optionsHtml += `<option value="${n.id}"></option>`; // allow searching by raw ID too
        });
        datalist.innerHTML = optionsHtml;

        const showCenteredToast = (msg) => {
            const toast = document.getElementById('centered-toast');
            if (!toast) return;
            toast.innerText = msg;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 2000);
        };

        searchInput.addEventListener('change', (e) => {
            const val = e.target.value.trim();
            if (!val) return;

            const node = graphData.nodes.find(n => (n.long_name || n.short_name || n.id) === val || n.id === val || n.id.toString() === val.toString());
            if (!node) {
                showCenteredToast("❌ Node not found in graph");
                return;
            }

            openNodePanel(node.id);
            pulseD3(node.id); // Highlight on Logical Network
            pulseLeaflet(node.id); // Highlight on Geo Map

            if (node.lat !== undefined && node.lon !== undefined) {
                if (!btnNet.classList.contains('active')) {
                    btnMap.click();
                    setTimeout(() => map.setView([node.lat, node.lon], 16), 150); // Wait for map to become visible
                } else {
                    map.setView([node.lat, node.lon], 16);
                }
                e.target.blur();
            } else {
                e.target.blur();
                showCenteredToast("⚠️ Node lacks GPS fix");
            }
        });
    }

    // --- MOBILE NAV TOGGLE ---
    const navToggle = document.getElementById('nav-toggle');
    const viewControls = document.getElementById('view-controls');
    const hasSeenTour = localStorage.getItem('tour_global_seen');
    if (navToggle) {
        if (hasSeenTour && window.innerWidth <= 768) {
            viewControls.classList.add('collapsed'); // start collapsed on mobile if onboarded
            navToggle.textContent = '☰'; // pointing down to expand
        } else {
            navToggle.textContent = '×'; // expanded
        }
        navToggle.onclick = () => {
            const isCollapsed = viewControls.classList.toggle('collapsed');
            navToggle.textContent = isCollapsed ? '☰' : '×';
        };
    }

    let meshDevice = null;

    const setupLiveDevice = (device, btn) => {
        btn.innerText = "🔴 Live (Radio Connected)";
        btn.style.background = "rgba(244, 67, 54, 0.2)";
        btn.style.borderColor = "rgba(244, 67, 54, 0.5)";
        btn.style.color = "#f44336";
        
        device.events.onMessagePacket.subscribe((packet) => {
            console.log("Live Packet Received:", packet);
            // TODO: Map binary packets into window.graphData for incremental UI updates
        });
    };

    document.body.addEventListener('click', async (e) => {
        const btnUsb = e.target.closest('#btn-connect-usb');
        const btnBle = e.target.closest('#btn-connect-ble');

        if (btnUsb) {
            console.log("Connect USB clicked");
            try {
                if (!meshDevice) {
                    const port = await navigator.serial.requestPort();
                    const transport = await TransportWebSerial.createFromPort(port);
                    meshDevice = new MeshDevice(transport);
                    await meshDevice.connect();
                    setupLiveDevice(meshDevice, btnUsb);
                }
            } catch (err) {
                console.error("USB connection error:", err);
                alert("Could not connect to USB radio: " + err.message);
            }
        } else if (btnBle) {
            console.log("Connect BLE clicked");
            try {
                if (!meshDevice) {
                    const device = await navigator.bluetooth.requestDevice({
                        filters: [{ namePrefix: 'Meshtastic' }],
                        optionalServices: ['cb0b9a0b-a84c-4c07-8891-cb0b9a0c0001']
                    });
                    const transport = await TransportWebBluetooth.createFromDevice(device);
                    meshDevice = new MeshDevice(transport);
                    await meshDevice.connect();
                    setupLiveDevice(meshDevice, btnBle);
                }
            } catch (err) {
                console.error("Bluetooth connection error:", err);
                alert("Could not connect to Bluetooth radio: " + err.message);
            }
        }
    });

    // --- TERMINAL TOGGLE (GLOBAL) ---
    const terminalToggles = document.querySelectorAll('.term-toggle');
    const terminalContainer = document.getElementById('terminal-container');
    
    if (hasSeenTour && window.innerWidth <= 768) {
        terminalContainer.classList.add('collapsed');
        terminalToggles.forEach(t => t.textContent = '▴');
        setTimeout(() => { 
            if (window.leafletMap) window.leafletMap.invalidateSize(); 
            window.dispatchEvent(new Event('resize'));
        }, 350);
    } else {
        terminalToggles.forEach(t => t.textContent = '▾');
    }
    
    terminalToggles.forEach(toggle => {
        toggle.onclick = () => {
            const isCollapsed = terminalContainer.classList.toggle('collapsed');
            terminalToggles.forEach(t => t.textContent = isCollapsed ? '▴' : '▾');
            setTimeout(() => { 
                if (window.leafletMap) window.leafletMap.invalidateSize(); 
                window.dispatchEvent(new Event('resize'));
            }, 350);
        };
    });

    if (!window._resizeAttached) {
        window._resizeAttached = true;
        window.addEventListener('resize', () => {
            const vControls = document.getElementById('view-controls');
            if (window.innerWidth > 768) {
                if (vControls) vControls.classList.remove('collapsed');
            }
        });
    }

    btnSidebar.onclick = () => {
        btnSidebar.classList.add('active'); btnMap.classList.remove('active'); btnNet.classList.remove('active');
        mapDiv.style.display = 'none'; d3Div.style.display = 'none';
        sidebarDiv.style.display = 'flex';
        if (window.runUnmappedTour && !localStorage.getItem('tour_unmapped_seen') && localStorage.getItem('disable_tours') !== 'true') {
            setTimeout(() => window.runUnmappedTour(), 200);
        }
    };

    btnMap.onclick = () => {
        btnMap.classList.add('active'); btnNet.classList.remove('active'); btnSidebar.classList.remove('active');
        mapDiv.style.display = 'block'; d3Div.style.display = 'none';
        sidebarDiv.style.display = 'none';
        setTimeout(() => map.invalidateSize(), 100);
        if (window.runMapTour && !localStorage.getItem('tour_map_seen') && localStorage.getItem('tour_global_seen') && localStorage.getItem('disable_tours') !== 'true') {
            setTimeout(() => window.runMapTour(), 200);
        }
    };

    btnNet.onclick = () => {
        btnNet.classList.add('active'); btnMap.classList.remove('active'); btnSidebar.classList.remove('active');
        mapDiv.style.display = 'none'; d3Div.style.display = 'block';
        sidebarDiv.style.display = 'none';
        if (window.runNetTour && !localStorage.getItem('tour_net_seen') && localStorage.getItem('disable_tours') !== 'true') {
            setTimeout(() => window.runNetTour(), 200);
        }
        if (!window.d3Initialized) initD3Graph();
    };

    // ponytail: settings modal logic
    const btnSettings = document.getElementById('btn-settings');
    
    // Resize listener for responsive terminal header
    const mobileSearchInput = document.getElementById('node-filter');
    if (mobileSearchInput) {
        const updateNF = () => { mobileSearchInput.placeholder = window.innerWidth <= 768 ? "🔍 Node" : "Search Node ID..."; };
        window.addEventListener('resize', updateNF);
        updateNF();
    }

    const btnClearTerminal = document.getElementById('btn-clear-terminal');
    const settingsModal = document.getElementById('settings-modal');
    const btnSettingsClose = document.getElementById('btn-settings-close');
    const settingZoom = document.getElementById('setting-zoom');
    const settingDisableTours = document.getElementById('setting-disable-tours');
    const settingColorByType = document.getElementById('setting-color-by-type'); // ponytail
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', async () => {
            if (window.updatePending) {
                if (confirm("Refresh now to apply the update?")) {
                    updateSW(true);
                }
                return;
            }
            
            btnCheckUpdates.innerText = 'Checking...';
            try {
                // 1. Standard PWA update
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) await reg.update();
                
                // ponytail: native cache-busting fallback for stuck edge caches
                const res = await fetch('/?t=' + Date.now(), { cache: 'no-store' });
                const html = await res.text();
                const scriptEl = document.querySelector('script[type="module"][src]');
                const currentSrc = scriptEl ? scriptEl.getAttribute('src') : null;
                
                if (currentSrc && currentSrc.includes('assets/') && !html.includes(currentSrc)) {
                    if (confirm("A new version is available! Refresh now to apply the update?")) {
                        if (reg) await reg.unregister();
                        window.location.reload();
                    }
                    return;
                }

                setTimeout(() => {
                    if (!window.updatePending) {
                        btnCheckUpdates.innerText = 'Up to date!';
                        setTimeout(() => { 
                            if (!window.updatePending) {
                                btnCheckUpdates.innerText = 'Search';
                                btnCheckUpdates.style.background = '#3f51b5';
                            }
                        }, 4000);
                    }
                }, 2000);
            } catch(e) {
                btnCheckUpdates.innerText = 'Error';
                setTimeout(() => { 
                    if (!window.updatePending) {
                        btnCheckUpdates.innerText = 'Search'; 
                        btnCheckUpdates.style.background = '#3f51b5';
                    }
                }, 4000);
            }
        });
    }

    const btnResetTours = document.getElementById('btn-reset-tours');
    
    const settingD3Spread = document.getElementById('setting-d3-spread');
    const btnResetSpread = document.getElementById('btn-reset-spread');
    
    if (settingD3Spread) {
        settingD3Spread.value = localStorage.getItem('d3_spread') || '-300';
        settingD3Spread.addEventListener('input', (e) => {
            const val = e.target.value;
            localStorage.setItem('d3_spread', val);
            if (window.d3Simulation) {
                window.d3Simulation.force("charge").strength(parseInt(val));
                window.d3Simulation.alpha(1).restart();
            }
        });
    }

    if (btnResetSpread && settingD3Spread) {
        btnResetSpread.addEventListener('click', () => {
            settingD3Spread.value = '-300';
            localStorage.setItem('d3_spread', '-300');
            if (window.d3Simulation) {
                window.d3Simulation.force("charge").strength(-300);
                window.d3Simulation.alpha(1).restart();
            }
        });
    }

    if (btnSettings && settingsModal) {
        btnSettings.addEventListener('click', async () => {
            settingZoom.value = localStorage.getItem('offline_zoom_level') || '10';
            settingDisableTours.checked = localStorage.getItem('disable_tours') === 'true';
            if (settingColorByType) settingColorByType.checked = localStorage.getItem('color_by_type') === 'true'; // ponytail
            if (settingD3Spread) settingD3Spread.value = localStorage.getItem('d3_spread') || '-300';
            settingsModal.showModal();
            // ponytail: true cache size
            try {
                const cache = await caches.open('leaflet-tiles-cache');
                const keys = await cache.keys();
                const pStats = document.getElementById('cache-stats');
                if (pStats) pStats.innerText = `${keys.length} tiles in cache`;
            } catch(e) {}
        });

        btnResetTours.addEventListener('click', () => {
            localStorage.removeItem('tour_global_seen');
            localStorage.removeItem('tour_map_seen');
            localStorage.removeItem('tour_net_seen');
            localStorage.removeItem('tour_unmapped_seen');
            alert("Tutorial progress reset! The guided tours will show again.");
        });

        btnSettingsClose.addEventListener('click', () => {
            const oldZ = localStorage.getItem('offline_zoom_level') || '10';
            localStorage.setItem('offline_zoom_level', settingZoom.value);
            localStorage.setItem('disable_tours', settingDisableTours.checked ? 'true' : 'false');
            if (settingColorByType) localStorage.setItem('color_by_type', settingColorByType.checked ? 'true' : 'false'); // ponytail
            if (settingD3Spread) localStorage.setItem('d3_spread', settingD3Spread.value);
            settingsModal.close();
            
            // ponytail: if zoom level changed, trigger background fetch of the current viewport
            if (settingZoom.value !== oldZ) {
                downloadTiles(parseInt(settingZoom.value));
            }
        });

        async function downloadTiles(maxZoom) {
            if (!window.leafletMap) return;
            const bounds = window.leafletMap.getBounds();
            let activeUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
            window.leafletMap.eachLayer(l => { if(l._url) activeUrl = l._url; });
            
            let urls = [];
            for (let z = 1; z <= maxZoom; z++) {
                const nw = window.leafletMap.project(bounds.getNorthWest(), z);
                const se = window.leafletMap.project(bounds.getSouthEast(), z);
                const minX = Math.floor(nw.x / 256), maxX = Math.floor(se.x / 256);
                const minY = Math.floor(nw.y / 256), maxY = Math.floor(se.y / 256);
                for (let x = minX; x <= maxX; x++) {
                    for (let y = minY; y <= maxY; y++) {
                        let u = activeUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{s}', 'a').replace('{r}', '');
                        urls.push(u);
                        if (urls.length > 56000) break;
                    }
                    if (urls.length > 56000) break;
                }
            }
            
            const pBar = document.getElementById('cache-progress');
            const pEta = document.getElementById('cache-eta');
            const pStats = document.getElementById('cache-stats');
            if(pBar) { pBar.max = urls.length; pBar.value = 0; }
            if(pEta) pEta.innerText = "Downloading...";
            if(pStats) pStats.innerText = `0 / ${urls.length} tiles`;
            
            let done = 0;
            // Fetch in batches of 10 to utilize SW caching without freezing UI
            for (let i = 0; i < urls.length; i += 10) {
                const batch = urls.slice(i, i + 10);
                await Promise.allSettled(batch.map(u => fetch(u, { mode: 'cors' })));
                done += batch.length;
                if(pBar) pBar.value = done;
                if(pStats) pStats.innerText = `${done} / ${urls.length} tiles`;
            }
            if(pEta) pEta.innerText = "Completed";
            
            try {
                const cache = await caches.open('leaflet-tiles-cache');
                const keys = await cache.keys();
                if (pStats) pStats.innerText = `${keys.length} tiles in cache`;
            } catch(e) {}
        }
    }


    // --- LEAFLET MAP LOGIC ---
    // ponytail: fix broken marker icons offline by pointing to local public/images cache
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconUrl: '/images/marker-icon.png',
        iconRetinaUrl: '/images/marker-icon-2x.png',
        shadowUrl: '/images/marker-shadow.png'
    });

    const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CartoDB', maxZoom: 19 });
    const satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });
    const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
    const topoTiles = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap', maxZoom: 17 });
    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });
    
    const map = L.map('map', { layers: [osmTiles] }).setView([0, 0], 2);
    window.leafletMap = map;
    
    const baseMaps = {
        "OpenStreetMap (Offline Cache)": osmTiles,
        "Carto Dark": darkTiles,
        "Open TOPO": topoTiles,
        "ESRI World TOPO": esriTopo,
        "ESRI Satellite": satTiles
    };
    L.control.layers(baseMaps).addTo(map);
    
    // Disable online-only maps if offline
    if (!navigator.onLine) {
        setTimeout(() => {
            document.querySelectorAll('.leaflet-control-layers-list label').forEach(el => {
                if (!el.innerText.includes('Offline')) {
                    el.classList.add('offline-disabled-layer');
                }
            });
        }, 100);
    }
    L.control.scale({ imperial: false, metric: true }).addTo(map);
    
    // On mobile the layout isn't fully settled at map creation time — force a size recalc
    if (window.innerWidth <= 768) {
        setTimeout(() => map.invalidateSize(), 300);
        setTimeout(() => map.invalidateSize(), 800);
    }

    const markers = {};
    const latLngs = [];

    function renderPlotly(popupId, telemetry) {
        if (!telemetry || telemetry.length === 0) return;
        const labels = telemetry.map(t => new Date(t.time * 1000));
        const battData = telemetry.map(t => t.battery_level);
        const utilData = telemetry.map(t => t.channel_utilization);

        const traceBatt = { x: labels, y: battData, mode: 'lines+markers', name: 'Battery %', line: { color: '#4caf50', width: 2 }, marker: { size: 4 } };
        const traceUtil = { x: labels, y: utilData, mode: 'lines+markers', name: 'Ch Util %', line: { color: '#ff9800', width: 2 }, marker: { size: 4 } };

        const layout = {
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { color: '#ccc', size: 10 },
            margin: { l: 30, r: 10, t: 10, b: 30 },
            xaxis: { showgrid: false, type: 'date' },
            yaxis: { showgrid: true, gridcolor: '#444', zeroline: false },
            legend: { orientation: 'h', y: -0.2, x: 0 },
            autosize: true
        };

        Plotly.newPlot(popupId, [traceBatt, traceUtil], layout, { displayModeBar: false, responsive: true });
    }

    function openNodePanel(nodeId) {
        const node = graphData.nodes.find(n => n.id === nodeId);
        if (!node) return;

        if (window.location.hash !== `#node=${node.id}`) {
            window.history.replaceState(null, '', `#node=${node.id}`);
        }

        document.getElementById('node-analytics-panel').classList.add('open');
        document.body.classList.add('panel-open');
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);

        document.getElementById('panel-node-name').innerText = node.long_name || node.short_name || node.id;
        document.getElementById('panel-node-id').innerText = node.id;
        document.getElementById('panel-hw-model').innerText = node.hw_model || '-';
        document.getElementById('panel-traffic').innerText = node.traffic_volume || 0;

        // Render Plotly chart
        document.getElementById('panel-chart').innerHTML = '';
        if (node.telemetry && node.telemetry.length > 0) {
            renderPlotly('panel-chart', node.telemetry);
        }

        // Show recent packets
        const recentDiv = document.getElementById('panel-recent-packets');
        recentDiv.innerHTML = '';
        const recent = graphData.packetLog.filter(p => p.from === nodeId).slice(-10);
        if (recent.length === 0) {
            recentDiv.innerHTML = 'No recent packets found.';
        } else {
            recent.forEach(p => {
                const div = document.createElement('div');
                div.style.marginBottom = '4px';
                div.style.borderBottom = '1px solid #333';
                div.style.paddingBottom = '4px';
                div.innerText = `[${p.port}] ${p.sum}`;
                recentDiv.appendChild(div);
            });
        }

        // ponytail: route from last clicked node
        if (window.lastClickedNodeId === nodeId) {
            window.lastClickedNodeId = null;
            highlightPath(null, null);
        } else {
            if (window.lastClickedNodeId) {
                highlightPath(window.lastClickedNodeId, nodeId);
            }
            window.lastClickedNodeId = nodeId;
        }
    }

    function highlightPath(src, dst) {
        if (!src || !dst) {
            if (window.leafletRouteGroup) { window.leafletMap.removeLayer(window.leafletRouteGroup); window.leafletRouteGroup = null; }
            if (window.highlightD3Route) window.highlightD3Route(null);
            Object.keys(markers).forEach(id => markers[id].setOpacity(1));
            if (window.leafletRouteLines) window.leafletRouteLines.forEach(line => line.setStyle({ opacity: 0.8 }));
            return;
        }
        const adj = {};
        graphData.edges.forEach(e => {
            const s = e.source.id || e.source; const t = e.target.id || e.target;
            if(!adj[s]) adj[s] = []; if(!adj[t]) adj[t] = [];
            adj[s].push(t); adj[t].push(s);
        });
        const q = [[src]]; const visited = new Set([src]);
        let path = null;
        while(q.length > 0) {
            const p = q.shift(); const curr = p[p.length - 1];
            if(curr === dst) { path = p; break; }
            for(const n of (adj[curr] || [])) {
                if(!visited.has(n)) { visited.add(n); q.push([...p, n]); }
            }
        }
        
        if (window.leafletRouteGroup) { window.leafletMap.removeLayer(window.leafletRouteGroup); }
        if (window.highlightD3Route) window.highlightD3Route(path);

        if(!path) return;

        const latlngs = [];
        let valid = true;
        for(let i=0; i<path.length; i++) {
            const n = graphData.nodes.find(node => node.id === path[i]);
            if(n && n.lat !== undefined && n.lon !== undefined) latlngs.push([n.lat, n.lon]);
            else valid = false;
        }
        if(valid && latlngs.length > 1) {
            window.leafletRouteGroup = L.polyline(latlngs, {color: '#00e5ff', weight: 6, opacity: 0.8}).addTo(window.leafletMap);
        }

        // dim un-highlighted Leaflet markers and lines
        Object.keys(markers).forEach(id => {
            if (!path || path.includes(id)) {
                markers[id].setOpacity(1);
            } else {
                markers[id].setOpacity(0.3);
            }
        });
        if (window.leafletRouteLines) {
            window.leafletRouteLines.forEach(line => {
                if (!path) {
                    line.setStyle({ opacity: 0.8 });
                    return;
                }
                const s = line.edgeSource; const t = line.edgeTarget;
                let inPath = false;
                for (let i=0; i<path.length-1; i++) {
                    if ((s === path[i] && t === path[i+1]) || (s === path[i+1] && t === path[i])) inPath = true;
                }
                line.setStyle({ opacity: inPath ? 1 : 0.1 });
            });
        }
    }

    document.getElementById('close-panel').onclick = () => {
        document.getElementById('node-analytics-panel').classList.remove('open');
        document.body.classList.remove('panel-open');
        if (window.location.hash.startsWith('#node=')) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);
    };

    graphData.nodes.forEach(node => {
        if (node.lat !== undefined && node.lon !== undefined) {
            const isSrc = node.id === maxVolNodeId;
            const markerOptions = isSrc ? { icon: new L.Icon({ iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34] }) } : {};
            const marker = L.marker([node.lat, node.lon], markerOptions).addTo(map);
            markers[node.id] = marker;
            latLngs.push([node.lat, node.lon]);

            let html = `<div class="popup-header">${escapeHTML(node.long_name || node.id)}</div>`;
            if (node.hw_model) html += `<div>Model: ${escapeHTML(node.hw_model)}</div>`;
            html += `<div>Traffic Volume: ${node.traffic_volume} pkts</div>`;
            html += `<div style="margin-top:10px;color:#00bcd4;cursor:pointer;font-weight:bold;font-size:12px;" onclick="document.dispatchEvent(new CustomEvent('openNodePanel', {detail: '${node.id}'}))">VIEW ANALYTICS &rarr;</div>`;
            html += `<div style="margin-top:8px;color:#7c3aed;cursor:pointer;font-weight:bold;font-size:12px;" onclick="document.dispatchEvent(new CustomEvent('copyNodeLink', {detail: '${node.id}'}))">SHARE NODE 🔗</div>`;

            marker.bindPopup(html);
        }
    });

    window.openNodePanelFn = openNodePanel;
    if (!window._dashboardEventsAttached) {
        window._dashboardEventsAttached = true;
        document.addEventListener('openNodePanel', (e) => {
            if (window.openNodePanelFn) window.openNodePanelFn(e.detail);
        });

        document.addEventListener('copyNodeLink', (e) => {
            const nodeId = e.detail;
            let searchStr = window.location.search;
            if (!searchStr && typeof graphData !== 'undefined' && graphData && graphData.shareId) {
                searchStr = '?map=' + graphData.shareId;
            }
            const link = (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin) + window.location.pathname + searchStr + '#node=' + nodeId;
            navigator.clipboard.writeText(link).then(() => {
                const toast = document.createElement('div');
                toast.innerText = 'Copied to clipboard!';
                toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#4caf50;color:white;padding:10px 20px;border-radius:20px;font-size:12px;z-index:999999;box-shadow:0 4px 10px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.3s;';
                document.body.appendChild(toast);
                setTimeout(() => toast.style.opacity = '1', 10);
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => toast.remove(), 300);
                }, 2000);
            }).catch(err => console.error('Could not copy text: ', err));
        });
    }

    const isDeepLinking = window.location.hash && window.location.hash.startsWith('#node=');
    if (latLngs.length > 0 && !isDeepLinking) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
    }

    const routeLines = [];
    
    const getLinkColor = (snr) => {
        if (snr === null || snr === undefined) return "#00bcd4";
        if (snr > -5) return "#4caf50";
        if (snr > -15) return "#ffc107";
        return "#f44336";
    };

    const getThickness = (snr) => {
        if (snr === null || snr === undefined) return 2;
        let val = Math.max(-25, Math.min(10, snr));
        return 1 + ((val + 25) / 35) * 5;
    };

    graphData.edges.forEach(edge => {
        const sourceMarker = markers[edge.source];
        const targetMarker = markers[edge.target];
        if (sourceMarker && targetMarker) {
            const points = [sourceMarker.getLatLng(), targetMarker.getLatLng()];
            const polyline = L.polyline(points, { 
                color: getLinkColor(edge.snr), 
                weight: getThickness(edge.snr), 
                opacity: 0.8 
            }).addTo(map);
            polyline.edgeSource = edge.source;
            polyline.edgeTarget = edge.target;

            const sourceNode = graphData.nodes.find(n => n.id === edge.source);
            const targetNode = graphData.nodes.find(n => n.id === edge.target);
            const sourceName = sourceNode ? (sourceNode.long_name || sourceNode.short_name || edge.source) : edge.source;
            const targetName = targetNode ? (targetNode.long_name || targetNode.short_name || edge.target) : edge.target;
            
            const snrText = edge.snr !== null && edge.snr !== undefined ? `${edge.snr.toFixed(1)} dB` : 'Unknown';

            let popupHtml = `<div style="font-family: sans-serif; line-height: 1.4;">`;
            popupHtml += `<h4 style="color: #2196f3; margin: 0 0 8px 0; border-bottom: 1px solid #444; padding-bottom: 4px; font-size: 14px;">Traceroute RF Hop</h4>`;
            popupHtml += `<div style="font-size: 13px;"><b>From:</b> ${escapeHTML(sourceName)}</div>`;
            popupHtml += `<div style="font-size: 13px;"><b>To:</b> ${escapeHTML(targetName)}</div>`;
            popupHtml += `<div style="font-size: 13px;"><b>Avg SNR:</b> <span style="color: ${getLinkColor(edge.snr)}">${snrText}</span></div>`;
            popupHtml += `</div>`;
            
            polyline.bindPopup(popupHtml, { className: 'traceroute-popup' });

            routeLines.push(polyline);
        }
    });
    window.leafletRouteLines = routeLines;

    function animateSinglePacket(points, color = '#ffeb3b') {
        if (points.length < 2) return;
        const icon = L.divIcon({ className: '', iconSize: [16, 16], html: `<div style="width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 8px ${color}, 0 0 16px ${color}, 0 0 24px ${color};z-index:9000;"></div>` }); // ponytail: dynamic color icon
        const dot = L.marker(points[0], { icon: icon }).addTo(map);

        let currentSegment = 0, progress = 0;
        let lastTime = performance.now();

        function step(now) {
            if (currentSegment >= points.length - 1) {
                map.removeLayer(dot);
                return;
            }
            const p1 = points[currentSegment];
            const p2 = points[currentSegment + 1];

            const speedMultiplier = parseFloat(document.getElementById('speed-control').value) || 1;
            const dt = now - lastTime;
            lastTime = now;
            progress += 0.001 * dt * speedMultiplier; // ponytail: time-based progress for precision

            if (progress >= 1) {
                progress = 0; currentSegment++;
            } else {
                dot.setLatLng([p1.lat + (p2.lat - p1.lat) * progress, p1.lng + (p2.lng - p1.lng) * progress]);
            }
            requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    // --- SIDEBAR ---
    const unmappedList = document.getElementById('unmapped-list');
    graphData.unmapped.forEach(id => {
        const node = graphData.nodes.find(n => n.id === id);
        if (!node || node.telemetry.length === 0) return;

        const div = document.createElement('div');
        div.className = 'node-card';
        div.style.cursor = 'pointer';
        div.onclick = () => openNodePanel(node.id);
        div.innerHTML = `<div class="node-name">${escapeHTML(node.long_name || id)}</div>`;

        let details = `<div>Volume: ${node.traffic_volume} pkts</div>`;
        if (node.hw_model) details += `<div>${escapeHTML(node.hw_model)}</div>`;

        const latest = node.telemetry[node.telemetry.length - 1];
        if (latest.battery_level !== undefined) details += `<div>Batt: ${latest.battery_level}%</div>`;
        if (latest.channel_utilization !== undefined) details += `<div>Ch Util: ${latest.channel_utilization.toFixed(1)}%</div>`;

        div.innerHTML += `<div class="node-detail">${details}</div>`;
        unmappedList.appendChild(div);
    });


    // --- D3 FORCE DIRECTED GRAPH ---
    let d3SizeScale = null;
    function initD3Graph() {
        window.d3Initialized = true;

        const width = d3Div.clientWidth;
        const height = d3Div.clientHeight;

        const svg = d3.select("#d3-container").append("svg")
            .attr("width", width)
            .attr("height", height)
            .call(d3.zoom().on("zoom", (event) => {
                g.attr("transform", event.transform);
            }));

        const g = svg.append("g");
        const tooltip = d3.select("#d3-tooltip");

        const connectedNodeIds = new Set();
        graphData.edges.forEach(e => { connectedNodeIds.add(e.source); connectedNodeIds.add(e.target); });

        const d3Nodes = JSON.parse(JSON.stringify(graphData.nodes)).filter(n => n.traffic_volume > 0 || connectedNodeIds.has(n.id)).map(d => Object.create(d));
        d3Nodes.forEach(d => {
            if (d.short_name === 'NXTW') {
                d.fx = width / 2;
                d.fy = height / 2;
            }
        });
        const d3Links = graphData.edges.map(d => Object.create(d));

        const maxVol = d3.max(d3Nodes, d => d.traffic_volume) || 1;
        d3SizeScale = d3.scaleSqrt().domain([0, maxVol]).range([4, 25]);

        const linkColor = (snr) => {
            if (snr > -5) return "#4caf50";
            if (snr > -15) return "#ffc107";
            return "#f44336";
        };

        const thicknessScale = d3.scaleLinear().domain([-25, 10]).range([1, 6]).clamp(true);

        const simulation = d3.forceSimulation(d3Nodes)
            .force("link", d3.forceLink(d3Links).id(d => d.id).distance(80))
            .force("charge", d3.forceManyBody().strength(parseInt(localStorage.getItem('d3_spread') || '-300')))
            .force("center", d3.forceCenter(width / 2, height / 2))
            .force("collide", d3.forceCollide().radius(d => (d.short_name === 'NXTW' ? 20 : 10) + 15));

        window.d3Simulation = simulation;

        const link = g.append("g")
            .selectAll("line")
            .data(d3Links)
            .join("line")
            .attr("stroke", d => linkColor(d.snr))
            .attr("stroke-opacity", 0.8)
            .attr("stroke-width", d => thicknessScale(d.snr));

        // highlightD3Route moved down to access node and labels

        const node = g.append("g")
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .selectAll("circle")
            .data(d3Nodes)
            .join("circle")
            .attr("id", d => 'd3-node-' + d.id.replace(/[^a-zA-Z0-9]/g, ''))
            .attr("r", d => d.short_name === 'NXTW' ? 20 : 10)
            .attr("fill", d => d.id === maxVolNodeId ? "red" : "#2196f3")
            .call(drag(simulation))
            .on("mouseover", (event, d) => {
                tooltip.style("opacity", 1)
                    .html(`<b>${escapeHTML(d.long_name || d.id)}</b><br>Traffic: ${d.traffic_volume} pkts<br><i style="font-size:10px;color:#aaa;">Click for Analytics</i>`)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.style("opacity", 0);
            })
            .on("click", (event, d) => {
                openNodePanel(d.id);
            });

        // Make D3 packet animation accessible globally
        window.triggerD3Packet = function (fromId, toId, color = '#ffff00') {
            if (!fromId || !toId) return;
            const source = d3Nodes.find(n => n.id === fromId);
            const target = d3Nodes.find(n => n.id === toId);
            if (!source || !target) return;

            const tracer = g.append("circle")
                .attr("class", "") // ponytail: drop static class for dynamic colors
                .attr("r", 6)
                .attr("cx", source.x)
                .attr("cy", source.y)
                .attr("fill", "#ffffff")
                .attr("stroke", color)
                .attr("stroke-width", 1)
                .style("filter", `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color}) drop-shadow(0 0 12px ${color})`);

            const speedMultiplier = parseFloat(document.getElementById('speed-control').value) || 1;
            const duration = Math.max(50, 500 / speedMultiplier); // Min 50ms to still be visible

            tracer.transition()
                .duration(duration)
                .ease(d3.easeCubicInOut)
                .attr("cx", target.x)
                .attr("cy", target.y)
                .remove();
        };

        const labels = g.append("g")
            .selectAll("text")
            .data(d3Nodes)
            .join("text")
            .attr("dy", d => -(d.short_name === 'NXTW' ? 20 : 10) - 4)
            .attr("text-anchor", "middle")
            .attr("fill", "#fff")
            .style("font-size", d => d.short_name === 'NXTW' ? "14px" : "10px")
            .style("pointer-events", "none")
            .text(d => d.short_name === 'NXTW' ? "🗼 NXTW" : (d.short_name || d.id.substring(0, 5)));

        window.highlightD3Route = function(path) {
            link.attr("stroke", d => {
                if (!path) return linkColor(d.snr);
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i=0; i<path.length-1; i++) {
                    if ((s === path[i] && t === path[i+1]) || (s === path[i+1] && t === path[i])) return "#00e5ff";
                }
                return linkColor(d.snr);
            }).attr("stroke-width", d => {
                if (!path) return thicknessScale(d.snr);
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i=0; i<path.length-1; i++) {
                    if ((s === path[i] && t === path[i+1]) || (s === path[i+1] && t === path[i])) return 6;
                }
                return thicknessScale(d.snr);
            }).attr("stroke-opacity", d => {
                if (!path) return 0.8;
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i=0; i<path.length-1; i++) {
                    if ((s === path[i] && t === path[i+1]) || (s === path[i+1] && t === path[i])) return 1;
                }
                return 0.1;
            });

            node.attr("opacity", d => (!path || path.includes(d.id)) ? 1 : 0.2);
            labels.attr("opacity", d => (!path || path.includes(d.id)) ? 1 : 0.2);
        };

        simulation.on("tick", () => {
            link.attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            node.attr("cx", d => d.x)
                .attr("cy", d => d.y);

            labels.attr("x", d => d.x)
                .attr("y", d => d.y);
        });

        function drag(simulation) {
            function dragstarted(event) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                event.subject.fx = event.subject.x;
                event.subject.fy = event.subject.y;
            }
            function dragged(event) {
                event.subject.fx = event.x;
                event.subject.fy = event.y;
            }
            function dragended(event) {
                if (!event.active) simulation.alphaTarget(0);
                event.subject.fx = null;
                event.subject.fy = null;
            }
            return d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended);
        }

        window.addEventListener('resize', () => {
            if (d3Div.style.display !== 'none') {
                const newW = d3Div.clientWidth;
                const newH = d3Div.clientHeight;
                svg.attr("width", newW).attr("height", newH);
                simulation.force("center", d3.forceCenter(newW / 2, newH / 2));
                simulation.alpha(0.3).restart();
            }
        });
    }

    // --- TERMINAL TIME LAPSE LOGIC ---
    const termOut = document.getElementById('terminal-output');
    const speedControl = document.getElementById('speed-control');
    let pktIdx = 0;

    function getPacketColor(pkt) {
        const colorByType = localStorage.getItem('color_by_type') === 'true';
        const pktSig = colorByType ? (pkt.port || 'UNKNOWN') : ((pkt.sum || '') + (pkt.port || '') + (pkt.from || '') + (pkt.to || ''));
        let hash = 0;
        for (let i = 0; i < pktSig.length; i++) {
            hash = pktSig.charCodeAt(i) + ((hash << 5) - hash);
        }
        return `hsl(${Math.abs(hash) % 360}, 100%, 65%)`;
    }

    function pulseLeaflet(id, color = '#ffeb3b') {
        if (!id) return;
        const m = markers[id];
        if (m) {
            if (m._path) {
                m._origColor = m._origColor || m.options.color;
                m._origWeight = m._origWeight || m.options.weight;
                m.setStyle({ color: color, weight: 4 });
                clearTimeout(m._pulseTimeout2);
                m._pulseTimeout2 = setTimeout(() => {
                    m.setStyle({ color: m._origColor, weight: m._origWeight });
                    m._origColor = null; m._origWeight = null;
                }, 400);
            } else if (m._icon) {
                m._icon.style.filter = `drop-shadow(0 0 8px ${color}) drop-shadow(0 0 16px ${color})`;
                clearTimeout(m._pulseTimeout);
                m._pulseTimeout = setTimeout(() => {
                    if (m._icon) m._icon.style.filter = '';
                }, 400);
            }
        }
    }

    function pulseD3(id, color = '#ffeb3b') {
        if (!window.d3Initialized || !id) return;
        const safeId = String(id).replace(/[^a-zA-Z0-9]/g, '');
        const circle = d3.select('#d3-node-' + safeId);
        if (!circle.empty()) {
            const d = circle.datum();
            const baseR = (d && d.short_name === 'NXTW') ? 20 : 10;
            circle.transition().duration(100)
                .attr("stroke", color)
                .attr("stroke-width", 4)
                .attr("r", baseR + 5)
                .transition().duration(300)
                .attr("stroke", "#fff")
                .attr("stroke-width", 1.5)
                .attr("r", baseR);
        }
    }

    let currentSimTime = graphData.packetLog && graphData.packetLog.length > 0 ? graphData.packetLog[0].time : Date.parse("2026-06-18T13:27:58Z");
    let lastRealTime = performance.now();

    function tick() {
        const now = performance.now();
        const deltaReal = now - lastRealTime;
        lastRealTime = now;

        if (window.isSimulationPaused) {
            window._tickAnimFrame = requestAnimationFrame(tick);
            return;
        }

        const speedMult = parseFloat(speedControl.value) || 1;
        currentSimTime += deltaReal * speedMult;

        // Fast-forward dead air: max 1000ms simulated wait between packets
        if (pktIdx < graphData.packetLog.length) {
            const nextTime = graphData.packetLog[pktIdx].time;
            if (nextTime - currentSimTime > 1000) {
                currentSimTime = nextTime - 1000;
            }
        }

        const nodeFilterText = document.getElementById('node-filter') ? document.getElementById('node-filter').value.trim().toLowerCase() : '';
        const portFilterVal = document.getElementById('port-filter') ? document.getElementById('port-filter').value.toUpperCase() : '';

        let renderedThisFrame = 0;
        while (pktIdx < graphData.packetLog.length && graphData.packetLog[pktIdx].time <= currentSimTime && renderedThisFrame < 50) {
            try {
                const p = graphData.packetLog[pktIdx];

                let skip = false;
                if (nodeFilterText) {
                    const matchFrom = p.from && p.from.toLowerCase().includes(nodeFilterText);
                    const matchTo = p.to && p.to.toLowerCase().includes(nodeFilterText);
                    const matchSum = p.sum && p.sum.toLowerCase().includes(nodeFilterText);
                    if (!matchFrom && !matchTo && !matchSum) {
                        skip = true;
                    }
                }

                if (!skip && portFilterVal) {
                    const pktPort = (p.port || '').toUpperCase();
                    if (pktPort !== portFilterVal) {
                        skip = true;
                    }
                }

                if (!skip) {
                    renderPacket(p);
                    const pColor = getPacketColor(p);
                    if (p.port === 'POSITION_APP') {
                        if (p.from) pulseLeaflet(p.from, pColor);
                    } else {
                        if (p.from) pulseD3(p.from, pColor);
                    }
                    renderedThisFrame++;
                }
            } catch (e) {
                console.error("Packet processing error in tick", e);
            }
            pktIdx++;
        }

        // If we hit the 50 packet limit, force the simulation time to hold so we don't skip
        if (renderedThisFrame >= 50 && pktIdx < graphData.packetLog.length) {
            currentSimTime = graphData.packetLog[pktIdx].time;
        }

        window._tickAnimFrame = requestAnimationFrame(tick);
    }

    function renderPacket(pkt) {
        const node = graphData.nodes.find(n => n.id === pkt.from);
        const displayName = node ? (node.long_name || node.short_name || pkt.from) : pkt.from;

        const d = new Date(pkt.time);
        const hh = d.getHours().toString().padStart(2, '0');
        const mm = d.getMinutes().toString().padStart(2, '0');
        const ss = d.getSeconds().toString().padStart(2, '0');
        const ms = d.getMilliseconds().toString().padStart(3, '0');
        const timeStr = `[${hh}:${mm}:${ss}.${ms}]`;
        
        const pktColor = getPacketColor(pkt);

        const div = document.createElement('div');
        div.className = 'term-line';
        
        // ponytail: inject dynamic colors for the :last-child highlight
        div.style.setProperty('--term-border', pktColor);
        div.style.setProperty('--term-bg', pktColor.replace('hsl', 'hsla').replace(')', ', 0.15)'));
        div.dataset.port = (pkt.port || '').toUpperCase();
        div.dataset.from = (pkt.from || '').toLowerCase();
        div.dataset.to = (pkt.to || '').toLowerCase();
        div.dataset.sum = (pkt.sum || '').toLowerCase();
        div.innerHTML = `<span style="color:${pktColor}; margin-right:6px; font-size:14px;">●</span><span style="color: #888; margin-right: 8px;">${timeStr}</span><span class="term-port">[${escapeHTML(pkt.port)}]</span><span class="term-from">FROM: ${escapeHTML(displayName)}</span><span class="term-sum">${escapeHTML(pkt.sum)}</span>`;

        div.onclick = () => {
            document.getElementById('dpi-modal').style.display = 'flex';
            document.getElementById('dpi-payload').textContent = JSON.stringify(pkt, null, 2);
        };

        termOut.appendChild(div);

        while (termOut.children.length > 200) {
            termOut.removeChild(termOut.firstChild);
        }
        termOut.scrollTop = termOut.scrollHeight;

        pulseLeaflet(pkt.from, pktColor);
        pulseD3(pkt.from, pktColor);

        if (pkt.hops && pkt.hops.length > 1) {
            const points = [];
            pkt.hops.forEach((hop, i) => {
                const n = markers[hop.id];
                if (n) points.push(n.getLatLng());
                if (i < pkt.hops.length - 1 && window.triggerD3Packet) {
                    window.triggerD3Packet(pkt.hops[i].id, pkt.hops[i + 1].id, pktColor);
                }
            });
            if (points.length > 1) {
                animateSinglePacket(points, pktColor);
                L.polyline(points, { color: pktColor, weight: 2, opacity: 0.6, dashArray: '5, 10' }).addTo(map); // ponytail: draw the line, no need to track it
            }
        } else if (pkt.to && pkt.to !== "!-1" && pkt.to !== "!ffffffff" && pkt.to !== pkt.from) {
            const p1 = markers[pkt.from];
            const p2 = markers[pkt.to];
            if (p1 && p2) animateSinglePacket([p1.getLatLng(), p2.getLatLng()], pktColor);
            if (window.triggerD3Packet) {
                window.triggerD3Packet(pkt.from, pkt.to, pktColor);
            }
        }
    }

    // Apply filters retroactively to existing lines
    function applyTerminalFilters() {
        const nodeFilterText = document.getElementById('node-filter') ? document.getElementById('node-filter').value.trim().toLowerCase() : '';
        const portFilterVal = document.getElementById('port-filter') ? document.getElementById('port-filter').value.toUpperCase() : '';

        const lines = document.querySelectorAll('#terminal-output .term-line');
        lines.forEach(line => {
            let skip = false;

            if (nodeFilterText) {
                const matchFrom = line.dataset.from.includes(nodeFilterText);
                const matchTo = line.dataset.to.includes(nodeFilterText);
                const matchSum = line.dataset.sum.includes(nodeFilterText);
                if (!matchFrom && !matchTo && !matchSum) {
                    skip = true;
                }
            }

            if (!skip && portFilterVal) {
                if (line.dataset.port !== portFilterVal) {
                    skip = true;
                }
            }

            line.style.display = skip ? 'none' : 'block';
        });
    }

    const nf = document.getElementById('node-filter');
    if (nf) nf.oninput = applyTerminalFilters;
    const pf = document.getElementById('port-filter');
    if (pf) pf.onchange = applyTerminalFilters;

    document.getElementById('close-modal').onclick = () => {
        document.getElementById('dpi-modal').style.display = 'none';
    };

    // ponytail: one-click copy for json payloads
    document.getElementById('copy-dpi-btn').onclick = async (e) => {
        const payload = document.getElementById('dpi-payload').innerText;
        await navigator.clipboard.writeText(payload);
        const btn = e.target;
        btn.innerText = 'Copied!';
        setTimeout(() => btn.innerText = 'Copy', 2000);
    };

    // ponytail: one-click clear terminal
    document.getElementById('clear-term-btn').onclick = () => {
        document.getElementById('terminal-output').innerHTML = '';
    };

    // ponytail: pause simulation
    window.isSimulationPaused = false;
    document.getElementById('pause-sim-btn').onclick = (e) => {
        window.isSimulationPaused = !window.isSimulationPaused;
        const btn = e.target;
        if (window.isSimulationPaused) {
            btn.innerText = 'Resume';
            btn.style.background = '#ff9800';
            btn.style.borderColor = '#ff9800';
        } else {
            btn.innerText = 'Pause';
            btn.style.background = '#333';
            btn.style.borderColor = '#555';
        }
    };

    // ponytail: global escape key to close all modals and panels
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const dpi = document.getElementById('dpi-modal');
            if (dpi) dpi.style.display = 'none';
            const panel = document.getElementById('node-analytics-panel');
            if (panel) panel.classList.remove('open');
            document.body.classList.remove('panel-open');
        }
    });

    window._tickAnimFrame = requestAnimationFrame(tick);

    // Process deep link hash if present
    if (window.location.hash && window.location.hash.startsWith('#node=')) {
        const targetId = decodeURIComponent(window.location.hash.substring(6));
        const node = graphData.nodes.find(n => n.id === targetId);
        if (node) {
            openNodePanel(targetId);
            pulseD3(targetId);
            pulseLeaflet(targetId);
            if (node.lat !== undefined && node.lon !== undefined) {
                if (!btnNet.classList.contains('active')) {
                    btnMap.click();
                    setTimeout(() => map.setView([node.lat, node.lon], 16, { animate: false }), 200);
                } else {
                    map.setView([node.lat, node.lon], 16, { animate: false });
                }
            }
        }
    }

    // Remove loading screen gracefully
    setTimeout(() => {
        const loader = document.getElementById('loading-screen');
        const restoreMainContent = () => {
            const mainContent = document.getElementById('main-content');
            if (mainContent) {
                mainContent.style.opacity = '1';
                mainContent.style.pointerEvents = 'auto';
            }
        };

        if (loader) {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.style.display = 'none';
                disposeThreeBg();
                restoreMainContent();
                initTutorial();
            }, 800);
        } else {
            restoreMainContent();
            initTutorial();
        }
    }, 800);
    function runGlobalTour() {
        if (!window.driver) return;
        const steps = [
            { popover: { title: 'Welcome to Mesh Log Mapper', description: 'Let\'s take a quick tour to learn how to analyze your mesh network.', side: "center", align: 'start' } },
            { popover: { title: 'Offline Mode (PWA)', description: 'Take this app off-grid! Tap "Add to Home Screen" on your phone, or the install icon in your browser address bar to use this completely offline.', side: "center", align: 'start' } },
            { element: '#btn-upload', popover: { title: 'Custom Logs & Shareable Links', description: 'Click here to upload your own logs! It will parse locally and instantly copy a unique short-link to your clipboard so you can share your map.', side: "bottom", align: 'start' } },
            { element: '#speed-control', popover: { title: 'Playback Speed', description: 'Control the simulation timeline playback. Speed it up to blast through logs.', side: "top", align: 'start' } },
            { element: '#terminal-container', popover: { title: 'Live Terminal & DPI', description: 'Watch live packets. <b>Click</b> any log line to open the Deep Packet Inspection modal to inspect raw JSON payloads.', side: "top", align: 'start' } },
            { element: '#view-controls', popover: { title: 'Views', description: 'Switch tabs to explore different visualizations. Each tab has its own mini-tutorial! Go ahead and click one.', side: "bottom", align: 'start' } }
        ];

        if (window.innerWidth <= 768) {
            steps.push({ element: '#nav-toggle', popover: { title: 'Expand/Collapse', description: 'Use this arrow to toggle the navigation bar and save screen space.', side: "left", align: 'center' } });
            steps.push({ element: '#terminal-toggle', popover: { title: 'Terminal Toggle', description: 'Use this arrow to expand or hide the live packet terminal at the bottom.', side: "left", align: 'center' } });
            const vc = document.getElementById('view-controls');
            if (vc) vc.classList.remove('collapsed');
            const nt = document.getElementById('nav-toggle');
            if (nt) nt.textContent = '×';
        }

        const tour = window.driver.js.driver({
            showProgress: true,
            steps: steps,
            onDestroyStarted: () => {
                tour.destroy();
                if (window.innerWidth <= 768) {
                    const vc = document.getElementById('view-controls');
                    const nt = document.getElementById('nav-toggle');
                    if (vc && !vc.classList.contains('collapsed')) {
                        vc.classList.add('collapsed');
                        if (nt) nt.textContent = '☰';
                    }
                    const tc = document.getElementById('terminal-container');
                    const tt = document.getElementById('terminal-toggle');
                    if (tc && !tc.classList.contains('collapsed')) {
                        tc.classList.add('collapsed');
                        if (tt) tt.textContent = '▴';
                    }
                    setTimeout(() => { 
                        if (window.leafletMap) window.leafletMap.invalidateSize(); 
                        window.dispatchEvent(new Event('resize'));
                    }, 350);
                }

                // Chain directly into Map Tour if the user is still on the map tab
                const btnMap = document.getElementById('btn-map');
                if (btnMap && btnMap.classList.contains('active')) {
                    if (window.runMapTour && !localStorage.getItem('tour_map_seen')) {
                        setTimeout(() => window.runMapTour(), 200);
                    }
                }
            }
        });
        localStorage.setItem('tour_global_seen', 'true');
        tour.drive();
    }

    function createTour(storageKey, steps, onEnd) {
        if (!window.driver) return;
        if (window.innerWidth <= 768) {
            const vc = document.getElementById('view-controls');
            if (vc) vc.classList.remove('collapsed');
            const nt = document.getElementById('nav-toggle');
            if (nt) nt.textContent = '×';
        }
        const tour = window.driver.js.driver({
            steps: steps,
            onDestroyStarted: () => {
                tour.destroy();
                if (window.innerWidth <= 768) {
                    const vc = document.getElementById('view-controls');
                    if (vc) vc.classList.add('collapsed');
                    const nt = document.getElementById('nav-toggle');
                    if (nt) nt.textContent = '☰';
                }
                if (onEnd) onEnd();
            }
        });
        localStorage.setItem(storageKey, 'true');
        tour.drive();
    }

    window.runMapTour = function () {
        createTour('tour_map_seen', [
            { element: '#btn-map', popover: { title: 'Geo Map', description: 'Shows nodes with GPS coordinates. Watch yellow tracer projectiles fly between nodes.', side: "bottom", align: 'start' } },
            { popover: { title: 'Node Analytics', description: 'Click any blue node on the Map to slide open its Analytics panel for hardware details and telemetry.', side: "center", align: 'start' } },
            { popover: { title: 'Traceroute Connections', description: 'Click on any of the colored connection lines between nodes to see detailed RF Hop statistics (like Avg SNR).', side: "center", align: 'start' } },
            { popover: { title: 'Path Discovery', description: 'Click on one node, then click on another node to discover the routing path between them. The path will be highlighted in cyan.', side: "center", align: 'start' } }
        ]);
    };

    window.runNetTour = function () {
        createTour('tour_net_seen', [
            { element: '#btn-net', popover: { title: 'Logical Network', description: 'Physics-based graph where nodes are pulled together by signal strength. Green lines = Excellent SNR, Red = Poor SNR. Node size = Traffic Volume.', side: "bottom", align: 'start' } },
            { popover: { title: 'Path Discovery', description: 'Click on one node, then click on another node to discover the routing path between them. The path will be highlighted in cyan.', side: "center", align: 'start' } }
        ]);
    };

    window.runUnmappedTour = function () {
        createTour('tour_unmapped_seen', [
            { element: '#btn-sidebar', popover: { title: 'Unmapped Nodes', description: 'List of active nodes on the network that haven\'t acquired a GPS fix yet, along with the Network Legend.', side: "bottom", align: 'start' } }
        ]);
    };

    function initTutorial() {
        document.getElementById('btn-tutorial').onclick = () => {
            localStorage.removeItem('tour_global_seen');
            localStorage.removeItem('tour_map_seen');
            localStorage.removeItem('tour_net_seen');
            localStorage.removeItem('tour_unmapped_seen');
            runGlobalTour();
        };

        if (!localStorage.getItem('tour_global_seen')) {
            setTimeout(() => runGlobalTour(), 500);
        }
    }

} // End initializeDashboard