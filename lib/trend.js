/**
 * What the history is actually for.
 *
 * A list of past runs answers "what happened" and nobody needs help with
 * that — the answer was on screen when it happened. The questions worth
 * keeping runs around for are "is this getting slower" and "does this fail
 * sometimes", and both need the runs to outlive the session, which is why
 * history is now written with the workspace.
 *
 * Everything here is pure and takes the run records as they are stored.
 */

/** Runs for one request, newest first, as the app keeps them. */
const times = (runs) => runs.map((r) => Number(r?.ms) || 0).filter((n) => n > 0)

/**
 * Whether a run went badly.
 *
 * A failed assertion, obviously — but also a 4xx or 5xx, because a request
 * with no assertions on it would otherwise be recorded as passing while the
 * server was answering 500, and "it fails sometimes" is exactly the thing
 * this file exists to notice.
 */
const bad = (run) => Boolean(run?.failed) || Boolean(run?.error) || Number(run?.status) >= 400

export function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  // Nearest-rank: with six samples there is no meaningful interpolation, and
  // a p95 that reports a number nothing ever took is worse than a blunt one.
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

/**
 * How a request has behaved.
 *
 * `recent` and `earlier` split the runs in half rather than comparing the last
 * run to the one before it: a single slow run is usually the machine, and
 * calling that a regression trains people to ignore the badge.
 */
export function summarise(runs = []) {
  const list = runs.filter(Boolean)
  const all = times(list)
  const failures = list.filter(bad).length

  const out = {
    runs: list.length,
    failures,
    passRate: list.length ? Math.round(((list.length - failures) / list.length) * 100) : 0,
    last: list[0]?.ms ?? 0,
    fastest: all.length ? Math.min(...all) : 0,
    slowest: all.length ? Math.max(...all) : 0,
    median: percentile(all, 50),
    p95: percentile(all, 95),
    change: 0,
    verdict: 'steady'
  }

  // Four is the fewest that gives two samples a side. Below that, silence.
  if (all.length >= 4) {
    const half = Math.floor(all.length / 2)
    const recent = percentile(all.slice(0, half), 50)
    const earlier = percentile(all.slice(half), 50)
    if (earlier > 0) {
      out.change = Math.round(((recent - earlier) / earlier) * 100)
      // A fifth either way, and at least 20ms, so a 2ms endpoint drifting to
      // 3ms is not announced as a 50% regression.
      const enough = Math.abs(recent - earlier) >= 20
      if (enough && out.change >= 20) out.verdict = 'slower'
      else if (enough && out.change <= -20) out.verdict = 'faster'
    }
  }

  return out
}

/**
 * Requests that pass sometimes and fail sometimes.
 *
 * The most expensive kind of test failure is the one nobody trusts, and it is
 * invisible in any single run by definition.
 */
export function flaky(runs = []) {
  const byRequest = new Map()
  for (const run of runs.filter(Boolean)) {
    if (!byRequest.has(run.requestId)) byRequest.set(run.requestId, { name: run.name, pass: 0, fail: 0 })
    const at = byRequest.get(run.requestId)
    at.name = run.name || at.name
    if (bad(run)) at.fail += 1
    else at.pass += 1
  }

  return [...byRequest.entries()]
    .filter(([, x]) => x.pass > 0 && x.fail > 0)
    .map(([requestId, x]) => ({
      requestId,
      name: x.name,
      pass: x.pass,
      fail: x.fail,
      rate: Math.round((x.fail / (x.pass + x.fail)) * 100)
    }))
    .sort((a, b) => b.rate - a.rate)
}

/**
 * A sparkline's worth of numbers, oldest to newest.
 *
 * Reversed on the way out because history is stored newest-first and a chart
 * that runs backwards is a chart that lies.
 */
export function spark(runs = [], count = 24) {
  return runs
    .slice(0, count)
    .map((r) => ({ ms: Number(r?.ms) || 0, failed: Boolean(r?.failed), at: r?.at ?? 0 }))
    .reverse()
}

/** One line for a badge. Empty when there is nothing worth saying. */
export function headline(sum) {
  if (!sum.runs) return ''
  if (sum.verdict === 'slower') return `${sum.change}% slower than it was`
  if (sum.verdict === 'faster') return `${Math.abs(sum.change)}% faster than it was`
  if (sum.failures && sum.failures < sum.runs) return `fails ${Math.round((sum.failures / sum.runs) * 100)}% of the time`
  return ''
}

/**
 * Whether a repeat run found instability.
 *
 * Used by "run this ten times": same request, same inputs, so any difference
 * in outcome is the thing being measured rather than a change in the test.
 */
export function repeatVerdict(results = []) {
  const list = results.filter(Boolean)
  const failed = list.filter(bad).length
  const statuses = [...new Set(list.map((r) => r.status ?? 0))]
  const all = times(list)

  return {
    runs: list.length,
    failed,
    passed: list.length - failed,
    statuses,
    stable: failed === 0 || failed === list.length,
    median: percentile(all, 50),
    slowest: all.length ? Math.max(...all) : 0,
    // The interesting case: not "it failed" but "it did both". A run that
    // answered 200 once and 500 once is unstable even when nothing asserted
    // on it, which is why the statuses count as well as the failures.
    flaky: (failed > 0 && failed < list.length) || statuses.length > 1
  }
}
