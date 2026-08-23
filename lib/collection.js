/**
 * Reading somebody else's collection.
 *
 * Prism holds one shape internally — a flow of requests, each with rows for
 * query, path, headers, an auth block and a body. Everything imported is
 * translated into that shape here, and nowhere else, so the rest of the app
 * never has to ask where a request came from.
 *
 * Three sources are understood:
 *
 *   1. A Rebind workspace bundle — recorded calls, saved suites, environments.
 *   2. A Rebind suite on its own, which is what the Rebind JSON export writes.
 *   3. A Postman collection, v2.1 or v2.0.
 *
 * Every one of them is somebody's file on disk, possibly hand-edited and
 * possibly written by an older build. Nothing in here may throw on bad input:
 * an import that fails has to say what it could not read, not take the window
 * down. `readCollection` is total — it always returns a result object, and
 * the caller decides what to show.
 */

import { isOpenApi, readOpenApi } from './openapi.js'
import { isHar, readHar } from './har.js'

let seq = 0
export const uid = (prefix = 'id') => `${prefix}-${(seq += 1).toString(36)}-${Date.now().toString(36)}`

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/* ------------------------------------------------------------------ shapes */

export function row(key = '', value = '', on = true) {
  return { id: uid('row'), key: String(key ?? ''), value: String(value ?? ''), on: on !== false }
}

export function emptyRequest(over = {}) {
  return {
    id: uid('req'),
    name: 'New request',
    method: 'GET',
    url: '',
    query: [],
    pathParams: [],
    headers: [],
    auth: { kind: 'none' },
    bodyKind: 'none',
    body: '',
    assertions: [],
    captures: [],
    /** Set when the request came from a recording rather than being written. */
    recorded: null,
    ...over
  }
}

export function emptyFlow(name = 'New flow', requests = []) {
  return { id: uid('flow'), name, requests, open: true }
}

/**
 * A collection: the thing a Postman file or a Rebind export actually is.
 *
 * Three levels, not two. A Postman collection with four folders used to arrive
 * as four unrelated flows and the collection itself vanished — which is wrong
 * twice over: you could not tell where a flow came from, and re-exporting put
 * it back as something with a different shape from the file you opened.
 */
export function emptyCollection(name = 'New collection', flows = [], source = 'canvas') {
  return { id: uid('col'), name, source, flows, open: true }
}

/* ------------------------------------------------------------ small helpers */

/** Splits `a=1&b=2` into rows, tolerating a malformed escape. */
export function queryRows(search) {
  return String(search || '')
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=')
      const key = at < 0 ? pair : pair.slice(0, at)
      const value = at < 0 ? '' : pair.slice(at + 1)
      return row(decodePlus(key), decodePlus(value))
    })
}

function decodePlus(text) {
  try {
    return decodeURIComponent(String(text).replace(/\+/g, ' '))
  } catch {
    return String(text)
  }
}

export function splitUrl(url) {
  const text = String(url ?? '')
  const at = text.indexOf('?')
  return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]
}

/** Rows out of an object, an array of rows, or nothing at all. */
export function toRows(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item && typeof item === 'object')
      .map((item) =>
        row(
          item.key ?? item.name ?? '',
          item.value ?? '',
          item.on !== false && item.enabled !== false && item.disabled !== true
        )
      )
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, v]) => row(key, v))
  }
  return []
}

const JSON_TYPE = /json/i
const FORM_TYPE = /x-www-form-urlencoded/i
const XML_TYPE = /xml/i
const MULTIPART = /multipart\/form-data/i

export function bodyKindFor(contentType, body) {
  if (!body) return 'none'
  const type = String(contentType || '')
  if (JSON_TYPE.test(type)) return 'json'
  if (FORM_TYPE.test(type)) return 'urlencoded'
  if (XML_TYPE.test(type)) return 'xml'
  if (MULTIPART.test(type)) return 'form'
  // Nothing declared. A body that parses as JSON almost certainly is.
  if (!type && looksLikeJson(body)) return 'json'
  return 'raw'
}

