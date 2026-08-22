/*
Copyright (c) 2026 CardoSystems

# PolyForm Noncommercial License 1.0.0

<https://polyformproject.org/licenses/noncommercial/1.0.0>
*/
import { registerSW } from 'virtual:pwa-register';
import { initThreeBg, disposeThreeBg } from './src/three-bg.js';
// ponytail: native vite worker handling
import ParserWorker from './parser.worker.js?worker';
import { Preferences } from '@capacitor/preferences';

window.updatePending = false;
const updateSW = registerSW({
    onNeedRefresh() {
        console.log("New version detected.");
        window.updatePending = true;
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
            let q = indexedDB.open('m_db', 1);
            q.onupgradeneeded = () => { try { q.result.createObjectStore('kv') } catch (e) { } };
            q.onsuccess = () => r(q.result);
            q.onerror = q.onblocked = () => r(null);
        } catch (e) { r(null); }
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
    set: (k, v) => Promise.race([
        new Promise(r => setTimeout(() => r(null), 1500)),
        (async () => {
            try {
                const db = await idb.open();
                if (!db) return null;
                return await new Promise(r => {
                    let req = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
                    req.onsuccess = req.onerror = () => r(true);
                });
            } catch (e) { return null; }
        })()
    ])
};
const escapeHTML = str => String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

let lastDeletedMap = null;
let undoToastTimeout = null;

window.deleteRecentMap = async (id, name, event) => {
    if (event) event.stopPropagation();
    
    // Warning confirmation
    const mapLabel = name || id;
    if (!window.confirm(`Delete "${mapLabel}" from My Maps?\n\nThis only removes your local saved link and cached data.`)) {
        return;
    }

    let recent = JSON.parse(localStorage.getItem('recentMaps') || '[]');
    recent = recent.map(r => typeof r === 'string' ? { id: r, name: r } : r);
    
    const index = recent.findIndex(r => r.id === id);
    if (index === -1) return;

    const removedItem = recent[index];
    const cachedData = await idb.get(`history_${id}`);

    // Remove locally
    recent.splice(index, 1);
    localStorage.setItem('recentMaps', JSON.stringify(recent));
    Preferences.set({ key: 'recentMaps', value: JSON.stringify(recent) });
    await idb.set(`history_${id}`, null);

    // Save for undo
    lastDeletedMap = { item: removedItem, index, data: cachedData };

    renderRecentMaps(recent);
    showUndoToast(removedItem.name || removedItem.id);
};

window.undoDeleteMap = async () => {
    if (!lastDeletedMap) return;

    const { item, index, data } = lastDeletedMap;
    lastDeletedMap = null;

    let recent = JSON.parse(localStorage.getItem('recentMaps') || '[]');
    recent = recent.map(r => typeof r === 'string' ? { id: r, name: r } : r);

    // Re-insert at original index
    recent.splice(Math.min(index, recent.length), 0, item);
    localStorage.setItem('recentMaps', JSON.stringify(recent));
    Preferences.set({ key: 'recentMaps', value: JSON.stringify(recent) });

    if (data) {
        await idb.set(`history_${item.id}`, data);
    }

    renderRecentMaps(recent);
    hideUndoToast();
};

function showUndoToast(mapName) {
    let toast = document.getElementById('map-undo-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'map-undo-toast';
        toast.className = 'map-undo-toast';
        document.body.appendChild(toast);
    }

    toast.innerHTML = `
        <span>Deleted <strong>${escapeHTML(mapName)}</strong></span>
        <button onclick="window.undoDeleteMap()">Undo ↩</button>
    `;

    toast.classList.add('show');

    if (undoToastTimeout) clearTimeout(undoToastTimeout);
    undoToastTimeout = setTimeout(() => hideUndoToast(), 5000);
}

function hideUndoToast() {
    const toast = document.getElementById('map-undo-toast');
    if (toast) toast.classList.remove('show');
    if (undoToastTimeout) clearTimeout(undoToastTimeout);
}

const renderRecentMaps = (recent) => {
    if (!recent || recent.length === 0) {
        const emptyHtml = `<span style="color:#666;font-size:12px;">No cached maps yet.</span>`;
        ['recent-maps', 'landing-recent-maps'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = emptyHtml;
        });
        return;
    }

    const top5 = recent.slice(0, 5);
    const others = recent.slice(5);

    const top5Chips = top5.map(r => `
        <span class="recent-map-chip-wrapper">
            <a href="javascript:void(0)" onclick="window.loadMap('${r.id}')" class="recent-map-chip" title="${r.id}">
                ${escapeHTML(r.name || r.id)}
            </a>
            <button type="button" class="recent-map-del-btn" title="Delete map" onclick="window.deleteRecentMap('${r.id}', '${escapeHTML(r.name || r.id)}', event)">✕</button>
        </span>
    `).join('');

    let othersHtml = '';
    if (others.length > 0) {
        const othersItems = others.map(r => `
            <div class="recent-map-dropdown-row">
                <a href="javascript:void(0)" onclick="window.loadMap('${r.id}')" class="recent-map-dropdown-item" title="${r.id}">${escapeHTML(r.name || r.id)}</a>
                <button type="button" class="recent-map-del-btn dropdown-del" title="Delete map" onclick="window.deleteRecentMap('${r.id}', '${escapeHTML(r.name || r.id)}', event)">✕</button>
            </div>
        `).join('');

        othersHtml = `
            <div class="recent-maps-others-container">
                <button type="button" class="recent-maps-others-btn" onclick="this.nextElementSibling.classList.toggle('open'); this.classList.toggle('active');">
                    Others (${others.length}) ▾
                </button>
                <div class="recent-maps-dropdown">
                    ${othersItems}
                </div>
            </div>
        `;
    }

    const containerHtml = `<div class="recent-maps-top5">${top5Chips}</div>${othersHtml}`;

    ['recent-maps', 'landing-recent-maps'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = containerHtml;
    });
};

