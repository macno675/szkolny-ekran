'use strict';
// Serwer Szkolnego Ekranu: panel (/admin), odtwarzacz (/player), API (/api), pliki (/media).
// Bez zależności - tylko moduły Node. Działa w Electronie (main.js) albo samodzielnie: `node server.js`.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { computeMode, slideActive } = require('./lib/schedule');

const PUBLIC = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const MEDIA_EXT = { '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image', '.mp4': 'video', '.webm': 'video', '.mov': 'video' };
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GB
const MAX_JSON = 1024 * 1024;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const TRANSITIONS = ['fade', 'slide', 'up', 'zoom', 'blur', 'flip', 'random'];
const THEMES = ['aurora', 'sunset', 'forest', 'royal', 'mono', 'alert', 'candy'];
const TEMPLATES = ['promo', 'event', 'list', 'clock', 'marquee'];

function defaults() {
  const day = (on) => ({ on, from: '07:30', to: '16:00' });
  return {
    settings: {
      name: 'Szkolny Ekran', accent: '#6d5dfc', transition: 'fade', duration: 8, clock: true,
      ticker: { enabled: false, text: '' }, logoMediaId: null, ecoText: '', display: 0,
      schedule: { enabled: true, days: { 0: day(false), 1: day(true), 2: day(true), 3: day(true), 4: day(true), 5: day(true), 6: day(false) } },
    },
    override: 'auto',
    media: [],
    slides: [],
    auth: null,
  };
}

// --- walidacja wejścia (granica zaufania: wszystko z panelu) ---
const str = (v, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min, max, d) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function cleanSlide(input, prev = {}) {
  const s = { ...prev, ...input };
  return {
    id: prev.id || crypto.randomUUID(),
    type: pick(s.type, ['media', 'text', 'loop'], 'text'),
    mediaId: typeof s.mediaId === 'string' ? s.mediaId : null,
    fit: pick(s.fit, ['cover', 'contain'], 'cover'),
    motion: s.motion !== false,
    videoFull: !!s.videoFull,
    title: str(s.title, 200),
    body: str(s.body, 2000),
    label: str(s.label, 120),
    icon: str(s.icon, 16),
    theme: pick(s.theme, THEMES, 'aurora'),
    template: pick(s.template, TEMPLATES, 'promo'),
    badge: str(s.badge, 60),
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.date) ? s.date : '',
    items: str(s.items, 3000),
    duration: num(s.duration, 2, 3600, 8),
    transition: pick(s.transition, TRANSITIONS, 'fade'),
    enabled: s.enabled !== false,
    from: isDate(s.from) ? s.from : '',
    to: isDate(s.to) ? s.to : '',
    created: prev.created || Date.now(),
  };
}

function cleanSettings(input, prev) {
  const s = { ...prev };
  if ('name' in input) s.name = str(input.name, 80) || 'Szkolny Ekran';
  if ('accent' in input && isColor(input.accent)) s.accent = input.accent;
  if ('transition' in input) s.transition = pick(input.transition, TRANSITIONS, s.transition);
  if ('duration' in input) s.duration = num(input.duration, 2, 600, s.duration);
  if ('clock' in input) s.clock = !!input.clock;
  if ('ecoText' in input) s.ecoText = str(input.ecoText, 120);
  if ('display' in input) s.display = num(input.display, 0, 8, 0) | 0;
  if ('logoMediaId' in input) s.logoMediaId = typeof input.logoMediaId === 'string' ? input.logoMediaId : null;
  if (input.ticker && typeof input.ticker === 'object') {
    s.ticker = { enabled: !!input.ticker.enabled, text: str(input.ticker.text, 1000) };
  }
  if (input.schedule && typeof input.schedule === 'object') {
    const days = {};
    for (let d = 0; d < 7; d++) {
      const v = (input.schedule.days || {})[d] || {};
      const p = prev.schedule.days[d];
      days[d] = { on: !!v.on, from: isTime(v.from) ? v.from : p.from, to: isTime(v.to) ? v.to : p.to };
    }
    s.schedule = { enabled: !!input.schedule.enabled, days };
  }
  return s;
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, auth) {
  if (!auth) return false;
  const h = crypto.scryptSync(String(pw), auth.salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(auth.hash, 'hex'));
}

