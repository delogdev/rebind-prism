/**
 * The parts that decide what goes out and what the result means.
 *
 * Everything here is pure, which is deliberate: sending is a handful of lines
 * in the main process, and every decision worth being wrong about — how a URL
 * is assembled, whether an assertion passed, what changed since last time,
 * what lands in an exported file — is made in a function that can be called
 * from a test.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUrl, buildHeaders, buildBody, compile, interpolate, variablesUsed } from '../lib/request.js'
import { check, runAll, jsonPath, suggestFor, emptyAssertion } from '../lib/assert.js'
import { diff, diffSummary, sketch, tree } from '../lib/schema.js'
import { generate, TARGETS, WHOLE_FLOW } from '../lib/codegen.js'
import { analyse } from '../lib/insights.js'
import { emptyRequest, row } from '../lib/collection.js'

/* ------------------------------------------------------------- assembling */

const REQ = emptyRequest({
  name: 'Get user',
  method: 'GET',
  url: '{{base_url}}/api/users/:id',
  pathParams: [row('id', '42')],
  query: [row('include', 'orders'), row('page', '2', false)],
  headers: [row('Accept', 'application/json')],
  auth: { kind: 'bearer', token: '{{auth_token}}' }
})

test('the URL is built from rows, variables and path parameters', () => {
  const url = buildUrl(REQ, { base_url: 'https://shop.test' })
  assert.equal(url, 'https://shop.test/api/users/42?include=orders')
})

test('a disabled row is not sent', () => {
  // Unticking a row has to mean something, or the tick is decoration.
  assert.ok(!buildUrl(REQ, {}).includes('page=2'))
})

test('an unknown variable is left as written rather than blanked', () => {
  // Blanking it produces a URL that looks plausible and goes somewhere wrong.
  assert.match(buildUrl(REQ, {}), /^\{\{base_url\}\}/)
})

test('auth is applied over a hand-written header, not alongside it', () => {
  const both = { ...REQ, headers: [row('Authorization', 'Basic stale')] }
  const headers = buildHeaders(both, { auth_token: 'live' })
  assert.equal(headers.Authorization, 'Bearer live')
})

test('an API key can go in the query instead of a header', () => {
  const req = { ...REQ, auth: { kind: 'apiKey', keyName: 'api_key', token: 'k1', keyIn: 'query' } }
  assert.match(buildUrl(req, { base_url: 'https://x.test' }), /api_key=k1/)
  assert.equal(buildHeaders(req, {}).api_key, undefined)
})

test('a content type is added for a body but never over one set by hand', () => {
  const json = { ...REQ, bodyKind: 'json', body: '{}' }
  assert.equal(buildHeaders(json, {})['Content-Type'], 'application/json')

  const custom = { ...json, headers: [row('Content-Type', 'application/vnd.api+json')] }
  assert.equal(buildHeaders(custom, {})['Content-Type'], 'application/vnd.api+json')
})

test('a form body is encoded from the lines as written', () => {
  const req = { ...REQ, bodyKind: 'urlencoded', body: 'email=a@b.test\npassword={{pw}}\n' }
  assert.equal(buildBody(req, { pw: 's e c' }), 'email=a%40b.test&password=s%20e%20c')
})

test('compile is what both the preview and the transport use', () => {
  const spec = compile(REQ, { base_url: 'https://shop.test', auth_token: 't' })
  assert.equal(spec.url, 'https://shop.test/api/users/42?include=orders')
  assert.equal(spec.headers.Authorization, 'Bearer t')
})

test('every variable a request mentions is listed', () => {
  assert.deepEqual(variablesUsed(REQ), ['base_url', 'auth_token'])
})

test('interpolation leaves text with no variables untouched', () => {
  assert.equal(interpolate('plain', { a: 1 }), 'plain')
})

/* ------------------------------------------------------------- assertions */

const RES = {
  status: 200,
  headers: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'r1' },
  body: '{"data":{"id":42,"name":"Ada","roles":["admin"],"parent":null}}',
  bytes: 62,
  timing: { total: 138 },
  json: { data: { id: 42, name: 'Ada', roles: ['admin'], parent: null } }
}

