/**
 * Inheritance, and the OAuth grant.
 *
 * Both are things that go wrong quietly: an inherited header that does not
 * arrive, or a token that looks present and expired in flight. So the tests
 * are mostly about the boring edges rather than the happy path.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { effectiveHeaders, effectiveAuth, withInherited, inheritedFor, anyInherited } from '../lib/inherit.js'
import { tokenRequest, readToken, stale, nextStep, missingFields, refreshWith, remaining, emptyOauth } from '../lib/oauth.js'

const row = (key, value, on = true) => ({ key, value, on })
const req = (over = {}) => ({ id: 'r1', name: 'R', headers: [], auth: { kind: 'inherit' }, ...over })
const pairs = (list) => list.map((h) => [h.key, h.value])

/* ========================================================== inheritance */

test('a collection header reaches a request that sets none', () => {
  const collection = { name: 'Northwind', headers: [row('X-Api-Version', '2')] }
  assert.deepEqual(pairs(effectiveHeaders(req(), [collection])), [['X-Api-Version', '2']])
})

test('the nearest level wins', () => {
  const collection = { name: 'C', headers: [row('X-Env', 'collection')] }
  const flow = { name: 'F', headers: [row('X-Env', 'flow')] }
  assert.deepEqual(pairs(effectiveHeaders(req(), [collection, flow])), [['X-Env', 'flow']])
  assert.deepEqual(
    pairs(effectiveHeaders(req({ headers: [row('X-Env', 'request')] }), [collection, flow])),
    [['X-Env', 'request']]
  )
})

test('an override keeps the position it had, rather than jumping to the end', () => {
  const collection = { name: 'C', headers: [row('A', '1'), row('B', '2'), row('C', '3')] }
  const out = effectiveHeaders(req({ headers: [row('B', 'mine')] }), [collection])
  assert.deepEqual(pairs(out), [['A', '1'], ['B', 'mine'], ['C', '3']])
})

test('header names are matched without regard to case', () => {
  // Servers treat them that way, so two rows differing only in case are one
  // header, and shipping both is how you send a value twice.
  const collection = { name: 'C', headers: [row('Content-Type', 'application/xml')] }
  const out = effectiveHeaders(req({ headers: [row('content-type', 'application/json')] }), [collection])
  assert.equal(out.length, 1)
  assert.equal(out[0].value, 'application/json')
})

test('a request can switch an inherited header off', () => {
  const collection = { name: 'C', headers: [row('X-Debug', 'on')] }
  const merged = withInherited(req({ headers: [row('X-Debug', 'on', false)] }), [collection])
  assert.deepEqual(merged.headers, [], 'switched off means not sent')
})

test('where each header came from is recorded, so the UI can say', () => {
  const collection = { name: 'Northwind', headers: [row('X-Api-Version', '2')] }
  const out = effectiveHeaders(req({ headers: [row('X-Own', '1')] }), [collection])
  assert.equal(out.find((h) => h.key === 'X-Api-Version').from, 'Northwind')
  assert.equal(out.find((h) => h.key === 'X-Own').from, '', 'its own headers come from nowhere')
})

/* --------------------------------------------------------------- auth */

test('inherit takes the nearest configured auth', () => {
  const collection = { name: 'C', auth: { kind: 'bearer', token: '{{tok}}' } }
  assert.equal(effectiveAuth(req(), [collection]).kind, 'bearer')
  assert.equal(effectiveAuth(req(), [collection]).from, 'C')
})

test('a flow beats the collection', () => {
  const collection = { name: 'C', auth: { kind: 'bearer', token: 'c' } }
  const flow = { name: 'F', auth: { kind: 'basic', username: 'ada' } }
  assert.equal(effectiveAuth(req(), [collection, flow]).kind, 'basic')
})

test('a flow that inherits does not block the collection', () => {
  const collection = { name: 'C', auth: { kind: 'bearer', token: 'c' } }
  const flow = { name: 'F', auth: { kind: 'inherit' } }
  assert.equal(effectiveAuth(req(), [collection, flow]).kind, 'bearer')
})

test('none is a decision, and stops the search', () => {
  // The login endpoint must not carry the token it is about to go and fetch.
  const collection = { name: 'C', auth: { kind: 'bearer', token: 'c' } }
  assert.equal(effectiveAuth(req({ auth: { kind: 'none' } }), [collection]).kind, 'none')
})

test('with nothing above it, inherit means none', () => {
  assert.equal(effectiveAuth(req(), []).kind, 'none')
})

test('the resolved request is what compile can be handed', () => {
  const collection = { name: 'C', headers: [row('X-Api-Version', '2')], auth: { kind: 'bearer', token: 'abc' } }
  const merged = withInherited(req(), [collection])
  assert.deepEqual(merged.headers, [{ key: 'X-Api-Version', value: '2', on: true }])
  assert.deepEqual(merged.auth, { kind: 'bearer', token: 'abc' })
  assert.ok(!('from' in merged.auth), 'the bookkeeping does not travel to the sender')
})

test('what is inherited is listed separately from what is overridden', () => {
  const collection = { name: 'C', headers: [row('A', '1'), row('B', '2')] }
  const shown = inheritedFor(req({ headers: [row('B', 'mine')] }), [collection])
  assert.deepEqual(pairs(shown.headers), [['A', '1']], 'B is the request’s own now')
})

test('a chain that sets nothing says so, so the UI can stay quiet', () => {
  assert.equal(anyInherited([{ name: 'C' }, { name: 'F' }]), false)
  assert.equal(anyInherited([{ name: 'C', headers: [row('A', '1')] }]), true)
  assert.equal(anyInherited([{ name: 'C', auth: { kind: 'none' } }]), false, 'none is not something to inherit')
})

