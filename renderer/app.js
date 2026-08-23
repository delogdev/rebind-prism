/**
 * Rebind Prism — the workspace.
 *
 * THE IDEA
 *
 * A request is rarely interesting on its own. What people test is a sequence —
 * log in, take the token, fetch the profile, take the id, place an order — and
 * what breaks is usually the join between two steps rather than either step.
 * So the middle of the screen is a plane with the requests on it and the
 * variables drawn travelling between them.
 *
 * WHY A NODE IS NOT AN EDITOR
 *
 * The node used to open into the whole request form, which made it a different
 * size at every zoom and unreadable at half of them. A node is now a *label*:
 * what it calls, what it needs, what it gives, and how it went last time.
 * Everything editable lives in the workbench on the right. You read the graph
 * on the plane and you change things in one fixed place.
 *
 * THREE LEVELS
 *
 * Collection → flow → request, which is what a Postman file and a Rebind
 * export both actually are. Flattening that lost where a flow came from and
 * made a re-export produce a file shaped differently from the one opened.
 */
import {
  readCollection,
  emptyRequest,
  emptyFlow,
  emptyCollection,
  row,
  uid,
  shortPath,
  countRequests
} from '../lib/collection.js'
import { compile, buildUrl, variablesUsed } from '../lib/request.js'
import { runAll, emptyAssertion, SUBJECTS, OPERATORS, OP_LABEL, suggestFor, jsonPath } from '../lib/assert.js'
import { analyse, bytes as fmtBytes } from '../lib/insights.js'
import { tree, diff, diffSummary } from '../lib/schema.js'
import { TARGETS, GROUPS, WHOLE_FLOW, generate, slug } from '../lib/codegen.js'
import { SETTINGS, GROUPS as SET_GROUPS, load as loadSettings, save as saveSettings, themeAttribute } from '../lib/settings.js'
import { demoWorkspace } from './demo.js'

/* ============================================================== plumbing */

const $ = (id) => document.getElementById(id)

const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k === 'html') n.innerHTML = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of [].concat(kids)) if (kid) n.append(kid)
  return n
}

