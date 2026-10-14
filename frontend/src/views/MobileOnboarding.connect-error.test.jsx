// @vitest-environment happy-dom
// #329: why pairing failed used to be a two-second toast — too short for "the server was reached
// but refused the app's request (CORS)…" to be read, let alone acted on. It stays under the fields.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'
import { ConnectSheet, SignupSheet, LoginSheet } from './MobileOnboarding.jsx'

let root, host
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const connectButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect')

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('ConnectSheet', () => {
  it('shows why connecting failed under the fields, and clears it on the next try', async () => {
    const long = 'Your server was reached, but it refused the app’s request (CORS).'
    const connectToServer = vi.fn().mockRejectedValueOnce(Object.assign(new Error(long), { code: 'cors' })).mockResolvedValueOnce(undefined)
    useStore.setState({ connectToServer })
    const close = vi.fn()
    act(() => root.render(<ConnectSheet close={close} />))
    // Fork (lib/fork-config.js FIXED_SERVER): the address is fixed, the code is the only field.
    const inputs = host.querySelectorAll('input')
    expect(inputs).toHaveLength(1)
    type(inputs[0], 'abcd2345')
    await act(async () => { connectButton().click() })
    expect(connectToServer.mock.calls[0].slice(0, 2)).toEqual(['https://personal.netpoint.cloud', 'ABCD2345'])
    const alert = host.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(long)
    expect(close).not.toHaveBeenCalled()

    await act(async () => { connectButton().click() })
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(close).toHaveBeenCalled()
    expect(connectToServer).toHaveBeenLastCalledWith('https://personal.netpoint.cloud', 'ABCD2345', expect.any(Function))
  })

  it('a 16-character invite code is explained instead of cut to 8, and never sent as a pairing code', async () => {
    const connectToServer = vi.fn()
    useStore.setState({ connectToServer })
    act(() => root.render(<ConnectSheet close={vi.fn()} />))
    const [code] = host.querySelectorAll('input')
    type(code, 'fa6c3168f40912d9')
    expect(code.value).toBe('FA6C3168F40912D9')
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/invite code/)
    expect(connectButton().disabled).toBe(true)
    await act(async () => { connectButton().click() })
    expect(connectToServer).not.toHaveBeenCalled()
  })

  it('signs up from the phone with a name and the invite alone, on the fixed server', async () => {
    const connectToServer = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ connectToServer })
    act(() => root.render(<SignupSheet onPair={vi.fn()} />))
    const btn = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create account')
    const [name, code] = host.querySelectorAll('input')
    expect(btn().disabled).toBe(true)
    type(name, 'Dani')
    type(code, 'fa6c 3168 f409 12d9')
    expect(code.value).toBe('FA6C3168F40912D9')
    await act(async () => { btn().click() })
    expect(connectToServer).toHaveBeenCalledWith('https://personal.netpoint.cloud', 'FA6C3168F40912D9', expect.any(Function), { name: 'Dani' })
  })

  it('an invite pasted where the pairing code goes leads to the sign-up with it', async () => {
    const onInvite = vi.fn()
    act(() => root.render(<ConnectSheet close={vi.fn()} onInvite={onInvite} />))
    type(host.querySelector('input'), 'FA6C3168F40912D9')
    const go = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Create account with this invite')
    act(() => go.click())
    expect(onInvite).toHaveBeenCalledWith('FA6C3168F40912D9')
  })

  it('an existing profile signs this phone in with its name and password', async () => {
    const connectToServer = vi.fn().mockResolvedValue(undefined)
    useStore.setState({ connectToServer })
    act(() => root.render(<LoginSheet onPair={vi.fn()} onSignup={vi.fn()} />))
    const [name, pw] = host.querySelectorAll('input')
    type(name, 'Fabi')
    type(pw, 'correct horse battery staple 42')
    const btn = [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign in')
    await act(async () => { btn.click() })
    expect(connectToServer).toHaveBeenCalledWith('https://personal.netpoint.cloud', null, expect.any(Function), { name: 'Fabi', password: 'correct horse battery staple 42' })
  })
})
