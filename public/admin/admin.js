'use strict';
// Panel sterowania Szkolnym Ekranem. Bez bibliotek: dane z /api/admin, widoki jako szablony HTML.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => `<svg><use href="#i-${n}"/></svg>`;
const mediaUrl = (m) => `/media/${encodeURIComponent(m.file)}`;

const TYPE_LABEL = { media: 'Zdjęcie / film', text: 'Ogłoszenie', loop: 'Animacja' };
const TPL = { promo: 'Promocja', event: 'Odliczanie', list: 'Lista / menu', clock: 'Zegar powitalny', marquee: 'Napisy w ruchu' };
const TR = { fade: 'Przenikanie', slide: 'Przesunięcie', up: 'Wjazd z dołu', zoom: 'Zoom', blur: 'Rozmycie', flip: 'Obrót 3D', random: 'Losowe' };
const THEMES = { aurora: 'Zorza', sunset: 'Zachód słońca', forest: 'Las', royal: 'Granat i złoto', mono: 'Grafit', alert: 'Pilne', candy: 'Cukierek' };
const DAYS = [[1, 'Poniedziałek'], [2, 'Wtorek'], [3, 'Środa'], [4, 'Czwartek'], [5, 'Piątek'], [6, 'Sobota'], [0, 'Niedziela']];
const EMOJI = ['📢', '🎉', '⚽', '📚', '🍕', '🎭', '🏆', '⚠️', '🎵', '🧪', '🗓️', '💡', '❤️', '🎄', '🌸', '☀️'];
const ACCENTS = ['#6d5dfc', '#22d3ee', '#16a37f', '#ff6b3d', '#e5262b', '#f5c451', '#ff4fa3'];

let D = null;
let view = 'dash';
try { view = localStorage.getItem('ekran.view') || 'dash'; } catch {}
let poll = null;

