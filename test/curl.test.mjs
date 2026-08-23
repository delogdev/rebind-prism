/**
 * Reading a cURL command.
 *
 * The fixtures are real: what Chrome's "Copy as cURL" writes on each platform,
 * what a README example looks like, and what somebody types by hand. A parser
 * tested only against its own idea of tidy input is a parser that fails on the
 * first thing anyone pastes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromCurl, tokenise } from '../lib/curl.js'

const ok = (text) => {
  const r = fromCurl(text)
  assert.equal(r.ok, true, r.error)
  return r.request
}

/* ------------------------------------------------------------- lexing */

test('quotes come off, and what is inside them stays together', () => {
  assert.deepEqual(tokenise(`curl 'https://a.test/x y' -H "K: v"`), ['curl', 'https://a.test/x y', '-H', 'K: v'])
})

test('a bash line continuation is not a token', () => {
  assert.deepEqual(tokenise('curl \\\n  -X POST \\\n  https://a.test'), ['curl', '-X', 'POST', 'https://a.test'])
})

test('cmd and PowerShell continuations too', () => {
  assert.deepEqual(tokenise('curl ^\n -X GET ^\n https://a.test'), ['curl', '-X', 'GET', 'https://a.test'])
  assert.deepEqual(tokenise('curl `\n -X GET `\n https://a.test'), ['curl', '-X', 'GET', 'https://a.test'])
})

test("$'…' keeps its escapes, which is why Chrome uses it", () => {
  assert.deepEqual(tokenise(`curl --data $'a\\nb'`), ['curl', '--data', 'a\nb'])
})

test('an empty token survives being empty', () => {
  // -d '' is a real thing: a POST with no body but the method implied.
  assert.deepEqual(tokenise(`curl -d '' https://a.test`), ['curl', '-d', '', 'https://a.test'])
})

/* ------------------------------------------------------------ the basics */

test('the plainest possible command', () => {
  const r = ok('curl https://api.test/orders')
  assert.equal(r.method, 'GET')
  assert.equal(r.url, 'https://api.test/orders')
  assert.equal(r.name, '/orders', 'the method is a chip beside the name, not part of it')
})

test('data with no -X means POST, because that is what curl does', () => {
  assert.equal(ok(`curl https://api.test/orders -d '{"a":1}'`).method, 'POST')
})

test('an explicit method wins over the guess', () => {
  assert.equal(ok(`curl -X PATCH https://api.test/o -d '{"a":1}'`).method, 'PATCH')
})

test('the query string becomes rows, and leaves the URL', () => {
  const r = ok('curl "https://api.test/search?q=shoes&page=2"')
  assert.equal(r.url, 'https://api.test/search')
  assert.deepEqual(r.query.map((x) => [x.key, x.value]), [['q', 'shoes'], ['page', '2']])
})

test('a bare host is assumed to be https', () => {
  assert.equal(ok('curl api.test/thing').url, 'https://api.test/thing')
})

/* ------------------------------------------------------------- headers */

test('headers become rows', () => {
  const r = ok(`curl https://api.test -H 'Accept: application/json' -H 'X-Tenant: acme'`)
  assert.deepEqual(r.headers.map((h) => [h.key, h.value]), [['Accept', 'application/json'], ['X-Tenant', 'acme']])
})

test('--header=value is read the same as --header value', () => {
  assert.deepEqual(ok('curl https://api.test --header=Accept:application/json').headers[0].key, 'Accept')
})

test('a bearer token becomes the auth block, not a literal header', () => {
  // In the auth block it can be marked secret and swapped per environment;
  // left as a header it is a live token in a field that gets exported.
  const r = ok(`curl https://api.test -H 'Authorization: Bearer abc.def'`)
  assert.deepEqual(r.auth, { kind: 'bearer', token: 'abc.def' })
  assert.equal(r.headers.length, 0)
})

test('basic auth is decoded into its two fields', () => {
  const encoded = Buffer.from('ada:hunter2').toString('base64')
  const r = ok(`curl https://api.test -H 'Authorization: Basic ${encoded}'`)
  assert.deepEqual(r.auth, { kind: 'basic', username: 'ada', password: 'hunter2' })
})

test('-u is the same thing said differently', () => {
  assert.deepEqual(ok('curl https://api.test -u ada:hunter2').auth, { kind: 'basic', username: 'ada', password: 'hunter2' })
})

test('a password containing a colon survives', () => {
  assert.equal(ok('curl https://api.test -u ada:a:b:c').auth.password, 'a:b:c')
})

test('a cookie flag becomes a Cookie header', () => {
  const r = ok(`curl https://api.test -b 'sid=1; theme=dark'`)
  assert.deepEqual([r.headers[0].key, r.headers[0].value], ['Cookie', 'sid=1; theme=dark'])
})

