'use strict';
const core = require('./core'), store = require('./store'), tx = require('./termux'), ics = require('./ics');
const { parse } = require('./args');
const out = (s = '') => process.stdout.write(s + '\n');
const now = () => new Date();
const today = () => core.dateStr(now());
const flagStr = (f, ...ks) => { for (const k of ks) if (f[k] !== undefined && f[k] !== true) return String(f[k]); return ''; };

const HELP = `chronostudy (cs) - terminal study planner

  cs                              interactive TUI
  cs start <track> [--pomo] [--topic T]   start timer (free or pomodoro)
  cs stop [--rating 1-5] [--notes N]      stop timer, log the session
  cs status                       show running timer
  cs track add <name> [--goal H]  create a track (H = target hours/week)
  cs track list
  cs todo add <title> [-t track] [-p high|med|low] [-d YYYY-MM-DD] [-s parentRef]
  cs todo [list] | done <n|id> | rm <n|id>
  cs plan add <text> [--date D] | cs plan   today's plan  (plan done <n>)
  cs log [-n 20]                  recent sessions
  cs log add <track> <minutes> [--topic T] [--rating N] [--notes N] [--date D]
  cs week [--date D]              weekly program grid
  cs week add <Mon..Sun> <HH:MM> <HH:MM> <track> [title]
  cs report week|month [--date D] [--csv|--json|--push <AppsScriptUrl>]
  cs import-ics <file|url>
  cs serve [--port 8787] [--open]  browser dashboard on this device
  cs export                       print all data as JSON
`;

function fmtTask(t, i, data) {
  const pri = ['', '!!!', '!! ', '!  '][t.priority];
  return `${String(i + 1).padStart(2)} [${t.done ? 'x' : ' '}] ${t.parent ? '  └ ' : ''}${pri} ${t.title}${t.track ? ' #' + t.track : ''}${t.due ? ' (due ' + t.due + ')' : ''}`;
}