const ico = (d, size = 13, w = 2) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`

const I = {
  play: '<path d="M7 4v16l13-8z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  bin: '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  flow: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5"/>',
  pencil: '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  up: '<path d="M12 14V4"/><path d="m8 8 4-4 4 4"/><path d="M4 20h16"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function toast(kind, text) {
  const n = el('div', { class: `toast ${kind}` }, [el('i'), el('span', { text })])
  $('notes').append(n)
  setTimeout(() => {
    n.style.opacity = '0'
    setTimeout(() => n.remove(), 200)
  }, 3200)
}

/* ================================================================= state */

const S = {
  collections: [],
  recorded: [],
  environments: [],
  envId: '',
  pickedId: '',
  layout: new Map(),
  /** Nodes the user has dragged. Auto-stacking leaves these alone. */
  moved: new Set(),
  results: new Map(),
  previous: new Map(),
  busy: new Set(),
  history: [],
  editTab: 'params',
  respTab: 'brief',
  view: { x: 90, y: 70, z: 1 },
  split: 55,
  /** 'split' | 'request' | 'response' — which half has the panel. */
  pane: 'split',
  prefs: {}
}

const allFlows = () => S.collections.flatMap((c) => c.flows)
const allRequests = () => allFlows().flatMap((f) => f.requests)
const findRequest = (id) => allRequests().find((r) => r.id === id) ?? null
const flowOf = (id) => allFlows().find((f) => f.requests.some((r) => r.id === id)) ?? null
const collectionOf = (id) => S.collections.find((c) => c.flows.some((f) => f.requests.some((r) => r.id === id))) ?? null
const current = () => findRequest(S.pickedId)
const environment = () => S.environments.find((e) => e.id === S.envId) ?? null
const envValues = () => environment()?.values ?? {}

function commit(what = 'all') {
  if (what === 'all' || what === 'tree') paintTree()
  if (what === 'all' || what === 'plane') paintPlane()
  if (what === 'all' || what === 'bench') paintBench()
  if (what === 'all') paintBar()
  drawBeams()
}

/* ================================================================= theme */

/**
 * Puts the chosen theme on the root element.
 *
 * Three states, not two. 'system' deliberately sets *no* attribute, which
 * leaves the `prefers-color-scheme` block in charge and lets the app follow
 * the machine while it is open. An explicit choice stamps the attribute and
 * wins over the system in both directions.
 */
function applyTheme() {
  const attr = themeAttribute(S.prefs.theme)
  if (attr) document.documentElement.setAttribute('data-theme', attr)
  else document.documentElement.removeAttribute('data-theme')
}

function setPref(id, value) {
  S.prefs[id] = value
  saveSettings(safeStorage(), S.prefs)
}

/** localStorage throws outright in some contexts rather than returning null. */
function safeStorage() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/* =================================================================== bar */

function paintBar() {
  const req = current()
  const flow = req ? flowOf(req.id) : null
  const col = req ? collectionOf(req.id) : S.collections[0]
  const crumbs = $('crumbs')
  crumbs.replaceChildren()
  ;[col?.name, flow?.name].filter(Boolean).forEach((bit, i) => {
    if (i) crumbs.append(el('i', { text: '/' }))
    crumbs.append(el('span', { text: bit }))
  })

  const env = environment()
  $('envLabel').textContent = env ? env.name : 'No environment'
  $('envDot').className = `env-dot${env ? ' on' : ''}${env && /prod|live|release/i.test(env.name) ? ' risky' : ''}`
  $('runFlowBtn').disabled = !allFlows().some((f) => f.requests.length)
  $('exportBtn').disabled = !allRequests().length
}

/* ================================================================== tree */

/* --------------------------------------------------------------- the tree

   Every row is the same shape: twist, glyph, name, count, one actions button.
   The actions button is always in the layout and only becomes visible on
   hover, so nothing moves when the pointer crosses a row — a menu that shifts
   the thing you were aiming at is a menu you misclick. */

/** The row currently being renamed in place, if any. */
let renaming = ''

function paintTree() {
  const host = $('treeBody')
  host.replaceChildren()

  if (!S.collections.length) {
    host.append(
      el('p', { class: 'tree-nothing', html: 'No collections yet.<br />Import a Rebind recording or a Postman collection.' })
    )
    return
  }

  for (const col of S.collections) {
    const flows = el('div', { class: 'kids' })

    for (const flow of col.flows) {
      const reqs = el('div', { class: 'kids' })
      for (const req of flow.requests) {
        const res = S.results.get(req.id)
        const state = S.busy.has(req.id) ? 'busy' : res ? (res.failed ? 'fail' : 'pass') : ''
        reqs.append(
          treeRow({
            cls: `req-row${req.id === S.pickedId ? ' on' : ''}`,
            title: req.url || req.name,
            lead: el('span', { class: `verb ${req.method.toLowerCase()}`, text: req.method }),
            id: req.id,
            name: req.name || 'Untitled',
            onOpen: () => pick(req.id),
            onRename: (next) => {
              req.name = next
              commit()
            },
            trail: el('span', { class: `state ${state}` }),
            menu: () => requestMenu(req)
          })
        )
      }

      flows.append(
        el('div', { class: `flow${flow.open === false ? ' shut' : ''}` }, [
          treeRow({
            cls: 'flow-row',
            twist: () => {
              flow.open = flow.open === false
              paintTree()
            },
            open: flow.open !== false,
            glyph: I.flow,
            id: flow.id,
            name: flow.name,
            count: flow.requests.length,
            onOpen: () => {
              flow.open = flow.open === false
              paintTree()
            },
            onRename: (next) => {
              flow.name = next
              commit()
            },
            menu: () => flowMenu(col, flow)
          }),
          reqs
        ])
      )
    }

    host.append(
      el('div', { class: `col${col.open === false ? ' shut' : ''}` }, [
        treeRow({
          cls: 'col-row',
          twist: () => {
            col.open = col.open === false
            paintTree()
          },
          open: col.open !== false,
          glyph: I.folder,
          id: col.id,
          name: col.name,
          tag: col.source && col.source !== 'canvas' ? sourceTag(col.source) : '',
          onOpen: () => {
            col.open = col.open === false
            paintTree()
          },
          onRename: (next) => {
            col.name = next
            commit()
          },
          menu: () => collectionMenu(col)
        }),
        flows
      ])
    )
  }
}

/**
 * One row of the tree.
 *
 * The name is a button until you rename it, at which point the same box
 * becomes an input in place — no dialog, because renaming is a thing people do
 * to six items in a row and a dialog each time is six dismissals.
 */
function treeRow({ cls, title, twist, open, glyph, lead, id, name, count, tag, trail, onOpen, onRename, menu }) {
  const row = el('div', { class: cls, title })

  if (twist) {
    row.append(
      el('button', {
        class: 'twist',
        type: 'button',
        'aria-label': open ? `Collapse ${name}` : `Expand ${name}`,
        html: ico(I.down, 11, 2.4),
        onclick: (e) => {
          e.stopPropagation()
          twist()
        }
      })
    )
  }
  if (glyph) row.append(el('span', { class: 'row-glyph', html: ico(glyph, 13, 1.8) }))
  if (lead) row.append(lead)

  if (renaming === id) {
    const input = el('input', {
      class: 'row-rename',
      value: name,
      'aria-label': 'Name',
      onkeydown: (e) => {
        if (e.key === 'Enter') e.target.blur()
        if (e.key === 'Escape') {
          renaming = ''
          paintTree()
        }
      },
      onblur: (e) => {
        const next = e.target.value.trim()
        renaming = ''
        if (next && next !== name) onRename(next)
        else paintTree()
      }
    })
    row.append(input)
    requestAnimationFrame(() => {
      input.focus()
      input.select()
    })
  } else {
    row.append(el('button', { class: 'row-name', type: 'button', text: name, onclick: onOpen }))
    if (count !== undefined) row.append(el('span', { class: 'count', text: String(count) }))
    if (tag) row.append(el('span', { class: 'tag', text: tag }))
    if (trail) row.append(trail)
  }

  const more = el('button', {
    class: 'row-more',
    type: 'button',
    title: 'Actions',
    'aria-label': `Actions for ${name}`,
    'aria-haspopup': 'menu',
    html: ico('<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>', 13, 1.6),
    onclick: (e) => {
      e.stopPropagation()
      openMenu(e.currentTarget, menu())
    }
  })
  row.append(more)

  row.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openMenu(more, menu())
  })
  return row
}

function startRename(id) {
  renaming = id
  paintTree()
}

/* ------------------------------------------------------------- the menus */

function collectionMenu(col) {
  const requests = col.flows.flatMap((f) => f.requests)
  return [
    { label: 'Rename', keys: 'F2', icon: I.pencil, run: () => startRename(col.id) },
    { label: 'New flow', icon: I.plus, run: () => addFlow(col) },
    { label: 'Duplicate', icon: I.copy, run: () => duplicateCollection(col) },
    { sep: true },
    { label: 'Run every flow', icon: I.play, disabled: !requests.length, run: () => runCollection(col) },
    { label: 'Export collection', icon: I.up, disabled: !requests.length, run: () => openExport(col.flows[0], null) },
    { sep: true },
    { label: 'Collapse all flows', icon: I.down, run: () => {
      for (const f of col.flows) f.open = false
      paintTree()
    } },
    { sep: true },
    { label: 'Delete collection', icon: I.bin, danger: true, run: () => askDeleteCollection(col) }
  ]
}

function flowMenu(col, flow) {
  return [
    { label: 'Rename', keys: 'F2', icon: I.pencil, run: () => startRename(flow.id) },
    { label: 'New request', icon: I.plus, run: () => addRequest(flow) },
    { label: 'Duplicate', icon: I.copy, run: () => duplicateFlow(col, flow) },
    { sep: true },
    { label: 'Run flow', icon: I.play, disabled: !flow.requests.length, run: () => runFlow(flow) },
    { label: 'Export flow', icon: I.up, disabled: !flow.requests.length, run: () => openExport(flow, null) },
    { sep: true },
    { label: 'Delete flow', icon: I.bin, danger: true, run: () => askDeleteFlow(col, flow) }
  ]
}

function requestMenu(req) {
  const flow = flowOf(req.id)
  return [
    { label: 'Rename', keys: 'F2', icon: I.pencil, run: () => startRename(req.id) },
    { label: 'Open', icon: I.eye, run: () => pick(req.id) },
    { label: 'Duplicate', icon: I.copy, run: () => duplicateRequest(flow, req) },
    { sep: true },
    { label: 'Send', keys: 'Ctrl ↵', icon: I.play, run: () => send(req) },
    { label: 'Export request', icon: I.up, run: () => openExport(flow, req) },
    { label: 'Copy as cURL', icon: I.copy, run: () => {
      navigator.clipboard.writeText(generate('curl', { request: req, flow, environment: environment() }))
      toast('ok', 'cURL copied')
    } },
    { sep: true },
    { label: 'Delete request', icon: I.bin, danger: true, run: () => askDeleteRequest(req) }
  ]
}

/* ------------------------------------------------------------ duplicating */

/** A deep copy with fresh ids, so the two do not share rows or assertions. */
function copyRequest(req) {
  const clone = structuredClone(req)
  clone.id = uid('req')
  for (const key of ['query', 'pathParams', 'headers']) {
    clone[key] = (clone[key] ?? []).map((r) => ({ ...r, id: uid('row') }))
  }
  clone.assertions = (clone.assertions ?? []).map((a) => ({ ...a, id: uid('as') }))
  clone.captures = (clone.captures ?? []).map((c) => ({ ...c, id: uid('cap') }))
  return clone
}

function duplicateRequest(flow, req) {
  if (!flow) return
  const clone = copyRequest(req)
  clone.name = `${req.name} copy`
  flow.requests.splice(flow.requests.indexOf(req) + 1, 0, clone)
  S.pickedId = clone.id
  commit()
  toast('ok', `Duplicated ${req.name}`)
}

function duplicateFlow(col, flow) {
  const clone = emptyFlow(`${flow.name} copy`, flow.requests.map(copyRequest))
  col.flows.splice(col.flows.indexOf(flow) + 1, 0, clone)
  commit()
  toast('ok', `Duplicated ${flow.name}`)
}

function duplicateCollection(col) {
  const clone = emptyCollection(
    `${col.name} copy`,
    col.flows.map((f) => emptyFlow(f.name, f.requests.map(copyRequest))),
    col.source
  )
  S.collections.splice(S.collections.indexOf(col) + 1, 0, clone)
  commit()
  toast('ok', `Duplicated ${col.name}`)
}

/* --------------------------------------------------------- the popup menu */

function openMenu(anchor, items) {
  closeMenu()
  const box = anchor.getBoundingClientRect()
  const menu = el('div', { class: 'menu', role: 'menu' })

  for (const item of items) {
    if (item.sep) {
      menu.append(el('div', { class: 'menu-sep' }))
      continue
    }
    menu.append(
      el('button', {
        class: `menu-item${item.danger ? ' danger' : ''}`,
        type: 'button',
        role: 'menuitem',
        disabled: item.disabled === true,
        onclick: () => {
          closeMenu()
          item.run()
        }
      }, [
        el('span', { class: 'menu-icon', html: ico(item.icon, 13, 1.8) }),
        el('span', { class: 'menu-label', text: item.label }),
        item.keys ? el('span', { class: 'menu-keys', text: item.keys }) : null
      ])
    )
  }

  document.body.append(menu)
  // Placed after measuring, and flipped up or left when it would fall off.
  const w = menu.offsetWidth
  const h = menu.offsetHeight
  const left = Math.min(box.left, window.innerWidth - w - 10)
  const top = box.bottom + h + 10 > window.innerHeight ? box.top - h - 4 : box.bottom + 4
  menu.style.left = `${Math.max(8, left)}px`
  menu.style.top = `${Math.max(8, top)}px`

  // Closing on any pointerdown removed the menu before the click could land
  // on the item, so every entry did nothing at all. Only a press *outside*
  // dismisses it.
  setTimeout(() => {
    window.addEventListener('pointerdown', menuAway, true)
    window.addEventListener('keydown', menuKey)
  }, 0)
  menu.querySelector('.menu-item:not([disabled])')?.focus()
}

function menuAway(e) {
  if (!e.target.closest?.('.menu')) closeMenu()
}

function menuKey(e) {
  if (e.key === 'Escape') closeMenu()
}

function closeMenu() {
  document.querySelector('.menu')?.remove()
  window.removeEventListener('pointerdown', menuAway, true)
  window.removeEventListener('keydown', menuKey)
}

const sourceTag = (s) => ({ postman: 'postman', 'rebind-workspace': 'rebind', 'rebind-suite': 'rebind' })[s] ?? s

/* ------------------------------------------------------- add and delete */

function addFlow(col) {
  const flow = emptyFlow(`Flow ${col.flows.length + 1}`)
  col.flows.push(flow)
  commit()
  toast('ok', `Added ${flow.name}`)
}

function addRequest(flow) {
  const req = emptyRequest({ name: 'New request', url: '{{base_url}}/' })
  flow.requests.push(req)
  S.pickedId = req.id
  commit()
  setTimeout(fit, 20)
}

function newCollection() {
  const col = emptyCollection(`Collection ${S.collections.length + 1}`, [emptyFlow('Flow 1')])
  S.collections.push(col)
  commit()
}

/**
 * Deleting.
 *
 * Always confirmed, and always specific about what goes with it — deleting a
 * flow takes its requests, and a count is the difference between a decision
 * and a surprise. None of it is undoable, so the dialog is the safety net.
 */
function askDeleteRequest(req) {
  const goes = []
  const n = (req.assertions ?? []).length
  const c = (req.captures ?? []).filter((x) => x.name).length
  if (n) goes.push(`${n} assertion${n === 1 ? '' : 's'}`)
  if (c) goes.push(`${c} captured value${c === 1 ? '' : 's'}`)
  if (S.results.has(req.id)) goes.push('its last result and any history')

  askDelete({
    kind: 'request',
    subject: subjectCard(req),
    goes,
    breaks: dependants([req]),
    danger: 'Delete request',
    onYes: () => {
      const flow = flowOf(req.id)
      if (!flow) return
      flow.requests = flow.requests.filter((r) => r.id !== req.id)
      forget(req.id)
      if (S.pickedId === req.id) S.pickedId = allRequests()[0]?.id ?? ''
      commit()
      toast('ok', `Deleted ${req.name || 'the request'}`)
    }
  })
}

function askDeleteFlow(col, flow) {
  const n = flow.requests.length
  const goes = n
    ? [
        `${n} request${n === 1 ? '' : 's'}: ${flow.requests
          .slice(0, 4)
          .map((r) => r.name)
          .join(', ')}${n > 4 ? `, and ${n - 4} more` : ''}`
      ]
    : []

  askDelete({
    kind: 'flow',
    subject: subjectGroup(I.flow, flow.name, `in ${col.name}`),
    goes,
    breaks: dependants(flow.requests),
    danger: n ? `Delete flow and ${n} request${n === 1 ? '' : 's'}` : 'Delete flow',
    onYes: () => {
      for (const r of flow.requests) forget(r.id)
      col.flows = col.flows.filter((f) => f.id !== flow.id)
      if (!findRequest(S.pickedId)) S.pickedId = allRequests()[0]?.id ?? ''
      commit()
      toast('ok', `Deleted ${flow.name}`)
    }
  })
}

function askDeleteCollection(col) {
  const requests = col.flows.flatMap((f) => f.requests)
  const goes = []
  if (col.flows.length) goes.push(`${col.flows.length} flow${col.flows.length === 1 ? '' : 's'}: ${col.flows.map((f) => f.name).join(', ')}`)
  if (requests.length) goes.push(`${requests.length} request${requests.length === 1 ? '' : 's'}`)
  goes.push('The file you imported it from is untouched')

  askDelete({
    kind: 'collection',
    subject: subjectGroup(I.folder, col.name, col.source && col.source !== 'canvas' ? `imported from ${sourceTag(col.source)}` : 'made here'),
    goes,
    breaks: dependants(requests),
    danger: 'Delete collection',
    onYes: () => {
      for (const r of requests) forget(r.id)
      S.collections = S.collections.filter((c) => c.id !== col.id)
      if (!findRequest(S.pickedId)) S.pickedId = allRequests()[0]?.id ?? ''
      commit()
      toast('ok', `Deleted ${col.name}`)
    }
  })
}

/** Everything held against a request id, so nothing is left behind. */
function forget(id) {
  S.layout.delete(id)
  S.moved.delete(id)
  S.results.delete(id)
  S.previous.delete(id)
  S.busy.delete(id)
  S.history = S.history.filter((h) => h.requestId !== id)
}

/* ================================================================= plane */

/** Space is a modifier for panning, read by both the plane and each node. */
let spaceHeld = false

const NODE_W = 268
const COL_GAP = 360
// Generous: a node with four ports is a good deal taller than one with none,
// and nodes that overlap on first open make the graph look broken.
const ROW_GAP = 208

function place() {
  let column = 0
  for (const flow of allFlows()) {
    flow.requests.forEach((req, i) => {
      if (!S.layout.has(req.id)) S.layout.set(req.id, { x: 40 + column * COL_GAP, y: 40 + i * ROW_GAP })
    })
    if (flow.requests.length) column += 1
  }
}

function tidy() {
  S.layout.clear()
  S.moved.clear()
  place()
  commit('plane')
  setTimeout(fit, 20)
}

function paintPlane() {
  place()
  const host = $('nodes')
  host.replaceChildren()
  applyView()
  const list = allRequests()
  $('planeEmpty').hidden = list.length > 0
  for (const req of list) host.append(nodeFor(req))
  restack()
}

/**
 * Even gaps, measured rather than assumed.
 *
 * A node with four ports is half as tall again as one with none, so any fixed
 * row height either wastes space or overlaps. This reads the heights the
 * browser actually produced and re-stacks each column with a constant gap
 * between the boxes — skipping anything the user has dragged, because a node
 * someone placed by hand must stay where they put it.
 */
function restack() {
  const GAP = 34
  for (const flow of allFlows()) {
    let y = null
    for (const req of flow.requests) {
      const at = S.layout.get(req.id)
      const node = document.querySelector(`.node[data-id="${req.id}"]`)
      if (!at || !node) continue
      if (S.moved.has(req.id)) {
        y = null
        continue
      }
      if (y !== null) {
        at.y = y
        node.style.top = `${y}px`
      }
      y = at.y + node.offsetHeight + GAP
    }
  }
  drawBeams()
}

/**
 * One node.
 *
 * Fixed width, four bands: what it is, where it goes, what it trades, how it
 * went. Nothing on it can be edited, which is exactly what lets it stay the
 * same size and stay readable when the plane is zoomed out.
 */
function nodeFor(req) {
  const at = S.layout.get(req.id)
  const res = S.results.get(req.id)
  const verb = req.method.toLowerCase()
  const known = envValues()

  const node = el('div', {
    class: `node${req.id === S.pickedId ? ' on' : ''}${S.busy.has(req.id) ? ' busy' : ''}`,
    style: `left:${at.x}px;top:${at.y}px`,
    'data-id': req.id,
    tabindex: '0',
    role: 'button',
    'aria-label': `${req.method} ${req.name}`
  })

  node.append(el('span', { class: `node-line ${verb}` }))
  node.append(
    el('div', { class: 'node-top' }, [
      el('span', { class: `verb ${verb}`, text: req.method }),
      el('span', { class: 'node-name', text: req.name || 'Untitled' })
    ])
  )
  node.append(el('span', { class: 'node-path', html: pathLabel(req.url) }))
  node.append(specStrip(req))

  /* ports — what it needs on the left, what it gives on the right, on the
     same sides the beams arrive and leave from. */
  const needs = variablesUsed(req)
  const gives = (req.captures ?? []).filter((c) => c.name).map((c) => c.name)
  if ((needs.length || gives.length) && S.prefs.showPorts !== false) {
    const inCol = el('div', { class: 'port-col' })
    for (const name of needs.slice(0, 4)) {
      const from = allRequests().find((r) => (r.captures ?? []).some((c) => c.name === name))
      const met = Boolean(from) || Object.prototype.hasOwnProperty.call(known, name)
      inCol.append(
        el('span', {
          class: `port needs${met ? '' : ' unmet'}`,
          title: from ? `captured by ${from.name}` : met ? 'set in the environment' : 'nothing provides this',
          html: `<span class="port-dot"></span>${esc(name)}`
        })
      )
    }
    if (needs.length > 4) inCol.append(el('span', { class: 'port needs', text: `+${needs.length - 4} more` }))

    const outCol = el('div', { class: 'port-col out' })
    for (const name of gives.slice(0, 4)) {
      outCol.append(el('span', { class: 'port gives', html: `${esc(name)}<span class="port-dot"></span>` }))
    }
    if (gives.length > 4) outCol.append(el('span', { class: 'port gives', text: `+${gives.length - 4}` }))

    node.append(el('div', { class: 'ports' }, [inCol, outCol]))
  }

  const foot = el('div', { class: 'node-foot' })
  const n = (req.assertions ?? []).length
  if (res) {
    foot.append(el('span', { class: `code ${tone(res.status)}`, text: res.error ? 'ERR' : String(res.status) }))
    if (!res.error) {
      foot.append(el('span', { text: `${res.timing?.total ?? 0}ms` }))
      foot.append(el('span', { text: fmtBytes(res.bytes) }))
    }
    if (n) {
      foot.append(
        el('span', { class: `checks ${res.failed ? 'fail' : 'pass'}`, text: res.failed ? `${res.failed}/${n} failed` : `${n} passed` })
      )
    }
  } else if (req.recorded) {
    // Never run here, but it was recorded doing something — which is a far
    // more useful thing to show than "no assertions".
    foot.append(el('span', { class: `code ${tone(req.recorded.status)} ghost`, text: String(req.recorded.status) }))
    foot.append(el('span', { text: `${req.recorded.durationMs}ms when recorded` }))
  } else {
    foot.append(el('span', { text: n ? `${n} assertion${n === 1 ? '' : 's'}` : 'no assertions' }))
  }
  foot.append(el('span', { class: 'spacer' }))
  foot.append(
    el('button', {
      class: 'node-run',
      type: 'button',
      title: 'Send this request',
      'aria-label': `Send ${req.name}`,
      html: ico(I.play, 10),
      onclick: (e) => {
        e.stopPropagation()
        send(req)
      }
    })
  )
  node.append(foot)

  node.addEventListener('pointerdown', (e) => drag(e, req, node))
  node.addEventListener('click', (e) => {
    if (node.dataset.moved) {
      delete node.dataset.moved
      return
    }
    if (!e.target.closest('button')) pick(req.id)
  })
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(req.id)
    }
  })
  return node
}

/**
 * What the request is made of, at a glance.
 *
 * The name and the path say which endpoint. This says what will actually go
 * out — how it authenticates, whether it carries a body, how many parameters
 * and headers ride along — which is the difference between recognising a node
 * and understanding it. Anything that is zero or none is left out rather than
 * shown as an empty count; a row of noughts is noise.
 */
function specStrip(req) {
  const strip = el('div', { class: 'spec' })
  const chip = (kind, text, title) => strip.append(el('span', { class: `sc ${kind}`, title, text }))

  const auth = req.auth?.kind ?? 'none'
  if (auth !== 'none') chip('auth', AUTH_SHORT[auth] ?? auth, `Authenticates with ${auth}`)
  else chip('open', 'no auth', 'Sends no credential')

  if (req.bodyKind && req.bodyKind !== 'none') {
    const size = (req.body ?? '').length
    chip('body', req.bodyKind, `${req.bodyKind} body, ${size} characters`)
  }

  const q = (req.query ?? []).filter((r) => r.on !== false && r.key).length
  const pp = (req.pathParams ?? []).filter((r) => r.on !== false && r.key).length
  const h = (req.headers ?? []).filter((r) => r.on !== false && r.key).length
  if (q) chip('n', `${q} query`, `${q} query parameter${q === 1 ? '' : 's'}`)
  if (pp) chip('n', `${pp} path`, `${pp} path parameter${pp === 1 ? '' : 's'}`)
  if (h) chip('n', `${h} header${h === 1 ? '' : 's'}`, `${h} header${h === 1 ? '' : 's'}`)

  // The host only when it is a literal. When it comes from {{base_url}} the
  // environment decides, and printing the variable twice helps nobody.
  const host = literalHost(req.url)
  if (host) chip('host', host, `Sent to ${host}`)

  return strip
}

const AUTH_SHORT = { bearer: 'bearer', basic: 'basic', apiKey: 'api key', oauth2: 'oauth2', jwt: 'jwt', custom: 'custom' }

function literalHost(url) {
  const text = String(url ?? '')
  if (!text || text.startsWith('{{')) return ''
  try {
    return new URL(text).host
  } catch {
    return ''
  }
}

const markVars = (t) => esc(t).replace(/\{\{[\w.-]+\}\}/g, (m) => `<span class="node-var">${m}</span>`)

/**
 * The endpoint, written so the path is what you read.
 *
 * A leading `{{base_url}}` is the same on every node in a collection, so it is
 * kept — dropping it would be a lie about what gets sent — but dimmed, and the
 * path after it takes the emphasis and the space.
 */
function pathLabel(url) {
  const text = String(url ?? '')
  if (!text) return '—'
  const m = /^(\{\{[\w.-]+\}\})(.*)$/.exec(text)
  if (m) return `<span class="node-base">${esc(m[1])}</span>${markVars(m[2])}`
  return markVars(text)
}

function tone(status) {
  if (!status || status >= 500) return 'bad'
  if (status >= 400) return 'warn'
  if (status >= 300) return 'info'
  return 'ok'
}

function word(status) {
  if (!status) return 'no response'
  if (status >= 500) return 'server error'
  if (status >= 400) return 'client error'
  if (status >= 300) return 'redirect'
  return 'ok'
}

/* ------------------------------------------------------------------ beams */

/**
 * A beam exists where one request captures a value that another one uses.
 *
 * Derived, never stored: you make the connection by capturing a value and
 * spending it, which is the same act as making the test work, so there is no
 * separate wiring step to fall out of step with reality.
 */
function beams() {
  const out = []
  const list = allRequests()
  for (const from of list) {
    for (const cap of from.captures ?? []) {
      if (!cap.name) continue
      for (const to of list) {
        if (to.id !== from.id && variablesUsed(to).includes(cap.name)) out.push({ from: from.id, to: to.id, name: cap.name })
      }
    }
  }
  return out
}

function drawBeams() {
  const host = $('beams')
  if (!host) return
  host.replaceChildren()

  const { x, y, z } = S.view
  const box = (id) => {
    const at = S.layout.get(id)
    if (!at) return null
    const n = document.querySelector(`.node[data-id="${id}"]`)
    return { x: at.x * z + x, y: at.y * z + y, w: NODE_W * z, h: (n ? n.offsetHeight : 96) * z }
  }

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
  defs.innerHTML = `
    <linearGradient id="beamgrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="var(--magenta)"/><stop offset="0.55" stop-color="var(--indigo)"/><stop offset="1" stop-color="var(--cyan)"/>
    </linearGradient>
    <marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0 10 5 0 10z" fill="var(--cyan)"/>
    </marker>`
  host.append(defs)

  for (const beam of beams()) {
    const a = box(beam.from)
    const b = box(beam.to)
    if (!a || !b) continue

    // Leaves the giver's right edge level with its ports and arrives at the
    // taker's left edge level with its own, so a line lands where the name is.
    const x1 = a.x + a.w
    const y1 = a.y + a.h - 46 * z
    const x2 = b.x
    const y2 = b.y + Math.min(b.h - 40 * z, 74 * z)
    const bend = Math.max(44, Math.abs(x2 - x1) * 0.45)

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`)
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'url(#beamgrad)')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-opacity', '0.8')
    path.setAttribute('marker-end', 'url(#tip)')
    host.append(path)

    if (z > 0.55 && S.prefs.beamLabels !== false) {
      // Three quarters of the way along rather than the middle. One request
      // often feeds four others, and every label at the midpoint piles up on
      // top of the source; near the target they spread out with the arrows.
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      t.setAttribute('x', String(x1 + (x2 - x1) * 0.72))
      t.setAttribute('y', String(y1 + (y2 - y1) * 0.86 - 6))
      t.setAttribute('text-anchor', 'middle')
      t.setAttribute('fill', 'var(--sx-tint)')
      t.setAttribute('font-size', String(9.5 * Math.max(0.85, z)))
      t.setAttribute('font-family', 'var(--mono)')
      t.textContent = beam.name
      host.append(t)
    }
  }
}

