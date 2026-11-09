'use strict';
const { spawnSync, spawn } = require('child_process');
const cache = {};
function has(cmd) {
  if (cmd in cache) return cache[cmd];
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return (cache[cmd] = r.status === 0);
}
function run(cmd, args) {
  if (!has(cmd)) return false;
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); return true; } catch (_) { return false; }
}
const notify = (title, text) => run('termux-notification', ['--title', title, '--content', text, '--id', 'chronostudy']);
const vibrate = (ms = 300) => run('termux-vibrate', ['-d', String(ms)]);
const wakeLock = () => run('termux-wake-lock', []);
const wakeUnlock = () => run('termux-wake-unlock', []);
const openUrl = (u) => run('termux-open-url', [u]);
module.exports = { has, notify, vibrate, wakeLock, wakeUnlock, openUrl };
