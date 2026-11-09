'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const core = require('./core');
const home = () => process.env.CS_HOME || path.join(os.homedir(), '.chronostudy');
const file = () => path.join(home(), 'data.json');
const BACKUPS = 10;

function load() {
  fs.mkdirSync(home(), { recursive: true });
  const f = file();
  if (!fs.existsSync(f)) return core.normalize();
  try { return core.normalize(JSON.parse(fs.readFileSync(f, 'utf8'))); }
  catch (e) {
    // corrupted: fall back to newest valid backup
    const dir = path.join(home(), 'backups');
    const list = fs.existsSync(dir) ? fs.readdirSync(dir).sort().reverse() : [];
    for (const b of list) { try { const d = core.normalize(JSON.parse(fs.readFileSync(path.join(dir, b), 'utf8')));
      process.stderr.write(`chronostudy: data.json corrupted, restored from backup ${b}\n`); return d; } catch (_) {} }
    throw new Error('data.json is corrupted and no valid backup exists: ' + e.message);
  }
}
// Atomic: write temp file, fsync, rename. Previous version is copied into backups/ first.
function save(data) {
  fs.mkdirSync(home(), { recursive: true });
  const f = file();
  if (fs.existsSync(f)) {
    const dir = path.join(home(), 'backups'); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(f, path.join(dir, `data-${stamp}.json`));
    fs.readdirSync(dir).sort().slice(0, -BACKUPS).forEach((x) => fs.unlinkSync(path.join(dir, x)));
  }
  const tmp = f + '.' + process.pid + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, f);
}
function update(fn) { const d = load(); const r = fn(d); save(d); return r; }
module.exports = { load, save, update, home };