window.goHome = async () => {
    await idb.set('autoSave', null);
    window.location.href = window.location.pathname;
};

// ponytail: unified share URL builder and clipboard fallback
window.copyShareLink = (hash = '', onSuccess) => {
    const base = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1') || window.location.origin.includes('capacitor')) ? 'https://meshlog.camal.eu' : window.location.origin;
    let search = window.location.search;
    if (!search && typeof graphData !== 'undefined' && graphData?.shareId) search = '?map=' + graphData.shareId;
    if (typeof graphData !== 'undefined' && graphData?.customMapName && !search.includes('&name=')) search += '&name=' + encodeURIComponent(graphData.customMapName);
    const text = base + window.location.pathname + search + hash;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(onSuccess).catch(() => { });
    } else {
        const input = document.createElement('textarea');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        try { document.execCommand('copy'); onSuccess?.(); } catch (e) { }
        document.body.removeChild(input);
    }
};

function setupShareButton() {
    const shareBtn = document.getElementById('btn-share');
    if (!shareBtn) return;
    shareBtn.style.display = '';
    shareBtn.onclick = () => {
        window.copyShareLink('', () => {
            const old = shareBtn.innerText;
            shareBtn.innerText = '✅ Copied!';
            setTimeout(() => shareBtn.innerText = old, 2000);
        });
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
        let wid;
        const cleanup = (res) => {
            if (done) return;
            done = true;
            clearTimeout(to);
            try { window.turnstile.remove(wid); } catch (e) { }
            resolve(res);
        };
        const to = setTimeout(() => cleanup(null), 60000);

        try {
            wid = window.turnstile.render('#cf-turnstile-widget', {
                sitekey: '0x4AAAAAADoa_6pJqFVy3kJU',
                action: 'turnstile-spin-v1',
                callback: token => cleanup(token),
                'error-callback': () => cleanup(null),
                'timeout-callback': () => cleanup(null)
            });
        } catch (e) {
            cleanup(null);
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
    } catch (err) { }
};
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});
requestWakeLock();

