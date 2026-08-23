/**
 * A JSON body laid out as lines that know where they are.
 *
 * `JSON.stringify(value, null, 2)` produces exactly the right text and throws
 * away the one thing that makes it useful: which path each line belongs to.
 * Without that, clicking a field in the response to capture or assert on it
 * means guessing the path by counting brackets, which is precisely the chore
 * chaining was supposed to remove.
 *
 * So the printer is written out. The text it emits is byte-for-byte what
 * stringify would produce at two-space indent — tested against it — and every
 * line carries its path, its kind and its value.
 */

const INDENT = '  '

/**
 * @returns {{text: string, path: string, kind: string, value: unknown, leaf: boolean}[]}
 */
export function lines(value, { limit = 5000 } = {}) {
  const out = []
  walk(value, '', 0, out, limit, false)

  // The cap is hard. A soft one let every open container still write its
  // closing brace on the way back up, so a body with four thousand items
  // overran the limit that was meant to keep the pane responsive.
  if (out.length > limit) {
    out.length = limit - 1
    out.push(row('… too long to show in full', '', 'cut', undefined, false))
  }
  return out
}

function walk(value, path, depth, out, limit, trailing) {
  if (out.length >= limit) return
  const pad = INDENT.repeat(depth)
  const comma = trailing ? ',' : ''

  // The key part of the line is written by the caller, which is why every push
  // below takes a prefix: `"total": 3` is one line, not a key line and a value
  // line, and splitting it would put two click targets on one field.
  if (value === null || typeof value !== 'object') {
    out.push(row(pad + scalar(value) + comma, path, kindOf(value), value, true))
    return
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      out.push(row(`${pad}[]${comma}`, path, 'array', value, true))
      return
    }
    out.push(row(`${pad}[`, path, 'array', value, false))
    value.forEach((item, i) => {
      const at = path ? `${path}.${i}` : String(i)
      writeMember(item, at, depth + 1, out, limit, i < value.length - 1, '')
    })
    out.push(row(`${pad}]${comma}`, path, 'array-end', undefined, false))
    return
  }

  const keys = Object.keys(value)
  if (!keys.length) {
    out.push(row(`${pad}{}${comma}`, path, 'object', value, true))
    return
  }
  out.push(row(`${pad}{`, path, 'object', value, false))
  keys.forEach((key, i) => {
    const at = path ? `${path}.${key}` : key
    writeMember(value[key], at, depth + 1, out, limit, i < keys.length - 1, `${JSON.stringify(key)}: `)
  })
  out.push(row(`${pad}}${comma}`, path, 'object-end', undefined, false))
}

/** One member of an object or array: its key prefix plus whatever follows. */
function writeMember(value, path, depth, out, limit, trailing, prefix) {
  if (out.length >= limit) return
  const pad = INDENT.repeat(depth)

  if (value === null || typeof value !== 'object') {
    out.push(row(pad + prefix + scalar(value) + (trailing ? ',' : ''), path, kindOf(value), value, true))
    return
  }

  const empty = Array.isArray(value) ? !value.length : !Object.keys(value).length
  if (empty) {
    out.push(row(pad + prefix + (Array.isArray(value) ? '[]' : '{}') + (trailing ? ',' : ''), path, Array.isArray(value) ? 'array' : 'object', value, true))
    return
  }

  const open = Array.isArray(value) ? '[' : '{'
  const close = Array.isArray(value) ? ']' : '}'
  out.push(row(pad + prefix + open, path, Array.isArray(value) ? 'array' : 'object', value, false))

  if (Array.isArray(value)) {
    value.forEach((item, i) => writeMember(item, `${path}.${i}`, depth + 1, out, limit, i < value.length - 1, ''))
  } else {
    const keys = Object.keys(value)
    keys.forEach((key, i) => writeMember(value[key], `${path}.${key}`, depth + 1, out, limit, i < keys.length - 1, `${JSON.stringify(key)}: `))
  }

  out.push(row(pad + close + (trailing ? ',' : ''), path, Array.isArray(value) ? 'array-end' : 'object-end', undefined, false))
}

const row = (text, path, kind, value, leaf) => ({ text, path, kind, value, leaf })

const scalar = (v) => (v === undefined ? 'null' : JSON.stringify(v))

function kindOf(v) {
  if (v === null) return 'null'
  const t = typeof v
  return t === 'number' || t === 'boolean' || t === 'string' ? t : 'other'
}

/**
 * A variable name worth proposing for a captured field.
 *
 * `data.session.accessToken` becomes `access_token`, because that is what the
 * next request will refer to it as and nobody enjoys renaming it afterwards.
 */
export function suggestName(path) {
  const last = String(path ?? '').split('.').filter((p) => p && !/^\d+$/.test(p)).pop() ?? 'value'
  return last
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'value'
}

/** A path worth offering as a capture: a scalar with a value, not a container. */
const SCALAR = new Set(['string', 'number', 'boolean', 'null'])
export const capturable = (line) => Boolean(line?.leaf) && SCALAR.has(line.kind)
