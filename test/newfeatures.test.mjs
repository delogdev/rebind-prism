/**
 * Persistence, OpenAPI, cookies, datasets and dynamic variables.
 *
 * The theme running through all five is the same: each one reads something
 * somebody else wrote — a file saved by an older build, a spec from a vendor,
 * a header from a server, a CSV out of a spreadsheet — so the cases that
 * matter are the malformed ones, and none of them may throw.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { serialise, parse, countIn, missingSecrets, VERSION, HISTORY_KEPT } from '../lib/workspace.js'
import { readCollection, emptyCollection, emptyFlow, emptyRequest, row } from '../lib/collection.js'
import { isOpenApi, fromOpenApi } from '../lib/openapi.js'
import { Jar, parseSetCookie } from '../lib/cookies.js'
import { parseCsv, readDataset, scopeFor, labelFor, unusedColumns } from '../lib/dataset.js'
import { interpolate, variablesUsed, DYNAMIC } from '../lib/request.js'
import { emptyAssertion } from '../lib/assert.js'

/* ============================================================= workspace */

const workspaceState = () => ({
  collections: [
    emptyCollection('Shop', [
      emptyFlow('Auth', [
        emptyRequest({
          name: 'Log in',
          method: 'POST',
          url: '{{base_url}}/login',
          headers: [row('Accept', 'application/json')],
          auth: { kind: 'bearer', token: '{{auth_token}}' },
          bodyKind: 'json',
          body: '{"email":"a@b.test"}',
          assertions: [emptyAssertion({ subject: 'status', op: 'equals', value: '200' })],
          captures: [{ id: 'c1', name: 'auth_token', from: 'body', path: 'token' }]
        })
      ])
    ])
  ],
  environments: [
    { id: 'e1', name: 'Dev', values: { base_url: 'https://dev.test', api_key: 'sk-live-secret' }, secrets: ['api_key'] }
  ],
  envId: 'e1',
  layout: new Map([['r1', { x: 40, y: 80 }]]),
  baselines: new Map()
})

const roundTrip = (state) => {
  const result = parse(JSON.stringify(serialise(state, { name: 'Test' })))
  assert.equal(result.ok, true, result.error)
  return result.workspace
}

test('a workspace survives a round trip', () => {
  const back = roundTrip(workspaceState())
  assert.equal(countIn(back), 1)
  const req = back.collections[0].flows[0].requests[0]
  assert.equal(req.name, 'Log in')
  assert.equal(req.method, 'POST')
  assert.equal(req.auth.kind, 'bearer')
  assert.equal(req.bodyKind, 'json')
  assert.equal(req.assertions.length, 1)
  assert.equal(req.captures[0].name, 'auth_token')
})

test('node positions come back, so a graph somebody arranged stays arranged', () => {
  const back = roundTrip(workspaceState())
  assert.deepEqual(back.layout.get('r1'), { x: 40, y: 80 })
})

test('a secret value is never written to the file', () => {
  // A workspace is committed next to code and passed around. Writing a live
  // key into it is the same leak the export rule exists to prevent.
  const text = JSON.stringify(serialise(workspaceState()))
  assert.ok(!text.includes('sk-live-secret'), 'a secret reached the file')
  // …but the name and its secret status must survive, or opening the file
  // silently downgrades it to an ordinary variable and the next export leaks.
  const back = parse(text).workspace
  assert.ok('api_key' in back.environments[0].values)
  assert.deepEqual(back.environments[0].secrets, ['api_key'])
  assert.deepEqual(missingSecrets(back), ['Dev.api_key'])
})

test('an ordinary value is written', () => {
  const back = roundTrip(workspaceState())
  assert.equal(back.environments[0].values.base_url, 'https://dev.test')
})

test('a file from a newer Prism is refused, and says why', () => {
  const doc = serialise(workspaceState())
  doc.version = VERSION + 1
  const result = parse(JSON.stringify(doc))
  assert.equal(result.ok, false)
  assert.match(result.error, /newer Prism/)
})

test('another tool’s JSON is refused with a pointer to Import', () => {
  const result = parse(JSON.stringify({ info: { name: 'Postman thing' }, item: [] }))
  assert.equal(result.ok, false)
  assert.match(result.error, /Import/)
})

test('nothing in a malformed workspace throws', () => {
  for (const junk of ['{oops', '[]', 'null', '5', JSON.stringify({ prism: 'prism.workspace', version: 1 })]) {
    assert.doesNotThrow(() => parse(junk))
  }
  // A file that is the right format but empty must open as an empty workspace,
  // not as an error.
  const empty = parse(JSON.stringify({ prism: 'prism.workspace', version: 1 }))
  assert.equal(empty.ok, true)
  assert.equal(countIn(empty.workspace), 0)
})

