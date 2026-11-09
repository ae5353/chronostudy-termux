'use strict';
const http = require('http');
const core = require('./core'), store = require('./store'), tx = require('./termux');

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>ChronoStudy</title>
<style>body{font:16px system-ui;margin:0;background:#111;color:#ddd}nav{display:flex;gap:8px;padding:10px;background:#1c1c1c}
button{font:inherit;padding:8px 14px;background:#333;color:#eee;border:0;border-radius:6px}button.on{background:#2a6}
main{padding:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:6px;vertical-align:top}
.bar{background:#2a6;height:14px;border-radius:3px}.mut{color:#888}.today{outline:2px solid #2a6}a{color:#6cf}small{color:#999}</style>
<nav><button data-t=week class=on>Week</button><button data-t=cal>Calendar</button><button data-t=rep>Reports</button></nav><main id=m></main>
<script>
const $=s=>document.querySelector(s),m=$('#m');let tab='week',anchor=new Date().toISOString().slice(0,10),rtype='week';
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const dur=x=>x>=60?Math.floor(x/60)+'h'+String(x%60).padStart(2,'0'):x+'m';
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));b.classList.add('on');tab=b.dataset.t;draw()});
async function j(u){return (await fetch(u)).json()}
async function draw(){
 if(tab==='week'){const g=await j('/api/week?date='+anchor);m.innerHTML='<h2>Week program</h2><table><tr>'+g.map(d=>'<th class="'+(d.today?'today':'')+'">'+d.name+'<br><small>'+d.date.slice(5)+' · '+dur(d.minutes)+'</small></th>').join('')+'</tr><tr>'+g.map(d=>'<td>'+(d.slots.map(s=>'<div><small>'+s.start+(s.end?'-'+s.end:'')+'</small><br>'+(s.kind==='event'?'★ ':'')+esc(s.label)+'</div>').join('<hr>')||'<span class=mut>—</span>')+'</td>').join('')+'</tr></table>'}
 if(tab==='cal'){const d=new Date(anchor+'T00:00');const y=d.getFullYear(),mo=d.getMonth();const r=await j('/api/report?type=month&date='+anchor);const ev=(await j('/api/events'));
  const first=(new Date(y,mo,1).getDay()+6)%7,n=new Date(y,mo+1,0).getDate();let h='<h2>'+d.toLocaleString('default',{month:'long',year:'numeric'})+'</h2><table><tr>'+['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>'<th>'+x+'</th>').join('')+'</tr><tr>';
  for(let i=0;i<first;i++)h+='<td></td>';
  for(let k=1;k<=n;k++){const ds=y+'-'+String(mo+1).padStart(2,'0')+'-'+String(k).padStart(2,'0');const mins=(r.daily.find(x=>x.date===ds)||{}).minutes||0;
   h+='<td><b>'+k+'</b> <small>'+(mins?dur(mins):'')+'</small>'+ev.filter(e=>e.date===ds).map(e=>'<div><small>★ '+esc(e.title)+'</small></div>').join('')+'</td>';if((first+k)%7===0&&k<n)h+='</tr><tr>'}
  m.innerHTML=h+'</tr></table>'}
 if(tab==='rep'){const r=await j('/api/report?type='+rtype+'&date='+anchor);const mx=Math.max(1,...r.daily.map(x=>x.minutes));
  m.innerHTML='<p><button onclick="rtype=\\'week\\';draw()">Week</button> <button onclick="rtype=\\'month\\';draw()">Month</button> <a href="/report.csv?type='+rtype+'">CSV</a> <a href="/api/report?type='+rtype+'">JSON</a></p><h2>'+r.period.start+' → '+r.period.end+'</h2><p><b>'+dur(r.totals.minutes)+'</b> · '+r.totals.sessions+' sessions · '+r.totals.tasksDone+' tasks done</p>'+
  '<h3>By track</h3><table>'+(r.byTrack.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+dur(t.minutes)+'</td><td style=width:50%><div class=bar style=width:'+Math.round(t.minutes/r.byTrack[0].minutes*100)+'%></div></td></tr>').join('')||'<tr><td class=mut>No sessions</td></tr>')+'</table>'+
  '<h3>Goals</h3><table>'+(r.goals.map(g=>'<tr><td>'+esc(g.track)+'</td><td>'+g.actualHours+' / '+g.targetHoursPerWeek+' h/week</td></tr>').join('')||'<tr><td class=mut>No goals set</td></tr>')+'</table>'+
  '<h3>Daily</h3><table>'+r.daily.map(x=>'<tr><td>'+x.date+'</td><td>'+dur(x.minutes)+'</td><td style=width:60%><div class=bar style=width:'+Math.round(x.minutes/mx*100)+'%></div></td></tr>').join('')+'</table>'}
}
draw();
</script>`;

function handler(req, res) {
  const u = new URL(req.url, 'http://x'); const q = u.searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') || '') ? q.get('date') : core.dateStr(new Date());
  const type = q.get('type') === 'month' ? 'month' : 'week';
  const send = (code, body, ct) => { res.writeHead(code, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); res.end(body); };
  try {
    const d = store.load();
    switch (u.pathname) {
      case '/': return send(200, PAGE, 'text/html; charset=utf-8');
      case '/api/week': return send(200, JSON.stringify(core.weekGrid(d, date).map((x) => Object.assign(x, { today: x.date === core.dateStr(new Date()) }))), 'application/json');
      case '/api/events': return send(200, JSON.stringify(d.events), 'application/json');
      case '/api/report': return send(200, JSON.stringify(core.buildReport(d, type, date)), 'application/json');
      case '/report.csv': return send(200, core.reportCsv(core.buildReport(d, type, date)), 'text/csv; charset=utf-8');
      default: return send(404, 'not found', 'text/plain');
    }
  } catch (e) { send(500, String(e.message), 'text/plain'); }
}

function createServer() { return http.createServer(handler); }
function start({ port = 8787, open = false } = {}) {
  const s = createServer();
  s.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${port} is busy; try --port N` : e.message); process.exit(1); });
  // Bound to loopback only: reachable from the same device, not the network.
  s.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`ChronoStudy dashboard: ${url}  (Ctrl+C to stop)`);
    if (open && !tx.openUrl(url)) console.log('termux-open-url not found; open the URL in your browser manually.');
  });
  return s;
}
module.exports = { start, createServer };