/* ---------------------------------------------------- pan, zoom and drag */

function drag(e, req, node) {
  // A node's handler runs before the plane's, so anything that means "pan"
  // has to be handed back rather than swallowed — otherwise space-drag and
  // middle-drag do nothing at all when they start on top of a node.
  if (spaceHeld || e.button === 1) return
  if (e.button !== 0 || e.target.closest('button')) return
  e.stopPropagation()
  const at = S.layout.get(req.id)
  const from = { x: e.clientX, y: e.clientY }
  const origin = { ...at }
  let moved = false
  node.classList.add('grabbed')

  const move = (ev) => {
    const dx = (ev.clientX - from.x) / S.view.z
    const dy = (ev.clientY - from.y) / S.view.z
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    at.x = Math.round(origin.x + dx)
    at.y = Math.round(origin.y + dy)
    node.style.left = `${at.x}px`
    node.style.top = `${at.y}px`
    drawBeams()
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    node.classList.remove('grabbed')
    if (moved) {
      node.dataset.moved = '1'
      S.moved.add(req.id)
    }
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/**
 * Panning and zooming.
 *
 * WHY SCROLL PANS AND DOES NOT ZOOM
 *
 * On a trackpad, a two-finger drag is how you move around a surface — it is
 * the same gesture as scrolling a page, and every canvas tool people already
 * use treats it that way. Binding it to zoom means the only way to pan is to
 * find empty background and drag it, and on a plane covered in nodes there
 * often is none. That reads as "I cannot pan".
 *
 * So: scroll pans. Zoom is ctrl or cmd with the wheel, which is also exactly
 * what a trackpad pinch arrives as. And because a mouse has no second finger,
 * the middle button and space both pan from anywhere — including from on top
 * of a node, where a left-drag moves the node instead.
 */
function wirePlane() {
  const plane = $('plane')

  /** One pan gesture, wherever it started from. */
  const beginPan = (e) => {
    const from = { x: e.clientX, y: e.clientY }
    const origin = { ...S.view }
    plane.classList.add('dragging')
    const move = (ev) => {
      S.view.x = origin.x + (ev.clientX - from.x)
      S.view.y = origin.y + (ev.clientY - from.y)
      applyView()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      plane.classList.remove('dragging')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  plane.addEventListener('pointerdown', (e) => {
    // Middle button, or space held: pans from anywhere, over a node included.
    if (e.button === 1 || (spaceHeld && e.button === 0)) {
      e.preventDefault()
      beginPan(e)
      return
    }
    if (e.button !== 0) return
    if (e.target.closest('.node') || e.target.closest('.plane-tools') || e.target.closest('.intake') || e.target.closest('.legend')) return
    beginPan(e)
  })

  // Chromium scrolls on middle-click without this.
  plane.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault()
  })

  plane.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()

      // A trackpad pinch arrives as a wheel event with ctrlKey set, and
      // ctrl-wheel on a mouse means the same thing everywhere else.
      if (e.ctrlKey || e.metaKey) {
        const r = plane.getBoundingClientRect()
        const px = e.clientX - r.left
        const py = e.clientY - r.top
        const next = clamp(S.view.z * (e.deltaY > 0 ? 0.93 : 1.07), 0.3, 2)
        // Around the pointer, so whatever is under the cursor stays under it.
        S.view.x = px - ((px - S.view.x) / S.view.z) * next
        S.view.y = py - ((py - S.view.y) / S.view.z) * next
        S.view.z = next
        applyView()
        return
      }

      // Otherwise it is a scroll, and a scroll moves the plane. Shift swaps
      // the axis for a wheel that only has one.
      const [dx, dy] = e.shiftKey && !e.deltaX ? [e.deltaY, 0] : [e.deltaX, e.deltaY]
      S.view.x -= dx
      S.view.y -= dy
      applyView()
    },
    { passive: false }
  )

  // Space is a modifier here, not a button press, so it must not scroll the
  // page or activate whatever happens to be focused.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !spaceHeld && !isTyping(e.target) && !sheetUp) {
      spaceHeld = true
      plane.classList.add('ready')
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false
      plane.classList.remove('ready')
    }
  })
  window.addEventListener('blur', () => {
    spaceHeld = false
    plane.classList.remove('ready')
  })

  $('zoomIn').onclick = () => {
    S.view.z = clamp(S.view.z * 1.15, 0.3, 2)
    applyView()
  }
  $('zoomOut').onclick = () => {
    S.view.z = clamp(S.view.z / 1.15, 0.3, 2)
    applyView()
  }
  $('zoomFit').onclick = fit
  $('tidyBtn').onclick = tidy
}

/** True while the caret is in something the user is writing into. */
function isTyping(node) {
  const tag = node?.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node?.isContentEditable === true
}

function applyView() {
  const { x, y, z } = S.view
  $('nodes').style.transform = `translate(${x}px, ${y}px) scale(${z})`
  $('planeDots').style.backgroundPosition = `${x}px ${y}px`
  $('planeDots').style.backgroundSize = `${24 * z}px ${24 * z}px`
  $('zoomPct').textContent = `${Math.round(z * 100)}%`
  drawBeams()
}

function fit() {
  const list = allRequests()
  if (!list.length) return
  const r = $('plane').getBoundingClientRect()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const req of list) {
    const at = S.layout.get(req.id)
    const n = document.querySelector(`.node[data-id="${req.id}"]`)
    const h = n ? n.offsetHeight : 110
    minX = Math.min(minX, at.x)
    minY = Math.min(minY, at.y)
    maxX = Math.max(maxX, at.x + NODE_W)
    maxY = Math.max(maxY, at.y + h)
  }
  const pad = 52
  const z = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), 0.3, 1.1)
  S.view = { z, x: pad - minX * z, y: pad - minY * z }
  applyView()
}

function pick(id) {
  S.pickedId = id
  S.editTab = 'params'
  S.respTab = S.results.has(id) ? 'result' : 'brief'
  commit()
}

/* ============================================================= workbench */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

const EDIT_TABS = [
  ['params', 'Params'],
  ['headers', 'Headers'],
  ['body', 'Body'],
  ['auth', 'Auth'],
  ['tests', 'Tests'],
  ['chain', 'Chain']
]

const RESP_TABS = [
  ['brief', 'Brief'],
  ['result', 'Result'],
  ['payload', 'Payload'],
  ['headers', 'Headers'],
  ['shape', 'Shape'],
  ['diff', 'Diff'],
  ['notes', 'Notes'],
  ['timing', 'Timing']
]

function paintBench() {
  const req = current()
  $('benchNone').hidden = Boolean(req)
  $('benchLive').hidden = !req
  if (!req) return

  const verb = req.method.toLowerCase()
  $('benchVerb').className = `verb ${verb}`
  $('benchVerb').textContent = req.method
  if ($('benchName').value !== (req.name ?? '')) $('benchName').value = req.name ?? ''
  $('addrVerb').className = `addr-verb ${verb}`
  $('addrVerbText').textContent = req.method
  if ($('urlInput').value !== (req.url ?? '')) $('urlInput').value = req.url ?? ''
  $('methodPick').replaceChildren(...METHODS.map((m) => el('option', { value: m, text: m, selected: m === req.method })))

  const busy = S.busy.has(req.id)
  $('sendBtn').disabled = busy
  $('sendLabel').textContent = busy ? 'Sending' : 'Send'
  paintPreview(req)

  const res = S.results.get(req.id)

  const et = $('editTabs')
  et.replaceChildren()
  for (const [id, label] of EDIT_TABS) {
    const n = countFor(req, id)
    et.append(
      el('button', { class: `tab${S.editTab === id ? ' on' : ''}`, type: 'button', role: 'tab', html: `${label}${n ? `<b>${n}</b>` : ''}`, onclick: () => {
        S.editTab = id
        // Picking a tab on a folded half opens it. The alternative is a click
        // that changes something you cannot see.
        if (S.pane === 'response') S.pane = 'split'
        paintBench()
      } })
    )
  }
  $('editBody').replaceChildren(editPanel(req, res))

  // Both halves put their tabs on their own row. Squeezing the request's six
  // into its bar left "Chain" outside the visible width, reachable only by
  // scrolling a row with no scrollbar — a tab nobody would ever find.
  const rt = $('respTabs')
  rt.replaceChildren()
  for (const [id, label] of RESP_TABS) {
    let badge = ''
    if (id === 'notes' && res?.findings?.length) {
      const bad = res.findings.filter((f) => f.level === 'bad').length
      badge = bad ? `<b class="bad">${bad}</b>` : `<b>${res.findings.length}</b>`
    }
    rt.append(
      el('button', { class: `tab${S.respTab === id ? ' on' : ''}`, type: 'button', role: 'tab', html: `${label}${badge}`, onclick: () => {
        S.respTab = id
        paintBench()
      } })
    )
  }
  $('respBody').replaceChildren(respPanel(req, res))
  paintRespStats(res)
  $('copyBody').disabled = !res || res.error
  layoutPanes()
}

/**
 * The line along the top of the response half.
 *
 * Present before anything is sent, saying so. A panel that appears only after
 * the first send is a panel people do not know is there — which is exactly the
 * complaint that produced it.
 */
/**
 * How the two halves share the panel.
 *
 * Three states rather than a free-form split, because the two useful shapes
 * are "both" and "all of one": editing twenty headers and reading a large
 * payload want opposite things, and dragging a handle to the top every time is
 * a chore. Filling one half folds the other to its bar, which stays visible —
 * a collapsed pane you cannot see is a pane you cannot get back.
 */
function layoutPanes() {
  const host = $('benchSplit')
  const BAR = '30px'
  // The handle's row collapses to nothing when there is nothing to drag
  // between, rather than leaving a seven-pixel gap under a folded bar.
  if (S.pane === 'request') host.style.gridTemplateRows = `minmax(120px, 1fr) 0px ${BAR}`
  else if (S.pane === 'response') host.style.gridTemplateRows = `${BAR} 0px minmax(120px, 1fr)`
  else host.style.gridTemplateRows = `minmax(90px, ${S.split}fr) 7px minmax(90px, ${100 - S.split}fr)`

  $('reqPane').classList.toggle('folded', S.pane === 'response')
  $('resPane').classList.toggle('folded', S.pane === 'request')
  $('benchGrip').hidden = S.pane !== 'split'

  for (const [id, filled] of [['reqGrow', S.pane === 'request'], ['resGrow', S.pane === 'response']]) {
    const btn = $(id)
    btn.classList.toggle('on', filled)
    btn.title = filled ? 'Back to both' : 'Fill the panel'
  }
  $('reqFold').setAttribute('aria-expanded', String(S.pane !== 'response'))
  $('resFold').setAttribute('aria-expanded', String(S.pane !== 'request'))
}

/** Fill with one half, or go back to both. */
function fillPane(which) {
  S.pane = S.pane === which ? 'split' : which
  layoutPanes()
}

/** Fold one half away, which is the same as filling with the other. */
function foldPane(which) {
  const other = which === 'request' ? 'response' : 'request'
  S.pane = S.pane === other ? 'split' : other
  layoutPanes()
}

