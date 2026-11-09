'use strict';
// Pure logic: no I/O. All "now" values are injected for testability.
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeStr = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return dateStr(d); };
const weekStart = (s) => { const d = parseDate(s); return addDays(s, -((d.getDay() + 6) % 7)); }; // Monday
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function emptyData() {
  return { version: 1, tracks: [], sessions: [], tasks: [], plan: [], program: [], events: [], timer: null,
    settings: { work: 25, brk: 5, longBrk: 15, cycles: 4 } };
}

function normalize(d) {
  const e = emptyData();
  d = Object.assign(e, d || {});
  d.settings = Object.assign(e.settings, d.settings);
  for (const k of ['tracks', 'sessions', 'tasks', 'plan', 'program', 'events']) if (!Array.isArray(d[k])) d[k] = [];
  return d;
}

function findTrack(data, name) {
  const n = String(name || '').trim().toLowerCase();
  return data.tracks.find((t) => t.name.toLowerCase() === n) || null;
}
function addTrack(data, name, targetHoursPerWeek = 0) {
  name = String(name || '').trim();
  if (!name) throw new Error('Track name required');
  const ex = findTrack(data, name);
  if (ex) { if (targetHoursPerWeek) ex.targetHoursPerWeek = targetHoursPerWeek; return ex; }
  const t = { name, targetHoursPerWeek: Number(targetHoursPerWeek) || 0 };
  data.tracks.push(t); return t;
}

// ---- timer ----
function startTimer(data, track, now, opts = {}) {
  if (data.timer) throw new Error(`Timer already running on "${data.timer.track}". Stop it first.`);
  track = String(track || '').trim();
  if (!track) throw new Error('Track required');
  const t = addTrack(data, track);
  data.timer = { track: t.name, startedAt: now.getTime(), mode: opts.pomodoro ? 'pomodoro' : 'free', topic: opts.topic || '' };
  return data.timer;
}
function timerStatus(data, now) {
  const t = data.timer; if (!t) return null;
  const elapsed = Math.max(0, now.getTime() - t.startedAt);
  const s = data.settings, cycleMs = (s.work + s.brk) * 60000;
  let phase = 'focus', remaining = null, cycle = 1;
  if (t.mode === 'pomodoro') {
    // full cycle = work+break, every `cycles`th break is long
    const longCycleMs = (s.work * s.cycles + s.brk * (s.cycles - 1) + s.longBrk) * 60000;
    let e = elapsed % longCycleMs; cycle = 1;
    for (let i = 1; i <= s.cycles; i++) {
      cycle = i;
      if (e < s.work * 60000) { phase = 'focus'; remaining = s.work * 60000 - e; break; }
      e -= s.work * 60000;
      const b = (i === s.cycles ? s.longBrk : s.brk) * 60000;
      if (e < b) { phase = 'break'; remaining = b - e; break; }
      e -= b;
    }
    void cycleMs;
  }
  return { track: t.track, mode: t.mode, elapsedMs: elapsed, phase, remainingMs: remaining, cycle, topic: t.topic };
}
function stopTimer(data, now, extra = {}) {
  const t = data.timer; if (!t) throw new Error('No timer running');
  const start = new Date(t.startedAt);
  const s = addSession(data, { track: t.track, start, end: now, topic: extra.topic || t.topic, rating: extra.rating, notes: extra.notes });
  data.timer = null; return s;
}

// ---- sessions ----
function addSession(data, { track, start, end, topic = '', rating = null, notes = '' }) {
  if (!(end > start)) throw new Error('End must be after start');
  const t = addTrack(data, track);
  const s = { id: uid(), date: dateStr(start), start: timeStr(start), end: timeStr(end),
    startTs: start.getTime(), endTs: end.getTime(), minutes: Math.max(1, Math.round((end - start) / 60000)),
    track: t.name, topic: topic || '', rating: rating == null || rating === '' ? null : Number(rating), notes: notes || '' };
  data.sessions.push(s); return s;
}
function sessionsBetween(data, from, to) {
  return data.sessions.filter((s) => s.date >= from && s.date <= to).sort((a, b) => a.startTs - b.startTs);
}

// ---- tasks ----
const PRI = { high: 1, med: 2, medium: 2, low: 3, h: 1, m: 2, l: 3, 1: 1, 2: 2, 3: 3 };
function addTask(data, { title, track = '', priority = 'med', due = '', parent = null }) {
  title = String(title || '').trim(); if (!title) throw new Error('Title required');
  const p = PRI[String(priority).toLowerCase()]; if (!p) throw new Error('Priority must be high|med|low');
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Due must be YYYY-MM-DD');
  if (parent && !data.tasks.find((t) => t.id === parent)) throw new Error('Parent task not found');
  if (track) addTrack(data, track);
  const t = { id: uid(), title, track: track ? findTrack(data, track).name : '', priority: p, due: due || '', done: false, doneAt: null, parent: parent || null };
  data.tasks.push(t); return t;
}
function resolveTask(data, ref) {
  ref = String(ref);
  const open = sortedTasks(data);
  if (/^\d+$/.test(ref) && open[Number(ref) - 1]) return open[Number(ref) - 1];
  return data.tasks.find((t) => t.id === ref || t.id.startsWith(ref)) || null;
}
function toggleTask(data, id, now) {
  const t = data.tasks.find((x) => x.id === id); if (!t) throw new Error('Task not found');
  t.done = !t.done; t.doneAt = t.done ? now.getTime() : null; return t;
}
function removeTask(data, id) {
  const ids = new Set([id]);
  data.tasks.forEach((t) => { if (t.parent === id) ids.add(t.id); });
  data.tasks = data.tasks.filter((t) => !ids.has(t.id));
}
// Ordered flat list: parents sorted (undone first, priority, due), children right after parent.
function sortedTasks(data) {
  const cmp = (a, b) => (a.done - b.done) || (a.priority - b.priority) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);
  const out = [];
  data.tasks.filter((t) => !t.parent).sort(cmp).forEach((p) => {
    out.push(p); data.tasks.filter((t) => t.parent === p.id).sort(cmp).forEach((c) => out.push(c));
  });
  return out;
}

