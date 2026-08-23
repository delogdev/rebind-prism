/**
 * The execution plan.
 *
 * The fixtures are written as real requests — a login that captures a token,
 * things that spend it — rather than abstract nodes, because the interesting
 * bugs are in how a dependency is *detected*, not in the topological sort.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, needs, gives, outOfOrder, describe as describePlan } from '../lib/plan.js'

const req = (name, over = {}) => ({
  id: name.toLowerCase().replace(/\W+/g, '_'),
  name,
  method: 'GET',
  url: 'https://api.test/thing',
  query: [],
  pathParams: [],
  headers: [],
  auth: { kind: 'none' },
  bodyKind: 'none',
  body: '',
  assertions: [],
  captures: [],
  ...over
})

const login = req('Log in', {
  method: 'POST',
  url: 'https://api.test/login',
  captures: [{ id: 'c1', name: 'auth_token', from: 'json', path: 'token' }]
})
const profile = req('Profile', { headers: [{ key: 'Authorization', value: 'Bearer {{auth_token}}', on: true }] })
const orders = req('Orders', { headers: [{ key: 'Authorization', value: 'Bearer {{auth_token}}', on: true }] })
const names = (stage) => stage.map((r) => r.name)

/* --------------------------------------------------------------- edges */

test('a request that spends a captured value waits for the one that captures it', () => {
  const p = plan([profile, login])
  assert.deepEqual(names(p.stages[0]), ['Log in'])
  assert.deepEqual(names(p.stages[1]), ['Profile'])
})

test('independent requests share a stage', () => {
  const p = plan([login, profile, orders])
  assert.equal(p.stages.length, 2)
  assert.deepEqual(names(p.stages[1]).sort(), ['Orders', 'Profile'])
  assert.equal(p.sequential, false)
})

test('a chain stays a chain', () => {
  const a = req('A', { captures: [{ name: 'one', from: 'json', path: 'x' }] })
  const b = req('B', { url: 'https://api.test/{{one}}', captures: [{ name: 'two', from: 'json', path: 'y' }] })
  const c = req('C', { url: 'https://api.test/{{two}}' })
  const p = plan([c, b, a])
  assert.deepEqual(p.stages.map(names), [['A'], ['B'], ['C']])
  assert.equal(p.sequential, true)
})

test('a value the environment already provides is not a dependency', () => {
  // base_url is set before anything runs, so nothing should wait for it.
  const one = req('One', { url: '{{base_url}}/a' })
  const two = req('Two', { url: '{{base_url}}/b' })
  const p = plan([one, two], ['base_url'])
  assert.equal(p.stages.length, 1, 'both should be in the first stage')
})

test('a name nothing provides is reported, not treated as an edge', () => {
  const p = plan([profile])
  assert.equal(p.stages.length, 1, 'it still runs — it may work anyway')
  assert.deepEqual(p.unresolved, [{ id: 'profile', name: 'Profile', variable: 'auth_token' }])
})

test('a request that spends what it captures does not wait for itself', () => {
  const self = req('Self', {
    url: 'https://api.test/{{page}}',
    captures: [{ name: 'page', from: 'json', path: 'next' }]
  })
  const p = plan([self])
  assert.equal(p.stages.length, 1)
  assert.deepEqual(p.unresolved, [], 'it provides its own')
})

test('two providers of one name both have to finish first', () => {
  // Which one wins is "the last to run", and that is only meaningful once
  // both have run. The second provider is deliberately in a later stage than
  // the first: if the consumer only waited for whichever provider it found
  // first, it would run alongside the second and read a stale value — and a
  // version of this test where both providers start in stage 0 cannot tell
  // the two behaviours apart.
  const seed = req('Seed', { captures: [{ name: 'seed', from: 'json', path: 's' }] })
  const early = req('Early', { captures: [{ name: 'tok', from: 'json', path: 'x' }] })
  const late = req('Late', {
    url: 'https://api.test/{{seed}}',
    captures: [{ name: 'tok', from: 'json', path: 'x' }]
  })
  const spender = req('Spender', { headers: [{ key: 'X', value: '{{tok}}', on: true }] })

  const p = plan([seed, early, late, spender])
  assert.deepEqual(names(p.stages[0]).sort(), ['Early', 'Seed'])
  assert.deepEqual(names(p.stages[1]), ['Late'])
  assert.deepEqual(names(p.stages[2]), ['Spender'], 'it must wait for the later provider too')
})

/* -------------------------------------------------------------- cycles */

test('a loop is reported rather than run in some arbitrary order', () => {
  const a = req('A', { url: 'https://api.test/{{from_b}}', captures: [{ name: 'from_a', from: 'json', path: 'x' }] })
  const b = req('B', { url: 'https://api.test/{{from_a}}', captures: [{ name: 'from_b', from: 'json', path: 'y' }] })
  const p = plan([a, b])
  assert.deepEqual(p.stages, [])
  assert.deepEqual(p.cycles.map((r) => r.name).sort(), ['A', 'B'])
})

test('a loop does not take the rest of the flow with it', () => {
  const a = req('A', { url: 'https://api.test/{{from_b}}', captures: [{ name: 'from_a', from: 'json', path: 'x' }] })
  const b = req('B', { url: 'https://api.test/{{from_a}}', captures: [{ name: 'from_b', from: 'json', path: 'y' }] })
  const fine = req('Fine')
  const p = plan([a, b, fine])
  assert.deepEqual(p.stages.map(names), [['Fine']])
  assert.equal(p.cycles.length, 2)
})

/* ------------------------------------------------------- the hand order */

test('a request placed above its provider is called out', () => {
  const bad = outOfOrder([profile, login])
  assert.deepEqual(bad, [{ name: 'Profile', variable: 'auth_token', from: 'Log in' }])
})

test('the same two in the right order are not', () => {
  assert.deepEqual(outOfOrder([login, profile]), [])
})

test('nothing is out of order when the environment provides the value', () => {
  assert.deepEqual(outOfOrder([profile, login], ['auth_token']), [])
})

/* ------------------------------------------------------------ describe */

test('the plan describes itself in a way worth reading', () => {
  assert.match(describePlan(plan([login, profile, orders])), /2 stages, up to 2 at once/)
  assert.match(describePlan(plan([login])), /one after another/)
  assert.equal(describePlan(plan([])), 'Nothing to run')
})

/* ------------------------------------------------------------- helpers */

test('needs and gives read the request the same way the canvas does', () => {
  assert.deepEqual(gives(login), ['auth_token'])
  assert.deepEqual(needs(profile), ['auth_token'])
  assert.deepEqual(needs(profile, ['auth_token']), [], 'known names drop out')
})

test('a built-in variable is never a dependency', () => {
  // {{$uuid}} provides itself, so a node that uses one must not wait for
  // anything, and must not be reported as unresolved either.
  const one = req('One', { body: '{"id":"{{$uuid}}"}', bodyKind: 'json' })
  const p = plan([one])
  assert.deepEqual(p.unresolved, [])
  assert.equal(p.stages.length, 1)
})
