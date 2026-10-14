// WS-GYM brand (fork): the mark (public/brand-mark.svg, source in resources/brand/) and the
// wordmark, for the screens that introduce the app — sign-in and the phone's pairing screen.
import { appBase } from '../lib/app-base.js'
import { BRAND } from '../lib/fork-config.js'

export default function Brand({ size = 92 }) {
  const [a, b] = BRAND.split('-')
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <img src={appBase().replace(/\/$/, '') + '/brand-mark.svg'} alt="" width={size} height={Math.round(size * 330 / 368)} style={{ display: 'block' }} />
    <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-.02em', margin: '12px 0 4px' }}>
      {b ? <>{a}<span style={{ opacity: .45 }}>-</span><span style={{ color: 'var(--acc)' }}>{b}</span></> : BRAND}
    </h1>
  </div>
}