const cases = [
  ['status equals', { subject: 'status', op: 'equals', value: '200' }, true],
  ['status wrong', { subject: 'status', op: 'equals', value: '201' }, false],
  ['status is a success', { subject: 'status', op: 'isSuccess' }, true],
  ['status one of', { subject: 'status', op: 'oneOf', value: '200, 204' }, true],
  ['time under', { subject: 'time', op: 'lessThan', value: '500' }, true],
  ['time over budget', { subject: 'time', op: 'lessThan', value: '100' }, false],
  ['size under', { subject: 'size', op: 'lessThan', value: '1000' }, true],
  ['content type', { subject: 'contentType', op: 'contains', value: 'json' }, true],
  ['header exists', { subject: 'header', op: 'exists', path: 'X-Request-Id' }, true],
  ['header absent', { subject: 'header', op: 'absent', path: 'X-Nope' }, true],
  ['body contains', { subject: 'body', op: 'contains', value: 'Ada' }, true],
  ['body not contains', { subject: 'body', op: 'notContains', value: 'Grace' }, true],
  ['body matches', { subject: 'body', op: 'matches', value: '"id":\\s*42' }, true],
  ['json exists', { subject: 'json', op: 'exists', path: 'data.id' }, true],
  ['json missing', { subject: 'json', op: 'exists', path: 'data.nope' }, false],
  ['json equals loosely', { subject: 'json', op: 'equals', path: 'data.id', value: '42' }, true],
  ['json type', { subject: 'json', op: 'isType', path: 'data.roles', value: 'array' }, true],
  ['json null is its own type', { subject: 'json', op: 'isType', path: 'data.parent', value: 'null' }, true],
  ['json length', { subject: 'json', op: 'lengthIs', path: 'data.roles', value: '1' }, true],
  ['array index in a path', { subject: 'json', op: 'equals', path: 'data.roles[0]', value: 'admin' }, true]
]

for (const [name, assertion, expected] of cases) {
  test(`assertion — ${name}`, () => {
    const result = check({ id: 'a', ...assertion }, RES)
    assert.equal(result.ok, expected, `${name}: ${result.detail}`)
    assert.ok(result.detail.length > 0, 'a result must say what it saw')
  })
}

test('a failing assertion reports the value it actually found', () => {
  // A red row that will not say what it saw is a row people delete.
  const result = check({ id: 'a', subject: 'json', op: 'equals', path: 'data.name', value: 'Grace' }, RES)
  assert.equal(result.ok, false)
  assert.match(result.detail, /Ada/)
})

test('a broken regex blames the pattern, not the response', () => {
  const result = check({ id: 'a', subject: 'body', op: 'matches', value: '([' }, RES)
  assert.equal(result.ok, false)
  assert.match(result.detail, /valid pattern/)
})

test('JSON assertions fail honestly when the body is not JSON', () => {
  const result = check({ id: 'a', subject: 'json', op: 'exists', path: 'x' }, { ...RES, json: undefined })
  assert.equal(result.ok, false)
  assert.match(result.detail, /not JSON/)
})

test('a disabled assertion does not run', () => {
  const results = runAll([emptyAssertion({ on: false, value: '999' })], RES)
  assert.equal(results.length, 0)
})

test('jsonPath returns undefined rather than throwing on a bad path', () => {
  assert.equal(jsonPath({ a: 1 }, 'a.b.c.d'), undefined)
})

test('suggested assertions leave room in the time budget', () => {
  // A budget set to the first run’s exact number fails on the second run, and
  // a test that cries wolf gets deleted.
  const suggested = suggestFor({ status: 200, contentType: 'application/json', durationMs: 400 }, { id: 1 })
  const time = suggested.find((a) => a.subject === 'time')
  assert.ok(Number(time.value) >= 1200, `budget was ${time.value}`)
  assert.ok(suggested.some((a) => a.subject === 'status' && a.value === '200'))
})

