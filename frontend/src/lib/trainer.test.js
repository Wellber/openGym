import { describe, it, expect } from 'vitest'
import { EXIDX } from './exercises.js'
import { sendRoutines, routineBundle, removeRoutine, toggleDay, planPayload, keepLockedPlan } from './trainer.js'

const EX = Object.keys(EXIDX)[0]

const trainer = {
  unit: 'kg',
  routines: [
    { id: 'tA', name: 'Treino A', ex: [{ id: EX, sets: 3, reps: 10, weight: 40 }] },
    { id: 'tB', name: 'Treino B', ex: [{ id: 'c1', sets: 4, reps: 8 }] },
  ],
  customEx: [{ id: 'c1', n: 'Remada no cabo baixo', bp: 'back', custom: true }],
  week: { 1: ['tA'] },
}
const student = {
  unit: 'kg',
  routines: [{ id: 's1', name: 'Antigo', ex: [{ id: EX, sets: 2, reps: 12 }] }, { id: 's2', name: 'Outro', ex: [] }],
  customEx: [],
  week: { 1: ['s1'], 3: ['s1', 's2'] },
  dayPlan: { '2026-10-14': ['s1'] },
  workouts: [{ id: 'w1' }],
}

describe('sendRoutines', () => {
  it('adds the chosen routines with fresh ids and their custom exercises, without the trainer week', () => {
    const { doc, added } = sendRoutines(student, trainer, ['tB'])
    expect(added).toHaveLength(1)
    const r = doc.routines.find(x => x.id === added[0])
    expect(r.name).toBe('Treino B')
    expect(r.id).not.toBe('tB')
    expect(doc.customEx).toHaveLength(1)
    expect(r.ex[0].id).toBe(doc.customEx[0].id)
    expect(doc.week).toEqual(student.week)
    expect(student.routines).toHaveLength(2) // input untouched
  })

  it('replaces a routine in place, taking over its days', () => {
    const { doc, added } = sendRoutines(student, trainer, ['tA'], { replaceId: 's1' })
    const nid = added[0]
    expect(doc.routines.map(r => r.id)).toEqual([nid, 's2'])
    expect(doc.routines[0].ex[0].weight).toBe(40)
    expect(doc.week).toEqual({ 1: [nid], 3: [nid, 's2'] })
    expect(doc.dayPlan).toEqual({ '2026-10-14': [nid] })
  })

  it('converts the numbers to the student unit', () => {
    const { doc, added } = sendRoutines({ ...student, unit: 'lb' }, trainer, ['tA'])
    expect(doc.routines.find(r => r.id === added[0]).ex[0].weight).toBeGreaterThan(80)
  })
})

describe('plan edits', () => {
  it('removeRoutine drops it from the week and day plan, empty days included', () => {
    const doc = removeRoutine(student, 's1')
    expect(doc.routines.map(r => r.id)).toEqual(['s2'])
    expect(doc.week).toEqual({ 3: ['s2'] })
    expect(doc.dayPlan).toEqual({})
  })

  it('toggleDay adds and removes', () => {
    expect(toggleDay(student, 5, 's2').week[5]).toEqual(['s2'])
    expect(toggleDay(student, 1, 's1').week[1]).toBeUndefined()
  })

  it('routineBundle carries one routine for the trainer library', () => {
    const b = routineBundle(student, 's1', 'kg')
    expect(b.routines.map(r => r.name)).toEqual(['Antigo'])
  })

  it('planPayload sends the plan and custom exercises, never history', () => {
    const p = planPayload(student)
    expect(Object.keys(p).sort()).toEqual(['customEx', 'dayPlan', 'routines', 'week'])
  })
})

describe('keepLockedPlan', () => {
  it('undoes changes to locked keys and keeps everything else', () => {
    const prev = { routines: [{ id: 'a' }], week: { 1: ['a'] }, queue: { pos: 0 }, restSec: 90 }
    const next = { routines: [{ id: 'a' }, { id: 'b' }], week: { 1: ['b'] }, queue: { pos: 1 }, restSec: 120, scheduleMode: 'rotation' }
    expect(keepLockedPlan(prev, next)).toBe(true)
    expect(next).toEqual({ routines: [{ id: 'a' }], week: { 1: ['a'] }, queue: { pos: 1 }, restSec: 120 })
  })

  it('reports nothing when the plan did not change', () => {
    const prev = { routines: [], week: {} }
    expect(keepLockedPlan(prev, { routines: [], week: {}, restSec: 1 })).toBe(false)
  })
})
