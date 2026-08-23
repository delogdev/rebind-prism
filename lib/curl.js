/**
 * Reading a cURL command.
 *
 * Prism could already write cURL in fifteen shapes and could not read one
 * back, which is the wrong way round: copy-as-cURL from a browser's network
 * tab is how most requests start life, and retyping one into fields is how
 * people decide a tool is not worth the trouble.
 *
 * The parser is deliberately forgiving about shell quoting and strict about
 * what it claims to understand — a flag it does not know is reported rather
 * than ignored, so nobody discovers a dropped `--form` at send time.
 */
import { emptyRequest } from './collection.js'

/* -------------------------------------------------------------- lexing */

/**
 * Split a command line the way a shell would.
 *
 * Handles single and double quotes, backslash escapes, `$'…'` (which is how
 * Chrome writes a body containing a newline), and the three line-continuation
 * characters people paste: `\` from bash, `^` from cmd, and a backtick from
 * PowerShell.
 */
export function tokenise(text) {
  const src = String(text ?? '')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')

  const out = []
  let token = ''
  let has = false
  let i = 0

  while (i < src.length) {
    const c = src[i]

    if (c === ' ' || c === '\t') {
      if (has) out.push(token)
      token = ''
      has = false
      i += 1
      continue
    }

    // $'…' keeps its backslash escapes, which is the point of the form.
    if (c === '$' && src[i + 1] === "'") {
      i += 2
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') {
          const next = src[i + 1]
          token += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
          i += 2
        } else {
          token += src[i]
          i += 1
        }
      }
      i += 1
      has = true
      continue
    }

    if (c === "'") {
      i += 1
      while (i < src.length && src[i] !== "'") {
        token += src[i]
        i += 1
      }
      i += 1
      has = true
      continue
    }

    if (c === '"') {
      i += 1
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          token += src[i + 1]
          i += 2
        } else {
          token += src[i]
          i += 1
        }
      }
      i += 1
      has = true
      continue
    }

    if (c === '\\' && i + 1 < src.length) {
      token += src[i + 1]
      i += 2
      has = true
      continue
    }

    token += c
    has = true
    i += 1
  }

  if (has) out.push(token)
  return out
}

/* ------------------------------------------------------------- parsing */

/** Flags that take no value, so the next token is not theirs to swallow. */
const BARE = new Set([
  '-L', '--location', '--compressed', '-k', '--insecure', '-s', '--silent',
  '-i', '--include', '-v', '--verbose', '-f', '--fail', '-g', '--globoff',
  '--http1.1', '--http2', '-#', '--progress-bar', '-N', '--no-buffer'
])

/**
 * Whether an unknown flag's next token belongs to it.
 *
 * There is no way to know for certain — curl has flags of both kinds and this
 * one is, by definition, not in the list. So the guess errs towards keeping
 * the URL: `curl --whatever https://api.test` should import the request and
 * mention the flag, not report that there is no URL in it.
 */
const swallows = (next) => Boolean(next) && !next.startsWith('-') && !/^(https?:\/\/|www\.)/i.test(next)