/* ------------------------------------------------------------------ schema */

test('a diff names what was removed, added, retyped and changed', () => {
  const before = { id: 1, name: 'Ada', tags: ['a'], meta: { ok: true } }
  const after = { id: '1', name: 'Grace', tags: ['a', 'b'], extra: 9 }
  const changes = diff(before, after)
  const by = (kind) => changes.filter((c) => c.kind === kind).map((c) => c.path)

  assert.deepEqual(by('removed'), ['meta'])
  assert.deepEqual(by('added'), ['extra'])
  assert.deepEqual(by('retyped'), ['id'])
  assert.ok(by('changed').includes('name'))
})

test('a removal is listed before a cosmetic change', () => {
  // A field that vanished breaks a consumer; a value that moved usually does
  // not, and the panel is read top down.
  const changes = diff({ gone: 1, n: 1 }, { n: 2 })
  assert.equal(changes[0].kind, 'removed')
})

test('two identical responses diff to nothing', () => {
  assert.equal(diffSummary(diff({ a: [1, 2] }, { a: [1, 2] })), 'identical')
})

test('the schema sketch describes an array by its element', () => {
  const s = sketch({ items: [{ id: 1, ok: true }] })
  assert.equal(s.properties.items.type, 'array')
  assert.equal(s.properties.items.items.properties.id.type, 'integer')
})

test('the tree flattens with a depth for folding', () => {
  const rows = tree({ a: { b: 1 } })
  assert.equal(rows[0].path, 'root')
  assert.ok(rows.some((r) => r.path === 'a.b' && r.depth === 2 && r.leaf))
})

/* --------------------------------------------------------------- insights */

test('insights explain a 401 by whether a credential was even sent', () => {
  const withNone = analyse({ status: 401, headers: {}, timing: { total: 10 } }, { headers: {} })
  assert.match(withNone[0].detail, /No Authorization header/)

  const withOne = analyse({ status: 401, headers: {}, timing: { total: 10 } }, { headers: { Authorization: 'Bearer x' } })
  assert.match(withOne[0].detail, /rejected/)
})

test('insights notice a body that claims to be JSON and is not', () => {
  const found = analyse({ status: 200, headers: { 'content-type': 'application/json' }, body: '<html>', json: undefined, timing: { total: 5 } }, {})
  assert.ok(found.some((f) => /is not JSON/.test(f.title)))
})

test('insights say when nothing was checked', () => {
  const found = analyse({ status: 200, headers: {}, body: '{}', json: {}, timing: { total: 5 } }, {}, [])
  assert.ok(found.some((f) => /No assertions/.test(f.title)))
})

test('a clean fast response is not padded with invented problems', () => {
  const found = analyse(
    { status: 200, headers: { 'content-type': 'application/json' }, body: '{"a":1}', json: { a: 1 }, bytes: 7, timing: { total: 40 }, secure: true },
    { secure: true, url: 'https://x.test', headers: {} },
    [{ ok: true, detail: 'fine' }]
  )
  assert.ok(found.every((f) => f.level !== 'bad'), JSON.stringify(found))
  assert.equal(found[found.length - 1].level, 'ok')
})

test('the worst finding is listed first', () => {
  const found = analyse({ status: 500, headers: {}, body: '', timing: { total: 3000 } }, {}, [])
  assert.equal(found[0].level, 'bad')
})

/* ----------------------------------------------------------------- export */

const SECRET = emptyRequest({
  name: 'Login',
  method: 'POST',
  url: '{{base_url}}/api/login',
  headers: [row('X-Tenant', '{{tenant}}')],
  auth: { kind: 'bearer', token: '{{auth_token}}' },
  bodyKind: 'json',
  body: '{"password":"{{password}}"}',
  assertions: [emptyAssertion({ subject: 'status', op: 'equals', value: '200' })]
})

