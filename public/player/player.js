'use strict';
// Odtwarzacz: pobiera stan z serwera (SSE), odtwarza playlistę z przejściami, przełącza tryb nocny.
// ?preview=1 - podgląd jednego slajdu w panelu (postMessage), ?watch=1 - podgląd na żywo bez sygnału życia.

const qs = new URLSearchParams(location.search);
const PREVIEW = qs.has('preview');
const WATCH = qs.has('watch');
const stage = document.getElementById('stage');
const clockEl = document.getElementById('clock');
const tickerEl = document.getElementById('ticker');
const ecoEl = document.getElementById('eco');
const offlineEl = document.getElementById('offline');

let state = null;
let idx = -1;
let current = null;      // element na scenie
let currentSlide = null; // dane bieżącego slajdu
let timer = null;
let errors = 0;
let showingIdle = false;
const ANIM_MS = 1000;

// ---------- pomocnicze ----------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtDate = (d, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => { const t = d.toLocaleDateString('pl-PL', opts); return t[0].toUpperCase() + t.slice(1); };
const mediaUrl = (m) => `/media/${encodeURIComponent(m.file)}`;
const bg = () => h('div', { class: 'bg' }, h('div', { class: 'blob b1' }), h('div', { class: 'blob b2' }), h('div', { class: 'blob b3' }), h('div', { class: 'grain' }));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
function fitTitle(text, big = 10, small = 4.5) {
  const n = (text || '').length;
  const size = n < 14 ? big : n < 28 ? big * 0.78 : n < 50 ? big * 0.6 : n < 90 ? big * 0.48 : small;
  return `${Math.max(size, small)}vh`;
}
// Elementy z funkcją _tick są aktualizowane co sekundę (zegary, odliczania).
setInterval(() => {
  for (const el of stage.querySelectorAll('[data-tick]')) el._tick && el._tick();
  updateClock();
}, 1000);

// ---------- budowanie slajdów ----------
async function build(s) {
  if (s.type === 'media') return buildMedia(s);
  if (s.type === 'loop') return buildLoop(s);
  return buildText(s);
}

async function buildMedia(s) {
  const m = s.media;
  if (!m) throw new Error('brak pliku');
  const el = h('div', { class: `slide media-slide ${s.fit === 'contain' ? 'contain' : ''}` });
  if (m.type === 'video') {
    const v = h('video', { class: 'fg', src: mediaUrl(m), muted: true, playsinline: true, preload: 'auto' });
    v.muted = true;
    v.loop = !s.videoFull;
    if (s.fit === 'contain') el.append(h('div', { class: 'backdrop', style: { position: 'absolute', inset: 0, background: '#000' } }));
    el.append(v);
    await withTimeout(new Promise((res, rej) => { v.oncanplay = res; v.onerror = () => rej(new Error('wideo')); v.load(); }), 15000);
    el._video = v;
    return el;
  }
  const src = mediaUrl(m);
  const img = h('img', { class: 'fg', src, alt: '' });
  await withTimeout(img.decode(), 15000);
  if (s.fit === 'contain') el.append(h('img', { class: 'backdrop', src, alt: '' }));
  if (s.motion !== false) { img.classList.add('kenburns'); img.style.setProperty('--dur', `${s.duration + 2}s`); }
  el.append(img);
  return el;
}

function logoImg(cls) {
  return state && state.logo && state.logo.type === 'image' ? h('img', { class: cls, src: mediaUrl(state.logo), alt: '' }) : null;
}

function buildText(s) {
  const title = h('h1', { text: s.title });
  title.style.fontSize = fitTitle(s.title, 13, 5);
  return h('div', { class: `slide text-slide theme-${s.theme}` }, bg(),
    h('div', { class: 'content' },
      s.icon ? h('div', { class: 'icon', text: s.icon }) : null,
      s.label ? h('div', { class: 'label', text: s.label }) : null,
      s.title ? title : null,
      h('div', { class: 'bar' }),
      s.body ? h('p', { text: s.body }) : null),
    logoImg('corner-logo'));
}