function looksLikeJson(text) {
  const trimmed = String(text).trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

function headerValue(rows, name) {
  const found = rows.find((r) => r.key.toLowerCase() === name.toLowerCase())
  return found ? found.value : ''
}

/* -------------------------------------------------- source 1 + 2: Rebind */

/**
 * A saved Rebind request.
 *
 * Rebind changed this shape once: headers used to be one object and there were
 * no query or path rows. Both spellings are read, because a user's file may
 * predate the change and there is no way to tell from the outside.
 */
export function fromRebindTest(raw) {
  const test = raw && typeof raw === 'object' ? raw : {}
  const headers = toRows(test.headers)
  const [bare, search] = splitUrl(test.url)
  const query = test.query === undefined ? queryRows(search) : toRows(test.query)
  const body = typeof test.body === 'string' && test.body ? test.body : ''

  return emptyRequest({
    id: typeof test.id === 'string' ? test.id : uid('req'),
    name: String(test.name || 'Request'),
    method: normaliseMethod(test.method),
    url: bare,
    query,
    pathParams: toRows(test.pathParams),
    headers,
    auth: readAuth(test.auth),
    bodyKind: typeof test.bodyKind === 'string' && test.bodyKind !== 'none' ? test.bodyKind : bodyKindFor(headerValue(headers, 'content-type'), body),
    body,
    assertions: Array.isArray(test.assertions) ? test.assertions.map(fromRebindAssertion).filter(Boolean) : [],
    captures: Array.isArray(test.extract)
      ? test.extract.map((e) => ({ id: uid('cap'), name: String(e?.name ?? ''), from: e?.from === 'header' ? 'header' : 'body', path: String(e?.path ?? '') }))
      : []
  })
}

function normaliseMethod(method) {
  const upper = String(method || 'GET').toUpperCase()
  return METHODS.includes(upper) ? upper : 'GET'
}

/**
 * Rebind's assertion vocabulary, mapped onto Prism's.
 *
 * Prism says the same things with a subject and an operator rather than one
 * fused kind, because the builder lets you change either half independently.
 */
const REBIND_ASSERTION = {
  status: { subject: 'status', op: 'equals' },
  statusIn: { subject: 'status', op: 'oneOf' },
  responseTime: { subject: 'time', op: 'lessThan' },
  contentType: { subject: 'contentType', op: 'contains' },
  header: { subject: 'header', op: 'equals' },
  bodyContains: { subject: 'body', op: 'contains' },
  bodyNotContains: { subject: 'body', op: 'notContains' },
  bodyMatches: { subject: 'body', op: 'matches' },
  jsonExists: { subject: 'json', op: 'exists' },
  jsonEquals: { subject: 'json', op: 'equals' },
  jsonType: { subject: 'json', op: 'isType' }
}

function fromRebindAssertion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const mapped = REBIND_ASSERTION[raw.kind]
  if (!mapped) return null
  return {
    id: typeof raw.id === 'string' ? raw.id : uid('as'),
    subject: mapped.subject,
    path: String(raw.target ?? ''),
    op: mapped.op,
    value: String(raw.expected ?? ''),
    on: raw.enabled !== false
  }
}

function readAuth(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.kind !== 'string') return { kind: 'none' }
  return { kind: 'none', ...raw }
}

/**
 * A call Rebind captured while recording.
 *
 * Turned into a request that can be sent again, plus the evidence of what it
 * did the first time — which is what makes "convert to test" able to propose
 * assertions instead of asking for them.
 */
export function fromRebindCall(raw) {
  const call = raw && typeof raw === 'object' ? raw : {}
  const headers = toRows(call.requestHeaders)
  const body = typeof call.requestBody === 'string' ? call.requestBody : ''
  const [bare, search] = splitUrl(call.url)
  const query = call.query && Object.keys(call.query).length ? toRows(call.query) : queryRows(search)

  return emptyRequest({
    id: uid('req'),
    name: `${normaliseMethod(call.method)} ${shortPath(call.path || call.url)}`,
    method: normaliseMethod(call.method),
    url: bare,
    query,
    headers: headers.filter((h) => !DROP_HEADER.test(h.key)),
    auth: call.authScheme ? { kind: String(call.authScheme).toLowerCase() === 'basic' ? 'basic' : 'bearer', token: '{{auth_token}}' } : { kind: 'none' },
    bodyKind: bodyKindFor(headerValue(headers, 'content-type'), body),
    body,
    recorded: {
      at: Number(call.at) || 0,
      status: Number(call.status) || 0,
      statusText: String(call.statusText || ''),
      durationMs: Number(call.durationMs) || 0,
      bytes: Number(call.responseBytes) || 0,
      contentType: String(call.contentType || ''),
      responseBody: typeof call.responseBody === 'string' ? call.responseBody : '',
      responseHeaders: call.responseHeaders && typeof call.responseHeaders === 'object' ? call.responseHeaders : {},
      kind: String(call.kind || 'other'),
      source: String(call.path || call.url || '')
    }
  })
}

