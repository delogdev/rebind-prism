/**
 * The shape of a response, and how it changed.
 *
 * Two jobs. `tree` turns parsed JSON into rows the explorer can render and
 * fold. `diff` compares this response against the last one for the same
 * request — which is the check nobody writes and everybody wants, because the
 * field that quietly went missing never fails a status assertion.
 */

export function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/**
 * Flat rows with a depth, rather than nested nodes.
 *
 * The explorer folds by hiding rows whose path sits under a collapsed one, so
 * a flat list is both what it draws and what it filters — nesting would have
 * to be walked twice for the same result.
 */
export function tree(value, { path = '', key = 'root', depth = 0, out = [], limit = 4000 } = {}) {
  if (out.length >= limit) return out
  const kind = typeOf(value)
  const leaf = kind !== 'object' && kind !== 'array'

  out.push({
    path: path || 'root',
    key,
    depth,
    kind,
    leaf,
    size: leaf ? 0 : Array.isArray(value) ? value.length : Object.keys(value).length,
    preview: leaf ? preview(value) : Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`
  })

  if (leaf) return out
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
  for (const [childKey, child] of entries) {
    tree(child, { path: path ? `${path}.${childKey}` : childKey, key: childKey, depth: depth + 1, out, limit })
  }
  return out
}

function preview(value) {
  if (typeof value === 'string') return value.length > 80 ? `"${value.slice(0, 80)}…"` : `"${value}"`
  return String(value)
}

/**
 * A type sketch, for the schema panel and for OpenAPI export.
 *
 * An array is described by its first element rather than by all of them: the
 * point is to say what the shape is, and a union of forty identical objects
 * says it worse.
 */
export function sketch(value, depth = 0) {
  const kind = typeOf(value)
  if (depth > 6) return { type: kind }
  if (kind === 'array') {
    return value.length ? { type: 'array', items: sketch(value[0], depth + 1) } : { type: 'array' }
  }
  if (kind === 'object') {
    const properties = {}
    for (const [key, child] of Object.entries(value)) properties[key] = sketch(child, depth + 1)
    return { type: 'object', properties }
  }
  if (kind === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' }
  if (kind === 'null') return { type: 'null' }
  return { type: kind }
}

/**
 * What changed between two responses.
 *
 * Reports three kinds of change and says nothing about the rest, so the panel
 * shows a short list rather than the whole body twice. A field whose type
 * changed is called out separately from one whose value did, because they mean
 * very different things to whoever consumes the API.
 */
export function diff(before, after) {
  const changes = []
  walk(before, after, '', changes)
  const RANK = { removed: 0, retyped: 1, added: 2, changed: 3 }
  return changes.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.path.localeCompare(b.path))
}

function walk(a, b, path, out, depth = 0) {
  if (out.length > 400 || depth > 8) return

  const aType = typeOf(a)
  const bType = typeOf(b)

  if (aType !== bType) {
    out.push({ kind: 'retyped', path: path || 'root', from: aType, to: bType, before: a, after: b })
    return
  }

  if (aType === 'object') {
    for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const at = path ? `${path}.${key}` : key
      const inA = Object.prototype.hasOwnProperty.call(a ?? {}, key)
      const inB = Object.prototype.hasOwnProperty.call(b ?? {}, key)
      if (inA && !inB) out.push({ kind: 'removed', path: at, before: a[key] })
      else if (!inA && inB) out.push({ kind: 'added', path: at, after: b[key] })
      else walk(a[key], b[key], at, out, depth + 1)
    }
    return
  }

  if (aType === 'array') {
    if (a.length !== b.length) {
      out.push({ kind: 'changed', path: `${path || 'root'}.length`, before: a.length, after: b.length })
    }
    for (let i = 0; i < Math.min(a.length, b.length, 50); i += 1) {
      walk(a[i], b[i], `${path}[${i}]`, out, depth + 1)
    }
    return
  }

  if (a !== b) out.push({ kind: 'changed', path: path || 'root', before: a, after: b })
}

/** A one-line summary of a diff, for the tab badge. */
export function diffSummary(changes) {
  const counts = { added: 0, removed: 0, changed: 0, retyped: 0 }
  for (const c of changes) counts[c.kind] += 1
  const parts = []
  if (counts.removed) parts.push(`${counts.removed} removed`)
  if (counts.retyped) parts.push(`${counts.retyped} retyped`)
  if (counts.added) parts.push(`${counts.added} added`)
  if (counts.changed) parts.push(`${counts.changed} changed`)
  return parts.join(' · ') || 'identical'
}
