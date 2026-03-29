const { app, BrowserWindow, ipcMain, globalShortcut, shell, powerMonitor, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let widgetWindow = null;
let tray = null;
let referenceWindow = null;
let closeToTrayEnabled = false;
let isQuitting = false;

// Listen for the setting toggle from index.html
ipcMain.on('update-tray-setting', (event, enabled) => {
    closeToTrayEnabled = enabled;
});
let afkThreshold = 0; 
let afkInterval;
let isAfkTriggered = false;

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1300, height: 850,
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, 'logo.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  });

  mainWindow.on('focus', () => {
    if (mainWindow.webContents) {
      mainWindow.webContents.focus();
    }
  });
}

app.whenReady().then(() => {
    createWindow();

    // Setup System Tray with fallback
    try {
        tray = new Tray(__dirname + '/logo.ico');
    } catch (err) {
        console.log("Valid icon.ico not found, using blank fallback.");
        let blank = nativeImage.createEmpty();
        blank = blank.resize({width: 16, height: 16});
        tray = new Tray(blank);
    }
    
    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show Immersion OS', click: () => { mainWindow.show(); } },
        { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('Immersion OS');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { mainWindow.show(); });

    // Intercept Window Close
    mainWindow.on('close', (event) => {
        if (closeToTrayEnabled && !isQuitting) {
            event.preventDefault(); // Stop the close
            mainWindow.hide();      // Hide to tray instead
            return;
        }
        
        // If we are actually quitting, explicitly murder the widget window so it doesn't get left behind
        if (widgetWindow) {
            widgetWindow.close();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
});

// Also kill widget if all windows are closed
app.on('window-all-closed', () => {
    if (widgetWindow) widgetWindow.close();
    if (process.platform !== 'darwin') app.quit();
});

// --- GAME LAUNCHER ---
const { exec, spawn } = require('child_process');

ipcMain.on('launch-apps', (event, paths, opts) => {
    paths.forEach((cmd, index) => {
        if (cmd && cmd.trim() !== "") {
            if (cmd.startsWith('http://') || cmd.startsWith('https://')) {
                shell.openExternal(cmd);
            } else {
				
                let exePath = cmd;
                let args = "";
                
                if (cmd.startsWith('"')) {
                    let match = cmd.match(/^"([^"]+)"(.*)/);
                    if (match) {
                        exePath = match[1];
                        args = match[2];
                    }
                } else {
                    let parts = cmd.split(" ");
                    exePath = parts[0];
                    args = parts.slice(1).join(" ");
                }

                let exeName = path.basename(exePath);
                let targetDir = path.dirname(exePath);

                exec(`tasklist /FI "IMAGENAME eq ${exeName}"`, (err, stdout, stderr) => {
                    if (stdout.toLowerCase().includes(exeName.toLowerCase())) {
                        console.log(`${exeName} is already running. Skipping.`);
                        return; 
                    }

                    let launchCommand = `"${exePath}" ${args}`.trim();
                    let child = spawn(launchCommand, [], { 
                        shell: true, 
                        detached: true, 
                        cwd: targetDir
                    });
                    
                    // Look for the specific path index selected in the UI (defaults to 0 / Path 1)
                    let targetIdx = opts && opts.targetPathIndex !== undefined ? opts.targetPathIndex : 0;
                    
                    if (index === targetIdx && opts && opts.autoSubmit) {
                        child.on('close', () => {
                            event.reply('app-closed', opts.mediaName);
                        });
                    }
                    
                    child.on('error', (err) => console.error(`Failed to launch: ${cmd}`, err));
                    child.unref(); 
                });
            }
        }
    });
});

ipcMain.handle('launch-widget', (event, config) => {
    if (widgetWindow) {
        widgetWindow.close();
    }

    // Determine target monitor (Use chosen bounds, or fallback to current mouse position)
    let targetBounds = config.bounds;
    if (!targetBounds) {
        targetBounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    }

    let scale = config.scale || 1.0;
    let w = 0, h = 0;

    if (config.type === 'linux') { 
        w = targetBounds.width; // Linux bar always fills monitor width
        h = Math.round(36 * scale); 
    } else if (config.type === 'float') { 
        w = Math.round(400 * scale); // Increased base width for breathing room
        h = Math.round(65 * scale); 
    } else if (config.type === 'pill') {
        w = config.alwaysExpanded ? Math.round(320 * scale) : Math.round(150 * scale); 
        h = config.alwaysExpanded ? Math.round(150 * scale) : Math.round(55 * scale);  
    }
    widgetWindow = new BrowserWindow({
        width: w,
        height: h,
        transparent: true,
        frame: false,
        hasShadow: false, 
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Snap to the exact coordinates of the chosen monitor
    if (config.type === 'linux') {
        widgetWindow.setPosition(targetBounds.x, targetBounds.y);
    } else if (config.bounds) {
        // If it's a floating bar/pill, spawn it generally in the center of the chosen monitor
        widgetWindow.setPosition(targetBounds.x + Math.floor(targetBounds.width/2 - w/2), targetBounds.y + 50);
    }

    widgetWindow.loadFile('widget.html');
	widgetWindow.setAlwaysOnTop(true, 'screen-saver');

    widgetWindow.on('closed', () => { widgetWindow = null; });
    widgetWindow.webContents.once('did-finish-load', () => {
        widgetWindow.webContents.send('widget-init-config', config);
    });
});

// Check if widget is already open
ipcMain.handle('is-widget-active', () => {
    return widgetWindow !== null;
});

ipcMain.on('resize-widget', (event, size) => {
    if (widgetWindow) {
        // Physically resizes the invisible Electron window
        widgetWindow.setSize(size.width, size.height);
    }
});

ipcMain.on('close-widget', () => {
    if (widgetWindow) widgetWindow.close();
});

ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map((d, index) => ({
        id: d.id,
        index: index + 1,
        bounds: d.bounds,
        isPrimary: d.bounds.x === 0 && d.bounds.y === 0
    }));
});

// Route live data (Timer, Chars, etc.) from Main App -> Widget
ipcMain.on('send-widget-data', (event, data) => {
    if (widgetWindow) {
        widgetWindow.webContents.send('update-widget-ui', data);
    }
});

// Route actions (Pause, Stop) from Widget -> Main App
ipcMain.on('widget-action', (event, action) => {
    if (mainWindow) {
        mainWindow.webContents.send('trigger-widget-action', action);
    }
});

// --- GLOBAL HOTKEYS ---
ipcMain.on('register-hotkeys', (event, keys) => {
  globalShortcut.unregisterAll(); 
  if (keys.save) globalShortcut.register(keys.save, () => { mainWindow.webContents.send('trigger-save'); });
  if (keys.timer) globalShortcut.register(keys.timer, () => { mainWindow.webContents.send('trigger-timer'); });
  if (keys.dbAlt) globalShortcut.register(keys.dbAlt, () => { mainWindow.webContents.send('trigger-db-alt'); });
  if (keys.dbMain) globalShortcut.register(keys.dbMain, () => { mainWindow.webContents.send('trigger-db-main'); });
});

// --- QUICK REFERENCE OVERLAY ---
ipcMain.handle('toggle-reference-window', (event, { url, isImage }) => {
    // If it's already open, hitting the hotkey closes it instantly
    if (referenceWindow) {
        referenceWindow.close();
        return;
    }
    if (!url) return;

    // Get the monitor where the user's mouse currently is
    let bounds = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    
    // For images, we take up the whole screen. For websites, we use an 85% popup.
    let w = isImage ? bounds.width : Math.floor(bounds.width * 0.85);
    let h = isImage ? bounds.height : Math.floor(bounds.height * 0.85);
    let x = isImage ? bounds.x : bounds.x + Math.floor((bounds.width - w) / 2);
    let y = isImage ? bounds.y : bounds.y + Math.floor((bounds.height - h) / 2);

    referenceWindow = new BrowserWindow({
        width: w, height: h, x: x, y: y,
        frame: false, alwaysOnTop: true, skipTaskbar: true,
        transparent: isImage, // Magic: Makes the window invisible so we can use CSS blur
        backgroundColor: isImage ? undefined : '#0f1115',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false 
        }
    });

    // Close on Escape key
    referenceWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape') referenceWindow.close();
    });

    referenceWindow.on('closed', () => { referenceWindow = null; });

    if (isImage) {
        let safeUrl = url.replace(/\\/g, '/');
        if (safeUrl.match(/^[a-zA-Z]:\//)) safeUrl = 'file:///' + safeUrl;

        // Injected HTML with CSS Blur, Zooming, and Panning logic
        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden;
                    background: rgba(0, 0, 0, 0.65); /* Dims the background */
                    backdrop-filter: blur(10px); /* Blurs the background */
                    display: flex; align-items: center; justify-content: center;
                    font-family: sans-serif;
                }
                #img-container {
                    display: flex; align-items: center; justify-content: center;
                    width: 100%; height: 100%;
                    cursor: grab;
                }
                #img-container:active { cursor: grabbing; }
                img {
                    max-width: 95vw; max-height: 95vh; object-fit: contain;
                    transition: transform 0.1s ease-out;
                    user-select: none;
                }
                .close-btn {
                    position: absolute; top: 20px; right: 20px;
                    background: rgba(0,0,0,0.6); color: white; border: 1px solid rgba(255,255,255,0.2);
                    padding: 8px 16px; border-radius: 6px; cursor: pointer; z-index: 999;
                    font-weight: bold; transition: 0.2s; -webkit-app-region: no-drag;
                }
                .close-btn:hover { background: #ff4444; }
            </style>
        </head>
        <body>
            <div class="close-btn" onclick="window.close()">✕ Esc</div>
            <div id="img-container">
                <img id="viewer-img" src="${safeUrl}" draggable="false">
            </div>

            <script>
                const img = document.getElementById('viewer-img');
                const container = document.getElementById('img-container');
                let scale = 1;
                let isDragging = false;
                let startX, startY, translateX = 0, translateY = 0;

                // Zoom with Mouse Wheel
                window.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const zoomSensitivity = 0.1;
                    const delta = e.deltaY > 0 ? -zoomSensitivity : zoomSensitivity;
                    scale = Math.max(0.1, Math.min(scale + delta, 15)); // Limits zoom from 0.1x to 15x
                    updateTransform();
                }, { passive: false });

                // Pan with Mouse Drag
                container.addEventListener('mousedown', (e) => {
                    if (e.target.classList.contains('close-btn')) return;
                    isDragging = true;
                    startX = e.clientX - translateX;
                    startY = e.clientY - translateY;
                });

                window.addEventListener('mouseup', () => { isDragging = false; });
                window.addEventListener('mouseleave', () => { isDragging = false; });

                window.addEventListener('mousemove', (e) => {
                    if (!isDragging) return;
                    e.preventDefault();
                    translateX = e.clientX - startX;
                    translateY = e.clientY - startY;
                    updateTransform();
                });

                function updateTransform() {
                    img.style.transform = \`translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
                }
            </script>
        </body>
        </html>`;
        referenceWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    } else {
        // Load the website.
        referenceWindow.loadURL(url);
        referenceWindow.webContents.on('did-finish-load', () => {
            referenceWindow.webContents.executeJavaScript(`
                let dragBar = document.createElement('div');
                dragBar.innerHTML = '<div style="flex:1; -webkit-app-region: drag; height:100%;"></div><div style="padding:0 15px; cursor:pointer; font-weight:bold; -webkit-app-region: no-drag; background:#ff4444; color:#fff; border-radius:4px; display:flex; align-items:center;" onclick="window.close()">✕ Esc</div>';
                dragBar.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:30px; background:rgba(0,0,0,0.8); display:flex; z-index:2147483647; font-family:sans-serif; font-size:12px; transition: opacity 0.2s; opacity: 0.3;';
                dragBar.onmouseover = () => dragBar.style.opacity = '1';
                dragBar.onmouseout = () => dragBar.style.opacity = '0.3';
                document.body.appendChild(dragBar);
            `).catch(e => {});
        });
    }
});

