'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');

test('core: dateStr, fmtDur, fmtClock', () => {
  const d = new Date(2026, 10, 9, 14, 30);
  assert.equal(core.dateStr(d), '2026-11-09');
  assert.equal(core.fmtDur(45), '45m');
  assert.equal(core.fmtDur(90), '1h30');
  assert.equal(core.fmtClock(65000), '01:05');
});

test('core: addTrack and resolveTrack', () => {
  const d = { tracks: [], sessions: [], tasks: [], plan: [], program: [] };
  core.addTrack(d, 'Systems', 8);
  assert.equal(d.tracks.length, 1);
  assert.equal(d.tracks[0].name, 'Systems');
  assert.equal(d.tracks[0].targetHoursPerWeek, 8);
});

test('core: addTask and toggleTask', () => {
  const d = { tracks: [], sessions: [], tasks: [], plan: [], program: [] };
  const t = core.addTask(d, { title: 'Test Task', priority: 'high' });
  assert.equal(t.title, 'Test Task');
  assert.equal(t.priority, 1); // high = 1
  assert.equal(t.done, false);

  core.toggleTask(d, t.id, new Date());
  assert.equal(t.done, true);
});