function printWeek(data, anchor) {
  for (const d of core.weekGrid(data, anchor)) {
    out(`${d.name} ${d.date}${d.date === today() ? '  <- today' : ''}   studied ${core.fmtDur(d.minutes)}`);
    d.slots.forEach((s) => out(`   ${s.start}${s.end ? '-' + s.end : '      '}  ${s.kind === 'event' ? '* ' : ''}${s.label}`));
  }
}

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  const a1 = parse(argv.slice(1), ['pomo', 'csv', 'json', 'open']);
  const f = a1.flags;
  switch (cmd) {
    case undefined: case 'tui': return require('./tui').run();
    case 'help': case '-h': case '--help': return out(HELP);
    case 'start': {
      const track = a1.pos.join(' ');
      store.update((d) => core.startTimer(d, track, now(), { pomodoro: !!f.pomo, topic: flagStr(f, 'topic') }));
      tx.wakeLock(); return out(`Started ${f.pomo ? 'pomodoro' : 'free'} timer on "${track}".`);
    }
    case 'stop': {
      const s = store.update((d) => core.stopTimer(d, now(), { rating: flagStr(f, 'rating'), notes: flagStr(f, 'notes'), topic: flagStr(f, 'topic') }));
      tx.wakeUnlock(); return out(`Logged ${core.fmtDur(s.minutes)} on "${s.track}" (${s.start}-${s.end}).`);
    }
    case 'status': {
      const d = store.load(), st = core.timerStatus(d, now());
      if (!st) return out('No timer running.');
      return out(`${st.track} [${st.mode}] elapsed ${core.fmtClock(st.elapsedMs)}` + (st.remainingMs != null ? `  ${st.phase} ${core.fmtClock(st.remainingMs)} left` : ''));
    }
    case 'track': {
      if (sub === 'add') { const name = a1.pos.slice(1).join(' '); store.update((d) => core.addTrack(d, name, Number(f.goal) || 0)); return out(`Track "${name}" saved.`); }
      const d = store.load(); if (!d.tracks.length) return out('No tracks yet. Create one: cs track add <name> --goal 5');
      return d.tracks.forEach((t) => out(`${t.name}${t.targetHoursPerWeek ? '  goal ' + t.targetHoursPerWeek + 'h/week' : ''}`));
    }
    case 'todo': {
      if (sub === 'add') {
        const t = store.update((d) => { const p = flagStr(f, 's', 'sub'); const par = p ? core.resolveTask(d, p) : null;
          if (p && !par) throw new Error('Parent not found');
          return core.addTask(d, { title: a1.pos.slice(1).join(' '), track: flagStr(f, 't', 'track'), priority: flagStr(f, 'p', 'priority') || 'med', due: flagStr(f, 'd', 'due'), parent: par && par.id }); });
        return out('Added: ' + t.title);
      }
      if (sub === 'done' || sub === 'rm') {
        const r = store.update((d) => { const t = core.resolveTask(d, a1.pos[1]); if (!t) throw new Error('Task not found');
          if (sub === 'done') core.toggleTask(d, t.id, now()); else core.removeTask(d, t.id); return t; });
        return out((sub === 'done' ? 'Toggled: ' : 'Removed: ') + r.title);
      }
      const d = store.load(); const l = core.sortedTasks(d);
      return l.length ? l.forEach((t, i) => out(fmtTask(t, i, d))) : out('No tasks. Add: cs todo add "title" -p high -d 2025-01-31');
    }
    case 'plan': {
      if (sub === 'add') { store.update((d) => core.addPlan(d, flagStr(f, 'date') || today(), a1.pos.slice(1).join(' '))); return out('Added to plan.'); }
      if (sub === 'done') { store.update((d) => { const l = d.plan.filter((p) => p.date === today()); const p = l[Number(a1.pos[1]) - 1]; if (!p) throw new Error('No such item'); p.done = !p.done; }); return out('Toggled.'); }
      const l = store.load().plan.filter((p) => p.date === today());
      return l.length ? l.forEach((p, i) => out(`${i + 1} [${p.done ? 'x' : ' '}] ${p.text}`)) : out('Nothing planned today. Add: cs plan add "text"');
    }
    case 'log': {
      if (sub === 'add') {
        const [track, mins] = a1.pos.slice(1); const m = Number(mins); if (!track || !(m > 0)) throw new Error('Usage: cs log add <track> <minutes>');
        const day = flagStr(f, 'date') || today();
        const end = f.date ? new Date(core.parseDate(day).getTime() + 12 * 3600e3 + m * 60e3) : now();
        const s = store.update((d) => core.addSession(d, { track, start: new Date(end.getTime() - m * 60e3), end, topic: flagStr(f, 'topic'), rating: flagStr(f, 'rating') || null, notes: flagStr(f, 'notes') }));
        return out(`Logged ${core.fmtDur(s.minutes)} on "${s.track}" for ${s.date}.`);
      }
      const n = Number(f.n) || 20; const l = store.load().sessions.sort((a, b) => b.startTs - a.startTs).slice(0, n);
      if (!l.length) return out('No sessions yet. Start one: cs start <track>');
      return l.forEach((s) => out(`${s.date} ${s.start}-${s.end} ${core.fmtDur(s.minutes).padStart(5)}  ${s.track}${s.topic ? ' / ' + s.topic : ''}${s.rating ? ' *' + s.rating : ''}${s.notes ? '  "' + s.notes + '"' : ''}`));
    }
    case 'week': {
      if (sub === 'add') { const [, day, st, en, track, ...title] = a1.pos; store.update((d) => core.addProgramSlot(d, { day, start: st, end: en, track, title: title.join(' ') })); return out('Slot added.'); }
      return printWeek(store.load(), flagStr(f, 'date') || today());
    }
    case 'report': {
      if (!['week', 'month'].includes(sub)) throw new Error('Usage: cs report week|month [--csv|--json|--push url]');
      const r = core.buildReport(store.load(), sub, flagStr(f, 'date') || today());
      if (f.csv) return process.stdout.write(core.reportCsv(r));
      if (f.json) return out(JSON.stringify(r, null, 2));
      if (f.push) {
        const res = await fetch(String(f.push), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(r), redirect: 'follow' });
        const body = (await res.text()).slice(0, 200);
        if (!res.ok) throw new Error(`Push failed: HTTP ${res.status} ${body}`);
        return out(`Pushed ${sub} report (${r.sessions.length} sessions). Response: ${body.replace(/\s+/g, ' ')}`);
      }
      out(`${sub} ${r.period.start} .. ${r.period.end}: ${core.fmtDur(r.totals.minutes)} in ${r.totals.sessions} sessions, ${r.totals.tasksDone} tasks done`);
      r.byTrack.forEach((t) => out(`  ${t.name.padEnd(20)} ${core.fmtDur(t.minutes).padStart(6)}  ${t.sessions}x`));
      r.goals.forEach((g) => out(`  goal ${g.track}: ${g.actualHours}/${g.targetHoursPerWeek} h/week`));
      return;
    }
    case 'import-ics': {
      const src = a1.pos[0]; if (!src) throw new Error('Usage: cs import-ics <file|url>');
      const text = /^https?:\/\//.test(src) ? await (await fetch(src)).text() : require('fs').readFileSync(src, 'utf8');
      const evs = ics.parseICS(text); const n = store.update((d) => ics.mergeEvents(d, evs));
      return out(`Imported ${n} new events (${evs.length} parsed).`);
    }
    case 'serve': return require('./server').start({ port: Number(f.port) || 8787, open: !!f.open });
    case 'export': return out(JSON.stringify(store.load(), null, 2));
    default: out(`Unknown command: ${cmd}\n`); out(HELP); process.exitCode = 2;
  }
}
module.exports = { main };