function paintRespStats(res) {
  const host = $('respStats')
  host.replaceChildren()

  if (!res) {
    host.append(el('span', { class: 'stat-none', text: 'not sent yet' }))
    return
  }
  if (res.error) {
    host.append(el('span', { class: 'code bad', text: 'no response' }))
    return
  }
  host.append(el('span', { class: `code ${tone(res.status)}`, text: `${res.status} ${word(res.status)}` }))
  host.append(el('span', { class: 'stat', text: `${res.timing?.total ?? 0} ms` }))
  host.append(el('span', { class: 'stat', text: fmtBytes(res.bytes) }))
  if (res.checks.length) {
    host.append(
      el('span', {
        class: `stat ${res.failed ? 'fail' : 'pass'}`,
        text: res.failed ? `${res.failed} of ${res.checks.length} failed` : `${res.checks.length} passed`
      })
    )
  }
}

function paintPreview(req) {
  $('wirePreview').innerHTML = `<b style="color:var(--ink-4)">${req.method}</b> ${esc(buildUrl(req, envValues())).replace(
    /\{\{[\w.-]+\}\}/g,
    (m) => `<span class="v">${m}</span>`
  )}`
}

function countFor(req, tab) {
  const on = (list) => (list ?? []).filter((r) => r.on !== false).length
  if (tab === 'params') return on(req.query) + on(req.pathParams)
  if (tab === 'headers') return on(req.headers)
  if (tab === 'body') return req.bodyKind !== 'none' ? 1 : 0
  if (tab === 'auth') return req.auth?.kind !== 'none' ? 1 : 0
  if (tab === 'tests') return (req.assertions ?? []).length
  if (tab === 'chain') return (req.captures ?? []).length
  return 0
}

/** Redraws only what a keystroke changes, so typing does not rebuild the app. */
function live(req) {
  paintPreview(req)
  const path = document.querySelector(`.node[data-id="${req.id}"] .node-path`)
  if (path) path.innerHTML = pathLabel(req.url)
}

/* ---------------------------------------------------------- edit panels */

function editPanel(req, res) {
  switch (S.editTab) {
    case 'headers':
      return rowsPanel(req, 'headers', 'Headers', 'X-Tenant', 'northwind')
    case 'body':
      return bodyPanel(req)
    case 'auth':
      return authPanel(req)
    case 'tests':
      return testsPanel(req, res)
    case 'chain':
      return chainPanel(req)
    default: {
      const box = el('div')
      box.append(rowsPanel(req, 'query', 'Query parameters', 'search', 'iphone'))
      box.append(rowsPanel(req, 'pathParams', 'Path parameters', 'userId', '42', 'written in the endpoint as :userId'))
      return box
    }
  }
}

function rowsPanel(req, key, label, kHint, vHint, hint) {
  const box = el('div')
  box.append(el('div', { class: 'lbl' }, [el('span', { text: label }), hint ? el('em', { text: hint }) : null]))
  const list = (req[key] ??= [])

  for (const r of list) {
    box.append(
      el('div', { class: `kvrow${r.on === false ? ' off' : ''}` }, [
        el('input', { class: 'tick', type: 'checkbox', checked: r.on !== false, 'aria-label': `Send ${r.key || 'this row'}`, onchange: (e) => {
          r.on = e.target.checked
          commit('plane')
          paintBench()
        } }),
        el('input', { class: 'cell k', value: r.key, placeholder: kHint, 'aria-label': 'Name', oninput: (e) => {
          r.key = e.target.value
          live(req)
        } }),
        el('input', { class: 'cell v', value: r.value, placeholder: vHint, 'aria-label': 'Value', oninput: (e) => {
          r.value = e.target.value
          live(req)
        } }),
        el('button', { class: 'x-btn', type: 'button', 'aria-label': `Remove ${r.key || 'row'}`, html: ico(I.x, 11, 2.3), onclick: () => {
          req[key] = list.filter((x) => x.id !== r.id)
          commit()
        } })
      ])
    )
  }

  box.append(
    el('button', { class: 'addbtn', type: 'button', html: `${ico(I.plus, 10, 2.4)}<span>Add</span>`, onclick: () => {
      list.push(row())
      paintBench()
    } })
  )
  return box
}

const BODY_KINDS = [
  ['none', 'None'],
  ['json', 'JSON'],
  ['graphql', 'GraphQL'],
  ['urlencoded', 'Form URL'],
  ['form', 'Multipart'],
  ['xml', 'XML'],
  ['raw', 'Raw']
]

function bodyPanel(req) {
  const box = el('div')
  const chips = el('div', { class: 'chips' })
  for (const [id, label] of BODY_KINDS) {
    chips.append(
      el('button', { class: `chipbtn${req.bodyKind === id ? ' on' : ''}`, type: 'button', text: label, onclick: () => {
        req.bodyKind = id
        commit()
      } })
    )
  }
  box.append(chips)

  if (req.bodyKind === 'none') {
    box.append(el('p', { class: 'note', text: 'This request sends no body.' }))
    return box
  }

  const area = el('textarea', {
    spellcheck: 'false',
    placeholder: req.bodyKind === 'urlencoded' ? 'one key=value per line' : '{\n  "email": "{{user_email}}"\n}',
    oninput: (e) => {
      req.body = e.target.value
    }
  })
  area.value = req.body ?? ''

  box.append(
    el('div', { class: 'editor' }, [
      area,
      el('div', { class: 'editor-foot' }, [
        el('span', { text: describeBody(req) }),
        el('span', { class: 'spacer' }),
        el('button', { class: 'tiny', type: 'button', text: 'Format', onclick: () => {
          try {
            req.body = JSON.stringify(JSON.parse(req.body ?? ''), null, 2)
            paintBench()
          } catch (err) {
            toast('bad', `Not valid JSON — ${err.message}`)
          }
        } })
      ])
    ])
  )
  return box
}

function describeBody(req) {
  const t = req.body ?? ''
  if (!t) return 'empty'
  if (req.bodyKind === 'json' || req.bodyKind === 'graphql') {
    try {
      JSON.parse(t)
      return `valid JSON · ${t.length} chars`
    } catch {
      return 'not valid JSON yet'
    }
  }
  return `${t.length} chars`
}

const AUTHS = [
  ['none', 'No auth', 'sent as it is'],
  ['bearer', 'Bearer', 'Authorization: Bearer'],
  ['basic', 'Basic', 'user and password'],
  ['apiKey', 'API key', 'header or query'],
  ['oauth2', 'OAuth 2.0', 'a token you hold'],
  ['jwt', 'JWT', 'signed token as bearer']
]

function authPanel(req) {
  const box = el('div')
  const grid = el('div', { class: 'authgrid' })
  for (const [id, title, sub] of AUTHS) {
    grid.append(
      el('button', { class: `authcard${req.auth?.kind === id ? ' on' : ''}`, type: 'button', onclick: () => {
        req.auth = { ...(req.auth ?? {}), kind: id }
        commit()
      } }, [el('b', { text: title }), el('span', { text: sub })])
    )
  }
  box.append(grid)

  const kind = req.auth?.kind ?? 'none'
  if (kind === 'none') return box

  const field = (label, prop, ph) =>
    el('div', { class: 'fieldrow' }, [
      el('label', { text: label }),
      el('input', { value: req.auth?.[prop] ?? '', placeholder: ph, oninput: (e) => {
        req.auth[prop] = e.target.value
        live(req)
      } })
    ])

  if (kind === 'basic') {
    box.append(field('Username', 'username', '{{user}}'), field('Password', 'password', '{{password}}'))
  } else if (kind === 'apiKey') {
    box.append(field('Key name', 'keyName', 'X-Api-Key'), field('Value', 'token', '{{api_key}}'))
    box.append(
      el('div', { class: 'fieldrow' }, [
        el('label', { text: 'Send in' }),
        el('select', { onchange: (e) => {
          req.auth.keyIn = e.target.value
          commit('plane')
        } }, [
          el('option', { value: 'header', text: 'Header', selected: req.auth?.keyIn !== 'query' }),
          el('option', { value: 'query', text: 'Query string', selected: req.auth?.keyIn === 'query' })
        ])
      ])
    )
  } else {
    box.append(field('Token', 'token', '{{auth_token}}'))
  }

  box.append(
    el('p', { class: 'note', style: 'margin-top:11px', text: 'Write a variable here rather than a value. Exports carry the variable; they never carry the secret.' })
  )
  return box
}

function testsPanel(req, res) {
  const box = el('div')
  const byId = new Map((res?.checks ?? []).map((c) => [c.id, c]))
  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Assertions' })]))

  for (const a of req.assertions ?? []) {
    const hit = byId.get(a.id)
    const ops = OPERATORS[a.subject] ?? ['equals']
    const needsPath = a.subject === 'json' || a.subject === 'header'
    const needsValue = !['exists', 'absent', 'isEmpty', 'notEmpty', 'isSuccess'].includes(a.op)

    box.append(
      el('div', { class: `assert${hit ? (hit.ok ? ' pass' : ' fail') : ''}` }, [
        el('input', { class: 'tick', type: 'checkbox', checked: a.on !== false, 'aria-label': 'Run this assertion', onchange: (e) => {
          a.on = e.target.checked
        } }),
        el('select', { class: 'subj', 'aria-label': 'Subject', onchange: (e) => {
          a.subject = e.target.value
          a.op = (OPERATORS[a.subject] ?? ['equals'])[0]
          paintBench()
        } }, SUBJECTS.map((s) => el('option', { value: s.id, text: s.label, selected: s.id === a.subject }))),
        needsPath
          ? el('input', { class: 'cell k', value: a.path ?? '', placeholder: a.subject === 'json' ? 'data.id' : 'X-Request-Id', 'aria-label': 'Path', oninput: (e) => {
              a.path = e.target.value
            } })
          : null,
        el('select', { class: 'op', 'aria-label': 'Operator', onchange: (e) => {
          a.op = e.target.value
          paintBench()
        } }, ops.map((o) => el('option', { value: o, text: OP_LABEL[o] ?? o, selected: o === a.op }))),
        needsValue
          ? el('input', { class: 'cell v', value: a.value ?? '', placeholder: '200', 'aria-label': 'Expected', oninput: (e) => {
              a.value = e.target.value
            } })
          : null,
        hit ? el('span', { class: 'saw', title: hit.detail, text: hit.detail }) : null,
        el('button', { class: 'x-btn', type: 'button', 'aria-label': 'Remove assertion', html: ico(I.x, 11, 2.3), onclick: () => {
          req.assertions = req.assertions.filter((x) => x.id !== a.id)
          commit()
        } })
      ])
    )
  }

  box.append(
    el('button', { class: 'addbtn', type: 'button', html: `${ico(I.plus, 10, 2.4)}<span>Add assertion</span>`, onclick: () => {
      ;(req.assertions ??= []).push(emptyAssertion())
      commit()
    } })
  )
  return box
}

function chainPanel(req) {
  const box = el('div')
  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Gives' }), el('em', { text: 'captured here, usable as {{name}} downstream' })]))

  for (const c of req.captures ?? []) {
    box.append(
      el('div', { class: 'give' }, [
        el('input', { class: 'cell k', value: c.name, placeholder: 'auth_token', 'aria-label': 'Variable name', oninput: (e) => {
          c.name = e.target.value
          commit('plane')
        } }),
        el('span', { class: 'arrow', html: ico(I.chev, 11, 2.4) }),
        el('select', { 'aria-label': 'From', onchange: (e) => {
          c.from = e.target.value
        } }, [
          el('option', { value: 'body', text: 'Body', selected: c.from !== 'header' }),
          el('option', { value: 'header', text: 'Header', selected: c.from === 'header' })
        ]),
        el('input', { class: 'cell v', value: c.path, placeholder: 'data.token', 'aria-label': 'Path', oninput: (e) => {
          c.path = e.target.value
        } }),
        el('button', { class: 'x-btn', type: 'button', 'aria-label': 'Remove capture', html: ico(I.x, 11, 2.3), onclick: () => {
          req.captures = req.captures.filter((x) => x.id !== c.id)
          commit()
        } })
      ])
    )
  }

  box.append(
    el('button', { class: 'addbtn', type: 'button', html: `${ico(I.plus, 10, 2.4)}<span>Capture a value</span>`, onclick: () => {
      ;(req.captures ??= []).push({ id: uid('cap'), name: '', from: 'body', path: '' })
      commit()
    } })
  )

  const uses = variablesUsed(req)
  if (uses.length) {
    box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Needs' })]))
    const known = envValues()
    for (const name of uses) {
      const from = allRequests().find((r) => (r.captures ?? []).some((c) => c.name === name))
      const set = Object.prototype.hasOwnProperty.call(known, name)
      box.append(
        el('div', { class: `chg ${from || set ? 'added' : 'removed'}` }, [
          el('b', { text: from ? 'chained' : set ? 'set' : 'missing' }),
          el('span', { class: 'p', text: `{{${name}}}` }),
          el('span', { class: from || set ? 'now' : 'was', text: from ? `from ${from.name}` : set ? String(known[name]).slice(0, 26) : 'nothing provides this' })
        ])
      )
    }
  }
  return box
}

/* ------------------------------------------------------ response panels */

function respPanel(req, res) {
  if (S.respTab === 'brief') return briefPanel(req)
  if (!res) return el('div', { class: 'nothing', text: 'Send this request and the analysis appears here.' })
  switch (S.respTab) {
    case 'payload':
      return payloadPanel(res)
    case 'headers':
      return headersPanel(res)
    case 'shape':
      return shapePanel(res)
    case 'diff':
      return diffPanel(req, res)
    case 'notes':
      return notesPanel(res)
    case 'timing':
      return timingPanel(res)
    default:
      return resultPanel(res)
  }
}

function briefPanel(req) {
  const box = el('div')
  box.append(
    el('dl', { class: 'pairs' }, [
      el('dt', { text: 'Collection' }),
      el('dd', { text: collectionOf(req.id)?.name ?? '—' }),
      el('dt', { text: 'Flow' }),
      el('dd', { text: flowOf(req.id)?.name ?? '—' }),
      el('dt', { text: 'Resolved' }),
      el('dd', { text: buildUrl(req, envValues()) }),
      el('dt', { text: 'Auth' }),
      el('dd', { text: req.auth?.kind ?? 'none' })
    ])
  )

  if (req.recorded) {
    box.append(el('div', { class: 'lbl', style: 'margin-top:14px' }, [el('span', { text: 'When recorded' })]))
    box.append(
      el('dl', { class: 'pairs' }, [
        el('dt', { text: 'Status' }),
        el('dd', { text: `${req.recorded.status} ${req.recorded.statusText}` }),
        el('dt', { text: 'Took' }),
        el('dd', { text: `${req.recorded.durationMs}ms` }),
        el('dt', { text: 'Size' }),
        el('dd', { text: fmtBytes(req.recorded.bytes) })
      ])
    )
    if (req.recorded.responseBody) {
      box.append(el('div', { class: 'lbl', style: 'margin-top:12px' }, [el('span', { text: 'Example payload' })]))
      box.append(source(prettyJson(req.recorded.responseBody)))
    }
  }

  const runs = S.history.filter((h) => h.requestId === req.id)
  if (runs.length) {
    box.append(el('div', { class: 'lbl', style: 'margin-top:14px' }, [el('span', { text: 'Recent runs' })]))
    for (const h of runs.slice(0, 8)) {
      box.append(
        el('div', { class: 'snap' }, [
          el('span', { class: 'when', text: new Date(h.at).toLocaleTimeString() }),
          el('span', { class: `code ${tone(h.status)}`, text: String(h.status || 'ERR') }),
          el('span', { class: 'nm', text: h.env }),
          el('span', { class: 'ms', text: `${h.ms}ms` })
        ])
      )
    }
  }
  return box
}

