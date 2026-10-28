'use strict';
// Aplikacja Electron: uruchamia serwer i pełnoekranowy odtwarzacz, pilnuje, żeby ekran zawsze działał.
const { app, BrowserWindow, powerSaveBlocker, screen, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Bonjour } = require('bonjour-service');
const { createServer } = require('./server');

const PORT = +process.env.EKRAN_PORT || 8080;
const WINDOWED = process.argv.includes('--windowed');
const BASE = `http://127.0.0.1:${PORT}`;

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

const logFile = path.join(app.getPath('userData'), 'ekran.log');
function log(...a) {
  const line = `${new Date().toISOString()} ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`;
  process.stdout.write(line);
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5e6) fs.renameSync(logFile, logFile + '.old');
    fs.appendFileSync(logFile, line);
  } catch {}
}

let win = null;
let srv = null;
let bonjour = null;
let quitting = false;
let restarts = [];

process.on('uncaughtException', (e) => {
  log('KRYTYCZNY BŁĄD', e);
  if (!quitting) { app.relaunch(); app.exit(1); }
});

function targetDisplay() {
  const all = screen.getAllDisplays();
  return all[srv?.db.settings.display] || screen.getPrimaryDisplay();
}

function createWindow() {
  const b = targetDisplay().bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: WINDOWED ? 1280 : b.width, height: WINDOWED ? 720 : b.height,
    fullscreen: !WINDOWED, kiosk: !WINDOWED, frame: WINDOWED, autoHideMenuBar: true,
    backgroundColor: '#000000', title: 'Szkolny Ekran', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL(`${BASE}/player/`);

  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(BASE)) e.preventDefault(); });
  wc.on('did-fail-load', (_e, code, desc) => { log('nie wczytano odtwarzacza', code, desc); setTimeout(() => win && win.loadURL(`${BASE}/player/`), 3000); });
  wc.on('render-process-gone', (_e, d) => { log('odtwarzacz padł:', d.reason); setTimeout(() => win && win.reload(), 2000); });
  win.on('unresponsive', () => { log('odtwarzacz nie odpowiada'); setTimeout(() => win && wc.reload(), 5000); });
  wc.on('before-input-event', (e, i) => {
    const k = i.key.toLowerCase();
    if (i.control && i.shift && k === 'q') { quitting = true; app.quit(); }
    if (i.control && i.shift && k === 'p') shell.openExternal(`${BASE}/admin/`);
    if (i.control && i.shift && k === 'd') wc.toggleDevTools();
    if (k === 'f5') wc.reload();
  });
  win.on('closed', () => { win = null; if (!quitting) setTimeout(createWindow, 1000); });
}

function moveToDisplay() {
  if (!win) return;
  const b = targetDisplay().bounds;
  win.setKiosk(false); win.setFullScreen(false);
  win.setBounds({ x: b.x, y: b.y, width: WINDOWED ? 1280 : b.width, height: WINDOWED ? 720 : b.height });
  if (!WINDOWED) { win.setFullScreen(true); win.setKiosk(true); }
}

// Watchdog: brak sygnału życia z odtwarzacza = przeładuj; zbyt wiele razy = restart aplikacji.
function watchdog() {
  if (!win || !srv) return;
  const silent = Date.now() - (srv.status.lastBeat || srv.status.started);
  if (silent > 45000) {
    restarts = restarts.filter((t) => Date.now() - t < 10 * 60000).concat(Date.now());
    log(`watchdog: brak odpowiedzi ${Math.round(silent / 1000)} s, przeładowanie (${restarts.length}/5)`);
    srv.status.lastBeat = Date.now();
    if (restarts.length >= 5) { app.relaunch(); app.exit(0); return; }
    win.webContents.reload();
  }
}

// Nocny restart odtwarzacza o 3:00 - czyści pamięć po wielu godzinach animacji.
function nightly() {
  const now = new Date();
  if (now.getHours() === 3 && now.getMinutes() === 0 && win) { log('nocne odświeżenie'); win.webContents.reload(); }
}

app.whenReady().then(async () => {
  log(`start ${app.getVersion()} ${process.platform} ${WINDOWED ? '(okno)' : '(kiosk)'}`);
  srv = createServer({
    dataDir: path.join(app.getPath('userData'), 'data'), port: PORT, log, logFile,
    hooks: {
      screenshot: async () => (win ? (await win.webContents.capturePage()).resize({ width: 960 }).toJPEG(75) : null),
      reload: () => win && win.webContents.reload(),
      displays: () => screen.getAllDisplays().map((d, i) => ({ index: i, label: d.label || `Ekran ${i + 1}`, width: d.size.width, height: d.size.height, primary: d.id === screen.getPrimaryDisplay().id })),
      applyDisplay: moveToDisplay,
    },
  });
  try {
    await srv.listen();
  } catch (e) {
    log('port zajęty', e);
    dialog.showErrorBox('Szkolny Ekran', `Nie można uruchomić serwera na porcie ${PORT}.\nCzy program nie jest już uruchomiony?\n\n${e.message}`);
    app.exit(1); return;
  }
  log(`panel: http://localhost:${PORT}/admin/`);

  // Bonjour: panel widoczny w sieci lokalnej jako NAZWA.local; brak multicastu w sieci nie może wywrócić aplikacji.
  try {
    bonjour = new Bonjour();
    bonjour.publish({ name: `Szkolny Ekran (${os.hostname()})`, type: 'http', port: PORT, txt: { path: '/admin/' } })
      .on('error', (e) => log('bonjour', e));
    log(`bonjour: http://${os.hostname()}.local:${PORT}/admin/`);
  } catch (e) { log('bonjour wyłączony', e); }

  powerSaveBlocker.start('prevent-display-sleep');
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  createWindow();
  screen.on('display-added', moveToDisplay);
  screen.on('display-removed', moveToDisplay);
  setInterval(watchdog, 15000);
  setInterval(nightly, 60000);
});

app.on('second-instance', () => { if (win) win.focus(); });
app.on('window-all-closed', () => {}); // okno odtwarza się samo; zamykanie tylko Ctrl+Shift+Q
app.on('before-quit', () => { quitting = true; if (bonjour) bonjour.unpublishAll(() => bonjour.destroy()); });
