/**
 * Reading a HAR file.
 *
 * A HAR is what every browser's network tab exports, so it is the closest
 * thing to a Rebind recording that anyone can produce without Rebind. The work
 * is not in parsing it — the format is plain JSON — but in getting from four
 * hundred entries of fonts, analytics beacons and the same poll forty times
 * over to the dozen calls somebody actually wants to test.
 */
import { emptyCollection, emptyFlow, emptyRequest } from './collection.js'
import { suggestFor } from './assert.js'

export function isHar(doc) {
  return Boolean(doc && typeof doc === 'object' && doc.log && Array.isArray(doc.log.entries))
}

/** Assets, not API calls. A test suite full of webfonts helps nobody. */
const ASSET_TYPE = /^(image|font|video|audio)\/|text\/(html|css)|javascript|ecmascript|octet-stream/i
const ASSET_PATH = /\.(js|mjs|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|eot|map|mp4|webm)(\?|$)/i

/** Headers the browser writes that mean nothing when the request is replayed. */
const DROP_HEADER = /^(:|host$|connection$|content-length$|accept-encoding$|sec-|upgrade-insecure|pragma$|cache-control$|if-none-match$|if-modified-since$|origin$|referer$)/i

export function fromHar(doc, { keepAssets = false } = {}) {
  if (!isHar(doc)) return { ok: false, error: 'That file is not a HAR.' }

  const entries = doc.log.entries.filter((e) => e && e.request && /^https?:/i.test(e.request.url ?? ''))
  if (!entries.length) return { ok: false, error: 'That HAR has no HTTP requests in it.' }

  const wanted = keepAssets ? entries : entries.filter(interesting)
  if (!wanted.length) {
    return {
      ok: false,
      error: `All ${entries.length} requests in that HAR look like page assets — scripts, images, fonts. Nothing to test.`
    }
  }

  // The same call made forty times is one request that was made forty times.
  const seen = new Map()
  for (const entry of wanted) {
    const key = `${(entry.request.method ?? 'GET').toUpperCase()} ${strip(entry.request.url)}`
    if (!seen.has(key)) seen.set(key, { entry, times: 0 })
    const kept = seen.get(key)
    kept.times += 1
    // Keep the one that succeeded: a HAR often opens with the 401 that
    // triggered the login, and that is not the request worth keeping.
    if (better(entry, kept.entry)) kept.entry = entry
  }

  const unique = [...seen.values()]
  const origin = commonOrigin(unique.map((u) => u.entry.request.url))

  // Grouped by the first meaningful path segment, which is how APIs are laid
  // out and therefore how people look for things: orders, users, payments.
  const groups = new Map()
  for (const { entry, times } of unique) {
    const name = section(entry.request.url, origin)
    if (!groups.has(name)) groups.set(name, [])
    groups.get(name).push(toRequest(entry, times, origin))
  }

  const flows = [...groups.entries()].map(([name, requests]) => emptyFlow(name, requests))
  const title = doc.log.pages?.[0]?.title || hostOf(origin) || 'HAR import'

  return {
    ok: true,
    source: 'har',
    name: title,
    collection: emptyCollection(title, flows, 'har'),
    flows,
    recorded: [],
    // The origin becomes a variable, so the import is something you can point
    // at staging rather than a folder of hard-coded production URLs.
    environments: origin
      ? [{ id: `env_har_${Date.now().toString(36)}`, name: `${hostOf(origin)} (from HAR)`, values: { base_url: origin }, secrets: [] }]
      : [],
    read: entries.length,
    kept: unique.length
  }
}

/** The front door, matching readCollection's shape. */
export function readHar(doc, fileName = '') {
  const out = fromHar(doc)
  if (out.ok && !out.name) out.name = fileName
  return out
}

/* ------------------------------------------------------------- picking */

function interesting(entry) {
  const url = entry.request.url ?? ''
  const type = entry.response?.content?.mimeType ?? ''
  if (ASSET_PATH.test(url)) return false

  // The method is asked first, and deliberately. A POST is worth keeping even
  // when the answer is HTML — it is a form submission, which is exactly what
  // people came to test — and judging by the response type first threw those
  // away for looking like a page.
  if ((entry.request.method ?? 'GET').toUpperCase() !== 'GET') return true

  if (ASSET_TYPE.test(type)) return false
  return /json|xml|text\/plain|^$/i.test(type)
}

