/**
 * Reading collections.
 *
 * Import is the first thing anyone does with Canvas, and it is the one place
 * that handles files nobody here wrote. Every case below is a file shape that
 * exists in the wild: two generations of Rebind, Postman with the URL in
 * pieces, Postman with tests as a script, and the several ways a file can be
 * wrong.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readCollection,
  fromRebindTest,
  fromRebindCall,
  fromPostman,
  postmanTests,
  countRequests,
  queryRows
} from '../lib/collection.js'

/* ------------------------------------------------------------------ Rebind */

const REBIND_SUITE = {
  id: 's1',
  name: 'Checkout',
  tests: [
    {
      id: 'at-1',
      name: 'POST /api/login',
      method: 'POST',
      url: 'https://shop.test/api/login',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{"email":"a@b.test"}',
      assertions: [
        { id: 'as-1', kind: 'status', expected: '200' },
        { id: 'as-2', kind: 'jsonExists', target: 'token' },
        { id: 'as-3', kind: 'responseTime', expected: '1500' }
      ],
      extract: [{ name: 'auth_token', from: 'body', path: 'token' }]
    }
  ]
}

test('a Rebind suite comes in as a flow', () => {
  const result = readCollection(JSON.stringify(REBIND_SUITE), 'checkout.json')
  assert.equal(result.ok, true)
  assert.equal(result.source, 'rebind-suite')
  assert.equal(result.flows.length, 1)
  assert.equal(result.flows[0].requests.length, 1)
})

test('the old header object becomes rows without losing any', () => {
  const req = fromRebindTest(REBIND_SUITE.tests[0])
  assert.deepEqual(req.headers.map((h) => h.key).sort(), ['Accept', 'Content-Type'])
  assert.equal(req.bodyKind, 'json')
})

test('Rebind assertion kinds map onto subject and operator', () => {
  const req = fromRebindTest(REBIND_SUITE.tests[0])
  assert.deepEqual(
    req.assertions.map((a) => `${a.subject}:${a.op}`),
    ['status:equals', 'json:exists', 'time:lessThan']
  )
  // The path has to survive, or the assertion checks nothing.
  assert.equal(req.assertions[1].path, 'token')
})

test('an extraction becomes a capture, so chaining still works', () => {
  const req = fromRebindTest(REBIND_SUITE.tests[0])
  assert.equal(req.captures.length, 1)
  assert.equal(req.captures[0].name, 'auth_token')
  assert.equal(req.captures[0].path, 'token')
})

test('a request with no pathParams at all does not throw', () => {
  // The exact shape Rebind wrote before requests became editable rows.
  const req = fromRebindTest({ url: 'https://x.test/a', method: 'GET' })
  assert.deepEqual(req.pathParams, [])
  assert.deepEqual(req.query, [])
})

test('a query string still in the URL is lifted into rows', () => {
  const req = fromRebindTest({ url: 'https://x.test/a?page=2&q=a+b' })
  assert.equal(req.url, 'https://x.test/a')
  assert.deepEqual(
    req.query.map((r) => [r.key, r.value]),
    [
      ['page', '2'],
      ['q', 'a b']
    ]
  )
})

/* -------------------------------------------------------- Rebind workspace */

const WORKSPACE = {
  rebind: 'workspace',
  project: 'Northwind',
  calls: [
    {
      id: 'c1',
      method: 'GET',
      url: 'https://shop.test/api/users/42',
      path: 'https://shop.test/api/users/42',
      query: { include: 'orders' },
      requestHeaders: { Accept: 'application/json', host: 'shop.test', 'content-length': '0' },
      status: 200,
      statusText: 'OK',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"id":42}',
      durationMs: 120,
      responseBytes: 9,
      contentType: 'application/json',
      kind: 'json',
      at: 1
    },
    { id: 'c2', method: 'GET', url: 'https://cdn.test/a.png', kind: 'asset', include: false, status: 200 }
  ],
  suites: [REBIND_SUITE],
  environments: [{ id: 'e1', name: 'Development', values: { base_url: 'https://dev.test' } }]
}

test('a workspace brings recordings, flows and environments together', () => {
  const result = readCollection(JSON.stringify(WORKSPACE))
  assert.equal(result.ok, true)
  assert.equal(result.source, 'rebind-workspace')
  assert.equal(result.flows.length, 1)
  assert.equal(result.environments[0].values.base_url, 'https://dev.test')
})

test('a call the operator excluded stays excluded', () => {
  // Not merely filtered from a list — it must not arrive at all, or unticking
  // it in Rebind meant nothing.
  const result = readCollection(JSON.stringify(WORKSPACE))
  assert.equal(result.recorded.length, 1)
  assert.equal(result.recorded[0].url, 'https://shop.test/api/users/42')
})