/**
 * Headers a browser sets for itself.
 *
 * Replaying these is worse than useless — a stale `content-length` or a
 * captured `cookie` makes the resent request behave differently from the one
 * being reproduced.
 */
const DROP_HEADER = /^(host|connection|content-length|accept-encoding|origin|referer|sec-|user-agent$|cookie$)/i

export function shortPath(url) {
  try {
    return new URL(url).pathname || '/'
  } catch {
    const text = String(url || '')
    const at = text.indexOf('://')
    const from = at < 0 ? 0 : text.indexOf('/', at + 3)
    return from < 0 ? text : text.slice(from) || '/'
  }
}

/* ------------------------------------------------------ source 3: Postman */

/**
 * A Postman collection, v2.1 or v2.0.
 *
 * Folders become flows. Postman allows arbitrary nesting; Prism has exactly
 * one level, so a nested folder's path is flattened into the flow name rather
 * than being silently dropped.
 */
export function fromPostman(doc) {
  const flows = []
  const loose = []

  const walk = (items, trail) => {
    for (const item of items ?? []) {
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item.item)) {
        const name = [...trail, String(item.name || 'Folder')].join(' / ')
        const nested = []
        walkInto(item.item, name, nested)
        if (nested.length) flows.push(emptyFlow(name, nested))
      } else if (item.request) {
        loose.push(fromPostmanItem(item))
      }
    }
  }

  const walkInto = (items, name, out) => {
    for (const item of items ?? []) {
      if (!item || typeof item !== 'object') continue
      if (Array.isArray(item.item)) {
        const deeper = [...name.split(' / '), String(item.name || 'Folder')].join(' / ')
        const nested = []
        walkInto(item.item, deeper, nested)
        if (nested.length) flows.push(emptyFlow(deeper, nested))
      } else if (item.request) {
        out.push(fromPostmanItem(item))
      }
    }
  }

  walk(doc?.item, [])

  const name = String(doc?.info?.name || 'Postman collection')
  // Requests sitting at the top level of the collection belong to the
  // collection, not to a folder. They get one so they are not orphaned.
  if (loose.length) flows.unshift(emptyFlow('Ungrouped', loose))
  return { name, flows, environments: postmanVariables(doc, name) }
}

function postmanVariables(doc, name) {
  const vars = Array.isArray(doc?.variable) ? doc.variable : []
  if (!vars.length) return []
  const values = {}
  for (const v of vars) {
    if (v && typeof v === 'object' && v.key) values[String(v.key)] = String(v.value ?? '')
  }
  return Object.keys(values).length ? [{ id: uid('env'), name: `${name} variables`, values, secrets: [] }] : []
}

function fromPostmanItem(item) {
  const req = item.request ?? {}
  const headers = toRows(req.header).filter((h) => h.key)
  const [bare, search] = urlOf(req.url)
  const bodyText = postmanBody(req.body)
  const declared = headerValue(headers, 'content-type')

  return emptyRequest({
    name: String(item.name || 'Request'),
    method: normaliseMethod(req.method),
    url: bare,
    query: postmanQuery(req.url, search),
    pathParams: postmanPathVars(req.url),
    headers,
    auth: postmanAuth(req.auth),
    bodyKind: postmanBodyKind(req.body, declared, bodyText),
    body: bodyText,
    assertions: postmanTests(item)
  })
}

function urlOf(url) {
  if (typeof url === 'string') return splitUrl(url)
  if (url && typeof url === 'object') {
    if (typeof url.raw === 'string' && url.raw) return splitUrl(url.raw)
    // Postman can store the URL in pieces with no raw form at all.
    const host = Array.isArray(url.host) ? url.host.join('.') : String(url.host ?? '')
    const path = Array.isArray(url.path) ? url.path.join('/') : String(url.path ?? '')
    const scheme = url.protocol ? `${url.protocol}://` : ''
    const port = url.port ? `:${url.port}` : ''
    return [`${scheme}${host}${port}${path ? `/${path}` : ''}`, '']
  }
  return ['', '']
}