function buildLoop(s) {
  const t = { promo: loopPromo, event: loopEvent, list: loopList, clock: loopClock, marquee: loopMarquee }[s.template] || loopPromo;
  const el = t(s);
  el.classList.add('slide', `theme-${s.theme}`);
  return el;
}

function loopPromo(s) {
  const starPts = Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 ? 40 : 50, a = (Math.PI * i) / 16;
    return `${50 + r * Math.cos(a)},${50 + r * Math.sin(a)}`;
  }).join(' ');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const poly = document.createElementNS(svgNS, 'polygon');
  poly.setAttribute('points', starPts);
  poly.setAttribute('fill', 'var(--c3)');
  svg.append(poly);
  const confetti = h('div', { class: 'confetti' }, Array.from({ length: 26 }, (_, i) => h('i', { style: {
    left: `${(i * 37) % 100}%`, animationDuration: `${5 + (i % 7)}s`, animationDelay: `${-(i * 0.73) % 7}s`,
    background: i % 3 ? 'var(--c3)' : i % 2 ? 'var(--c2)' : '#fff',
  } })));
  const title = h('h1', { text: s.title || 'Promocja!' });
  title.style.fontSize = fitTitle(s.title, 15, 6);
  return h('div', { class: 'promo' }, h('div', { class: 'rays' }), h('div', { class: 'vignette' }), confetti,
    h('div', { class: 'wrap' },
      h('div', {}, title, s.body ? h('p', { text: s.body }) : null),
      s.badge ? h('div', { class: 'badge' }, svg, h('span', { text: s.badge })) : h('div')),
    h('div', { class: 'shine' }), logoImg('corner-logo'));
}

function particles(n = 30) {
  return h('div', { class: 'particles' }, Array.from({ length: n }, (_, i) => h('i', { style: {
    left: `${(i * 53) % 100}%`, animationDuration: `${8 + (i % 9)}s`, animationDelay: `${-(i * 1.3) % 12}s`, transform: `scale(${0.5 + (i % 4) * 0.4})`,
  } })));
}

function loopEvent(s) {
  const target = s.date ? new Date(s.date) : null;
  const units = [['d', 'dni'], ['h', 'godz.'], ['m', 'min'], ['s', 'sek']].map(([k, label]) => {
    const b = h('b', { text: '--' });
    return { k, el: h('div', { class: 'unit' }, b, h('small', { text: label })), b };
  });
  const count = h('div', { class: 'count' }, units.map((u) => u.el));
  const title = h('h1', { text: s.title || 'Wydarzenie' });
  title.style.fontSize = fitTitle(s.title, 11, 5);
  const el = h('div', { class: 'event' }, bg(), particles(),
    h('div', { class: 'content' },
      h('div', { class: 'label', text: s.label || (target ? `${fmtDate(target, { day: 'numeric', month: 'long', year: 'numeric' })}, ${fmtTime(target)}` : 'Odliczanie') }),
      title, count, s.body ? h('p', { text: s.body }) : null),
    logoImg('corner-logo'));
  el.dataset.tick = '1';
  el._tick = () => {
    let diff = target ? Math.max(0, target - Date.now()) : 0;
    const v = { d: Math.floor(diff / 864e5), h: Math.floor(diff / 36e5) % 24, m: Math.floor(diff / 6e4) % 60, s: Math.floor(diff / 1e3) % 60 };
    for (const u of units) {
      const txt = u.k === 'd' ? String(v.d) : pad(v[u.k]);
      if (u.b.textContent !== txt) { u.b.textContent = txt; u.el.classList.remove('tick'); void u.el.offsetWidth; u.el.classList.add('tick'); }
    }
    if (target && diff === 0) count.replaceWith(h('h1', { text: 'To już dziś! 🎉', style: { fontSize: '10vh' } }));
  };
  el._tick();
  return el;
}