const tile = (t, v, l) => el('div', { class: `tile ${t}` }, [el('b', { text: v }), el('span', { text: l })])

function resultPanel(res) {
  const box = el('div')
  if (res.error) {
    box.append(el('div', { class: 'find bad' }, [el('div', { class: 'find-bar' }), el('div', {}, [el('b', { text: 'No response' }), el('p', { text: res.error })])]))
    return box
  }
  box.append(
    el('div', { class: 'tiles' }, [
      tile(tone(res.status), String(res.status), word(res.status)),
      tile(res.timing.total > 1000 ? 'warn' : 'info', String(res.timing.total), 'milliseconds'),
      tile('', fmtBytes(res.bytes), 'downloaded'),
      tile(res.request?.url?.startsWith('https') ? 'ok' : 'warn', res.request?.url?.startsWith('https') ? 'TLS' : 'PLAIN', 'transport')
    ])
  )
  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Assertions' })]))
  if (!res.checks.length) box.append(el('p', { class: 'note', text: 'Nothing checked this response.' }))
  for (const c of res.checks) {
    box.append(
      el('div', { class: `chg ${c.ok ? 'added' : 'removed'}` }, [
        el('b', { text: c.ok ? 'pass' : 'fail' }),
        el('span', { class: 'p', text: SUBJECTS.find((s) => s.id === c.assertion.subject)?.label ?? c.assertion.subject }),
        el('span', { class: c.ok ? 'now' : 'was', text: c.detail })
      ])
    )
  }
  return box
}

function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function source(text) {
  const pre = el('pre', { class: 'src' })
  for (const line of String(text ?? '').split('\n').slice(0, 3000)) pre.append(el('span', { class: 'ln', html: colour(line) }))
  return pre
}

function colour(line) {
  return esc(line).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(\b-?\d+(?:\.\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],])/g,
    (m, str, colon, num, bool, nul, punc) => {
      if (str) return colon ? `<span class="t-key">${str}</span><span class="t-punc">${colon}</span>` : `<span class="t-str">${str}</span>`
      if (num) return `<span class="t-num">${num}</span>`
      if (bool) return `<span class="t-bool">${bool}</span>`
      if (nul) return `<span class="t-null">${nul}</span>`
      if (punc) return `<span class="t-punc">${punc}</span>`
      return m
    }
  )
}

function payloadPanel(res) {
  const box = el('div')
  if (res.truncated) box.append(el('p', { class: 'note', text: 'Only the first 4 MB is shown. Assertions ran against everything that arrived.' }))
  box.append(source(res.json !== undefined ? JSON.stringify(res.json, null, 2) : res.body || '(empty)'))
  return box
}

const mask = (v) => (String(v).length <= 12 ? '••••••' : `${String(v).slice(0, 6)}${'•'.repeat(9)}${String(v).slice(-4)}`)

function headersPanel(res) {
  const box = el('div')
  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Response' })]))
  const a = el('dl', { class: 'pairs' })
  for (const [k, v] of Object.entries(res.headers ?? {})) a.append(el('dt', { text: k }), el('dd', { text: v }))
  box.append(a)

  box.append(el('div', { class: 'lbl', style: 'margin-top:14px' }, [el('span', { text: 'Request' })]))
  const b = el('dl', { class: 'pairs' })
  for (const [k, v] of Object.entries(res.request?.headers ?? {})) {
    // A live credential is never printed back into a panel that gets shared.
    const secret = S.prefs.maskCredentials !== false && /authorization|api[-_]?key|token|cookie/i.test(k)
    b.append(el('dt', { text: k }), el('dd', { text: secret ? mask(v) : v }))
  }
  box.append(b)
  return box
}

function shapePanel(res) {
  const box = el('div')
  if (res.json === undefined) {
    box.append(el('p', { class: 'note', text: 'The response is not JSON, so there is no structure to explore.' }))
    return box
  }
  const rows = tree(res.json)
  const shut = new Set()
  const host = el('div', { class: 'tree-json' })
  const paint = () => {
    host.replaceChildren()
    for (const n of rows) {
      if ([...shut].some((p) => n.path !== p && n.path.startsWith(`${p}.`))) continue
      host.append(
        el('div', { class: 'tj', style: `padding-left:${n.depth * 13}px` }, [
          el('span', { class: 'tw', text: n.leaf ? '' : shut.has(n.path) ? '▸' : '▾', onclick: () => {
            shut.has(n.path) ? shut.delete(n.path) : shut.add(n.path)
            paint()
          } }),
          el('span', { class: 'tk', text: n.key }),
          el('span', { class: 'tt', text: n.kind }),
          el('span', { class: 'tv', text: n.preview })
        ])
      )
    }
  }
  paint()
  box.append(host)
  return box
}

const brief = (v) => String((typeof v === 'string' ? v : JSON.stringify(v)) ?? '').slice(0, 36)

function diffPanel(req, res) {
  const box = el('div')
  const before = S.previous.get(req.id)
  if (!before) {
    box.append(el('p', { class: 'note', text: 'Nothing to compare yet. Send this a second time and every field that moved is listed here.' }))
    return box
  }
  const changes = diff(before.json, res.json)
  box.append(el('p', { class: 'note', text: `Against the run at ${new Date(before.at).toLocaleTimeString()} — ${diffSummary(changes)}.` }))
  for (const c of changes.slice(0, 120)) {
    box.append(
      el('div', { class: `chg ${c.kind}` }, [
        el('b', { text: c.kind }),
        el('span', { class: 'p', text: c.path }),
        c.kind === 'removed' ? el('span', { class: 'was', text: brief(c.before) }) : null,
        c.kind === 'added' ? el('span', { class: 'now', text: brief(c.after) }) : null,
        c.kind === 'changed' || c.kind === 'retyped'
          ? el('span', {}, [el('span', { class: 'was', text: brief(c.before ?? c.from) }), el('span', { text: ' → ' }), el('span', { class: 'now', text: brief(c.after ?? c.to) })])
          : null
      ])
    )
  }
  return box
}

function notesPanel(res) {
  const box = el('div')
  box.append(el('p', { class: 'note', text: 'Every line is a rule over this response, with the evidence that produced it. Nothing here is guessed.' }))
  for (const f of res.findings ?? []) {
    box.append(
      el('div', { class: `find ${f.level}` }, [
        el('div', { class: 'find-bar' }),
        el('div', {}, [el('b', { text: f.title }), el('p', { text: f.detail }), f.hint ? el('em', { text: f.hint }) : null])
      ])
    )
  }
  return box
}

function timingPanel(res) {
  const box = el('div')
  if (res.error) {
    box.append(el('p', { class: 'note', text: 'The request never completed, so there is nothing to break down.' }))
    return box
  }
  const t = res.timing
  const total = Math.max(t.total, 1)
  const phases = [
    ['DNS lookup', 0, t.dns, 'dns'],
    ['TCP connect', t.dns, t.tcp, 'tcp'],
    ['TLS handshake', t.tcp, t.tls || t.tcp, 'tls'],
    ['Waiting', t.tls || t.tcp, t.first, 'wait'],
    ['Download', t.first, t.end, 'down']
  ]
  const grid = el('div', { class: 'wf' })
  for (const [name, from, to, cls] of phases) {
    const span = Math.max(0, to - from)
    grid.append(
      el('span', { class: 'wf-n', text: name }),
      el('span', { class: 'wf-ms', text: span ? `${span}ms` : '—' }),
      el('div', { class: 'wf-t' }, [el('div', { class: `wf-b ${cls}`, style: `left:${(from / total) * 100}%;width:${Math.max(span ? 1.5 : 0, (span / total) * 100)}%` })])
    )
  }
  box.append(grid)
  box.append(
    el('dl', { class: 'pairs', style: 'margin-top:12px' }, [
      el('dt', { text: 'Started' }),
      el('dd', { text: new Date(res.at).toLocaleTimeString() }),
      el('dt', { text: 'Round trip' }),
      el('dd', { text: `${t.total}ms` }),
      el('dt', { text: 'Downloaded' }),
      el('dd', { text: fmtBytes(res.bytes) })
    ])
  )
  return box
}

/* ================================================================ sending */

async function send(req) {
  if (S.busy.has(req.id)) return

  // Production is named, never blocked — a suite that will not touch it is not
  // much of a suite — but it is worth one deliberate press.
  const env = environment()
  if (S.prefs.confirmProduction !== false && env && /prod|live|release/i.test(env.name)) {
    const go = await ask({
      title: `Send to ${env.name}?`,
      blurb: `This environment is named like production, and ${req.method} ${buildUrl(req, envValues())} really will be sent.`,
      danger: 'Send it'
    })
    if (!go) return
  }

  S.busy.add(req.id)
  commit()

  const spec = {
    ...compile(req, envValues()),
    timeoutMs: req.timeoutMs ?? Number(S.prefs.timeoutMs) ?? 30000,
    followRedirects: S.prefs.followRedirects !== false,
    verifyTls: S.prefs.verifyTls !== false,
    maxBodyMb: Number(S.prefs.maxBodyMb) || 4
  }
  const at = Date.now()
  const raw = await window.prism.http.send(spec)
  S.busy.delete(req.id)

  if (raw.error) {
    remember(req, { error: raw.error, at, request: spec, checks: [], failed: 1, status: 0, timing: { total: 0 } })
    commit()
    toast('bad', raw.error)
    return
  }

  let json
  try {
    json = JSON.parse(raw.body)
  } catch {
    json = undefined
  }

  const response = { ...raw, json }
  const checks = runAll(req.assertions, response)
  const result = {
    ...response,
    at,
    request: spec,
    checks,
    failed: checks.filter((c) => !c.ok).length,
    findings: analyse(response, { ...spec, secure: raw.secure }, checks)
  }

  // Captured values land in the environment, which is what lets the next
  // request in the flow use them without anyone copying anything.
  for (const cap of req.captures ?? []) {
    if (!cap.name || !environment()) continue
    const value =
      cap.from === 'header'
        ? Object.entries(response.headers ?? {}).find(([k]) => k.toLowerCase() === cap.path.toLowerCase())?.[1]
        : jsonPath(json, cap.path)
    if (value !== undefined) environment().values[cap.name] = String(value)
  }

  remember(req, result)
  S.respTab = result.failed ? 'notes' : 'result'
  commit()
  toast(result.failed ? 'bad' : 'ok', `${req.name} — ${raw.status} in ${raw.timing.total}ms`)
}

function remember(req, result) {
  const was = S.results.get(req.id)
  if (was && was.json !== undefined) S.previous.set(req.id, was)
  S.results.set(req.id, result)
  S.history.unshift({
    id: uid('h'),
    requestId: req.id,
    name: req.name,
    method: req.method,
    url: result.request?.url ?? req.url,
    status: result.status,
    ms: result.timing?.total ?? 0,
    at: result.at,
    env: environment()?.name ?? '—',
    failed: result.failed
  })
  S.history = S.history.slice(0, Math.max(10, Number(S.prefs.historyLimit) || 80))
}

/* ================================================================= import */

async function doImport() {
  const chosen = await window.prism.file.open([
    { name: 'Collections', extensions: ['json'] },
    { name: 'All files', extensions: ['*'] }
  ])
  if (!chosen) return
  applyImport(readCollection(chosen.text, chosen.name))
}

const sourceLabel = (s) =>
  ({ 'rebind-workspace': 'a Rebind recording', 'rebind-suite': 'a Rebind flow', postman: 'a Postman collection', 'postman-environment': 'a Postman environment' })[s] ??
  'a collection'

function applyImport(result) {
  if (!result.ok) {
    toast('bad', result.error)
    return
  }
  if (result.collection) S.collections.push(result.collection)
  if (result.environments?.length) {
    S.environments.push(...result.environments)
    if (!S.envId) S.envId = S.environments[0].id
  }
  if (result.recorded?.length) {
    S.recorded.push(...result.recorded)
    paintIntake()
  }
  const n = countRequests(result)
  toast('ok', `${result.name} — ${n} request${n === 1 ? '' : 's'} from ${sourceLabel(result.source)}`)
  if (!S.pickedId) S.pickedId = allRequests()[0]?.id ?? ''
  commit()
  setTimeout(fit, 30)
}

function paintIntake() {
  const panel = $('intake')
  if (!S.recorded.length) {
    panel.hidden = true
    return
  }
  panel.hidden = false
  $('intakeCount').textContent = `${S.recorded.length} recorded`
  const rows = $('intakeRows')
  rows.replaceChildren()
  S.recorded.forEach((req, i) => {
    rows.append(
      el('button', { class: 'inrow', type: 'button', style: `animation-delay:${Math.min(i * 45, 550)}ms`, title: 'Turn into a test', onclick: () => convert(req) }, [
        el('span', { class: `verb ${req.method.toLowerCase()}`, text: req.method }),
        el('span', { class: 'p', text: shortPath(req.url) }),
        el('span', { class: `code ${tone(req.recorded?.status ?? 0)}`, text: String(req.recorded?.status ?? 0) }),
        el('span', { class: 'ms', text: `${req.recorded?.durationMs ?? 0}ms` })
      ])
    )
  })
}

/**
 * A recorded call becomes a test, with assertions proposed from what it
 * actually did — the whole reason recording is worth anything.
 */
function convert(req) {
  let json
  try {
    json = JSON.parse(req.recorded?.responseBody ?? '')
  } catch {
    json = undefined
  }
  req.assertions = suggestFor(req.recorded, json)

  let col = S.collections.find((c) => c.source === 'rebind-workspace') ?? S.collections[0]
  if (!col) {
    col = emptyCollection('Recorded', [])
    S.collections.push(col)
  }
  let flow = col.flows.find((f) => f.name === 'Recorded')
  if (!flow) {
    flow = emptyFlow('Recorded')
    col.flows.push(flow)
  }
  flow.requests.push(req)
  S.recorded = S.recorded.filter((r) => r !== req)
  S.pickedId = req.id
  paintIntake()
  commit()
  toast('ok', `${req.name} — ${req.assertions.length} assertions proposed`)
}

/* ================================================================= export */

