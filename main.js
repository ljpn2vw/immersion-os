const { app, BrowserWindow, ipcMain, globalShortcut, shell, powerMonitor } = require('electron');
const path = require('path');

let mainWindow;
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

app.whenReady().then(createWindow);

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
                    if (index === 0 && opts && opts.autoSubmit) {
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