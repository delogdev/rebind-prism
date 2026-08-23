#!/usr/bin/env node
/**
 * Prism on the command line.
 *
 * The point of this file is that it contains almost no logic. Request
 * building, assertions, chaining, datasets and cookies are all pure modules
 * in lib/, exercised by the same tests the app relies on — so a flow that
 * passes on someone's desk passes here for the same reasons, not for
 * coincidentally similar ones.
 *
 *   prism-run checkout.prism.json --env CI --reporter junit --out results.xml
 *
 * Exit code is 0 when everything passed and 1 when anything did not, which is
 * the only thing a CI runner actually reads.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { parse as parseWorkspace, countIn } from './lib/workspace.js'
import { compile } from './lib/request.js'
import { runAll, jsonPath } from './lib/assert.js'
import { Jar } from './lib/cookies.js'
import { scopeFor, labelFor } from './lib/dataset.js'

/* ------------------------------------------------------------------- args */

function parseArgs(argv) {
  const out = { file: '', env: '', reporter: 'text', out: '', flow: '', bail: false, insecure: false, timeout: 30000 }
  const rest = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--env' || a === '-e') out.env = argv[++i] ?? ''
    else if (a === '--reporter' || a === '-r') out.reporter = argv[++i] ?? 'text'
    else if (a === '--out' || a === '-o') out.out = argv[++i] ?? ''
    else if (a === '--flow' || a === '-f') out.flow = argv[++i] ?? ''
    else if (a === '--timeout') out.timeout = Number(argv[++i]) || 30000
    else if (a === '--bail') out.bail = true
    else if (a === '--insecure') out.insecure = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('-')) rest.push(a)
  }
  out.file = rest[0] ?? ''
  return out
}

const HELP = `
prism-run — run a Prism workspace from the command line

  prism-run <workspace.json> [options]

  -e, --env <name>        environment to use, by name
  -f, --flow <name>       run only this flow
  -r, --reporter <kind>   text | json | junit          (default: text)
  -o, --out <path>        write the report to a file instead of stdout
      --timeout <ms>      per request                  (default: 30000)
      --bail              stop at the first failure
      --insecure          do not verify TLS certificates
  -h, --help

Variables come from the chosen environment, and from the process environment
where a name is not set — so a secret withheld from the workspace file can be
supplied as PRISM_<NAME> in CI without ever being committed.

Exits 0 when every assertion passed, 1 otherwise.
`

/* ---------------------------------------------------------------- sending */

/** The same shape the app's main process returns, so results are comparable. */
function send(spec, jar, opts, hops = 5) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(spec.url)
    } catch {
      resolve({ error: `Not a URL: ${spec.url}` })
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      resolve({ error: `Only http and https are supported, not ${url.protocol}` })
      return
    }

    const headers = { ...spec.headers }
    const cookie = jar.header(url.toString())
    if (cookie && !Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')) headers.Cookie = cookie

    const t = { start: Date.now() }
    const driver = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = driver(
      url,
      { method: spec.method, headers, timeout: spec.timeoutMs, rejectUnauthorized: !opts.insecure },
      (res) => {
        const to = res.headers.location
        if (hops > 0 && to && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume()
          const drop = res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && spec.method === 'POST')
          resolve(
            send(
              { ...spec, url: new URL(to, url).toString(), method: drop ? 'GET' : spec.method, body: drop ? undefined : spec.body },
              jar,
              opts,
              hops - 1
            )
          )
          return
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          jar.store(res.headers, url.toString())
          const body = Buffer.concat(chunks).toString('utf8')
          let json
          try {
            json = JSON.parse(body)
          } catch {
            json = undefined
          }
          resolve({
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])),
            body,
            json,
            bytes: Buffer.byteLength(body),
            timing: { total: Date.now() - t.start }
          })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve({ error: `No response within ${spec.timeoutMs}ms` })
    })
    req.on('error', (err) => resolve({ error: err.message }))
    if (spec.body) req.write(spec.body)
    req.end()
  })
}

/* ------------------------------------------------------------------- run */