function createServer(opts = {}) {
  const dataDir = opts.dataDir || path.join(__dirname, 'data');
  const mediaDir = path.join(dataDir, 'media');
  const dbFile = path.join(dataDir, 'data.json');
  const hooks = opts.hooks || {};
  const log = opts.log || ((...a) => console.log(new Date().toISOString(), ...a));
  fs.mkdirSync(mediaDir, { recursive: true });

  let db = defaults();
  try {
    const saved = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db = { ...db, ...saved, settings: { ...db.settings, ...saved.settings } };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // uszkodzony plik: zachowaj kopię zamiast nadpisać dane
      try { fs.copyFileSync(dbFile, dbFile + '.broken-' + Date.now()); } catch {}
      try { db = { ...db, ...JSON.parse(fs.readFileSync(dbFile + '.bak', 'utf8')) }; log('data.json uszkodzony - wczytano kopię .bak'); } catch {}
    }
  }

  // Reset hasła: pusty plik "reset-hasla" w folderze danych (wymaga dostępu do komputera szkolnego).
  const resetFile = path.join(dataDir, 'reset-hasla');
  if (fs.existsSync(resetFile)) { db.auth = null; fs.unlinkSync(resetFile); log('reset hasła administratora'); }

  let version = 1;
  const sessions = new Map();
  const loginFails = new Map();
  const clients = new Set();
  const status = { lastBeat: 0, slide: null, mode: null, errors: 0, started: Date.now(), screen: null };
  let lastMode = null;

  function save() {
    version++;
    const tmp = dbFile + '.tmp';
    if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, dbFile + '.bak');
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, dbFile); // zapis atomowy - brak utraty danych przy zaniku prądu
    broadcast('state');
  }

  function playerState(now = new Date()) {
    const mode = computeMode(db.settings.schedule, db.override, now);
    const mediaById = Object.fromEntries(db.media.map((m) => [m.id, m]));
    const slides = db.slides
      .filter((s) => slideActive(s, now))
      .filter((s) => s.type !== 'media' || mediaById[s.mediaId])
      .map((s) => (s.type === 'media' ? { ...s, media: mediaById[s.mediaId] } : s));
    const { auth, ...rest } = db;
    const logo = mediaById[db.settings.logoMediaId] || null;
    return { version, mode, override: db.override, settings: rest.settings, logo, slides, serverTime: now.getTime() };
  }

  function broadcast(event) {
    const payload = event === 'state' ? JSON.stringify(playerState()) : '{}';
    for (const res of clients) res.write(`event: ${event}\ndata: ${payload}\n\n`);
  }

  // Zmiana trybu wg zegara (np. 16:00 -> eco) i dat ogłoszeń bez akcji użytkownika.
  let lastActiveKey = '';
  const ticker = setInterval(() => {
    const st = playerState();
    const key = st.slides.map((s) => s.id).join(',');
    if (st.mode !== lastMode || key !== lastActiveKey) {
      if (lastMode) log(`tryb: ${st.mode}`);
      lastMode = st.mode; lastActiveKey = key;
      broadcast('state');
    }
    for (const res of clients) res.write(': ping\n\n');
  }, 15000);

  // --- pomocnicze HTTP ---
  const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const fail = (res, code, msg) => send(res, code, { error: msg });

  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Za duży plik'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const readJson = async (req) => {
    try { return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8') || '{}'); }
    catch (e) { throw Object.assign(new Error('Niepoprawne dane'), { code: e.code || 400 }); }
  };

  const ip = (req) => req.socket.remoteAddress || '';
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip(req));
  const cookie = (req, name) => {
    const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
    return m ? m[1] : null;
  };
  const authed = (req) => {
    const t = cookie(req, 'ekran_sid');
    const exp = t && sessions.get(t);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(t); return false; }
    return true;
  };
  const newSession = (res) => {
    const t = crypto.randomBytes(32).toString('hex');
    sessions.set(t, Date.now() + SESSION_MS);
    return `ekran_sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`;
  };

  async function serveFile(req, res, file, extraHeaders = {}) {
    let st;
    try { st = await fsp.stat(file); } catch { return fail(res, 404, 'Nie znaleziono'); }
    if (!st.isFile()) return fail(res, 404, 'Nie znaleziono');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...extraHeaders };
    if (range && (range[1] || range[2])) {
      let start = range[1] ? +range[1] : st.size - +range[2];
      let end = range[1] && range[2] ? +range[2] : st.size - 1;
      if (start < 0) start = 0;
      if (start >= st.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  function safeJoin(root, rel) {
    const p = path.normalize(path.join(root, decodeURIComponent(rel)));
    return p.startsWith(root + path.sep) || p === root ? p : null;
  }

  function diskInfo() {
    try {
      const s = fs.statfsSync(dataDir);
      return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
    } catch { return null; }
  }
  const mediaBytes = () => db.media.reduce((a, m) => a + (m.size || 0), 0);
  const ips = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

  function adminView() {
    const { auth, ...rest } = db;
    return {
      ...rest, version,
      status: {
        online: Date.now() - status.lastBeat < 30000, lastBeat: status.lastBeat, slide: status.slide, errors: status.errors,
        mode: computeMode(db.settings.schedule, db.override), uptime: Date.now() - status.started, appVersion: VERSION,
        host: os.hostname(), ips: ips(), port: opts.port, disk: diskInfo(), mediaBytes: mediaBytes(),
        displays: hooks.displays ? hooks.displays() : [], electron: !!hooks.screenshot, platform: process.platform,
      },
    };
  }

  // --- API ---
  async function api(req, res, url) {
    const p = url.pathname;
    const m = req.method;

    if (p === '/api/auth' && m === 'GET') return send(res, 200, { setup: !db.auth, loggedIn: authed(req), name: db.settings.name });

    // Ochrona przed CSRF: zapisy wymagają własnego nagłówka (inna strona nie wyśle go bez CORS).
    if (m !== 'GET' && m !== 'HEAD' && req.headers['x-ekran'] !== '1') return fail(res, 403, 'Brak nagłówka');

    if (p === '/api/setup' && m === 'POST') {
      if (db.auth) return fail(res, 409, 'Hasło jest już ustawione');
      // pierwsze hasło tylko z komputera szkolnego - nikt z sieci nie przejmie panelu przed nami
      if (!isLocal(req)) return fail(res, 403, 'Pierwsze hasło ustaw na komputerze szkolnym (Ctrl+Shift+P)');
      const { password } = await readJson(req);
      if (typeof password !== 'string' || password.length < 8) return fail(res, 400, 'Hasło musi mieć min. 8 znaków');
      db.auth = hashPassword(password); save();
      log('ustawiono hasło administratora');
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': newSession(res) });
    }

    if (p === '/api/login' && m === 'POST') {
      const key = ip(req);
      const f = loginFails.get(key) || { n: 0, t: 0 };
      if (f.n >= 5 && Date.now() - f.t < 10 * 60000) return fail(res, 429, 'Za dużo prób. Spróbuj za 10 minut.');
      const { password } = await readJson(req);
      if (!checkPassword(password, db.auth)) {
        loginFails.set(key, { n: f.n + 1, t: Date.now() });
        log(`nieudane logowanie z ${key}`);
        return fail(res, 401, 'Nieprawidłowe hasło');
      }
      loginFails.delete(key);
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': newSession(res) });
    }

    if (p === '/api/logout' && m === 'POST') {
      sessions.delete(cookie(req, 'ekran_sid'));
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': 'ekran_sid=; Path=/; Max-Age=0' });
    }

    // Odtwarzacz: stan i zdarzenia (lokalnie lub zalogowany - panel używa podglądu).
    if (p === '/api/state' && m === 'GET') {
      if (!isLocal(req) && !authed(req)) return fail(res, 401, 'Zaloguj się');
      return send(res, 200, playerState());
    }
    if (p === '/api/events' && m === 'GET') {
      if (!isLocal(req) && !authed(req)) return fail(res, 401, 'Zaloguj się');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(playerState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/heartbeat' && m === 'POST') {
      if (!isLocal(req)) return fail(res, 403, 'Tylko lokalnie');
      const b = await readJson(req);
      Object.assign(status, { lastBeat: Date.now(), slide: str(b.slide, 200), mode: str(b.mode, 10), errors: num(b.errors, 0, 1e9, 0) });
      return send(res, 200, { ok: true, version });
    }

    // --- dalej tylko administrator ---
    if (!authed(req)) return fail(res, 401, 'Zaloguj się');

    if (p === '/api/admin' && m === 'GET') return send(res, 200, adminView());

    if (p === '/api/media' && m === 'PUT') {
      const name = str(url.searchParams.get('name'), 200) || 'plik';
      const ext = path.extname(name).toLowerCase();
      const kind = MEDIA_EXT[ext];
      if (!kind) return fail(res, 415, 'Dozwolone: JPG, PNG, GIF, WEBP, SVG, MP4, WEBM, MOV');
      if (+req.headers['content-length'] > MAX_UPLOAD) return fail(res, 413, 'Plik większy niż 1 GB');
      const id = crypto.randomUUID();
      const file = id + ext;
      const tmp = path.join(mediaDir, file + '.part');
      let size = 0;
      try {
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(tmp);
          req.on('data', (c) => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); reject(Object.assign(new Error('Plik większy niż 1 GB'), { code: 413 })); } });
          req.pipe(out);
          out.on('finish', resolve);
          out.on('error', reject);
          req.on('error', reject);
          req.on('aborted', () => reject(new Error('Przerwano wysyłanie')));
        });
        await fsp.rename(tmp, path.join(mediaDir, file));
      } catch (e) {
        fsp.unlink(tmp).catch(() => {});
        throw e;
      }
      const item = { id, name, file, type: kind, size, created: Date.now() };
      db.media.unshift(item); save();
      log(`wgrano ${name} (${size} B)`);
      return send(res, 200, item);
    }

    let mm;
    if ((mm = p.match(/^\/api\/media\/([\w-]+)$/)) && m === 'DELETE') {
      const item = db.media.find((x) => x.id === mm[1]);
      if (!item) return fail(res, 404, 'Nie znaleziono');
      db.media = db.media.filter((x) => x !== item);
      db.slides = db.slides.filter((s) => !(s.type === 'media' && s.mediaId === item.id));
      if (db.settings.logoMediaId === item.id) db.settings.logoMediaId = null;
      save();
      fsp.unlink(path.join(mediaDir, item.file)).catch(() => {});
      return send(res, 200, { ok: true });
    }
    if ((mm = p.match(/^\/api\/media\/([\w-]+)$/)) && m === 'PATCH') {
      const item = db.media.find((x) => x.id === mm[1]);
      if (!item) return fail(res, 404, 'Nie znaleziono');
      const b = await readJson(req);
      if (b.name) item.name = str(b.name, 200);
      save();
      return send(res, 200, item);
    }

    if (p === '/api/slides' && m === 'POST') {
      const b = await readJson(req);
      const s = cleanSlide(b);
      if (s.type === 'media' && !db.media.some((x) => x.id === s.mediaId)) return fail(res, 400, 'Wybierz plik');
      if (b.position === 'top') db.slides.unshift(s); else db.slides.push(s);
      save();
      return send(res, 200, s);
    }
    if ((mm = p.match(/^\/api\/slides\/([\w-]+)$/))) {
      const i = db.slides.findIndex((x) => x.id === mm[1]);
      if (i < 0) return fail(res, 404, 'Nie znaleziono');
      if (m === 'PUT') {
        db.slides[i] = cleanSlide(await readJson(req), db.slides[i]); save();
        return send(res, 200, db.slides[i]);
      }
      if (m === 'DELETE') { db.slides.splice(i, 1); save(); return send(res, 200, { ok: true }); }
    }
    if (p === '/api/order' && m === 'PUT') {
      const { ids } = await readJson(req);
      if (!Array.isArray(ids)) return fail(res, 400, 'Brak listy');
      const pos = new Map(ids.map((id, i) => [id, i]));
      db.slides.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
      save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/settings' && m === 'PUT') {
      const prevDisplay = db.settings.display;
      db.settings = cleanSettings(await readJson(req), db.settings); save();
      if (db.settings.display !== prevDisplay && hooks.applyDisplay) hooks.applyDisplay(db.settings.display);
      return send(res, 200, db.settings);
    }
    if (p === '/api/override' && m === 'PUT') {
      const { mode } = await readJson(req);
      db.override = pick(mode, ['auto', 'on', 'eco'], 'auto'); save();
      log(`tryb ręczny: ${db.override}`);
      return send(res, 200, { override: db.override });
    }
    if (p === '/api/password' && m === 'POST') {
      const { oldPassword, newPassword } = await readJson(req);
      if (!checkPassword(oldPassword, db.auth)) return fail(res, 401, 'Obecne hasło jest nieprawidłowe');
      if (typeof newPassword !== 'string' || newPassword.length < 8) return fail(res, 400, 'Nowe hasło: min. 8 znaków');
      db.auth = hashPassword(newPassword);
      sessions.clear(); save();
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': newSession(res) });
    }
    if (p === '/api/reload' && m === 'POST') {
      broadcast('reload');
      if (hooks.reload) hooks.reload();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/screenshot' && m === 'GET') {
      if (!hooks.screenshot) return fail(res, 404, 'Zrzut dostępny tylko w aplikacji');
      const png = await hooks.screenshot();
      if (!png) return fail(res, 503, 'Ekran niedostępny');
      return send(res, 200, png, 'image/jpeg');
    }
    if (p === '/api/logs' && m === 'GET') {
      const f = opts.logFile;
      if (!f) return send(res, 200, '', 'text/plain; charset=utf-8');
      try {
        const txt = await fsp.readFile(f, 'utf8');
        return send(res, 200, txt.split('\n').slice(-200).join('\n'), 'text/plain; charset=utf-8');
      } catch { return send(res, 200, '', 'text/plain; charset=utf-8'); }
    }
    return fail(res, 404, 'Nieznane polecenie');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) return await api(req, res, url);
      if (p.startsWith('/media/')) {
        const f = safeJoin(mediaDir, p.slice(7));
        if (!f) return fail(res, 400, 'Zła ścieżka');
        // sandbox: wgrane SVG nie uruchomi skryptu w kontekście panelu
        return serveFile(req, res, f, { 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'public, max-age=31536000, immutable' });
      }
      if (p === '/' || p === '/admin') { res.writeHead(302, { Location: '/admin/' }); return res.end(); }
      if (p === '/player') { res.writeHead(302, { Location: '/player/' }); return res.end(); }
      let rel = p.endsWith('/') ? p + 'index.html' : p;
      const f = safeJoin(PUBLIC, rel.slice(1));
      if (!f) return fail(res, 400, 'Zła ścieżka');
      return serveFile(req, res, f, { 'Cache-Control': 'no-cache', 'X-Frame-Options': 'SAMEORIGIN' });
    } catch (e) {
      if (!e.code || typeof e.code !== 'number') log('błąd', p, e.stack || e);
      if (!res.headersSent) fail(res, typeof e.code === 'number' ? e.code : 500, e.code ? e.message : 'Błąd serwera');
    }
  });
  server.requestTimeout = 0; // duże pliki wideo przez wolne łącze

  return {
    server, status,
    get db() { return db; },
    listen: (port = opts.port ?? 8080, host = opts.host || '0.0.0.0') => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { opts.port = server.address().port; resolve(opts.port); });
    }),
    close: () => { clearInterval(ticker); for (const c of clients) c.end(); return new Promise((r) => server.close(r)); },
  };
}

module.exports = { createServer, cleanSlide, cleanSettings, defaults };

if (require.main === module) {
  const port = +process.env.EKRAN_PORT || 8080;
  const srv = createServer({ port, dataDir: process.env.EKRAN_DATA || path.join(__dirname, 'data') });
  srv.listen().then((p) => console.log(`Szkolny Ekran: panel http://localhost:${p}/admin/  odtwarzacz http://localhost:${p}/player/`));
}
