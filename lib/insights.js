/**
 * What is wrong with this response.
 *
 * NOT A MODEL. Every finding below is a rule over the response that just came
 * back, and each one carries the evidence that produced it. That is a
 * deliberate choice: a checklist that is always right about six things beats a
 * paragraph that is usually right about twenty, and on a screen full of red
 * and green the one thing that must never be guessed is why something failed.
 *
 * Findings are ordered by how much they should worry you, and each says what
 * to do rather than only what it saw.
 */

const SECRET_KEY = /(token|secret|password|passwd|apikey|api_key|authorization|credential|private)/i
const JWT = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/

/**
 * @param {object} response  status, headers, body, bytes, timing, json
 * @param {object} request   the request as sent, for auth and scheme checks
 * @param {object[]} results assertion outcomes, so a failure can be explained
 */
export function analyse(response, request = {}, results = []) {
  if (!response) return []
  const out = []
  const add = (level, title, detail, hint) => out.push({ level, title, detail, hint })

  const headers = lower(response.headers)
  const status = response.status ?? 0
  const ms = response.timing?.total ?? 0
  const type = headers['content-type'] ?? ''

  /* ------------------------------------------------------------- transport */

  if (response.error) {
    add('bad', 'The request never completed', response.error, 'Check the host, the port and whether anything is listening.')
    return out
  }

  if (!request.secure && /^https:/i.test(request.url ?? '')) {
    // Only reachable if the transport disagreed with the URL.
    add('warn', 'Sent over plain HTTP', 'The URL says https but the connection was not secure.', 'Anything sent here is readable in transit.')
  }

  /* ---------------------------------------------------------------- status */

  if (status >= 500) {
    add('bad', 'The server failed', `${status} ${response.statusText ?? ''}`.trim(), 'This is the API’s fault, not the request’s — the same call may succeed on a retry.')
  } else if (status === 429) {
    const retry = headers['retry-after']
    add('warn', 'Rate limited', `429, ${retry ? `retry after ${retry}` : 'no Retry-After header'}`, retry ? 'Space the suite out by at least that long.' : 'The API did not say how long to wait, so back off manually.')
  } else if (status === 401 || status === 403) {
    const sent = Object.keys(request.headers ?? {}).some((k) => k.toLowerCase() === 'authorization')
    add(
      'bad',
      status === 401 ? 'Not authenticated' : 'Not allowed',
      sent ? 'An Authorization header was sent and rejected.' : 'No Authorization header was sent.',
      sent ? 'The credential may be expired, or for the wrong environment.' : 'Set the auth on this request, or capture a token from the login step first.'
    )
  } else if (status >= 400) {
    add('warn', `Rejected with ${status}`, response.statusText || 'The API refused the request.', 'Check the body and the required fields below.')
  } else if (status >= 300) {
    const to = headers.location
    add('info', `Redirected (${status})`, to ? `Location: ${to}` : 'No Location header was sent.', 'The body here is the redirect, not the resource.')
  }

  /* ------------------------------------------------------------ timing */

  if (ms > 2000) {
    add('warn', 'Slow response', `${ms}ms end to end${phase(response.timing)}`, 'Worth a time assertion so a regression is caught rather than felt.')
  } else if (ms > 800) {
    add('info', 'Sluggish', `${ms}ms end to end${phase(response.timing)}`, 'Fine once, worth watching across a suite.')
  }

  /* ------------------------------------------------------------- payload */

  if (response.truncated) {
    add('warn', 'Response was truncated', `Over the 4 MB Prism keeps in memory (${bytes(response.bytes)} arrived).`, 'Assertions still ran, but the body shown is incomplete.')
  }

  if (status < 300 && (response.bytes ?? 0) === 0 && status !== 204) {
    add('warn', 'Empty body on a success', `${status} with nothing in it.`, 'If that is expected, assert it — otherwise the endpoint is not returning what it used to.')
  }

  if (/json/i.test(type) && response.json === undefined && (response.body ?? '').length) {
    add('bad', 'Says JSON, is not JSON', 'The content type is JSON but the body would not parse.', 'Every JSON assertion on this request will fail until that is fixed.')
  }

  /* ---------------------------------------------------------------- shape */

  if (response.json !== undefined) {
    const nulls = nullFields(response.json)
    if (nulls.length) {
      add(
        'info',
        `${nulls.length} null field${nulls.length === 1 ? '' : 's'}`,
        nulls.slice(0, 6).join(', ') + (nulls.length > 6 ? `, and ${nulls.length - 6} more` : ''),
        'A field that is null today and absent tomorrow breaks a consumer either way — assert the ones that matter.'
      )
    }
    const empties = emptyCollections(response.json)
    if (empties.length) {
      add('info', 'Empty collections', empties.slice(0, 6).join(', '), 'A test that passes against an empty list is usually not testing anything.')
    }
    const leaked = secretsIn(response.json)
    if (leaked.length) {
      add('warn', 'Credential-shaped values in the body', leaked.slice(0, 4).join(', '), 'Check these are meant to be returned. Prism does not redact response bodies.')
    }
  }

  /* -------------------------------------------------------------- headers */

  if (!type) {
    add('warn', 'No content type', 'The response did not say what it is.', 'Content-type assertions cannot pass, and clients have to guess.')
  }

  if (request.secure && !headers['strict-transport-security'] && status < 400) {
    add('info', 'No HSTS header', 'Strict-Transport-Security was not set.', 'Not a test failure — worth raising with whoever owns the API.')
  }

  const cache = headers['cache-control'] ?? ''
  if (status < 300 && /private|no-store/i.test(cache) === false && SECRET_KEY.test(JSON.stringify(response.json ?? '').slice(0, 4000))) {
    add('info', 'Cacheable response holds sensitive-looking fields', `Cache-Control: ${cache || 'not set'}`, 'A shared cache may keep this.')
  }

  /* ----------------------------------------------------------- assertions */

  const failed = results.filter((r) => !r.ok)
  if (failed.length) {
    add(
      'bad',
      `${failed.length} assertion${failed.length === 1 ? '' : 's'} failed`,
      failed.map((r) => r.detail).slice(0, 4).join(' · '),
      'Each one is listed with what it actually saw on the Tests tab.'
    )
  } else if (results.length) {
    add('ok', `All ${results.length} assertions passed`, 'Nothing to look at here.', '')
  } else {
    add('info', 'No assertions on this request', 'It ran, but nothing checked the result.', 'Response status and time are two useful ones to start with.')
  }

  const RANK = { bad: 0, warn: 1, info: 2, ok: 3 }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level])
}

