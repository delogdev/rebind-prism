/**
 * Reading an OpenAPI document.
 *
 * Prism already writes OpenAPI; not being able to read one was an asymmetry
 * people notice in the first hour, and importing is much the commoner
 * direction — most teams have a spec long before they have a collection.
 *
 * WHAT IT TAKES AND WHAT IT LEAVES
 *
 * A spec describes what an endpoint *accepts*. A request needs concrete
 * values. Where the spec supplies one — an example, an enum, a default — it is
 * used; where it does not, the parameter arrives as an empty row with the
 * schema's type in the placeholder rather than being invented. A request body
 * is built from the example if there is one, and otherwise from the schema
 * with each field at its type's zero value.
 *
 * Guessing plausible-looking values would produce requests that look ready and
 * are not, which is worse than an obviously empty one.
 */
import { emptyCollection, emptyFlow, emptyRequest, row as kv, uid } from './collection.js'
import { emptyAssertion } from './assert.js'

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Whether a parsed document looks like OpenAPI or Swagger. */
export function isOpenApi(doc) {
  return Boolean(doc && typeof doc === 'object' && (doc.openapi || doc.swagger) && doc.paths && typeof doc.paths === 'object')
}

/**
 * @returns {{ name, flows, environments }}
 */
export function fromOpenApi(doc) {
  const title = String(doc.info?.title ?? 'API')
  const base = baseUrl(doc)
  const byTag = new Map()
  const loose = []

  for (const [route, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== 'object') continue
    // Parameters declared on the path apply to every operation under it.
    const shared = Array.isArray(item.parameters) ? item.parameters : []

    for (const method of METHODS) {
      const op = item[method]
      if (!op || typeof op !== 'object') continue
      const req = operation(doc, route, method, op, shared)
      const tag = Array.isArray(op.tags) && op.tags[0] ? String(op.tags[0]) : ''
      if (tag) {
        if (!byTag.has(tag)) byTag.set(tag, [])
        byTag.get(tag).push(req)
      } else {
        loose.push(req)
      }
    }
  }

  // Tags are the spec's own grouping, so they become flows. Anything untagged
  // gets one of its own rather than being scattered.
  const flows = [...byTag.entries()].map(([tag, requests]) => emptyFlow(tag, requests))
  if (loose.length) flows.push(emptyFlow(flows.length ? 'Untagged' : title, loose))

  const values = { base_url: base }
  return {
    name: title,
    flows,
    environments: [{ id: uid('env'), name: `${title} servers`, values, secrets: [] }]
  }
}

/** The first server, with any templated variables filled from their defaults. */
function baseUrl(doc) {
  const server = Array.isArray(doc.servers) ? doc.servers[0] : null
  if (server?.url) {
    let url = String(server.url)
    for (const [name, spec] of Object.entries(server.variables ?? {})) {
      if (spec?.default !== undefined) url = url.split(`{${name}}`).join(String(spec.default))
    }
    return url.replace(/\/+$/, '')
  }
  // Swagger 2 kept it in pieces.
  if (doc.host) {
    const scheme = (Array.isArray(doc.schemes) ? doc.schemes[0] : 'https') || 'https'
    return `${scheme}://${doc.host}${doc.basePath ?? ''}`.replace(/\/+$/, '')
  }
  return ''
}

function operation(doc, route, method, op, shared) {
  const params = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => deref(doc, p))
  const query = []
  const headers = []
  const pathParams = []

  for (const p of params) {
    if (!p || !p.name) continue
    const value = exampleFor(p)
    const row = kv(String(p.name), value)
    // A parameter the spec marks optional and gives no value for starts
    // unticked: sending an empty one is not the same as not sending it.
    if (!value && p.required !== true) row.on = false
    if (p.in === 'query') query.push(row)
    else if (p.in === 'header') headers.push(row)
    else if (p.in === 'path') pathParams.push({ ...row, on: true })
  }

  const { body, kind, contentType } = requestBody(doc, op)
  if (contentType && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    headers.push(kv('Content-Type', contentType))
  }

  return emptyRequest({
    name: String(op.summary || op.operationId || `${method.toUpperCase()} ${route}`),
    method: method.toUpperCase(),
    // The route keeps its {braces}; Prism's own path rows use :name, so they
    // are converted and offered as rows.
    url: `{{base_url}}${route.replace(/\{([^}]+)\}/g, ':$1')}`,
    query,
    pathParams,
    headers,
    auth: authFor(doc, op),
    bodyKind: kind,
    body,
    assertions: assertionsFor(op)
  })
}

/** `$ref` followed one hop, which covers the shape real specs are written in. */
function deref(doc, node) {
  if (!node || typeof node !== 'object') return node
  const ref = node.$ref
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node
  let out = doc
  for (const part of ref.slice(2).split('/')) {
    out = out?.[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))]
    if (out === undefined) return node
  }
  return out && typeof out === 'object' ? out : node
}

