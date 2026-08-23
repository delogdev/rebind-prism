/**
 * The line printer behind click-to-capture.
 *
 * The load-bearing claim is that its text is identical to what JSON.stringify
 * produces at two-space indent. If it drifts, the response body starts looking
 * subtly wrong — a trailing comma in the wrong place, a bracket on its own
 * line — and nobody would suspect the click handler.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lines, suggestName, capturable } from '../lib/jsonlines.js'

const text = (value) => lines(value).map((l) => l.text).join('\n')
const same = (value) => assert.equal(text(value), JSON.stringify(value, null, 2))
const pathOf = (value, needle) => lines(value).find((l) => l.text.includes(needle))?.path

/* ------------------------------------------- identical to stringify */

test('a flat object', () => same({ id: 7, name: 'Toner', inStock: true, note: null }))
test('nesting', () => same({ order: { id: 7, customer: { name: 'Ada', tier: 'gold' } } }))
test('an array of objects', () => same({ items: [{ id: 1 }, { id: 2 }] }))
test('an array of scalars', () => same({ tags: ['a', 'b', 'c'] }))
test('empty containers', () => same({ items: [], meta: {}, both: { list: [], map: {} } }))
test('an array at the root', () => same([{ id: 1 }, { id: 2 }]))
test('a scalar at the root', () => same('hello'))
test('a number at the root', () => same(42))
test('null at the root', () => same(null))
test('deep nesting', () => same({ a: { b: { c: { d: [1, { e: 'f' }] } } } }))
test('strings needing escapes', () => same({ quote: 'she said "hi"', nl: 'a\nb', slash: 'a\\b' }))
test('unicode', () => same({ name: 'Ada Løvelace', emoji: '✓' }))
test('numbers of every sort', () => same({ int: 1, neg: -2, float: 1.5, exp: 1e21, zero: 0 }))

/* ------------------------------------------------------------ paths */

test('a top-level field knows its path', () => {
  assert.equal(pathOf({ id: 7 }, '"id"'), 'id')
})

test('a nested field knows its full path', () => {
  assert.equal(pathOf({ data: { token: 'abc' } }, '"token"'), 'data.token')
})

test('an array member is addressed by index', () => {
  assert.equal(pathOf({ items: [{ sku: 'A' }] }, '"sku"'), 'items.0.sku')
})

test('a scalar in an array of scalars', () => {
  const out = lines({ tags: ['x', 'y'] })
  assert.deepEqual(out.filter((l) => l.leaf).map((l) => l.path), ['tags.0', 'tags.1'])
})

test('the path is the one jsonPath would follow', async () => {
  // The paths are only worth anything if the assertion engine agrees with
  // them, so this checks against the real reader rather than a copy of it.
  const { jsonPath } = await import('../lib/assert.js')
  const doc = { data: { orders: [{ id: 7, tags: ['new'] }] }, ok: true }
  for (const line of lines(doc).filter((l) => l.leaf)) {
    assert.deepEqual(jsonPath(doc, line.path), line.value, `${line.path} should resolve to the value on its line`)
  }
})

/* ------------------------------------------------------------ kinds */

test('each leaf reports what it is', () => {
  const out = lines({ s: 'a', n: 1, b: true, z: null })
  assert.deepEqual(out.filter((l) => l.leaf).map((l) => l.kind), ['string', 'number', 'boolean', 'null'])
})

test('a container is not a leaf, and its closing brace is not capturable', () => {
  const out = lines({ a: { b: 1 } })
  const closers = out.filter((l) => l.kind.endsWith('-end'))
  assert.ok(closers.length)
  assert.ok(closers.every((l) => !capturable(l)), 'a closing brace has nothing to capture')
})

test('an empty container is a leaf but holds nothing to capture', () => {
  const empty = lines({ items: [] }).find((l) => l.text.includes('items'))
  assert.equal(empty.leaf, true)
  assert.equal(capturable(empty), false, 'kind is array, not a scalar')
})

/* ------------------------------------------------------- the naming */

test('a suggested variable name reads like one somebody would type', () => {
  assert.equal(suggestName('data.session.accessToken'), 'access_token')
  assert.equal(suggestName('token'), 'token')
  assert.equal(suggestName('order.id'), 'id')
})

test('an array index is not a name', () => {
  assert.equal(suggestName('items.0.orderId'), 'order_id')
  assert.equal(suggestName('items.0'), 'items')
})

test('punctuation becomes underscores, and never leads or trails', () => {
  assert.equal(suggestName('data.x-request-id'), 'x_request_id')
  assert.equal(suggestName('data.$weird$'), 'weird')
})

test('a path with nothing usable in it still yields a name', () => {
  assert.equal(suggestName(''), 'value')
  assert.equal(suggestName('0.1'), 'value')
})

/* --------------------------------------------------------- the limit */

test('a body large enough to freeze the pane is cut off', () => {
  const huge = { items: Array.from({ length: 4000 }, (_, i) => ({ id: i })) }
  assert.ok(lines(huge, { limit: 500 }).length <= 500)
})
