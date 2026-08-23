/**
 * Data-driven runs.
 *
 * One request, sent once per row of a table, with each row's columns available
 * as variables. It is how you test forty inputs against a validation endpoint
 * without making forty requests by hand — and how a single "create order" test
 * covers the empty cart, the oversized cart and the one with a bad SKU.
 *
 * A row's values shadow the environment for that iteration only, and are gone
 * afterwards. Nothing a dataset sets leaks into the next request or the next
 * run; otherwise a run's outcome would depend on what ran before it.
 */

/**
 * Reads CSV.
 *
 * Written out rather than pulled from a library because the format is small
 * and the awkward parts — quoted fields containing commas, newlines and
 * doubled quotes — are exactly the parts a naive `split(',')` gets wrong on
 * real exported data.
 */
export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text ?? '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (src[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += c
      continue
    }

    if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }

  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/**
 * A dataset from a file, whatever shape it came in.
 *
 * Accepts CSV, a JSON array of objects, and a JSON array of arrays with a
 * header row — the three ways people actually have this data lying about.
 *
 * @returns {{ ok: true, dataset: object } | { ok: false, error: string }}
 */
export function readDataset(text, fileName = 'data') {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return { ok: false, error: 'That file is empty.' }

  const name = fileName.replace(/\.[^.]+$/, '')

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let doc
    try {
      doc = JSON.parse(trimmed)
    } catch (err) {
      return { ok: false, error: `${fileName} looks like JSON but will not parse — ${err.message}` }
    }
    const list = Array.isArray(doc) ? doc : Array.isArray(doc.rows) ? doc.rows : null
    if (!list) return { ok: false, error: 'A JSON dataset must be an array of rows.' }
    if (!list.length) return { ok: false, error: 'That dataset has no rows in it.' }

    if (Array.isArray(list[0])) {
      const [header, ...rest] = list
      return finish(name, header.map(String), rest.map((r) => Object.fromEntries(header.map((h, i) => [String(h), str(r[i])]))))
    }
    const columns = [...new Set(list.flatMap((r) => Object.keys(r ?? {})))]
    return finish(name, columns, list.map((r) => Object.fromEntries(columns.map((c) => [c, str(r?.[c])]))))
  }

  const table = parseCsv(trimmed)
  if (table.length < 2) return { ok: false, error: 'A CSV dataset needs a header row and at least one row of data.' }
  const [header, ...rest] = table
  const columns = header.map((h) => h.trim())
  const rows = rest.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()])))
  return finish(name, columns, rows)
}

const str = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

function finish(name, columns, rows) {
  const named = columns.filter(Boolean)
  if (!named.length) return { ok: false, error: 'That dataset has no column names.' }
  return { ok: true, dataset: { name, columns: named, rows } }
}

/**
 * The variables for one iteration: the environment, with the row over it.
 *
 * The row wins, and only for this send. That is the point — the dataset is
 * saying "everything as usual, but with these values".
 */
export function scopeFor(base, row) {
  return { ...(base ?? {}), ...(row ?? {}) }
}

/** A short label for an iteration, from whichever column looks like a name. */
export function labelFor(row, index) {
  const key = Object.keys(row ?? {}).find((k) => /^(name|case|label|title|description|scenario)$/i.test(k))
  const value = key ? String(row[key]).trim() : ''
  if (value) return value
  // Otherwise the first non-empty value, which is nearly always the input
  // under test and reads better in a list than "Row 4".
  const first = Object.values(row ?? {}).find((v) => String(v).trim())
  return first ? `${String(first).slice(0, 32)}` : `Row ${index + 1}`
}

/**
 * What a dataset changes about a request, for the panel that describes it.
 *
 * Columns the request never mentions are dead weight — usually a stale export
 * or a typo in a variable name — and saying so is cheaper than watching every
 * row produce the same result.
 */
export function unusedColumns(dataset, used) {
  const mentioned = new Set(used ?? [])
  return (dataset?.columns ?? []).filter((c) => !mentioned.has(c))
}