function phase(timing) {
  if (!timing) return ''
  const wait = (timing.first ?? 0) - (timing.tls || timing.tcp || timing.dns || 0)
  return wait > 0 ? `, ${wait}ms of it waiting on the server` : ''
}

function lower(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers ?? {})) out[key.toLowerCase()] = String(value)
  return out
}

export function bytes(n) {
  const value = Number(n) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

/** Paths whose value is null, which is where consumers break. */
export function nullFields(value, trail = '', out = [], depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value)) {
    const path = trail ? `${trail}.${key}` : key
    if (child === null) out.push(path)
    else if (typeof child === 'object') nullFields(child, path, out, depth + 1)
    if (out.length > 40) return out
  }
  return out
}

export function emptyCollections(value, trail = '', out = [], depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value)) {
    const path = trail ? `${trail}.${key}` : key
    if (Array.isArray(child) && child.length === 0) out.push(path)
    else if (child && typeof child === 'object') emptyCollections(child, path, out, depth + 1)
    if (out.length > 20) return out
  }
  return out
}

/** Fields whose name or value looks like a credential. */
export function secretsIn(value, trail = '', out = [], depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return out
  for (const [key, child] of Object.entries(value)) {
    const path = trail ? `${trail}.${key}` : key
    if (typeof child === 'string' && (SECRET_KEY.test(key) || JWT.test(child))) out.push(path)
    else if (child && typeof child === 'object') secretsIn(child, path, out, depth + 1)
    if (out.length > 20) return out
  }
  return out
}