/**
 * The export centre.
 *
 * A page rather than a dialog, because choosing a target means reading the
 * code it produces — and reading is what the old cramped preview made hard.
 * The scope switch is explicit: exporting one request and exporting the flow
 * it sits in are different acts and used to be inferred from what happened to
 * be selected.
 */
let exportTarget = 'curl'

function openExport(onlyFlow, onlyRequest) {
  const req = onlyRequest !== undefined ? onlyRequest : current()
  const flow = onlyFlow ?? (req ? flowOf(req.id) : allFlows()[0])
  if (!req && !flow) {
    toast('bad', 'There is nothing to export yet.')
    return
  }
  let scope = req ? 'request' : 'flow'

  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true
  onSheetClose = null

  const shell = el('div', { class: 'page export-page' })

  const paint = () => {
    const whole = WHOLE_FLOW.has(exportTarget) || scope === 'flow'
    const subject = whole ? flow : req
    const code = generate(exportTarget, {
      request: scope === 'request' ? req : null,
      flow,
      environment: environment()
    })
    const spec = TARGETS.find((t) => t.id === exportTarget)
    const name = `${slug(whole ? (flow?.name ?? 'flow') : (req?.name ?? 'request'))}.${spec.ext}`

    /* left: the targets, grouped */
    const nav = el('nav', { class: 'page-nav' }, [el('h3', { text: 'Export' })])
    if (req && flow) {
      nav.append(
        el('div', { class: 'seg export-scope' }, [
          el('button', { class: `segbtn${scope === 'request' ? ' on' : ''}`, type: 'button', text: 'This request', onclick: () => {
            scope = 'request'
            paint()
          } }),
          el('button', { class: `segbtn${scope === 'flow' ? ' on' : ''}`, type: 'button', text: 'Whole flow', onclick: () => {
            scope = 'flow'
            paint()
          } })
        ])
      )
    }
    for (const group of GROUPS) {
      const items = TARGETS.filter((t) => t.group === group)
      if (!items.length) continue
      nav.append(el('h4', { class: 'nav-group', text: group }))
      for (const t of items) {
        nav.append(
          el('button', { class: t.id === exportTarget ? 'on' : '', type: 'button', onclick: () => {
            exportTarget = t.id
            paint()
          } }, [
            el('span', { class: 'exp-ext', text: `.${t.ext.split('.').pop()}` }),
            el('span', { class: 'menu-label', text: t.label })
          ])
        )
      }
    }
    nav.append(el('span', { class: 'spacer' }))
    nav.append(el('footer', { html: 'Variables stay variables.<br />No credential is ever resolved into a file.' }))

    /* right: the file */
    const lines = code.split('\n').length
    const main = el('div', { class: 'page-main' }, [
      el('div', { class: 'page-head' }, [
        el('h2', { text: spec.label }),
        el('p', {
          text: whole
            ? `Every request in ${flow?.name ?? 'the flow'} — ${flow?.requests.length ?? 0} of them.`
            : `${req?.method} ${shortPath(req?.url ?? '')}`
        })
      ]),
      el('div', { class: 'file-bar' }, [
        el('span', { class: 'file-name', text: name }),
        el('span', { class: 'pane-gap' }),
        el('span', { class: 'stat', text: `${lines} line${lines === 1 ? '' : 's'}` }),
        el('button', { class: 'btn', type: 'button', text: 'Copy', onclick: () => {
          navigator.clipboard.writeText(code)
          toast('ok', 'Copied')
        } }),
        el('button', { class: 'btn go', type: 'button', text: 'Save file', onclick: async () => {
          const path = await window.prism.file.save({
            name,
            text: code,
            filters: [{ name: 'File', extensions: [name.split('.').pop()] }]
          })
          if (path) toast('ok', `Written to ${path}`)
        } })
      ]),
      el('div', { class: 'page-body file-body' }, [source(code)])
    ])

    shell.replaceChildren(nav, main)
    shell.append(el('button', { class: 'page-close', type: 'button', 'aria-label': 'Close', html: ico(I.x, 14, 2.2), onclick: closeSheet }))
  }

  paint()
  veil.append(shell)
  veil.onpointerdown = (e) => {
    if (e.target === veil) closeSheet()
  }
}

/* =========================================================== environments */

function openEnvironments() {
  let currentId = S.envId || S.environments[0]?.id || ''
  const body = el('div', { class: 'envs' })

  const paint = () => {
    body.replaceChildren()
    const list = el('div', { class: 'envlist' })
    for (const env of S.environments) {
      list.append(
        el('div', { style: 'display:flex;gap:4px;align-items:center' }, [
          el('button', { class: `envopt${env.id === currentId ? ' on' : ''}`, type: 'button', style: 'flex:1', onclick: () => {
            currentId = env.id
            paint()
          } }, [
            el('span', { class: `env-dot${/prod|live/i.test(env.name) ? ' risky' : ' on'}` }),
            el('span', { class: 'grow', text: env.name }),
            el('span', { class: 'count', text: String(Object.keys(env.values ?? {}).length) })
          ]),
          el('button', { class: 'mini-btn danger', type: 'button', 'aria-label': `Delete ${env.name}`, html: ico(I.bin, 12, 1.9), onclick: () => {
            S.environments = S.environments.filter((e) => e.id !== env.id)
            if (S.envId === env.id) S.envId = S.environments[0]?.id ?? ''
            currentId = S.envId
            paint()
            commit()
          } })
        ])
      )
    }
    list.append(
      el('button', { class: 'addbtn', type: 'button', html: `${ico(I.plus, 10, 2.4)}<span>New environment</span>`, onclick: () => {
        const env = { id: uid('env'), name: 'New environment', values: {}, secrets: [] }
        S.environments.push(env)
        currentId = env.id
        paint()
      } })
    )

    const env = S.environments.find((e) => e.id === currentId)
    const right = el('div')
    if (!env) {
      right.append(el('p', { class: 'note', text: 'No environments yet. Create one, or import a Postman environment.' }))
    } else {
      right.append(
        el('div', { class: 'fieldrow', style: 'margin-bottom:10px' }, [
          el('label', { text: 'Name' }),
          el('input', { value: env.name, oninput: (e) => {
            env.name = e.target.value
            paintBar()
          } })
        ])
      )
      if (/prod|live|release/i.test(env.name)) {
        right.append(
          el('p', { class: 'note', style: 'border-color:rgb(251 191 36 / 0.4);color:var(--hold)', text: 'This environment is named like production. Prism will not stop you — a suite that refuses to touch production is not much of a suite — but every request really is sent.' })
        )
      }
      right.append(el('div', { class: 'lbl' }, [el('span', { text: 'Variables' }), el('em', { text: 'referred to as {{name}}' })]))
      for (const [key, value] of Object.entries(env.values ?? {})) {
        const secret = (env.secrets ?? []).includes(key)
        right.append(
          el('div', { class: 'varline' }, [
            el('input', { class: 'vname', value: key, 'aria-label': 'Variable name', onchange: (e) => {
              const next = e.target.value
              if (!next || next === key) return
              const copy = {}
              for (const [k, v] of Object.entries(env.values)) copy[k === key ? next : k] = v
              env.values = copy
              paint()
            } }),
            el('input', { class: 'vval', value: secret ? '' : String(value), type: secret ? 'password' : 'text', placeholder: secret ? 'held for this session only' : '', 'aria-label': 'Value', oninput: (e) => {
              env.values[key] = e.target.value
            } }),
            el('button', { class: `lockbtn${secret ? ' on' : ''}`, type: 'button', title: secret ? 'Secret — hidden here and never exported' : 'Mark as a secret', html: ico(I.lock, 12, 2), onclick: () => {
              env.secrets = secret ? (env.secrets ?? []).filter((k) => k !== key) : [...(env.secrets ?? []), key]
              paint()
            } }),
            el('button', { class: 'x-btn', style: 'opacity:1', type: 'button', 'aria-label': `Remove ${key}`, html: ico(I.x, 11, 2.3), onclick: () => {
              delete env.values[key]
              paint()
            } })
          ])
        )
      }
      right.append(
        el('button', { class: 'addbtn', type: 'button', html: `${ico(I.plus, 10, 2.4)}<span>Add variable</span>`, onclick: () => {
          let name = 'new_variable'
          let n = 1
          while (Object.prototype.hasOwnProperty.call(env.values, name)) name = `new_variable_${(n += 1)}`
          env.values[name] = ''
          paint()
        } })
      )
    }
    body.append(list, right)
  }
  paint()

  sheet({
    title: 'Environments',
    blurb: 'Values live only in this session. A variable marked secret is hidden here and is never written into an export.',
    body,
    acts: [{ label: 'Use this environment', go: true, onClick: () => {
      S.envId = currentId
      commit()
      toast('ok', `Switched to ${environment()?.name ?? 'none'}`)
    } }]
  })
}

/* ============================================================ page shell */

/**
 * The shell Settings and Help share.
 *
 * A nav rail and a scrolling column, at a size where a paragraph is a
 * paragraph. Both are things people read rather than dismiss, and a dialog the
 * size of a confirm is the wrong container for either.
 */
function page({ title, sections, active, onPick }) {
  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true
  onSheetClose = null

  const nav = el('nav', { class: 'page-nav' }, [el('h3', { text: title })])
  for (const sec of sections) {
    nav.append(
      el('button', {
        class: sec.id === active ? 'on' : '',
        type: 'button',
        html: `${ico(sec.icon, 13, 1.9)}<span>${esc(sec.label)}</span>`,
        onclick: () => onPick(sec.id)
      })
    )
  }
  nav.append(el('span', { class: 'spacer' }))
  nav.append(el('footer', { html: 'Rebind Prism 0.1.0<br />MIT licensed &middot; no account, no key' }))

  const sec = sections.find((x) => x.id === active) ?? sections[0]
  const main = el('div', { class: 'page-main' }, [
    el('div', { class: 'page-head' }, [el('h2', { text: sec.label }), sec.blurb ? el('p', { text: sec.blurb }) : null]),
    el('div', { class: 'page-body' }, [sec.render()])
  ])

  const shell = el('div', { class: 'page' }, [nav, main])
  shell.append(
    el('button', { class: 'page-close', type: 'button', 'aria-label': 'Close', html: ico(I.x, 14, 2.2), onclick: closeSheet })
  )
  veil.append(shell)
  veil.onpointerdown = (e) => {
    if (e.target === veil) closeSheet()
  }
}

/* =============================================================== settings */

let settingsAt = 'Appearance'

const SET_BLURB = {
  Appearance: 'How Prism looks, and how much each node tells you at a glance.',
  Sending: 'What happens when a request actually goes out.',
  Safety: 'Guards that are on by default. Turning one off says what it costs.',
  Data: 'What Prism holds while it is open.',
  About: 'What this is, and what it will not do.'
}

const SET_ICON = {
  Appearance: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  Sending: '<path d="M7 4v16l13-8z"/>',
  Safety: '<path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z"/>',
  Data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/>',
  About: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'
}

function openSettings(section) {
  if (section) settingsAt = section
  const sections = [...SET_GROUPS, 'About'].map((g) => ({
    id: g,
    label: g,
    icon: SET_ICON[g],
    blurb: SET_BLURB[g],
    render: () => (g === 'About' ? aboutPanel() : settingsGroup(g))
  }))
  page({ title: 'Settings', sections, active: settingsAt, onPick: (id) => openSettings(id) })
}

function settingsGroup(group) {
  const box = el('div')
  for (const item of SETTINGS.filter((x) => x.group === group)) box.append(settingRow(item, group))

  if (group === 'Data') {
    box.append(
      el('div', { class: 'prefrow' }, [
        el('div', { class: 'prefwords' }, [
          el('b', { text: 'Run history' }),
          el('p', {
            text: `${S.history.length} run${S.history.length === 1 ? '' : 's'} held in memory. Nothing is written to disk.`
          })
        ]),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Clear',
          onclick: () => {
            S.history = []
            S.results.clear()
            S.previous.clear()
            commit()
            openSettings(group)
            toast('ok', 'History cleared')
          }
        })
      ])
    )
    box.append(
      el('div', { class: 'prefrow' }, [
        el('div', { class: 'prefwords' }, [
          el('b', { text: 'Preferences' }),
          el('p', { text: 'Put every setting back to its default.' })
        ]),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Reset',
          onclick: () => {
            for (const item of SETTINGS) S.prefs[item.id] = item.value
            saveSettings(safeStorage(), S.prefs)
            applyTheme()
            commit()
            openSettings(group)
            toast('ok', 'Settings reset')
          }
        })
      ])
    )
  }
  return box
}

function settingRow(item, group) {
  const value = S.prefs[item.id]
  const control = el('div', { class: 'prefctl' })

  if (item.kind === 'choice') {
    const seg = el('div', { class: 'seg' })
    for (const opt of item.options) {
      seg.append(
        el('button', {
          class: `segbtn${value === opt.id ? ' on' : ''}`,
          type: 'button',
          text: opt.label,
          onclick: () => {
            setPref(item.id, opt.id)
            if (item.id === 'theme') applyTheme()
            openSettings(group)
          }
        })
      )
    }
    control.append(seg)
  } else if (item.kind === 'toggle') {
    control.append(
      el(
        'button',
        {
          class: `switch${value ? ' on' : ''}${item.danger && !value ? ' warn' : ''}`,
          type: 'button',
          role: 'switch',
          'aria-checked': String(Boolean(value)),
          'aria-label': item.label,
          onclick: () => {
            setPref(item.id, !value)
            commit()
            openSettings(group)
          }
        },
        [el('i')]
      )
    )
  } else {
    control.append(
      el('input', {
        class: 'prefnum',
        type: 'number',
        value: String(value),
        min: String(item.min ?? 0),
        max: String(item.max ?? 999999),
        'aria-label': item.label,
        onchange: (e) => {
          setPref(item.id, Math.min(item.max ?? Infinity, Math.max(item.min ?? 0, Number(e.target.value) || item.value)))
          openSettings(group)
        }
      })
    )
    if (item.unit) control.append(el('span', { class: 'prefunit', text: item.unit }))
  }

  return el('div', { class: `prefrow${item.danger && value === false ? ' alert' : ''}` }, [
    el('div', { class: 'prefwords' }, [
      el('b', { text: item.label }),
      el('p', { text: item.help }),
      // Named so the claim that a setting does something is checkable rather
      // than something the reader has to take on trust.
      el('code', { text: item.wiredIn })
    ]),
    control
  ])
}