window.addEventListener('load', async () => {
    // ponytail: restore robust settings from Native Preferences to survive iOS/Android localstorage wiping
    try {
        const { value: prefSettingsStr } = await Preferences.get({ key: 'app_settings' });
        if (prefSettingsStr) {
            const savedSettings = JSON.parse(prefSettingsStr);
            Object.entries(savedSettings).forEach(([k, v]) => v !== null && localStorage.setItem(k, v));
        }
        const { value: robustRecent } = await Preferences.get({ key: 'recentMaps' });
        if (robustRecent) localStorage.setItem('recentMaps', robustRecent);
    } catch (e) { }

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
    let sharedText = urlParams.get('text');

    const ingestFile = (file) => {
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('log-file-input');
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
    };

    if (sharedText) {
        ingestFile(new File([sharedText], "shared_log.txt", { type: "text/plain" }));
    }

    if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
            if (launchParams.files && launchParams.files.length > 0) {
                const file = await launchParams.files[0].getFile();
                ingestFile(file);
            }
        });
    }

    window.loadMap = function (id) {
        window.history.pushState({}, '', '?map=' + id);
        document.getElementById('file-picker-container').style.display = 'none';
        document.getElementById('loading-spinner-container').style.display = 'flex';
        document.getElementById('loading-text').innerText = "DOWNLOADING SHARED MAP...";
        worker.postMessage({ cmd: 'start', id: id, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin) });
    };

    // ponytail: memory logic
    let recent = JSON.parse(localStorage.getItem('recentMaps') || '[]');
    recent = recent.map(r => typeof r === 'string' ? { id: r, name: r } : r);
    if (mapId && !recent.some(r => r.id === mapId)) {
        recent = [{ id: mapId, name: mapId }, ...recent.filter(r => r.id !== mapId)];
        localStorage.setItem('recentMaps', JSON.stringify(recent));
        Preferences.set({ key: 'recentMaps', value: JSON.stringify(recent) });
    }
    renderRecentMaps(recent);

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
                if (data.shareId) window.history.replaceState({}, '', '?map=' + data.shareId + (data.customMapName ? '&name=' + encodeURIComponent(data.customMapName) : ''));
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

    // ponytail: tile prefetcher nuked - relying on native browser / service worker cache on render

    // If loaded via a shared ?map= URL, the current URL is already shareable
    if (mapId) {
        setupShareButton();
    }

    worker.onmessage = function (e) {
        if (e.data.type === 'DONE') {
            if (!e.data.isDuplicate && e.data.graphData && !e.data.graphData.customMapName) {
                const customMapName = prompt("Name this map:", "My Meshlog Map") || "My Meshlog Map";
                e.data.graphData.customMapName = customMapName;
            }
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
            window.history.replaceState({}, '', '?map=' + e.data.shareId + (typeof graphData !== 'undefined' && graphData?.customMapName ? '&name=' + encodeURIComponent(graphData.customMapName) : ''));
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
        worker.postMessage({ cmd: 'parse_file', file: file, customName: null, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
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
        worker.postMessage({ cmd: 'parse_file', file: file, customName: null, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
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

    // ponytail: global settings modal handler (landing screen + dashboard)
    const openSettings = () => {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        const tours = document.getElementById('setting-disable-tours');
        const spread = document.getElementById('setting-d3-spread');
        if (tours) tours.checked = localStorage.getItem('disable_tours') === 'true';
        if (spread) spread.value = localStorage.getItem('d3_spread') || '-1000';
        modal.showModal();
    };
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btn-settings, #btn-landing-settings')) openSettings();
    });

    const btnSettingsClose = document.getElementById('btn-settings-close');
    if (btnSettingsClose) {
        btnSettingsClose.addEventListener('click', () => {
            const tours = document.getElementById('setting-disable-tours');
            const spread = document.getElementById('setting-d3-spread');
            if (tours) localStorage.setItem('disable_tours', tours.checked ? 'true' : 'false');
            if (spread) localStorage.setItem('d3_spread', spread.value);
            const modal = document.getElementById('settings-modal');
            if (modal) modal.close();
        });
    }
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

    if (graphData.shareId && graphData.customMapName) {
        let recent = JSON.parse(localStorage.getItem('recentMaps') || '[]');
        recent = recent.map(r => typeof r === 'string' ? { id: r, name: r } : r);
        let updated = false;
        const mapEntry = recent.find(r => r.id === graphData.shareId);
        if (mapEntry && mapEntry.name !== graphData.customMapName) {
            mapEntry.name = graphData.customMapName;
            updated = true;
        } else if (!mapEntry) {
            recent = [{ id: graphData.shareId, name: graphData.customMapName }, ...recent.filter(r => r.id !== graphData.shareId)];
            updated = true;
        }
        if (updated) {
            localStorage.setItem('recentMaps', JSON.stringify(recent));
            Preferences.set({ key: 'recentMaps', value: JSON.stringify(recent) });
            renderRecentMaps(recent);
        }
    }

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
            worker.postMessage({ cmd: 'parse_file', file: file, customName: null, origin: (window.location.hostname === 'localhost' ? 'https://meshlog.camal.eu' : window.location.origin), turnstileToken: token });
        };
    }

    // --- VIEW TOGGLE LOGIC ---
    const btnMap = document.getElementById('btn-map');
    const btnNet = document.getElementById('btn-net');
    const btnLongestLinks = document.getElementById('btn-longest-links');
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

    btnLongestLinks.onclick = () => {
        localStorage.setItem('active_tab', 'sidebar');
        btnLongestLinks.classList.add('active'); btnMap.classList.remove('active'); btnNet.classList.remove('active');
        mapDiv.style.display = 'none'; d3Div.style.display = 'none';
        sidebarDiv.style.display = 'flex';
    };

    btnMap.onclick = () => {
        localStorage.setItem('active_tab', 'map');
        btnMap.classList.add('active'); btnNet.classList.remove('active'); btnLongestLinks.classList.remove('active');
        mapDiv.style.display = 'block'; d3Div.style.display = 'none';
        sidebarDiv.style.display = 'none';
        setTimeout(() => map.invalidateSize(), 100);
        if (window.runMapTour && !localStorage.getItem('tour_map_seen') && localStorage.getItem('tour_global_seen') && localStorage.getItem('disable_tours') !== 'true') {
            setTimeout(() => window.runMapTour(), 200);
        }
    };

    btnNet.onclick = () => {
        localStorage.setItem('active_tab', 'net');
        btnNet.classList.add('active'); btnMap.classList.remove('active'); btnLongestLinks.classList.remove('active');
        mapDiv.style.display = 'none'; d3Div.style.display = 'block';
        sidebarDiv.style.display = 'none';
        if (window.runNetTour && !localStorage.getItem('tour_net_seen') && localStorage.getItem('disable_tours') !== 'true') {
            setTimeout(() => window.runNetTour(), 200);
        }
        if (!window.d3Initialized) initD3Graph();
    };

    // ponytail: restore tab state
    const activeTab = localStorage.getItem('active_tab');
    if (activeTab === 'net') btnNet.click();
    else if (activeTab === 'sidebar') btnLongestLinks.click();


    // Resize listener for responsive terminal header
    const mobileSearchInput = document.getElementById('node-filter');
    if (mobileSearchInput) {
        const updateNF = () => { mobileSearchInput.placeholder = window.innerWidth <= 768 ? "🔍 Node" : "Search Node ID..."; };
        window.addEventListener('resize', updateNF);
        updateNF();
    }

    const settingD3Spread = document.getElementById('setting-d3-spread');
    const btnResetSpread = document.getElementById('btn-reset-spread');

    if (settingD3Spread) {
        settingD3Spread.value = localStorage.getItem('d3_spread') || '-300';
        settingD3Spread.addEventListener('input', (e) => {
            const val = e.target.value;
            localStorage.setItem('d3_spread', val);
            if (window.d3Simulation) {
                window.d3Simulation.force("charge").strength(parseInt(val));
                window.d3Simulation.alpha(0.3).restart();
            }
        });
    }

    if (btnResetSpread && settingD3Spread) {
        btnResetSpread.addEventListener('click', () => {
            settingD3Spread.value = '-1000';
            localStorage.setItem('d3_spread', '-1000');
            if (window.d3Simulation) {
                window.d3Simulation.force("charge").strength(-1000);
                window.d3Simulation.alpha(1).restart();
            }
        });
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
    const lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { attribution: '&copy; CartoDB', maxZoom: 19 });
    const satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });
    const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 });
    const topoTiles = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap', maxZoom: 17 });
    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 });

    const baseMaps = {
        "Carto Dark": darkTiles,
        "Carto Light": lightTiles,
        "OpenStreetMap (Offline Cache)": osmTiles,
        "Open TOPO": topoTiles,
        "ESRI World TOPO": esriTopo,
        "ESRI Satellite": satTiles
    };

    const savedLayerName = localStorage.getItem('selectedMapLayer') || "Carto Dark";
    const defaultLayer = baseMaps[savedLayerName] || darkTiles;

    // ponytail: default center on Continental Portugal [39.5, -8.0] at zoom 7 if unset/overzoomed
    const portugalCenter = [39.5, -8.0];
    const savedLat = localStorage.getItem('map_lat');
    const savedLng = localStorage.getItem('map_lng');
    const savedZoom = localStorage.getItem('map_zoom');
    const center = (savedLat && savedLng && Math.abs(parseFloat(savedLat)) > 0.01) ? [parseFloat(savedLat), parseFloat(savedLng)] : portugalCenter;
    let zoom = savedZoom ? Math.min(parseInt(savedZoom, 10), 12) : 7;
    if (!savedLat || !savedLng) zoom = 7;
    const map = L.map('map', { layers: [defaultLayer], zoomControl: false }).setView(center, zoom);

    map.on('moveend', () => {
        const c = map.getCenter();
        localStorage.setItem('map_lat', c.lat);
        localStorage.setItem('map_lng', c.lng);
        localStorage.setItem('map_zoom', map.getZoom());
    });
    window.leafletMap = map;

    map.on('baselayerchange', function (e) {
        localStorage.setItem('selectedMapLayer', e.name);
    });

    // ponytail: bg click clears path
    map.on('click', () => {
        if (window.lastClickedNodeId) {
            window.lastClickedNodeId = null;
            highlightPath(null, null);
        }
    });

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

    let nodeTelemetryChart = null;

    function renderChartJS(telemetry) {
        const ctx = document.getElementById('telemetry-chart');
        if (!ctx) return;

        if (nodeTelemetryChart) {
            nodeTelemetryChart.destroy();
        }

        if (!telemetry || telemetry.length === 0) return;

        const labels = telemetry.map(t => new Date(t.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        const battData = telemetry.map(t => t.battery_level);
        const utilData = telemetry.map(t => t.channel_utilization);

        nodeTelemetryChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Battery %',
                        data: battData,
                        borderColor: '#4caf50',
                        backgroundColor: 'rgba(76, 175, 80, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 5
                    },
                    {
                        label: 'Ch Util %',
                        data: utilData,
                        borderColor: '#ff9800',
                        backgroundColor: 'rgba(255, 152, 0, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#ccc', boxWidth: 12 } }
                },
                scales: {
                    x: { ticks: { color: '#888', maxTicksLimit: 6 }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true }
                }
            }
        });
    }

    const markers = {};
    const latLngs = [];

    function openNodePanel(nodeId) {
        const node = graphData.nodes.find(n => n.id === nodeId);
        if (!node) return;

        if (window.location.hash !== `#node=${node.id}`) {
            window.history.replaceState(null, '', `#node=${node.id}`);
        }

        if (window.innerWidth > 768 || !window.lastClickedNodeId) {
            document.getElementById('node-analytics-panel').classList.add('open');
            document.body.classList.add('panel-open');
        }
        setTimeout(() => { if (map) map.invalidateSize(); }, 300);

        document.getElementById('panel-node-name').innerText = node.long_name || node.short_name || node.id;
        document.getElementById('panel-node-id').innerText = node.id;
        const tType = node.is_gateway ? 'GW' : (node.transport_type || (node.via_mqtt ? 'MQTT' : 'RF'));
        const badgeText = tType === 'GW' ? ' (GW 🌐)' : (tType === 'HYBRID' ? ' (RF + MQTT 🌐📻)' : (tType === 'MQTT' ? ' (MQTT 🌐)' : ' (RF 📻)'));
        document.getElementById('panel-hw-model').innerText = (node.hw_model || '-') + badgeText;
        document.getElementById('panel-traffic').innerText = node.traffic_volume || 0;

        const statusBadge = document.getElementById('panel-node-status');
        if (node.telemetry && node.telemetry.length > 0) {
            const lastSeen = node.telemetry[node.telemetry.length - 1].time;
            const now = Date.now() / 1000;
            if (now - lastSeen < 3600) {
                statusBadge.className = 'badge bg-success';
                statusBadge.innerText = 'Online';
            } else {
                statusBadge.className = 'badge bg-secondary';
                statusBadge.innerText = 'Offline';
            }
        } else {
            statusBadge.className = 'badge bg-secondary';
            statusBadge.innerText = 'Unknown';
        }

        // Render Chart.js
        if (node.telemetry && node.telemetry.length > 0) {
            renderChartJS(node.telemetry);
        } else {
            if (nodeTelemetryChart) {
                nodeTelemetryChart.destroy();
                nodeTelemetryChart = null;
            }
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
            if (!adj[s]) adj[s] = []; if (!adj[t]) adj[t] = [];
            adj[s].push(t); adj[t].push(s);
        });
        const q = [[src]]; const visited = new Set([src]);
        let path = null;
        while (q.length > 0) {
            const p = q.shift(); const curr = p[p.length - 1];
            if (curr === dst) { path = p; break; }
            for (const n of (adj[curr] || [])) {
                if (!visited.has(n)) { visited.add(n); q.push([...p, n]); }
            }
        }

        if (window.leafletRouteGroup) { window.leafletMap.removeLayer(window.leafletRouteGroup); }
        if (window.highlightD3Route) window.highlightD3Route(path);

        if (!path) return;

        const latlngs = [];
        let valid = true;
        for (let i = 0; i < path.length; i++) {
            const n = graphData.nodes.find(node => node.id === path[i]);
            if (n && n.lat !== undefined && n.lon !== undefined) latlngs.push([n.lat, n.lon]);
            else valid = false;
        }
        if (valid && latlngs.length > 1) {
            window.leafletRouteGroup = L.polyline(latlngs, { color: '#00e5ff', weight: 6, opacity: 0.8 }).addTo(window.leafletMap);
        }

        // ponytail: skip dimming geo map markers on route
        if (window.leafletRouteLines) {
            window.leafletRouteLines.forEach(line => {
                if (!path) {
                    line.setStyle({ opacity: 0.8 });
                    return;
                }
                const s = line.edgeSource; const t = line.edgeTarget;
                let inPath = false;
                for (let i = 0; i < path.length - 1; i++) {
                    if ((s === path[i] && t === path[i + 1]) || (s === path[i + 1] && t === path[i])) inPath = true;
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

    const markerCluster = L.markerClusterGroup();
    window.precisionCircles = {};

    // Draw Malla-style link health lines (dashed) on Leaflet Map
    if (window.geoEdgesLayerGroup) {
        map.removeLayer(window.geoEdgesLayerGroup);
    }
    window.geoEdgesLayerGroup = L.layerGroup().addTo(map);

    const getLinkColor = (snr) => {
        if (snr === null || snr === undefined) return "#00bcd4";
        if (snr > -5) return "#4caf50";
        if (snr > -15) return "#ffc107";
        return "#f44336";
    };

    if (graphData.edges && Array.isArray(graphData.edges)) {
        const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]));
        graphData.edges.forEach(edge => {
            const src = nodeMap.get(edge.source);
            const tgt = nodeMap.get(edge.target);
            if (src && tgt && src.lat !== undefined && src.lon !== undefined && tgt.lat !== undefined && tgt.lon !== undefined) {
                L.polyline([[src.lat, src.lon], [tgt.lat, tgt.lon]], {
                    color: getLinkColor(edge.snr),
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '5, 10'
                }).addTo(window.geoEdgesLayerGroup);
            }
        });
    }

    graphData.nodes.forEach(node => {
        if (node.lat !== undefined && node.lon !== undefined) {
            const shortText = node.short_name ? node.short_name.substring(0, 4) : node.id.substring(node.id.length - 4);
            const isSrc = node.id === maxVolNodeId;
            const role = (node.role || '').toUpperCase();

            let roleClass = node.is_gateway ? 'marker-role-gateway' : 'marker-role-client';
            if (!node.is_gateway) {
                if (role === 'ROUTER' || role === 'REPEATER') roleClass = 'marker-role-router';
                else if (role === 'ROUTER_LATE') roleClass = 'marker-role-router-late';
                else if (role === 'CLIENT_BASE') roleClass = 'marker-role-client-base';
                else if (role === 'CLIENT_MUTE') roleClass = 'marker-role-client-mute';
            }

            let bgStyle = isSrc ? 'background-color: #e91e63 !important;' : '';

            const markerOptions = {
                icon: L.divIcon({
                    html: `<div class="${roleClass}" style="${bgStyle}"><span>${escapeHTML(shortText)}</span></div>`,
                    className: 'marker-cluster marker-cluster-medium',
                    iconSize: L.point(44, 44)
                })
            };
            const marker = L.marker([node.lat, node.lon], markerOptions).addTo(markerCluster);
            markers[node.id] = marker;
            latLngs.push([node.lat, node.lon]);

            // Ponytail: Dynamic precision circle based on PDOP
            const rad = node.pdop ? Math.max(10, node.pdop / 10) : 50;
            const pCircle = L.circle([node.lat, node.lon], { radius: rad, color: '#3ec57e', fillOpacity: 0.1, weight: 1, interactive: false }).addTo(map);
            window.precisionCircles[node.id] = pCircle;

            let html = `<div class="popup-header">${escapeHTML(node.long_name || node.id)}</div>`;
            const tType = node.is_gateway ? 'GW' : (node.transport_type || (node.via_mqtt ? 'MQTT' : 'RF'));
            const transportBadge = tType === 'GW'
                ? `<span class="transport-badge transport-badge-gw">GW 🌐</span>`
                : (tType === 'HYBRID'
                    ? `<span class="transport-badge transport-badge-hybrid">RF + MQTT 🌐📻</span>`
                    : (tType === 'MQTT'
                        ? `<span class="transport-badge transport-badge-mqtt">MQTT 🌐</span>`
                        : `<span class="transport-badge transport-badge-rf">RF 📻</span>`));
            if (node.hw_model) html += `<div>Model: ${escapeHTML(node.hw_model)} ${transportBadge}</div>`;
            else html += `<div>Transport: ${transportBadge}</div>`;
            if (node.role) html += `<div style="color:#ffd700;font-weight:bold;font-size:11px;">Role: ${escapeHTML(node.role)}</div>`;
            if (node.sats_in_view) html += `<div style="color:#aaa;font-size:11px;">Sats in view: ${node.sats_in_view}</div>`;
            const latestTelem = node.telemetry && node.telemetry.length ? node.telemetry[node.telemetry.length - 1] : null;
            if (latestTelem && latestTelem.uptime_seconds) html += `<div style="color:#aaa;font-size:11px;">Uptime: ${Math.floor(latestTelem.uptime_seconds / 3600)}h ${Math.floor((latestTelem.uptime_seconds % 3600) / 60)}m</div>`;
            html += `<div>Traffic Volume: ${node.traffic_volume} pkts</div>`;
            html += `<div style="margin-top:10px;color:#00bcd4;cursor:pointer;font-weight:bold;font-size:12px;" onclick="document.dispatchEvent(new CustomEvent('openNodePanel', {detail: '${node.id}'}))">VIEW ANALYTICS &rarr;</div>`;
            html += `<div style="margin-top:8px;color:#7c3aed;cursor:pointer;font-weight:bold;font-size:12px;" onclick="document.dispatchEvent(new CustomEvent('copyNodeLink', {detail: '${node.id}'}))">SHARE NODE 🔗</div>`;

            marker.bindPopup(html);
        }
    });
    map.addLayer(markerCluster);

    window.openNodePanelFn = openNodePanel;
    if (!window._dashboardEventsAttached) {
        window._dashboardEventsAttached = true;
        document.addEventListener('openNodePanel', (e) => {
            if (window.openNodePanelFn) window.openNodePanelFn(e.detail);
        });

        document.addEventListener('copyNodeLink', (e) => {
            const nodeId = e.detail;
            window.copyShareLink('#node=' + nodeId, () => {
                const toast = document.createElement('div');
                toast.innerText = 'Copied to clipboard!';
                toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#4caf50;color:white;padding:10px 20px;border-radius:20px;font-size:12px;z-index:999999;box-shadow:0 4px 10px rgba(0,0,0,0.5);opacity:0;transition:opacity 0.3s;';
                document.body.appendChild(toast);
                setTimeout(() => toast.style.opacity = '1', 10);
                setTimeout(() => {
                    toast.style.opacity = '0';
                    setTimeout(() => toast.remove(), 300);
                }, 2000);
            });
        });
    }

    const isDeepLinking = window.location.hash && window.location.hash.startsWith('#node=');
    if (latLngs.length > 0 && !isDeepLinking) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [50, 50] });
    }

    const routeLines = [];

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
        if (!points || points.length < 2) return;

        // ponytail: clean L.circleMarker projectile rewrite from scratch
        const projectile = L.circleMarker(points[0], {
            radius: 5,
            fillColor: color,
            color: '#ffffff',
            weight: 1.5,
            fillOpacity: 0.95,
            interactive: false
        }).addTo(map);

        let seg = 0, t = 0;
        let last = performance.now();

        function animate(now) {
            if (seg >= points.length - 1) {
                map.removeLayer(projectile);
                return;
            }
            const speed = parseFloat(document.getElementById('speed-control')?.value) || 1;
            const dt = Math.min((now - last) / 1000, 0.1);
            last = now;

            t += dt * speed * 1.5;
            if (t >= 1) {
                t = 0;
                seg++;
            } else {
                const pA = points[seg];
                const pB = points[seg + 1];
                projectile.setLatLng([
                    pA.lat + (pB.lat - pA.lat) * t,
                    pA.lng + (pB.lng - pA.lng) * t
                ]);
            }
            requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
    }

    // --- SIDEBAR LONGEST LINKS ---
    function getSNRBadgeClass(snr) {
        if (snr === null || snr === undefined) return 'bg-secondary';
        if (snr >= 5) return 'bg-success';
        if (snr >= 0) return 'bg-warning';
        if (snr >= -10) return 'bg-warning text-dark';
        return 'bg-danger';
    }

    const tbody = document.getElementById('longest-links-table-body');
    const countEl = document.getElementById('longest-links-count');
    const totalEl = document.getElementById('total-rf-links');
    const longestEl = document.getElementById('longest-direct-link');

    if (tbody && graphData.longestLinks) {
        tbody.innerHTML = '';
        if (countEl) countEl.textContent = graphData.longestLinks.length;
        if (totalEl) totalEl.textContent = graphData.longestLinks.length;

        if (longestEl) {
            longestEl.textContent = graphData.longestLinks.length > 0 ? (graphData.longestLinks[0].distanceKm.toFixed(2) + ' km') : '0.00 km';
        }

        graphData.longestLinks.forEach((link, idx) => {
            const tr = document.createElement('tr');

            const snrClass = getSNRBadgeClass(link.snr);
            const snrText = link.snr !== null ? link.snr.toFixed(1) + ' dB' : 'N/A';

            tr.innerHTML = `
                <td><strong>${idx + 1}</strong></td>
                <td>
                    <a href="#" class="node-link" onclick="openNodePanel('${link.source}'); return false;">${escapeHTML(link.sourceName)}</a>
                    <br><span style="color:#666;font-size:10px;">➔</span><br>
                    <a href="#" class="node-link" onclick="openNodePanel('${link.target}'); return false;">${escapeHTML(link.targetName)}</a>
                </td>
                <td style="color: ${link.distanceKm >= 10 ? '#ffc107' : '#ececec'}; font-weight: ${link.distanceKm >= 10 ? 'bold' : 'normal'};">
                    ${link.distanceKm.toFixed(2)} km
                </td>
                <td><span class="badge ${snrClass}">${snrText}</span></td>
            `;

            tr.style.cursor = 'pointer';
            tr.onclick = (e) => {
                if (e.target.tagName === 'A') return;
                if (markers[link.source] && markers[link.target]) {
                    const group = new L.featureGroup([markers[link.source], markers[link.target]]);
                    map.fitBounds(group.getBounds().pad(0.1));
                    btnMap.click(); // Switch back to map view
                }
            };

            tbody.appendChild(tr);
        });
    }


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
            }))
            .on("click", (event) => {
                if (event.target.tagName.toLowerCase() === 'svg' && window.lastClickedNodeId) {
                    window.lastClickedNodeId = null;
                    highlightPath(null, null);
                }
            });

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
            .force("charge", d3.forceManyBody().strength(parseInt(localStorage.getItem('d3_spread') || '-1000')))
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
            .selectAll("circle")
            .data(d3Nodes)
            .join("circle")
            .attr("id", d => 'd3-node-' + d.id.replace(/[^a-zA-Z0-9]/g, ''))
            .attr("r", d => d.short_name === 'NXTW' ? 20 : 10)
            .attr("fill", d => d.id === maxVolNodeId ? "#e91e63" : (d.role === 'CLIENT_BASE' ? '#00bcd4' : '#2196f3'))
            .attr("stroke", d => {
                if (d.is_gateway) return '#ab47bc';
                const r = (d.role || '').toUpperCase();
                if (r === 'ROUTER' || r === 'REPEATER') return '#ffd700';
                if (r === 'ROUTER_LATE') return '#ff9800';
                if (r === 'CLIENT_BASE') return '#00bcd4';
                return '#ffffff';
            })
            .attr("stroke-width", d => {
                if (d.is_gateway) return 3;
                const r = (d.role || '').toUpperCase();
                return (r.includes('ROUTER') || r === 'CLIENT_BASE') ? 3 : 1.5;
            })
            .attr("stroke-dasharray", d => (d.role || '').toUpperCase() === 'CLIENT_MUTE' ? "3,3" : null)
            .call(drag(simulation))
            .on("mouseover", (event, d) => {
                tooltip.style("opacity", 1)
                    .html(`<b>${escapeHTML(d.long_name || d.id)}</b><br>Traffic: ${d.traffic_volume} pkts`)
                    .style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
            })
            .on("mouseout", () => {
                tooltip.style("opacity", 0);
            })
            .on("click", (event, d) => {
                // ponytail: path routing only, no invasive sidebar
                if (window.lastClickedNodeId === d.id) {
                    window.lastClickedNodeId = null;
                    highlightPath(null, null);
                } else {
                    if (window.lastClickedNodeId) {
                        highlightPath(window.lastClickedNodeId, d.id);
                    }
                    window.lastClickedNodeId = d.id;
                }
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

        window.highlightD3Route = function (path) {
            link.attr("stroke", d => {
                if (!path) return linkColor(d.snr);
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i = 0; i < path.length - 1; i++) {
                    if ((s === path[i] && t === path[i + 1]) || (s === path[i + 1] && t === path[i])) return "#00e5ff";
                }
                return linkColor(d.snr);
            }).attr("stroke-width", d => {
                if (!path) return thicknessScale(d.snr);
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i = 0; i < path.length - 1; i++) {
                    if ((s === path[i] && t === path[i + 1]) || (s === path[i + 1] && t === path[i])) return 6;
                }
                return thicknessScale(d.snr);
            }).attr("stroke-opacity", d => {
                if (!path) return 0.8;
                const s = d.source.id || d.source;
                const t = d.target.id || d.target;
                for (let i = 0; i < path.length - 1; i++) {
                    if ((s === path[i] && t === path[i + 1]) || (s === path[i + 1] && t === path[i])) return 1;
                }
                return 0.1;
            });

            node.attr("opacity", d => (!path || path.includes(d.id)) ? 1 : 0.2);
            labels.attr("opacity", d => (!path || path.includes(d.id)) ? 1 : 0.2);

            // ponytail: native DOM hop counter
            let hopCounter = document.getElementById('hop-counter');
            if (!hopCounter) {
                hopCounter = document.createElement('div');
                hopCounter.id = 'hop-counter';
                hopCounter.style.cssText = 'position:absolute;top:15px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#00e5ff;padding:4px 12px;border-radius:12px;font-weight:bold;z-index:999;pointer-events:none;font-size:14px;border:1px solid #00e5ff;box-shadow:0 0 8px #00e5ff;';
                document.getElementById('d3-container').appendChild(hopCounter);
            }
            if (path && path.length > 1) {
                hopCounter.innerText = `${path.length - 1} Hops`;
                hopCounter.style.display = 'block';
            } else {
                hopCounter.style.display = 'none';
            }
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

    function pulseLeaflet(id, color = '#00bcd4') {
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

    function pulseD3(id, color = '#00bcd4') {
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

    let currentSimTime = graphData.packetLog && graphData.packetLog.length > 0 ? (graphData.packetLog[0].time || Date.parse("2026-06-18T13:27:58Z")) : Date.parse("2026-06-18T13:27:58Z");
    let lastRealTime = performance.now();

    const validTimes = (graphData.packetLog || []).map(p => p.time).filter(t => t && t > 0);
    const minSimTime = validTimes.length > 0 ? Math.min(...validTimes) : currentSimTime;
    const maxSimTime = validTimes.length > 0 ? Math.max(...validTimes) : currentSimTime + 60000;

    function formatTimeClock(ms) {
        if (!ms || isNaN(ms)) return "00:00:00";
        const date = new Date(ms);
        return date.toTimeString().split(' ')[0];
    }

    const curTimeEl = document.getElementById('sim-time-current');
    const totTimeEl = document.getElementById('sim-time-total');

    if (totTimeEl) totTimeEl.innerText = formatTimeClock(maxSimTime);
    if (curTimeEl) curTimeEl.innerText = formatTimeClock(currentSimTime);

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

        if (curTimeEl) curTimeEl.innerText = formatTimeClock(currentSimTime);

        // Fast-forward dead air: max 1000ms simulated wait between packets
        if (pktIdx < graphData.packetLog.length) {
            const nextTime = graphData.packetLog[pktIdx].time;
            if (nextTime && nextTime - currentSimTime > 1000) {
                currentSimTime = nextTime - 1000;
            }
        }

        const nodeFilterText = document.getElementById('node-filter') ? document.getElementById('node-filter').value.trim().toLowerCase() : '';
        const portFilterVal = document.getElementById('port-filter') ? document.getElementById('port-filter').value.toUpperCase() : '';

        // Ponytail Map Filters
        const maxAgeHrs = document.getElementById('age-filter') ? parseFloat(document.getElementById('age-filter').value) : NaN;
        const maxHops = document.getElementById('hop-filter') ? parseInt(document.getElementById('hop-filter').value) : NaN;

        let allowedHops = null;
        if (!isNaN(maxHops) && window.lastClickedNodeId) {
            allowedHops = new Set();
            const adj = {};
            graphData.edges.forEach(e => {
                const s = e.source.id || e.source; const t = e.target.id || e.target;
                if (!adj[s]) adj[s] = []; if (!adj[t]) adj[t] = [];
                adj[s].push(t); adj[t].push(s);
            });
            const q = [[window.lastClickedNodeId, 0]];
            const visited = new Set([window.lastClickedNodeId]);
            while (q.length > 0) {
                const [curr, depth] = q.shift();
                allowedHops.add(curr);
                if (depth < maxHops) {
                    for (const n of (adj[curr] || [])) {
                        if (!visited.has(n)) { visited.add(n); q.push([n, depth + 1]); }
                    }
                }
            }
        }

        graphData.nodes.forEach(n => {
            let visible = true;
            if (!isNaN(maxAgeHrs) && n.telemetry && n.telemetry.length > 0) {
                let latestAgeMs = Infinity;
                for (let i = n.telemetry.length - 1; i >= 0; i--) {
                    if (n.telemetry[i].time <= currentSimTime) {
                        latestAgeMs = currentSimTime - n.telemetry[i].time;
                        break;
                    }
                }
                if (latestAgeMs > maxAgeHrs * 3600000) visible = false;
            }
            if (allowedHops && !allowedHops.has(n.id)) visible = false;

            if (markers[n.id]) {
                const isVis = visible ? 1 : 0;
                if (markers[n.id].options.opacity !== isVis) {
                    markers[n.id].setOpacity(isVis);
                    if (window.precisionCircles && window.precisionCircles[n.id]) {
                        window.precisionCircles[n.id].setStyle({ opacity: visible ? 0.1 : 0, fillOpacity: visible ? 0.1 : 0 });
                    }
                }
            }
            const el = document.getElementById('d3-node-' + n.id.replace(/[^a-zA-Z0-9]/g, ''));
            if (el) el.style.display = visible ? 'block' : 'none';
        });

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
                    if (p.port === 'POSITION_APP') {
                        if (p.from) pulseLeaflet(p.from, '#4caf50');
                    } else {
                        if (p.from) pulseD3(p.from, '#00bcd4');
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
        const timeStr = `[${d.toTimeString().substring(0, 8)}.${d.getMilliseconds().toString().padStart(3, '0')}]`;

        const dotColor = pkt.port === 'POSITION_APP' ? '#4caf50' : (pkt.port === 'TELEMETRY_APP' ? '#ff9800' : '#00bcd4');

        const div = document.createElement('div');
        div.className = 'term-line';

        div.dataset.port = (pkt.port || '').toUpperCase();
        div.dataset.from = (pkt.from || '').toLowerCase();
        div.dataset.to = (pkt.to || '').toLowerCase();
        div.dataset.sum = (pkt.sum || '').toLowerCase();
        div.innerHTML = `<span style="color:${dotColor}; margin-right:6px; font-size:12px;">●</span><span style="color: #888; margin-right: 8px; font-family: monospace;">${timeStr}</span><span class="term-port">[${escapeHTML(pkt.port)}]</span><span class="term-from">FROM: ${escapeHTML(displayName)}</span><span class="term-sum">${escapeHTML(pkt.sum)}</span>`;

        div.onclick = () => {
            document.getElementById('dpi-modal').style.display = 'flex';
            document.getElementById('dpi-payload').textContent = JSON.stringify(pkt, null, 2);
        };

        termOut.appendChild(div);

        while (termOut.children.length > 200) {
            termOut.removeChild(termOut.firstChild);
        }
        termOut.scrollTop = termOut.scrollHeight;

        pulseLeaflet(pkt.from, dotColor);
        pulseD3(pkt.from, dotColor);

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
    if (nf) {
        nf.value = localStorage.getItem('term_node_filter') || '';
        nf.oninput = (e) => {
            localStorage.setItem('term_node_filter', e.target.value);
            applyTerminalFilters();
        };
    }
    const pf = document.getElementById('port-filter');
    if (pf) {
        pf.value = localStorage.getItem('term_port_filter') || '';
        pf.onchange = (e) => {
            localStorage.setItem('term_port_filter', e.target.value);
            applyTerminalFilters();
        };
    }
    const sc = document.getElementById('speed-control');
    if (sc) {
        sc.value = localStorage.getItem('term_speed') || '1';
        sc.onchange = (e) => localStorage.setItem('term_speed', e.target.value);
    }

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
            const nt = document.getElementById('nav-toggle');
            if (nt) nt.style.visibility = 'visible';
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

    function initTutorial() {
        const btnT = document.getElementById('btn-modal-tutorial') || document.getElementById('btn-tutorial');
        if (btnT) {
            btnT.onclick = () => {
                const modal = document.getElementById('settings-modal');
                if (modal && modal.close) modal.close();
                localStorage.removeItem('tour_global_seen');
                localStorage.removeItem('tour_map_seen');
                localStorage.removeItem('tour_net_seen');
                localStorage.removeItem('tour_unmapped_seen');
                runGlobalTour();
            };
        }

        if (!localStorage.getItem('tour_global_seen')) {
            setTimeout(() => runGlobalTour(), 500);
        }
    }

    // ponytail: continuous loop cycle for ambient packet projectiles across both maps
    if (window._ambientFlowInterval) clearInterval(window._ambientFlowInterval);
    if (graphData.routePaths && graphData.routePaths.length > 0) {
        window._ambientFlowInterval = setInterval(() => {
            const speedControl = document.getElementById('speed-control');
            const speedMultiplier = parseFloat(speedControl ? speedControl.value : 1) || 1;
            if (speedMultiplier <= 0) return;

            const path = graphData.routePaths[Math.floor(Math.random() * graphData.routePaths.length)];
            if (!path || !path.hops || path.hops.length < 2) return;

            const color = '#00bcd4'; // ambient cyan
            
            // Geo Map
            const points = [];
            path.hops.forEach(h => {
                const m = markers[h.id];
                if (m) points.push(m.getLatLng());
            });
            if (points.length > 1 && window.leafletMap) {
                animateSinglePacket(points, color);
            }
            
            // Logical Map (D3)
            if (window.triggerD3Packet && window.d3Simulation) {
                for (let i = 0; i < path.hops.length - 1; i++) {
                    setTimeout(() => {
                        window.triggerD3Packet(path.hops[i].id, path.hops[i+1].id, color);
                    }, i * (500 / speedMultiplier));
                }
            }
        }, 300); // 300ms ambient density
    }

} // End initializeDashboard