test('a request stripped of its arrays still loads', () => {
  const doc = serialise(workspaceState())
  doc.collections[0].flows[0].requests[0] = { name: 'Bare' }
  const back = parse(JSON.stringify(doc)).workspace
  const req = back.collections[0].flows[0].requests[0]
  assert.deepEqual(req.query, [])
  assert.deepEqual(req.assertions, [])
  assert.equal(req.auth.kind, 'none')
})

test('a pointer to an environment that is gone falls back', () => {
  const doc = serialise(workspaceState())
  doc.activeEnvironment = 'deleted'
  assert.equal(parse(JSON.stringify(doc)).workspace.envId, 'e1')
})

/* =============================================================== openapi */

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Shop' },
  servers: [{ url: 'https://{region}.shop.test/v1', variables: { region: { default: 'eu' } } }],
  components: {
    securitySchemes: { key: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
    schemas: { User: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } } }
  },
  security: [{ key: [] }],
  paths: {
    '/users/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', example: 42 } }],
      get: {
        tags: ['Users'],
        summary: 'Get a user',
        parameters: [
          { name: 'include', in: 'query', schema: { type: 'string', enum: ['orders', 'addresses'] } },
          { name: 'verbose', in: 'query', schema: { type: 'boolean' } }
        ],
        responses: { 200: {}, 404: {} }
      },
      put: {
        tags: ['Users'],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
        responses: { 204: {} }
      }
    },
    '/health': { get: { responses: { 200: {} } } }
  }
}

test('an OpenAPI document is recognised', () => {
  assert.equal(isOpenApi(SPEC), true)
  assert.equal(isOpenApi({ info: {}, item: [] }), false)
  assert.equal(readCollection(JSON.stringify(SPEC)).source, 'openapi')
})

test('tags become flows and untagged operations get their own', () => {
  const { flows } = fromOpenApi(SPEC)
  assert.deepEqual(flows.map((f) => `${f.name}:${f.requests.length}`), ['Users:2', 'Untagged:1'])
})

test('a templated server URL is filled from its defaults', () => {
  assert.equal(fromOpenApi(SPEC).environments[0].values.base_url, 'https://eu.shop.test/v1')
})

test('path placeholders become path rows', () => {
  const get = fromOpenApi(SPEC).flows[0].requests[0]
  assert.equal(get.url, '{{base_url}}/users/:id')
  assert.deepEqual(get.pathParams.map((p) => [p.key, p.value]), [['id', '42']])
})

test('a parameter with no value the spec supplies arrives unticked', () => {
  // Sending an empty parameter is not the same as not sending it, and the
  // spec did not say what to send.
  const get = fromOpenApi(SPEC).flows[0].requests[0]
  assert.deepEqual(
    get.query.map((q) => [q.key, q.value, q.on]),
    [
      ['include', 'orders', true],
      ['verbose', '', false]
    ]
  )
})

test('a body is built from the schema at zero values, not invented ones', () => {
  // "name": "string" reads as a real value at a glance and is not one.
  const put = fromOpenApi(SPEC).flows[0].requests[1]
  assert.deepEqual(JSON.parse(put.body), { name: '', age: 0, tags: [''] })
  assert.equal(put.bodyKind, 'json')
})

test('the security scheme comes across but never a credential', () => {
  const get = fromOpenApi(SPEC).flows[0].requests[0]
  assert.equal(get.auth.kind, 'apiKey')
  assert.equal(get.auth.keyName, 'X-Api-Key')
  assert.equal(get.auth.token, '{{api_key}}')
})

test('one assertion, from the success the spec declares', () => {
  const get = fromOpenApi(SPEC).flows[0].requests[0]
  assert.equal(get.assertions.length, 1, 'a time budget the spec never mentioned would be invented')
  assert.equal(get.assertions[0].value, '200')
})

test('a Swagger 2 document works too', () => {
  const v2 = {
    swagger: '2.0',
    info: { title: 'Old' },
    host: 'old.test',
    basePath: '/api',
    schemes: ['https'],
    paths: { '/ping': { get: { responses: { 200: {} } } } }
  }
  assert.equal(isOpenApi(v2), true)
  assert.equal(fromOpenApi(v2).environments[0].values.base_url, 'https://old.test/api')
})

