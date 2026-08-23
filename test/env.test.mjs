/**
 * Environments.
 *
 * The parsing tests use the shapes people actually paste — a terminal export,
 * a quoted value with a space in it, a trailing comment — rather than the one
 * clean shape the parser was written against.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDotEnv, audit, looksSecret, copyName, freeName, renameKey } from '../lib/env.js'

/* ------------------------------------------------------------- parsing */

test('reads the three shapes people paste', () => {
  const { values } = parseDotEnv('BASE_URL=https://a.test\nexport TOKEN=abc\nTENANT: northwind')
  assert.deepEqual(values, { BASE_URL: 'https://a.test', TOKEN: 'abc', TENANT: 'northwind' })
})

test('takes the quotes off, and keeps what is inside them', () => {
  const { values } = parseDotEnv('A="two words"\nB=\'single\'\nC="has # a hash"')
  assert.equal(values.A, 'two words')
  assert.equal(values.B, 'single')
  assert.equal(values.C, 'has # a hash', 'a # inside quotes is part of the value')
})

test('drops a trailing comment but not a bare #', () => {
  const { values } = parseDotEnv('PRICE=10 # ten pounds\nFRAGMENT=https://x.test/#/route')
  assert.equal(values.PRICE, '10')
  assert.equal(values.FRAGMENT, 'https://x.test/#/route', 'no space before the # means it is not a comment')
})

test('an empty value is a value', () => {
  const { values } = parseDotEnv('EMPTY=')
  assert.ok('EMPTY' in values)
  assert.equal(values.EMPTY, '')
})

test('a line it cannot read is reported, not swallowed', () => {
  const { values, skipped } = parseDotEnv('GOOD=1\njust some prose\nALSO_GOOD=2')
  assert.deepEqual(Object.keys(values), ['GOOD', 'ALSO_GOOD'])
  assert.deepEqual(skipped, ['just some prose'])
})

test('comments and blank lines are not reported as failures', () => {
  const { skipped, count } = parseDotEnv('# a heading\n\n   \nA=1\n')
  assert.deepEqual(skipped, [])
  assert.equal(count, 1)
})

test('a long unreadable line is trimmed before it is shown', () => {
  const { skipped } = parseDotEnv('x'.repeat(200))
  assert.ok(skipped[0].length <= 60, `${skipped[0].length} characters would break the layout`)
  assert.ok(skipped[0].endsWith('…'))
})

/* -------------------------------------------------------------- audit */

test('missing names are the ones nothing provides', () => {
  const a = audit({ values: { base_url: 'x' } }, ['base_url', 'auth_token'], [])
  assert.deepEqual(a.missing, ['auth_token'])
})

test('a captured value is not missing', () => {
  // The chain provides it at run time. Reporting it would put a permanent
  // false alarm on every workspace that logs in first.
  const a = audit({ values: {} }, ['auth_token'], ['auth_token'])
  assert.deepEqual(a.missing, [])
})

test('a name defined here and captured too is called out as shadowed', () => {
  const a = audit({ values: { auth_token: 'stale' } }, ['auth_token'], ['auth_token'])
  assert.deepEqual(a.shadowed, ['auth_token'])
  assert.deepEqual(a.missing, [])
})

test('unused names are the ones no request mentions', () => {
  const a = audit({ values: { base_url: 'x', leftover: 'y' } }, ['base_url'], [])
  assert.deepEqual(a.unused, ['leftover'])
})

test('a credential-looking name that is not marked secret is flagged', () => {
  const a = audit({ values: { api_key: 'live_123', tenant: 'northwind' }, secrets: [] }, [], [])
  assert.deepEqual(a.unmarked, ['api_key'])
})

test('marking it secret settles the matter', () => {
  const a = audit({ values: { api_key: 'live_123' }, secrets: ['api_key'] }, [], [])
  assert.deepEqual(a.unmarked, [])
  assert.deepEqual(a.secrets, ['api_key'])
})

test('an empty credential-looking name is not flagged', () => {
  // Nothing to leak, and nagging about a blank field is noise.
  assert.deepEqual(audit({ values: { password: '' }, secrets: [] }, [], []).unmarked, [])
})

test('what counts as credential-looking', () => {
  for (const yes of ['token', 'auth_token', 'API_KEY', 'user_password', 'session', 'private_key', 'x_signature']) {
    assert.ok(looksSecret(yes), `${yes} should look like a credential`)
  }
  for (const no of ['base_url', 'tenant', 'monkey', 'keyboard_layout', 'authority_name']) {
    assert.ok(!looksSecret(no), `${no} should not`)
  }
})

/* --------------------------------------------------------------- names */

test('a copy is named after the original, and then numbered', () => {
  assert.equal(copyName('Development', ['Development']), 'Development copy')
  assert.equal(copyName('Development', ['Development', 'Development copy']), 'Development copy 2')
  assert.equal(copyName('Development', ['Development', 'Development copy', 'Development copy 2']), 'Development copy 3')
})

test('adding twice does not overwrite once', () => {
  const values = { new_variable: '' }
  assert.equal(freeName(values), 'new_variable_2')
  values.new_variable_2 = ''
  assert.equal(freeName(values), 'new_variable_3')
})

test('renaming keeps the row where it was', () => {
  const before = { a: '1', b: '2', c: '3' }
  assert.deepEqual(Object.keys(renameKey(before, 'b', 'bee')), ['a', 'bee', 'c'])
  assert.equal(renameKey(before, 'b', 'bee').bee, '2')
})

test('an empty secret is one to refill', () => {
  // What a reopened workspace looks like: the name survived, the value did not.
  const a = audit({ values: { token: '', base_url: 'x' }, secrets: ['token'] }, [], [])
  assert.deepEqual(a.refill, ['token'])
})

test('a secret with a value in it is not', () => {
  assert.deepEqual(audit({ values: { token: 'abc' }, secrets: ['token'] }, [], []).refill, [])
})

test('an empty ordinary variable is not something to refill', () => {
  // Plenty of variables are legitimately empty. Only a secret implies a value
  // was withheld rather than never set.
  assert.deepEqual(audit({ values: { note: '' }, secrets: [] }, [], []).refill, [])
})
