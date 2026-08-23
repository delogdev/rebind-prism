/**
 * Assertions, as a subject and an operator rather than one fused kind.
 *
 * The builder lets either half be changed on its own — "response time" can
 * become "less than" or "equals" without picking a different assertion from a
 * list — so the model has to hold them apart. Every check returns why it came
 * out the way it did, because a red row that will not say what it saw is a row
 * people delete.
 */

export const SUBJECTS = [
  { id: 'status', label: 'Response status', needs: 'value' },
  { id: 'time', label: 'Response time', needs: 'value', unit: 'ms' },
  { id: 'size', label: 'Response size', needs: 'value', unit: 'bytes' },
  { id: 'contentType', label: 'Content type', needs: 'value' },
  { id: 'header', label: 'Header', needs: 'path+value' },
  { id: 'body', label: 'Response body', needs: 'value' },
  { id: 'json', label: 'JSON path', needs: 'path+value' }
]

export const OPERATORS = {
  status: ['equals', 'notEquals', 'oneOf', 'lessThan', 'isSuccess'],
  time: ['lessThan', 'greaterThan'],
  size: ['lessThan', 'greaterThan'],
  contentType: ['contains', 'equals'],
  header: ['exists', 'equals', 'contains', 'absent'],
  body: ['contains', 'notContains', 'matches', 'isEmpty', 'notEmpty'],
  json: ['exists', 'equals', 'notEquals', 'isType', 'contains', 'absent', 'lengthIs']
}

export const OP_LABEL = {
  equals: 'equals',
  notEquals: 'does not equal',
  oneOf: 'is one of',
  lessThan: 'is under',
  greaterThan: 'is over',
  isSuccess: 'is a success',
  contains: 'contains',
  notContains: 'does not contain',
  matches: 'matches',
  exists: 'exists',
  absent: 'is absent',
  isType: 'is of type',
  isEmpty: 'is empty',
  notEmpty: 'is not empty',
  lengthIs: 'has length'
}

export function emptyAssertion(over = {}) {
  return { id: `as-${Math.random().toString(36).slice(2, 9)}`, subject: 'status', path: '', op: 'equals', value: '200', on: true, ...over }
}

/**
 * Reads a dotted path out of parsed JSON.
 *
 * `data.items[0].id` and `data.items.0.id` both work, because people write
 * both and being strict about it only produces assertions that fail for the
 * wrong reason. Returns `undefined` for anything not present.
 */