test('a spec with no operations does not import as an empty collection', () => {
  const result = readCollection(JSON.stringify({ openapi: '3.0.0', info: { title: 'X' }, paths: {} }))
  assert.equal(result.ok, false)
  assert.match(result.error, /no operations/)
})

/* =============================================================== cookies */

test('a Set-Cookie is parsed with its attributes', () => {
  const c = parseSetCookie('sid=abc123; Path=/api; Secure; HttpOnly; Max-Age=3600', 'https://shop.test/login')
  assert.equal(c.name, 'sid')
  assert.equal(c.value, 'abc123')
  assert.equal(c.path, '/api')
  assert.equal(c.secure, true)
  assert.equal(c.httpOnly, true)
  assert.ok(c.expires > Date.now())
})

test('a cookie with no domain belongs to that host alone', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'sid=1' }, 'https://shop.test/')
  assert.equal(jar.header('https://shop.test/x'), 'sid=1')
  assert.equal(jar.header('https://api.shop.test/x'), '', 'a host-only cookie leaked to a subdomain')
})

test('a cookie that names a domain covers its subdomains', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'sid=1; Domain=.shop.test' }, 'https://shop.test/')
  assert.equal(jar.header('https://api.shop.test/x'), 'sid=1')
  assert.equal(jar.header('https://shop.test.evil.com/x'), '', 'a suffix match let another domain read it')
})

test('a Secure cookie is not sent over plain http', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'sid=1; Secure' }, 'https://shop.test/')
  assert.equal(jar.header('http://shop.test/x'), '')
})

test('path scoping is respected', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'deep=1; Path=/api/v2' }, 'https://shop.test/')
  assert.equal(jar.header('https://shop.test/api/v2/users'), 'deep=1')
  assert.equal(jar.header('https://shop.test/api/v20'), '', '/api/v20 is not under /api/v2')
  assert.equal(jar.header('https://shop.test/other'), '')
})

test('an expiry in the past deletes the cookie, which is how logout works', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'sid=1' }, 'https://shop.test/')
  assert.equal(jar.size, 1)
  jar.store({ 'set-cookie': 'sid=; Max-Age=0' }, 'https://shop.test/')
  assert.equal(jar.size, 0)
})

test('several cookies in one joined header are separated correctly', () => {
  // Node joins repeated headers with ", ", and an Expires date contains a
  // comma — splitting naively loses cookies or invents them.
  const jar = new Jar()
  jar.store(
    { 'set-cookie': 'a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT, b=2; Path=/' },
    'https://shop.test/'
  )
  assert.deepEqual(jar.all().map((c) => c.name).sort(), ['a', 'b'])
})

test('a later Set-Cookie replaces the same cookie rather than adding one', () => {
  const jar = new Jar()
  jar.store({ 'set-cookie': 'sid=old' }, 'https://shop.test/')
  jar.store({ 'set-cookie': 'sid=new' }, 'https://shop.test/')
  assert.equal(jar.header('https://shop.test/'), 'sid=new')
})

test('rubbish in the header does not throw', () => {
  const jar = new Jar()
  for (const junk of ['', '   ', '=novalue', 'noequals', ';;;']) {
    assert.doesNotThrow(() => jar.store({ 'set-cookie': junk }, 'https://shop.test/'))
  }
  assert.doesNotThrow(() => jar.store({ 'set-cookie': 'a=1' }, 'not a url'))
  assert.equal(jar.header('also not a url'), '')
})

/* ============================================================== datasets */

test('CSV with quoted fields, commas and newlines', () => {
  const rows = parseCsv('name,note\n"Smith, Ada","said ""hello""\nthen left"\nGrace,plain')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[1], ['Smith, Ada', 'said "hello"\nthen left'])
  assert.deepEqual(rows[2], ['Grace', 'plain'])
})

test('a CSV dataset takes its columns from the header', () => {
  const { ok, dataset } = readDataset('email,password\na@b.test,secret\nc@d.test,other\n', 'cases.csv')
  assert.equal(ok, true)
  assert.deepEqual(dataset.columns, ['email', 'password'])
  assert.equal(dataset.rows.length, 2)
  assert.equal(dataset.rows[0].email, 'a@b.test')
})

test('a JSON array of objects works, and so does an array of arrays', () => {
  const objects = readDataset('[{"a":1,"b":"x"},{"a":2,"b":"y"}]', 'd.json')
  assert.deepEqual(objects.dataset.columns, ['a', 'b'])
  assert.equal(objects.dataset.rows[1].a, '2')

  const arrays = readDataset('[["a","b"],[1,"x"]]', 'd.json')
  assert.deepEqual(arrays.dataset.columns, ['a', 'b'])
  assert.equal(arrays.dataset.rows[0].b, 'x')
})

