'use strict';
const { dateStr, pad } = require('./core');
function unfold(t) { return t.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); }
function unesc(s) { return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1'); }
function parseDT(val, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(val.trim());
  if (!m) return null;
  if (m[4] === undefined) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: '' };
  if (m[7]) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])); return { date: dateStr(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; }
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}
// Minimal ICS parser: VEVENT SUMMARY/DTSTART/DTEND, plus simple DAILY/WEEKLY RRULE (COUNT/UNTIL, capped at 366 occurrences).
function parseICS(text) {
  const events = []; let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur && cur.DTSTART) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(';');
    cur[name.toUpperCase()] = line.slice(i + 1); cur[name.toUpperCase() + '_P'] = params;
  }
  const out = [];
  for (const e of events) {
    const s = parseDT(e.DTSTART, e.DTSTART_P), en = e.DTEND ? parseDT(e.DTEND, e.DTEND_P) : null;
    if (!s) continue;
    const base = { title: unesc(e.SUMMARY || '(no title)'), date: s.date, start: s.time, end: en && en.date === s.date ? en.time : '', uid: e.UID || '' };
    out.push(base);
    const rr = e.RRULE && Object.fromEntries(e.RRULE.split(';').map((x) => x.split('=')));
    if (rr && (rr.FREQ === 'DAILY' || rr.FREQ === 'WEEKLY')) {
      const step = (rr.FREQ === 'DAILY' ? 1 : 7) * (Number(rr.INTERVAL) || 1);
      const until = rr.UNTIL ? parseDT(rr.UNTIL, []).date : null;
      const count = Math.min(Number(rr.COUNT) || 366, 366);
      const core = require('./core');
      for (let n = 1; n < count; n++) {
        const d = core.addDays(s.date, n * step); if (until && d > until) break;
        out.push(Object.assign({}, base, { date: d }));
      }
    }
  }
  return out;
}
// Merge, de-duplicating by uid+date+title so re-imports are idempotent.
function mergeEvents(data, evs) {
  const key = (e) => `${e.uid}|${e.date}|${e.start}|${e.title}`;
  const seen = new Set(data.events.map(key)); let added = 0;
  for (const e of evs) if (!seen.has(key(e))) { data.events.push(e); seen.add(key(e)); added++; }
  return added;
}
module.exports = { parseICS, mergeEvents };
