/**
 * Headers and auth that a collection or a flow hands down.
 *
 * Without this, forty requests each carry their own copy of the same three
 * headers and the same bearer token, and bumping an API version means forty
 * edits — so people stop bumping it and the collection quietly rots.
 *
 * The rule is the one people already expect from CSS and from every config
 * file they have ever edited: the nearest thing wins. A request beats its
 * flow, a flow beats its collection, and anything set explicitly beats
 * anything inherited.
 */

const ON = (r) => r && r.on !== false && r.key
const lower = (s) => String(s ?? '').toLowerCase()

/**
 * The chain, outermost first: [collection, flow].
 *
 * Passing it explicitly rather than looking it up keeps this pure, which is
 * what lets the CLI and the "what will actually be sent" preview agree with
 * the sender.
 */
export function effectiveHeaders(req, chain = []) {
  const out = []
  const byKey = new Map()

  const add = (row, from) => {
    const key = lower(row.key)
    const entry = { key: row.key, value: row.value, on: row.on !== false, from }
    if (byKey.has(key)) {
      // The nearer one replaces the further one in place, so the order people
      // arranged at the top does not shuffle when a request overrides one.
      out[byKey.get(key)] = entry
      return
    }
    byKey.set(key, out.length)
    out.push(entry)
  }

  for (const level of chain) {
    if (!level) continue
    for (const row of level.headers ?? []) {
      if (!row?.key) continue
      add(row, level.name || 'inherited')
    }
  }
  for (const row of req?.headers ?? []) {
    if (!row?.key) continue
    add(row, '')
  }

  return out
}

/**
 * Which auth actually applies.
 *
 * `inherit` means "whatever my parent says", and is the default for a new
 * request so that setting auth once on the collection is enough. `none` is a
 * decision — a login endpoint that must not carry the token it is about to
 * fetch — and it stops the search rather than continuing up.
 */
export function effectiveAuth(req, chain = []) {
  const own = req?.auth ?? { kind: 'none' }
  if (own.kind && own.kind !== 'inherit') return { ...own, from: '' }

  for (const level of [...chain].reverse()) {
    const auth = level?.auth
    if (!auth || !auth.kind || auth.kind === 'inherit') continue
    return { ...auth, from: level.name || 'inherited' }
  }
  return { kind: 'none', from: '' }
}

/**
 * The request as it will actually be sent.
 *
 * compile() takes one request, so inheritance is resolved into a copy before
 * it gets there rather than teaching every downstream reader about the chain.
 */
export function withInherited(req, chain = []) {
  const headers = effectiveHeaders(req, chain).filter(ON).map(({ key, value, on }) => ({ key, value, on }))
  const auth = effectiveAuth(req, chain)
  delete auth.from
  return { ...req, headers, auth }
}

/** What a request is picking up from above, for the UI to show as inherited. */
export function inheritedFor(req, chain = []) {
  const own = new Set((req?.headers ?? []).map((r) => lower(r.key)))
  return {
    headers: effectiveHeaders(req, chain).filter((r) => r.from && !own.has(lower(r.key))),
    auth: effectiveAuth(req, chain)
  }
}

/** Does anything up the chain actually set something? Keeps the UI quiet. */
export function anyInherited(chain = []) {
  return chain.some((level) => (level?.headers ?? []).some((r) => r?.key) || (level?.auth?.kind && level.auth.kind !== 'inherit' && level.auth.kind !== 'none'))
}