export function jsonPath(value, path) {
  if (!path) return value
  let node = value
  for (const part of String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (node === null || node === undefined) return undefined
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Loose where it helps: "200" from a text field must match the number 200. */
function same(a, b) {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  return String(a) === String(b)
}

function show(value) {
  if (value === undefined) return 'nothing'
  if (typeof value === 'string') return `"${value.length > 60 ? `${value.slice(0, 60)}…` : value}"`
  if (value === null) return 'null'
  if (typeof value === 'object') return Array.isArray(value) ? `an array of ${value.length}` : 'an object'
  return String(value)
}

/**
 * Runs one assertion against a response.
 *
 * `response` is `{ status, headers, body, bytes, timing, json }` — `json` is
 * the parsed body when it parsed, so every JSON assertion in a run shares one
 * parse rather than repeating it.
 */
export function check(assertion, response) {
  const a = assertion ?? {}
  const expected = String(a.value ?? '')
  const fail = (detail) => ({ id: a.id, ok: false, detail })
  const pass = (detail) => ({ id: a.id, ok: true, detail })

  switch (a.subject) {
    case 'status': {
      const status = response.status ?? 0
      if (a.op === 'isSuccess') {
        return status >= 200 && status < 300 ? pass(`${status} is a success`) : fail(`${status} is not a success`)
      }
      if (a.op === 'oneOf') {
        const list = expected.split(/[,\s]+/).filter(Boolean)
        return list.some((code) => same(code, status))
          ? pass(`${status} is one of ${list.join(', ')}`)
          : fail(`${status} is not one of ${list.join(', ') || '(nothing listed)'}`)
      }
      if (a.op === 'lessThan') {
        return status < Number(expected) ? pass(`${status} is under ${expected}`) : fail(`${status} is not under ${expected}`)
      }
      if (a.op === 'notEquals') {
        return !same(status, expected) ? pass(`${status} is not ${expected}`) : fail(`${status} is ${expected}`)
      }
      return same(status, expected) ? pass(`${status} as expected`) : fail(`${status}, expected ${expected}`)
    }

    case 'time': {
      const ms = response.timing?.total ?? 0
      if (a.op === 'greaterThan') {
        return ms > Number(expected) ? pass(`${ms}ms is over ${expected}ms`) : fail(`${ms}ms is not over ${expected}ms`)
      }
      return ms < Number(expected) ? pass(`${ms}ms, budget ${expected}ms`) : fail(`took ${ms}ms, budget ${expected}ms`)
    }

    case 'size': {
      const bytes = response.bytes ?? 0
      if (a.op === 'greaterThan') {
        return bytes > Number(expected) ? pass(`${bytes} B is over ${expected}`) : fail(`${bytes} B is not over ${expected}`)
      }
      return bytes < Number(expected) ? pass(`${bytes} B, under ${expected}`) : fail(`${bytes} B, over ${expected}`)
    }

    case 'contentType': {
      const type = header(response, 'content-type')
      if (a.op === 'equals') {
        return same(type, expected) ? pass(`content type is ${expected}`) : fail(`content type is ${show(type)}`)
      }
      return type.toLowerCase().includes(expected.toLowerCase())
        ? pass(`content type ${show(type)}`)
        : fail(`content type ${show(type)} does not contain "${expected}"`)
    }

    case 'header': {
      const name = String(a.path ?? '')
      const has = Object.keys(response.headers ?? {}).some((k) => k.toLowerCase() === name.toLowerCase())
      const value = header(response, name)
      if (a.op === 'absent') return has ? fail(`${name} is present`) : pass(`${name} is absent`)
      if (a.op === 'exists') return has ? pass(`${name} is present`) : fail(`${name} is missing`)
      if (!has) return fail(`${name} is missing`)
      if (a.op === 'contains') {
        return value.includes(expected) ? pass(`${name} contains "${expected}"`) : fail(`${name} is ${show(value)}`)
      }
      return same(value, expected) ? pass(`${name} is ${expected}`) : fail(`${name} is ${show(value)}, expected ${expected}`)
    }

    case 'body': {
      const text = String(response.body ?? '')
      if (a.op === 'isEmpty') return text.length === 0 ? pass('body is empty') : fail(`body has ${text.length} characters`)
      if (a.op === 'notEmpty') return text.length > 0 ? pass(`body has ${text.length} characters`) : fail('body is empty')
      if (a.op === 'notContains') {
        return !text.includes(expected) ? pass(`does not contain "${expected}"`) : fail(`contains "${expected}"`)
      }
      if (a.op === 'matches') {
        let re
        try {
          re = new RegExp(expected)
        } catch (err) {
          // A broken pattern is the assertion's fault, and saying so beats
          // reporting the response as wrong.
          return fail(`that is not a valid pattern — ${err.message}`)
        }
        return re.test(text) ? pass(`matches /${expected}/`) : fail(`does not match /${expected}/`)
      }
      return text.includes(expected) ? pass(`contains "${expected}"`) : fail(`does not contain "${expected}"`)
    }

    case 'json': {
      if (response.json === undefined) return fail('the response is not JSON')
      const found = jsonPath(response.json, a.path)
      const at = a.path ? `${a.path}` : 'the body'
      if (a.op === 'absent') return found === undefined ? pass(`${at} is absent`) : fail(`${at} is ${show(found)}`)
      if (a.op === 'exists') return found !== undefined ? pass(`${at} is present`) : fail(`${at} is missing`)
      if (found === undefined) return fail(`${at} is missing`)
      if (a.op === 'isType') {
        return typeOf(found) === expected ? pass(`${at} is ${expected}`) : fail(`${at} is ${typeOf(found)}, expected ${expected}`)
      }
      if (a.op === 'lengthIs') {
        const length = Array.isArray(found) || typeof found === 'string' ? found.length : undefined
        if (length === undefined) return fail(`${at} is ${typeOf(found)} and has no length`)
        return same(length, expected) ? pass(`${at} has ${length}`) : fail(`${at} has ${length}, expected ${expected}`)
      }
      if (a.op === 'contains') {
        const text = typeof found === 'string' ? found : JSON.stringify(found)
        return text.includes(expected) ? pass(`${at} contains "${expected}"`) : fail(`${at} is ${show(found)}`)
      }
      if (a.op === 'notEquals') {
        return !same(found, expected) ? pass(`${at} is not ${expected}`) : fail(`${at} is ${expected}`)
      }
      return same(found, expected) ? pass(`${at} is ${expected}`) : fail(`${at} is ${show(found)}, expected ${expected}`)
    }

    default:
      return fail('that assertion is not one Prism knows')
  }
}

function header(response, name) {
  const key = Object.keys(response.headers ?? {}).find((k) => k.toLowerCase() === String(name).toLowerCase())
  return key ? String(response.headers[key]) : ''
}

/** Every enabled assertion, in order. */
export function runAll(assertions, response) {
  return (assertions ?? []).filter((a) => a && a.on !== false).map((a) => ({ ...check(a, response), assertion: a }))
}

/**
 * The assertions a recorded call suggests.
 *
 * Deliberately modest: what it did, and a time budget with room in it. A
 * generated suite that fails on its second run because the budget was the
 * first run's exact number gets deleted, and then nothing is tested at all.
 */
export function suggestFor(recorded, json) {
  const out = [emptyAssertion({ subject: 'status', op: 'equals', value: String(recorded?.status ?? 200) })]
  if (/json/i.test(recorded?.contentType ?? '')) {
    out.push(emptyAssertion({ subject: 'contentType', op: 'contains', value: 'json' }))
    const key = firstScalar(json)
    if (key) out.push(emptyAssertion({ subject: 'json', op: 'exists', path: key, value: '' }))
  }
  const budget = Math.max(1000, Math.ceil(((recorded?.durationMs ?? 0) * 3) / 500) * 500)
  out.push(emptyAssertion({ subject: 'time', op: 'lessThan', value: String(budget) }))
  return out
}

/** A shallow path to something scalar, for a first assertion worth making. */
export function firstScalar(value, trail = '', depth = 0) {
  if (depth > 2 || value === null || typeof value !== 'object') return ''
  const entries = Array.isArray(value) ? value.slice(0, 1).map((v, i) => [String(i), v]) : Object.entries(value)
  for (const [key, child] of entries) {
    const path = trail ? `${trail}.${key}` : key
    if (child !== null && (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')) return path
  }
  for (const [key, child] of entries) {
    const found = firstScalar(child, trail ? `${trail}.${key}` : key, depth + 1)
    if (found) return found
  }
  return ''
}
