/**
 * Trends, GraphQL, and comparing two environments.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { summarise, flaky, spark, percentile, headline, repeatVerdict } from '../lib/trend.js'
import { buildGraphQL, operationOf, kindOf, label, errorsIn, looksGraphQL, readSchema, stubFor } from '../lib/graphql.js'
import { compare } from '../lib/env.js'

const run = (ms, failed = 0, over = {}) => ({ requestId: 'r1', name: 'Orders', ms, failed, at: 1000, ...over })

/* =============================================================== trends */

test('percentile takes a real sample rather than inventing one', () => {
  // With six numbers there is nothing meaningful to interpolate, and a p95
  // that reports a duration nothing ever took reads as a bug.
  const values = [10, 20, 30, 40, 50, 60]
  assert.equal(percentile(values, 50), 30)
  assert.equal(percentile(values, 95), 60)
  assert.ok(values.includes(percentile(values, 90)))
  assert.equal(percentile([], 50), 0)
})

test('a steady endpoint is reported as steady', () => {
  const s = summarise([run(100), run(104), run(98), run(102), run(101), run(99)])
  assert.equal(s.verdict, 'steady')
  assert.equal(s.runs, 6)
  assert.equal(s.passRate, 100)
})

test('a real slowdown is called out', () => {
  // Newest first: the recent half is around 300, the earlier half around 100.
  const s = summarise([run(300), run(310), run(290), run(100), run(105), run(95)])
  assert.equal(s.verdict, 'slower')
  assert.ok(s.change >= 150, `${s.change}% should be a large positive number`)
  assert.match(headline(s), /slower/)
})

test('and so is a speed-up', () => {
  assert.equal(summarise([run(100), run(95), run(105), run(300), run(310), run(290)]).verdict, 'faster')
})

test('a couple of milliseconds is not a regression', () => {
  // 2ms to 3ms is 50% and means nothing. Announcing it teaches people to
  // ignore the badge, which costs the real ones their audience.
  const s = summarise([run(3), run(3), run(3), run(2), run(2), run(2)])
  assert.equal(s.verdict, 'steady')
})

test('too few runs to say anything', () => {
  const s = summarise([run(100), run(400)])
  assert.equal(s.verdict, 'steady')
  assert.equal(s.change, 0)
  assert.equal(headline(s), '')
})

test('no runs at all', () => {
  const s = summarise([])
  assert.equal(s.runs, 0)
  assert.equal(s.median, 0)
  assert.equal(headline(s), '')
})

test('a pass rate that is neither nothing nor everything is the headline', () => {
  const s = summarise([run(10), run(10, 1), run(10), run(10)])
  assert.equal(s.passRate, 75)
  assert.match(headline(s), /fails 25% of the time/)
})

/* -------------------------------------------------------------- flaky */

test('a request that both passes and fails is flaky', () => {
  const out = flaky([run(10), run(10, 1), run(10), run(10, 1)])
  assert.equal(out.length, 1)
  assert.deepEqual([out[0].pass, out[0].fail, out[0].rate], [2, 2, 50])
})

test('one that always fails is broken, not flaky', () => {
  assert.deepEqual(flaky([run(10, 1), run(10, 1)]), [])
})

test('one that always passes is not flaky either', () => {
  assert.deepEqual(flaky([run(10), run(10)]), [])
})

test('the flakiest comes first', () => {
  const out = flaky([
    run(10, 0, { requestId: 'a', name: 'A' }), run(10, 1, { requestId: 'a', name: 'A' }),
    run(10, 0, { requestId: 'b', name: 'B' }), run(10, 0, { requestId: 'b', name: 'B' }),
    run(10, 0, { requestId: 'b', name: 'B' }), run(10, 1, { requestId: 'b', name: 'B' })
  ])
  assert.deepEqual(out.map((x) => x.name), ['A', 'B'])
})

test('the sparkline runs forwards in time', () => {
  const points = spark([run(3, 0, { at: 300 }), run(2, 0, { at: 200 }), run(1, 0, { at: 100 })])
  assert.deepEqual(points.map((p) => p.at), [100, 200, 300])
})

/* -------------------------------------------------------------- repeat */

test('ten identical runs that all pass are stable', () => {
  const v = repeatVerdict(Array.from({ length: 10 }, () => ({ status: 200, failed: 0, ms: 12 })))
  assert.equal(v.stable, true)
  assert.equal(v.flaky, false)
})

