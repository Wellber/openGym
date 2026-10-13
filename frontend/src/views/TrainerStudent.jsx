import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtDur, fmtNum } from '../lib/format.js'
import { setsDone } from '../lib/history.js'
import { mergePlan } from '../lib/plan-share.js'
import { sendRoutines, routineBundle, removeRoutine, toggleDay, planPayload } from '../lib/trainer.js'
import { tr } from '../lib/trainer-i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row, Segmented, Switch, Check } from '../components/ui.jsx'

// One student, seen by their trainer (fork, docs/dev/PERSONAL_TRAINER.md). The student's plan is
// held here as plain data, never put into the store: the store is the trainer's own profile.
// Every change is saved at once, conditional on the revision read (409 → reload).

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const daysOf = (doc, id) => DAY_ORDER.filter(d => [].concat(doc.week?.[d] ?? []).includes(id))

/** Pick routines of the trainer's own plan. `single` for a replacement. */
function LibraryPicker({ title, single, onPick, close }) {
  const mine = useStore(s => s.S.routines) || []
  const [sel, setSel] = useState([])
  if (!mine.length) return <><h3>{title}</h3><div className="muted small">{tr('Your library is empty. Build routines in your own Plan tab first.')}</div></>
  const toggle = id => setSel(single ? [id] : sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  return <>
    <h3>{title}</h3>
    <div className="muted small" style={{ marginBottom: 8 }}>{tr('Pick routines from your own plan. They are copied to the student; yours stay as they are.')}</div>
    <div className="sect-b">
      {mine.map(r => <Row key={r.id} title={`${r.emoji || ''} ${r.name}`.trim()} subtitle={tr('{0} exercises', (r.ex || []).length)} onClick={() => toggle(r.id)}>
        <Check checked={sel.includes(r.id)} onChange={() => toggle(r.id)} />
      </Row>)}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!sel.length} onClick={() => { onPick(sel); close() }}>{tr('Send')}</Button>
  </>
}

function RoutineSheet({ doc, routine, studentName, save, close }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const update = useStore(s => s.update)
  const trainerS = useStore(s => s.S)
  const days = daysOf(doc, routine.id)
  const copyName = `${routine.name} — ${studentName}`
  const pull = () => {
    update(s => { const b = routineBundle(doc, routine.id, s.unit); b.routines.forEach(r => { r.name = copyName }); mergePlan(s, b) })
    toast(tr('A copy goes to your Plan as “{0}”. Edit it there with the full editor, then come back and use “Replace with…” on this routine.', copyName))
    close()
  }
  const replace = () => openSheet(c => <LibraryPicker single title={tr('Replace with…')} close={c}
    onPick={ids => save(sendRoutines(doc, trainerS, ids, { replaceId: routine.id }).doc)} />)
  return <>
    <h3>{`${routine.emoji || ''} ${routine.name}`.trim()}</h3>
    <div className="muted small" style={{ marginBottom: 8 }}>{tr('{0} exercises', (routine.ex || []).length)}</div>
    <h2 className="sect-t">{tr('Week')}</h2>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {DAY_ORDER.map(d => <button key={d} className={'chip' + (days.includes(d) ? ' on' : '')}
        onClick={() => { save(toggleDay(doc, d, routine.id)); close() }}>{tr(DAY_NAMES[d])}</button>)}
    </div>
    <div className="sect-b">
      <Row icon="repeat" iconTint="var(--blue)" title={tr('Replace with…')} accessory="chevron" onClick={() => { close(); replace() }} />
      <Row icon="dumbbell" iconTint="var(--acc)" title={tr('Edit in my library')} accessory="chevron" onClick={pull} />
      <Row icon="trash" iconTint="var(--red)" danger title={tr('Remove from plan')} onClick={() => { close(); confirmSheet({
        title: tr('Remove “{0}” from {1}’s plan?', routine.name, studentName), message: tr('Their workout history keeps every session done with it.'),
        confirmText: tr('Remove'), danger: true, onConfirm: () => save(removeRoutine(doc, routine.id)) }) }} />
    </div>
  </>
}

