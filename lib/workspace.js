/**
 * The workspace on disk.
 *
 * WHY A VERSION AND A MIGRATION
 *
 * A saved file is the one piece of state that outlives the code that wrote it.
 * It will be opened by a newer Prism, an older Prism, and by somebody who
 * hand-edited it — and this project has already been bitten once by a stored
 * shape drifting away from the model reading it. So: an explicit version, a
 * reader that is total, and defaults for everything.
 *
 * WHAT IS NOT WRITTEN
 *
 * The value of a variable marked **secret** is left out. A workspace is a file
 * people commit next to their code and send to each other; writing a live
 * token into it is the same leak the export rule exists to prevent. The name
 * is kept, so opening the file tells you what to fill in.
 *
 * Responses are not written either, with one exception: a baseline that was
 * deliberately frozen. Session results are noise in a file meant to be
 * reviewed in a diff.
 */
import { emptyCollection, emptyFlow, emptyRequest, toRows, uid } from './collection.js'

export const FORMAT = 'prism.workspace'
export const VERSION = 1

/* ------------------------------------------------------------------ write */

/**
 * @param {object} state  collections, environments, envId, layout, baselines
 * @param {{ name?: string }} [meta]
 */
export function serialise(state, meta = {}) {
  return {
    prism: FORMAT,
    version: VERSION,
    name: meta.name ?? 'Workspace',
    savedAt: new Date().toISOString(),
    activeEnvironment: state.envId ?? '',
    collections: (state.collections ?? []).map(writeCollection),
    environments: (state.environments ?? []).map(writeEnvironment),
    // Node positions are part of the work: a graph somebody arranged and then
    // found rearranged on open has lost something real.
    layout: Object.fromEntries(state.layout ?? []),
    baselines: state.baselines ? Object.fromEntries(state.baselines) : {},
    // How each request has behaved over time. Kept because "is this getting
    // slower" and "does this fail sometimes" are the only questions old runs
    // can answer, and both need runs that outlive the session.
    //
    // Measurements only: no body, no headers, nothing that could carry a token
    // out of the session and onto the disk.
    history: (state.history ?? []).slice(0, HISTORY_KEPT).map(writeRun)
  }
}

/** Runs kept per workspace. Enough for a trend, small enough to stay quick. */
export const HISTORY_KEPT = 400

function writeRun(run) {
  return {
    requestId: run.requestId,
    name: run.name,
    method: run.method,
    status: run.status,
    ms: run.ms,
    at: run.at,
    env: run.env,
    failed: run.failed ? 1 : 0
  }
}

function writeCollection(col) {
  return {
    id: col.id,
    name: col.name,
    source: col.source ?? 'prism',
    open: col.open !== false,
    flows: (col.flows ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      open: f.open !== false,
      requests: (f.requests ?? []).map(writeRequest)
    }))
  }
}

function writeRequest(req) {
  return {
    id: req.id,
    name: req.name,
    method: req.method,
    url: req.url,
    query: rows(req.query),
    pathParams: rows(req.pathParams),
    headers: rows(req.headers),
    auth: req.auth ?? { kind: 'none' },
    bodyKind: req.bodyKind ?? 'none',
    body: req.body ?? '',
    assertions: req.assertions ?? [],
    captures: req.captures ?? [],
    ...(req.dataset ? { dataset: req.dataset } : {}),
    ...(req.recorded ? { recorded: req.recorded } : {})
  }
}

const rows = (list) => (list ?? []).map((r) => ({ key: r.key, value: r.value, on: r.on !== false }))

/**
 * An environment, with secret values withheld.
 *
 * The names of the secrets are kept in their own list so the reader can mark
 * them again — otherwise opening a shared workspace silently downgrades every
 * secret to an ordinary variable, and the next export leaks it.
 */
function writeEnvironment(env) {
  const secrets = env.secrets ?? []
  const values = {}
  for (const [k, v] of Object.entries(env.values ?? {})) values[k] = secrets.includes(k) ? '' : String(v)
  return { id: env.id, name: env.name, values, secrets }
}

/* ------------------------------------------------------------------- read */

/**
 * Reads a saved workspace. Never throws.
 *
 * @returns {{ ok: true, workspace: object } | { ok: false, error: string }}
 */
export function parse(text, fileName = '') {
  let doc
  try {
    doc = JSON.parse(String(text))
  } catch (err) {
    return { ok: false, error: `${fileName || 'That file'} is not valid JSON — ${err.message}` }
  }
  if (!doc || typeof doc !== 'object') return { ok: false, error: 'That file holds a value, not a workspace.' }
  if (doc.prism !== FORMAT) {
    return {
      ok: false,
      error: 'That is not a Prism workspace. Use Import for a Rebind recording, a Postman collection or an OpenAPI document.'
    }
  }
  if (Number(doc.version) > VERSION) {
    return {
      ok: false,
      error: `That workspace was saved by a newer Prism (format ${doc.version}, this build reads ${VERSION}). Update Prism, or export the collection instead.`
    }
  }

  return { ok: true, workspace: read(doc) }
}

