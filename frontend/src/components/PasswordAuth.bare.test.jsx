// @vitest-environment happy-dom
// Fork (WS-GYM): a profile made in the phone app has no password and no passkey. Setting its
// first password sends no proof (its session is the proof, api/server.js proveOwner) and keeps
// the token the save renews — without it the phone is signed out on its next request.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn() }))
import { api } from '../lib/api.js'
import { useStore } from '../store/useStore.js'
import { PasswordSheet } from './PasswordAuth.jsx'

let host, root
const type = (el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })

describe('PasswordSheet for an account made in the app', () => {
  it('saves the first password without any proof and keeps the renewed token', async () => {
    api.mockResolvedValue({ ok: true, token: 'NEW.TOKEN' })
    const adoptToken = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ adoptToken })
    const close = vi.fn(), done = vi.fn()
    act(() => root.render(<PasswordSheet status={{ set: false, passkeys: 0, name: 'Fabi' }} close={close} done={done} />))
    const [next, again] = [...host.querySelectorAll('input[type="password"]')]
    type(next, 'correct horse battery staple 42')
    type(again, 'correct horse battery staple 42')
    const save = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save')
    expect(save).toBeTruthy()
    await act(async () => { save.click() })
    expect(api).toHaveBeenCalledWith('/api/account/password', { method: 'POST', body: JSON.stringify({ next: 'correct horse battery staple 42' }) })
    expect(adoptToken).toHaveBeenCalledWith('NEW.TOKEN')
    expect(close).toHaveBeenCalled()
  })
})