/** Prefer a 2xx over the 401 that provoked the login. */
function better(candidate, held) {
  const good = (e) => (e.response?.status ?? 0) >= 200 && (e.response?.status ?? 0) < 300
  return good(candidate) && !good(held)
}

/* ---------------------------------------------------------- converting */

function toRequest(entry, times, origin) {
  const req = entry.request
  const url = new URL(req.url)
  const query = [...url.searchParams.entries()].map(([key, value]) => ({ key, value, on: true }))
  url.search = ''

  const headers = []
  let auth = { kind: 'none' }
  for (const h of req.headers ?? []) {
    const key = String(h?.name ?? '')
    if (!key || DROP_HEADER.test(key)) continue
    const value = String(h?.value ?? '')

    const bearer = /^authorization$/i.test(key) && /^bearer\s+(.+)$/i.exec(value)
    if (bearer) {
      // Captured tokens are the point of chaining, so the import points at the
      // variable rather than baking in the one that happened to be live.
      auth = { kind: 'bearer', token: '{{auth_token}}' }
      continue
    }
    if (/^authorization$/i.test(key)) {
      auth = { kind: 'bearer', token: '{{auth_token}}' }
      continue
    }
    headers.push({ key, value, on: true })
  }

  const post = req.postData ?? null
  let bodyKind = 'none'
  let body = ''
  if (post?.text) {
    body = post.text
    if (/json/i.test(post.mimeType ?? '') || looksJson(body)) {
      bodyKind = 'json'
      body = pretty(body)
    } else if (/x-www-form-urlencoded/i.test(post.mimeType ?? '')) bodyKind = 'form'
    else bodyKind = 'text'
  } else if (post?.params?.length) {
    bodyKind = 'form'
    body = post.params.map((p) => `${p.name}=${p.value ?? ''}`).join('&')
  }

  const status = entry.response?.status ?? 0
  const contentType = entry.response?.content?.mimeType ?? ''
  const recorded = {
    status,
    contentType,
    durationMs: Math.round(entry.time ?? 0),
    bytes: entry.response?.content?.size ?? 0,
    times
  }

  let sample
  try {
    sample = JSON.parse(entry.response?.content?.text ?? '')
  } catch {
    sample = undefined
  }

  const full = url.toString()
  return emptyRequest({
    // The method is drawn as a chip beside the name wherever a request is
    // shown, so repeating it here reads "GET GET /orders".
    name: url.pathname.replace(/\/+$/, '') || url.hostname,
    method: (req.method ?? 'GET').toUpperCase(),
    url: origin && full.startsWith(origin) ? `{{base_url}}${full.slice(origin.length)}` : full,
    query,
    headers,
    auth,
    bodyKind,
    body,
    // Only where the response says something worth asserting. A 0 status means
    // the browser cancelled it, and a test built from that always fails.
    assertions: status ? suggestFor(recorded, sample) : [],
    recorded
  })
}

/* ------------------------------------------------------------- helpers */

const strip = (url) => {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

const hostOf = (origin) => {
  try {
    return new URL(origin).hostname
  } catch {
    return ''
  }
}

/** The origin they all share, or nothing if they do not share one. */
function commonOrigin(urls) {
  const origins = new Set()
  for (const u of urls) {
    try {
      origins.add(new URL(u).origin)
    } catch {
      /* not a URL we can use */
    }
  }
  if (origins.size === 1) return [...origins][0]

  // Several hosts: use the one most requests went to, so the majority still
  // become {{base_url}} and the odd third-party call keeps its own address.
  const count = new Map()
  for (const u of urls) {
    try {
      const o = new URL(u).origin
      count.set(o, (count.get(o) ?? 0) + 1)
    } catch {
      /* skip */
    }
  }
  const [top] = [...count.entries()].sort((a, b) => b[1] - a[1])
  return top && top[1] > 1 ? top[0] : ''
}

/** The part of the path that names the thing: /api/v2/orders/7 → orders. */
function section(url, origin) {
  try {
    const path = new URL(url).pathname
    const parts = path.split('/').filter(Boolean)
    const skip = /^(api|v\d+|rest|graphql|public|internal)$/i
    const word = parts.find((p) => !skip.test(p) && !/^\d+$/.test(p) && !/^[0-9a-f-]{8,}$/i.test(p))
    return word ? word.replace(/[-_]/g, ' ') : hostOf(origin) || 'Requests'
  } catch {
    return 'Requests'
  }
}

function looksJson(text) {
  const t = String(text ?? '').trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