// ---------- narzędzia ----------
async function api(path, { method = 'GET', body } = {}) {
  const o = { method, headers: { 'x-ekran': '1' } };
  if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const r = await fetch(path, o);
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !['/api/login', '/api/password'].includes(path)) { showAuth(false); throw new Error('Sesja wygasła - zaloguj się'); }
  if (!r.ok) throw new Error(data.error || `Błąd ${r.status}`);
  return data;
}

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.innerHTML = `${icon(bad ? 'x' : 'check')}<span>${esc(msg)}</span>`;
  $('#toasts').append(t);
  setTimeout(() => { t.style.transition = '.3s'; t.style.opacity = 0; t.style.transform = 'translateY(10px)'; setTimeout(() => t.remove(), 300); }, bad ? 5000 : 2600);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`);
function fmtUptime(ms) {
  const m = Math.floor(ms / 6e4), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d} d ${h % 24} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
}
const today = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const isActive = (s) => s.enabled !== false && !(s.from && today() < s.from) && !(s.to && today() > s.to);
const mediaById = (id) => D.media.find((m) => m.id === id);
const slideTitle = (s) => s.title || (s.type === 'media' ? mediaById(s.mediaId)?.name || 'Plik' : s.type === 'loop' ? TPL[s.template] : 'Ogłoszenie');
const toMin = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };

// ---------- logowanie ----------
let setupMode = false;
function showAuth(setup) {
  setupMode = setup;
  clearInterval(poll);
  $('#app').hidden = true;
  $('#drawer').hidden = true;
  $('#auth').hidden = false;
  $('#authTitle').textContent = setup ? 'Witaj! Ustaw hasło' : 'Zaloguj się';
  $('#authSub').textContent = setup ? 'Pierwsze uruchomienie: wybierz hasło administratora (min. 8 znaków). Zapisz je w bezpiecznym miejscu.' : 'Panel sterowania Szkolnym Ekranem';
  $('#authBtn').textContent = setup ? 'Ustaw hasło i wejdź' : 'Zaloguj';
  $('#pw2wrap').hidden = !setup;
  $('#pw').autocomplete = setup ? 'new-password' : 'current-password';
  $('#pw').value = ''; $('#pw2').value = ''; $('#authErr').textContent = '';
  $('#pw').focus();
}
$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('#pw').value;
  try {
    if (setupMode) {
      if (pw !== $('#pw2').value) throw new Error('Hasła nie są takie same');
      await api('/api/setup', { method: 'POST', body: { password: pw } });
    } else {
      await api('/api/login', { method: 'POST', body: { password: pw } });
    }
    startApp();
  } catch (err) { $('#authErr').textContent = err.message; }
});
$('#logout').addEventListener('click', guard(async () => { await api('/api/logout', { method: 'POST' }); showAuth(false); }));

async function startApp() {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  await load();
  go(view);
  clearInterval(poll);
  poll = setInterval(async () => {
    try { D = await api('/api/admin'); updateLive(); if (view === 'dash') updateDash(); } catch {}
  }, 5000);
}
async function load() {
  D = await api('/api/admin');
  $('#brandName').textContent = D.settings.name;
  document.title = `${D.settings.name} – panel`;
  updateLive();
}
function updateLive() {
  const s = D.status, el = $('#sideLive');
  el.className = 'live ' + (s.online ? 'ok' : 'bad');
  el.querySelector('span').textContent = s.online ? (s.mode === 'eco' ? 'Ekran: tryb nocny' : 'Ekran działa') : 'Ekran nie odpowiada';
}

// ---------- nawigacja ----------
const VIEWS = {
  dash: ['Pulpit', 'Co dzieje się teraz na telewizorze', renderDash],
  playlist: ['Playlista', 'Kolejność i czas wyświetlania. Przeciągnij, żeby zmienić kolejność.', renderPlaylist],
  media: ['Pliki', 'Zdjęcia i filmy do wyświetlania', renderMedia],
  schedule: ['Harmonogram', 'Kiedy ekran pokazuje treści, a kiedy przechodzi w tryb nocny', renderSchedule],
  settings: ['Ustawienia', 'Wygląd, pasek informacyjny, hasło i diagnostyka', renderSettings],
};
function go(v) {
  if (!VIEWS[v]) v = 'dash';
  view = v;
  try { localStorage.setItem('ekran.view', v); } catch {}
  $$('.nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  const [t, sub, fn] = VIEWS[v];
  $('#viewTitle').textContent = t;
  $('#viewSub').textContent = sub;
  $('#topActions').innerHTML = '';
  const el = $('#view');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  fn(el);
}
$$('.nav button').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
function topActions(html) { $('#topActions').innerHTML = html; }
const newSlideBtn = `<button class="btn primary" data-new>${icon('plus')}Nowy slajd</button>`;
document.addEventListener('click', (e) => {
  const n = e.target.closest('[data-new]');
  if (n) openEditor(null, n.dataset.new || null);
  const u = e.target.closest('[data-upload]');
  if (u) pickFiles(u.dataset.upload === 'screen');
});

// ---------- grafiki ----------
function dayBar(day, enabled, { labels = true, now = false } = {}) {
  const W = 720, H = 26, y = 4, h = 18;
  const x = (min) => (min / 1440) * W;
  let segs = '';
  if (!enabled) segs = `<rect x="0" y="${y}" width="${W}" height="${h}" rx="7" fill="url(#gAccent)" opacity=".85"/>`;
  else if (day && day.on) {
    const a = toMin(day.from), b = toMin(day.to);
    const r = (s, e) => `<rect x="${x(s)}" y="${y}" width="${Math.max(2, x(e) - x(s))}" height="${h}" rx="7" fill="url(#gAccent)"/>`;
    segs = a <= b ? r(a, b) : r(a, 1440) + r(0, b);
  }
  const ticks = '';
  const hours = labels ? `<div class="hours">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((i) => `<span>${String(i).padStart(2, '0')}</span>`).join('')}</div>` : '';
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  const marker = now ? `<line x1="${x(nm)}" x2="${x(nm)}" y1="0" y2="${y + h + 4}" stroke="#fff" stroke-width="2"/><circle cx="${x(nm)}" cy="1.5" r="4" fill="#fff"/>` : '';
  return `<svg class="${labels ? 'daybar' : 'bar24'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Godziny wyświetlania"><rect x="0" y="${y}" width="${W}" height="${h}" rx="7" fill="rgba(255,255,255,.06)"/>${segs}${ticks}${marker}</svg>${hours}`;
}

const ILL = {
  media: `<svg class="ill" viewBox="0 0 120 76"><rect x="10" y="8" width="100" height="60" rx="8" fill="#1b2140"/><rect x="16" y="14" width="88" height="48" rx="5" fill="#2b3566"/><circle cx="84" cy="27" r="7" fill="#ffd23f"/><path d="M16 62l26-26 18 18 12-10 32 18z" fill="#6d5dfc"/><path d="M42 62l30-24 32 24z" fill="#22d3ee" opacity=".8"/></svg>`,
  text: `<svg class="ill" viewBox="0 0 120 76"><rect x="10" y="8" width="100" height="60" rx="8" fill="url(#gAccent)"/><rect x="22" y="22" width="56" height="8" rx="4" fill="#fff"/><rect x="22" y="36" width="76" height="5" rx="2.5" fill="#fff" opacity=".6"/><rect x="22" y="46" width="60" height="5" rx="2.5" fill="#fff" opacity=".45"/><text x="90" y="32" font-size="16">📢</text></svg>`,
  loop: `<svg class="ill" viewBox="0 0 120 76"><rect x="10" y="8" width="100" height="60" rx="8" fill="#3a0f1e"/><g opacity=".5" fill="#7a1e3a"><path d="M60 38 30 8h12zM60 38l40-30v12zM60 38l40 30H88zM60 38 20 68v-12z"/></g><circle cx="60" cy="38" r="16" fill="#ffc94a"/><path d="M55 31v14l12-7z" fill="#3a0f1e"/><path d="M96 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff"/></svg>`,
};
const TPL_ILL = {
  promo: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#2a0b1c"/><g fill="#7a1e3a"><path d="M80 45 40 0h16zM80 45 120 0h16zM80 45l80 10v14zM80 45 0 70V56zM80 45l-20 45h16zM80 45l40 45h-14z"/></g><rect x="14" y="30" width="62" height="10" rx="3" fill="#fff"/><rect x="14" y="44" width="46" height="10" rx="3" fill="#fff"/><rect x="14" y="60" width="40" height="4" rx="2" fill="#fff" opacity=".6"/><circle cx="122" cy="46" r="22" fill="#ffc94a"/><text x="122" y="51" text-anchor="middle" font-size="13" font-weight="900" fill="#2a0b1c" font-family="sans-serif">-50%</text></svg>`,
  event: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#0b0d2e"/><circle cx="20" cy="20" r="30" fill="#6d5dfc" opacity=".4"/><rect x="50" y="14" width="60" height="7" rx="3" fill="#fff"/>${[0, 1, 2, 3].map((i) => `<rect x="${22 + i * 30}" y="34" width="24" height="30" rx="5" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.25)"/><text x="${34 + i * 30}" y="54" text-anchor="middle" font-size="12" font-weight="800" fill="#22d3ee" font-family="sans-serif">${['12', '05', '43', '09'][i]}</text>`).join('')}<circle cx="140" cy="78" r="2" fill="#22d3ee"/><circle cx="30" cy="80" r="1.5" fill="#22d3ee"/></svg>`,
  list: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#06201a"/><rect x="14" y="10" width="54" height="8" rx="3" fill="#fff"/>${[0, 1, 2, 3].map((i) => `<rect x="14" y="${26 + i * 15}" width="132" height="11" rx="3" fill="${i === 1 ? '#16a37f' : 'rgba(255,255,255,.07)'}"/><rect x="19" y="${29.5 + i * 15}" width="40" height="4" rx="2" fill="#fff" opacity=".8"/><rect x="124" y="${29.5 + i * 15}" width="16" height="4" rx="2" fill="#b6f36b"/>`).join('')}</svg>`,
  clock: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#0b0d2e"/><circle cx="46" cy="45" r="28" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.12)" stroke-width="2"/><path d="M46 17a28 28 0 0 1 26 36" fill="none" stroke="#22d3ee" stroke-width="3" stroke-linecap="round"/><text x="46" y="50" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="sans-serif">8:15</text><rect x="86" y="34" width="56" height="8" rx="3" fill="#fff"/><rect x="86" y="48" width="40" height="5" rx="2.5" fill="#22d3ee"/></svg>`,
  marquee: `<svg viewBox="0 0 160 90"><rect width="160" height="90" fill="#1d0a2b"/><g transform="rotate(-8 80 45)" font-family="sans-serif" font-weight="900" font-size="17"><text x="-10" y="26" fill="#7cf5ff">SZKOŁA ★ SZKOŁA ★</text><text x="-30" y="48" fill="none" stroke="#fff" stroke-width=".8">SZKOŁA ★ SZKOŁA ★</text><text x="-4" y="70" fill="#fff">SZKOŁA ★ SZKOŁA ★</text></g></svg>`,
};
const EMPTY_ILL = `<svg class="illu" viewBox="0 0 220 130"><rect x="40" y="30" width="140" height="80" rx="12" fill="#151a30" transform="rotate(-6 110 70)"/><rect x="40" y="26" width="140" height="80" rx="12" fill="#1c2240" transform="rotate(4 110 66)"/><rect x="36" y="22" width="148" height="86" rx="12" fill="url(#gAccent)"/><rect x="54" y="44" width="70" height="9" rx="4.5" fill="#fff"/><rect x="54" y="60" width="100" height="6" rx="3" fill="#fff" opacity=".6"/><rect x="54" y="72" width="80" height="6" rx="3" fill="#fff" opacity=".4"/><circle cx="176" cy="26" r="16" fill="#ffd23f"/><path d="M176 18v16M168 26h16" stroke="#1c2240" stroke-width="3.5" stroke-linecap="round"/></svg>`;
const DROP_ILL = `<svg class="illu" viewBox="0 0 120 90"><rect x="18" y="30" width="44" height="34" rx="6" fill="#1c2240" transform="rotate(-10 40 47)"/><rect x="58" y="28" width="44" height="34" rx="6" fill="#2b3566" transform="rotate(8 80 45)"/><circle cx="88" cy="38" r="4" fill="#ffd23f"/><path d="M62 60l12-12 8 8 6-5 12 9z" fill="#22d3ee" transform="rotate(8 80 45)"/><circle cx="60" cy="50" r="22" fill="url(#gAccent)"/><path d="M60 60V41M52 48l8-8 8 8" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function thumb(s) {
  if (s.type === 'media') {
    const m = mediaById(s.mediaId);
    if (!m) return `<div class="mini sw-mono">${icon('x')}Brak pliku</div>`;
    return m.type === 'video' ? `<video src="${mediaUrl(m)}#t=1" muted preload="metadata"></video>` : `<img src="${mediaUrl(m)}" alt="" loading="lazy">`;
  }
  const ic = s.type === 'loop' ? icon('sparkles') : s.icon ? `<span style="font-size:16px">${esc(s.icon)}</span>` : icon('type');
  return `<div class="mini sw-${esc(s.theme)}">${ic}<span>${esc(slideTitle(s)).slice(0, 60)}</span></div>`;
}

// ---------- PULPIT ----------
function renderDash(el) {
  topActions(`<button class="btn" data-upload="screen">${icon('upload')}Wgraj zdjęcie na ekran</button>${newSlideBtn}`);
  const s = D.status;
  el.innerHTML = `
  <div class="grid dash">
    <div class="card hero">
      <div class="tv"><span class="rec"><i></i>NA ŻYWO</span><div class="tv-screen">${s.electron ? '<img id="shot" alt="Aktualny obraz na telewizorze">' : '<iframe class="scaled" src="/player/?watch=1" title="Podgląd ekranu"></iframe>'}</div></div>
      <div class="hero-info">
        <div class="pills" id="dPills"></div>
        <div><div class="now">Teraz na ekranie</div><h2 id="dNow">–</h2></div>
        <div>
          <div class="field" style="margin-bottom:8px"><span>Tryb pracy ekranu</span></div>
          <div class="seg" id="modeSeg" role="radiogroup" aria-label="Tryb pracy">
            <button data-mode="auto" role="radio">${icon('clock')}Automatyczny</button>
            <button data-mode="on" role="radio">${icon('sun')}Zawsze treści</button>
            <button data-mode="eco" role="radio">${icon('moon')}Tryb nocny</button>
          </div>
          <p class="muted" id="modeHint" style="margin-top:10px;font-size:13px"></p>
        </div>
        <div class="row" style="flex-wrap:wrap;flex:none">
          <button class="btn" id="reloadBtn" style="flex:none">${icon('refresh')}Odśwież ekran</button>
          <a class="btn ghost" href="/player/?watch=1" target="_blank" rel="noopener" style="flex:none">${icon('eye')}Pełny podgląd</a>
        </div>
      </div>
    </div>
    <div class="card stat"><div class="ico">${icon('list')}</div><div><b id="stSlides">–</b></div><span>aktywnych slajdów</span><div class="meter"><i id="stSlidesM"></i></div></div>
    <div class="card stat"><div class="ico">${icon('refresh')}</div><div><b id="stCycle">–</b></div><span>trwa pełny obieg playlisty</span></div>
    <div class="card stat"><div class="ico">${icon('disk')}</div><div><b id="stDisk">–</b></div><span id="stDiskL">wolnego miejsca</span><div class="meter"><i id="stDiskM"></i></div></div>
    <div class="card stat"><div class="ico">${icon('bolt')}</div><div><b id="stUp">–</b></div><span>bez przerwy w pracy</span></div>
    <div class="card today">
      <h3>${icon('cal')}Dzisiaj</h3><p class="sub" id="todayTxt"></p>
      <div id="todayBar"></div>
    </div>
    <div class="card quick">
      <h3 style="margin-bottom:6px">${icon('sparkles')}Szybkie akcje</h3>
      <button class="qa" data-new="text"><span class="art sw-aurora">${icon('type')}</span><span><b>Nowe ogłoszenie</b><small>Tekst na kolorowym tle z animacją</small></span></button>
      <button class="qa" data-upload="screen"><span class="art sw-forest">${icon('image')}</span><span><b>Zdjęcie lub film</b><small>Wgraj i od razu pokaż na ekranie</small></span></button>
      <button class="qa" data-new="loop"><span class="art sw-sunset">${icon('sparkles')}</span><span><b>Animacja w pętli</b><small>Promocja, odliczanie, menu, zegar</small></span></button>
    </div>
    <div class="card access">
      <div class="globe">${icon('globe')}</div>
      <div><h3>Dostęp do panelu</h3><p class="sub">W szkolnej sieci wpisz jeden z adresów. Z domu: przez Tailscale (instrukcja krok po kroku w zakładce Instrukcja).</p>
        <div class="addr">${[`localhost:${s.port}`, ...s.ips.map((i) => `${i}:${s.port}`)].map((a) => `<code>http://${esc(a)}</code>`).join('')}</div></div>
      <a class="btn" href="help.html#zdalnie">${icon('book')}Jak połączyć z domu</a>
    </div>
  </div>`;
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', guard(async () => {
    await api('/api/override', { method: 'PUT', body: { mode: b.dataset.mode } });
    D = await api('/api/admin'); updateDash(); updateLive();
    toast({ auto: 'Tryb automatyczny wg harmonogramu', on: 'Ekran pokazuje treści', eco: 'Włączono tryb nocny' }[b.dataset.mode]);
  })));
  $('#reloadBtn').addEventListener('click', guard(async () => { await api('/api/reload', { method: 'POST' }); toast('Ekran został odświeżony'); }));
  updateDash();
}

function updateDash() {
  if (!$('#dPills')) return;
  const s = D.status;
  const ago = s.lastBeat ? Math.round((Date.now() - s.lastBeat) / 1000) : null;
  $('#dPills').innerHTML = `
    <span class="pill ${s.online ? 'ok' : 'bad'}"><i></i>${s.online ? 'Online' : `Brak sygnału${ago ? ` od ${fmtUptime(ago * 1000)}` : ''}`}</span>
    <span class="pill ${s.mode === 'eco' ? 'p-night' : 'p-day'}">${icon(s.mode === 'eco' ? 'moon' : 'sun')}${s.mode === 'eco' ? 'Tryb nocny' : 'Wyświetlanie treści'}</span>
    ${s.errors ? `<span class="pill bad"><i></i>${s.errors} pominiętych slajdów</span>` : ''}`;
  $('#dNow').textContent = s.online ? s.slide || '–' : 'Ekran nie odpowiada';
  $$('#modeSeg button').forEach((b) => { const on = b.dataset.mode === D.override; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('#modeHint').textContent = { auto: 'Treści w godzinach z harmonogramu, poza nimi ciemny ekran z logo.', on: 'Ręcznie: treści cały czas, harmonogram jest pominięty.', eco: 'Ręcznie: tryb nocny cały czas, dopóki nie wrócisz do automatycznego.' }[D.override];
  const active = D.slides.filter(isActive);
  $('#stSlides').textContent = `${active.length} / ${D.slides.length}`;
  $('#stSlidesM').style.width = `${D.slides.length ? (active.length / D.slides.length) * 100 : 0}%`;
  $('#stCycle').textContent = fmtDur(active.reduce((a, x) => a + x.duration, 0));
  if (s.disk) {
    $('#stDisk').textContent = fmtBytes(s.disk.free);
    $('#stDiskL').textContent = `wolnego miejsca · pliki: ${fmtBytes(s.mediaBytes)}`;
    $('#stDiskM').style.width = `${(1 - s.disk.free / s.disk.total) * 100}%`;
  }
  $('#stUp').textContent = fmtUptime(s.uptime);
  const d = new Date().getDay(), sch = D.settings.schedule, day = sch.days[d];
  $('#todayTxt').textContent = !sch.enabled ? 'Harmonogram wyłączony - treści przez całą dobę.' : day.on ? `Treści od ${day.from} do ${day.to}, poza tymi godzinami tryb nocny.` : 'Dzień wolny - przez cały dzień tryb nocny.';
  const onMin = !sch.enabled ? 1440 : !day.on ? 0 : ((toMin(day.to) - toMin(day.from) + 1440) % 1440) || 1440;
  const hm = (m) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
  $('#todayBar').innerHTML = dayBar(day, sch.enabled, { now: true }) +
    `<div class="split"><div><i style="background:var(--grad)"></i>Treści<b>${hm(onMin)}</b></div><div><i style="background:#1e2236"></i>Tryb nocny<b>${hm(1440 - onMin)}</b></div><div><i style="background:#fff"></i>Teraz<b>${new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</b></div></div>`;
  const shot = $('#shot');
  if (shot) { const im = new Image(); im.onload = () => { shot.src = im.src; }; im.src = `/api/screenshot?t=${Date.now()}`; }
}

// ---------- PLAYLISTA ----------
function renderPlaylist(el) {
  topActions(`<button class="btn" data-upload="screen">${icon('upload')}Wgraj pliki</button>${newSlideBtn}`);
  if (!D.slides.length) {
    el.innerHTML = `<div class="empty">${EMPTY_ILL}<h3>Playlista jest pusta</h3><p>Dodaj pierwsze ogłoszenie, zdjęcie albo animację. Ekran pokazuje teraz zegar i nazwę szkoły.</p>
      <div class="row" style="justify-content:center;flex-wrap:wrap"><button class="btn primary" data-new="text" style="flex:none">${icon('type')}Ogłoszenie</button><button class="btn" data-upload="screen" style="flex:none">${icon('image')}Zdjęcie / film</button><button class="btn" data-new="loop" style="flex:none">${icon('sparkles')}Animacja</button></div></div>`;
    return;
  }
  const total = D.slides.filter(isActive).reduce((a, s) => a + s.duration, 0);
  const tl = D.slides.map((s) => {
    const bgc = s.type === 'media' ? 'sw-mono' : `sw-${esc(s.theme)}`;
    return `<div class="${bgc} ${isActive(s) ? '' : 'off'}" style="flex:${s.duration}" title="${esc(slideTitle(s))} · ${s.duration} s">${s.duration >= 6 ? esc(slideTitle(s)).slice(0, 18) : ''}</div>`;
  }).join('');
  el.innerHTML = `
    <div class="timeline" aria-hidden="true">${tl}</div>
    <div class="tl-legend"><span>Oś czasu jednego obiegu - szerokość = czas wyświetlania</span><span>Pełny obieg: <b>${fmtDur(total)}</b>, potem od nowa</span></div>
    <div class="slides" id="slides">${D.slides.map((s, i) => {
      const act = isActive(s);
      const when = s.from && today() < s.from ? `<span class="chip">${icon('cal')}od ${esc(s.from)}</span>` : s.to && today() > s.to ? `<span class="chip" style="color:var(--bad)">${icon('cal')}wygasło ${esc(s.to)}</span>` : s.to ? `<span class="chip">${icon('cal')}do ${esc(s.to)}</span>` : '';
      return `
      <div class="slide-row ${act ? '' : 'disabled'}" draggable="true" data-id="${s.id}">
        <div class="handle"><button class="icon-btn" data-mv="-1" aria-label="W górę">${icon('up')}</button>${icon('grip')}<button class="icon-btn" data-mv="1" aria-label="W dół">${icon('down')}</button></div>
        <div class="thumb">${thumb(s)}<span class="num">${i + 1}</span></div>
        <div class="info"><b>${esc(slideTitle(s))}</b>
          <div class="meta"><span class="chip">${icon(s.type === 'media' ? 'image' : s.type === 'loop' ? 'sparkles' : 'type')}${s.type === 'loop' ? TPL[s.template] : TYPE_LABEL[s.type]}</span>
          <span class="chip">${icon('clock')}${s.type === 'media' && s.videoFull ? 'cały film' : fmtDur(s.duration)}</span><span class="chip">${TR[s.transition]}</span>${when}</div></div>
        <label class="switch" title="Pokazuj na ekranie"><input type="checkbox" data-toggle ${s.enabled ? 'checked' : ''} aria-label="Pokazuj na ekranie"><i></i></label>
        <div class="row-actions">
          <button class="icon-btn" data-edit aria-label="Edytuj">${icon('edit')}</button>
          <button class="icon-btn" data-dup aria-label="Duplikuj">${icon('copy')}</button>
          <button class="icon-btn danger" data-del aria-label="Usuń">${icon('trash')}</button>
        </div>
      </div>`;
    }).join('')}</div>`;

  const list = $('#slides');
  const byRow = (e) => D.slides.find((s) => s.id === e.target.closest('.slide-row')?.dataset.id);
  const saveOrder = guard(async (ids) => { await api('/api/order', { method: 'PUT', body: { ids } }); await load(); go('playlist'); });
  list.addEventListener('click', guard(async (e) => {
    const s = byRow(e); if (!s) return;
    if (e.target.closest('[data-edit]') || e.target.closest('.thumb') || e.target.closest('.info')) return openEditor(s);
    if (e.target.closest('[data-dup]')) {
      const { id, created, ...copy } = s;
      await api('/api/slides', { method: 'POST', body: { ...copy, title: copy.title ? `${copy.title} (kopia)` : copy.title } });
      await load(); go('playlist'); return toast('Skopiowano slajd');
    }
    if (e.target.closest('[data-del]')) {
      if (!confirm(`Usunąć slajd „${slideTitle(s)}”?`)) return;
      await api(`/api/slides/${s.id}`, { method: 'DELETE' }); await load(); go('playlist'); return toast('Usunięto slajd');
    }
    const mv = e.target.closest('[data-mv]');
    if (mv) {
      const ids = D.slides.map((x) => x.id), i = ids.indexOf(s.id), j = i + +mv.dataset.mv;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      saveOrder(ids);
    }
  }));
  list.addEventListener('change', guard(async (e) => {
    if (!e.target.matches('[data-toggle]')) return;
    const s = byRow(e);
    await api(`/api/slides/${s.id}`, { method: 'PUT', body: { enabled: e.target.checked } });
    await load(); go('playlist');
    toast(e.target.checked ? 'Slajd będzie wyświetlany' : 'Slajd ukryty');
  }));
  let dragId = null;
  list.addEventListener('dragstart', (e) => { const r = e.target.closest('.slide-row'); dragId = r.dataset.id; r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  list.addEventListener('dragend', () => $$('.slide-row').forEach((r) => r.classList.remove('dragging', 'over')));
  list.addEventListener('dragover', (e) => { e.preventDefault(); const r = e.target.closest('.slide-row'); $$('.slide-row.over').forEach((x) => x !== r && x.classList.remove('over')); r?.classList.add('over'); });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const r = e.target.closest('.slide-row'); if (!r || !dragId || r.dataset.id === dragId) return;
    const ids = D.slides.map((x) => x.id).filter((x) => x !== dragId);
    ids.splice(ids.indexOf(r.dataset.id) + (D.slides.findIndex((x) => x.id === dragId) < D.slides.findIndex((x) => x.id === r.dataset.id) ? 1 : 0), 0, dragId);
    saveOrder(ids);
  });
}

// ---------- WGRYWANIE ----------
let uploadToScreen = true;
function pickFiles(toScreen) {
  uploadToScreen = toScreen;
  const f = $('#file'); f.value = ''; f.click();
}
$('#file').addEventListener('change', (e) => uploadFiles([...e.target.files], uploadToScreen));

function putFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/media?name=${encodeURIComponent(file.name)}`);
    x.setRequestHeader('x-ekran', '1');
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d.error || `Błąd ${x.status}`)); };
    x.onerror = () => reject(new Error('Brak połączenia z ekranem'));
    x.send(file);
  });
}