/* =============================================================== oauth */

test('client credentials go in the body by default', () => {
  const out = tokenRequest(emptyOauth({ tokenUrl: 'https://id.test/token', clientId: 'abc', clientSecret: 'shh', scope: 'read' }))
  assert.equal(out.method, 'POST')
  assert.equal(out.url, 'https://id.test/token')
  const form = new URLSearchParams(out.body)
  assert.equal(form.get('grant_type'), 'client_credentials')
  assert.equal(form.get('client_id'), 'abc')
  assert.equal(form.get('client_secret'), 'shh')
  assert.equal(form.get('scope'), 'read')
  assert.ok(!out.headers.Authorization)
})

test('or in a Basic header, for the servers that insist', () => {
  const out = tokenRequest(emptyOauth({ tokenUrl: 'https://id.test/token', clientId: 'abc', clientSecret: 'shh', clientAuth: 'header' }))
  assert.equal(out.headers.Authorization, `Basic ${Buffer.from('abc:shh').toString('base64')}`)
  assert.ok(!new URLSearchParams(out.body).get('client_secret'), 'and then not in the body as well')
})

test('the password grant carries the account', () => {
  const form = new URLSearchParams(tokenRequest(emptyOauth({ grant: 'password', tokenUrl: 'https://id.test/t', username: 'ada', password: 'x' })).body)
  assert.equal(form.get('grant_type'), 'password')
  assert.equal(form.get('username'), 'ada')
})

test('variables are resolved on the way out', () => {
  // The client id usually differs per environment, and typing it twice is how
  // staging ends up pointed at production.
  const out = tokenRequest(emptyOauth({ tokenUrl: '{{id_host}}/token', clientId: '{{client}}' }), (s) => s.replace('{{id_host}}', 'https://id.test').replace('{{client}}', 'abc'))
  assert.equal(out.url, 'https://id.test/token')
  assert.equal(new URLSearchParams(out.body).get('client_id'), 'abc')
})

test('it says what is missing before it asks the server', () => {
  assert.deepEqual(missingFields(emptyOauth({ grant: 'password', tokenUrl: 'https://id.test/t', clientId: 'a' })), ['a username', 'a password'])
  assert.deepEqual(missingFields(emptyOauth({ tokenUrl: 'https://id.test/t', clientId: 'a' })), [])
})

/* ------------------------------------------------------- reading the reply */

test('a normal token response', () => {
  const t = readToken({ access_token: 'abc', token_type: 'Bearer', expires_in: 3600, refresh_token: 'r1' }, 1000)
  assert.equal(t.ok, true)
  assert.equal(t.token, 'abc')
  assert.equal(t.expiresAt, 1000 + 3600 * 1000)
  assert.equal(t.refreshToken, 'r1')
})

test('no expires_in means unknown, not already expired', () => {
  const t = readToken({ access_token: 'abc' }, 1000)
  assert.equal(t.expiresAt, 0)
  assert.equal(stale(t, 1_000_000_000), false, 'unknown expiry is not the same as stale')
})

test('an OAuth error is read out rather than reported as a missing token', () => {
  const t = readToken({ error: 'invalid_client', error_description: 'Client authentication failed' })
  assert.equal(t.ok, false)
  assert.match(t.error, /Client authentication failed/)
})

test('a 200 with no token in it', () => {
  const t = readToken({ hello: true })
  assert.equal(t.ok, false)
  assert.match(t.error, /no access_token/)
})

test('an HTML error page is not JSON', () => {
  assert.equal(readToken(undefined).ok, false)
})

/* --------------------------------------------------------------- staleness */

test('a token about to expire is already stale', () => {
  // Four seconds left passes a naive check and then expires in flight, which
  // shows up as a 401 on a request that did nothing wrong.
  const state = { token: 'abc', expiresAt: 100_000 }
  assert.equal(stale(state, 96_000), true, 'inside the safety margin')
  assert.equal(stale(state, 50_000), false)
})

test('no token at all is stale', () => {
  assert.equal(stale({}, 0), true)
})

test('what to do next', () => {
  assert.equal(nextStep({}, {}), 'unconfigured')
  assert.equal(nextStep({ tokenUrl: 'x' }, { token: 'a', expiresAt: 0 }), 'hold')
  assert.equal(nextStep({ tokenUrl: 'x' }, {}), 'fetch')
  assert.equal(nextStep({ tokenUrl: 'x' }, { token: 'a', expiresAt: 1, refreshToken: 'r' }, 10_000), 'refresh')
})

test('a refresh reuses the client details and swaps the grant', () => {
  const cfg = emptyOauth({ tokenUrl: 'https://id.test/t', clientId: 'abc', clientSecret: 'shh' })
  const next = refreshWith(cfg, { refreshToken: 'r1' })
  assert.equal(next.grant, 'refresh_token')
  assert.equal(next.refreshToken, 'r1')
  assert.equal(next.clientId, 'abc')
})

test('how long is left, in words', () => {
  assert.equal(remaining({}), 'no token yet')
  assert.equal(remaining({ token: 'a', expiresAt: 0 }), 'no expiry given')
  assert.equal(remaining({ token: 'a', expiresAt: 1000 }, 2000), 'expired')
  assert.equal(remaining({ token: 'a', expiresAt: 5 * 60_000 }, 0), '5m left')
  assert.equal(remaining({ token: 'a', expiresAt: 90 * 60_000 }, 0), '1h 30m left')
  assert.equal(remaining({ token: 'a', expiresAt: 4000 }, 0), '4s left')
})
