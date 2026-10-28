'use strict';
// Harmonogram: czy ekran ma pokazywać treści ('on'), czy tryb oszczędny ('eco').

const toMin = (s) => {
  const [h, m] = String(s || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

function isSchoolTime(schedule, now = new Date()) {
  if (!schedule || !schedule.enabled) return true;
  const d = schedule.days && schedule.days[now.getDay()];
  if (!d || !d.on) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  const a = toMin(d.from), b = toMin(d.to);
  return a <= b ? t >= a && t < b : t >= a || t < b; // b < a = przez północ
}

function computeMode(schedule, override, now = new Date()) {
  if (override === 'on' || override === 'eco') return override;
  return isSchoolTime(schedule, now) ? 'on' : 'eco';
}

const localDate = (now) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Slajd aktywny: włączony i w zakresie dat (from/to włącznie, YYYY-MM-DD).
function slideActive(s, now = new Date()) {
  if (s.enabled === false) return false;
  const day = localDate(now);
  if (s.from && day < s.from) return false;
  if (s.to && day > s.to) return false;
  return true;
}

module.exports = { isSchoolTime, computeMode, slideActive, toMin };