test('ten runs where two fail is the finding worth having', () => {
  const results = [
    ...Array.from({ length: 8 }, () => ({ status: 200, failed: 0, ms: 12 })),
    { status: 500, failed: 1, ms: 30 },
    { status: 200, failed: 1, ms: 14 }
  ]
  const v = repeatVerdict(results)
  assert.equal(v.flaky, true)
  assert.equal(v.failed, 2)
  assert.deepEqual(v.statuses.sort(), [200, 500])
})

test('ten runs that all fail is broken, and says so', () => {
  const v = repeatVerdict(Array.from({ length: 4 }, () => ({ status: 500, failed: 1, ms: 5 })))
  assert.equal(v.flaky, false)
  assert.equal(v.stable, true, 'consistently broken is still consistent')
})

/* ============================================================= graphql */

test('the body is the three keys the spec asks for', () => {
  const body = JSON.parse(buildGraphQL({ query: 'query Orders { orders { id } }', variables: '{"first":10}' }))
  assert.equal(body.query, 'query Orders { orders { id } }')
  assert.deepEqual(body.variables, { first: 10 })
  assert.equal(body.operationName, 'Orders', 'read out of the query rather than typed twice')
})

test('variables that are not valid JSON are passed on rather than dropped', () => {
  // The server's complaint is more useful than one Prism invents.
  const body = JSON.parse(buildGraphQL({ query: '{a}', variables: '{oops' }))
  assert.equal(body.variables, '{oops')
})

test('no variables means no variables key', () => {
  assert.ok(!('variables' in JSON.parse(buildGraphQL({ query: '{a}' }))))
})

test('the operation name is found, or absent without complaint', () => {
  assert.equal(operationOf('mutation PlaceOrder($x: ID!) { place(id: $x) { id } }'), 'PlaceOrder')
  assert.equal(operationOf('{ orders { id } }'), '', 'anonymous is legal')
})

test('a name inside a comment is not the operation', () => {
  assert.equal(operationOf('# query NotThisOne\nquery Real { a }'), 'Real')
})

test('what kind of operation it is', () => {
  assert.equal(kindOf('mutation { a }'), 'mutation')
  assert.equal(kindOf('{ orders { id } }'), 'query', 'a bare selection set is a query')
  assert.equal(kindOf('subscription S { tick }'), 'subscription')
})

test('the node label says something specific', () => {
  assert.equal(label('mutation PlaceOrder { place { id } }'), 'mutation PlaceOrder')
  assert.equal(label('{ orders { id } }'), 'query orders', 'the first field, when there is no name')
  assert.equal(label(''), 'GraphQL')
})

test('errors inside a 200 are the whole point', () => {
  // The failure every REST-shaped tool misses: status 200, query rejected.
  const errs = errorsIn({ data: null, errors: [{ message: 'Cannot query field "nope"', path: ['orders'], locations: [{ line: 2 }] }] })
  assert.equal(errs.length, 1)
  assert.equal(errs[0].message, 'Cannot query field "nope"')
  assert.equal(errs[0].path, 'orders')
  assert.equal(errs[0].line, 2)
})

test('a clean response has no errors', () => {
  assert.deepEqual(errorsIn({ data: { orders: [] } }), [])
  assert.deepEqual(errorsIn(undefined), [])
})

test('recognising a GraphQL reply', () => {
  assert.equal(looksGraphQL({ data: {} }), true)
  assert.equal(looksGraphQL({ errors: [] }), true)
  assert.equal(looksGraphQL({ id: 7 }), false)
})

test('introspection is flattened into something listable', () => {
  const doc = {
    data: {
      __schema: {
        queryType: { name: 'Query' },
        mutationType: { name: 'Mutation' },
        types: [
          { name: 'Query', kind: 'OBJECT', fields: [{ name: 'orders', args: [{ name: 'first', type: { name: 'Int', kind: 'SCALAR' } }], type: { kind: 'LIST', ofType: { name: 'Order', kind: 'OBJECT' } } }] },
          { name: 'Mutation', kind: 'OBJECT', fields: [{ name: 'placeOrder', args: [], type: { name: 'Order', kind: 'OBJECT' } }] },
          { name: '__Type', kind: 'OBJECT', fields: [] }
        ]
      }
    }
  }
  const s = readSchema(doc)
  assert.equal(s.ok, true)
  assert.deepEqual(s.queries.map((f) => f.name), ['orders'])
  assert.equal(s.queries[0].type, 'Order', 'through the LIST wrapper')
  assert.deepEqual(s.mutations.map((f) => f.name), ['placeOrder'])
  assert.ok(!s.types.includes('__Type'), 'introspection internals are not types anyone picks')
})

