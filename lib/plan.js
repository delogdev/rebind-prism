/**
 * What order a flow actually has to run in.
 *
 * The canvas has always drawn an edge from the request that captures a value
 * to the ones that spend it, and the runner has always ignored those edges and
 * walked the list top to bottom. So the picture said "these two are
 * independent" while the runner treated them as strictly ordered, and a
 * request placed above its own provider sent `{{auth_token}}` unresolved and
 * failed with a 401 that had nothing to do with the server.
 *
 * This turns the edges the canvas already draws into the plan the runner
 * follows: dependencies first, and anything genuinely independent together.
 */
import { variablesUsed } from './request.js'

/** Names a request produces for the rest of the flow. */
export function gives(req) {
  return (req?.captures ?? []).map((c) => c.name).filter(Boolean)
}

/**
 * Names a request needs that this flow has to produce.
 *
 * A name the environment already defines is not a dependency — it is there
 * before anything runs. Nor is one the request captures itself.
 */
export function needs(req, known = []) {
  const own = new Set(gives(req))
  const have = new Set(known)
  return variablesUsed(req).filter((name) => !own.has(name) && !have.has(name))
}

/**
 * The plan.
 *
 * Stages, not a flat order: everything in one stage can run at the same time
 * because nothing in it waits on anything else in it. A twelve-request flow
 * where eight are independent runs in three stages rather than twelve steps.
 *
 * `known` is what the environment provides before the flow starts.
 */
export function plan(requests = [], known = []) {
  const list = requests.filter(Boolean)
  const byId = new Map(list.map((r) => [r.id, r]))

  // Who produces what. A name produced by several requests depends on all of
  // them: which one "wins" is the last to run, and that is only well defined
  // if they have all finished.
  const producers = new Map()
  for (const req of list) {
    for (const name of gives(req)) {
      if (!producers.has(name)) producers.set(name, [])
      producers.get(name).push(req.id)
    }
  }

  const waitsFor = new Map()
  const unresolved = []
  for (const req of list) {
    const wait = new Set()
    for (const name of needs(req, known)) {
      const from = producers.get(name)
      if (!from) {
        unresolved.push({ id: req.id, name: req.name, variable: name })
        continue
      }
      // No self-check: needs() has already dropped the names this request
      // captures for itself, and a second opinion here would just be a place
      // for the two to disagree.
      for (const id of from) wait.add(id)
    }
    waitsFor.set(req.id, wait)
  }

  // Kahn's algorithm, level by level, so the levels are the stages.
  const stages = []
  const done = new Set()
  let left = list.map((r) => r.id)

  while (left.length) {
    const ready = left.filter((id) => [...waitsFor.get(id)].every((dep) => done.has(dep) || !byId.has(dep)))
    // Nothing is ready and things remain: every one of them is waiting on
    // something that is itself waiting. That is a cycle.
    if (!ready.length) break
    stages.push(ready.map((id) => byId.get(id)))
    for (const id of ready) done.add(id)
    left = left.filter((id) => !done.has(id))
  }

  return {
    stages,
    /** Requests caught in a dependency loop, which cannot be run at all. */
    cycles: left.map((id) => byId.get(id)),
    /** Needed by something, produced by nothing and not in the environment. */
    unresolved,
    /** True when the plan is just the list, so the UI can stay quiet. */
    sequential: stages.every((s) => s.length === 1)
  }
}

/**
 * Requests that would run before the thing that provides them.
 *
 * This is the plan compared against the order somebody arranged by hand, and
 * it is the warning worth showing: the list order is what the old runner used
 * and what a reader assumes when they look at the tree.
 */
export function outOfOrder(requests = [], known = []) {
  const at = new Map(requests.map((r, i) => [r.id, i]))
  const out = []

  for (const req of requests) {
    for (const name of needs(req, known)) {
      for (const other of requests) {
        if (other.id === req.id) continue
        if (!gives(other).includes(name)) continue
        if (at.get(other.id) > at.get(req.id)) {
          out.push({ name: req.name, variable: name, from: other.name })
        }
      }
    }
  }
  return out
}

/** A one-line description of the plan, for a runner that is about to start. */
export function describe(p) {
  const total = p.stages.reduce((n, s) => n + s.length, 0)
  if (!total) return 'Nothing to run'
  if (p.sequential) return `${total} request${total === 1 ? '' : 's'}, one after another`
  const widest = Math.max(...p.stages.map((s) => s.length))
  return `${total} requests in ${p.stages.length} stage${p.stages.length === 1 ? '' : 's'}, up to ${widest} at once`
}