test('browser-set headers are not replayed', () => {
  const req = fromRebindCall(WORKSPACE.calls[0])
  const keys = req.headers.map((h) => h.key.toLowerCase())
  assert.ok(keys.includes('accept'))
  // A stale content-length or host makes the resent request behave
  // differently from the one being reproduced.
  assert.ok(!keys.includes('host'))
  assert.ok(!keys.includes('content-length'))
})

test('a recorded call keeps the evidence of what it did', () => {
  const req = fromRebindCall(WORKSPACE.calls[0])
  assert.equal(req.recorded.status, 200)
  assert.equal(req.recorded.durationMs, 120)
  assert.equal(req.recorded.responseBody, '{"id":42}')
})

test('a captured credential scheme becomes a variable, never a value', () => {
  const req = fromRebindCall({ ...WORKSPACE.calls[0], authScheme: 'Bearer' })
  assert.equal(req.auth.kind, 'bearer')
  assert.equal(req.auth.token, '{{auth_token}}')
})

/* ---------------------------------------------------------------- Postman */

const POSTMAN = {
  info: { name: 'Shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'Login',
          request: {
            method: 'POST',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            url: { raw: 'https://shop.test/api/login', host: ['https://shop.test'], path: ['api', 'login'] },
            body: { mode: 'raw', raw: '{"email":"a@b.test"}', options: { raw: { language: 'json' } } },
            auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }
          },
          event: [
            {
              listen: 'test',
              script: {
                exec: [
                  'pm.test("ok", () => pm.response.to.have.status(201));',
                  'pm.test("fast", () => pm.expect(pm.response.responseTime).to.be.below(800));'
                ]
              }
            }
          ]
        }
      ]
    },
    {
      name: 'Search',
      request: {
        method: 'GET',
        url: {
          protocol: 'https',
          host: ['shop', 'test'],
          path: ['api', 'search'],
          query: [
            { key: 'q', value: 'iphone' },
            { key: 'page', value: '2', disabled: true }
          ]
        }
      }
    }
  ],
  variable: [{ key: 'token', value: '' }]
}

test('a Postman collection imports its folders as flows', () => {
  const result = readCollection(JSON.stringify(POSTMAN))
  assert.equal(result.ok, true)
  assert.equal(result.source, 'postman')
  assert.equal(countRequests(result), 2)
  assert.ok(result.flows.some((f) => f.name === 'Auth'))
})

test('a request outside any folder is not dropped', () => {
  // It has no folder to belong to, and losing it silently is the worst
  // possible outcome of an import.
  const result = readCollection(JSON.stringify(POSTMAN))
  const all = result.flows.flatMap((f) => f.requests.map((r) => r.name))
  assert.ok(all.includes('Search'))
})

test('a URL stored in pieces is reassembled', () => {
  const parsed = fromPostman(POSTMAN)
  const search = parsed.flows.flatMap((f) => f.requests).find((r) => r.name === 'Search')
  assert.equal(search.url, 'https://shop.test/api/search')
})

test('a disabled query parameter arrives disabled', () => {
  const parsed = fromPostman(POSTMAN)
  const search = parsed.flows.flatMap((f) => f.requests).find((r) => r.name === 'Search')
  assert.deepEqual(
    search.query.map((r) => [r.key, r.on]),
    [
      ['q', true],
      ['page', false]
    ]
  )
})

test('Postman auth maps onto the auth block', () => {
  const parsed = fromPostman(POSTMAN)
  const login = parsed.flows.flatMap((f) => f.requests).find((r) => r.name === 'Login')
  assert.equal(login.auth.kind, 'bearer')
  assert.equal(login.auth.token, '{{token}}')
})

test('assertions are recovered from a Postman test script', () => {
  const parsed = fromPostman(POSTMAN)
  const login = parsed.flows.flatMap((f) => f.requests).find((r) => r.name === 'Login')
  assert.deepEqual(
    login.assertions.map((a) => `${a.subject}:${a.op}:${a.value}`),
    ['status:equals:201', 'time:lessThan:800']
  )
})

test('a script Canvas cannot read yields no assertions rather than invented ones', () => {
  // A collection that imports with two of its five checks is honest. One that
  // imports with five it does not perform is not.
  const found = postmanTests({
    event: [{ listen: 'test', script: { exec: ['const x = pm.response.json(); doSomethingClever(x);'] } }]
  })
  assert.deepEqual(found, [])
})

test('the same check written twice is one assertion', () => {
  const found = postmanTests({
    event: [
      {
        listen: 'test',
        script: { exec: ['pm.response.to.have.status(200);', 'pm.response.to.have.status(200);'] }
      }
    ]
  })
  assert.equal(found.length, 1)
})

/* -------------------------------------------------------------- bad input */