/* --------------------------------------------------------------- bodies */

test('a JSON body is recognised and laid out', () => {
  const r = ok(`curl https://api.test -H 'Content-Type: application/json' -d '{"sku":"A","qty":2}'`)
  assert.equal(r.bodyKind, 'json')
  assert.match(r.body, /\n {2}"sku": "A"/, 'it should be pretty-printed, not one line')
})

test('JSON with no content-type header is still JSON', () => {
  assert.equal(ok(`curl https://api.test -d '{"a":1}'`).bodyKind, 'json')
})

test('a form body is recognised', () => {
  const r = ok(`curl https://api.test -d 'name=ada&role=admin'`)
  assert.equal(r.bodyKind, 'form')
  assert.equal(r.body, 'name=ada&role=admin')
})

test('several -d flags are joined the way curl joins them', () => {
  assert.equal(ok('curl https://api.test -d a=1 -d b=2').body, 'a=1&b=2')
})

test('--json sets the body and the content type at once', () => {
  const r = ok(`curl https://api.test --json '{"a":1}'`)
  assert.equal(r.bodyKind, 'json')
  assert.ok(r.headers.some((h) => /content-type/i.test(h.key)))
})

test('-G turns the data into query parameters instead of a body', () => {
  const r = ok('curl -G https://api.test/search -d q=shoes -d page=2')
  assert.equal(r.bodyKind, 'none')
  assert.equal(r.method, 'GET')
  assert.deepEqual(r.query.map((x) => x.key), ['q', 'page'])
})

/* --------------------------------------------------------- what it refuses */

test('something that is not curl at all', () => {
  const r = fromCurl('wget https://api.test')
  assert.equal(r.ok, false)
  assert.match(r.error, /does not look like a curl command/)
})

test('curl with no URL', () => {
  const r = fromCurl('curl -X POST -H "A: b"')
  assert.equal(r.ok, false)
  assert.match(r.error, /no URL/)
})

test('an empty paste', () => {
  assert.equal(fromCurl('   ').ok, false)
})

test('a flag it does not understand is reported, not silently dropped', () => {
  // --cert changes what the request does. Dropping it quietly means finding
  // out at send time, against the wrong server, with the wrong identity.
  const r = fromCurl('curl https://api.test --cert /tmp/client.pem --proxy http://localhost:8080')
  assert.equal(r.ok, true)
  assert.deepEqual(r.unknown, ['--cert', '--proxy'])
})

test('an unknown flag before the URL does not eat it', () => {
  // Whether an unknown flag takes a value is unknowable — it is unknown. The
  // guess errs towards keeping the URL, because "there is no URL in that
  // command" is a much worse answer than "I ignored --whatever".
  const r = fromCurl('curl --whatever https://api.test/x')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.request.url, 'https://api.test/x')
  assert.deepEqual(r.unknown, ['--whatever'])
})

test('an unknown flag with an obvious value still consumes it', () => {
  const r = fromCurl('curl --cert /tmp/client.pem https://api.test/x')
  assert.equal(r.request.url, 'https://api.test/x', 'the pem path is not the URL')
})

test('flags that take no value do not eat the URL', () => {
  const r = fromCurl('curl --compressed -L -k https://api.test/x')
  assert.equal(r.request.url, 'https://api.test/x')
  assert.deepEqual(r.unknown, [])
  assert.equal(r.insecure, true, 'the -k is worth surfacing rather than obeying silently')
})

/* -------------------------------------------------- the real-world paste */

test("Chrome's Copy as cURL, as pasted", () => {
  const chrome = `curl 'https://api.northwind.test/v2/orders?status=open' \\
  -H 'accept: application/json, text/plain, */*' \\
  -H 'accept-language: en-GB,en;q=0.9' \\
  -H 'authorization: Bearer eyJhbGciOi.J9.sig' \\
  -H 'content-type: application/json' \\
  -H $'cookie: sid=abc; theme=dark' \\
  --data-raw $'{"sku":"TNR-500",\\n"qty":2}' \\
  --compressed`

  const r = ok(chrome)
  assert.equal(r.method, 'POST')
  assert.equal(r.url, 'https://api.northwind.test/v2/orders')
  assert.deepEqual(r.query.map((x) => [x.key, x.value]), [['status', 'open']])
  assert.equal(r.auth.kind, 'bearer')
  assert.equal(r.auth.token, 'eyJhbGciOi.J9.sig')
  assert.equal(r.bodyKind, 'json')
  assert.match(r.body, /"sku": "TNR-500"/)
  assert.ok(r.headers.some((h) => h.key === 'cookie'), 'the cookie header survives')
  assert.ok(!r.headers.some((h) => /authorization/i.test(h.key)), 'and the token is not left in one')
})