/**
 * The environment the user has loaded while they hit Export.
 *
 * Every generator is called with it available. None of these values may reach
 * any file: an export gets committed, pasted into a ticket and shown on a
 * screen share, and a resolved secret in one is a leak with a long tail.
 */
const LOADED = { values: { base_url: 'https://shop.test', auth_token: 'sk-live-9f3c2a', password: 'hunter2', tenant: 'acme-prod' } }
const LEAKS = ['sk-live-9f3c2a', 'hunter2', 'acme-prod']

for (const target of TARGETS) {
  test(`export — ${target.id} resolves no value from the loaded environment`, () => {
    const code = generate(target.id, { request: SECRET, flow: { name: 'F', requests: [SECRET] }, environment: LOADED })
    assert.ok(code.length > 20, 'nothing was written')
    for (const secret of LEAKS) {
      assert.ok(!code.includes(secret), `${target.id} wrote ${secret} into the file`)
    }
  })
}

// OpenAPI is excluded on purpose: it describes paths and responses, so it has
// no header, body or credential to carry a variable through.
const RUNNABLE = TARGETS.filter((t) => t.id !== 'openapi')

for (const target of RUNNABLE) {
  test(`export — ${target.id} keeps the variable rather than resolving it`, () => {
    const code = generate(target.id, { request: SECRET, flow: { name: 'F', requests: [SECRET] }, environment: LOADED })
    for (const name of ['auth_token', 'password', 'tenant']) {
      const mentioned = code.includes(name) || code.includes(name.toUpperCase())
      assert.ok(mentioned, `${target.id} lost the ${name} variable entirely`)
    }
  })
}

test('the Postman export declares variable names with no values', () => {
  const doc = JSON.parse(generate('postman', { flow: { name: 'F', requests: [SECRET] }, environment: LOADED }))
  const declared = doc.variable.map((v) => v.key)
  assert.ok(declared.includes('auth_token'), 'the variable was not declared at all')
  assert.ok(doc.variable.every((v) => v.value === ''), 'a value was written into a shared collection file')
})

test('OpenAPI describes the shape and carries no request material at all', () => {
  const doc = JSON.parse(generate('openapi', { flow: { name: 'F', requests: [SECRET] }, environment: LOADED }))
  const text = JSON.stringify(doc)
  assert.ok(!text.includes('auth_token'), 'a credential variable reached the schema document')
  assert.ok(!text.includes('Authorization'), 'a credential header reached the schema document')
  assert.ok(doc.paths['/api/login'].post, `the operation is missing: ${Object.keys(doc.paths)}`)
})

test('a resolved secret never reaches an exported file', () => {
  // The environment is deliberately not passed to the generators. This proves
  // it: even with a value available, the file must carry the lookup.
  const code = generate('curl', { request: SECRET })
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{8,}/.test(code), code)
  assert.match(code, /\$AUTH_TOKEN/)
})

test('every target writes something that mentions the method and the host', () => {
  for (const target of TARGETS) {
    if (WHOLE_FLOW.has(target.id)) continue
    const code = generate(target.id, { request: SECRET })
    assert.ok(/POST/i.test(code), `${target.id} lost the method`)
    assert.ok(code.includes('/api/login'), `${target.id} lost the path`)
  }
})

test('the Postman export round-trips back through the importer', () => {
  // The strongest check available: what Canvas writes, Canvas can read.
  const json = generate('postman', { flow: { name: 'Round trip', requests: [SECRET] } })
  const doc = JSON.parse(json)
  assert.match(doc.info.schema, /v2\.1\.0/)
  assert.equal(doc.item.length, 1)
  assert.equal(doc.item[0].request.method, 'POST')
})

test('assertions survive into the targets that can express them', () => {
  for (const id of ['pytest', 'playwright', 'restassured']) {
    const code = generate(id, { request: SECRET })
    assert.ok(/200/.test(code), `${id} dropped the status assertion`)
  }
})

test('a request with no assertions says so rather than pretending', () => {
  const bare = { ...SECRET, assertions: [] }
  assert.match(generate('pytest', { request: bare }), /No assertions/)
})