function read(doc) {
  const collections = (Array.isArray(doc.collections) ? doc.collections : []).map(readCollection)
  const environments = (Array.isArray(doc.environments) ? doc.environments : []).map(readEnvironment)
  const known = new Set(environments.map((e) => e.id))

  return {
    name: String(doc.name ?? 'Workspace'),
    savedAt: String(doc.savedAt ?? ''),
    collections,
    environments,
    // A pointer to an environment that is no longer there would leave the app
    // reading values from nothing.
    envId: known.has(doc.activeEnvironment) ? doc.activeEnvironment : (environments[0]?.id ?? ''),
    layout: readLayout(doc.layout),
    baselines: readBaselines(doc.baselines),
    history: (Array.isArray(doc.history) ? doc.history : []).slice(0, HISTORY_KEPT).map(readRun)
  }
}

/** A stored run, back in the shape the app holds. */
function readRun(raw) {
  return {
    id: `h_${String(raw?.at ?? 0)}_${String(raw?.requestId ?? '')}`,
    requestId: String(raw?.requestId ?? ''),
    name: String(raw?.name ?? ''),
    method: String(raw?.method ?? 'GET'),
    // The URL is not stored — it can hold a token in a query string, and the
    // request it belongs to still knows its own address.
    url: '',
    status: Number(raw?.status) || 0,
    ms: Number(raw?.ms) || 0,
    at: Number(raw?.at) || 0,
    env: String(raw?.env ?? ''),
    failed: Number(raw?.failed) || 0
  }
}

function readCollection(raw) {
  const col = emptyCollection(String(raw?.name ?? 'Collection'), [], String(raw?.source ?? 'prism'))
  if (typeof raw?.id === 'string') col.id = raw.id
  col.open = raw?.open !== false
  col.flows = (Array.isArray(raw?.flows) ? raw.flows : []).map((f) => {
    const flow = emptyFlow(String(f?.name ?? 'Flow'), (Array.isArray(f?.requests) ? f.requests : []).map(readRequest))
    if (typeof f?.id === 'string') flow.id = f.id
    flow.open = f?.open !== false
    return flow
  })
  return col
}

function readRequest(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return emptyRequest({
    id: typeof r.id === 'string' ? r.id : uid('req'),
    name: String(r.name ?? 'Request'),
    method: String(r.method ?? 'GET').toUpperCase(),
    url: String(r.url ?? ''),
    query: toRows(r.query),
    pathParams: toRows(r.pathParams),
    headers: toRows(r.headers),
    auth: r.auth && typeof r.auth === 'object' ? { kind: 'none', ...r.auth } : { kind: 'none' },
    bodyKind: typeof r.bodyKind === 'string' ? r.bodyKind : 'none',
    body: typeof r.body === 'string' ? r.body : '',
    assertions: Array.isArray(r.assertions) ? r.assertions.filter(isAssertion) : [],
    captures: Array.isArray(r.captures) ? r.captures.filter((c) => c && typeof c === 'object').map(readCapture) : [],
    dataset: readDataset(r.dataset),
    recorded: r.recorded && typeof r.recorded === 'object' ? r.recorded : null
  })
}

const isAssertion = (a) => a && typeof a === 'object' && typeof a.subject === 'string' && typeof a.op === 'string'

const readCapture = (c) => ({
  id: typeof c.id === 'string' ? c.id : uid('cap'),
  name: String(c.name ?? ''),
  from: c.from === 'header' ? 'header' : 'body',
  path: String(c.path ?? '')
})

function readDataset(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows)) return null
  return {
    name: String(raw.name ?? 'Data'),
    columns: Array.isArray(raw.columns) ? raw.columns.map(String) : [],
    rows: raw.rows.filter((r) => r && typeof r === 'object')
  }
}

function readEnvironment(raw) {
  const values = {}
  if (raw?.values && typeof raw.values === 'object') {
    for (const [k, v] of Object.entries(raw.values)) values[k] = String(v ?? '')
  }
  const secrets = (Array.isArray(raw?.secrets) ? raw.secrets : []).map(String).filter((k) => k in values)
  return {
    id: typeof raw?.id === 'string' ? raw.id : uid('env'),
    name: String(raw?.name ?? 'Environment'),
    values,
    secrets
  }
}

function readLayout(raw) {
  const out = new Map()
  if (!raw || typeof raw !== 'object') return out
  for (const [id, at] of Object.entries(raw)) {
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) out.set(id, { x: at.x, y: at.y })
  }
  return out
}

function readBaselines(raw) {
  const out = new Map()
  if (!raw || typeof raw !== 'object') return out
  for (const [id, b] of Object.entries(raw)) {
    if (!b || typeof b !== 'object') continue
    out.set(id, {
      at: Number(b.at) || 0,
      status: Number(b.status) || 0,
      headers: b.headers && typeof b.headers === 'object' ? b.headers : {},
      json: b.json,
      body: typeof b.body === 'string' ? b.body : ''
    })
  }
  return out
}

/** How many requests a file holds, for the confirmation after opening one. */
export function countIn(workspace) {
  return (workspace.collections ?? []).reduce(
    (n, c) => n + c.flows.reduce((m, f) => m + f.requests.length, 0),
    0
  )
}

/** Names of secrets that came back empty, so the app can say what to refill. */
export function missingSecrets(workspace) {
  const out = []
  for (const env of workspace.environments ?? []) {
    for (const key of env.secrets ?? []) {
      if (!env.values[key]) out.push(`${env.name}.${key}`)
    }
  }
  return out
}