async function uploadFiles(files, toScreen, onDone) {
  if (!files.length) return;
  const created = [];
  for (const file of files) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.flexDirection = 'column'; t.style.alignItems = 'stretch';
    t.innerHTML = `<div style="display:flex;gap:10px;align-items:center">${icon('upload')}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(file.name)}</span><b class="pct">0%</b></div><div class="up" style="padding:0;border:0;background:none"><div class="bar"><i></i></div></div>`;
    $('#toasts').append(t);
    try {
      const m = await putFile(file, (p) => { t.querySelector('.bar i').style.width = `${p * 100}%`; t.querySelector('.pct').textContent = `${Math.round(p * 100)}%`; });
      created.push(m);
      if (toScreen) await api('/api/slides', { method: 'POST', body: { type: 'media', mediaId: m.id, duration: D.settings.duration, transition: D.settings.transition, fit: 'cover' } });
      t.remove();
    } catch (e) { t.remove(); toast(`${file.name}: ${e.message}`, true); }
  }
  if (created.length) toast(toScreen ? `Wgrano ${created.length} - już są na ekranie` : `Wgrano ${created.length} plik(ów)`);
  await load();
  if (onDone) onDone(created); else go(view);
}

// ---------- PLIKI ----------
function renderMedia(el) {
  topActions(`<button class="btn primary" data-upload="lib">${icon('upload')}Wgraj pliki</button>`);
  el.innerHTML = `
    <div class="drop" id="drop">${DROP_ILL}
      <div><h3>Przeciągnij tutaj zdjęcia lub filmy</h3><p>JPG, PNG, GIF, WEBP, SVG, MP4, WEBM · do 1 GB · najlepiej 1920×1080 (poziomo)</p>
        <label class="switch" style="margin-top:12px"><input type="checkbox" id="autoScreen" checked><i></i>Od razu dodaj na ekran</label></div>
      <button class="btn primary" id="pickBtn">${icon('upload')}Wybierz z dysku</button>
    </div>
    ${D.media.length ? `<div class="mgrid">${D.media.map((m) => `
      <div class="mcard" data-id="${m.id}">
        <div class="thumb">${m.type === 'video' ? `<video src="${mediaUrl(m)}#t=1" muted preload="metadata"></video>` : `<img src="${mediaUrl(m)}" alt="" loading="lazy">`}
          <span class="badge">${icon(m.type === 'video' ? 'film' : 'image')}${m.type === 'video' ? 'Film' : 'Zdjęcie'}</span>
          ${D.settings.logoMediaId === m.id ? `<span class="badge logo">${icon('star')}Logo</span>` : ''}</div>
        <div class="body"><b title="${esc(m.name)}">${esc(m.name)}</b><small>${fmtBytes(m.size)} · ${new Date(m.created).toLocaleDateString('pl-PL')}${D.slides.some((s) => s.mediaId === m.id) ? ' · na playliście' : ''}</small>
          <div class="acts"><button class="btn sm primary" data-show>${icon('play')}Na ekran</button>${m.type === 'image' ? `<button class="btn sm" data-logo title="Ustaw jako logo szkoły">${icon('star')}</button>` : ''}<button class="btn sm danger" data-rm aria-label="Usuń plik">${icon('trash')}</button></div></div>
      </div>`).join('')}</div>` : `<p class="muted center" style="padding:30px">Brak plików. Wgraj pierwsze zdjęcie.</p>`}`;
  const drop = $('#drop');
  $('#pickBtn').addEventListener('click', () => pickFiles($('#autoScreen').checked));
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); uploadFiles([...e.dataTransfer.files], $('#autoScreen').checked); });
  el.addEventListener('click', guard(async (e) => {
    const card = e.target.closest('.mcard'); if (!card) return;
    const m = mediaById(card.dataset.id);
    if (e.target.closest('[data-show]')) {
      await api('/api/slides', { method: 'POST', body: { type: 'media', mediaId: m.id, duration: D.settings.duration, transition: D.settings.transition } });
      await load(); go('media'); toast('Dodano na koniec playlisty');
    } else if (e.target.closest('[data-logo]')) {
      await api('/api/settings', { method: 'PUT', body: { logoMediaId: m.id } });
      await load(); go('media'); toast('Ustawiono logo szkoły');
    } else if (e.target.closest('[data-rm]')) {
      const used = D.slides.filter((s) => s.mediaId === m.id).length;
      if (!confirm(`Usunąć „${m.name}”?${used ? `\nZniknie też z playlisty (${used} slajd).` : ''}`)) return;
      await api(`/api/media/${m.id}`, { method: 'DELETE' }); await load(); go('media'); toast('Usunięto plik');
    }
  }));
}

