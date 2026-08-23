/**
 * Reading a HAR file.
 *
 * The fixture is shaped like a real capture rather than a tidy one: fonts and
 * scripts mixed in with the API calls, the same poll several times, and a 401
 * before the login that fixed it. Those are the three things that make a HAR
 * import useless if they are not handled.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHar, isHar } from '../lib/har.js'

const entry = (over = {}) => ({
  time: 42,
  request: { method: 'GET', url: 'https://api.shop.test/api/orders', headers: [], ...(over.request ?? {}) },
  response: { status: 200, content: { mimeType: 'application/json', text: '{"id":7,"total":3}', size: 18 }, ...(over.response ?? {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'request' && k !== 'response'))
})

const har = (entries, pages) => ({ log: { version: '1.2', pages, entries } })
const names = (r) => r.flows.flatMap((f) => f.requests.map((x) => x.name))

/* ------------------------------------------------------------ the shape */

test('it knows a HAR when it sees one', () => {
  assert.equal(isHar(har([])), true)
  assert.equal(isHar({ openapi: '3.0.0', paths: {} }), false)
  assert.equal(isHar(null), false)
})

test('something that is not a HAR at all', () => {
  const r = fromHar({ hello: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /not a HAR/)
})

test('a HAR with nothing http in it', () => {
  const r = fromHar(har([{ request: { url: 'data:image/png;base64,AAA' } }]))
  assert.equal(r.ok, false)
})

/* ---------------------------------------------------------- the filtering */

test('page assets are left behind', () => {
  const r = fromHar(har([
    entry(),
    entry({ request: { url: 'https://api.shop.test/app.js' }, response: { status: 200, content: { mimeType: 'application/javascript' } } }),
    entry({ request: { url: 'https://api.shop.test/logo.svg' }, response: { status: 200, content: { mimeType: 'image/svg+xml' } } }),
    entry({ request: { url: 'https://api.shop.test/font.woff2' }, response: { status: 200, content: { mimeType: 'font/woff2' } } })
  ]))
  assert.equal(r.kept, 1)
  assert.equal(r.read, 4, 'it still says how many it looked at')
})

test('a POST is kept even when the answer is HTML', () => {
  // A form submission is exactly the sort of thing people came to test.
  const r = fromHar(har([
    entry({ request: { method: 'POST', url: 'https://api.shop.test/checkout' }, response: { status: 302, content: { mimeType: 'text/html' } } })
  ]))
  assert.equal(r.ok, true)
  assert.deepEqual(names(r), ['/checkout'])
})

test('a HAR of nothing but assets says so plainly', () => {
  const r = fromHar(har([
    entry({ request: { url: 'https://shop.test/a.css' }, response: { status: 200, content: { mimeType: 'text/css' } } })
  ]))
  assert.equal(r.ok, false)
  assert.match(r.error, /page assets/)
})

test('keepAssets takes them anyway, for when that is the point', () => {
  const r = fromHar(har([entry({ request: { url: 'https://shop.test/a.css' }, response: { status: 200, content: { mimeType: 'text/css' } } })]), { keepAssets: true })
  assert.equal(r.ok, true)
})

/* --------------------------------------------------------- the duplicates */

test('the same call forty times is one request', () => {
  const many = Array.from({ length: 40 }, () => entry())
  const r = fromHar(har(many))
  assert.equal(r.kept, 1)
  assert.equal(r.flows[0].requests[0].recorded.times, 40, 'and it remembers how many')
})

test('a different query string is still the same request', () => {
  const r = fromHar(har([
    entry({ request: { url: 'https://api.shop.test/api/orders?page=1' } }),
    entry({ request: { url: 'https://api.shop.test/api/orders?page=2' } })
  ]))
  assert.equal(r.kept, 1)
})

test('a different method is a different request', () => {
  const r = fromHar(har([entry(), entry({ request: { method: 'POST', url: 'https://api.shop.test/api/orders' } })]))
  assert.equal(r.kept, 2)
})

test('the one that worked wins over the 401 that came first', () => {
  const r = fromHar(har([
    entry({ response: { status: 401, content: { mimeType: 'application/json', text: '{"error":"no"}' } } }),
    entry({ response: { status: 200, content: { mimeType: 'application/json', text: '{"id":7}' } } })
  ]))
  assert.equal(r.flows[0].requests[0].recorded.status, 200)
})

/* ------------------------------------------------------------ the rewrite */

test('the shared origin becomes a variable', () => {
  const r = fromHar(har([entry(), entry({ request: { url: 'https://api.shop.test/api/users' } })]))
  assert.ok(names(r).length === 2)
  for (const req of r.flows.flatMap((f) => f.requests)) {
    assert.match(req.url, /^\{\{base_url\}\}/, `${req.url} should start from the variable`)
  }
  assert.equal(r.environments[0].values.base_url, 'https://api.shop.test')
})

test('a third-party call keeps its own address', () => {
  const r = fromHar(har([
    entry(),
    entry({ request: { url: 'https://api.shop.test/api/users' } }),
    entry({ request: { url: 'https://telemetry.other.test/collect', method: 'POST' } })
  ]))
  const odd = r.flows.flatMap((f) => f.requests).find((x) => /collect/.test(x.name))
  assert.equal(odd.url, 'https://telemetry.other.test/collect')
})

test('two hosts with one request each get no variable', () => {
  // There is no majority, so inventing a base_url would be a guess.
  const r = fromHar(har([
    entry({ request: { url: 'https://a.test/api/one', method: 'POST' } }),
    entry({ request: { url: 'https://b.test/api/two', method: 'POST' } })
  ]))
  assert.deepEqual(r.environments, [])
})

/* ------------------------------------------------------------ the grouping */

test('flows are named after the thing the path is about', () => {
  const r = fromHar(har([
    entry({ request: { url: 'https://api.shop.test/api/v2/orders' } }),
    entry({ request: { url: 'https://api.shop.test/api/v2/orders/7' } }),
    entry({ request: { url: 'https://api.shop.test/api/v2/customers' } })
  ]))
  assert.deepEqual(r.flows.map((f) => f.name).sort(), ['customers', 'orders'])
})

test('an id in the path does not become a flow of its own', () => {
  const r = fromHar(har([
    entry({ request: { url: 'https://api.shop.test/orders/7/items' } }),
    entry({ request: { url: 'https://api.shop.test/orders/8/items' } })
  ]))
  assert.deepEqual(r.flows.map((f) => f.name), ['orders'])
})

/* ------------------------------------------------------------- the detail */

test('query parameters become rows and leave the URL', () => {
  const r = fromHar(har([entry({ request: { url: 'https://api.shop.test/api/search?q=shoes&page=2' } })]))
  const req = r.flows[0].requests[0]
  assert.deepEqual(req.query.map((x) => [x.key, x.value]), [['q', 'shoes'], ['page', '2']])
  assert.ok(!req.url.includes('?'))
})

test('a live token is replaced by the variable, not imported', () => {
  const r = fromHar(har([entry({
    request: { url: 'https://api.shop.test/api/me', headers: [{ name: 'authorization', value: 'Bearer live.token.here' }] }
  })]))
  const req = r.flows[0].requests[0]
  assert.deepEqual(req.auth, { kind: 'bearer', token: '{{auth_token}}' })
  assert.ok(!JSON.stringify(req).includes('live.token.here'), 'the real token must not survive the import')
})

test('browser noise is not imported as headers', () => {
  const r = fromHar(har([entry({
    request: {
      url: 'https://api.shop.test/api/me',
      headers: [
        { name: ':method', value: 'GET' },
        { name: 'sec-ch-ua', value: '"Chromium"' },
        { name: 'content-length', value: '18' },
        { name: 'accept-encoding', value: 'gzip' },
        { name: 'x-tenant', value: 'acme' }
      ]
    }
  })]))
  assert.deepEqual(r.flows[0].requests[0].headers.map((h) => h.key), ['x-tenant'])
})

test('a JSON body arrives laid out', () => {
  const r = fromHar(har([entry({
    request: { method: 'POST', url: 'https://api.shop.test/api/orders', postData: { mimeType: 'application/json', text: '{"sku":"A","qty":2}' } }
  })]))
  const req = r.flows[0].requests[0]
  assert.equal(req.bodyKind, 'json')
  assert.match(req.body, /\n {2}"sku": "A"/)
})

test('form parameters become a form body', () => {
  const r = fromHar(har([entry({
    request: { method: 'POST', url: 'https://api.shop.test/api/login', postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'ada' }, { name: 'pass', value: 'x' }] } }
  })]))
  assert.equal(r.flows[0].requests[0].bodyKind, 'form')
  assert.equal(r.flows[0].requests[0].body, 'user=ada&pass=x')
})

test('what the response did becomes the first assertions', () => {
  const r = fromHar(har([entry()]))
  const subjects = r.flows[0].requests[0].assertions.map((a) => a.subject)
  assert.ok(subjects.includes('status'))
  assert.ok(subjects.includes('json'), 'a field that was there is worth asserting')
  assert.ok(subjects.includes('time'))
})

test('a cancelled request produces no assertions', () => {
  // status 0 means the browser gave up. A test built from that always fails.
  const r = fromHar(har([entry({ response: { status: 0, content: { mimeType: '' } } })]))
  assert.deepEqual(r.flows[0].requests[0].assertions, [])
})

test('the collection is named after the page it was captured from', () => {
  const r = fromHar(har([entry()], [{ id: 'p1', title: 'Northwind checkout' }]))
  assert.equal(r.name, 'Northwind checkout')
  assert.equal(r.collection.name, 'Northwind checkout')
})

test('and after the host when there is no page title', () => {
  assert.equal(fromHar(har([entry()])).name, 'api.shop.test')
})