function postmanQuery(url, search) {
  if (url && typeof url === 'object' && Array.isArray(url.query)) {
    return url.query
      .filter((q) => q && typeof q === 'object')
      .map((q) => row(q.key ?? '', q.value ?? '', q.disabled !== true))
  }
  return queryRows(search)
}

function postmanPathVars(url) {
  if (!url || typeof url !== 'object' || !Array.isArray(url.variable)) return []
  return url.variable.filter((v) => v && v.key).map((v) => row(v.key, v.value ?? ''))
}

function postmanBody(body) {
  if (!body || typeof body !== 'object') return ''
  if (typeof body.raw === 'string') return body.raw
  if (body.mode === 'urlencoded' && Array.isArray(body.urlencoded)) {
    return body.urlencoded
      .filter((p) => p && p.key && p.disabled !== true)
      .map((p) => `${p.key}=${p.value ?? ''}`)
      .join('\n')
  }
  if (body.mode === 'formdata' && Array.isArray(body.formdata)) {
    return body.formdata
      .filter((p) => p && p.key && p.disabled !== true)
      .map((p) => `${p.key}=${p.value ?? ''}`)
      .join('\n')
  }
  if (body.mode === 'graphql' && body.graphql) {
    return JSON.stringify({ query: body.graphql.query ?? '', variables: safeParse(body.graphql.variables) ?? {} }, null, 2)
  }
  return ''
}

function postmanBodyKind(body, declared, text) {
  if (!body || typeof body !== 'object' || !text) return 'none'
  if (body.mode === 'graphql') return 'graphql'
  if (body.mode === 'urlencoded') return 'urlencoded'
  if (body.mode === 'formdata') return 'form'
  const language = body.options?.raw?.language
  if (language === 'json') return 'json'
  if (language === 'xml') return 'xml'
  return bodyKindFor(declared, text)
}

function postmanAuth(auth) {
  if (!auth || typeof auth !== 'object') return { kind: 'none' }
  const pick = (list, key) => {
    const found = (Array.isArray(list) ? list : []).find((x) => x && x.key === key)
    return found ? String(found.value ?? '') : ''
  }
  switch (auth.type) {
    case 'bearer':
      return { kind: 'bearer', token: pick(auth.bearer, 'token') }
    case 'basic':
      return { kind: 'basic', username: pick(auth.basic, 'username'), password: pick(auth.basic, 'password') }
    case 'apikey':
      return {
        kind: 'apiKey',
        keyName: pick(auth.apikey, 'key'),
        token: pick(auth.apikey, 'value'),
        keyIn: pick(auth.apikey, 'in') === 'query' ? 'query' : 'header'
      }
    case 'oauth2':
      return { kind: 'oauth2', token: pick(auth.oauth2, 'accessToken') }
    case 'noauth':
      return { kind: 'none' }
    default:
      return auth.type ? { kind: 'custom' } : { kind: 'none' }
  }
}

/**
 * Assertions recovered from a Postman test script.
 *
 * Postman tests are JavaScript, so this reads the handful of shapes that make
 * up most real scripts and leaves the rest. Anything not recognised is not
 * invented — a collection that imports with two of its five checks is honest;
 * one that imports with five checks it does not actually perform is not.
 */
