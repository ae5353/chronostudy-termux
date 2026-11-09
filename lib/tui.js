'use strict';
// Full-screen ANSI TUI. Keyboard + touch (SGR mouse: tap tabs, rows and bottom buttons). No dependencies.
const core = require('./core'), store = require('./store'), tx = require('./termux');
const out = process.stdout;
const ESC = '\x1b[';
const S = { rev: ESC + '7m', bold: ESC + '1m', dim: ESC + '2m', green: ESC + '32m', yellow: ESC + '33m', red: ESC + '31m', cyan: ESC + '36m', reset: ESC + '0m' };
const clip = (s, w) => { s = String(s); return s.length > w ? s.slice(0, Math.max(0, w - 1)) + '…' : s; };
const padR = (s, w) => clip(s, w).padEnd(w);
const TABS = ['Dashboard', 'Todo', 'Week', 'Log'];

function run() {
  if (!process.stdin.isTTY || !out.isTTY) { console.error('The TUI needs an interactive terminal. See `cs help` for commands.'); process.exitCode = 1; return; }
  const st = { tab: 0, sel: [0, 0, 0, 0], weekOff: 0, msg: '', msgAt: 0, prompt: null, regions: [], lastPhase: null, help: false };
  let data = store.load();
  let timerId;

  const say = (m) => { st.msg = m; st.msgAt = Date.now(); };
  const mutate = (fn) => { try { const r = store.update(fn); data = store.load(); return r; } catch (e) { say('! ' + e.message); data = store.load(); return null; } };
  const anchor = () => core.addDays(core.dateStr(new Date()), st.weekOff * 7);
  const todayPlan = () => data.plan.filter((p) => p.date === core.dateStr(new Date()));

  // ----- prompts: ask(label, initial) -> Promise<string|null> -----
  function ask(label, initial = '', hint = '') {
    return new Promise((res) => { st.prompt = { label, buf: initial, hint, res }; draw(); });
  }
  async function askMany(fields) { const r = []; for (const [l, i, h] of fields) { const v = await ask(l, i, h); if (v === null) return null; r.push(v.trim()); } return r; }
  async function pickTrack(label = 'Track') {
    const hint = data.tracks.length ? 'existing: ' + data.tracks.map((t) => t.name).join(', ') : 'type a new track name';
    return ask(label, data.timer ? data.timer.track : (data.tracks[0] ? data.tracks[0].name : ''), hint);
  }

  // ----- actions -----
  async function startTimer(pomo) {
    if (data.timer) return say('Timer already running (x to stop)');
    const t = await pickTrack(); if (!t || !t.trim()) return;
    const r = mutate((d) => core.startTimer(d, t, new Date(), { pomodoro: pomo }));
    if (r) { tx.wakeLock(); say(`Started ${pomo ? 'pomodoro' : 'free'} on ${t}`); }
  }
  async function stopTimer() {
    if (!data.timer) return say('No timer running');
    const f = await askMany([['Topic (optional)', data.timer.topic || ''], ['Rating 1-5 (optional)', ''], ['Notes (optional)', '']]);
    if (!f) return say('Cancelled - timer still running');
    const s = mutate((d) => core.stopTimer(d, new Date(), { topic: f[0], rating: f[1] && Number(f[1]) >= 1 && Number(f[1]) <= 5 ? f[1] : null, notes: f[2] }));
    if (s) { tx.wakeUnlock(); say(`Logged ${core.fmtDur(s.minutes)} on ${s.track}`); }
  }
  async function addTask(parent) {
    const f = parent ? await askMany([['Subtask title']]) : await askMany([['Task title'], ['Track (optional)', '', data.tracks.map((t) => t.name).join(', ')], ['Priority high|med|low', 'med'], ['Due YYYY-MM-DD (optional)']]);
    if (!f || !f[0]) return;
    mutate((d) => core.addTask(d, parent ? { title: f[0], parent } : { title: f[0], track: f[1], priority: f[2] || 'med', due: f[3] }));
  }
  async function addSession() {
    const t = await pickTrack(); if (!t) return;
    const f = await askMany([['Minutes', '25'], ['Topic (optional)'], ['Rating 1-5 (optional)'], ['Notes (optional)']]);
    if (!f || !(Number(f[0]) > 0)) return;
    const end = new Date(); mutate((d) => core.addSession(d, { track: t, start: new Date(end - Number(f[0]) * 60000), end, topic: f[1], rating: f[2] || null, notes: f[3] }));
  }
  async function addSlot() {
    const f = await askMany([['Day Mon..Sun', core.DAYS[(new Date().getDay() + 6) % 7]], ['Start HH:MM'], ['End HH:MM'], ['Track', '', data.tracks.map((t) => t.name).join(', ')], ['Title (optional)']]);
    if (!f || !f[1]) return;
    mutate((d) => core.addProgramSlot(d, { day: f[0], start: f[1], end: f[2], track: f[3], title: f[4] }));
  }
  const sessionsDesc = () => data.sessions.slice().sort((a, b) => b.startTs - a.startTs);

  async function act(key) {
    const t = st.tab;
    if (key === 'a') {
      if (t === 0) { const v = await ask('Add to today\'s plan'); if (v && v.trim()) mutate((d) => core.addPlan(d, core.dateStr(new Date()), v.trim())); }
      else if (t === 1) await addTask(null);
      else if (t === 2) await addSlot();
      else await addSession();
    } else if (key === 'A' && t === 1) {
      const p = core.sortedTasks(data)[st.sel[1]]; if (p) await addTask(p.parent || p.id);
    } else if (key === ' ' || key === '\r') {
      if (t === 0) { const p = todayPlan()[st.sel[0]]; if (p) mutate((d) => { const x = d.plan.find((y) => y.id === p.id); x.done = !x.done; }); }
      else if (t === 1) { const k = core.sortedTasks(data)[st.sel[1]]; if (k) mutate((d) => core.toggleTask(d, k.id, new Date())); }
      else if (t === 3 && key === '\r') await editNotes();
    } else if (key === 'd') {
      if (t === 0) { const p = todayPlan()[st.sel[0]]; if (p) mutate((d) => { d.plan = d.plan.filter((y) => y.id !== p.id); }); }
      else if (t === 1) { const k = core.sortedTasks(data)[st.sel[1]]; if (k) mutate((d) => core.removeTask(d, k.id)); }
      else if (t === 3) { const s = sessionsDesc()[st.sel[3]]; if (s && (await ask(`Delete session ${s.date} ${s.track}? type y`)) === 'y') mutate((d) => { d.sessions = d.sessions.filter((y) => y.id !== s.id); }); }
    } else if (key === 'p' && t === 1) {
      const k = core.sortedTasks(data)[st.sel[1]]; if (k) mutate((d) => { const x = d.tasks.find((y) => y.id === k.id); x.priority = x.priority % 3 + 1; });
    } else if (key === 'D' && t === 1) {
      const k = core.sortedTasks(data)[st.sel[1]]; if (k) { const v = await ask('Due YYYY-MM-DD (empty clears)', k.due); if (v !== null) mutate((d) => { const x = d.tasks.find((y) => y.id === k.id); if (v.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) throw new Error('Bad date'); x.due = v.trim(); }); }
    } else if (key === 'n' && t === 3) await editNotes();
    else if (key === 'x' && t === 2) { /* reserved */ }
    else if (key === 'g') {
      const tr = await pickTrack('Set weekly goal for track'); if (!tr) return;
      const h = await ask('Target hours per week', String((core.findTrack(data, tr) || {}).targetHoursPerWeek || '')); if (h === null) return;
      mutate((d) => core.addTrack(d, tr, Number(h) || 0));
    }
  }
  async function editNotes() {
    const s = sessionsDesc()[st.sel[3]]; if (!s) return;
    const f = await askMany([['Topic', s.topic], ['Rating 1-5', s.rating || ''], ['Notes', s.notes]]); if (!f) return;
    mutate((d) => { const x = d.sessions.find((y) => y.id === s.id); x.topic = f[0]; x.rating = f[1] ? Number(f[1]) : null; x.notes = f[2]; });
  }

  function move(delta) {
    const t = st.tab;
    if (t === 2) { st.weekOff += delta; return; }
    const n = t === 0 ? todayPlan().length : t === 1 ? data.tasks.length : data.sessions.length;
    st.sel[t] = Math.max(0, Math.min(Math.max(0, n - 1), st.sel[t] + delta));
  }

  // ----- drawing -----
  function barStr(frac, w) { const n = Math.round(Math.max(0, Math.min(1, frac)) * w); return '█'.repeat(n) + '░'.repeat(w - n); }
  function buildLines(cols, rows) {
    const L = []; // {text, style, click}
    const add = (text, style = '', click = null) => L.push({ text, style, click });
    const now = new Date(), today = core.dateStr(now), t = st.tab;
    const bodyH = rows - 3;
    if (t === 0) {
      const ts = core.timerStatus(data, now);
      add('');
      if (ts) {
        const big = ts.remainingMs != null ? core.fmtClock(ts.remainingMs) : core.fmtClock(ts.elapsedMs);
        add(`  ${ts.mode === 'pomodoro' ? (ts.phase === 'focus' ? '● FOCUS' : '☕ BREAK') + ' #' + ts.cycle : '● FREE TIMER'}   ${ts.track}${ts.topic ? ' / ' + ts.topic : ''}`, ts.phase === 'break' ? S.yellow : S.green);
        add(`  ${big}${ts.remainingMs != null ? '  remaining  (elapsed ' + core.fmtClock(ts.elapsedMs) + ')' : '  elapsed'}`, S.bold);
        if (ts.remainingMs != null) { const tot = (ts.phase === 'focus' ? data.settings.work : (ts.cycle === data.settings.cycles ? data.settings.longBrk : data.settings.brk)) * 60000; add('  ' + barStr(1 - ts.remainingMs / tot, Math.min(40, cols - 4)), S.cyan); }
      } else { add('  No timer running.', S.dim); add('  [s] free timer   [p] pomodoro   (tap the buttons below)', S.dim); }
      add('');
      const td = core.sessionsBetween(data, today, today), tm = td.reduce((a, s) => a + s.minutes, 0), sk = core.streaks(data, today);
      add(`  Today ${core.fmtDur(tm)} in ${td.length} session(s)   Streak ${sk.current}d (best ${sk.best}d)`, S.bold);
      const rep = core.buildReport(data, 'week', today);
      rep.goals.forEach((g) => add(`  ${padR(g.track, 14)} ${barStr(g.actualHours / g.targetHoursPerWeek, 20)} ${g.actualHours}/${g.targetHoursPerWeek}h`, g.actualHours >= g.targetHoursPerWeek ? S.green : ''));
      if (!data.tracks.length) add('  Tracks are yours to define: start a timer with a new name, or press [g] to set a goal.', S.dim);
      add('');
      add("  Today's plan   (a add, space toggle, d delete)", S.bold);
      const pl = todayPlan(); if (!pl.length) add('   - nothing planned -', S.dim);
      pl.forEach((p, i) => add(`   [${p.done ? 'x' : ' '}] ${p.text}`, i === st.sel[0] ? S.rev : '', () => { st.sel[0] = i; }));
      add('');
      add('  Next tasks', S.bold);
      core.sortedTasks(data).filter((x) => !x.done).slice(0, 4).forEach((x) => add(`   ${['', '!!!', '!! ', '!  '][x.priority]} ${x.title}${x.due ? '  due ' + x.due : ''}`, x.due && x.due < today ? S.red : ''));
    } else if (t === 1) {
      add('  Tasks  (a add · A subtask · space done · p priority · D due · d delete)', S.bold);
      const l = core.sortedTasks(data); if (!l.length) add('   no tasks yet — press a', S.dim);
      l.forEach((x, i) => {
        const od = !x.done && x.due && x.due < today;
        add(` ${x.done ? '[x]' : '[ ]'} ${x.parent ? '   └ ' : ''}${['', '!!!', '!! ', '!  '][x.priority]} ${x.title}${x.track ? '  #' + x.track : ''}${x.due ? '  due ' + x.due : ''}`,
          (i === st.sel[1] ? S.rev : '') + (x.done ? S.dim : od ? S.red : ''), () => { st.sel[1] = i; });
      });
    } else if (t === 2) {
      const g = core.weekGrid(data, anchor());
      add(`  Week of ${g[0].date}  (←/→ or h/l change week, a add slot, ★ = imported event)${st.weekOff ? '  [offset ' + st.weekOff + ']' : ''}`, S.bold);
      if (cols >= 98) {
        const w = Math.floor((cols - 2) / 7);
        add(' ' + g.map((d) => padR(d.name + ' ' + d.date.slice(5), w - 1) + ' ').join(''), S.bold);
        add(' ' + g.map((d) => padR('studied ' + core.fmtDur(d.minutes), w - 1) + ' ').join(''), S.dim);
        const maxN = Math.max(1, ...g.map((d) => d.slots.length));
        for (let i = 0; i < Math.min(maxN, bodyH - 4); i++) add(' ' + g.map((d) => { const s = d.slots[i]; return padR(s ? `${s.start} ${s.kind === 'event' ? '★' : ''}${s.label}` : '', w - 1) + ' '; }).join(''));
      } else g.forEach((d) => {
        add(`  ${d.name} ${d.date}  studied ${core.fmtDur(d.minutes)}${d.date === today ? '   <- today' : ''}`, d.date === today ? S.green : S.bold);
        d.slots.forEach((s) => add(`     ${s.start}${s.end ? '-' + s.end : ''} ${s.kind === 'event' ? '★ ' : ''}${s.label}`));
      });
    } else {
      add('  Study log  (a add · enter/n edit notes · d delete)', S.bold);
      const l = sessionsDesc(); if (!l.length) add('   no sessions yet — start a timer or press a', S.dim);
      l.forEach((s, i) => add(` ${s.date} ${s.start}-${s.end} ${core.fmtDur(s.minutes).padStart(5)}  ${s.track}${s.topic ? ' / ' + s.topic : ''}${s.rating ? '  ★' + s.rating : ''}`, i === st.sel[3] ? S.rev : '', () => { st.sel[3] = i; }));
      const s = l[st.sel[3]];
      if (s && s.notes) { add(''); add('  Notes: ' + s.notes, S.cyan); }
    }
    return L;
  }

  function buttons() {
    const common = [['Tab', '\t'], ['s Start', 's'], ['p Pomo', 'p0'], ['x Stop', 'x'], ['g Goal', 'g'], ['? Help', '?'], ['q Quit', 'q']];
    const ctx = [['a Add', 'a']];
    if (st.tab === 1) ctx.push(['A Sub', 'A'], ['␣ Done', ' '], ['p Prio', 'p1'], ['D Due', 'D'], ['d Del', 'd']);
    if (st.tab === 0) ctx.push(['␣ Toggle', ' '], ['d Del', 'd']);
    if (st.tab === 3) ctx.push(['n Notes', 'n'], ['d Del', 'd']);
    if (st.tab === 2) ctx.push(['◀ Prev', 'left'], ['Next ▶', 'right']);
    return ctx.concat(common);
  }

  function draw() {
    const cols = out.columns || 80, rows = out.rows || 24;
    const regions = []; const buf = [ESC + '?25l', ESC + 'H'];
    const line = (r, text, style = '') => buf.push(`${ESC}${r};1H${style}${padR(text, cols)}${S.reset}`);
    // tabs
    let x = 1, tabs = '';
    TABS.forEach((n, i) => { const lab = ` ${i + 1} ${n} `; regions.push({ row: 1, c0: x, c1: x + lab.length - 1, fn: () => { st.tab = i; } }); tabs += lab; x += lab.length; });
    buf.push(`${ESC}1;1H${S.bold}${padR('', cols)}${ESC}1;1H`);
    TABS.forEach((n, i) => buf.push((i === st.tab ? S.rev : S.dim) + ` ${i + 1} ${n} ` + S.reset));
    const tsb = core.timerStatus(data, new Date());
    if (tsb) { const s = ` ● ${tsb.track} ${core.fmtClock(tsb.remainingMs != null ? tsb.remainingMs : tsb.elapsedMs)} `; if (cols > tabs.length + s.length) buf.push(`${ESC}1;${cols - s.length + 1}H${S.green}${s}${S.reset}`); }
    // body
    if (st.help) {
      const H = ['ChronoStudy keys', '', 'Tab / Shift-Tab / 1-4   switch view', '↑ ↓ / j k              move selection', '← → / h l              prev/next week (Week view)', 'a  add (plan / task / slot / session)', 'A  add subtask (Todo)    space/enter toggle', 'p  priority (Todo) or pomodoro start elsewhere', 'D  due date (Todo)       d delete', 's  start free timer      P  start pomodoro', 'x  stop & log            g  set weekly goal', 'q / Ctrl-C quit          Touch: tap tabs, rows, buttons', '', 'Press any key to close'];
      H.forEach((h, i) => line(3 + i, '  ' + h, i === 0 ? S.bold : ''));
    } else {
      const L = buildLines(cols, rows); const bodyH = rows - 3;
      // scroll so the selected row is visible
      let off = 0; const si = L.findIndex((l) => l.style.includes(S.rev));
      if (si >= bodyH) off = si - bodyH + 3;
      for (let i = 0; i < bodyH; i++) { const l = L[i + off]; line(2 + i, l ? l.text : '', l ? l.style : ''); if (l && l.click) regions.push({ row: 2 + i, c0: 1, c1: cols, fn: l.click }); }
    }
    // status / prompt
    if (st.prompt) {
      line(rows - 1, `${st.prompt.label}${st.prompt.hint ? ' (' + st.prompt.hint + ')' : ''}`, S.yellow);
      const p = `> ${st.prompt.buf}`; buf.push(`${ESC}${rows};1H${S.bold}${padR(p + '   [Enter ok · Esc cancel]', cols)}${S.reset}${ESC}${rows};${Math.min(cols, p.length + 1)}H${ESC}?25h`);
    } else {
      line(rows - 1, Date.now() - st.msgAt < 5000 ? st.msg : '', st.msg.startsWith('!') ? S.red : S.cyan);
      let bx = 1; buf.push(`${ESC}${rows};1H`);
      for (const [lab, key] of buttons()) {
        const s = ` ${lab} `; if (bx + s.length > cols) break;
        regions.push({ row: rows, c0: bx, c1: bx + s.length - 1, fn: () => handleKey(key) });
        buf.push(S.rev + s + S.reset + ' '); bx += s.length + 1;
      }
    }
    st.regions = regions; out.write(buf.join(''));
  }

  // ----- input -----
  async function handleKey(k) {
    if (st.prompt) return promptKey(k);
    if (st.help) { st.help = false; return draw(); }
    switch (k) {
      case 'q': case '\x03': return quit();
      case '?': st.help = true; break;
      case '\t': case 'right': if (st.tab === 2 && k === 'right') { move(1); break; } st.tab = (st.tab + 1) % 4; break;
      case '\x1b[Z': st.tab = (st.tab + 3) % 4; break;
      case 'left': if (st.tab === 2) move(-1); else st.tab = (st.tab + 3) % 4; break;
      case 'h': if (st.tab === 2) move(-1); break;
      case 'l': if (st.tab === 2) move(1); break;
      case '1': case '2': case '3': case '4': st.tab = Number(k) - 1; break;
      case 'up': case 'k': move(-1); break;
      case 'down': case 'j': move(1); break;
      case 's': await startTimer(false); break;
      case 'P': case 'p0': await startTimer(true); break;
      case 'p': if (st.tab === 1) await act('p'); else await startTimer(true); break;
      case 'p1': await act('p'); break;
      case 'x': await stopTimer(); break;
      default: await act(k);
    }
    draw();
  }
  async function promptKey(k) {
    const p = st.prompt;
    if (k === '\r') { st.prompt = null; p.res(p.buf); }
    else if (k === '\x1b' || k === '\x03') { st.prompt = null; p.res(null); }
    else if (k === '\x7f' || k === '\b') p.buf = p.buf.slice(0, -1);
    else if (k.length >= 1 && !k.startsWith('\x1b') && k >= ' ') p.buf += k;
    draw();
  }
  const KEYS = { '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left', '\x1bOA': 'up', '\x1bOB': 'down', '\x1bOC': 'right', '\x1bOD': 'left' };
  function onData(chunk) {
    const s = chunk.toString('utf8');
    const m = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g; let mm, hadMouse = false;
    while ((mm = m.exec(s))) { hadMouse = true;
      if (mm[4] === 'M' && (Number(mm[1]) & 3) === 0 && Number(mm[1]) < 32) {
        const c = Number(mm[2]), r = Number(mm[3]);
        const reg = st.regions.find((q) => q.row === r && c >= q.c0 && c <= q.c1);
        if (reg && !st.prompt) { Promise.resolve(reg.fn()).then(draw); }
      } else if (mm[4] === 'M' && Number(mm[1]) === 64 && !st.prompt) { move(-1); draw(); } else if (mm[4] === 'M' && Number(mm[1]) === 65 && !st.prompt) { move(1); draw(); }
    }
    if (hadMouse) return;
    if (KEYS[s]) return handleKey(KEYS[s]);
    if (s === '\x1b[Z') return handleKey(s);
    if (s.startsWith('\x1b') && s.length > 1) return; // ignore other escape sequences
    for (const ch of s) handleKey(ch);
  }

  function quit() {
    clearInterval(timerId);
    out.write(ESC + '?1000l' + ESC + '?1006l' + ESC + '?25h' + ESC + '?1049l');
    try { process.stdin.setRawMode(false); } catch (_) {}
    process.exit(0);
  }
  function tick() {
    try { data = store.load(); } catch (_) {}
    const ts = core.timerStatus(data, new Date());
    if (ts && ts.mode === 'pomodoro') {
      const key = ts.phase + ts.cycle;
      if (st.lastPhase && st.lastPhase !== key) {
        const msg = ts.phase === 'break' ? `Focus done - break ${core.fmtDur(ts.remainingMs / 60000)}` : 'Break over - back to focus';
        tx.notify('ChronoStudy', msg); tx.vibrate(400); out.write('\x07'); say(msg);
      }
      st.lastPhase = key;
    } else st.lastPhase = null;
    if (!st.prompt) draw();
  }

  out.write(ESC + '?1049h' + ESC + '?1000h' + ESC + '?1006h');
  process.stdin.setRawMode(true); process.stdin.resume();
  process.stdin.on('data', onData);
  out.on('resize', draw);
  process.on('SIGTERM', quit);
  process.on('uncaughtException', (e) => { out.write(ESC + '?1049l' + ESC + '?25h'); console.error(e); process.exit(1); });
  timerId = setInterval(tick, 1000);
  if (!data.tracks.length && !data.sessions.length) say('Welcome! Press s to start a timer - tracks are created as you type them.');
  draw();
}
module.exports = { run };
