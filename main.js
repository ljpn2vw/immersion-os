const { app, BrowserWindow, ipcMain, globalShortcut, shell, powerMonitor, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

let mainWindow;
let widgetWindow = null;
let tray = null;
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