export default function TrainerStudent() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const trainerS = useStore(s => s.S)
  const [d, setD] = useState(null)        // { student, state, rev, wid }
  const [tab, setTab] = useState('plan')
  const load = () => api('/api/trainer/student?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="narrow"><div className="muted small" style={{ padding: 20 }}>{tr('Loading…')}</div></div>

  const doc = d.state || {}
  const name = d.student.name
  const save = next => api('/api/trainer/student?id=' + encodeURIComponent(id), {
    method: 'PUT', body: JSON.stringify({ state: planPayload(next), baseRev: d.rev, ...(d.wid ? { baseWid: d.wid } : {}) })
  }).then(r => { setD({ ...d, state: { ...doc, ...planPayload(next) }, rev: r.rev, wid: r.wid }); toast(tr('Saved')) })
    .catch(e => { if (e.status === 409) { toast(tr('The plan changed on their side since you opened it. Reloaded — please redo the last change.')); load() } else toast(e.message) })
  const setLock = locked => api('/api/trainer/student/lock', { method: 'POST', body: JSON.stringify({ id, locked }) })
    .then(r => setD({ ...d, student: { ...d.student, planLocked: r.planLocked } })).catch(e => toast(e.message))
  const unlink = () => api('/api/trainer/student/unlink', { method: 'POST', body: JSON.stringify({ id }) })
    .then(() => nav('/trainer', { replace: true })).catch(e => toast(e.message))

  const routines = doc.routines || []
  const workouts = (doc.workouts || []).filter(w => w && Array.isArray(w.entries)).slice().reverse()
  const weights = (doc.bodyweight || []).filter(b => b && b.d).slice().reverse()
  const unit = doc.unit || 'kg'

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/trainer')} aria-label="back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10 }}><h1 className="capitalize">{name}</h1>
        <div className="sub">{d.student.planLocked ? tr('Plan locked') : tr('Personal trainer')}</div></div>
    </div>
    <Segmented value={tab} onChange={setTab} options={[{ value: 'plan', label: tr('Plan') }, { value: 'history', label: tr('History') }, { value: 'body', label: tr('Body') }]} />

    {tab === 'plan' && <>
      <Section title={tr('Routines')}>
        {!routines.length && <Row title={tr('No routines yet.')} />}
        {routines.map(r => {
          const days = daysOf(doc, r.id).map(x => tr(DAY_NAMES[x]))
          return <Row key={r.id} icon="dumbbell" iconTint="var(--acc)" accessory="chevron"
            title={`${r.emoji || ''} ${r.name}`.trim()}
            subtitle={[tr('{0} exercises', (r.ex || []).length), days.join(' · ')].filter(Boolean).join(' — ')}
            onClick={() => openSheet(close => <RoutineSheet doc={doc} routine={r} studentName={name} save={save} close={close} />)} />
        })}
        <Row icon="plusCircle" iconTint="var(--acc)" title={tr('Send from my library')} accessory="chevron"
          onClick={() => openSheet(close => <LibraryPicker title={tr('Send from my library')} close={close}
            onPick={ids => save(sendRoutines(doc, trainerS, ids).doc)} />)} />
      </Section>
      <Section title={tr('Week')}>
        {DAY_ORDER.map(dd => {
          const list = [].concat(doc.week?.[dd] ?? []).map(x => routines.find(r => r.id === x)?.name).filter(Boolean)
          return <Row key={dd} title={tr(DAY_NAMES[dd])} value={list.length ? list.join(', ') : tr('Rest')} />
        })}
      </Section>
      <Section footer={tr('The student can train and log, but not change routines or the week.')}>
        <Row icon="lock" iconTint="var(--indigo)" title={tr('Lock the plan')}>
          <Switch checked={!!d.student.planLocked} onChange={v => setLock(v)} />
        </Row>
      </Section>
      <Section>
        <Row icon="signOut" iconTint="var(--red)" danger title={tr('Unlink student')} onClick={() => confirmSheet({
          title: tr('Unlink {0}?', name), message: tr('They keep their data and the plan becomes theirs to change.'), confirmText: tr('Unlink'), danger: true, onConfirm: unlink })} />
      </Section>
    </>}

    {tab === 'history' && <Section title={tr('History')}>
      {!workouts.length && <Row title={tr('No workouts yet')} />}
      {workouts.slice(0, 100).map(w => <Row key={w.id || w.d + w.start} icon="history" iconTint="var(--blue)"
        title={w.name || fmtDate(w.d)} subtitle={[fmtDate(w.d), tr('{0} sets', setsDone(w)), w.end && w.start ? fmtDur(w.end - w.start) : ''].filter(Boolean).join(' · ')} />)}
    </Section>}

    {tab === 'body' && <>
      <Section title={tr('Weigh-ins')}>
        {!weights.length && <Row title={tr('No weigh-ins yet.')} />}
        {weights.slice(0, 60).map(b => <Row key={b.d} title={fmtDate(b.d)} value={`${fmtNum(b.w)} ${unit}`} />)}
      </Section>
      {(doc.measurements || []).length > 0 && <Section title={tr('Measurements')}>
        {(doc.measurements || []).slice().reverse().slice(0, 30).map(m => <Row key={m.d} title={fmtDate(m.d)}
          subtitle={Object.entries(m).filter(([k, v]) => !['d', 't', '_ts', '_f'].includes(k) && typeof v === 'number').map(([k, v]) => `${k} ${fmtNum(v)}`).join(' · ')} />)}
      </Section>}
    </>}
  </div>
}