export function fromCurl(text) {
  const tokens = tokenise(text)
  if (!tokens.length) return { ok: false, error: 'There is nothing there to read.' }

  const at = tokens.findIndex((t) => /^curl$/i.test(t) || /curl(\.exe)?$/i.test(t))
  if (at === -1) return { ok: false, error: 'That does not look like a curl command.' }

  const args = tokens.slice(at + 1)
  const headers = []
  const data = []
  const form = []
  const unknown = []
  let url = ''
  let method = ''
  let user = ''
  let asQuery = false
  let insecure = false

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    const value = () => args[++i] ?? ''

    if (!a.startsWith('-')) {
      if (!url) url = a
      continue
    }

    // --header=value is as common as --header value.
    const eq = a.indexOf('=')
    const flag = eq > 2 && a.startsWith('--') ? a.slice(0, eq) : a
    const inline = eq > 2 && a.startsWith('--') ? a.slice(eq + 1) : null
    const next = () => (inline === null ? value() : inline)

    switch (flag) {
      case '-X':
      case '--request':
        method = next().toUpperCase()
        break
      case '-H':
      case '--header':
        headers.push(next())
        break
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-ascii':
      case '--data-binary':
      case '--data-urlencode':
        data.push(next())
        break
      case '--json':
        data.push(next())
        headers.push('Content-Type: application/json')
        break
      case '-F':
      case '--form':
        form.push(next())
        break
      case '-u':
      case '--user':
        user = next()
        break
      case '-b':
      case '--cookie':
        headers.push(`Cookie: ${next()}`)
        break
      case '-A':
      case '--user-agent':
        headers.push(`User-Agent: ${next()}`)
        break
      case '-e':
      case '--referer':
        headers.push(`Referer: ${next()}`)
        break
      case '--url':
        url = next()
        break
      case '-G':
      case '--get':
        asQuery = true
        break
      case '-k':
      case '--insecure':
        insecure = true
        break
      default:
        if (BARE.has(flag)) break
        // Reported rather than skipped: a dropped --cert or --proxy changes
        // what the request does, and finding that out at send time is worse.
        unknown.push(flag)
        if (inline === null && swallows(args[i + 1])) i += 1
    }
  }

  if (!url) return { ok: false, error: 'That command has no URL in it.' }
  if (!/^https?:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: `${url} is not a URL Prism can read.` }
  }

  /* ------------------------------------------------------ into a request */

  const query = [...parsed.searchParams.entries()].map(([key, v]) => row(key, v))
  parsed.search = ''

  const headerRows = []
  let auth = { kind: 'none' }
  let contentType = ''

  for (const line of headers) {
    const cut = line.indexOf(':')
    if (cut < 1) continue
    const key = line.slice(0, cut).trim()
    const v = line.slice(cut + 1).trim()
    if (/^content-type$/i.test(key)) contentType = v

    // An Authorization header becomes the auth block, where the value can be
    // marked secret and swapped per environment. Left as a header it is a
    // literal token in a field that gets exported.
    const bearer = /^authorization$/i.test(key) && /^bearer\s+(.+)$/i.exec(v)
    const basic = /^authorization$/i.test(key) && /^basic\s+(.+)$/i.exec(v)
    if (bearer) {
      auth = { kind: 'bearer', token: bearer[1] }
      continue
    }
    if (basic) {
      const [name, ...rest] = decode64(basic[1]).split(':')
      auth = { kind: 'basic', username: name, password: rest.join(':') }
      continue
    }
    headerRows.push(row(key, v))
  }

  if (user) {
    const [name, ...rest] = user.split(':')
    auth = { kind: 'basic', username: name, password: rest.join(':') }
  }

  const joined = data.join('&')
  if (asQuery && joined) {
    for (const pair of joined.split('&')) {
      const [k, ...v] = pair.split('=')
      query.push(row(decodeURIComponent(k), decodeURIComponent(v.join('='))))
    }
  }

  let bodyKind = 'none'
  let body = ''
  if (form.length) {
    bodyKind = 'form'
    body = form.join('\n')
  } else if (joined && !asQuery) {
    body = joined
    if (/json/i.test(contentType) || looksJson(joined)) bodyKind = 'json'
    else if (/x-www-form-urlencoded/i.test(contentType) || /^[^=&\s]+=/.test(joined)) bodyKind = 'form'
    else bodyKind = 'text'
  }

  if (!method) method = bodyKind === 'none' ? 'GET' : 'POST'

  return {
    ok: true,
    unknown: [...new Set(unknown)],
    insecure,
    request: emptyRequest({
      name: nameFor(parsed),
      method,
      url: parsed.toString(),
      query,
      headers: headerRows,
      auth,
      bodyKind,
      body: bodyKind === 'json' ? pretty(body) : body
    })
  }
}

/* ------------------------------------------------------------- helpers */

const row = (key, value) => ({ key, value, on: true })

/**
 * The path, not the whole URL — and not the method either.
 *
 * Every place a request is drawn already shows the method as a chip beside the
 * name, so putting it in the name too reads "GET GET /orders".
 */
function nameFor(url) {
  return url.pathname.replace(/\/+$/, '') || url.hostname
}

function looksJson(text) {
  const t = String(text ?? '').trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

function pretty(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function decode64(text) {
  try {
    if (typeof atob === 'function') return atob(text)
    return Buffer.from(text, 'base64').toString('utf8')
  } catch {
    return ''
  }
}
