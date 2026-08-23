/**
 * Environments: the parts worth testing away from the screen.
 *
 * An environment is a bag of names and values, which is simple enough that
 * the interesting questions are all about how it lines up with the requests
 * that spend it — what is missing, what is never used, what is a secret. Those
 * answers belong here rather than inside a render function, because they are
 * the same answers the CLI and the export need.
 */

/**
 * A .env file, or anything close enough to one.
 *
 * People arrive at this field by copying from a terminal, a Vercel dashboard
 * or a colleague's message, so the shapes are `KEY=value`, `export KEY=value`
 * and `KEY: value`. Quotes come off, `#` starts a comment, and a line that is
 * none of those is reported rather than silently dropped — a pasted block that
 * quietly loses two lines is worse than one that refuses.
 */
export function parseDotEnv(text) {
  const values = {}
  const skipped = []

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const m = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*[=:]\s*(.*)$/.exec(line)
    if (!m) {
      skipped.push(line.length > 60 ? `${line.slice(0, 57)}…` : line)
      continue
    }

    let value = m[2].trim()
    // An inline comment only counts when it is outside the quotes, so a value
    // that legitimately contains a # survives.
    const quoted = /^(['"])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]
    else value = value.replace(/\s+#.*$/, '').trim()

    values[m[1]] = value
  }

  return { values, skipped, count: Object.keys(values).length }
}

/** Names that look like a credential, whether or not anyone marked them. */
const SECRETISH = /(^|_)(token|secret|password|passwd|pwd|key|apikey|auth|credential|session|cookie|signature|private)(_|$)/i

export function looksSecret(name) {
  return SECRETISH.test(String(name ?? ''))
}

/**
 * How an environment lines up with the requests that use it.
 *
 * `used` is every {{name}} the workspace refers to, and `captured` is the
 * names requests produce for themselves — a captured token is not missing
 * just because the environment does not define it, and saying so would put a
 * permanent false alarm on every chain.
 */
export function audit(env, used = [], captured = []) {
  const values = env?.values ?? {}
  const secrets = new Set(env?.secrets ?? [])
  const defined = Object.keys(values)
  const usedSet = new Set(used)
  const capturedSet = new Set(captured)

  return {
    defined,
    secrets: defined.filter((name) => secrets.has(name)),
    // Wanted by a request, provided by nothing.
    missing: [...usedSet].filter((name) => !(name in values) && !capturedSet.has(name)),
    // Defined here, referred to nowhere — usually left over from an import.
    unused: defined.filter((name) => !usedSet.has(name)),
    // Set here and also captured at run time: the captured value wins, which
    // surprises people who came here to change the one in the environment.
    shadowed: defined.filter((name) => capturedSet.has(name)),
    // Holds a value that reads like a credential without being marked as one.
    unmarked: defined.filter((name) => !secrets.has(name) && looksSecret(name) && String(values[name] ?? '') !== ''),
    // A secret with nothing in it. Almost always a workspace that has just
    // been reopened — the name was saved, the value deliberately was not —
    // and the alternative to saying so is a puzzling 401 on the next send.
    refill: defined.filter((name) => secrets.has(name) && String(values[name] ?? '') === '')
  }
}

/** "Development" → "Development copy" → "Development copy 2". */
export function copyName(name, existing = []) {
  const taken = new Set(existing)
  const base = `${name} copy`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

/** A free name for a new variable, so adding twice does not overwrite once. */
export function freeName(values, stem = 'new_variable') {
  if (!Object.prototype.hasOwnProperty.call(values, stem)) return stem
  let n = 2
  while (Object.prototype.hasOwnProperty.call(values, `${stem}_${n}`)) n += 1
  return `${stem}_${n}`
}

/**
 * Renaming a key without losing its place in the list.
 *
 * Deleting and re-adding sends the row to the bottom mid-keystroke, which is
 * how a rename turns into a hunt for the row you were just editing.
 */
export function renameKey(values, from, to) {
  const out = {}
  for (const [k, v] of Object.entries(values)) out[k === from ? to : k] = v
  return out
}

/**
 * Two environments, side by side.
 *
 * The question is always "why does this work on Dev and not on Staging", and
 * the answer is almost always one name that is set in one and not the other.
 *
 * A secret is compared as set-or-not and never by value. Putting two live
 * tokens on screen beside each other to demonstrate that they differ — which
 * they obviously do — is not a thing worth doing.
 */
export function compare(a, b) {
  const av = a?.values ?? {}
  const bv = b?.values ?? {}
  const secret = new Set([...(a?.secrets ?? []), ...(b?.secrets ?? [])])
  const names = [...new Set([...Object.keys(av), ...Object.keys(bv)])].sort()

  const onlyInA = []
  const onlyInB = []
  const differing = []
  const same = []

  for (const name of names) {
    const inA = name in av
    const inB = name in bv
    if (inA && !inB) {
      onlyInA.push(name)
      continue
    }
    if (!inA && inB) {
      onlyInB.push(name)
      continue
    }

    if (secret.has(name)) {
      // Set or not is the only comparison a credential gets.
      const setA = String(av[name] ?? '') !== ''
      const setB = String(bv[name] ?? '') !== ''
      if (setA === setB) same.push(name)
      else differing.push({ name, secret: true, a: setA ? 'set' : 'not set', b: setB ? 'set' : 'not set' })
      continue
    }

    if (String(av[name]) === String(bv[name])) same.push(name)
    else differing.push({ name, secret: false, a: String(av[name]), b: String(bv[name]) })
  }

  return { a: a?.name ?? '', b: b?.name ?? '', onlyInA, onlyInB, differing, same }
}
