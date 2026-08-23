/**
 * Turning a request as edited into a request as sent.
 *
 * Pure, and separated from the sending itself so the "what will actually go
 * out" line in the header and the bytes on the wire are computed by the same
 * code. A preview that is assembled differently from the real thing is worse
 * than no preview.
 */

const ON = (r) => r && r.on !== false && r.key

/** `{{name}}` replaced from the environment. Unknown names are left alone. */
export function interpolate(text, vars) {
  return String(text ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars ?? {}, name) ? String(vars[name]) : whole
  )
}

/** Every `{{name}}` a request mentions, in the order they first appear. */
export function variablesUsed(req) {
  const seen = []
  const scan = (text) => {
    for (const m of String(text ?? '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) {
      if (!seen.includes(m[1])) seen.push(m[1])
    }
  }
  scan(req.url)
  scan(req.body)
  for (const list of [req.query, req.pathParams, req.headers]) {
    for (const r of list ?? []) {
      scan(r.key)
      scan(r.value)
    }
  }
  const auth = req.auth ?? {}
  scan(auth.token)
  scan(auth.username)
  scan(auth.password)
  scan(auth.keyName)
  return seen
}

export function buildUrl(req, vars = {}) {
  let url = interpolate(req.url ?? '', vars)
  for (const r of (req.pathParams ?? []).filter(ON)) {
    url = url.split(`:${r.key}`).join(interpolate(r.value, vars))
    url = url.split(`{${r.key}}`).join(interpolate(r.value, vars))
  }
  const pairs = [...(req.query ?? []).filter(ON), ...authQuery(req.auth)]
  if (!pairs.length) return url
  const search = pairs
    .map((r) => `${encodeURIComponent(interpolate(r.key, vars))}=${encodeURIComponent(interpolate(r.value, vars))}`)
    .join('&')
  return url.includes('?') ? `${url}&${search}` : `${url}?${search}`
}

export function authQuery(auth) {
  if (!auth || auth.kind !== 'apiKey' || auth.keyIn !== 'query' || !auth.keyName) return []
  return [{ id: 'auth', key: auth.keyName, value: auth.token ?? '', on: true }]
}

export const BODY_TYPE = {
  none: '',
  json: 'application/json',
  graphql: 'application/json',
  xml: 'application/xml',
  form: 'multipart/form-data',
  urlencoded: 'application/x-www-form-urlencoded',
  raw: 'text/plain',
  binary: 'application/octet-stream'
}

export function buildHeaders(req, vars = {}) {
  const out = {}
  for (const r of (req.headers ?? []).filter(ON)) {
    out[interpolate(r.key, vars)] = interpolate(r.value, vars)
  }

  const kind = req.bodyKind ?? 'none'
  const type = BODY_TYPE[kind] ?? ''
  const hasType = Object.keys(out).some((k) => k.toLowerCase() === 'content-type')
  // multipart is left alone: the boundary belongs to whatever writes the body.
  if (type && !hasType && kind !== 'form') out['Content-Type'] = type

  // Auth is applied last so a scheme always beats a stale hand-written header —
  // switching from Basic to Bearer must not send both.
  const auth = req.auth ?? { kind: 'none' }
  const token = interpolate(auth.token ?? '', vars)
  if (auth.kind === 'bearer' || auth.kind === 'oauth2' || auth.kind === 'jwt') {
    if (token) out.Authorization = `Bearer ${token}`
  } else if (auth.kind === 'basic') {
    const pair = `${interpolate(auth.username ?? '', vars)}:${interpolate(auth.password ?? '', vars)}`
    out.Authorization = `Basic ${base64(pair)}`
  } else if (auth.kind === 'apiKey' && auth.keyIn !== 'query' && auth.keyName) {
    out[interpolate(auth.keyName, vars)] = token
  }
  return out
}

function base64(text) {
  if (typeof btoa === 'function') {
    // btoa is byte-oriented; encodeURIComponent gets non-ASCII credentials
    // through it without throwing.
    return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
  }
  return Buffer.from(text, 'utf8').toString('base64')
}

export function buildBody(req, vars = {}) {
  const kind = req.bodyKind ?? 'none'
  if (kind === 'none' || !req.body) return undefined
  const text = interpolate(req.body, vars)
  if (kind !== 'urlencoded' && kind !== 'form') return text
  // Written a pair per line in the editor, sent as a form.
  return text
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf('=')
      const key = at < 0 ? line : line.slice(0, at)
      const value = at < 0 ? '' : line.slice(at + 1)
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')
}

/** Everything the transport needs, and everything the preview shows. */
export function compile(req, vars = {}) {
  return {
    method: req.method ?? 'GET',
    url: buildUrl(req, vars),
    headers: buildHeaders(req, vars),
    body: buildBody(req, vars),
    timeoutMs: req.timeoutMs ?? 30000
  }
}
