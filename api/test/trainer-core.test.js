/* Personal trainer mode — the pure rules (trainer/core.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manages, studentView, applyPlan, enforcePlanLock, isPlanStamp, PLAN_KEYS } from '../trainer/core.js';

const T = { id: 't1', trainer: true }, T2 = { id: 't2', trainer: true };
const db = { users: [T, T2, { id: 's1', trainerId: 't1' }, { id: 's2', trainerId: 't2' }, { id: 's3', trainerId: 't1', disabled: true }, { id: 'x' }] };

test('a trainer manages only their own, enabled students', () => {
  assert.equal(manages(db, T, 's1'), true);
  assert.equal(manages(db, T, 's2'), false, "another trainer's student");
  assert.equal(manages(db, T, 's3'), false, 'disabled student');
  assert.equal(manages(db, T, 'x'), false, 'unlinked profile');
  assert.equal(manages(db, T, 't1'), false, 'themselves');
  assert.equal(manages(db, { id: 's1' }, 's1'), false, 'not a trainer');
  assert.equal(manages(db, { ...T, disabled: true }, 's1'), false, 'disabled trainer');
});

test('the student view carries the plan and history, never media, coach or reminders', () => {
  const S = {
    routines: [{ id: 'r' }], week: { mon: 'r' }, workouts: [{ id: 'w', d: '2026-10-01', media: [{ hash: 'h' }] }],
    bodyweight: [{ d: '2026-10-01', w: 80 }], coach: { consent: {} }, reminder: { on: true }, theme: 'dark', _wid: 'abc',
    customEx: [{ id: 'c1', name: 'Mine', media: { hash: 'h2' } }]
  };
  const v = studentView(S);
  assert.deepEqual(v.routines, S.routines);
  assert.deepEqual(v.workouts, [{ id: 'w', d: '2026-10-01' }]);
  assert.deepEqual(v.customEx, [{ id: 'c1', name: 'Mine' }]);
  for (const k of ['coach', 'reminder', 'theme', '_wid']) assert.ok(!(k in v), `${k} leaked`);
  assert.ok(S.workouts[0].media, 'source not mutated');
});

test('applyPlan takes only the plan keys the trainer sent, and adds custom exercises', () => {
  const cur = { routines: [{ id: 'old' }], rotation: { id: 'rot' }, workouts: [{ id: 'w' }], customEx: [{ id: 'c1', name: 'Mine' }], _rev: 4 };
  const next = applyPlan(cur, {
    routines: [{ id: 'new' }], workouts: [], theme: 'light',
    customEx: [{ id: 'c1', name: 'Hijacked' }, { id: 'c2', name: 'Trainer move' }]
  });
  assert.deepEqual(next.routines, [{ id: 'new' }]);
  assert.deepEqual(next.rotation, { id: 'rot' }, 'a key left out stays');
  assert.deepEqual(next.workouts, [{ id: 'w' }], 'history untouched');
  assert.ok(!('theme' in next));
  assert.deepEqual(next.customEx, [{ id: 'c1', name: 'Mine' }, { id: 'c2', name: 'Trainer move' }]);
  assert.deepEqual(cur.routines, [{ id: 'old' }], 'stored doc not mutated');
});

test('plan stamps are recognised', () => {
  for (const k of ['week.mon', 'dayPlan.2026-10-13', 'queue', 'rotation', 'scheduleMode', 'routineOrder']) assert.ok(isPlanStamp(k), k);
  for (const k of ['unit', 'weekStart', 'restSec', 'exNotes.0001']) assert.ok(!isPlanStamp(k), k);
  assert.ok(PLAN_KEYS.includes('routines'));
});

// The contract of the lock (Wellber implements enforcePlanLock in trainer/core.js).
test('a locked student push keeps the stored plan and their own history', () => {
  const cur = {
    routines: [{ id: 'r1', name: 'Trainer A', _ts: 100 }], week: { mon: 'r1' }, rotation: null,
    edited: { 'week.mon': 100 }, deleted: { routines: { gone: 50 } }, workouts: [], _rev: 7
  };
  const incoming = {
    routines: [{ id: 'r1', name: 'Student renamed', _ts: 200 }, { id: 'r9', name: 'Student new', _ts: 200 }],
    week: { mon: 'r9', tue: 'r1' }, rotation: { id: 'x' },
    edited: { 'week.mon': 200, 'week.tue': 200, restSec: 200 },
    deleted: { routines: { gone: 50, r1old: 200 }, workouts: { w0: 200 } },
    workouts: [{ id: 'w1', d: '2026-10-13' }], restSec: 120, _rev: 7,
    queue: { items: ['r1'], pos: 1 }, dayPlan: { '2026-10-14': ['r1'] }
  };
  const out = enforcePlanLock(cur, incoming);
  assert.deepEqual(out.routines, cur.routines, 'routines restored');
  assert.deepEqual(out.week, cur.week, 'week restored');
  assert.equal(out.rotation, null, 'rotation restored');
  assert.deepEqual(out.workouts, [{ id: 'w1', d: '2026-10-13' }], 'their workout stays');
  assert.equal(out.restSec, 120, 'their setting stays');
  assert.deepEqual(out.queue, { items: ['r1'], pos: 1 }, 'a rotation pass still advances');
  assert.deepEqual(out.dayPlan, { '2026-10-14': ['r1'] }, 'moving a session stays theirs');
  assert.equal(out.edited['week.mon'], 100, 'plan stamp is the stored one');
  assert.ok(!('week.tue' in out.edited), 'no new plan stamp');
  assert.equal(out.edited.restSec, 200, 'setting stamp stays');
  assert.deepEqual(out.deleted.routines, { gone: 50 }, 'no new routine removals');
  assert.deepEqual(out.deleted.workouts, { w0: 200 }, 'workout removals stay');
});
