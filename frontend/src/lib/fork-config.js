// Settings of the openGym Personal fork that the upstream app leaves open.
//
// FIXED_SERVER: the one server the Android build of this fork talks to. With it set, the phone has
// no local-only mode and no address to type: first launch (and a disconnect) asks for the pairing
// code shown on that site, nothing else. Empty restores upstream's choice screen.
// BRAND: the product name the fork shows (app title, launcher, sign-in).
export const BRAND = 'WS-GYM'
// The fork's own source — AGPL §13: users of a modified network app are offered its source.
export const SOURCE_URL = 'https://github.com/Wellber/openGym'

export const FIXED_SERVER = 'https://personal.netpoint.cloud'
export const FIXED_SERVER_HOST = FIXED_SERVER.replace(/^https?:\/\//, '')
