// Personal trainer mode, the client half (docs/dev/PERSONAL_TRAINER.md).
//
// A trainer never edits a student's document through the store: the store is the signed-in
// account's own copy, persisted and pushed to that account, and a student's routines in it would
// end up in the trainer's profile. Instead the trainer's screens hold the student's plan as plain
// data, change it with the helpers below and save it with PUT /api/trainer/student.
//
// Routines travel both ways as plan bundles (lib/plan-share.js), the same format a shared plan
// file uses: built with fresh ids, custom exercises carried along, units converted. So the full
// routine editor of the trainer's own library is the editor for students too — pull a routine of
// theirs into it, edit, send it back in place.

import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'

const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

// Must match api/trainer/core.js: what the server takes from a trainer's save, and what a lock
// freezes on a student's device.
export const PLAN_KEYS = ['routines', 'week', 'dayPlan', 'queue', 'rotation', 'scheduleMode']
export const LOCK_KEYS = ['routines', 'week', 'rotation', 'scheduleMode']

const ids = v => [].concat(v ?? [])

/** A state-like object holding only the given routines of `S`, for buildPlanBundle. */
function only(S, routineIds) {
  const want = new Set(routineIds)
  return { unit: S.unit, customEx: S.customEx || [], week: {}, routines: (S.routines || []).filter(r => want.has(r.id)) }
}

/** Every reference to routine `from` in the week and the day plan points at `to` instead (or is
 *  dropped when `to` is null). Mutates `doc`. */
function repoint(doc, from, to) {
  for (const key of ['week', 'dayPlan']) {
    const m = doc[key]
    if (!m || typeof m !== 'object') continue
    for (const d of Object.keys(m)) {
      const list = ids(m[d]).map(x => (x === from ? to : x)).filter(Boolean)
      if (list.length) m[d] = [...new Set(list)]; else delete m[d]
    }
  }
}

/**
 * The student's plan with routines `routineIds` of the trainer's own state `trainerS` added.
 * `replaceId`: one routine sent replaces that routine of the student's, taking its place in the
 * week and the day plan. Returns `{ doc, added }`, `doc` a new object; `student` is not touched.
 */
export function sendRoutines(student, trainerS, routineIds, { replaceId = null } = {}) {
  const doc = clone(student) || {}
  doc.routines = doc.routines || []
  doc.customEx = doc.customEx || []
  doc.week = doc.week || {}
  const parsed = parsePlan(buildPlanBundle(only(trainerS, routineIds)), doc.unit || 'kg')
  const before = new Set(doc.routines.map(r => r.id))
  mergePlan(doc, parsed)
  const added = doc.routines.filter(r => !before.has(r.id)).map(r => r.id)
  if (replaceId && added.length === 1 && before.has(replaceId)) {
    const at = doc.routines.findIndex(r => r.id === replaceId)
    const [fresh] = doc.routines.splice(doc.routines.length - 1, 1)
    doc.routines.splice(at, 1, fresh)
    repoint(doc, replaceId, fresh.id)
  }
  return { doc, added }
}

/** A copy of a student's routine, ready to push into the trainer's own state inside
 *  store.update (mergePlan there gives it a fresh id). Returns the parsed bundle. */
export function routineBundle(student, routineId, unit) {
  return parsePlan(buildPlanBundle(only(student, [routineId])), unit || 'kg')
}

/** The student's plan without routine `id`, and without it in the week and day plan. */
export function removeRoutine(student, id) {
  const doc = clone(student) || {}
  doc.routines = (doc.routines || []).filter(r => r.id !== id)
  repoint(doc, id, null)
  return doc
}

/** Toggles routine `id` on weekday `day` (getDay index, 0 = Sunday). */
export function toggleDay(student, day, id) {
  const doc = clone(student) || {}
  doc.week = doc.week || {}
  const cur = ids(doc.week[day])
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
  if (next.length) doc.week[day] = next; else delete doc.week[day]
  return doc
}

/** What a save sends: the plan keys and the custom exercises its routines use. */
export function planPayload(doc) {
  const out = {}
  for (const k of PLAN_KEYS) if (doc?.[k] !== undefined) out[k] = clone(doc[k])
  if (Array.isArray(doc?.customEx)) out.customEx = clone(doc.customEx)
  return out
}

/**
 * The store's guard for a locked student (store/useStore.js update): whatever a change did to the
 * locked keys is undone, before the change is stamped, so nothing of it is recorded or pushed.
 * Mutates `next`; returns whether anything was undone, for the store to say so.
 */
export function keepLockedPlan(prev, next) {
  let undone = false
  for (const k of LOCK_KEYS) {
    if (JSON.stringify(prev?.[k]) === JSON.stringify(next?.[k])) continue
    undone = true
    if (prev && k in prev) next[k] = clone(prev[k]); else delete next[k]
  }
  return undone
}