// ---------- HARMONOGRAM ----------
function renderSchedule(el) {
  const sch = structuredClone(D.settings.schedule);
  let ecoText = D.settings.ecoText;
  const logo = mediaById(D.settings.logoMediaId);
  topActions(`<button class="btn primary" id="schSave">${icon('check')}Zapisz harmonogram</button>`);
  const wd = new Date().getDay();
  el.innerHTML = `
  <div class="sched">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h3>${icon('cal')}Godziny wyświetlania treści</h3><p class="sub">Poza nimi ekran przechodzi w tryb nocny. Komputer i telewizor zostają włączone.</p></div>
        <label class="switch"><input type="checkbox" id="schOn" ${sch.enabled ? 'checked' : ''}><i></i>Harmonogram włączony</label>
      </div>
      <div class="days" id="days">${DAYS.map(([d, name]) => `
        <div class="day ${sch.days[d].on ? '' : 'off'} ${d === wd ? 'today' : ''}" data-d="${d}">
          <label class="switch"><input type="checkbox" data-f="on" ${sch.days[d].on ? 'checked' : ''}><i></i>${name}</label>
          <input type="time" data-f="from" value="${sch.days[d].from}" aria-label="${name} od">
          <input type="time" data-f="to" value="${sch.days[d].to}" aria-label="${name} do">
          <div class="b">${dayBar(sch.days[d], sch.enabled, { labels: false, now: d === wd })}</div>
        </div>`).join('')}</div>
      <div class="row" style="margin-top:16px;flex-wrap:wrap"><button class="btn sm" id="copyMon" style="flex:none">${icon('copy')}Godziny z poniedziałku na cały tydzień roboczy</button></div>
    </div>
    <div class="card">
      <h3>${icon('moon')}Tryb nocny</h3><p class="sub">Czarny ekran z przygaszonym logo, które co minutę powoli zmienia miejsce - telewizor się nie wypala, a obraz nie znika (niektóre telewizory same się wyłączają bez sygnału).</p>
      <div class="eco-demo"><div class="m">${logo ? `<img src="${mediaUrl(logo)}" alt="">` : `<b style="font-size:20px">${esc(D.settings.name)}</b>`}<div style="font-size:12px;margin-top:6px" id="ecoPrev">${esc(ecoText)}</div></div></div>
      <label class="field"><span>Napis pod logo (opcjonalnie)</span><input type="text" id="ecoText" maxlength="120" value="${esc(ecoText)}" placeholder="np. Do zobaczenia jutro!"></label>
      <div class="legend">
        <div>${icon('star')}<span>Logo ustawisz w zakładce Pliki (gwiazdka przy zdjęciu).</span></div>
        <div>${icon('sun')}<span>Na pulpicie możesz ręcznie wymusić treści albo tryb nocny, np. na dzień otwarty.</span></div>
        <div>${icon('bolt')}<span>Ciemny ekran zużywa wyraźnie mniej prądu niż jasne treści.</span></div>
      </div>
    </div>
  </div>`;
  const redraw = (row) => {
    const d = +row.dataset.d;
    row.classList.toggle('off', !sch.days[d].on);
    row.querySelector('.b').innerHTML = dayBar(sch.days[d], sch.enabled, { labels: false, now: d === wd });
  };
  $('#days').addEventListener('input', (e) => {
    const row = e.target.closest('.day'), d = +row.dataset.d, f = e.target.dataset.f;
    sch.days[d][f] = f === 'on' ? e.target.checked : e.target.value;
    redraw(row);
  });
  $('#schOn').addEventListener('change', (e) => { sch.enabled = e.target.checked; $$('.day').forEach(redraw); });
  $('#copyMon').addEventListener('click', () => { for (const d of [2, 3, 4, 5]) sch.days[d] = { ...sch.days[1] }; renderAgain(); });
  $('#ecoText').addEventListener('input', (e) => { ecoText = e.target.value; $('#ecoPrev').textContent = ecoText; });
  function renderAgain() {
    $$('.day').forEach((row) => { const d = +row.dataset.d; row.querySelector('[data-f=on]').checked = sch.days[d].on; row.querySelector('[data-f=from]').value = sch.days[d].from; row.querySelector('[data-f=to]').value = sch.days[d].to; redraw(row); });
  }
  $('#schSave').addEventListener('click', guard(async () => {
    await api('/api/settings', { method: 'PUT', body: { schedule: sch, ecoText } });
    await load(); toast('Zapisano harmonogram');
  }));
}