function exampleFor(p) {
  if (p.example !== undefined) return String(p.example)
  if (p.schema?.example !== undefined) return String(p.schema.example)
  if (p.schema?.default !== undefined) return String(p.schema.default)
  if (Array.isArray(p.schema?.enum) && p.schema.enum.length) return String(p.schema.enum[0])
  return ''
}

function requestBody(doc, op) {
  const rb = deref(doc, op.requestBody)
  const content = rb?.content
  if (!content || typeof content !== 'object') {
    // Swagger 2 put the body in with the other parameters.
    const legacy = (Array.isArray(op.parameters) ? op.parameters : []).find((p) => p?.in === 'body')
    if (legacy?.schema) {
      return { body: JSON.stringify(sample(doc, deref(doc, legacy.schema)), null, 2), kind: 'json', contentType: 'application/json' }
    }
    return { body: '', kind: 'none', contentType: '' }
  }

  const type = Object.keys(content).find((t) => /json/i.test(t)) ?? Object.keys(content)[0]
  const media = content[type] ?? {}
  if (media.example !== undefined) {
    return { body: JSON.stringify(media.example, null, 2), kind: 'json', contentType: type }
  }
  const first = media.examples && Object.values(media.examples)[0]
  if (first?.value !== undefined) {
    return { body: JSON.stringify(first.value, null, 2), kind: 'json', contentType: type }
  }
  if (media.schema) {
    return {
      body: JSON.stringify(sample(doc, deref(doc, media.schema)), null, 2),
      kind: /json/i.test(type) ? 'json' : 'raw',
      contentType: type
    }
  }
  return { body: '', kind: 'none', contentType: '' }
}

/**
 * A body from a schema, with every field at its type's zero value.
 *
 * Empty rather than plausible. A generated `"name": "string"` reads as a real
 * value at a glance and is not one; `""` cannot be mistaken for anything.
 */
function sample(doc, schema, depth = 0) {
  const s = deref(doc, schema)
  if (!s || typeof s !== 'object' || depth > 6) return null
  if (s.example !== undefined) return s.example
  if (s.default !== undefined) return s.default
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0]

  const type = Array.isArray(s.type) ? s.type[0] : s.type
  if (type === 'object' || s.properties) {
    const out = {}
    for (const [key, child] of Object.entries(s.properties ?? {})) out[key] = sample(doc, child, depth + 1)
    return out
  }
  if (type === 'array') return s.items ? [sample(doc, s.items, depth + 1)] : []
  if (type === 'integer' || type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'null') return null
  return ''
}

/**
 * Security, as far as it can be known.
 *
 * The scheme is taken from the spec; the credential never is, because a spec
 * does not carry one. It comes out as a variable to fill in.
 */
function authFor(doc, op) {
  const requirement = (Array.isArray(op.security) ? op.security : doc.security) ?? []
  const name = requirement[0] && Object.keys(requirement[0])[0]
  if (!name) return { kind: 'none' }

  const schemes = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {}
  const scheme = deref(doc, schemes[name])
  if (!scheme) return { kind: 'none' }

  const type = String(scheme.type ?? '').toLowerCase()
  if (type === 'http') {
    const s = String(scheme.scheme ?? '').toLowerCase()
    if (s === 'basic') return { kind: 'basic', username: '{{user}}', password: '{{password}}' }
    return { kind: 'bearer', token: '{{auth_token}}' }
  }
  if (type === 'oauth2') return { kind: 'oauth2', token: '{{auth_token}}' }
  if (type === 'apikey') {
    return {
      kind: 'apiKey',
      keyName: String(scheme.name ?? 'X-Api-Key'),
      token: '{{api_key}}',
      keyIn: scheme.in === 'query' ? 'query' : 'header'
    }
  }
  return { kind: 'none' }
}

/**
 * One assertion, from the success the spec declares.
 *
 * Only what the document actually states. Adding a response-time budget the
 * spec never mentioned would be Prism inventing a requirement.
 */
function assertionsFor(op) {
  const codes = Object.keys(op.responses ?? {}).filter((c) => /^[123]\d\d$/.test(c))
  if (!codes.length) return []
  const ok = codes.includes('200') ? '200' : codes.sort()[0]
  return [emptyAssertion({ subject: 'status', op: 'equals', value: ok })]
}

/** The front door, matching readCollection's shape. */
export function readOpenApi(doc, fileName = '') {
  const parsed = fromOpenApi(doc)
  if (!parsed.flows.length) return { ok: false, error: 'That document declares no operations.' }
  // Swagger 2 and OpenAPI 3 both land here, and the import toast should say
  // which one it read rather than calling a swagger.json an OpenAPI document.
  const source = doc?.swagger && !doc?.openapi ? 'swagger' : 'openapi'
  return {
    ok: true,
    source,
    name: parsed.name || fileName,
    collection: emptyCollection(parsed.name, parsed.flows, 'openapi'),
    flows: parsed.flows,
    recorded: [],
    environments: parsed.environments
  }
}
