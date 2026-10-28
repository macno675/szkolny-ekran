'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createServer } = require('../server');
const { computeMode, slideActive } = require('../lib/schedule');

test('harmonogram: lekcje, wieczór, weekend, przez północ, tryb ręczny', () => {
  const day = { on: true, from: '07:30', to: '16:00' };
  const sch = { enabled: true, days: { 0: { ...day, on: false }, 1: day, 2: day, 3: day, 4: day, 5: day, 6: { ...day, on: false } } };
  const at = (d, h, m) => new Date(2026, 9, d, h, m); // 26.10.2026 = poniedziałek
  assert.equal(computeMode(sch, 'auto', at(26, 8, 0)), 'on');
  assert.equal(computeMode(sch, 'auto', at(26, 7, 29)), 'eco');
  assert.equal(computeMode(sch, 'auto', at(26, 16, 0)), 'eco');
  assert.equal(computeMode(sch, 'auto', at(25, 10, 0)), 'eco'); // niedziela
  assert.equal(computeMode(sch, 'on', at(25, 10, 0)), 'on');
  assert.equal(computeMode(sch, 'eco', at(26, 10, 0)), 'eco');
  assert.equal(computeMode({ ...sch, enabled: false }, 'auto', at(25, 3, 0)), 'on');
  const night = { enabled: true, days: { ...sch.days, 1: { on: true, from: '22:00', to: '06:00' } } };
  assert.equal(computeMode(night, 'auto', at(26, 23, 0)), 'on');
  assert.equal(computeMode(night, 'auto', at(26, 5, 0)), 'on');
  assert.equal(computeMode(night, 'auto', at(26, 12, 0)), 'eco');
});

test('daty slajdu', () => {
  const now = new Date(2026, 9, 28);
  assert.ok(slideActive({ enabled: true }, now));
  assert.ok(!slideActive({ enabled: false }, now));
  assert.ok(slideActive({ from: '2026-10-28', to: '2026-10-28' }, now));
  assert.ok(!slideActive({ from: '2026-10-29' }, now));
  assert.ok(!slideActive({ to: '2026-10-27' }, now));
});

test('API: hasło, uprawnienia, pliki, slajdy, stan', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ekran-'));
  const srv = createServer({ dataDir: dir, log: () => {} });
  const port = await srv.listen(0, '127.0.0.1');
  t.after(async () => { await srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  const call = async (p, { method = 'GET', body, raw, headers = {} } = {}) => {
    const h = { 'x-ekran': '1', cookie, ...headers };
    if (body) h['Content-Type'] = 'application/json';
    const r = await fetch(base + p, { method, headers: h, body: raw ?? (body && JSON.stringify(body)) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
  };

  assert.equal((await call('/api/auth')).data.setup, true);
  assert.equal((await call('/api/admin')).status, 401, 'bez logowania brak dostępu');
  assert.equal((await call('/api/setup', { method: 'POST', body: { password: 'krotkie' } })).status, 400);
  assert.equal((await call('/api/setup', { method: 'POST', body: { password: 'dobre-haslo-123' } })).status, 200);
  assert.equal((await call('/api/setup', { method: 'POST', body: { password: 'inne-haslo-123' } })).status, 409, 'drugi setup zablokowany');
  assert.equal((await call('/api/admin')).status, 200);

  // CSRF: zapis bez nagłówka odrzucony
  const noHdr = await fetch(base + '/api/override', { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"mode":"eco"}' });
  assert.equal(noHdr.status, 403);

  // wgranie pliku i slajd
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b00000000049454e44ae426082', 'hex');
  const up = await call('/api/media?name=plakat.png', { method: 'PUT', raw: png, headers: { 'Content-Type': 'image/png' } });
  assert.equal(up.status, 200);
  assert.equal(up.data.size, png.length);
  assert.equal((await call('/api/media?name=wirus.exe', { method: 'PUT', raw: Buffer.from('x') })).status, 415);
  const media = await fetch(`${base}/media/${up.data.file}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-security-policy'), 'sandbox');
  const ranged = await fetch(`${base}/media/${up.data.file}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 8);
  assert.equal((await fetch(`${base}/media/..%2Fdata.json`)).status, 400, 'brak wyjścia poza folder');

  const s1 = await call('/api/slides', { method: 'POST', body: { type: 'media', mediaId: up.data.id, duration: 9999, transition: 'zła' } });
  assert.equal(s1.data.duration, 3600, 'czas przycięty');
  assert.equal(s1.data.transition, 'fade', 'nieznane przejście -> domyślne');
  const s2 = await call('/api/slides', { method: 'POST', body: { type: 'text', title: '<script>alert(1)</script>', to: '2000-01-01' } });
  await call('/api/slides', { method: 'POST', body: { type: 'loop', template: 'promo', title: 'Pizza' } });
  assert.equal((await call('/api/slides', { method: 'POST', body: { type: 'media', mediaId: 'nie-ma' } })).status, 400);

  // stan odtwarzacza: wygasły slajd odfiltrowany, plik dołączony
  await call('/api/override', { method: 'PUT', body: { mode: 'on' } });
  const st = (await call('/api/state')).data;
  assert.equal(st.mode, 'on');
  assert.equal(st.slides.length, 2);
  assert.equal(st.slides[0].media.file, up.data.file);
  assert.ok(!('auth' in st) && !JSON.stringify(st).includes('hash'), 'stan nie zdradza hasła');

  // kolejność, edycja, usunięcie pliku usuwa jego slajdy
  const ids = (await call('/api/admin')).data.slides.map((s) => s.id).reverse();
  await call('/api/order', { method: 'PUT', body: { ids } });
  assert.deepEqual((await call('/api/admin')).data.slides.map((s) => s.id), ids);
  await call(`/api/slides/${s2.data.id}`, { method: 'PUT', body: { to: '' } });
  assert.equal((await call('/api/state')).data.slides.length, 3);
  await call(`/api/media/${up.data.id}`, { method: 'DELETE' });
  assert.equal((await call('/api/admin')).data.slides.length, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'media', up.data.file)));

  // harmonogram z panelu jest walidowany
  await call('/api/settings', { method: 'PUT', body: { schedule: { enabled: true, days: { 1: { on: true, from: '25:99', to: '15:00' } } } } });
  const sch = (await call('/api/admin')).data.settings.schedule;
  assert.equal(sch.days[1].from, '07:30');
  assert.equal(sch.days[1].to, '15:00');

  // dane przetrwały restart
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  assert.equal(saved.slides.length, 2);

  // logowanie: złe hasło, blokada po 5 próbach
  await call('/api/logout', { method: 'POST' });
  cookie = '';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/login', { method: 'POST', body: { password: 'zle-haslo' } })).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { password: 'dobre-haslo-123' } })).status, 429);
});