function loopList(s) {
  const rows = (s.items || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 10);
  const ul = h('ul', {}, rows.map((line, i) => {
    const [name, val] = line.split('|').map((x) => x.trim());
    const li = h('li', { style: { animationDelay: `${0.2 + i * 0.09}s` } }, h('span', { text: name }), val ? h('span', { class: 'dots' }) : null, val ? h('span', { class: 'val', text: val }) : null);
    if (rows.length > 6) li.style.fontSize = '3vh';
    return li;
  }));
  const el = h('div', { class: 'list' }, bg(), h('div', { class: 'content' }, h('h1', { text: s.title || 'Menu' }), ul), logoImg('corner-logo'));
  let n = -1, k = 0;
  el.dataset.tick = '1';
  el._tick = () => { if (k++ % 2) return; const li = ul.children; if (!li.length) return; li[n]?.classList.remove('active'); n = (n + 1) % li.length; li[n].classList.add('active'); };
  return el;
}

function loopClock(s) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  const mk = (attrs) => { const c = document.createElementNS(svgNS, 'circle'); for (const k in attrs) c.setAttribute(k, attrs[k]); svg.append(c); return c; };
  mk({ cx: 50, cy: 50, r: 46, fill: 'rgba(255,255,255,.06)', stroke: 'rgba(255,255,255,.12)', 'stroke-width': 2 });
  const arc = mk({ cx: 50, cy: 50, r: 46, fill: 'none', stroke: 'var(--c3)', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-dasharray': '289', 'stroke-dashoffset': '289' });
  arc.style.transition = 'stroke-dashoffset 1s linear';
  const hh = h('span'), mm = h('span');
  const date = h('div', { class: 'date' });
  const el = h('div', { class: 'clockslide' }, bg(),
    h('div', { class: 'content' },
      h('div', { class: 'ring' }, svg, h('div', { class: 'time' }, h('div', {}, hh, h('span', { class: 'colon', text: ':' }), mm))),
      h('div', {}, h('h1', { text: s.title || 'Dzień dobry!' }), date, s.body ? h('p', { text: s.body }) : null)),
    logoImg('corner-logo'));
  el.dataset.tick = '1';
  el._tick = () => {
    const d = new Date();
    hh.textContent = pad(d.getHours()); mm.textContent = pad(d.getMinutes());
    date.textContent = fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    arc.setAttribute('stroke-dashoffset', String(289 - (289 * (d.getSeconds() + 1)) / 60));
  };
  el._tick();
  return el;
}

function loopMarquee(s) {
  const word = (s.title || 'Szkolny Ekran').toUpperCase();
  const chunk = ` ${word} ★ `.repeat(Math.max(2, Math.ceil(40 / word.length)));
  const rows = h('div', { class: 'rows' }, [0, 1, 2, 3].map((i) => h('div', { class: 'row' },
    h('div', { class: 'track', text: chunk + chunk }))));
  rows.querySelectorAll('.track').forEach((t, i) => t.style.setProperty('--s', `${24 + i * 6}s`));
  return h('div', { class: 'marquee' }, bg(), rows, s.body ? h('div', { class: 'card', text: s.body }) : null);
}

function buildIdle() {
  const big = h('div', { class: 'big' }), date = h('div', { class: 'date' });
  const el = h('div', { class: 'slide idle theme-aurora' }, bg(),
    h('div', { class: 'content' }, logoImg(''), h('h1', { text: state?.settings?.name || 'Szkolny Ekran' }), big, date));
  el.dataset.tick = '1';
  el._tick = () => { const d = new Date(); big.textContent = fmtTime(d); date.textContent = fmtDate(d); };
  el._tick();
  return el;
}

// ---------- przejścia ----------
const P = 'perspective(2400px) ';
const TRANSITIONS = {
  fade: [[{ opacity: 0 }, { opacity: 1 }], [{ opacity: 1 }, { opacity: 0 }]],
  slide: [[{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-30%)', opacity: 0.2 }]],
  up: [[{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-25%)', opacity: 0.2 }]],
  zoom: [[{ opacity: 0, transform: 'scale(1.3)' }, { opacity: 1, transform: 'scale(1)' }], [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }]],
  blur: [[{ opacity: 0, filter: 'blur(40px)', transform: 'scale(1.05)' }, { opacity: 1, filter: 'blur(0)', transform: 'scale(1)' }], [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(40px)' }]],
  flip: [[{ opacity: 0, transform: P + 'rotateY(-80deg) scale(.9)' }, { opacity: 1, transform: P + 'rotateY(0) scale(1)' }], [{ opacity: 1, transform: P + 'rotateY(0) scale(1)' }, { opacity: 0, transform: P + 'rotateY(80deg) scale(.9)' }]],
};
const NAMES = Object.keys(TRANSITIONS);

function swap(oldEl, newEl, kind) {
  if (kind === 'random' || !TRANSITIONS[kind]) kind = NAMES[Math.floor(Math.random() * NAMES.length)];
  const [inK, outK] = TRANSITIONS[kind];
  stage.append(newEl);
  if (newEl._video) newEl._video.play().catch(() => {});
  const opts = { duration: ANIM_MS, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
  const a = newEl.animate(inK, kind === 'flip' ? { ...opts, delay: ANIM_MS * 0.35 } : opts);
  // Zabezpieczenie: gdyby zegar animacji stanął, slajd i tak ma być widoczny, a stary usunięty.
  setTimeout(() => a.playState !== 'finished' && a.finish(), ANIM_MS * 2);
  if (!oldEl) return;
  oldEl.style.zIndex = 0; newEl.style.zIndex = 1;
  oldEl.animate(outK, opts);
  setTimeout(() => { oldEl._video?.pause(); oldEl.remove(); }, ANIM_MS + 100);
}

// ---------- pętla playlisty ----------
function schedule(s) {
  clearTimeout(timer);
  const v = current && current._video;
  if (v && s.videoFull) {
    v.onended = () => next();
    timer = setTimeout(next, ((v.duration || 600) + 5) * 1000); // zabezpieczenie, gdyby 'ended' nie przyszło
  } else {
    timer = setTimeout(next, s.duration * 1000);
  }
}

let showSeq = 0;
async function show(s) {
  const my = ++showSeq;
  let el;
  try { el = await build(s); }
  catch (e) {
    errors++;
    console.warn('pominięto slajd', s.id, e.message);
    clearTimeout(timer);
    timer = setTimeout(next, 1000);
    return;
  }
  if (my !== showSeq || (state.mode === 'eco' && !PREVIEW)) return; // w międzyczasie przyszedł nowszy stan
  swap(current, el, s.transition || state.settings.transition);
  current = el; currentSlide = s; showingIdle = false;
  updateOverlays();
  schedule(s);
}

function next() {
  clearTimeout(timer);
  const slides = state.slides;
  if (!slides.length) return showIdle();
  // jeden slajd: nie przebudowuj go (animacja pętli trwa dalej)
  if (slides.length === 1 && currentSlide && same(currentSlide, slides[0]) && !showingIdle) { idx = 0; return schedule(slides[0]); }
  idx = (idx + 1) % slides.length;
  show(slides[idx]);
}

function showIdle() {
  showSeq++;
  if (showingIdle && current) return;
  const el = buildIdle();
  swap(current, el, 'fade');
  current = el; currentSlide = null; showingIdle = true; idx = -1;
  updateOverlays();
}

const same = (a, b) => a && b && JSON.stringify(a) === JSON.stringify(b);

function applyState(ns) {
  const prev = state;
  state = ns;
  document.documentElement.style.setProperty('--accent', ns.settings.accent || '#6d5dfc');
  setEco(ns.mode === 'eco');
  if (ns.mode === 'eco') { clearTimeout(timer); return; }
  if (!prev || prev.mode === 'eco' || !current) { idx = -1; return next(); }
  if (!ns.slides.length) return showIdle();
  if (showingIdle) return next();
  // bieżący slajd zmieniony lub usunięty -> od razu następny; inaczej playlista płynie dalej
  const fresh = currentSlide && ns.slides.find((x) => x.id === currentSlide.id);
  if (!fresh || !same(fresh, currentSlide)) {
    idx = fresh ? ns.slides.indexOf(fresh) - 1 : Math.min(idx, ns.slides.length) - 1;
    return next();
  }
  idx = ns.slides.indexOf(fresh);
  updateOverlays();
}

// ---------- nakładki: zegar, pasek, tryb nocny ----------
function updateClock() {
  const d = new Date();
  clockEl.querySelector('.t').textContent = fmtTime(d);
  clockEl.querySelector('.d').textContent = fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
}

let tickerText = null;
function updateOverlays() {
  if (!state) return;
  const st = state.settings;
  const fullClock = showingIdle || (currentSlide && currentSlide.type === 'loop' && currentSlide.template === 'clock');
  clockEl.hidden = !st.clock || fullClock || state.mode === 'eco';
  const tk = st.ticker || {};
  const on = tk.enabled && tk.text.trim() && state.mode !== 'eco';
  tickerEl.hidden = !on;
  document.body.classList.toggle('has-ticker', !!on);
  if (on && tk.text !== tickerText) {
    tickerText = tk.text;
    const items = tk.text.split('\n').map((x) => x.trim()).filter(Boolean);
    const track = tickerEl.querySelector('.track');
    track.replaceChildren(...[...items, ...items].map((t) => h('span', { text: t })));
    track.style.setProperty('--s', `${Math.max(15, tk.text.length * 0.35)}s`);
  }
}

let ecoMove = null;
function setEco(on) {
  ecoEl.hidden = !on;
  updateOverlays();
  if (!on) { clearInterval(ecoMove); ecoMove = null; return; }
  const mark = ecoEl.querySelector('.mark');
  const logo = logoImg('');
  mark.replaceChildren(logo || h('b', { text: state.settings.name }), state.settings.ecoText ? h('small', { text: state.settings.ecoText }) : null);
  // Logo powoli wędruje po ekranie - chroni telewizor przed wypaleniem obrazu.
  const move = () => { mark.style.left = `${20 + Math.random() * 60}%`; mark.style.top = `${20 + Math.random() * 60}%`; };
  if (!ecoMove) { mark.style.left = '50%'; mark.style.top = '50%'; ecoMove = setInterval(move, 60000); }
  if (current) { current._video?.pause(); current.remove(); current = null; currentSlide = null; showingIdle = false; }
}

// ---------- połączenie z serwerem ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => { offlineEl.hidden = true; applyState(JSON.parse(e.data)); });
  es.addEventListener('reload', () => location.reload());
  es.onerror = () => { offlineEl.hidden = !!state; if (!state) offlineEl.hidden = false; };
  es.onopen = () => { offlineEl.hidden = true; };
}

function heartbeat() {
  fetch('/api/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ekran': '1' },
    body: JSON.stringify({ slide: currentSlide ? (currentSlide.title || currentSlide.media?.name || currentSlide.template || currentSlide.type) : (state?.mode === 'eco' ? 'tryb nocny' : 'ekran powitalny'), mode: state?.mode, errors }),
  }).catch(() => {});
}

// ---------- podgląd w panelu ----------
function previewMode() {
  window.addEventListener('message', async (e) => {
    if (e.origin !== location.origin || !e.data) return;
    const d = e.data;
    state = { mode: 'on', settings: d.settings || { transition: 'fade', clock: false, ticker: {} }, logo: d.logo || null, slides: [] };
    document.documentElement.style.setProperty('--accent', state.settings.accent || '#6d5dfc');
    if (d.type === 'eco') { setEco(true); return; }
    setEco(false);
    if (d.type === 'idle') { showingIdle = false; return showIdle(); }
    if (d.type !== 'slide') return;
    try {
      const el = await build(d.slide);
      swap(current, el, d.transition === false ? 'fade' : d.slide.transition);
      current = el; currentSlide = d.slide; showingIdle = false;
      updateOverlays();
    } catch { /* niepełny slajd w edytorze - pokazuj poprzedni */ }
  });
  parent.postMessage({ type: 'preview-ready' }, location.origin);
}

updateClock();
if (PREVIEW) previewMode();
else {
  connect();
  if (!WATCH) { heartbeat(); setInterval(heartbeat, 10000); }
  // zapas na wypadek zawieszonego SSE
  setInterval(() => fetch('/api/state').then((r) => r.ok && r.json()).then((s) => s && state && (s.version !== state.version || s.mode !== state.mode) && applyState(s)).catch(() => {}), 60000);
}
