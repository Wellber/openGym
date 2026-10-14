/* Personal trainer mode — the pure half (docs/dev/PERSONAL_TRAINER.md).
 *
 * Who manages whom, which part of a student's document is "the plan", and what a trainer gets to
 * read. No I/O here: routes.js does the db.json and state-file work and calls into this, so every
 * rule below is unit-tested without booting the server (test/trainer-core.test.js).
 */

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// The keys of a state document that make up the training plan: what a trainer writes, and what a
// locked student cannot change. Everything else (workouts, weigh-ins, settings, exWeights, which
// the student's own finished sessions advance) stays the student's.
export const PLAN_KEYS = ['routines', 'week', 'dayPlan', 'queue', 'rotation', 'scheduleMode'];
// The `edited` stamps that belong to those keys: whole-key stamps, per-day stamps (`week.mon`,
// `dayPlan.2026-10-13`) and the routine order (sync-stamps.js ORDER_KEY).
export const isPlanStamp = k => k === 'routineOrder' || PLAN_KEYS.some(p => k === p || k.startsWith(p + '.'));
// What a lock freezes: the plan minus `queue` (a rotation pass advances as the student trains) and
// `dayPlan` (moving one session to another day is the student's call). The trainer still writes both.
export const LOCK_KEYS = ['routines', 'week', 'rotation', 'scheduleMode'];
const isLockStamp = k => k === 'routineOrder' || LOCK_KEYS.some(p => k === p || k.startsWith(p + '.'));

// What a trainer reads of a student: the plan plus the history the fork's spec lists. Never media
// refs, the Coach, reminders, push or app preferences.
const VIEW_KEYS = [...PLAN_KEYS, 'unit', 'customEx', 'exWeights', 'workouts', 'bodyweight', 'measurements', 'customMeasurements', 'targetW', 'effort'];

export const isTrainer = u => !!u && u.trainer === true && !u.disabled;

/** Whether `trainer` may read and write the plan of the profile with id `studentId`. */
export function manages(db, trainer, studentId) {
  if (!isTrainer(trainer) || !studentId || studentId === trainer.id) return false;
  const s = (db.users || []).find(u => u.id === studentId);
  return !!s && !s.disabled && s.trainerId === trainer.id;
}

export const studentsOf = (db, trainer) =>
  (db.users || []).filter(u => u.trainerId === trainer.id && u.id !== trainer.id);

/** A student's document as their trainer sees it. */
export function studentView(S) {
  const src = isMap(S) ? S : {};
  const out = {};
  for (const k of VIEW_KEYS) if (src[k] !== undefined) out[k] = clone(src[k]);
  // A workout's photos and videos are the student's own, as in the admin drill-down.
  if (Array.isArray(out.workouts)) out.workouts = out.workouts.map(w => (isMap(w) ? (({ media, ...rest }) => rest)(w) : w));
  if (Array.isArray(out.customEx)) out.customEx = out.customEx.map(x => (isMap(x) ? (({ media, img, ...rest }) => rest)(x) : x));
  return out;
}

/**
 * The document a trainer's save produces: the student's current one with the plan keys taken
 * from what the trainer sent. A key the trainer left out stays as stored (not deleted), so a
 * trainer client that only knows routines cannot wipe a rotation by accident. The result goes on
 * through stampPut as a writer that does not stamp, which stamps what changed at server time.
 * The `edited`/`deleted` records stay the stored ones: the trainer client sends none of its own.
 */
export function applyPlan(cur, incoming) {
  const next = clone(isMap(cur) ? cur : {});
  const src = isMap(incoming) ? incoming : {};
  for (const k of PLAN_KEYS) if (k in src) next[k] = clone(src[k]);
  // Custom exercises a routine of the trainer's uses: added, never removed or edited, since the
  // student's own library is theirs.
  if (Array.isArray(src.customEx)) {
    const have = new Set((Array.isArray(next.customEx) ? next.customEx : []).map(x => x?.id));
    const add = src.customEx.filter(x => isMap(x) && x.id != null && !have.has(x.id));
    if (add.length) next.customEx = [...(Array.isArray(next.customEx) ? next.customEx : []), ...clone(add)];
  }
  return next;
}

/**
 * A locked student's own push (PUT /api/data): whatever it says about the plan, the stored plan
 * stays. Mutates and returns `incoming`, before it reaches stampPut.
 *
 * `cur` is the stored document, `incoming` the student's. Both may be null/partial.
 */
export function enforcePlanLock(cur, incoming) {
  if (!isMap(incoming)) return incoming;
  const stored = isMap(cur) ? cur : {};
  for (const k of LOCK_KEYS) {
    if (k in stored) incoming[k] = clone(stored[k]); else delete incoming[k];
  }
  // Plan stamps go back to the stored ones, so the student's device cannot win a later merge
  // with an edit the server refused. Their own settings' stamps stay.
  if (isMap(incoming.edited)) {
    const was = isMap(stored.edited) ? stored.edited : {};
    for (const k of Object.keys(incoming.edited)) {
      if (!isLockStamp(k)) continue;
      if (k in was) incoming.edited[k] = was[k]; else delete incoming.edited[k];
    }
  }
  // A routine removal of theirs would mark the restored routine as added back (sync-stamps.js
  // step 3) and delete it again on the next merge: only removals already on record stay.
  if (isMap(incoming.deleted) && isMap(incoming.deleted.routines)) {
    const was = isMap(stored.deleted?.routines) ? stored.deleted.routines : {};
    incoming.deleted.routines = Object.fromEntries(Object.entries(incoming.deleted.routines).filter(([id]) => id in was));
  }
  return incoming;
}

/**
 * A trainer's link code that is also good as a signup invite on an invite-only instance: unused,
 * and its trainer still a trainer. Burned like an invite (`usedBy`/`usedAt`), and the account it
 * creates starts out linked to that trainer.
 */
export function signupTrainerCode(db, code) {
  if (!code) return null;
  const c = (db.trainerCodes || []).find(x => x.code === code && !x.usedBy);
  if (!c) return null;
  return isTrainer((db.users || []).find(u => u.id === c.trainerId)) ? c : null;
}

/** A link code: 64 random bits, upper-case hex, like the signup invites. */
export const newCode = (randomHex, taken) => {
  let code;
  do { code = randomHex(8).toUpperCase(); } while (taken(code));
  return code;
};
