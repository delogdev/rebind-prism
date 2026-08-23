/**
 * OAuth 2, as an actual grant rather than a place to paste a token.
 *
 * The old `oauth2` auth kind meant "put this string in an Authorization
 * header", which works for exactly as long as the token does — about an hour,
 * usually — and then produces a 401 that looks like a broken test. Fetching
 * the token is the difference between a suite that runs tomorrow morning and
 * one somebody has to nurse.
 *
 * Only the pure parts live here: what to send, how to read the answer, and
 * when the thing is stale. The sending itself belongs to the main process,
 * which is the only place allowed to touch the network.
 */

export const GRANTS = [
  {
    id: 'client_credentials',
    label: 'Client credentials',
    help: 'A machine identity. The usual choice for a test suite, because no human has to be present.',
    fields: ['tokenUrl', 'clientId', 'clientSecret', 'scope', 'audience']
  },
  {
    id: 'password',
    label: 'Password',
    help: 'A real account, exchanged for a token. Older APIs, and staging environments with a seeded user.',
    fields: ['tokenUrl', 'clientId', 'clientSecret', 'username', 'password', 'scope']
  },
  {
    id: 'refresh_token',
    label: 'Refresh token',
    help: 'A long-lived token you already hold, traded for a short-lived one whenever it runs out.',
    fields: ['tokenUrl', 'clientId', 'clientSecret', 'refreshToken', 'scope']
  }
]

/** Which fields hold a credential, so the UI can mark them and the disk can skip them. */
export const SECRET_FIELDS = ['clientSecret', 'password', 'refreshToken']

export function emptyOauth(over = {}) {
  return {
    grant: 'client_credentials',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    username: '',
    password: '',
    refreshToken: '',
    scope: '',
    audience: '',
    /** Some servers want the client in a Basic header, others in the body. */
    clientAuth: 'body',
    ...over
  }
}

/**
 * What is missing before this can even be attempted.
 *
 * Said before the request rather than after a 400 from a server whose error
 * body is, more often than not, an HTML page.
 */
export function missingFields(cfg) {
  const grant = GRANTS.find((g) => g.id === cfg?.grant) ?? GRANTS[0]
  const needed = {
    tokenUrl: 'a token URL',
    clientId: 'a client id',
    username: 'a username',
    password: 'a password',
    refreshToken: 'a refresh token'
  }
  return grant.fields.filter((f) => needed[f] && !String(cfg?.[f] ?? '').trim()).map((f) => needed[f])
}

/**
 * The token request, as a plain description the sender can carry out.
 *
 * `interpolate` is passed in rather than imported so this stays independent of
 * how variables happen to be resolved — the CLI and the app both have their
 * own idea of the current scope.
 */
export function tokenRequest(cfg, resolve = (s) => s) {
  const v = (name) => String(resolve(cfg?.[name] ?? '') ?? '').trim()
  const grant = cfg?.grant ?? 'client_credentials'

  const form = new URLSearchParams()
  form.set('grant_type', grant)
  if (grant === 'password') {
    form.set('username', v('username'))
    form.set('password', v('password'))
  }
  if (grant === 'refresh_token') form.set('refresh_token', v('refreshToken'))
  if (v('scope')) form.set('scope', v('scope'))
  if (v('audience')) form.set('audience', v('audience'))

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }

  // Two ways to present the client, and servers disagree about which they
  // accept — hence the setting rather than a guess.
  if (cfg?.clientAuth === 'header') {
    headers.Authorization = `Basic ${base64(`${v('clientId')}:${v('clientSecret')}`)}`
  } else {
    if (v('clientId')) form.set('client_id', v('clientId'))
    if (v('clientSecret')) form.set('client_secret', v('clientSecret'))
  }

  return { method: 'POST', url: v('tokenUrl'), headers, body: form.toString() }
}

/**
 * What came back.
 *
 * `expires_in` is seconds from now, and a server that omits it is saying "I am
 * not telling you" rather than "never" — so the token is treated as good for
 * the session but never assumed fresh after a restart.
 */
export function readToken(json, now = Date.now()) {
  if (!json || typeof json !== 'object') return { ok: false, error: 'The token endpoint did not return JSON.' }
  if (json.error) {
    const detail = json.error_description || json.error
    return { ok: false, error: `The token endpoint refused: ${detail}` }
  }

  const token = json.access_token ?? json.accessToken ?? json.token ?? json.id_token
  if (!token) return { ok: false, error: 'That response has no access_token in it.' }

  const seconds = Number(json.expires_in ?? json.expiresIn)
  return {
    ok: true,
    token: String(token),
    type: String(json.token_type ?? json.tokenType ?? 'Bearer'),
    // 0 means unknown, not "already expired".
    expiresAt: Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : 0,
    refreshToken: json.refresh_token ?? json.refreshToken ?? '',
    scope: json.scope ?? ''
  }
}

/**
 * Whether the held token is still worth using.
 *
 * The skew matters: a token with four seconds left passes a naive check and
 * then expires in flight, producing a 401 on a request that did nothing wrong.
 */
export function stale(state, now = Date.now(), skewMs = 30_000) {
  if (!state?.token) return true
  if (!state.expiresAt) return false
  return state.expiresAt - skewMs <= now
}

/** What to do next, given what is configured and what is held. */
export function nextStep(cfg, state, now = Date.now()) {
  if (!cfg?.tokenUrl) return 'unconfigured'
  if (!stale(state, now)) return 'hold'
  if (state?.refreshToken && cfg.grant !== 'refresh_token') return 'refresh'
  return 'fetch'
}

/**
 * The config for a refresh, built from the grant that produced the token.
 *
 * A refresh is the same endpoint with a different grant type, so the client
 * details carry over and only the grant and the token change.
 */
export function refreshWith(cfg, state) {
  return emptyOauth({ ...cfg, grant: 'refresh_token', refreshToken: state?.refreshToken ?? '' })
}

/** How long is left, in words, for a panel that has to show something. */
export function remaining(state, now = Date.now()) {
  if (!state?.token) return 'no token yet'
  if (!state.expiresAt) return 'no expiry given'
  const left = state.expiresAt - now
  if (left <= 0) return 'expired'
  const mins = Math.floor(left / 60000)
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m left`
  if (mins >= 1) return `${mins}m left`
  return `${Math.max(1, Math.round(left / 1000))}s left`
}

function base64(text) {
  if (typeof btoa === 'function') return btoa(text)
  return Buffer.from(text, 'utf8').toString('base64')
}