test('a bad dataset says what was wrong rather than throwing', () => {
  for (const [text, pattern] of [
    ['', /empty/],
    ['[{oops', /will not parse|JSON/],
    ['[]', /no rows/],
    ['just one line', /header row/]
  ]) {
    const result = readDataset(text, 'd.csv')
    assert.equal(result.ok, false, `${text} should not have parsed`)
    assert.match(result.error, pattern)
  }
})

test('a row shadows the environment for its own iteration only', () => {
  const base = { base_url: 'https://x.test', email: 'default@x.test' }
  const scope = scopeFor(base, { email: 'row@x.test' })
  assert.equal(scope.email, 'row@x.test')
  assert.equal(scope.base_url, 'https://x.test')
  assert.equal(base.email, 'default@x.test', 'the environment itself was modified')
})

test('an iteration is labelled by whichever column reads like a name', () => {
  assert.equal(labelFor({ case: 'empty cart', sku: 'X' }, 0), 'empty cart')
  assert.equal(labelFor({ sku: 'NW-1042' }, 3), 'NW-1042')
  assert.equal(labelFor({}, 3), 'Row 4')
})

test('columns the request never mentions are reported', () => {
  // Usually a stale export or a typo, and cheaper to say than to watch every
  // row produce the same result.
  const dataset = { columns: ['email', 'password', 'notes'], rows: [] }
  assert.deepEqual(unusedColumns(dataset, ['email', 'password']), ['notes'])
})

/* ====================================================== dynamic variables */

test('a built-in variable is evaluated per occurrence', () => {
  // Two {{$uuid}} in one body should be two ids; writing it twice is the
  // whole reason to want that.
  const [a, b] = interpolate('{{$uuid}} {{$uuid}}', {}).split(' ')
  assert.notEqual(a, b)
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('every built-in produces something', () => {
  for (const [name, fn] of Object.entries(DYNAMIC)) {
    assert.ok(String(fn()).length > 0, `${name} produced nothing`)
  }
})

test('an environment value still wins for an ordinary name', () => {
  assert.equal(interpolate('{{who}}', { who: 'Ada' }), 'Ada')
})

test('an unknown name is left exactly as written', () => {
  assert.equal(interpolate('{{nope}}', {}), '{{nope}}')
  assert.equal(interpolate('{{$notReal}}', {}), '{{$notReal}}')
})

test('the built-ins are not listed as things the user must provide', () => {
  // Otherwise every node that generates an id shows a red unmet port.
  const req = emptyRequest({ url: '{{base_url}}/x/{{$uuid}}', body: '{"at":"{{$timestamp}}"}' })
  assert.deepEqual(variablesUsed(req), ['base_url'])
})

/* --------------------------------------------- history across a restart */

test('runs survive being written and read back', () => {
  const state = {
    collections: [], environments: [], layout: new Map(), baselines: new Map(),
    history: [{ requestId: 'r1', name: 'Orders', method: 'GET', status: 200, ms: 42, at: 1700, env: 'Dev', failed: 0 }]
  }
  const back = parse(JSON.stringify(serialise(state, { name: 'W' })), 'w.json')
  assert.equal(back.ok, true)
  assert.equal(back.workspace.history.length, 1)
  assert.equal(back.workspace.history[0].ms, 42)
  assert.equal(back.workspace.history[0].name, 'Orders')
})

test('a run carries no response body or headers to disk', () => {
  // A stored run is measurements only. Anything else could carry a token out
  // of the session and onto the disk, which is the one thing the secret rule
  // exists to prevent.
  const state = {
    collections: [], environments: [], layout: new Map(), baselines: new Map(),
    history: [{
      requestId: 'r1', name: 'Login', method: 'POST', status: 200, ms: 5, at: 1, env: 'Dev', failed: 0,
      body: '{"token":"live-secret-value"}',
      headers: { 'set-cookie': 'sid=abc' }
    }]
  }
  const text = JSON.stringify(serialise(state, { name: 'W' }))
  assert.ok(!text.includes('live-secret-value'))
  assert.ok(!text.includes('set-cookie'))
})

test('an enormous history is trimmed on the way out', () => {
  const many = Array.from({ length: 900 }, (_, i) => ({ requestId: 'r1', name: 'X', method: 'GET', status: 200, ms: i, at: i, env: 'D', failed: 0 }))
  const out = serialise({ collections: [], environments: [], layout: new Map(), baselines: new Map(), history: many }, {})
  assert.equal(out.history.length, HISTORY_KEPT)
})
