/**
 * GraphQL.
 *
 * One endpoint, one method, and the whole request in the body — which is why
 * a REST-shaped tool handles it badly: the URL says nothing, every node looks
 * identical, and the thing you actually changed is buried in a text field.
 *
 * So GraphQL is a body kind that knows what it contains. The query and the
 * variables are separate fields, the operation name is read out of the query
 * rather than typed twice, and a node can say `query orders` instead of
 * `POST /graphql` forty times over.
 */

/** The wire body is always the same three keys, whatever the editor shows. */
export function buildGraphQL({ query = '', variables = '', operationName = '' } = {}) {
  const body = { query: String(query ?? '') }

  const text = String(variables ?? '').trim()
  if (text) {
    try {
      body.variables = JSON.parse(text)
    } catch {
      // Left as written rather than dropped: the sender will fail with the
      // server's own complaint, which is more use than Prism inventing one.
      body.variables = text
    }
  }

  const name = operationName || operationOf(query)
  if (name) body.operationName = name
  return JSON.stringify(body, null, 2)
}

/**
 * The operation this document runs.
 *
 * Anonymous operations are legal and common, so an empty answer is a normal
 * answer rather than a parse failure.
 */
export function operationOf(query) {
  const text = strip(query)
  const m = /\b(query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(text)
  if (m) return m[2]
  return ''
}

/** query | mutation | subscription — what the node badge should read. */
export function kindOf(query) {
  const text = strip(query).trimStart()
  const m = /^(query|mutation|subscription)\b/.exec(text)
  if (m) return m[1]
  // A bare selection set is a query. `{ orders { id } }` is the shape every
  // tutorial opens with.
  return text.startsWith('{') ? 'query' : ''
}

/** A short label for a node: "mutation placeOrder", or the first field. */
export function label(query) {
  const kind = kindOf(query)
  const name = operationOf(query)
  if (kind && name) return `${kind} ${name}`
  const field = firstField(query)
  if (kind && field) return `${kind} ${field}`
  return field || 'GraphQL'
}

function firstField(query) {
  const text = strip(query)
  const open = text.indexOf('{')
  if (open === -1) return ''
  const m = /([A-Za-z_]\w*)/.exec(text.slice(open + 1))
  return m ? m[1] : ''
}

/** Comments and strings out of the way before any of the above look at it. */
function strip(query) {
  return String(query ?? '')
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/#[^\n]*/g, '')
}

/**
 * Errors, which GraphQL reports inside a 200.
 *
 * This is the one thing every REST-shaped tool gets wrong about GraphQL: a
 * status assertion passes while the response says the query was rejected. A
 * request in this mode gets a check on `errors` as well as on the status.
 */
export function errorsIn(json) {
  const list = json?.errors
  if (!Array.isArray(list) || !list.length) return []
  return list.map((e) => ({
    message: String(e?.message ?? 'Unnamed error'),
    path: Array.isArray(e?.path) ? e.path.join('.') : '',
    line: e?.locations?.[0]?.line ?? 0
  }))
}

/** Whether the response is a GraphQL one at all, error or not. */
export function looksGraphQL(json) {
  return Boolean(json && typeof json === 'object' && ('data' in json || 'errors' in json))
}

/**
 * The introspection query, trimmed to what a field picker needs.
 *
 * The full one is several hundred lines and returns a document large enough to
 * be slow to render; this asks for the shape of the types and stops there.
 */
export const INTROSPECTION = `query PrismIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      name
      kind
      description
      fields(includeDeprecated: false) {
        name
        description
        args { name type { name kind ofType { name kind } } }
        type { name kind ofType { name kind ofType { name kind } } }
      }
    }
  }
}`

/** The introspection reply, flattened into something a picker can list. */
export function readSchema(json) {
  const schema = json?.data?.__schema
  if (!schema) return { ok: false, error: 'That server did not answer an introspection query.' }

  const named = (t) => t?.name ?? named(t?.ofType) ?? ''
  const types = (schema.types ?? []).filter((t) => t?.name && !t.name.startsWith('__'))

  const pick = (name) =>
    (types.find((t) => t.name === name)?.fields ?? []).map((f) => ({
      name: f.name,
      description: f.description ?? '',
      type: named(f.type),
      args: (f.args ?? []).map((a) => ({ name: a.name, type: named(a.type) }))
    }))

  return {
    ok: true,
    queries: pick(schema.queryType?.name ?? 'Query'),
    mutations: pick(schema.mutationType?.name ?? 'Mutation'),
    types: types.filter((t) => t.kind === 'OBJECT').map((t) => t.name)
  }
}

/** A runnable stub for a field somebody clicked in the picker. */
export function stubFor(field, kind = 'query') {
  const args = (field.args ?? []).map((a) => `$${a.name}: ${a.type}`).join(', ')
  const pass = (field.args ?? []).map((a) => `${a.name}: $${a.name}`).join(', ')
  const head = args ? `${kind} ${cap(field.name)}(${args})` : `${kind} ${cap(field.name)}`
  const call = pass ? `${field.name}(${pass})` : field.name
  return `${head} {\n  ${call} {\n    id\n  }\n}`
}

const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1)