function aboutPanel() {
  return el('div', { class: 'doc' }, [
    el('p', {
      html:
        '<strong>Rebind Prism</strong> is an open-source desktop workspace for testing an API as a <em>sequence</em> rather than one request at a time. It opens Rebind recordings and Postman collections and takes it from there.'
    }),
    el('h4', { text: 'What it will not do' }),
    el('ul', {}, [
      el('li', {
        html: 'Put a credential in an export. A <code>{{token}}</code> comes out as an environment-variable lookup, in all fifteen targets.'
      }),
      el('li', {
        html: 'Write to disk on its own. Collections, environments and history live in memory; only the settings on this page are remembered.'
      }),
      el('li', { html: 'Record browser traffic — it has no browser. Recordings arrive from Rebind as a file.' }),
      el('li', { html: 'Run a Postman pre-request script. Those are read as text, never executed.' })
    ]),
    el('h4', { text: 'Licence' }),
    el('p', {
      html: 'MIT. No account, no licence key, no gated features — everything it does, it does for everyone.'
    })
  ])
}

/* =================================================================== help */

let helpAt = 'start'

const HELP = [
  {
    id: 'start',
    label: 'Getting started',
    icon: '<path d="M12 3 21 19H3Z"/>',
    blurb: 'The shortest path from a file to a passing test.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('h4', { text: 'Bring something in' }),
        el('p', {
          html: '<strong>Import</strong> in the bar reads four kinds of file: a Rebind workspace export, a Rebind flow, a Postman collection (v2.0 or v2.1) and a Postman environment. Everything arrives as a <strong>collection</strong>.'
        }),
        el('p', {
          html: 'To get a recording out of Rebind, use <strong>Export workspace</strong> on its API page. Every other export it offers writes a suite, which throws away the captured traffic — and that traffic is the part no other tool can reproduce.'
        }),
        el('h4', { text: 'Turn a recording into tests' }),
        el('p', {
          html: 'Recorded calls arrive in the panel at the top right of the plane. Click one to turn it into a test: Prism proposes assertions from what the call actually did — its status, its content type, a field that was present, and a time budget.'
        }),
        el('div', {
          class: 'callout',
          html: 'The budget is deliberately generous. One set to the first run&rsquo;s exact number fails on the second run, and a test that cries wolf gets deleted.'
        }),
        el('h4', { text: 'Send it' }),
        el('p', {
          html: 'Pick a node, then <strong>Send</strong> in the workbench — or the play button on the node. <strong>Run flow</strong> sends every request in the flow in order, so a value captured by one is available to the next.'
        })
      ])
  },
  {
    id: 'structure',
    label: 'Collections & flows',
    icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    blurb: 'Three levels, because that is what the files actually are.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html: 'A <strong>collection</strong> holds <strong>flows</strong>, and a flow holds <strong>requests</strong>. A Postman folder becomes a flow; the collection keeps its own identity, so you can tell where a request came from and re-export it as the shape you opened.'
        }),
        el('h4', { text: 'Adding and deleting' }),
        el('ul', {}, [
          el('li', { html: 'The <strong>+</strong> beside &ldquo;Collections&rdquo; makes a new one.' }),
          el('li', { html: 'The <strong>+</strong> on a collection row adds a flow; on a flow row it adds a request.' }),
          el('li', {
            html: 'The bin on any row deletes it, after a dialog that says what goes with it — deleting a flow takes its requests.'
          })
        ]),
        el('div', {
          class: 'callout warn',
          html: 'None of it is undoable, and Prism holds your work in memory only. Export anything you want to keep.'
        })
      ])
  },
  {
    id: 'plane',
    label: 'The plane',
    icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5"/>',
    blurb: 'How to read a node, and what the beams mean.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html: 'A node is a <strong>label, not an editor</strong>. Everything changeable is in the workbench on the right; the node carries what you need to read the graph, which is why it stays one size and stays legible zoomed out.'
        }),
        el('h4', { text: 'What is on a node' }),
        el('ul', {}, [
          el('li', { html: 'The <strong>method</strong>, as a colour down the left edge and a label.' }),
          el('li', {
            html: 'The <strong>endpoint</strong>, with a <code>{{base_url}}</code> prefix dimmed so the path reads first.'
          }),
          el('li', {
            html: 'A <strong>spec strip</strong>: how it authenticates, whether it carries a body and of what kind, how many query, path and header rows ride along, and the host when that is a literal.'
          }),
          el('li', { html: '<strong>Needs</strong> down the left and <strong>gives</strong> down the right.' }),
          el('li', {
            html: 'The <strong>last result</strong> — status, time, size, assertions — or what it did when it was recorded, if it has not been run here yet.'
          })
        ]),
        el('h4', { text: 'Ports and beams' }),
        el('p', {}, [
          el('span', { class: 'swatch', html: '<i style="border:1.5px solid var(--cyan)"></i>needs a variable' }),
          el('span', { class: 'swatch', html: '<i style="background:var(--magenta)"></i>gives a variable' })
        ]),
        el('p', {
          html: 'A need turns <strong>red</strong> when nothing provides it — no request captures it and no environment sets it. That is the most common reason a chain fails, and it is visible before you send anything.'
        }),
        el('p', {
          html: 'A <strong>beam</strong> is drawn wherever one request captures a value another uses. Beams are derived, never stored: you make the connection by capturing a value and spending it, which is the same act as making the test work.'
        }),
        el('h4', { text: 'Moving around' }),
        el('dl', { class: 'keys' }, [
          el('dt', { text: 'scroll' }),
          el('dd', { text: 'Pan. A two-finger drag on a trackpad does the same.' }),
          el('dt', { text: 'Ctrl scroll' }),
          el('dd', { text: 'Zoom around the pointer. A trackpad pinch is the same gesture.' }),
          el('dt', { text: 'drag background' }),
          el('dd', { text: 'Pan.' }),
          el('dt', { text: 'Space drag' }),
          el('dd', { text: 'Pan from anywhere, over a node included.' }),
          el('dt', { text: 'middle drag' }),
          el('dd', { text: 'The same, for a mouse with a wheel button.' }),
          el('dt', { text: 'drag a node' }),
          el('dd', { text: 'Move it. It then stays where you put it.' })
        ]),
        el('p', {
          html: '<strong>Fit</strong> frames everything; <strong>Tidy</strong> lays the nodes back out in order and forgets any you moved.'
        })
      ])
  },
  {
    id: 'chain',
    label: 'Chaining',
    icon: '<path d="M9 15 15 9"/><path d="M11 6.5 13 4.5a4 4 0 0 1 6 6l-2 2"/><path d="M13 17.5 11 19.5a4 4 0 0 1-6-6l2-2"/>',
    blurb: 'Carrying a value from one request to the next.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html: 'On the <strong>Chain</strong> tab, give a value a name and say where to find it — a JSON path in the body, or a header. When the request runs, that value lands in the current environment under the name.'
        }),
        el('p', {
          html: 'Any later request that writes <code>{{that_name}}</code> — in its URL, a parameter, a header, the body or the auth block — picks it up. Nobody copies anything.'
        }),
        el('h4', { text: 'Paths' }),
        el('p', {
          html: '<code>data.token</code>, <code>data.items[0].id</code> and <code>data.items.0.id</code> all work. A path that is not there yields nothing rather than an error.'
        }),
        el('div', {
          class: 'callout',
          html: 'Chained values are written into the environment, so they appear on the Environments page and last until you switch environment or close Prism.'
        })
      ])
  },
  {
    id: 'tests',
    label: 'Assertions',
    icon: '<path d="M4 12.5 9 17.5 20 6.5"/>',
    blurb: 'Every subject, and the operators it takes.',
    body: () => {
      const doc = el('div', { class: 'doc' })
      doc.append(
        el('p', {
          html: 'An assertion is a <strong>subject</strong> and an <strong>operator</strong>, so either half can change without picking a different assertion from a list. Every result says what it actually saw — a red row that will not tell you what it found is a row people delete.'
        })
      )
      for (const subject of SUBJECTS) {
        const ops = (OPERATORS[subject.id] ?? []).map((o) => OP_LABEL[o] ?? o).join(', ')
        doc.append(el('h4', { text: subject.label }))
        doc.append(el('p', { html: `<code>${esc(ops)}</code>` }))
      }
      doc.append(
        el('div', {
          class: 'callout',
          html: 'Comparisons are loose where it helps: <code>"200"</code> typed into a text box matches the number <code>200</code>.'
        })
      )
      return doc
    }
  },
  {
    id: 'export',
    label: 'Export',
    icon: '<path d="M12 14V3"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M4 20h16"/>',
    blurb: 'Fifteen targets, and the one rule about credentials.',
    body: () => {
      const doc = el('div', { class: 'doc' })
      doc.append(
        el('div', {
          class: 'callout',
          html: '<strong>No credential is ever resolved into an export.</strong> A <code>{{token}}</code> comes out as a read of an environment variable, in every target. Exported files get committed, pasted into tickets and shown on screen shares.'
        })
      )
      for (const group of GROUPS) {
        const items = TARGETS.filter((t) => t.group === group)
        if (!items.length) continue
        doc.append(el('h4', { text: group }))
        doc.append(el('ul', {}, items.map((t) => el('li', { html: `${esc(t.label)} &mdash; <code>.${esc(t.ext)}</code>` }))))
      }
      doc.append(
        el('p', {
          html: 'The Postman export declares variable <em>names</em> with empty values for the same reason: writing a live token into a collection file is exactly the leak the rule exists to prevent.'
        })
      )
      return doc
    }
  },
  {
    id: 'keys',
    label: 'Shortcuts',
    icon: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
    blurb: 'Everything reachable without the mouse.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('dl', { class: 'keys' }, [
          el('dt', { text: 'Ctrl K' }),
          el('dd', { text: 'Find a request, or run a command' }),
          el('dt', { text: 'Ctrl Enter' }),
          el('dd', { text: 'Send the request in the workbench' }),
          el('dt', { text: 'Enter' }),
          el('dd', { text: 'From the endpoint field, send' }),
          el('dt', { text: 'F1' }),
          el('dd', { text: 'Open this help' }),
          el('dt', { text: 'Escape' }),
          el('dd', { text: 'Close whatever is open' }),
          el('dt', { text: 'Up / Down' }),
          el('dd', { text: 'On the split handle, resize the workbench' })
        ]),
        el('p', {
          html: 'The palette also reaches Settings, Help, Environments, History, Import, Export, Run flow and Tidy — anything in the bar has an entry there.'
        })
      ])
  },
  {
    id: 'privacy',
    label: 'Privacy',
    icon: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    blurb: 'Where your data goes, which is nowhere.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('h4', { text: 'What leaves this machine' }),
        el('p', {
          html: 'Only the requests you send, to the hosts you aim them at. Prism has no telemetry, no account, no update check and no network use of its own.'
        }),
        el('h4', { text: 'What is stored' }),
        el('ul', {}, [
          el('li', { html: 'The settings on the Settings page, in the app&rsquo;s own local storage.' }),
          el('li', {
            html: 'Everything else — collections, environments, results, history — in memory only, gone when Prism closes.'
          })
        ]),
        el('h4', { text: 'Credentials' }),
        el('ul', {}, [
          el('li', { html: 'Never resolved into an export, in any target.' }),
          el('li', {
            html: 'Masked in the inspector&rsquo;s request headers, unless you turn that off in Settings &rarr; Safety.'
          }),
          el('li', {
            html: 'A variable marked <strong>secret</strong> on the Environments page is hidden in its field and left out of exports.'
          })
        ]),
        el('div', {
          class: 'callout warn',
          html: 'Response bodies are shown exactly as they arrive. If an API returns a token, Prism displays it — and Insights points that out.'
        })
      ])
  }
]

function openHelp(section) {
  if (section) helpAt = section
  page({
    title: 'Help',
    sections: HELP.map((h) => ({ ...h, render: h.body })),
    active: helpAt,
    onPick: (id) => openHelp(id)
  })
}

/* ================================================================ history */

/**
 * History.
 *
 * Grouped by request rather than laid out as one long list of times. What
 * people come here for is "did this get slower" or "when did this start
 * failing", and both are questions about one endpoint over several runs — a
 * flat reverse-chronological list buries that under everything else that ran
 * in between.
 */
let historyOf = ''

function openHistory() {
  const byRequest = new Map()
  for (const h of S.history) {
    if (!byRequest.has(h.requestId)) byRequest.set(h.requestId, [])
    byRequest.get(h.requestId).push(h)
  }

  if (!byRequest.size) {
    page({
      title: 'History',
      sections: [
        {
          id: 'none',
          label: 'Nothing yet',
          icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
          blurb: 'Runs from this session appear here.',
          render: () =>
            el('p', { class: 'note', text: 'Send a request and every run of it is kept here until Prism closes. Nothing is written to disk.' })
        }
      ],
      active: 'none',
      onPick: () => {}
    })
    return
  }

  const ids = [...byRequest.keys()]
  if (!byRequest.has(historyOf)) historyOf = ids[0]

  const sections = ids.map((id) => {
    const runs = byRequest.get(id)
    const worst = runs.some((r) => r.failed)
    return {
      id,
      label: runs[0].name,
      icon: worst ? '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>' : '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
      blurb: `${runs.length} run${runs.length === 1 ? '' : 's'} · ${runs[0].method} ${shortPath(runs[0].url)}`,
      render: () => historyFor(runs)
    }
  })

  page({ title: 'History', sections, active: historyOf, onPick: (id) => {
    historyOf = id
    openHistory()
  } })
}

function historyFor(runs) {
  const box = el('div')
  const times = runs.map((r) => r.ms)
  const slowest = Math.max(...times, 1)
  const failed = runs.filter((r) => r.failed).length

  box.append(
    el('div', { class: 'tiles' }, [
      tile('', String(runs.length), 'runs'),
      tile(failed ? 'bad' : 'ok', `${runs.length - failed}/${runs.length}`, 'passed'),
      tile('info', `${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}`, 'ms average'),
      tile(slowest > 1000 ? 'warn' : '', String(slowest), 'ms slowest')
    ])
  )

  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Every run' }), el('em', { text: 'newest first' })]))
  for (const h of runs) {
    box.append(
      el('button', { class: 'run-row', type: 'button', onclick: () => {
        closeSheet()
        pick(h.requestId)
      } }, [
        el('span', { class: 'when', text: new Date(h.at).toLocaleTimeString() }),
        el('span', { class: `code ${tone(h.status)}`, text: String(h.status || 'ERR') }),
        // A bar rather than only a number: the point of a list of runs is the
        // shape of it, and eight numbers in a column do not have one.
        el('span', { class: 'run-bar' }, [
          el('span', {
            class: `run-fill${h.ms > 1000 ? ' slow' : ''}`,
            style: `width:${Math.max(2, (h.ms / slowest) * 100)}%`
          })
        ]),
        el('span', { class: 'run-ms', text: `${h.ms} ms` }),
        el('span', { class: 'run-env', text: h.env })
      ])
    )
  }
  return box
}

/* ============================================================== flow run */