export function postmanTests(item) {
  const scripts = (Array.isArray(item?.event) ? item.event : [])
    .filter((e) => e && e.listen === 'test')
    .map((e) => (Array.isArray(e.script?.exec) ? e.script.exec.join('\n') : String(e.script?.exec ?? '')))
    .join('\n')
  if (!scripts) return []

  const out = []
  const add = (subject, op, value, path = '') => out.push({ id: uid('as'), subject, path, op, value: String(value), on: true })

  for (const m of scripts.matchAll(/\.to\.have\.status\(\s*(\d{3})\s*\)/g)) add('status', 'equals', m[1])
  for (const m of scripts.matchAll(/response\.code\s*(?:===?|to\.eql)\s*\(?\s*(\d{3})/g)) add('status', 'equals', m[1])
  for (const m of scripts.matchAll(/responseTime\)?\.to\.be\.below\(\s*(\d+)\s*\)/g)) add('time', 'lessThan', m[1])
  for (const m of scripts.matchAll(/\.to\.include\(\s*['"`]([^'"`]+)['"`]\s*\)/g)) add('body', 'contains', m[1])
  for (const m of scripts.matchAll(/pm\.response\.json\(\)([.\w[\]'"]+)\s*\)?\.to\.eql\(\s*['"`]?([^'"`)]+)['"`]?\s*\)/g)) {
    add('json', 'equals', m[2].trim(), m[1].replace(/^\./, '').replace(/\['?([^\]']+)'?\]/g, '.$1'))
  }

  // Deduplicated: the same check written twice in one script is one assertion.
  const seen = new Set()
  return out.filter((a) => {
    const key = `${a.subject}|${a.op}|${a.path}|${a.value}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------ the front door */

/**
 * Works out what a file is and reads it.
 *
 * Never throws. Returns `{ ok: false, error }` for anything it cannot make
 * sense of, with a message that says what was expected — an import is the
 * first thing a new user does and a bare "unexpected token" teaches nothing.
 */
export function readCollection(text, fileName = '') {
  let doc
  try {
    doc = JSON.parse(String(text))
  } catch (err) {
    return { ok: false, error: `${fileName || 'That file'} is not valid JSON — ${err.message}` }
  }
  if (!doc || typeof doc !== 'object') {
    return { ok: false, error: 'That file holds a value, not a collection.' }
  }

  // A Rebind workspace bundle: recorded traffic and saved flows together.
  if (doc.rebind === 'workspace' || (Array.isArray(doc.calls) && Array.isArray(doc.suites))) {
    const recorded = (doc.calls ?? []).filter((c) => c && c.include !== false).map(fromRebindCall)
    const flows = (doc.suites ?? [])
      .filter((s) => s && Array.isArray(s.tests))
      .map((s) => emptyFlow(String(s.name || 'Flow'), s.tests.map(fromRebindTest)))
    const name = String(doc.project || doc.name || fileName || 'Rebind workspace')
    return {
      ok: true,
      source: 'rebind-workspace',
      name,
      collection: emptyCollection(name, flows, 'rebind-workspace'),
      flows,
      recorded,
      environments: (doc.environments ?? [])
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({ id: uid('env'), name: String(e.name || 'Environment'), values: e.values ?? {}, secrets: [] }))
    }
  }

  // A Rebind suite on its own — what the Rebind JSON export writes.
  if (Array.isArray(doc.tests)) {
    const name = String(doc.name || fileName || 'Rebind flow')
    const flows = [emptyFlow(name, doc.tests.map(fromRebindTest))]
    return {
      ok: true,
      source: 'rebind-suite',
      name,
      collection: emptyCollection(name, flows, 'rebind-suite'),
      flows,
      recorded: [],
      environments: []
    }
  }

  // An OpenAPI or Swagger document.
  if (isOpenApi(doc)) return readOpenApi(doc, fileName)
  if (isHar(doc)) return readHar(doc, fileName)

  // A Postman collection.
  if (doc.info && Array.isArray(doc.item)) {
    const schema = String(doc.info.schema ?? '')
    if (schema && !/v2\.[01]/.test(schema)) {
      return {
        ok: false,
        error: `Prism reads Postman v2.0 and v2.1 collections. This one says it is "${schema}" — re-export it from Postman as v2.1.`
      }
    }
    const parsed = fromPostman(doc)
    if (!parsed.flows.length) return { ok: false, error: 'That collection has no requests in it.' }
    return {
      ok: true,
      source: 'postman',
      ...parsed,
      collection: emptyCollection(parsed.name, parsed.flows, 'postman'),
      recorded: []
    }
  }

  if (Array.isArray(doc.values) && doc.name) {
    // A Postman environment export, which people do reach for by mistake.
    const values = {}
    for (const v of doc.values) if (v && v.key) values[String(v.key)] = String(v.value ?? '')
    return {
      ok: true,
      source: 'postman-environment',
      name: String(doc.name),
      collection: null,
      flows: [],
      recorded: [],
      environments: [{ id: uid('env'), name: String(doc.name), values, secrets: [] }]
    }
  }

  return {
    ok: false,
    error: 'Prism did not recognise that file. It reads a Rebind workspace or flow export, or a Postman v2.1 collection.'
  }
}

/** How many requests an import actually brought in, for the confirmation. */
export function countRequests(result) {
  const inFlows = (result.flows ?? []).reduce((n, f) => n + f.requests.length, 0)
  return inFlows + (result.recorded ?? []).length
}

/** Every request under a collection, in order. */
export function requestsIn(collection) {
  return (collection?.flows ?? []).flatMap((f) => f.requests)
}