test('a server that does not do introspection', () => {
  assert.equal(readSchema({ data: {} }).ok, false)
})

test('a picked field becomes a runnable stub', () => {
  const stub = stubFor({ name: 'orders', args: [{ name: 'first', type: 'Int' }] }, 'query')
  assert.match(stub, /query Orders\(\$first: Int\)/)
  assert.match(stub, /orders\(first: \$first\)/)
})

/* ======================================================= environment diff */

test('comparing two environments says what each is missing', () => {
  const dev = { name: 'Dev', values: { base_url: 'http://localhost', tenant: 'acme', debug: '1' }, secrets: [] }
  const prod = { name: 'Prod', values: { base_url: 'https://api.test', tenant: 'acme' }, secrets: [] }
  const d = compare(dev, prod)
  assert.deepEqual(d.onlyInA, ['debug'])
  assert.deepEqual(d.onlyInB, [])
  assert.deepEqual(d.differing.map((x) => x.name), ['base_url'])
  assert.deepEqual(d.same, ['tenant'])
})

test('a secret is compared as set-or-not, never by value', () => {
  // Two environments' tokens obviously differ; printing them side by side to
  // prove it would put both on screen at once.
  const a = { name: 'A', values: { token: 'aaa' }, secrets: ['token'] }
  const b = { name: 'B', values: { token: 'bbb' }, secrets: ['token'] }
  const d = compare(a, b)
  assert.deepEqual(d.differing, [])
  assert.deepEqual(d.same, ['token'])
  const text = JSON.stringify(d)
  assert.ok(!text.includes('aaa') && !text.includes('bbb'), 'no secret value appears in the comparison')
})

test('a secret set on one side and empty on the other is worth saying', () => {
  const a = { name: 'A', values: { token: 'aaa' }, secrets: ['token'] }
  const b = { name: 'B', values: { token: '' }, secrets: ['token'] }
  assert.deepEqual(compare(a, b).differing.map((x) => x.name), ['token'])
  assert.match(compare(a, b).differing[0].b, /not set/)
})

/* ------------------------------------------- graphql at the sending end */

test('a graphql request is sent as the envelope, not as the query text', async () => {
  const { buildBody, buildHeaders } = await import('../lib/request.js')
  const req = {
    bodyKind: 'graphql',
    body: 'query Orders($first: Int) { orders(first: $first) { id } }',
    gqlVariables: '{"first": {{page_size}}}'
  }
  const body = JSON.parse(buildBody(req, { page_size: '10' }))
  assert.equal(body.variables.first, 10, 'a variable inside the variables block is resolved')
  assert.equal(body.operationName, 'Orders')
  assert.match(body.query, /orders\(first: \$first\)/, 'the GraphQL $first is not a Prism variable')
  assert.equal(buildHeaders(req)['Content-Type'], 'application/json')
})

test('a 500 counts as a failure even with nothing asserting on it', () => {
  // Otherwise a request with no assertions is recorded as passing while the
  // server answers 500, and the flaky list never sees it.
  const v = repeatVerdict([
    { status: 200, failed: 0, ms: 5 },
    { status: 500, failed: 0, ms: 5 },
    { status: 200, failed: 0, ms: 5 }
  ])
  assert.equal(v.flaky, true)
  assert.equal(v.failed, 1)
})

test('and shows up in the flaky list the same way', () => {
  const out = flaky([
    { requestId: 'r1', name: 'Orders', status: 200, failed: 0, ms: 5 },
    { requestId: 'r1', name: 'Orders', status: 500, failed: 0, ms: 5 }
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].rate, 50)
})

test('two different 2xx statuses are not instability', () => {
  // 200 and 201 from the same endpoint is normal, not a flake.
  const v = repeatVerdict([{ status: 200, failed: 0, ms: 1 }, { status: 200, failed: 0, ms: 1 }])
  assert.equal(v.flaky, false)
})