app.on('will-quit', () => { 
    globalShortcut.unregisterAll(); 
    if (afkInterval) clearInterval(afkInterval);
});

// --- AFK IDLE MONITOR ---
ipcMain.on('set-afk-threshold', (event, seconds) => {
    afkThreshold = parseInt(seconds) || 0;
    if (afkInterval) clearInterval(afkInterval);
    
    if (afkThreshold > 0) {
        afkInterval = setInterval(() => {
            let idleTime = powerMonitor.getSystemIdleTime();
            if (idleTime >= afkThreshold && !isAfkTriggered) {
                isAfkTriggered = true;
                if (mainWindow) mainWindow.webContents.send('afk-pause');
            } else if (idleTime < afkThreshold && isAfkTriggered) {
                isAfkTriggered = false; // Reset trigger when they touch mouse again
            }
        }, 1000);
    }
});

// --- GET APP VERSION ---
ipcMain.handle('get-app-version', () => {
    return app.getVersion(); //
});

// --- IMMERSION OS: BACKGROUND MPV & YOUTUBE LISTENER ---
const http = require('http');

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); // <-- THIS IS THE CRITICAL NEW LINE
    
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (req.method === 'POST' && req.url === '/log-ep') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            let folder = body.trim();
            if (folder && mainWindow) mainWindow.webContents.send('auto-log-ep', folder);
            res.writeHead(200); res.end('OK');
        });
    } 
    else if (req.method === 'POST' && req.url === '/log-yt') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                let data = JSON.parse(body);
                if (mainWindow) mainWindow.webContents.send('auto-log-yt', data);
            } catch(e) {}
            res.writeHead(200); res.end('OK');
        });
    } 
	else if (req.method === 'POST' && req.url === '/log-mokuro') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                let data = JSON.parse(body);
                if (mainWindow) mainWindow.webContents.send('auto-log-mokuro', data);
            } catch(e) {}
            res.writeHead(200); res.end('OK');
        });
    }
    else { res.writeHead(404); res.end(); }
});

server.listen(55002, () => { console.log("Background Listener running on port 55002"); });

// --- UNIVERSAL API FETCHER (Bypasses CORS completely) ---
ipcMain.handle('search-api', async (event, { type, q }) => {
    try {
        if (type === 'anime' || type === 'manga') {
            const resp = await fetch(`https://api.jikan.moe/v4/${type}?q=${encodeURIComponent(q)}&limit=10`);
            return await resp.json();
        } else if (type === 'vndb') {
            const resp = await fetch('https://api.vndb.org/kana/vn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filters: ["search", "=", q],
                    fields: "title, alttitle, image.url",
                    results: 10
                })
            });
            return await resp.json();
        } else if (type === 'jiten') {
            const resp = await fetch(`https://api.jiten.moe/api/media-deck/get-media-decks?offset=0&mediaType=7&titleFilter=${encodeURIComponent(q)}`);
            if (!resp.ok) return { error: `HTTP ${resp.status}` };
            return await resp.json();
        }
    } catch (e) {
        return { error: e.message };
    }
});