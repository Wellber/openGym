import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api, appBase } from '../lib/api.js'
import { MOBILE } from '../lib/mobile.js'
import { tr } from '../lib/trainer-i18n.js'
import { confirmSheet } from '../sheets.jsx'
import { Row, Button, TextField } from './ui.jsx'

// Settings rows of personal trainer mode (fork): "My students" for a trainer, the link to a
// trainer for everyone else. Kept in its own file so Settings.jsx only gains one line per spot.

function LinkSheet({ close, onLinked }) {
  const [code, setCode] = useState('')
  const toast = useUI(s => s.toast)
  const link = () => api('/api/student/link', { method: 'POST', body: JSON.stringify({ code }) })
    .then(r => { toast(tr('Linked to {0}', r.trainer.name)); onLinked(); close() })
    .catch(e => toast(e.status === 404 ? tr('That code is not valid.') : e.message))
  return <>
    <h3>{tr('Enter trainer code')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{tr('Your trainer can see your plan, workouts, weigh-ins and measurements, and change your plan.')}</div>
    <TextField value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={tr('Code')} autoCapitalize="characters" autoComplete="off" />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={code.trim().length < 8} onClick={link}>{tr('Link')}</Button>
  </>
}

export default function TrainerSettings() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const [mine, setMine] = useState(undefined)   // { trainer, planLocked } once known
  const refresh = () => {
    // The store's lock guard reads planLocked off the user, set at boot from /api/me: kept current
    // here too, so a lock (or an unlink) shows without a reload.
    api('/api/student/trainer').then(r => {
      setMine(r)
      useStore.setState(st => ({ user: st.user && { ...st.user, trainerId: r.trainer?.id || null, planLocked: !!r.planLocked } }))
    }).catch(() => setMine(null))
  }
  useEffect(() => { if (user && !user.trainer) refresh() }, [user?.id])
  if (!user) return null
  if (user.trainer) return <Row icon="personCircle" iconTint="var(--acc)" title={tr('My students')} subtitle={tr('Manage the plans of the people you train.')} accessory="chevron" onClick={() => nav('/trainer')} />
  if (mine === undefined) return null
  if (!mine?.trainer) return <Row icon="personCircle" iconTint="var(--acc)" title={tr('Personal trainer')} subtitle={tr('Enter trainer code')} accessory="chevron"
    onClick={() => openSheet(close => <LinkSheet close={close} onLinked={refresh} />)} />
  const unlink = () => api('/api/student/unlink', { method: 'POST' }).then(refresh).catch(e => toast(e.message))
  return <Row icon="personCircle" iconTint="var(--acc)" title={tr('Your trainer')}
    subtitle={tr('Linked to {0}.', mine.trainer.name) + ' ' + (mine.planLocked ? tr('Your trainer manages your routines and week. You train and log as usual.') : '')}
    accessory="chevron" onClick={() => confirmSheet({ title: tr('Unlink from {0}?', mine.trainer.name), message: tr('They stop seeing your training and can no longer change your plan.'), confirmText: tr('Unlink'), danger: true, onConfirm: unlink })} />
}

// The fork's own Android build, served by this instance at /wgym.apk (docs/dev/PERSONAL_TRAINER.md).
// Web only: inside the app itself there is nothing to download.
export function ApkDownloadRow() {
  if (MOBILE) return null
  const href = appBase().replace(/\/$/, '') + '/wgym.apk'
  return <Row icon="download" iconTint="var(--green)" title={tr('Android app')} subtitle={tr('Download the openGym Personal app for Android.')} accessory="chevron"
    onClick={() => { const a = document.createElement('a'); a.href = href; a.download = 'wgym.apk'; document.body.appendChild(a); a.click(); a.remove() }} />
}