// ---- plan / program ----
function addPlan(data, date, text) { const p = { id: uid(), date, text, done: false }; data.plan.push(p); return p; }
function addProgramSlot(data, { day, start, end, track, title = '' }) {
  const d = DAYS.findIndex((x) => x.toLowerCase() === String(day).slice(0, 3).toLowerCase());
  if (d < 0) throw new Error('Day must be Mon..Sun');
  if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) throw new Error('Times must be HH:MM');
  if (track) addTrack(data, track);
  const s = { id: uid(), day: d, start: start.padStart(5, '0'), end: end.padStart(5, '0'), track: track || '', title };
  data.program.push(s); return s;
}
function weekGrid(data, anchor) {
  const ws = weekStart(anchor);
  return DAYS.map((name, i) => {
    const date = addDays(ws, i);
    const slots = data.program.filter((p) => p.day === i).map((p) => ({ start: p.start, end: p.end, label: p.title || p.track, track: p.track, kind: 'program' }));
    data.events.filter((e) => e.date === date).forEach((e) => slots.push({ start: e.start || '00:00', end: e.end || '', label: e.title, kind: 'event' }));
    slots.sort((a, b) => a.start.localeCompare(b.start));
    const mins = sessionsBetween(data, date, date).reduce((a, s) => a + s.minutes, 0);
    return { name, date, slots, minutes: mins };
  });
}

// ---- streaks ----
function streaks(data, today) {
  const days = new Set(data.sessions.map((s) => s.date));
  let cur = 0, d = today;
  if (!days.has(d)) d = addDays(d, -1); // today not studied yet doesn't break the streak
  while (days.has(d)) { cur++; d = addDays(d, -1); }
  const sorted = [...days].sort(); let best = 0, run = 0, prev = null;
  for (const x of sorted) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; }
  return { current: cur, best };
}

// ---- reports ----
function period(type, anchor) {
  if (type === 'week') { const s = weekStart(anchor); return { type, start: s, end: addDays(s, 6) }; }
  if (type === 'month') {
    const d = parseDate(anchor); const s = new Date(d.getFullYear(), d.getMonth(), 1), e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { type, start: dateStr(s), end: dateStr(e) };
  }
  throw new Error('Report type must be week or month');
}
function buildReport(data, type, anchor) {
  const p = period(type, anchor);
  const sess = sessionsBetween(data, p.start, p.end);
  const tasks = data.tasks.filter((t) => (t.due && t.due >= p.start && t.due <= p.end) ||
    (t.doneAt && dateStr(new Date(t.doneAt)) >= p.start && dateStr(new Date(t.doneAt)) <= p.end));
  const by = new Map();
  sess.forEach((s) => { const x = by.get(s.track) || { name: s.track, minutes: 0, sessions: 0 }; x.minutes += s.minutes; x.sessions++; by.set(s.track, x); });
  const daily = []; const n = (parseDate(p.end) - parseDate(p.start)) / 864e5 + 1;
  for (let i = 0; i < n; i++) { const d = addDays(p.start, i); daily.push({ date: d, minutes: sess.filter((s) => s.date === d).reduce((a, s) => a + s.minutes, 0) }); }
  const weeks = type === 'week' ? 1 : n / 7;
  return {
    version: 1, period: p,
    totals: { minutes: sess.reduce((a, s) => a + s.minutes, 0), sessions: sess.length,
      tasksDone: tasks.filter((t) => t.done && t.doneAt && dateStr(new Date(t.doneAt)) >= p.start && dateStr(new Date(t.doneAt)) <= p.end).length },
    byTrack: [...by.values()].sort((a, b) => b.minutes - a.minutes),
    daily,
    sessions: sess.map((s) => ({ date: s.date, start: s.start, end: s.end, track: s.track, topic: s.topic, rating: s.rating, notes: s.notes })),
    tasks: tasks.map((t) => ({ title: t.title, track: t.track, done: t.done, due: t.due })),
    goals: data.tracks.filter((t) => t.targetHoursPerWeek > 0).map((t) => ({
      track: t.name, targetHoursPerWeek: t.targetHoursPerWeek,
      actualHours: Math.round(((by.get(t.name) || { minutes: 0 }).minutes / 60 / weeks) * 100) / 100 })),
  };
}
const csvCell = (v) => { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
function reportCsv(r) {
  const rows = [['date', 'start', 'end', 'track', 'topic', 'rating', 'notes']];
  r.sessions.forEach((s) => rows.push([s.date, s.start, s.end, s.track, s.topic, s.rating, s.notes]));
  return rows.map((x) => x.map(csvCell).join(',')).join('\n') + '\n';
}

const fmtDur = (min) => { min = Math.round(min); return min >= 60 ? `${Math.floor(min / 60)}h${pad(min % 60)}` : `${min}m`; };
const fmtClock = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

module.exports = { pad, dateStr, timeStr, parseDate, addDays, weekStart, DAYS, uid, emptyData, normalize, findTrack, addTrack,
  startTimer, timerStatus, stopTimer, addSession, sessionsBetween, addTask, resolveTask, toggleTask, removeTask, sortedTasks,
  addPlan, addProgramSlot, weekGrid, streaks, period, buildReport, reportCsv, csvCell, fmtDur, fmtClock };