test('nothing thrown for input that is not a collection', () => {
  for (const bad of ['', 'not json', '[]', '{}', 'null', '{"item":[]}']) {
    const result = readCollection(bad, 'thing.json')
    assert.equal(typeof result.ok, 'boolean')
    if (!result.ok) assert.ok(result.error.length > 10, `unhelpful message for ${bad}`)
  }
})

test('a broken file says what was expected', () => {
  const result = readCollection('{oops', 'mine.json')
  assert.equal(result.ok, false)
  assert.match(result.error, /mine\.json/)
  assert.match(result.error, /JSON/)
})

test('an unsupported Postman schema says which version to re-export', () => {
  const result = readCollection(
    JSON.stringify({ info: { name: 'Old', schema: 'https://schema.getpostman.com/json/collection/v1.0.0/collection.json' }, item: [] })
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /v2\.1/)
})

test('a Postman environment is recognised rather than rejected', () => {
  // People reach for the wrong export button. Taking the variables is more
  // useful than telling them off.
  const result = readCollection(JSON.stringify({ name: 'Staging', values: [{ key: 'base_url', value: 'https://s.test' }] }))
  assert.equal(result.ok, true)
  assert.equal(result.environments[0].values.base_url, 'https://s.test')
})

test('a malformed escape in a query string does not throw', () => {
  assert.deepEqual(
    queryRows('bad=%E0%A4%A&ok=1').map((r) => r.key),
    ['bad', 'ok']
  )
})

/* ------------------------------------------------------------ round trip */

/**
 * The bundle Rebind's "Export workspace" writes.
 *
 * Rebind migrates its suites to the current request shape on the way out, so
 * this is the *new* spelling — rows rather than a headers object. The old
 * spelling is covered above; both have to work, because a file exported today
 * and a file exported six months ago are both files someone will open.
 */
const REBIND_BUNDLE = {
  rebind: 'workspace',
  version: 1,
  project: 'Northwind',
  exportedAt: '2026-08-23T10:00:00.000Z',
  calls: [
    {
      id: 'c1',
      at: 1,
      method: 'POST',
      url: 'https://shop.test/api/login',
      path: 'https://shop.test/api/login',
      query: {},
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBody: '{"email":"a@b.test"}',
      status: 200,
      statusText: 'OK',
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: '{"token":"«redacted»"}',
      durationMs: 88,
      requestBytes: 20,
      responseBytes: 24,
      contentType: 'application/json',
      kind: 'json'
    }
  ],
  suites: [
    {
      id: 's1',
      name: 'Checkout',
      tests: [
        {
          id: 'at-1',
          name: 'Get user',
          method: 'GET',
          url: 'https://shop.test/api/users/:id',
          query: [{ id: 'k1', key: 'include', value: 'orders', enabled: true }],
          pathParams: [{ id: 'k2', key: 'id', value: '42' }],
          headers: [{ id: 'k3', key: 'Accept', value: 'application/json' }],
          auth: { kind: 'bearer', token: '{{auth_token}}' },
          bodyKind: 'none',
          assertions: [{ id: 'a1', kind: 'status', expected: '200' }],
          extract: []
        }
      ]
    }
  ],
  environments: [{ id: 'e1', name: 'Development', values: { base_url: 'https://dev.test' } }]
}

test('the workspace Rebind exports is the workspace Canvas opens', () => {
  const result = readCollection(JSON.stringify(REBIND_BUNDLE), 'northwind-workspace.json')
  assert.equal(result.ok, true, result.error)
  assert.equal(result.source, 'rebind-workspace')
  assert.equal(result.name, 'Northwind')
  assert.equal(result.flows.length, 1)
  assert.equal(result.recorded.length, 1)
  assert.equal(result.environments.length, 1)
})

test('rows written by Rebind arrive as rows, not as an empty list', () => {
  // The two spellings differ in exactly this: an object versus an array of
  // {key, value}. Reading only one of them loses every parameter silently.
  const [flow] = readCollection(JSON.stringify(REBIND_BUNDLE)).flows
  const [req] = flow.requests
  assert.deepEqual(req.query.map((r) => [r.key, r.value]), [['include', 'orders']])
  assert.deepEqual(req.pathParams.map((r) => [r.key, r.value]), [['id', '42']])
  assert.deepEqual(req.headers.map((r) => r.key), ['Accept'])
  assert.equal(req.auth.kind, 'bearer')
})

test('a redacted body stays redacted — Canvas does not try to recover it', () => {
  const { recorded } = readCollection(JSON.stringify(REBIND_BUNDLE))
  assert.match(recorded[0].recorded.responseBody, /«redacted»/)
})

test('the round trip survives a bundle with nothing in it', () => {
  // A project where recording was never switched on.
  const result = readCollection(JSON.stringify({ rebind: 'workspace', project: 'Empty', calls: [], suites: [], environments: [] }))
  assert.equal(result.ok, true)
  assert.equal(countRequests(result), 0)
})