async function runRequest(req, vars, jar, opts, label) {
  const spec = { ...compile(req, vars), timeoutMs: opts.timeout }
  const res = await send(spec, jar, opts)

  if (res.error) {
    return { name: label, url: spec.url, method: spec.method, error: res.error, ms: 0, checks: [], failed: 1 }
  }

  const checks = runAll(req.assertions, res)
  // A captured value goes back into the scope, which is how the next request
  // in the flow gets the token this one returned.
  for (const cap of req.captures ?? []) {
    if (!cap.name) continue
    const value =
      cap.from === 'header'
        ? Object.entries(res.headers).find(([k]) => k.toLowerCase() === cap.path.toLowerCase())?.[1]
        : jsonPath(res.json, cap.path)
    if (value !== undefined) vars[cap.name] = String(value)
  }

  return {
    name: label,
    url: spec.url,
    method: spec.method,
    status: res.status,
    ms: res.timing.total,
    bytes: res.bytes,
    checks: checks.map((c) => ({ ok: c.ok, detail: c.detail, subject: c.assertion.subject })),
    failed: checks.filter((c) => !c.ok).length
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.file) {
    process.stdout.write(HELP)
    process.exit(opts.file ? 0 : 1)
  }

  let text
  try {
    text = readFileSync(opts.file, 'utf8')
  } catch (err) {
    process.stderr.write(`Cannot read ${opts.file} — ${err.message}\n`)
    process.exit(1)
  }

  const parsed = parseWorkspace(text, opts.file)
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`)
    process.exit(1)
  }
  const ws = parsed.workspace
  if (!countIn(ws)) {
    process.stderr.write('That workspace has no requests in it.\n')
    process.exit(1)
  }

  const env = opts.env
    ? ws.environments.find((e) => e.name.toLowerCase() === opts.env.toLowerCase())
    : ws.environments.find((e) => e.id === ws.envId)
  if (opts.env && !env) {
    const names = ws.environments.map((e) => e.name).join(', ') || 'none'
    process.stderr.write(`No environment called "${opts.env}". This workspace has: ${names}\n`)
    process.exit(1)
  }

  /**
   * Variables, with the process environment filling the gaps.
   *
   * Secrets are withheld when a workspace is saved, so CI must be able to
   * supply them without them ever being committed. `PRISM_AUTH_TOKEN` in the
   * environment becomes `{{auth_token}}` here.
   */
  const base = { ...(env?.values ?? {}) }
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('PRISM_')) continue
    const name = key.slice(6).toLowerCase()
    if (!base[name]) base[name] = value
  }

  const flows = ws.collections
    .flatMap((c) => c.flows)
    .filter((f) => f.requests.length && (!opts.flow || f.name.toLowerCase() === opts.flow.toLowerCase()))

  if (!flows.length) {
    process.stderr.write(opts.flow ? `No flow called "${opts.flow}".\n` : 'Nothing to run.\n')
    process.exit(1)
  }

  const jar = new Jar()
  const started = Date.now()
  const report = { workspace: ws.name, environment: env?.name ?? 'none', flows: [], passed: 0, failed: 0 }
  const quiet = opts.reporter !== 'text' || opts.out

  for (const flow of flows) {
    const results = []
    // Variables carry across a flow — that is what a chain is — but not
    // between flows, so one flow cannot silently depend on another's leftovers.
    const vars = { ...base }

    for (const req of flow.requests) {
      const rows = req.dataset?.rows?.length ? req.dataset.rows : [null]
      for (let i = 0; i < rows.length; i += 1) {
        const label = rows[i] ? `${req.name} [${labelFor(rows[i], i)}]` : req.name
        const scope = rows[i] ? scopeFor(vars, rows[i]) : vars
        const out = await runRequest(req, scope, jar, opts, label)
        results.push(out)
        if (out.failed) report.failed += 1
        else report.passed += 1
        if (!quiet) {
          const mark = out.failed ? '✕' : '✓'
          const detail = out.error ? out.error : `${out.status} ${out.ms}ms`
          process.stdout.write(`  ${mark} ${label}  ${detail}\n`)
          for (const c of out.checks.filter((x) => !x.ok)) process.stdout.write(`      ${c.subject}: ${c.detail}\n`)
        }
        if (out.failed && opts.bail) {
          report.flows.push({ name: flow.name, results })
          return finish(report, started, opts, true)
        }
      }
    }
    report.flows.push({ name: flow.name, results })
  }

  return finish(report, started, opts, false)
}

function finish(report, started, opts, bailed) {
  report.ms = Date.now() - started
  report.bailed = bailed
  const failed = report.failed > 0

  let text = ''
  if (opts.reporter === 'json') text = JSON.stringify(report, null, 2)
  else if (opts.reporter === 'junit') text = junit(report)
  else text = `\n  ${report.passed} passed, ${report.failed} failed in ${report.ms}ms${bailed ? ' (stopped at the first failure)' : ''}\n`

  if (opts.out) {
    writeFileSync(opts.out, text, 'utf8')
    process.stdout.write(`\n  ${report.passed} passed, ${report.failed} failed — report written to ${opts.out}\n`)
  } else {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`)
  }
  process.exit(failed ? 1 : 0)
}

/** JUnit XML, which is what CI systems read to show a test list. */
function junit(report) {
  const esc = (t) =>
    String(t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])

  const suites = report.flows
    .map((flow) => {
      const cases = flow.results
        .map((r) => {
          const time = (r.ms / 1000).toFixed(3)
          if (!r.failed) return `    <testcase name="${esc(r.name)}" classname="${esc(flow.name)}" time="${time}"/>`
          const why = r.error ? r.error : r.checks.filter((c) => !c.ok).map((c) => `${c.subject}: ${c.detail}`).join('\n')
          return `    <testcase name="${esc(r.name)}" classname="${esc(flow.name)}" time="${time}">
      <failure message="${esc(r.error ? 'no response' : `${r.checks.filter((c) => !c.ok).length} assertions failed`)}">${esc(why)}</failure>
    </testcase>`
        })
        .join('\n')
      const failures = flow.results.filter((r) => r.failed).length
      return `  <testsuite name="${esc(flow.name)}" tests="${flow.results.length}" failures="${failures}">
${cases}
  </testsuite>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="${esc(report.workspace)}" tests="${report.passed + report.failed}" failures="${report.failed}" time="${(report.ms / 1000).toFixed(3)}">
${suites}
</testsuites>
`
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`)
  process.exit(1)
})