// ---------- USTAWIENIA ----------
function renderSettings(el) {
  const st = structuredClone(D.settings), s = D.status;
  const images = D.media.filter((m) => m.type === 'image');
  topActions(`<button class="btn primary" id="setSave">${icon('check')}Zapisz ustawienia</button>`);
  el.innerHTML = `
  <div class="settings">
    <div class="card">
      <h3>${icon('star')}Szkoła i wygląd</h3>
      <label class="field"><span>Nazwa szkoły</span><input type="text" id="sName" maxlength="80" value="${esc(st.name)}"></label>
      <div class="field"><span>Kolor akcentu</span><div class="swatches" id="accents">${ACCENTS.map((c) => `<button class="swatch ${c === st.accent ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Kolor ${c}"></button>`).join('')}<input type="color" id="sAccent" value="${st.accent}" aria-label="Własny kolor"></div></div>
      <label class="field"><span>Logo szkoły</span><select id="sLogo"><option value="">— brak (wyświetlana nazwa) —</option>${images.map((m) => `<option value="${m.id}" ${m.id === st.logoMediaId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><small>Najlepiej PNG lub SVG z przezroczystym tłem. Wgraj w zakładce Pliki.</small></label>
      <label class="switch"><input type="checkbox" id="sClock" ${st.clock ? 'checked' : ''}><i></i>Zegar w rogu ekranu</label>
    </div>
    <div class="card">
      <h3>${icon('play')}Nowe slajdy - domyślnie</h3>
      <div class="field"><span>Czas wyświetlania: <b class="durval" id="sDurV">${st.duration} s</b></span><input type="range" id="sDur" min="3" max="60" value="${st.duration}"></div>
      <div class="field"><span>Przejście między slajdami</span><div class="picks" id="sTr">${Object.entries(TR).map(([k, v]) => `<button class="pick ${k === st.transition ? 'on' : ''}" data-v="${k}">${v}</button>`).join('')}</div></div>
    </div>
    <div class="card">
      <h3>${icon('type')}Pasek informacyjny na dole</h3>
      <label class="switch" style="margin-bottom:14px"><input type="checkbox" id="sTick" ${st.ticker.enabled ? 'checked' : ''}><i></i>Pokazuj przewijany pasek</label>
      <label class="field"><span>Komunikaty (każdy w nowej linii)</span><textarea id="sTickT" rows="4" placeholder="Jutro dzień sportu - strój sportowy obowiązkowy!&#10;Biblioteka czynna do 15:30">${esc(st.ticker.text)}</textarea></label>
    </div>
    <div class="card">
      <h3>${icon('monitor')}Ekran i komputer</h3>
      ${s.displays.length > 1 ? `<label class="field"><span>Wyjście obrazu (gdzie podłączony jest nadajnik HDMI)</span><select id="sDisp">${s.displays.map((d) => `<option value="${d.index}" ${d.index === st.display ? 'selected' : ''}>${esc(d.label)} · ${d.width}×${d.height}${d.primary ? ' (główny)' : ''}</option>`).join('')}</select></label>` : ''}
      <div class="addr" style="margin-bottom:14px"><code>${esc(s.host)}</code><code>${esc(s.platform)}</code><code>wersja ${esc(s.appVersion)}</code><code>port ${s.port}</code></div>
      <div class="row" style="flex-wrap:wrap"><button class="btn" id="sReload" style="flex:none">${icon('refresh')}Odśwież odtwarzacz</button><button class="btn" id="sLogs" style="flex:none">${icon('list')}Pokaż dziennik</button></div>
      <pre class="logs" id="logs" hidden></pre>
    </div>
    <div class="card">
      <h3>${icon('lock')}Zmiana hasła</h3>
      <label class="field"><span>Obecne hasło</span><input type="password" id="pOld" autocomplete="current-password"></label>
      <div class="row"><label class="field"><span>Nowe hasło</span><input type="password" id="pNew" autocomplete="new-password" minlength="8"></label>
      <label class="field"><span>Powtórz</span><input type="password" id="pNew2" autocomplete="new-password"></label></div>
      <button class="btn" id="pSave">${icon('lock')}Zmień hasło</button>
    </div>
  </div>`;
  $('#accents').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; st.accent = b.dataset.c; $('#sAccent').value = st.accent; $$('#accents .swatch').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#sAccent').addEventListener('input', (e) => { st.accent = e.target.value; $$('#accents .swatch').forEach((x) => x.classList.remove('on')); });
  $('#sDur').addEventListener('input', (e) => { st.duration = +e.target.value; $('#sDurV').textContent = `${st.duration} s`; });
  $('#sTr').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; st.transition = b.dataset.v; $$('#sTr .pick').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#setSave').addEventListener('click', guard(async () => {
    await api('/api/settings', { method: 'PUT', body: {
      name: $('#sName').value, accent: st.accent, logoMediaId: $('#sLogo').value || null, clock: $('#sClock').checked,
      duration: st.duration, transition: st.transition, ticker: { enabled: $('#sTick').checked, text: $('#sTickT').value },
      ...($('#sDisp') ? { display: +$('#sDisp').value } : {}),
    } });
    await load(); toast('Zapisano - ekran już się zmienił');
  }));
  $('#sReload').addEventListener('click', guard(async () => { await api('/api/reload', { method: 'POST' }); toast('Odświeżono odtwarzacz'); }));
  $('#sLogs').addEventListener('click', guard(async () => { const l = $('#logs'); l.hidden = false; l.textContent = (await api('/api/logs')) || 'Dziennik jest pusty.'; l.scrollTop = l.scrollHeight; }));
  $('#pSave').addEventListener('click', guard(async () => {
    if ($('#pNew').value !== $('#pNew2').value) throw new Error('Nowe hasła nie są takie same');
    await api('/api/password', { method: 'POST', body: { oldPassword: $('#pOld').value, newPassword: $('#pNew').value } });
    $('#pOld').value = $('#pNew').value = $('#pNew2').value = '';
    toast('Hasło zmienione - inne urządzenia zostały wylogowane');
  }));
}

// ---------- EDYTOR SLAJDU ----------
let draft = null, editingId = null, pvReady = false, pvTimer = null;
const blank = (type) => ({ type, title: '', body: '', label: '', icon: type === 'text' ? '📢' : '', theme: type === 'loop' ? 'sunset' : 'aurora', template: 'promo', badge: '', date: '', items: '', mediaId: null, fit: 'cover', motion: true, videoFull: false, duration: D.settings.duration, transition: D.settings.transition, enabled: true, from: '', to: '' });

function openEditor(slide, type) {
  editingId = slide ? slide.id : null;
  draft = slide ? structuredClone(slide) : blank(type || 'text');
  if (!slide && draft.type === 'loop') Object.assign(draft, { title: 'Pizza w stołówce', body: 'Tylko w ten piątek!', badge: '8 zł' });
  if (!slide && draft.type === 'text') Object.assign(draft, { title: '', label: 'Ogłoszenie' });
  $('#edTitle').textContent = editingId ? 'Edytuj slajd' : 'Nowy slajd';
  $('#drawer').hidden = false;
  pvReady = false;
  $('#pv').src = '/player/?preview=1';
  renderForm();
  setTimeout(() => $('#edForm input[type=text], #edForm textarea')?.focus(), 50);
}
function closeEditor() { $('#drawer').hidden = true; $('#pv').src = 'about:blank'; }
$$('#drawer [data-close]').forEach((b) => b.addEventListener('click', closeEditor));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeEditor(); });
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === 'preview-ready') { pvReady = true; sendPreview(true); } });

function sendPreview(now) {
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => {
    if (!pvReady) return;
    const slide = { ...draft, media: draft.type === 'media' ? mediaById(draft.mediaId) : undefined };
    $('#pv').contentWindow.postMessage({ type: 'slide', slide, settings: D.settings, logo: mediaById(D.settings.logoMediaId) || null }, location.origin);
  }, now ? 0 : 450);
}

function fld(label, inner, hint = '') { return `<label class="field"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`; }
const inp = (k, ph = '', max = 200) => `<input type="text" data-k="${k}" value="${esc(draft[k])}" placeholder="${esc(ph)}" maxlength="${max}">`;
const area = (k, ph = '', rows = 3) => `<textarea data-k="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(draft[k])}</textarea>`;
const themes = () => `<div class="field"><span>Kolorystyka: <b class="durval">${THEMES[draft.theme]}</b></span><div class="swatches">${Object.entries(THEMES).map(([k, v]) => `<button class="swatch sw-${k} ${k === draft.theme ? 'on' : ''}" data-set="theme" data-v="${k}" aria-label="${v}" title="${v}"></button>`).join('')}</div></div>`;

function renderForm() {
  const d = draft;
  let body = '';
  if (d.type === 'media') {
    const m = mediaById(d.mediaId);
    body = `<div class="section-title">Plik</div>
      <div class="mpick">${D.media.map((x) => `<button class="${x.id === d.mediaId ? 'on' : ''}" data-set="mediaId" data-v="${x.id}" title="${esc(x.name)}">${x.type === 'video' ? `<video src="${mediaUrl(x)}#t=1" muted preload="metadata"></video>` : `<img src="${mediaUrl(x)}" alt="" loading="lazy">`}<span class="chk">${icon('check')}</span></button>`).join('')}
        <button class="add" id="edUpload">${icon('upload')}<span style="font-size:12px">Wgraj nowy</span></button></div>
      <div class="field"><span>Dopasowanie</span><div class="picks"><button class="pick ${d.fit === 'cover' ? 'on' : ''}" data-set="fit" data-v="cover">Wypełnij cały ekran</button><button class="pick ${d.fit === 'contain' ? 'on' : ''}" data-set="fit" data-v="contain">Pokaż w całości</button></div></div>
      ${m && m.type === 'video' ? `<label class="switch" style="margin-bottom:10px"><input type="checkbox" data-k="videoFull" ${d.videoFull ? 'checked' : ''}><i></i>Odtwórz cały film (zamiast czasu slajdu)</label>` : `<label class="switch" style="margin-bottom:10px"><input type="checkbox" data-k="motion" ${d.motion ? 'checked' : ''}><i></i>Delikatny ruch kamery (efekt Kena Burnsa)</label>`}
      ${fld('Podpis w panelu (opcjonalnie)', inp('title', m ? m.name : ''))}`;
  } else if (d.type === 'text') {
    body = `<div class="section-title">Treść</div>
      ${fld('Tytuł', inp('title', 'np. Dzień Sportu już w piątek!'))}
      ${fld('Opis', area('body', 'Szczegóły ogłoszenia…', 4))}
      <div class="row">${fld('Etykieta', inp('label', 'np. Ważne', 60))}<div class="field"><span>Ikona</span><input type="text" data-k="icon" value="${esc(d.icon)}" maxlength="8" style="width:80px"></div></div>
      <div class="emojis">${EMOJI.map((e) => `<button data-set="icon" data-v="${e}" aria-label="Ikona ${e}">${e}</button>`).join('')}<button data-set="icon" data-v="" aria-label="Bez ikony" style="font-size:12px">✕</button></div>
      <div class="section-title">Wygląd</div>${themes()}`;
  } else {
    const t = d.template;
    const fields = {
      promo: fld('Hasło', inp('title', 'np. Pizza w stołówce')) + fld('Podtytuł', area('body', 'np. Tylko w ten piątek!', 2)) + fld('Znaczek', inp('badge', 'np. 8 zł / -50% / NOWOŚĆ', 20)),
      event: fld('Nazwa wydarzenia', inp('title', 'np. Studniówka')) + fld('Data i godzina', `<input type="datetime-local" data-k="date" value="${esc(d.date)}">`) + fld('Napis nad tytułem', inp('label', 'domyślnie: data wydarzenia', 60)) + fld('Dodatkowy tekst', area('body', '', 2)),
      list: fld('Tytuł', inp('title', 'np. Menu na dziś')) + fld('Pozycje', area('items', 'Zupa pomidorowa | 6 zł\nKotlet z ziemniakami | 14 zł\nKompot | 2 zł', 6), 'Każda pozycja w nowej linii. Wartość po znaku | (opcjonalnie). Do 10 pozycji.'),
      clock: fld('Powitanie', inp('title', 'np. Dzień dobry!')) + fld('Dodatkowy tekst', area('body', 'np. Miłego dnia w szkole', 2)),
      marquee: fld('Przewijany napis', inp('title', 'np. Dzień Otwarty')) + fld('Tekst na środku (opcjonalnie)', area('body', 'np. Sobota, 10:00–14:00', 2)),
    }[t];
    body = `<div class="section-title">Rodzaj animacji</div>
      <div class="tpls">${Object.entries(TPL).map(([k, v]) => `<button class="tpl ${k === t ? 'on' : ''}" data-set="template" data-v="${k}" data-rerender>${TPL_ILL[k]}${v}</button>`).join('')}</div>
      <div class="section-title">Treść</div>${fields}<div class="section-title">Wygląd</div>${themes()}`;
  }
  $('#edForm').innerHTML = `
    <div class="types">${['media', 'text', 'loop'].map((k) => `<button class="type ${k === d.type ? 'on' : ''}" data-set="type" data-v="${k}" data-rerender>${ILL[k]}${TYPE_LABEL[k]}<small>${{ media: 'z dysku lub telefonu', text: 'tekst na tle', loop: 'animacja w pętli' }[k]}</small></button>`).join('')}</div>
    ${body}
    <div class="section-title">Wyświetlanie</div>
    ${d.type === 'media' && d.videoFull ? '' : `<div class="field"><span>Czas na ekranie: <b class="durval" id="durV">${fmtDur(d.duration)}</b></span><input type="range" data-k="duration" min="3" max="120" value="${d.duration}"></div>`}
    <div class="field"><span>Przejście (wejście slajdu)</span><div class="picks">${Object.entries(TR).map(([k, v]) => `<button class="pick ${k === d.transition ? 'on' : ''}" data-set="transition" data-v="${k}">${v}</button>`).join('')}</div></div>
    <div class="row">${fld('Pokazuj od', `<input type="date" data-k="from" value="${esc(d.from)}">`)}${fld('Pokazuj do', `<input type="date" data-k="to" value="${esc(d.to)}">`)}</div>
    <p class="muted" style="font-size:12.5px;margin:-6px 0 14px">Puste daty = zawsze. Po dacie „do” slajd sam znika z ekranu.</p>
    <label class="switch"><input type="checkbox" data-k="enabled" ${d.enabled ? 'checked' : ''}><i></i>Włączony</label>`;
  $('#edUpload')?.addEventListener('click', () => {
    const f = $('#file'); f.value = '';
    const once = (e) => { f.removeEventListener('change', once, true); e.stopImmediatePropagation(); uploadFiles([...f.files], false, (created) => { if (created[0]) draft.mediaId = created[0].id; renderForm(); sendPreview(true); }); };
    f.addEventListener('change', once, true);
    f.click();
  });
  sendPreview();
}

$('#edForm').addEventListener('input', (e) => {
  const k = e.target.dataset.k; if (!k) return;
  draft[k] = e.target.type === 'checkbox' ? e.target.checked : k === 'duration' ? +e.target.value : e.target.value;
  if (k === 'duration') $('#durV').textContent = fmtDur(draft.duration);
  if (k === 'videoFull') return renderForm();
  sendPreview();
});
$('#edForm').addEventListener('click', (e) => {
  const b = e.target.closest('[data-set]'); if (!b || b.id === 'edUpload') return;
  e.preventDefault();
  const k = b.dataset.set;
  draft[k] = b.dataset.v;
  if (k === 'type' && draft.type === 'loop' && !draft.title) Object.assign(draft, { title: 'Pizza w stołówce', badge: '8 zł' });
  if (k === 'type' && draft.type === 'media' && !draft.mediaId && D.media[0]) draft.mediaId = D.media[0].id;
  if (b.dataset.rerender !== undefined || k === 'mediaId' || k === 'icon') return renderForm();
  b.parentElement.querySelectorAll('[data-set]').forEach((x) => x.classList.toggle('on', x === b));
  if (k === 'theme') b.closest('.field').querySelector('.durval').textContent = THEMES[draft.theme];
  sendPreview(true);
});
$('#edSave').addEventListener('click', guard(async () => {
  if (draft.type === 'media' && !draft.mediaId) throw new Error('Wybierz albo wgraj plik');
  if (draft.type === 'text' && !draft.title.trim() && !draft.body.trim()) throw new Error('Wpisz tytuł albo opis');
  if (draft.type === 'loop' && draft.template === 'event' && !draft.date) throw new Error('Ustaw datę wydarzenia');
  const { media, ...body } = draft;
  if (editingId) await api(`/api/slides/${editingId}`, { method: 'PUT', body });
  else await api('/api/slides', { method: 'POST', body });
  closeEditor();
  await load(); go(view);
  toast(editingId ? 'Zapisano zmiany - ekran już je pokazuje' : 'Dodano slajd na koniec playlisty');
}));

// ---------- start ----------
(async () => {
  try {
    const a = await api('/api/auth');
    if (a.loggedIn) startApp(); else showAuth(a.setup);
  } catch (e) { document.body.innerHTML = `<p style="padding:40px">Nie można połączyć się z ekranem: ${esc(e.message)}</p>`; }
})();
