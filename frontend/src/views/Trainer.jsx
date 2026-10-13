import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { tr } from '../lib/trainer-i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row, TextField } from '../components/ui.jsx'

// Personal trainer home (fork): the trainer's students and the codes that link new ones.
// docs/dev/PERSONAL_TRAINER.md.

function NewCodeSheet({ close, onMade }) {
  const [note, setNote] = useState('')
  const toast = useUI(s => s.toast)
  const make = () => api('/api/trainer/codes/new', { method: 'POST', body: JSON.stringify({ note }) })
    .then(r => { onMade(r.code); close() }).catch(e => toast(e.message))
  return <>
    <h3>{tr('New code')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{tr('Each code links one student, once.')}</div>
    <TextField value={note} onChange={e => setNote(e.target.value)} placeholder={tr('Note (optional)')} maxLength={60} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={make}>{tr('New code')}</Button>
  </>
}

export default function Trainer() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [students, setStudents] = useState(null)
  const [codes, setCodes] = useState([])
  const load = () => {
    api('/api/trainer/students').then(r => setStudents(r.students)).catch(e => toast(e.message))
    api('/api/trainer/codes').then(r => setCodes(r.codes)).catch(() => {})
  }
  useEffect(load, [])
  const copy = code => { navigator.clipboard?.writeText(code).catch(() => {}); toast(tr('Copied')) }
  const revoke = code => api('/api/trainer/codes/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(load).catch(e => toast(e.message))

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10 }}><h1>{tr('My students')}</h1><div className="sub">{tr('Manage the plans of the people you train.')}</div></div>
    </div>

    <Section title={tr('Students')}>
      {students == null ? <Row title={tr('Loading…')} />
        : students.length === 0 ? <Row icon="info" iconTint="var(--acc)" title={tr('No students yet. Generate a code and give it to your student: they enter it in Settings → Personal trainer.')} />
        : students.map(s => <Row key={s.id} icon={s.planLocked ? 'lock' : 'personCircle'} iconTint="var(--indigo)" accessory="chevron"
            title={<span className="capitalize">{s.name}</span>}
            subtitle={[s.lastWorkout ? tr('Last workout {0}', fmtDate(s.lastWorkout)) : tr('No workouts yet'), s.planLocked ? tr('Plan locked') : ''].filter(Boolean).join(' · ')}
            onClick={() => nav('/trainer/s/' + encodeURIComponent(s.id))} />)}
    </Section>

    <Section title={tr('Link codes')} footer={tr('Each code links one student, once.')}>
      {codes.map(c => <Row key={c.code} icon="key" iconTint={c.usedBy ? 'var(--label-3)' : 'var(--acc)'}
        title={<button className="adm-code" onClick={() => copy(c.code)} aria-label="copy code">{c.code}</button>}
        subtitle={[c.note, c.usedBy ? tr('used by {0}', c.usedByName || '?') : tr('unused')].filter(Boolean).join(' · ')}>
        {!c.usedBy && <Button size="sm" onClick={() => confirmSheet({ title: tr('Revoke') + ' ' + c.code + '?', confirmText: tr('Revoke'), danger: true, onConfirm: () => revoke(c.code) })}>{tr('Revoke')}</Button>}
      </Row>)}
      <Row icon="plusCircle" iconTint="var(--acc)" title={tr('New code')} accessory="chevron"
        onClick={() => openSheet(close => <NewCodeSheet close={close} onMade={c => { load(); copy(c.code) }} />)} />
    </Section>
  </div>
}