async function runFlow(only) {
  const req = current()
  const flow = only ?? (req ? flowOf(req.id) : null) ?? allFlows().find((f) => f.requests.length)
  if (!flow) {
    toast('bad', 'There is no flow to run.')
    return
  }

  const state = flow.requests.map((r) => ({ id: r.id, name: r.name, status: 'wait', ms: 0 }))
  const body = el('div', { class: 'suite' })
  const ring = el('div', { class: 'ring' })
  const steps = el('div', { class: 'steps' })

  const paint = () => {
    const done = state.filter((s) => s.status === 'pass' || s.status === 'fail').length
    const failed = state.filter((s) => s.status === 'fail').length
    const pct = state.length ? done / state.length : 0
    const C = 2 * Math.PI * 58
    ring.innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140">
        <circle class="tr" cx="70" cy="70" r="58"></circle>
        <circle class="fl${failed ? ' bad' : ''}" cx="70" cy="70" r="58" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg><b>${Math.round(pct * 100)}%</b>`
    steps.replaceChildren()
    for (const s of state) {
      steps.append(
        el('div', { class: `step${s.status === 'wait' ? ' wait' : ''}` }, [
          el('span', { class: `state ${s.status === 'run' ? 'busy' : s.status === 'wait' ? '' : s.status}` }),
          el('span', { class: 'nm', text: s.name }),
          el('span', { class: 'ms', text: s.ms ? `${s.ms}ms` : s.status })
        ])
      )
    }
    body.replaceChildren(ring, steps)
  }
  paint()
  sheet({ title: `Running ${flow.name}`, blurb: 'In order, so a value captured by one request is available to the next.', body, acts: [] })

  for (const step of state) {
    const request = findRequest(step.id)
    if (!request) continue
    step.status = 'run'
    paint()
    await send(request)
    const res = S.results.get(step.id)
    step.ms = res?.timing?.total ?? 0
    step.status = res?.failed ? 'fail' : 'pass'
    paint()
  }
  const failed = state.filter((s) => s.status === 'fail').length
  toast(failed ? 'bad' : 'ok', `${flow.name} — ${state.length - failed} passed, ${failed} failed`)
}

/** Every flow in a collection, in order. */
async function runCollection(col) {
  for (const flow of col.flows) {
    if (flow.requests.length) await runFlow(flow)
  }
}

/* ================================================================= sheets */

let sheetUp = false

let onSheetClose = null

function sheet({ title, blurb, body, acts, onClose }) {
  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true
  onSheetClose = onClose ?? null

  const low = el('div', { class: 'sheet-low' }, [
    el('button', { class: 'btn plain', type: 'button', text: 'Close', onclick: closeSheet }),
    el('span', { class: 'spacer' })
  ])
  for (const a of acts ?? []) {
    low.append(
      el('button', { class: `btn${a.go ? ' go' : ''}${a.bad ? ' bad' : ''}`, type: 'button', text: a.label, onclick: async () => {
        await a.onClick?.()
        if (a.keepOpen !== true) closeSheet()
      } })
    )
  }

  veil.append(
    el('div', { class: 'sheet' }, [
      el('div', { class: 'sheet-top' }, [el('h2', { text: title }), blurb ? el('p', { text: blurb }) : null]),
      el('div', { class: 'sheet-mid' }, [body]),
      low
    ])
  )
  veil.onpointerdown = (e) => {
    if (e.target === veil) closeSheet()
  }
}

/** A confirm that can be awaited, for a decision taken mid-flow. */
function ask({ title, blurb, danger }) {
  return new Promise((resolve) => {
    let answered = false
    sheet({
      title,
      blurb,
      body: el('p', { class: 'note', text: 'Nothing has been sent yet.' }),
      acts: [{ label: danger, bad: true, onClick: () => {
        answered = true
        resolve(true)
      } }],
      onClose: () => {
        if (!answered) resolve(false)
      }
    })
  })
}

/**
 * A destructive confirm.
 *
 * Its own shape, not the wide sheet. Three things a generic "are you sure"
 * cannot do, and all three are the reason this exists:
 *
 *   1. It shows the thing. Reading the name of what you are about to delete
 *      off a card that looks like the card on the plane removes the whole
 *      class of "wrong one selected" mistake.
 *   2. It lists what goes with it, counted rather than implied.
 *   3. It names the damage downstream. Deleting a request that gives a
 *      variable quietly breaks every request that spends it, and that is the
 *      consequence nobody thinks of until the next run goes red.
 *
 * Cancel is the default: it is focused on open, and Escape takes it.
 */
function askDelete({ kind, subject, goes, breaks, danger, onYes }) {
  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true
  onSheetClose = null

  const body = el('div', { class: 'ask-body' })

  body.append(
    el('div', { class: 'ask-head' }, [
      el('span', { class: 'ask-mark', html: ico('<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/>', 17, 1.8) }),
      el('div', {}, [
        el('h2', { text: `Delete this ${kind}?` }),
        el('p', { text: 'It cannot be brought back from inside Prism.' })
      ])
    ])
  )

  body.append(subject)

  if (goes.length) {
    body.append(el('div', { class: 'ask-label', text: 'What goes with it' }))
    body.append(el('ul', { class: 'ask-list' }, goes.map((g) => el('li', { text: g }))))
  }

  if (breaks.length) {
    // Counted by request, not by dependency: one request that spends two of
    // this one's variables is still one request, and saying "9 requests"
    // when six are affected is the kind of small lie that costs trust.
    const affected = new Set(breaks.map((b) => b.name)).size
    body.append(
      el('div', { class: 'ask-warn' }, [
        el('span', { class: 'ask-warn-mark', html: ico('<path d="M12 4 22 20H2z"/><path d="M12 10v4M12 17h.01"/>', 15, 1.7) }),
        el('div', {}, [
          el('b', { text: affected === 1 ? 'One request depends on this' : `${affected} requests depend on this` }),
          el('p', {
            html: breaks
              .map((b) => `<code>${esc(b.name)}</code> needs <code>{{${esc(b.variable)}}}</code>`)
              .slice(0, 4)
              .join('<br />') + (breaks.length > 4 ? `<br />and ${breaks.length - 4} more` : '')
          }),
          el('em', { text: 'They will show the variable as missing until something else provides it.' })
        ])
      ])
    )
  }

  const cancel = el('button', { class: 'btn plain', type: 'button', text: 'Cancel', onclick: closeSheet })
  body.append(
    el('div', { class: 'ask-acts' }, [
      cancel,
      el('button', { class: 'btn bad', type: 'button', text: danger, onclick: () => {
        closeSheet()
        onYes()
      } })
    ])
  )

  veil.append(el('div', { class: 'ask' }, [body]))
  veil.onpointerdown = (e) => {
    if (e.target === veil) closeSheet()
  }
  // Cancel takes the focus, so a stray Enter or Space does nothing destructive.
  cancel.focus()
}

/** The row a confirm shows, drawn like the node it refers to. */
function subjectCard(req) {
  return el('div', { class: 'ask-subject' }, [
    el('span', { class: `verb ${req.method.toLowerCase()}`, text: req.method }),
    el('div', { class: 'ask-subject-words' }, [
      el('b', { text: req.name || 'Untitled' }),
      el('span', { html: pathLabel(req.url) })
    ])
  ])
}

function subjectGroup(icon, name, sub) {
  return el('div', { class: 'ask-subject' }, [
    el('span', { class: 'ask-subject-icon', html: ico(icon, 15, 1.8) }),
    el('div', { class: 'ask-subject-words' }, [el('b', { text: name }), el('span', { text: sub })])
  ])
}

/**
 * Which requests spend a variable that this one is the only source of.
 *
 * "Only source" matters: if the environment also sets it, or a second request
 * captures the same name, deleting this one breaks nothing and saying it would
 * is a false alarm.
 */
function dependants(going) {
  const goingIds = new Set(going.map((r) => r.id))
  const known = envValues()
  const out = []

  for (const req of going) {
    for (const cap of req.captures ?? []) {
      if (!cap.name) continue
      if (Object.prototype.hasOwnProperty.call(known, cap.name)) continue
      const otherSource = allRequests().some(
        (r) => !goingIds.has(r.id) && (r.captures ?? []).some((c) => c.name === cap.name)
      )
      if (otherSource) continue
      for (const user of allRequests()) {
        if (goingIds.has(user.id)) continue
        if (variablesUsed(user).includes(cap.name)) out.push({ name: user.name, variable: cap.name })
      }
    }
  }
  return out
}

function closeSheet() {
  $('veil').hidden = true
  $('veil').replaceChildren()
  sheetUp = false
  const fn = onSheetClose
  onSheetClose = null
  fn?.()
}

/* =============================================================== palette */

function openPalette() {
  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true

  const items = allRequests().map((r) => ({ label: r.name, sub: `${r.method} ${shortPath(r.url)}`, run: () => pick(r.id) }))
  items.push(
    { label: 'Import a collection', sub: 'rebind or postman', run: doImport },
    { label: 'Export', sub: 'code or collection', run: openExport },
    { label: 'Environments', sub: 'variables', run: openEnvironments },
    { label: 'History', sub: 'this session', run: openHistory },
    { label: 'Run the flow', sub: 'in order', run: runFlow },
    { label: 'New collection', sub: 'empty', run: newCollection },
    { label: 'Tidy the plane', sub: 'lay out in order', run: tidy },
    { label: 'Settings', sub: 'theme, sending, safety', run: () => openSettings() },
    { label: 'Help', sub: 'how any of this works', run: () => openHelp() }
  )

  let index = 0
  let shown = items
  const list = el('div', { class: 'pal-list' })
  const input = el('input', { placeholder: 'Find a request, or run a command…', 'aria-label': 'Search' })

  const paint = () => {
    list.replaceChildren()
    shown.forEach((item, i) => {
      list.append(
        el('button', { class: `pal-item${i === index ? ' on' : ''}`, type: 'button', onclick: () => {
          closeSheet()
          item.run()
        } }, [el('span', { text: item.label }), el('span', { class: 'sub', text: item.sub })])
      )
    })
  }

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase()
    shown = items.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q))
    index = 0
    paint()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      index = Math.min(index + 1, shown.length - 1)
      paint()
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      index = Math.max(index - 1, 0)
      paint()
      e.preventDefault()
    } else if (e.key === 'Enter' && shown[index]) {
      closeSheet()
      shown[index].run()
    }
  })

  paint()
  veil.append(el('div', { class: 'pal' }, [input, list]))
  veil.onpointerdown = (e) => {
    if (e.target === veil) closeSheet()
  }
  input.focus()
}

/* ==================================================================== boot */

function wire() {
  $('winMin').onclick = () => window.prism.window.minimize()
  $('winMax').onclick = () => window.prism.window.maximize()
  $('winClose').onclick = () => window.prism.window.close()

  $('importBtn').onclick = doImport
  $('emptyImport').onclick = doImport
  $('exportBtn').onclick = openExport
  $('runFlowBtn').onclick = runFlow
  $('envPick').onclick = openEnvironments
  $('envBtn').onclick = openEnvironments
  $('historyBtn').onclick = openHistory
  $('finder').onclick = openPalette
  $('settingsBtn').onclick = () => openSettings()
  $('helpBtn').onclick = () => openHelp()
  $('newCollectionBtn').onclick = newCollection
  $('intakeHide').onclick = () => {
    $('intake').hidden = true
  }
  $('intakeAll').onclick = () => {
    const list = [...S.recorded]
    for (const r of list) convert(r)
    toast('ok', `${list.length} recorded calls converted`)
  }
  $('emptyNew').onclick = () => {
    if (!S.collections.length) newCollection()
    const col = S.collections[0]
    if (!col.flows.length) col.flows.push(emptyFlow('Flow 1'))
    addRequest(col.flows[0])
  }

  $('benchName').oninput = (e) => {
    const req = current()
    if (!req) return
    req.name = e.target.value
    paintTree()
    const n = document.querySelector(`.node[data-id="${req.id}"] .node-name`)
    if (n) n.textContent = req.name || 'Untitled'
  }
  $('urlInput').oninput = (e) => {
    const req = current()
    if (!req) return
    req.url = e.target.value
    live(req)
  }
  $('urlInput').onkeydown = (e) => {
    if (e.key === 'Enter') {
      const req = current()
      if (req) send(req)
    }
  }
  $('methodPick').onchange = (e) => {
    const req = current()
    if (!req) return
    req.method = e.target.value
    commit()
  }
  $('sendBtn').onclick = () => {
    const req = current()
    if (req) send(req)
  }
  $('reqGrow').onclick = () => fillPane('request')
  $('resGrow').onclick = () => fillPane('response')
  $('reqFold').onclick = () => foldPane('request')
  $('resFold').onclick = () => foldPane('response')
  // Double-click the handle to go back to an even split, which is what people
  // try first when they have dragged it somewhere unhelpful.
  $('benchGrip').ondblclick = () => {
    S.split = 55
    S.pane = 'split'
    layoutPanes()
  }

  $('copyBody').onclick = () => {
    const res = S.results.get(S.pickedId)
    if (!res) return
    navigator.clipboard.writeText(res.json !== undefined ? JSON.stringify(res.json, null, 2) : (res.body ?? ''))
    toast('ok', 'Response copied')
  }
  $('benchMore').onclick = (e) => {
    const req = current()
    if (req) openMenu(e.currentTarget, requestMenu(req))
  }

  const grip = $('benchGrip')
  grip.onkeydown = (e) => {
    if (e.key === 'ArrowUp') S.split = clamp(S.split - 4, 15, 88)
    if (e.key === 'ArrowDown') S.split = clamp(S.split + 4, 15, 88)
    S.pane = 'split'
    layoutPanes()
  }
  grip.onpointerdown = (e) => {
    S.pane = 'split'
    const host = $('benchSplit')
    const box = host.getBoundingClientRect()
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev) => {
      S.split = clamp(((ev.clientY - box.top) / box.height) * 100, 15, 88)
      layoutPanes()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      sheetUp ? closeSheet() : openPalette()
    } else if (e.key === 'F2' && S.pickedId && !sheetUp) {
      e.preventDefault()
      startRename(S.pickedId)
    } else if (e.key === 'F1') {
      e.preventDefault()
      openHelp()
    } else if (e.key === 'Escape' && sheetUp) {
      closeSheet()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const req = current()
      if (req) send(req)
    }
  })

  window.addEventListener('resize', drawBeams)
}

function boot() {
  S.prefs = loadSettings(safeStorage())
  applyTheme()
  wire()
  wirePlane()
  // Opens on a worked example rather than an empty plane: a login that gives a
  // token, requests that spend it, and one wired to a value nothing provides.
  applyImport(readCollection(JSON.stringify(demoWorkspace()), 'demo'))
  commit()
}

boot()
