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
import { compile, buildUrl, variablesUsed, interpolate } from '../lib/request.js'
import { runAll, emptyAssertion, SUBJECTS, OPERATORS, OP_LABEL, suggestFor, jsonPath } from '../lib/assert.js'
import { analyse, bytes as fmtBytes } from '../lib/insights.js'
import { tree, diff, diffSummary } from '../lib/schema.js'
import { TARGETS, GROUPS, WHOLE_FLOW, generate, slug } from '../lib/codegen.js'
import { SETTINGS, GROUPS as SET_GROUPS, load as loadSettings, save as saveSettings, themeAttribute } from '../lib/settings.js'
import { serialise, parse as parseWorkspace, countIn, missingSecrets, matchesSaved } from '../lib/workspace.js'
import { plan, describe as describePlan, outOfOrder } from '../lib/plan.js'
import { fromCurl } from '../lib/curl.js'
import { lines as jsonLines, suggestName, capturable } from '../lib/jsonlines.js'
import { effectiveHeaders, effectiveAuth, withInherited, inheritedFor, anyInherited } from '../lib/inherit.js'
import { label as gqlLabel, errorsIn, looksGraphQL, INTROSPECTION, readSchema, stubFor } from '../lib/graphql.js'
import { GRANTS, SECRET_FIELDS, emptyOauth, tokenRequest, readToken, stale, nextStep, missingFields, refreshWith, remaining } from '../lib/oauth.js'
import { summarise, flaky as flakyRuns, spark, headline, repeatVerdict } from '../lib/trend.js'
import { readDataset, scopeFor, labelFor, unusedColumns } from '../lib/dataset.js'
import { parseDotEnv, audit as auditEnv, looksSecret, copyName, freeName, renameKey, compare as compareEnvs } from '../lib/env.js'
import { DYNAMIC, DYNAMIC_HELP } from '../lib/request.js'
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
  check: '<path d="m4 12 5.5 5.5L20 7"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 11h6M9 15h4"/>',
  unlock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
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
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
  snow: '<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M9 10v9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  // A floppy disk, still the only glyph everyone reads as "save".
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  revert: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'
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
  prefs: {},
  /** requestId -> a response deliberately frozen as the known-good shape. */
  baselines: new Map(),
  /** What the tree is filtered to. */
  filter: '',
  /** What the response body is searched for. */
  find: '',
  /** Set once anything changes, cleared once the autosave lands. */
  dirty: false,
  savedName: 'Workspace',
  /**
   * The file this workspace is being edited as, if any.
   *
   * What turns Save from "always ask me where" into an actual save. Set by Open
   * and by Save as; empty for a workspace that has only ever lived in the
   * autosave, where Save has to ask once.
   */
  filePath: '',
  /** Set while a write is in flight, so the state chip can say so. */
  saving: false,
  /** True once what is on screen differs from the file on disk. */
  fileDirty: false
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
  touch()
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

/* ============================================================ persistence

   Everything used to vanish when Prism closed: import a collection, spend
   twenty minutes wiring a chain, close the window, and it was gone. That
   undermined every other feature — History could not show a trend and Diff
   could only ever compare within one session.

   The working state is written to the app's own directory on a debounce, and
   restored on the next start. Save and Open write a file people can commit. */

let saveTimer = 0
let booting = true

/** Marks the workspace changed and schedules a save. */
function touch() {
  if (booting) return
  S.dirty = true
  // Tracked separately from `dirty`, which the autosave clears. A change is
  // still unsaved *as far as the file is concerned* until someone writes it,
  // and conflating the two is how an indicator comes to read "everything
  // saved" over a file twenty edits behind.
  if (S.filePath) S.fileDirty = true
  paintSaveState()
  clearTimeout(saveTimer)
  // Debounced: typing in a URL should not write a file per keystroke, and
  // three seconds of quiet is a natural pause.
  saveTimer = setTimeout(autosave, 3000)
}

/**
 * Writes the working state to the app's own directory.
 *
 * `force` exists because of a real way to lose work. The debounce fires three
 * seconds after you stop typing, and `dirty` is cleared by *any* successful
 * write — including an explicit Save to a file. So: edit, press Ctrl+S within
 * three seconds, close. The file has the edit; `dirty` is false, so the
 * pending autosave declines to run and the app's own copy is left holding the
 * state from before. On the next start that older copy is what came back, and
 * the work looked lost even though the file was correct.
 *
 * Keeping the two in step is the fix, so every file save forces one of these.
 */
async function autosave({ force = false } = {}) {
  if ((!S.dirty && !force) || S.prefs.autosave === false) return
  const out = await window.prism.workspace.autosave(workspaceText())
  if (out?.ok) {
    S.dirty = false
    paintSaveState()
  } else if (out?.error) {
    toast('bad', `Could not save: ${out.error}`)
  }
}

/** Just the file name, which is the part anyone recognises. */
const fileLabel = (path) => String(path).replace(/\\/g, '/').split('/').pop() || String(path)

/**
 * Which of five states the workspace is in.
 *
 * Named rather than derived inline in three places, because the distinction
 * that matters is between "kept in the app" and "written to your file", and
 * every caller has to make the same one.
 */
function saveState() {
  if (S.saving) return 'saving'
  if (S.filePath) return S.fileDirty ? 'unsaved' : 'saved'
  return S.dirty ? 'pending' : 'autosaved'
}

/**
 * The save control: what state the workspace is in, and the way to act on it.
 *
 * This used to be a six-pixel unlabelled dot with a tooltip, next to a bar
 * offering Import, Export and Run and no Save at all. Saving existed the whole
 * time — an autosave, Ctrl+S, two command-palette entries — and none of it was
 * visible, which from the outside is indistinguishable from not existing. So
 * the state is spelled out in words, beside a button that does the thing.
 */
function paintSaveState() {
  const state = saveState()
  const dot = $('saveState')
  const btn = $('saveBtn')
  const label = $('saveLabel')

  if (dot) {
    dot.className = `save-state is-${state}`
    dot.title = {
      saved: `Saved to ${S.filePath}`,
      unsaved: `Unsaved changes — ${S.filePath}`,
      saving: 'Saving…',
      pending: 'Kept in the app; saving shortly. Save to a file to keep a copy you can commit.',
      autosaved: 'Kept in the app between sessions. Save to a file to keep a copy you can commit.'
    }[state]
  }

  if (label) {
    label.textContent = S.filePath ? fileLabel(S.filePath) : 'Not saved to a file'
    label.classList.toggle('muted', !S.filePath)
    label.title = S.filePath || 'This workspace lives in the app’s own storage. Save it to a file to keep or share it.'
  }

  if (btn) {
    btn.classList.toggle('dirty', state === 'unsaved' || state === 'pending')
    btn.disabled = state === 'saving'
    btn.title = S.filePath
      ? S.fileDirty
        ? `Save changes to ${fileLabel(S.filePath)} (Ctrl+S)`
        : `No changes since the last save — ${fileLabel(S.filePath)} (Ctrl+S)`
      : 'Save this workspace to a file (Ctrl+S)'
  }
}

/** Puts a parsed workspace on screen, replacing whatever is there. */
function adopt(workspace, note) {
  S.collections = workspace.collections
  S.environments = workspace.environments
  S.envId = workspace.envId
  S.layout = workspace.layout
  S.baselines = workspace.baselines
  S.savedName = workspace.name
  S.results.clear()
  S.previous.clear()
  S.history = []
  S.pickedId = allRequests()[0]?.id ?? ''
  commit()
  setTimeout(fit, 30)

  const gone = missingSecrets(workspace)
  if (gone.length) {
    // Said out loud rather than left to fail at send time: the values were
    // withheld on purpose and only the person opening the file can restore
    // them.
    toast('bad', `${gone.length} secret${gone.length === 1 ? '' : 's'} need refilling: ${gone.slice(0, 3).join(', ')}`)
  }
  if (note) toast('ok', note)
}

/**
 * What was open last time, back on screen — and back as the same document.
 *
 * Two things come back, and only one of them used to. The autosave carries the
 * *content*, including edits made after the last explicit save. The remembered
 * path carries which file that content belongs to, and without it a restart
 * left the work on screen but the app reading "Not saved to a file": Save
 * asked for a location again, and the file you had been editing all week was
 * no longer the file you were editing.
 *
 * Preference order when both exist: the autosave wins as the *content*,
 * because it is never older than the file and may hold work the file has not
 * got. The file is then compared against it to decide whether anything is
 * outstanding, so the indicator is honest from the first paint rather than
 * claiming "saved" over a workspace that is three edits ahead.
 */
async function restoreWorkspace() {
  const saved = await window.prism.workspace.restore()
  if (!saved) return false

  // A file remembered with no autosave beside it: saved, closed cleanly, and
  // opened again. Read the file itself.
  if (!saved.text?.trim()) {
    if (!saved.filePath) return false
    const back = await window.prism.workspace.reread(saved.filePath)
    if (!back?.text) return false
    const fromFile = parseWorkspace(back.text, back.name)
    if (!fromFile.ok || !countIn(fromFile.workspace)) return false
    adopt(fromFile.workspace)
    S.filePath = saved.filePath
    S.fileDirty = false
    S.dirty = false
    return true
  }

  const result = parseWorkspace(saved.text, 'the saved workspace')
  if (!result.ok) {
    toast('bad', result.error)
    return false
  }
  if (!countIn(result.workspace)) return false
  adopt(result.workspace)

  if (saved.filePath) {
    S.filePath = saved.filePath
    // Compared rather than assumed. `serialise` is deterministic for a given
    // state, so an identical string means the file genuinely holds this
    // workspace and the dot can say "saved" truthfully.
    const onDisk = await window.prism.workspace.reread(saved.filePath)
    // Compared on the authored content only. A straight text comparison can
    // never match: `serialise` stamps a fresh `savedAt` every call, so a
    // workspace restored moments after being saved came back flagged as
    // having unsaved changes.
    S.fileDirty = !onDisk?.text || !matchesSaved(onDisk.text, serialise(S, { name: S.savedName }))
    if (S.fileDirty) {
      toast('hold', `${fileLabel(saved.filePath)} has unsaved changes from last time — Ctrl+S writes them`)
    }
  }
  return true
}

async function openWorkspace() {
  if (!(await keepOrDiscard('Opening another workspace'))) return
  const chosen = await window.prism.file.open([
    { name: 'Prism workspace', extensions: ['json'] },
    { name: 'All files', extensions: ['*'] }
  ])
  if (!chosen) return
  const result = parseWorkspace(chosen.text, chosen.name)
  if (!result.ok) {
    toast('bad', result.error)
    return
  }
  adopt(result.workspace, `Opened ${result.workspace.name} — ${countIn(result.workspace)} requests`)
  // Remembered, so Save writes back here rather than asking again. This is the
  // whole reason `file:open` hands back a path.
  S.filePath = chosen.path ?? ''
  S.fileDirty = false
  touch()
  paintSaveState()
}

/** The workspace as it would be written. */
const workspaceText = () => JSON.stringify(serialise(S, { name: S.savedName }), null, 2)

/**
 * Save, in the sense every other application means it.
 *
 * Writes back to the open file when there is one, and asks only the first
 * time. It used to ask every single time, which is what made a one-key Save
 * behave like an export — and, together with there being no button anywhere,
 * why the tool read as having no save at all.
 */
async function saveWorkspace() {
  if (!S.filePath) return saveWorkspaceAs()
  S.saving = true
  paintSaveState()
  const out = await window.prism.workspace.write({ path: S.filePath, text: workspaceText() })
  S.saving = false
  if (out?.ok) {
    S.fileDirty = false
    // Forced, so the app's own copy cannot be left older than the file it was
    // just written to. See the note on `autosave`.
    await autosave({ force: true })
    S.dirty = false
    paintSaveState()
    toast('ok', `Saved ${fileLabel(S.filePath)}`)
    return true
  }
  paintSaveState()
  // A file that has moved, or gone read-only, must not silently do nothing.
  toast('bad', out?.error ? `Could not save: ${out.error}` : 'Could not save that file')
  return false
}

async function saveWorkspaceAs() {
  S.saving = true
  paintSaveState()
  const out = await window.prism.workspace.saveAs({ name: slug(S.savedName), text: workspaceText() })
  S.saving = false
  if (out?.error) {
    paintSaveState()
    toast('bad', `Could not save: ${out.error}`)
    return false
  }
  if (!out?.path) {
    paintSaveState()
    return false
  }
  S.filePath = out.path
  S.fileDirty = false
  await autosave({ force: true })
  S.dirty = false
  paintSaveState()
  toast('ok', `Saved to ${out.path}`)
  return true
}

/** Throws away what is on screen and re-reads the file on disk. */
async function revertWorkspace() {
  if (!S.filePath) return
  const yes = await ask({
    title: `Discard changes to ${fileLabel(S.filePath)}?`,
    blurb: 'Everything since the last save will be lost, and the file on disk reloaded in its place.',
    danger: 'Discard and reload'
  })
  if (!yes) return
  const back = await window.prism.workspace.reread(S.filePath)
  if (!back?.text) {
    toast('bad', back?.error ? `Could not read that file: ${back.error}` : 'That file is no longer readable')
    return
  }
  const result = parseWorkspace(back.text, back.name)
  if (!result.ok) {
    toast('bad', result.error)
    return
  }
  const path = S.filePath
  adopt(result.workspace, `Reloaded ${fileLabel(path)}`)
  S.filePath = path
  S.fileDirty = false
  paintSaveState()
}

/**
 * Asks before an action that would leave unsaved file changes behind.
 *
 * Three answers, because there are three real intentions: save first, carry on
 * regardless, or go back. Only asked when there is a file *and* it is behind —
 * a workspace that has only ever been autosaved is not at risk, since it comes
 * back on the next start, and prompting there would be noise.
 *
 * @returns {Promise<boolean>} whether the caller should proceed
 */
function keepOrDiscard(what) {
  if (!S.filePath || !S.fileDirty) return Promise.resolve(true)
  return new Promise((resolve) => {
    let answered = false
    const settle = (value) => {
      answered = true
      onSheetClose = null
      closeSheet()
      resolve(value)
    }

    const veil = $('veil')
    veil.replaceChildren()
    veil.hidden = false
    sheetUp = true
    // Dismissing means "take me back" — the safe reading of a dialog about
    // losing work — and it has to hold for Escape and the backdrop too.
    onSheetClose = () => {
      if (!answered) resolve(false)
    }

    const body = el('div', { class: 'ask-body' }, [
      el('div', { class: 'ask-head' }, [
        // Amber, not red: nothing is being destroyed, and the autosave means
        // the work itself survives either way. Only the file is behind.
        el('span', { class: 'ask-mark is-hold', html: ico(I.alert, 17, 1.8) }),
        el('div', {}, [
          el('h2', { text: 'Save changes first?' }),
          el('p', { text: `${what} will leave the changes since your last save behind.` })
        ])
      ]),
      subjectGroup(I.save, fileLabel(S.filePath), S.filePath),
      el('p', { class: 'ask-aside', text: 'Your work is kept in the app either way and comes back next time. Only this file would be out of date.' })
    ])

    const cancel = el('button', { class: 'btn plain', type: 'button', text: 'Cancel', onclick: () => settle(false) })
    const save = el('button', { class: 'btn go', type: 'button', text: 'Save', onclick: async () => {
      // Resolved with the save's own result: a cancelled file dialog must not
      // be read as "saved, carry on".
      answered = true
      onSheetClose = null
      const ok = await saveWorkspace()
      closeSheet()
      resolve(ok)
    } })

    body.append(
      el('div', { class: 'ask-acts' }, [
        cancel,
        el('span', { class: 'ask-acts-gap' }),
        el('button', { class: 'btn bad', type: 'button', text: "Don't save", onclick: () => settle(true) }),
        save
      ])
    )

    veil.append(el('div', { class: 'ask' }, [body]))
    veil.onpointerdown = (e) => {
      if (e.target === veil) closeSheet()
    }
    // Save takes the focus: it is the answer that loses nothing.
    save.focus()
  })
}

/** Opens the folder holding the saved file. */
async function revealWorkspace() {
  if (!S.filePath) return
  const shown = await window.prism.workspace.reveal(S.filePath)
  if (!shown) toast('bad', 'That file is no longer where it was saved')
}

/** The Save button's menu — everything a document needs, in one place. */
function saveMenu() {
  return [
    {
      icon: I.save,
      label: S.filePath ? `Save ${fileLabel(S.filePath)}` : 'Save to a file…',
      keys: 'Ctrl+S',
      disabled: Boolean(S.filePath) && !S.fileDirty,
      run: () => void saveWorkspace()
    },
    { icon: I.copy, label: 'Save as…', keys: 'Ctrl+Shift+S', run: () => void saveWorkspaceAs() },
    { sep: true },
    { icon: I.folder, label: 'Open a workspace…', keys: 'Ctrl+O', run: () => void openWorkspace() },
    { icon: I.eye, label: 'Show in folder', disabled: !S.filePath, run: () => void revealWorkspace() },
    {
      icon: I.revert,
      label: 'Discard changes and reload',
      disabled: !S.filePath || !S.fileDirty,
      danger: true,
      run: () => void revertWorkspace()
    }
  ]
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

  const q = S.filter.trim().toLowerCase()
  const hit = (req) =>
    !q || `${req.name} ${req.method} ${req.url}`.toLowerCase().includes(q)
  let shown = 0

  for (const col of S.collections) {
    const flows = el('div', { class: 'kids' })

    for (const flow of col.flows) {
      // A filter that leaves empty flows and collections behind is a filter
      // that has not really filtered anything.
      const matching = flow.requests.filter(hit)
      if (q && !matching.length && !flow.name.toLowerCase().includes(q)) continue
      const reqs = el('div', { class: 'kids' })
      for (const req of q ? matching : flow.requests) {
        shown += 1
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
        el('div', { class: `flow${flow.open === false && !q ? ' shut' : ''}` }, [
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

    if (q && !flows.children.length && !col.name.toLowerCase().includes(q)) continue
    host.append(
      el('div', { class: `col${col.open === false && !q ? ' shut' : ''}` }, [
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

  if (q && !shown) {
    host.append(el('p', { class: 'tree-nothing', text: `Nothing matches “${S.filter}”.` }))
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
    { label: 'Auth and headers', icon: I.lock, run: () => openLevel(col, 'collection') },
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
    { label: 'Auth and headers', icon: I.lock, run: () => openLevel(flow, 'flow') },
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
    { label: 'Run it ten times', sub: 'looking for a flake', icon: I.play, run: () => repeatRequest(req, 10) },
    { label: S.baselines.has(req.id) ? 'Re-freeze baseline' : 'Freeze as baseline', icon: I.snow, disabled: !S.results.has(req.id), run: () => freezeBaseline(req) },
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
  ['chain', 'Chain'],
  ['data', 'Data']
]

const RESP_TABS = [
  ['brief', 'Brief'],
  ['result', 'Result'],
  ['payload', 'Payload'],
  ['headers', 'Headers'],
  ['shape', 'Shape'],
  ['diff', 'Diff'],
  ['drift', 'Drift'],
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
    if (id === 'drift') {
      const d = drift(req)
      if (d?.breaking.length) badge = `<b class="bad">${d.breaking.length}</b>`
      else if (S.baselines.has(req.id)) badge = '<b></b>'
    }
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
  if (tab === 'data') return req.dataset?.rows.length ?? 0
  return 0
}

/** Redraws only what a keystroke changes, so typing does not rebuild the app. */
/**
 * A keystroke-cheap repaint for a field being typed into.
 *
 * `commit()` redraws the tree, the plane and the bench, which is far too much
 * per keystroke — so the fields people type in fastest (the URL, every query
 * and header row, request-level auth) came through here instead, and repainted
 * only the preview and the one node label that changed.
 *
 * What was missing was `touch()`. Those handlers mutate the request and then
 * did nothing to say so: nothing was marked dirty and no autosave was ever
 * scheduled. Typing an endpoint, a header or a bearer token and closing the app
 * lost the lot, unless some later action happened to call `commit()` — which is
 * why the whole tool could look as though it did not save. `touch()` is only a
 * flag and a debounce timer, so it is cheap enough to belong on this path.
 */
function live(req) {
  paintPreview(req)
  const path = document.querySelector(`.node[data-id="${req.id}"] .node-path`)
  if (path) path.innerHTML = pathLabel(req.url)
  touch()
}

/* ---------------------------------------------------------- edit panels */

function editPanel(req, res) {
  switch (S.editTab) {
    case 'headers':
      return headersTab(req)
    case 'body':
      return bodyPanel(req)
    case 'auth':
      return authPanel(req)
    case 'tests':
      return testsPanel(req, res)
    case 'chain':
      return chainPanel(req)
    case 'data':
      return dataPanel(req)
    default: {
      const box = el('div')
      box.append(rowsPanel(req, 'query', 'Query parameters', 'search', 'iphone'))
      box.append(rowsPanel(req, 'pathParams', 'Path parameters', 'userId', '42', 'written in the endpoint as :userId'))
      return box
    }
  }
}

/**
 * The request's headers, and the ones it is given.
 *
 * Inherited rows are shown before the request's own and are not editable here:
 * editing them here would either silently copy them down — leaving two places
 * that disagree — or change every other request without saying so. The name of
 * the level they came from is on each row, and it is a link to that level.
 */
function headersTab(req) {
  const box = el('div')
  const chain = chainFor(req)
  const shown = inheritedFor(req, chain)

  if (shown.headers.length) {
    box.append(
      el('div', { class: 'lbl' }, [
        el('span', { text: 'Inherited' }),
        el('em', { text: 'set above this request, and sent with it' })
      ])
    )
    for (const row of shown.headers) {
      box.append(
        el('div', { class: 'kvrow given' }, [
          el('span', { class: 'given-src', text: row.from }),
          el('span', { class: 'cell k', text: row.key }),
          el('span', { class: 'cell v', text: row.value }),
          el('button', {
            class: 'tiny',
            type: 'button',
            title: `Set this header on ${row.from} instead`,
            text: 'Override',
            onclick: () => {
              // Copied down as the request's own, which is the only honest way
              // to change one here: the level above keeps what it had.
              req.headers = [...(req.headers ?? []), { id: uid('row'), key: row.key, value: row.value, on: true }]
              commit()
            }
          })
        ])
      )
    }
  }

  box.append(rowsPanel(req, 'headers', shown.headers.length ? 'This request' : 'Headers', 'X-Tenant', 'northwind'))
  return box
}

/**
 * Auth and headers for a collection or a flow.
 *
 * The same two editors the request has, on the thing above it. Forty requests
 * carrying their own copy of the same token is how a collection rots: the
 * fortieth never gets updated.
 */
function openLevel(owner, what) {
  const body = el('div', { class: 'levelbox' })
  const paint = () => {
    body.replaceChildren()
    body.append(
      el('div', { class: 'lbl' }, [
        el('span', { text: 'Auth' }),
        el('em', { text: 'inherited by every request below that is set to Inherit' })
      ])
    )
    body.append(authPanel(null, { level: what, owner }))

    body.append(el('div', { class: 'lbl', style: 'margin-top:16px' }, [
      el('span', { text: 'Headers' }),
      el('em', { text: 'added to every request below, unless it sets the same one' })
    ]))
    body.append(rowsPanel(owner, 'headers', '', 'X-Api-Version', '2', '', paint))

    const reach = what === 'collection'
      ? owner.flows.reduce((n, f) => n + f.requests.length, 0)
      : owner.requests.length
    body.append(
      el('p', {
        class: 'note',
        style: 'margin-top:12px',
        text: `${reach} request${reach === 1 ? '' : 's'} sit${reach === 1 ? 's' : ''} below this. A request with its own value for something keeps it.`
      })
    )
  }
  paint()

  sheet({
    title: `${owner.name || 'Untitled'} — auth and headers`,
    blurb: 'Set once here instead of on every request. The nearest setting always wins.',
    body,
    acts: [],
    onClose: () => commit()
  })
}

function rowsPanel(req, key, label, kHint, vHint, hint, repaint) {
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
      // Inside a sheet nothing else repaints, so without this the new row
      // exists in the data and never appears on screen.
      repaint?.()
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

/**
 * A GraphQL request: a query and its variables, as two fields.
 *
 * The alternative — which is what this used to be — is one text area holding
 * the JSON envelope, with the query escaped into a single-line string inside
 * it. That is unreadable, unpasteable and impossible to edit, and it is why
 * GraphQL in a REST-shaped tool feels like a workaround.
 */
function graphqlEditor(req) {
  const box = el('div', { class: 'gql' })

  box.append(el('div', { class: 'lbl' }, [el('span', { text: 'Query' }), el('em', { text: gqlLabel(req.body) })]))
  // The value is set on the node rather than passed as an attribute: a
  // textarea's content is its child text, so an attribute would be ignored.
  const query = el('textarea', {
    class: 'gqlq',
    spellcheck: 'false',
    rows: '9',
    placeholder: 'query Orders($first: Int) {\n  orders(first: $first) {\n    id\n    total\n  }\n}',
    oninput: (e) => {
      req.body = e.target.value
      touch()
    },
    onchange: () => commit()
  })
  query.value = req.body ?? ''
  box.append(query)

  box.append(
    el('div', { class: 'lbl', style: 'margin-top:12px' }, [
      el('span', { text: 'Variables' }),
      el('em', { text: 'JSON — {{name}} works in here too' })
    ])
  )
  const variables = el('textarea', {
    class: 'gqlv',
    spellcheck: 'false',
    rows: '4',
    placeholder: '{\n  "first": 10\n}',
    oninput: (e) => {
      req.gqlVariables = e.target.value
      touch()
    },
    onchange: () => commit()
  })
  variables.value = req.gqlVariables ?? ''
  box.append(variables)

  box.append(
    el('div', { class: 'envacts', style: 'margin-top:10px' }, [
      el('button', {
        class: 'addbtn',
        type: 'button',
        html: ico(I.search, 10, 2) + '<span>Fetch the schema</span>',
        onclick: () => introspect(req)
      })
    ])
  )

  // $first in a GraphQL query is the server's variable, not Prism's. Saying so
  // once here saves the confusion of somebody defining {{first}} and wondering
  // why nothing changes.
  box.append(
    el('p', {
      class: 'note',
      html: 'A <code>$name</code> in the query is GraphQL&rsquo;s own variable and is filled from the Variables block. <code>{{name}}</code> is Prism&rsquo;s, and is filled from the environment — in either field.'
    })
  )
  return box
}

/**
 * Ask the endpoint what it can do.
 *
 * Introspection is a normal request to the same URL, so it goes through the
 * same sender — same auth, same proxy, same certificate — rather than a second
 * code path that could succeed where a real request would fail.
 */
async function introspect(req) {
  const vars = envValues()
  const chain = chainFor(req)
  const resolved = withInherited(req, chain)
  const raw = await window.prism.http.send({
    ...compile({ ...resolved, bodyKind: 'json', body: JSON.stringify({ query: INTROSPECTION }) }, vars),
    method: 'POST',
    timeoutMs: Number(S.prefs.timeoutMs) || 30000,
    verifyTls: S.prefs.verifyTls !== false,
    proxy: S.prefs.proxy || '',
    ...certSettings()
  })

  if (raw.error) {
    toast('bad', raw.error)
    return
  }
  let json
  try {
    json = JSON.parse(raw.body)
  } catch {
    json = null
  }
  const schema = readSchema(json)
  if (!schema.ok) {
    toast('bad', schema.error)
    return
  }
  showSchema(req, schema)
}

function showSchema(req, schema) {
  const body = el('div', { class: 'schemabox' })
  let which = 'queries'

  const paint = () => {
    body.replaceChildren()
    const tabs = el('div', { class: 'chips' })
    for (const [id, label] of [['queries', `Queries (${schema.queries.length})`], ['mutations', `Mutations (${schema.mutations.length})`]]) {
      tabs.append(el('button', { class: `chipbtn${which === id ? ' on' : ''}`, type: 'button', text: label, onclick: () => {
        which = id
        paint()
      } }))
    }
    body.append(tabs)

    const list = el('div', { class: 'fieldlist' })
    for (const f of schema[which]) {
      list.append(
        el('button', {
          class: 'fieldrow-pick',
          type: 'button',
          onclick: () => {
            req.body = stubFor(f, which === 'mutations' ? 'mutation' : 'query')
            req.bodyKind = 'graphql'
            closeSheet()
            commit()
            toast('ok', `${f.name} — a runnable stub is in the query`)
          }
        }, [
          el('b', { text: f.name }),
          el('span', { class: 'ftype', text: f.type }),
          f.args.length ? el('span', { class: 'fargs', text: f.args.map((a) => `${a.name}: ${a.type}`).join(', ') }) : null,
          f.description ? el('span', { class: 'fdesc', text: f.description }) : null
        ])
      )
    }
    if (!schema[which].length) list.append(el('p', { class: 'note', text: 'This schema declares none.' }))
    body.append(list)
  }
  paint()

  sheet({
    title: 'What this endpoint can do',
    blurb: 'From the server’s own introspection. Pick one and a runnable stub goes into the query.',
    body,
    acts: []
  })
}

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

  if (req.bodyKind === 'graphql') {
    box.append(graphqlEditor(req))
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
  ['inherit', 'Inherit', 'whatever the flow says'],
  ['none', 'No auth', 'sent as it is'],
  ['bearer', 'Bearer', 'Authorization: Bearer'],
  ['basic', 'Basic', 'user and password'],
  ['apiKey', 'API key', 'header or query'],
  ['oauth2', 'OAuth 2.0', 'fetched and refreshed'],
  ['jwt', 'JWT', 'signed token as bearer']
]

/**
 * Auth, for a request or for a level above it.
 *
 * The same panel serves all three, because the choice is the same choice — and
 * a collection editor that looked different from the request editor would be
 * two things to learn for one idea.
 */
function authPanel(req, { level = 'request', owner = null } = {}) {
  const box = el('div')
  const target = owner ?? req
  const chain = level === 'request' ? chainFor(req) : []

  const grid = el('div', { class: 'authgrid' })
  for (const [id, title, sub] of AUTHS) {
    // Only a request can inherit; a collection has nothing above it.
    if (id === 'inherit' && level !== 'request') continue
    grid.append(
      el('button', { class: `authcard${(target.auth?.kind ?? 'none') === id ? ' on' : ''}`, type: 'button', onclick: () => {
        target.auth = { ...(target.auth ?? {}), kind: id }
        if (id === 'oauth2' && !target.auth.oauth) target.auth.oauth = emptyOauth()
        commit()
      } }, [el('b', { text: title }), el('span', { text: sub })])
    )
  }
  box.append(grid)

  const kind = target.auth?.kind ?? 'none'

  if (kind === 'inherit') {
    const from = effectiveAuth(req, chain)
    box.append(
      el('p', {
        class: 'note',
        style: 'margin-top:11px',
        text: from.kind === 'none'
          ? 'Nothing above this request sets auth, so nothing is sent. Set it on the flow or the collection and every request that inherits picks it up.'
          : `Using ${from.kind} auth from ${from.from}. Change it there and every request that inherits changes with it.`
      })
    )
    return box
  }

  if (kind === 'none') return box

  const field = (label, prop, ph, secret = false) =>
    el('div', { class: 'fieldrow' }, [
      el('label', { text: label }),
      el('input', {
        value: target.auth?.[prop] ?? '',
        type: secret ? 'password' : 'text',
        placeholder: ph,
        oninput: (e) => {
          target.auth[prop] = e.target.value
          if (level === 'request') live(req)
          else touch()
        }
      })
    ])

  if (kind === 'basic') {
    box.append(field('Username', 'username', '{{user}}'), field('Password', 'password', '{{password}}'))
  } else if (kind === 'apiKey') {
    box.append(field('Key name', 'keyName', 'X-Api-Key'), field('Value', 'token', '{{api_key}}'))
    box.append(
      el('div', { class: 'fieldrow' }, [
        el('label', { text: 'Send in' }),
        el('select', { onchange: (e) => {
          target.auth.keyIn = e.target.value
          commit('plane')
        } }, [
          el('option', { value: 'header', text: 'Header', selected: target.auth?.keyIn !== 'query' }),
          el('option', { value: 'query', text: 'Query string', selected: target.auth?.keyIn === 'query' })
        ])
      ])
    )
  } else if (kind === 'oauth2') {
    box.append(oauthPanel(target, level === 'request' ? req : null))
    return box
  } else {
    box.append(field('Token', 'token', '{{auth_token}}'))
  }

  box.append(
    el('p', { class: 'note', style: 'margin-top:11px', text: 'Write a variable here rather than a value. Exports carry the variable; they never carry the secret.' })
  )
  return box
}

/**
 * The OAuth grant.
 *
 * `oauth2` used to mean "paste a bearer string here", which works for about an
 * hour and then produces a 401 that reads like a broken test. This fetches the
 * token, notices when it is about to expire, and refreshes it — so a suite left
 * running overnight is still running in the morning.
 *
 * The token itself is held in memory and never written anywhere, like every
 * other credential in Prism.
 */
function oauthPanel(target, req) {
  const box = el('div', { class: 'oauth' })
  const cfg = target.auth.oauth ?? (target.auth.oauth = emptyOauth())
  const state = oauthState.get(target.auth) ?? {}

  box.append(
    el('div', { class: 'fieldrow' }, [
      el('label', { text: 'Grant' }),
      el('select', { onchange: (e) => {
        cfg.grant = e.target.value
        commit()
      } }, GRANTS.map((g) => el('option', { value: g.id, text: g.label, selected: cfg.grant === g.id })))
    ])
  )
  const grant = GRANTS.find((g) => g.id === cfg.grant) ?? GRANTS[0]
  box.append(el('p', { class: 'note', text: grant.help }))

  const LABEL = {
    tokenUrl: 'Token URL',
    clientId: 'Client id',
    clientSecret: 'Client secret',
    username: 'Username',
    password: 'Password',
    refreshToken: 'Refresh token',
    scope: 'Scope',
    audience: 'Audience'
  }
  const PLACE = {
    tokenUrl: 'https://id.example.test/oauth/token',
    clientId: '{{client_id}}',
    clientSecret: '{{client_secret}}',
    scope: 'read:orders write:orders',
    audience: 'https://api.example.test'
  }

  for (const name of grant.fields) {
    const secret = SECRET_FIELDS.includes(name)
    box.append(
      el('div', { class: 'fieldrow' }, [
        el('label', { text: LABEL[name] ?? name }),
        el('input', {
          value: cfg[name] ?? '',
          type: secret ? 'password' : 'text',
          placeholder: PLACE[name] ?? '',
          spellcheck: 'false',
          oninput: (e) => {
            cfg[name] = e.target.value
            touch()
          },
          onchange: () => commit()
        })
      ])
    )
  }

  box.append(
    el('div', { class: 'fieldrow' }, [
      el('label', { text: 'Client sent as' }),
      el('select', { onchange: (e) => {
        cfg.clientAuth = e.target.value
        commit()
      } }, [
        el('option', { value: 'body', text: 'Form fields', selected: cfg.clientAuth !== 'header' }),
        el('option', { value: 'header', text: 'Basic header', selected: cfg.clientAuth === 'header' })
      ])
    ])
  )

  /* ------------------------------------------------------- what is held */
  const missing = missingFields(cfg)
  const bar = el('div', { class: 'oauth-bar' })

  bar.append(
    el('span', { class: `oauth-dot${state.token ? (stale(state) ? ' warn' : ' ok') : ''}` }),
    el('span', { class: 'oauth-state', text: state.token ? remaining(state) : missing.length ? `needs ${missing.join(', ')}` : 'no token yet' }),
    el('span', { class: 'pane-gap' }),
    el('button', {
      class: 'btn go',
      type: 'button',
      text: state.token ? 'Fetch again' : 'Fetch a token',
      disabled: missing.length > 0,
      onclick: () => fetchToken(target, req)
    })
  )
  if (state.token) {
    bar.append(el('button', { class: 'btn', type: 'button', text: 'Forget it', onclick: () => {
      oauthState.delete(target.auth)
      commit()
    } }))
  }
  box.append(bar)

  if (state.error) {
    box.append(el('div', { class: 'find bad' }, [el('div', { class: 'find-bar' }), el('div', {}, [el('b', { text: 'The token endpoint refused' }), el('p', { text: state.error })])]))
  }

  box.append(
    el('p', {
      class: 'note',
      html: 'The token is fetched before a send when it is missing or about to expire, and is held in memory only — never written to the workspace, an export, or this disk.'
    })
  )
  return box
}

/**
 * Tokens, kept beside the auth block rather than inside it.
 *
 * A WeakMap because the token must never reach the workspace file: anything
 * stored on the auth object itself would be serialised with it, and the rule
 * about credentials on disk has no exceptions.
 */
const oauthState = new WeakMap()

async function fetchToken(target, req, quiet = false) {
  try {
    return await getToken(target, quiet)
  } catch (err) {
    // Without this a throw inside a click handler is invisible: no toast, no
    // panel, the button simply does nothing and the cause is in a console
    // nobody has open.
    oauthState.set(target.auth, { ...(oauthState.get(target.auth) ?? {}), error: String(err?.message ?? err) })
    commit()
    if (!quiet) toast('bad', String(err?.message ?? err))
    return null
  }
}

async function getToken(target, quiet) {
  const cfg = target.auth?.oauth
  if (!cfg) return null

  const missing = missingFields(cfg)
  if (missing.length) {
    if (!quiet) toast('bad', `That grant still needs ${missing.join(', ')}.`)
    return null
  }

  const held = oauthState.get(target.auth) ?? {}
  const step = nextStep(cfg, held)
  const use = step === 'refresh' ? refreshWith(cfg, held) : cfg
  const vars = envValues()
  const spec = tokenRequest(use, (text) => interpolate(text, vars))

  const raw = await window.prism.http.send({
    ...spec,
    timeoutMs: Number(S.prefs.timeoutMs) || 30000,
    verifyTls: S.prefs.verifyTls !== false,
    useCookies: false,
    proxy: S.prefs.proxy || '',
    ...certSettings()
  })

  if (raw.error) {
    oauthState.set(target.auth, { ...held, error: raw.error })
    if (!quiet) toast('bad', raw.error)
    commit()
    return null
  }

  // The sender returns the body as text; parsing it is the caller's job, and
  // every other caller in this file already does it this way.
  let json
  try {
    json = JSON.parse(raw.body)
  } catch {
    json = undefined
  }

  const read = readToken(json, Date.now())
  if (!read.ok) {
    oauthState.set(target.auth, { ...held, error: read.error })
    if (!quiet) toast('bad', read.error)
    commit()
    return null
  }

  // A refresh that comes back without a new refresh token keeps the old one:
  // most servers reissue, some do not, and dropping it would turn the next
  // refresh into a full re-authentication.
  oauthState.set(target.auth, {
    token: read.token,
    type: read.type,
    expiresAt: read.expiresAt,
    refreshToken: read.refreshToken || held.refreshToken || '',
    error: ''
  })
  commit()
  if (!quiet) toast('ok', `Token fetched — ${remaining(oauthState.get(target.auth))}`)
  return read.token
}

/** Fetches or refreshes only when the held token will not last the request. */
async function ensureToken(holder) {
  const held = oauthState.get(holder.auth) ?? {}
  if (!stale(held)) return held.token
  return fetchToken(holder, null, true)
}

/**
 * Client certificate settings, as the sender wants them.
 *
 * Paths rather than contents: the file is read in the main process at send
 * time, so a rotated certificate takes effect on the next send instead of the
 * next restart, and the key never sits in the renderer.
 */
function certSettings() {
  return {
    certPath: S.prefs.clientCert || '',
    keyPath: S.prefs.clientKey || '',
    pfxPath: S.prefs.clientPfx || '',
    caPath: S.prefs.caBundle || '',
    passphrase: S.prefs.certPassphrase || ''
  }
}

/** The chain a request sits in: its collection, then its flow. */
function chainFor(req) {
  for (const col of S.collections) {
    for (const flow of col.flows) {
      if (flow.requests.some((r) => r.id === req?.id)) return [col, flow]
    }
  }
  return []
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

/**
 * The dataset panel.
 *
 * One request, sent once per row, with the row's columns shadowing the
 * environment for that iteration only. It is how forty inputs get tested
 * against a validation endpoint without forty requests by hand.
 */
function dataPanel(req) {
  const box = el('div')
  const ds = req.dataset

  if (!ds) {
    box.append(
      el('p', {
        class: 'note',
        text: 'Attach a CSV or JSON table and this request runs once per row. Each column becomes a variable for that run only — {{email}} in the body picks up the email column.'
      })
    )
    box.append(dropTarget(req))
    return box
  }

  const used = variablesUsed(req)
  const unused = unusedColumns(ds, used)
  const missing = ds.columns.length ? used.filter((v) => !ds.columns.includes(v)) : []

  box.append(
    el('div', { class: 'baseline-bar' }, [
      el('span', { class: 'stat', text: `${ds.name} · ${ds.rows.length} row${ds.rows.length === 1 ? '' : 's'}` }),
      el('span', { class: 'pane-gap' }),
      el('button', { class: 'tiny', type: 'button', text: 'Replace', onclick: () => attachDataset(req) }),
      el('button', { class: 'tiny', type: 'button', text: 'Remove', onclick: () => {
        req.dataset = null
        commit()
      } })
    ])
  )

  if (unused.length) {
    // Usually a stale export or a typo in a variable name, and cheaper to say
    // than to watch every row produce an identical result.
    box.append(
      el('p', {
        class: 'note',
        text: `This request never mentions ${unused.map((c) => `{{${c}}}`).join(', ')} — ${unused.length === 1 ? 'that column changes' : 'those columns change'} nothing.`
      })
    )
  }
  if (missing.length) {
    box.append(
      el('p', {
        class: 'note',
        text: `${missing.map((c) => `{{${c}}}`).join(', ')} comes from the environment, not the dataset, so it is the same on every row.`
      })
    )
  }

  const table = el('div', { class: 'dtable' })
  table.append(
    el('div', { class: 'drow head' }, [
      el('span', { class: 'dcell n', text: '#' }),
      ...ds.columns.map((c) => el('span', { class: `dcell${used.includes(c) ? ' used' : ''}`, text: c }))
    ])
  )
  ds.rows.slice(0, 60).forEach((r, i) => {
    table.append(
      el('div', { class: 'drow' }, [
        el('span', { class: 'dcell n', text: String(i + 1) }),
        ...ds.columns.map((c) => el('span', { class: 'dcell', title: r[c] ?? '', text: r[c] ?? '' }))
      ])
    )
  })
  if (ds.rows.length > 60) table.append(el('div', { class: 'drow more', text: `and ${ds.rows.length - 60} more` }))
  box.append(table)

  box.append(
    el('button', {
      class: 'btn go',
      style: 'margin-top:12px',
      type: 'button',
      text: `Run all ${ds.rows.length} rows`,
      onclick: () => runDataset(req)
    })
  )
  return box
}

/**
 * Where a table gets attached.
 *
 * A file dropped here is read in the page, so a table on the desktop takes one
 * gesture. The button does the same thing through the OS picker, for a file
 * that is easier to find than to drag.
 */
function dropTarget(req) {
  const zone = el('div', { class: 'dsdrop' }, [
    el('span', { class: 'dsdrop-ico', html: ico(I.table, 20, 1.6) }),
    el('b', { text: 'Drop a CSV or JSON table' }),
    el('span', { class: 'dsdrop-or', text: 'or' }),
    el('button', { class: 'btn go', type: 'button', text: 'Choose a file', onclick: () => attachDataset(req) })
  ])

  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    // Stops the window-wide handler treating a table as a collection.
    e.stopPropagation()
    zone.classList.add('over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('over'))
  zone.addEventListener('drop', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    zone.classList.remove('over')
    const file = e.dataTransfer?.files?.[0]
    if (file) useDataset(req, await file.text(), file.name)
  })
  return zone
}

/** The one place a table becomes a dataset, whichever way the file arrived. */
function useDataset(req, text, name) {
  const result = readDataset(text, name)
  if (!result.ok) {
    toast('bad', result.error)
    return
  }
  req.dataset = result.dataset
  S.editTab = 'data'
  commit()
  toast('ok', `${result.dataset.rows.length} rows from ${name}`)
}

async function attachDataset(req) {
  const chosen = await window.prism.file.open([
    { name: 'Data', extensions: ['csv', 'json', 'tsv', 'txt'] },
    { name: 'All files', extensions: ['*'] }
  ])
  if (!chosen) return
  useDataset(req, chosen.text, chosen.name)
}

/**
 * Every row, in order, reported as it goes.
 *
 * The rows are not run in parallel: a dataset commonly walks one resource
 * through several states, and firing them at once makes the outcome depend on
 * which finished first.
 */
async function runDataset(req) {
  const ds = req.dataset
  if (!ds?.rows.length) return

  const state = ds.rows.map((r, i) => ({ label: labelFor(r, i), status: 'wait', ms: 0, code: 0, failed: 0 }))
  const body = el('div', { class: 'suite' })
  const ring = el('div', { class: 'ring' })
  const steps = el('div', { class: 'steps' })

  const paint = () => {
    const done = state.filter((x) => x.status === 'pass' || x.status === 'fail').length
    const failed = state.filter((x) => x.status === 'fail').length
    const pct = done / state.length
    const C = 2 * Math.PI * 58
    ring.innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140">
        <circle class="tr" cx="70" cy="70" r="58"></circle>
        <circle class="fl${failed ? ' bad' : ''}" cx="70" cy="70" r="58" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg><b>${Math.round(pct * 100)}%</b>`
    steps.replaceChildren()
    for (const x of state.slice(0, 80)) {
      steps.append(
        el('div', { class: `step${x.status === 'wait' ? ' wait' : ''}` }, [
          el('span', { class: `state ${x.status === 'run' ? 'busy' : x.status === 'wait' ? '' : x.status}` }),
          el('span', { class: 'nm', text: x.label }),
          x.code ? el('span', { class: `code ${tone(x.code)}`, text: String(x.code) }) : null,
          el('span', { class: 'ms', text: x.ms ? `${x.ms}ms` : x.status })
        ])
      )
    }
    body.replaceChildren(ring, steps)
  }
  paint()
  sheet({
    title: `${req.name} × ${ds.rows.length}`,
    blurb: 'One send per row, in order. Each row’s columns shadow the environment for that send only.',
    body,
    acts: []
  })

  for (let i = 0; i < ds.rows.length; i += 1) {
    state[i].status = 'run'
    paint()
    const out = await sendOnce(req, scopeFor(envValues(), ds.rows[i]))
    state[i].ms = out.timing?.total ?? 0
    state[i].code = out.status ?? 0
    state[i].failed = out.failed ?? 0
    state[i].status = out.failed || out.error ? 'fail' : 'pass'
    paint()
  }

  const failed = state.filter((x) => x.status === 'fail').length
  toast(failed ? 'bad' : 'ok', `${ds.rows.length} rows — ${ds.rows.length - failed} passed, ${failed} failed`)
}

/* ------------------------------------------------------ response panels */

function respPanel(req, res) {
  if (S.respTab === 'brief') return briefPanel(req)
  // Drift is about the baseline, which exists whether or not this session has
  // sent anything — its panel explains both cases itself.
  if (S.respTab === 'drift') return driftPanel(req, res)
  if (!res) return el('div', { class: 'nothing', text: 'Send this request and the analysis appears here.' })
  switch (S.respTab) {
    case 'payload':
      return payloadPanel(res, req)
    case 'headers':
      return headersPanel(res)
    case 'shape':
      return shapePanel(res)
    case 'diff':
      return diffPanel(req, res)
    case 'drift':
      return driftPanel(req, res)
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
  const gql = gqlPanel(res)
  if (gql) box.append(gql)
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

function source(text, find = '') {
  const pre = el('pre', { class: 'src' })
  const q = find.trim().toLowerCase()
  let shown = 0

  String(text ?? '')
    .split('\n')
    .slice(0, 3000)
    .forEach((line, i) => {
      if (q && !line.toLowerCase().includes(q)) return
      shown += 1
      // The real line number, so a filtered view still tells you where you are.
      pre.append(el('span', { class: `ln${q ? ' hit' : ''}`, style: `--n:'${i + 1}'`, html: mark(colour(line), find) }))
    })

  if (q && !shown) pre.append(el('span', { class: 'ln', html: '<em style="color:var(--ink-4)">no line contains that</em>' }))
  return pre
}

/** Wraps the search term, without breaking the markup the tokeniser produced. */
function mark(html, find) {
  const q = find.trim()
  if (!q) return html
  const safe = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Only outside tags: replacing inside an attribute would corrupt the span.
  return html.replace(new RegExp(`(${safe})(?![^<]*>)`, 'gi'), '<mark>$1</mark>')
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

/**
 * The response body.
 *
 * Every scalar line is a click target. Chaining used to mean reading a path
 * off the screen, retyping it into the Chain tab and hoping the dots were in
 * the right places — for a value that is right there under the pointer. Now
 * clicking it offers to capture it, or to assert on what it currently says.
 */
function payloadPanel(res, req) {
  const box = el('div')
  if (res.truncated) box.append(el('p', { class: 'note', text: 'Only the first 4 MB is shown. Assertions ran against everything that arrived.' }))

  const isJson = res.json !== undefined
  const rows = isJson ? jsonLines(res.json, { limit: 4000 }) : null
  const text = isJson ? rows.map((l) => l.text).join('\n') : res.body || '(empty)'
  const q = S.find.trim()
  const hits = q ? text.split('\n').filter((l) => l.toLowerCase().includes(q.toLowerCase())).length : 0

  const field = el('input', {
    class: 'find-field',
    type: 'search',
    value: S.find,
    placeholder: 'Find in the body',
    'aria-label': 'Find in the response body',
    spellcheck: 'false',
    oninput: (e) => {
      S.find = e.target.value
      const at = e.target.selectionStart
      paintBench()
      // Re-rendering the panel replaces the field, so the caret has to be put
      // back or typing a second character starts a new search.
      const next = document.querySelector('.find-field')
      if (next) {
        next.focus()
        next.setSelectionRange(at, at)
      }
    }
  })

  box.append(
    el('div', { class: 'find-bar-row' }, [
      el('span', { class: 'find-icon', html: ico(I.search, 12, 2) }),
      field,
      q ? el('span', { class: 'stat', text: hits ? `${hits} line${hits === 1 ? '' : 's'}` : 'nothing' }) : null,
      !q && isJson ? el('span', { class: 'stat quiet', text: 'click a value to capture it' }) : null
    ])
  )

  box.append(isJson ? jsonSource(rows, q, req) : source(text, q))
  return box
}

/**
 * The body, written out as it arrived.
 *
 * Bytes rather than text: an export endpoint answering with a PDF or a zip is
 * exactly the thing worth saving, and re-encoding it as UTF-8 on the way would
 * quietly corrupt it.
 */
async function saveBody(res, req) {
  const type = String(res.headers?.['content-type'] ?? '')
  const ext = /json/i.test(type) ? 'json' : /xml/i.test(type) ? 'xml' : /html/i.test(type) ? 'html' : /pdf/i.test(type) ? 'pdf' : /csv/i.test(type) ? 'csv' : 'txt'
  const name = `${slug(req?.name || 'response')}.${ext}`

  const bytes = new TextEncoder().encode(res.body ?? '')
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)

  const at = await window.prism.file.saveBytes({ name, base64: btoa(binary) })
  if (!at) return
  if (at.error) {
    toast('bad', at.error)
    return
  }
  toast('ok', `Written to ${at}`)
}

/** The JSON body, where each scalar line can be acted on. */
function jsonSource(rows, find, req) {
  const pre = el('pre', { class: 'src live' })
  const q = find.trim().toLowerCase()
  let shown = 0

  rows.forEach((line, i) => {
    if (q && !line.text.toLowerCase().includes(q)) return
    shown += 1

    const canAct = capturable(line) && req
    const node = el(canAct ? 'button' : 'span', {
      class: `ln${q ? ' hit' : ''}${canAct ? ' act' : ''}`,
      style: `--n:'${i + 1}'`,
      html: mark(colour(line.text), find)
    })
    if (canAct) {
      node.type = 'button'
      node.title = line.path
      node.onclick = (e) => fieldMenu(e, req, line)
    }
    pre.append(node)
  })

  if (q && !shown) pre.append(el('span', { class: 'ln', html: '<em style="color:var(--ink-4)">no line contains that</em>' }))
  return pre
}

/**
 * What can be done with the value under the pointer.
 *
 * Capture first, because that is the one that saves real work: it is the
 * difference between "type data.session.token into the Chain tab" and one
 * click. Asserting on the current value is second, and deliberately worded as
 * "what it says now" — the value is an example, not a specification.
 */
function fieldMenu(e, req, line) {
  const brief = (v) => {
    const t = typeof v === 'string' ? v : JSON.stringify(v)
    return t.length > 24 ? `${t.slice(0, 21)}…` : t
  }

  openMenu(e.currentTarget, [
    {
      label: `Capture as {{${suggestName(line.path)}}}`,
      icon: I.flow,
      run: () => {
        const name = freeCaptureName(suggestName(line.path))
        req.captures = [...(req.captures ?? []), { id: uid('cap'), name, from: 'json', path: line.path }]
        S.editTab = 'chain'
        commit()
        toast('ok', `{{${name}}} is now captured from ${line.path}`)
      }
    },
    {
      label: `Assert it equals ${brief(line.value)}`,
      icon: I.check,
      run: () => {
        req.assertions = [
          ...(req.assertions ?? []),
          emptyAssertion({ subject: 'json', op: 'equals', path: line.path, value: String(line.value ?? '') })
        ]
        S.editTab = 'tests'
        commit()
        toast('ok', `Asserting ${line.path} equals ${brief(line.value)}`)
      }
    },
    {
      label: 'Assert it exists',
      icon: I.check,
      run: () => {
        req.assertions = [...(req.assertions ?? []), emptyAssertion({ subject: 'json', op: 'exists', path: line.path, value: '' })]
        S.editTab = 'tests'
        commit()
        toast('ok', `Asserting ${line.path} is there`)
      }
    },
    { sep: true },
    {
      label: 'Copy the path',
      icon: I.copy,
      run: () => {
        navigator.clipboard.writeText(line.path)
        toast('ok', line.path)
      }
    },
    {
      label: 'Copy the value',
      icon: I.copy,
      run: () => {
        navigator.clipboard.writeText(typeof line.value === 'string' ? line.value : JSON.stringify(line.value))
        toast('ok', 'Copied')
      }
    }
  ])
}

/** A capture name nothing else in the workspace already claims. */
function freeCaptureName(stem) {
  const taken = new Set(allRequests().flatMap((r) => (r.captures ?? []).map((c) => c.name)))
  if (!taken.has(stem)) return stem
  let n = 2
  while (taken.has(`${stem}_${n}`)) n += 1
  return `${stem}_${n}`
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

function driftPanel(req, res) {
  const box = el('div')
  const base = S.baselines.get(req.id)

  if (!base) {
    box.append(
      el('p', {
        class: 'note',
        text: 'No baseline yet. Freeze this response as the shape you expect, and every later run is checked against it — a field that disappears or changes type is reported even when no assertion mentions it.'
      })
    )
    box.append(
      el('button', { class: 'btn go', type: 'button', text: 'Freeze this response', onclick: () => freezeBaseline(req) })
    )
    return box
  }

  const d = drift(req)
  box.append(
    el('div', { class: 'baseline-bar' }, [
      el('span', { class: 'stat', text: `Frozen ${new Date(base.at).toLocaleString()}` }),
      el('span', { class: `code ${tone(base.status)}`, text: String(base.status) }),
      el('span', { class: 'pane-gap' }),
      el('button', { class: 'tiny', type: 'button', text: 'Re-freeze', onclick: () => freezeBaseline(req) }),
      el('button', { class: 'tiny', type: 'button', text: 'Clear', onclick: () => dropBaseline(req) })
    ])
  )

  if (!d) {
    box.append(el('p', { class: 'note', text: 'Send the request to compare it against the baseline.' }))
    return box
  }

  if (d.statusChanged) {
    box.append(
      el('div', { class: 'find bad' }, [
        el('div', { class: 'find-bar' }),
        el('div', {}, [
          el('b', { text: 'The status changed' }),
          el('p', { text: `${base.status} when frozen, ${res.status} now.` })
        ])
      ])
    )
  }

  if (!d.changes.length && !d.statusChanged) {
    box.append(
      el('div', { class: 'find ok' }, [
        el('div', { class: 'find-bar' }),
        el('div', {}, [el('b', { text: 'No drift' }), el('p', { text: 'The response matches the baseline exactly.' })])
      ])
    )
    return box
  }

  const group = (title, list, kind, why) => {
    if (!list.length) return
    box.append(el('div', { class: 'lbl', style: 'margin-top:14px' }, [el('span', { text: title }), el('em', { text: why })]))
    for (const c of list.slice(0, 60)) {
      box.append(
        el('div', { class: `chg ${kind}` }, [
          el('b', { text: c.kind }),
          el('span', { class: 'p', text: c.path }),
          el('span', { class: c.kind === 'removed' ? 'was' : 'now', text: driftValue(c) })
        ])
      )
    }
  }

  group('Breaking', d.breaking, 'removed', 'gone, or a different type than agreed')
  group('Added', d.additions, 'added', 'new since the baseline — rarely a problem')
  group('Values', d.values, 'changed', 'the data moved, the shape did not')
  return box
}

function driftValue(c) {
  if (c.kind === 'retyped') return `${c.from} → ${c.to}`
  if (c.kind === 'removed') return brief(c.before)
  if (c.kind === 'added') return brief(c.after)
  return `${brief(c.before)} → ${brief(c.after)}`
}

/**
 * GraphQL errors, which arrive inside a 200.
 *
 * This is the failure every REST-shaped tool misses: the status assertion
 * passes, the response says the query was rejected, and the suite is green.
 */
function gqlPanel(res) {
  const errs = errorsIn(res.json)
  if (!errs.length) return null

  const box = el('div', { class: 'gqlerrs' })
  box.append(
    el('div', { class: 'find bad' }, [
      el('div', { class: 'find-bar' }),
      el('div', {}, [
        el('b', { text: errs.length === 1 ? 'The query was rejected' : `${errs.length} errors in the response` }),
        el('p', { text: `The status was ${res.status}, which is what GraphQL does — it answers 200 and puts the failure in the body.` })
      ])
    ])
  )
  for (const e of errs.slice(0, 12)) {
    box.append(
      el('div', { class: 'gqlerr' }, [
        el('b', { text: e.message }),
        e.path ? el('span', { class: 'p', text: e.path }) : null,
        e.line ? el('span', { class: 'ln-no', text: `line ${e.line}` }) : null
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

/* ============================================================== baselines

   The diff engine could only ever compare against the previous run in memory,
   which answers "did anything change since I last pressed send" — a question
   about the last minute. Freezing a response as a baseline answers the useful
   one: has this endpoint drifted from the shape we agreed on?

   A baseline is kept in the workspace file, so it survives a restart and can
   be reviewed in a pull request alongside the code that changed it. */

function freezeBaseline(req) {
  const res = S.results.get(req.id)
  if (!res || res.error) {
    toast('bad', 'Send the request first — there is nothing to freeze.')
    return
  }
  S.baselines.set(req.id, {
    at: res.at,
    status: res.status,
    headers: res.headers ?? {},
    json: res.json,
    body: res.json === undefined ? (res.body ?? '') : ''
  })
  commit()
  toast('ok', `Baseline frozen at ${res.status}`)
}

function dropBaseline(req) {
  S.baselines.delete(req.id)
  commit()
  toast('ok', 'Baseline cleared')
}

/**
 * What has drifted from the frozen shape.
 *
 * Split by severity rather than listed flat, because the four kinds are not
 * equally alarming: a field that vanished or changed type breaks whoever
 * consumes it, a new field almost never does, and a changed value is usually
 * just the data being data.
 */
function drift(req) {
  const base = S.baselines.get(req.id)
  const res = S.results.get(req.id)
  if (!base || !res || res.error) return null
  const changes = diff(base.json, res.json)
  return {
    base,
    changes,
    breaking: changes.filter((c) => c.kind === 'removed' || c.kind === 'retyped'),
    additions: changes.filter((c) => c.kind === 'added'),
    values: changes.filter((c) => c.kind === 'changed'),
    statusChanged: base.status !== res.status
  }
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

  const out = await sendOnce(req, envValues())
  S.busy.delete(req.id)
  if (out.error) {
    commit()
    toast('bad', out.error)
    return
  }
  // Only move off the pre-send tab. Being watching Drift, pressing Send and
  // landing on Result is the tool deciding what you meant to look at.
  if (S.respTab === 'brief') S.respTab = out.failed ? 'notes' : 'result'
  commit()
  toast(out.failed ? 'bad' : 'ok', `${req.name} — ${out.status} in ${out.timing.total}ms`)
}

/**
 * One send, against one set of variables.
 *
 * Separated out because a dataset run does the same thing sixty times with a
 * different scope each time, and duplicating the assertion, capture and
 * analysis steps would let the two drift apart.
 */
async function sendOnce(req, vars) {
  // Inheritance is resolved here rather than in compile(), so the preview in
  // the header and the bytes on the wire come from the same call.
  const chain = chainFor(req)
  const resolved = withInherited(req, chain)

  // A token that expires in four seconds passes a naive check and then expires
  // in flight, so the grant is topped up before the send rather than after the
  // 401 it would otherwise cause.
  const holder = [req, ...[...chain].reverse()].find((x) => x?.auth?.kind === 'oauth2' && x.auth.oauth)
  if (holder) {
    const token = await ensureToken(holder)
    if (token) resolved.auth = { kind: 'bearer', token }
  }

  const spec = {
    ...compile(resolved, vars),
    timeoutMs: req.timeoutMs ?? Number(S.prefs.timeoutMs) ?? 30000,
    followRedirects: S.prefs.followRedirects !== false,
    verifyTls: S.prefs.verifyTls !== false,
    useCookies: S.prefs.useCookies !== false,
    proxy: S.prefs.proxy || '',
    ...certSettings(),
    maxBodyMb: Number(S.prefs.maxBodyMb) || 4
  }
  const at = Date.now()
  const raw = await window.prism.http.send(spec)

  if (raw.error) {
    const failure = { error: raw.error, at, request: spec, checks: [], failed: 1, status: 0, timing: { total: 0 } }
    remember(req, failure)
    return failure
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
  return result
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

/* ============================================================== from curl */

/**
 * Pasting a cURL command.
 *
 * Prism could already write cURL in fifteen shapes and could not read one
 * back, which is the wrong way round: copy-as-cURL from a browser's network
 * tab is how most requests start life.
 *
 * The preview updates as you type and shows what the request will be, because
 * the failure people fear here is a silent misread — a body that became a
 * query parameter, or a flag that was dropped.
 */
function pasteCurl() {
  const box = el('div', { class: 'curlbox' })
  const area = el('textarea', {
    class: 'pastearea',
    rows: '7',
    spellcheck: 'false',
    placeholder: "curl 'https://api.example.test/orders' \\\n  -H 'authorization: Bearer …' \\\n  --data-raw '{\"sku\":\"A\"}'",
    'aria-label': 'The curl command'
  })
  const out = el('div', { class: 'curlout' })
  let parsed = null

  const preview = () => {
    out.replaceChildren()
    const text = area.value.trim()
    if (!text) {
      parsed = null
      out.append(el('p', { class: 'note', text: 'Paste a command and its parts appear here before anything is created.' }))
      return
    }

    const result = fromCurl(text)
    parsed = result.ok ? result : null
    if (!result.ok) {
      out.append(el('div', { class: 'find bad' }, [el('div', { class: 'find-bar' }), el('div', {}, [el('b', { text: 'Cannot read that' }), el('p', { text: result.error })])]))
      return
    }

    const req = result.request
    out.append(
      el('div', { class: 'curlhead' }, [
        el('span', { class: `verb ${req.method.toLowerCase()}`, text: req.method }),
        el('span', { class: 'curlurl', text: req.url })
      ])
    )

    const facts = el('div', { class: 'curlfacts' })
    const fact = (n, one, many) => {
      if (n) facts.append(el('span', { class: 'envchip plain' }, [el('b', { text: String(n) }), el('span', { text: n === 1 ? one : many })]))
    }
    fact(req.query.length, 'parameter', 'parameters')
    fact(req.headers.length, 'header', 'headers')
    if (req.auth.kind !== 'none') facts.append(el('span', { class: 'envchip lock' }, [el('b', { text: '1' }), el('span', { text: `${req.auth.kind} auth` })]))
    if (req.bodyKind !== 'none') facts.append(el('span', { class: 'envchip plain' }, [el('b', { text: req.bodyKind }), el('span', { text: 'body' })]))
    out.append(facts)

    if (result.unknown.length) {
      out.append(
        el('div', { class: 'envnudge' }, [
          el('p', {
            html: `Prism does not act on ${result.unknown.map((f) => `<code>${esc(f)}</code>`).join(', ')}. Everything else is imported — but that flag changes what the command does, so it is worth knowing it was left behind.`
          })
        ])
      )
    }
    if (result.insecure) {
      out.append(
        el('div', { class: 'envnudge' }, [
          el('p', { html: 'That command has <code>-k</code> in it, which turns off certificate checking. Prism will not do that silently: turn off <strong>Verify certificates</strong> in Settings if you meant it.' })
        ])
      )
    }
  }

  area.oninput = preview
  preview()
  box.append(area, out)

  sheet({
    title: 'Paste a cURL command',
    blurb: 'From a browser network tab, a colleague, or a README. It becomes a request you can send and assert on.',
    body: box,
    acts: [
      {
        label: 'Create the request',
        go: true,
        keepOpen: true,
        onClick: () => {
          if (!parsed) {
            toast('bad', 'There is nothing readable to create yet.')
            return
          }
          const flow = flowOf(S.pickedId ?? '') ?? allFlows()[0]
          if (!flow) {
            toast('bad', 'Make a collection first — there is nowhere to put it.')
            return
          }
          flow.requests.push(parsed.request)
          S.pickedId = parsed.request.id
          closeSheet()
          commit()
          tidyIfUnplaced(parsed.request.id)
          toast('ok', `${parsed.request.name} added to ${flow.name}`)
        }
      }
    ]
  })
}

/** A new node with no saved position lands somewhere sensible rather than 0,0. */
function tidyIfUnplaced(id) {
  if (S.layout.has(id)) return
  const spots = [...S.layout.values()]
  const y = spots.length ? Math.max(...spots.map((p) => p.y)) + 150 : 80
  S.layout.set(id, { x: 80, y })
  commit()
}

/* ================================================================= import */

async function doImport() {
  const chosen = await window.prism.file.open([
    { name: 'Collections and captures', extensions: ['json', 'har', 'yaml', 'yml'] },
    { name: 'All files', extensions: ['*'] }
  ])
  if (!chosen) return
  applyImport(readCollection(chosen.text, chosen.name))
}

const sourceLabel = (s) =>
  ({
    'rebind-workspace': 'a Rebind recording',
    'rebind-suite': 'a Rebind flow',
    postman: 'a Postman collection',
    'postman-environment': 'a Postman environment',
    openapi: 'an OpenAPI document',
    har: 'a browser capture',
    swagger: 'a Swagger document',
    'prism-workspace': 'a Prism workspace'
  })[s] ??
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

/* ========================================================== environments */

/**
 * Environments.
 *
 * On the page shell rather than in a dialog, because an environment is a thing
 * people work in — renaming, pasting, hunting a variable that is not set — and
 * a dialog is a container for a decision, not for work.
 *
 * The rail lists the environments themselves. What is *selected* here and what
 * is *in use* are two different things, and the old dialog conflated them: it
 * had one button that switched the workspace to whichever row you had clicked
 * last. Selecting is now free, and switching says which one it is switching to.
 */
let envAt = ''
let envFind = ''
let envPasting = false

function openEnvironments(id) {
  if (id) envAt = id
  // 'compare' is a section of this page rather than an environment, so it has
  // to survive this check — without it, clicking Compare bounced straight back
  // to whichever environment was in use.
  if (envAt !== 'compare' && !S.environments.some((e) => e.id === envAt)) {
    envAt = S.envId || S.environments[0]?.id || ''
  }

  const sections = S.environments.map((env) => ({
    id: env.id,
    label: env.name || 'Untitled',
    icon: env.id === S.envId ? I.check : I.globe,
    head: () => envHead(env),
    render: () => envPanel(env)
  }))

  if (!sections.length) {
    sections.push({
      id: 'none',
      label: 'No environments',
      icon: I.globe,
      blurb: 'A set of values a request can refer to as {{name}}.',
      render: () =>
        el('div', {}, [
          el('p', {
            class: 'note',
            text: 'An environment holds the values that change between machines — a base URL, a tenant, a login — so the same request works against your laptop and against staging.'
          }),
          el('button', { class: 'btn go', style: 'margin-top:12px', type: 'button', text: 'Create one', onclick: newEnvironment })
        ])
    })
  }

  if (S.environments.length > 1) {
    sections.push({
      id: 'compare',
      label: 'Compare',
      icon: '<path d="M12 4v16"/><path d="M8 8 4 12l4 4"/><path d="m16 8 4 4-4 4"/>',
      blurb: 'Why it works on one and not the other.',
      render: () => comparePanel()
    })
  }

  page({
    title: 'Environments',
    sections,
    active: envAt,
    onPick: (next) => {
      envFind = ''
      envPasting = false
      openEnvironments(next)
    },
    navFoot: el('button', {
      class: 'nav-add',
      type: 'button',
      html: ico(I.plus, 11, 2.4) + '<span>Add environment</span>',
      onclick: newEnvironment
    })
  })
}

/**
 * Two environments, side by side.
 *
 * The question is always "why does this work on Dev and not on Staging", and
 * the answer is almost always one name set in one and not the other — which is
 * invisible when the two are pages apart in a rail.
 *
 * A secret is compared as set-or-not and never by value: putting two live
 * tokens on screen beside each other to demonstrate that they differ, which
 * they obviously do, is not a thing worth doing.
 */
let compareA = ''
let compareB = ''

function comparePanel() {
  const box = el('div', { class: 'cmp' })
  const envs = S.environments
  if (!envs.some((e) => e.id === compareA)) compareA = S.envId || envs[0]?.id || ''
  if (!envs.some((e) => e.id === compareB) || compareB === compareA) {
    compareB = envs.find((e) => e.id !== compareA)?.id ?? ''
  }

  const picker = (which, value) =>
    el('select', {
      class: 'cmp-pick',
      'aria-label': which === 'a' ? 'First environment' : 'Second environment',
      onchange: (e) => {
        if (which === 'a') compareA = e.target.value
        else compareB = e.target.value
        openEnvironments('compare')
      }
    }, envs.map((x) => el('option', { value: x.id, text: x.name || 'Untitled', selected: x.id === value })))

  box.append(el('div', { class: 'cmp-head' }, [picker('a', compareA), el('span', { class: 'cmp-vs', text: 'against' }), picker('b', compareB)]))

  const a = envs.find((x) => x.id === compareA)
  const b = envs.find((x) => x.id === compareB)
  if (!a || !b) {
    box.append(el('p', { class: 'note', text: 'Two environments are needed to compare anything.' }))
    return box
  }

  const d = compareEnvs(a, b)
  const nothing = !d.onlyInA.length && !d.onlyInB.length && !d.differing.length
  if (nothing) {
    box.append(
      el('div', { class: 'find ok' }, [
        el('div', { class: 'find-bar' }),
        el('div', {}, [el('b', { text: 'The same, name for name' }), el('p', { text: `Both hold ${d.same.length} variable${d.same.length === 1 ? '' : 's'} with matching values.` })])
      ])
    )
    return box
  }

  const group = (title, why, rows) => {
    if (!rows.length) return
    box.append(el('div', { class: 'lbl', style: 'margin-top:14px' }, [el('span', { text: title }), el('em', { text: why })]))
    for (const r of rows) box.append(r)
  }

  group(
    `Only in ${a.name}`,
    'missing from the other one',
    d.onlyInA.map((name) =>
      el('div', { class: 'cmprow only-a' }, [
        el('code', { text: name }),
        el('span', { class: 'cmp-val', text: shortValue(a, name) }),
        el('span', { class: 'cmp-val none', text: 'not set' }),
        el('button', { class: 'tiny', type: 'button', text: `Copy to ${b.name}`, onclick: () => copyVar(a, b, name) })
      ])
    )
  )
  group(
    `Only in ${b.name}`,
    'missing from the other one',
    d.onlyInB.map((name) =>
      el('div', { class: 'cmprow only-b' }, [
        el('code', { text: name }),
        el('span', { class: 'cmp-val none', text: 'not set' }),
        el('span', { class: 'cmp-val', text: shortValue(b, name) }),
        el('button', { class: 'tiny', type: 'button', text: `Copy to ${a.name}`, onclick: () => copyVar(b, a, name) })
      ])
    )
  )
  group(
    'Different',
    'set in both, with different values',
    d.differing.map((x) =>
      el('div', { class: 'cmprow diff' }, [
        el('code', { text: x.name }),
        el('span', { class: 'cmp-val', text: x.secret ? x.a : cut(x.a) }),
        el('span', { class: 'cmp-val', text: x.secret ? x.b : cut(x.b) }),
        x.secret ? el('span', { class: 'stat', text: 'secret' }) : el('span', {})
      ])
    )
  )

  if (d.same.length) {
    box.append(
      el('p', { class: 'envfoot', style: 'margin-top:14px', text: `${d.same.length} more match on both sides.` })
    )
  }
  return box
}

const cut = (v) => (String(v).length > 30 ? `${String(v).slice(0, 27)}…` : String(v))

function shortValue(env, name) {
  if ((env.secrets ?? []).includes(name)) return String(env.values[name] ?? '') ? 'set' : 'not set'
  return cut(env.values[name] ?? '')
}

/** Copying a value across, except a secret — those are typed, never moved. */
function copyVar(from, to, name) {
  if ((from.secrets ?? []).includes(name)) {
    to.values[name] = ''
    to.secrets = [...new Set([...(to.secrets ?? []), name])]
    commit()
    toast('ok', `${name} added to ${to.name} as a secret — type its value there`)
  } else {
    to.values[name] = from.values[name]
    commit()
    toast('ok', `${name} copied to ${to.name}`)
  }
  openEnvironments('compare')
}

function newEnvironment() {
  const env = { id: uid('env'), name: 'New environment', values: {}, secrets: [] }
  S.environments.push(env)
  if (!S.envId) S.envId = env.id
  commit()
  openEnvironments(env.id)
}

/** The head: the name, edited where it is read, and what can be done to it. */
function envHead(env) {
  const inUse = env.id === S.envId
  const box = el('div', { class: 'envhead' })

  box.append(
    el('div', { class: 'envhead-top' }, [
      el('input', {
        class: 'envtitle',
        value: env.name,
        'aria-label': 'Environment name',
        spellcheck: 'false',
        oninput: (e) => {
          env.name = e.target.value
          paintBar()
          touch()
        },
        onchange: () => {
          commit()
          openEnvironments(env.id)
        }
      }),
      inUse
        ? el('span', { class: 'inuse', html: ico(I.check, 11, 2.6) + '<span>In use</span>' })
        : el('button', {
            class: 'btn go',
            type: 'button',
            text: 'Use this one',
            onclick: () => {
              S.envId = env.id
              commit()
              toast('ok', 'Switched to ' + (env.name || 'that environment'))
              openEnvironments(env.id)
            }
          }),
      el('button', { class: 'btn', type: 'button', text: 'Duplicate', onclick: () => duplicateEnvironment(env) }),
      el('button', { class: 'btn danger', type: 'button', text: 'Delete', onclick: () => askDeleteEnvironment(env) })
    ])
  )

  box.append(
    el('p', {
      class: 'envhead-sub',
      text: inUse
        ? 'Every request resolves {{name}} against this environment.'
        : 'Selected for editing. Requests still resolve against ' + (environment()?.name || 'nothing') + '.'
    })
  )
  return box
}

function duplicateEnvironment(env) {
  const copy = {
    id: uid('env'),
    name: copyName(env.name, S.environments.map((e) => e.name)),
    values: { ...env.values },
    secrets: [...(env.secrets ?? [])]
  }
  S.environments.push(copy)
  commit()
  toast('ok', copy.name + ' — ' + Object.keys(copy.values).length + ' variables copied')
  openEnvironments(copy.id)
}

function askDeleteEnvironment(env) {
  const count = Object.keys(env.values ?? {}).length
  const goes = []
  if (count) goes.push(count + ' variable' + (count === 1 ? '' : 's'))
  if (env.id === S.envId) goes.push('the environment requests are currently resolved against')

  askDelete({
    kind: 'environment',
    subject: subjectGroup(I.globe, env.name || 'Untitled', count + ' variable' + (count === 1 ? '' : 's')),
    goes,
    breaks: envDependants(env),
    danger: 'Delete environment',
    back: () => openEnvironments(env.id),
    onYes: () => {
      S.environments = S.environments.filter((e) => e.id !== env.id)
      if (S.envId === env.id) S.envId = S.environments[0]?.id ?? ''
      commit()
      toast('ok', 'Deleted ' + (env.name || 'the environment'))
      openEnvironments(S.envId)
    }
  })
}

/**
 * Requests left without a value if this environment goes.
 *
 * Only names no other environment defines and nothing captures — otherwise
 * deleting a duplicate of Development would claim to break the workspace.
 */
function envDependants(env) {
  const elsewhere = new Set(
    S.environments.filter((e) => e.id !== env.id).flatMap((e) => Object.keys(e.values ?? {}))
  )
  const captured = capturedNames()
  const out = []

  for (const name of Object.keys(env.values ?? {})) {
    if (elsewhere.has(name) || captured.includes(name)) continue
    for (const req of allRequests()) {
      if (variablesUsed(req).includes(name)) out.push({ name: req.name, variable: name })
    }
  }
  return out
}

const capturedNames = () => [
  ...new Set(allRequests().flatMap((r) => (r.captures ?? []).map((c) => c.name).filter(Boolean)))
]

/* ------------------------------------------------------------ the panel */

function envPanel(env) {
  const box = el('div', { class: 'envpanel' })
  const used = [...new Set(allRequests().flatMap((r) => variablesUsed(r)))]
  const captured = capturedNames()
  const a = auditEnv(env, used, captured)
  const repaint = () => openEnvironments(env.id)

  if (/prod|live|release/i.test(env.name)) {
    box.append(
      el('div', { class: 'envwarn' }, [
        el('span', { class: 'envwarn-ico', html: ico(I.alert, 13, 2) }),
        el('p', {
          text: 'This environment is named like production. Prism will not stop you — a suite that refuses to touch production is not much of a suite — but every request really is sent.'
        })
      ])
    )
  }

  const chips = el('div', { class: 'envchips' })
  const chip = (n, label, kind, title) => {
    if (n) chips.append(el('span', { class: 'envchip ' + kind, title: title ?? '' }, [el('b', { text: String(n) }), el('span', { text: label })]))
  }
  chip(a.defined.length, a.defined.length === 1 ? 'variable' : 'variables', 'plain', 'Defined here')
  chip(a.secrets.length, 'secret', 'lock', 'Hidden here, and never written to disk or into an export')
  chip(a.missing.length, 'missing', 'bad', 'Referred to by a request, and provided by nothing')
  chip(a.unmarked.length, 'unmarked', 'warn', 'Reads like a credential but is not marked secret')
  chip(a.shadowed.length, 'shadowed', 'warn', 'Also captured at run time — the captured value wins')
  chip(a.refill.length, 'to refill', 'bad', 'A secret whose value was not saved — reopening a workspace leaves these empty')
  chip(a.unused.length, 'unused', 'quiet', 'Defined here, referred to by nothing')
  if (chips.children.length) box.append(chips)

  if (a.unmarked.length) {
    box.append(
      el('div', { class: 'envnudge' }, [
        el('p', {
          html:
            'The name of <code>' +
            esc(a.unmarked[0]) +
            '</code>' +
            (a.unmarked.length > 1 ? ' and ' + (a.unmarked.length - 1) + ' more' : '') +
            ' reads like a credential. Marking it secret keeps it out of exports and off this disk.'
        }),
        el('button', {
          class: 'tiny go',
          type: 'button',
          text: a.unmarked.length > 1 ? 'Mark all as secret' : 'Mark as secret',
          onclick: () => {
            env.secrets = [...new Set([...(env.secrets ?? []), ...a.unmarked])]
            commit()
            toast('ok', a.unmarked.length + ' marked secret')
            repaint()
          }
        })
      ])
    )
  }

  if (a.refill.length) {
    box.append(
      el('div', { class: 'envnudge' }, [
        el('p', {
          html:
            (a.refill.length === 1 ? 'One secret is empty' : a.refill.length + ' secrets are empty') +
            ' — <code>' +
            a.refill.map((n) => esc(n)).slice(0, 3).join('</code>, <code>') +
            '</code>' +
            (a.refill.length > 3 ? ' and others' : '') +
            '. Their values are never saved, so a reopened workspace needs them typed again. In a CI run they come from <code>PRISM_&lt;NAME&gt;</code> instead.'
        })
      ])
    )
  }

  if (a.missing.length) {
    const list = el('div', { class: 'envmissing' })
    list.append(
      el('div', { class: 'lbl' }, [
        el('span', { text: 'Nothing provides these' }),
        el('em', { text: 'a request asks for them, and no environment or capture sets them' })
      ])
    )
    for (const name of a.missing) {
      const who = allRequests().filter((r) => variablesUsed(r).includes(name))
      list.append(
        el('div', { class: 'missrow' }, [
          el('code', { text: '{{' + name + '}}' }),
          el('span', { class: 'missby', title: who.map((r) => r.name).join('\n'), text: who.length === 1 ? who[0].name : who.length + ' requests' }),
          el('button', {
            class: 'tiny go',
            type: 'button',
            text: 'Add it here',
            onclick: () => {
              env.values[name] = ''
              commit()
              repaint()
            }
          })
        ])
      )
    }
    box.append(list)
  }

  const head = el('div', { class: 'lbl varlbl' }, [
    el('span', { text: 'Variables' }),
    el('em', { text: 'referred to as {{name}}' }),
    el('span', { class: 'pane-gap' })
  ])
  if (a.defined.length > 6) {
    // The same box the response search uses, so the two read as one control
    // rather than two different ideas of what a filter looks like.
    const field = el('input', {
      class: 'find-field',
      type: 'search',
      value: envFind,
      placeholder: 'Filter',
      'aria-label': 'Filter variables',
      spellcheck: 'false',
      oninput: (e) => {
        envFind = e.target.value
        const at = e.target.selectionStart
        repaint()
        // Repainting replaces the field, so the caret has to be put back or
        // the second character starts a new search.
        const next = document.querySelector('.varlbl .find-field')
        if (next) {
          next.focus()
          next.setSelectionRange(at, at)
        }
      }
    })
    head.append(
      el('div', { class: 'find-bar-row varfind' }, [el('span', { class: 'find-icon', html: ico(I.search, 12, 2) }), field])
    )
  }
  box.append(head)

  const q = envFind.trim().toLowerCase()
  const rows = Object.entries(env.values ?? {}).filter(([k, v]) => !q || (k + ' ' + v).toLowerCase().includes(q))

  if (!Object.keys(env.values ?? {}).length) {
    box.append(el('p', { class: 'note', text: 'No variables yet. Add one, or paste a block of them.' }))
  } else if (!rows.length) {
    box.append(el('p', { class: 'note', text: 'Nothing matches \u201c' + envFind + '\u201d.' }))
  } else {
    const table = el('div', { class: 'vtable' })
    table.append(
      el('div', { class: 'vhead' }, [
        el('span', { text: 'Name' }),
        el('span', { text: 'Value' }),
        el('span', { text: 'Used by' }),
        el('span', { class: 'vhead-r', text: '' })
      ])
    )
    for (const [key, value] of rows) table.append(varRow(env, key, value, captured, repaint))
    box.append(table)
  }

  const acts = el('div', { class: 'envacts' })
  acts.append(
    el('button', {
      class: 'addbtn',
      type: 'button',
      html: ico(I.plus, 10, 2.4) + '<span>Add variable</span>',
      onclick: () => {
        env.values[freeName(env.values)] = ''
        envFind = ''
        commit()
        repaint()
      }
    })
  )
  acts.append(
    el('button', {
      class: 'addbtn',
      type: 'button',
      html: ico(I.paste, 10, 1.9) + '<span>' + (envPasting ? 'Cancel paste' : 'Paste a block') + '</span>',
      onclick: () => {
        envPasting = !envPasting
        repaint()
      }
    })
  )
  box.append(acts)

  if (envPasting) box.append(pasteBox(env, repaint))

  box.append(
    el('p', {
      class: 'envfoot',
      html:
        'Values are saved with the workspace, on this machine. A variable marked <strong>secret</strong> is not: its name is kept so a shared workspace says what to refill, and in a CI run it is supplied as <code>PRISM_&lt;NAME&gt;</code>.'
    })
  )
  return box
}

function varRow(env, key, value, captured, repaint) {
  const secret = (env.secrets ?? []).includes(key)
  const who = allRequests().filter((r) => variablesUsed(r).includes(key))
  const row = el('div', { class: 'vrow' + (who.length ? '' : ' idle') })

  row.append(
    el('input', {
      class: 'vname',
      value: key,
      'aria-label': 'Variable name',
      spellcheck: 'false',
      onchange: (e) => {
        const next = e.target.value.trim()
        if (!next || next === key) {
          e.target.value = key
          return
        }
        env.values = renameKey(env.values, key, next)
        if (secret) env.secrets = [...(env.secrets ?? []).filter((k) => k !== key), next]
        commit()
        repaint()
      }
    })
  )

  row.append(
    el('input', {
      class: 'vval',
      value: String(value ?? ''),
      type: secret ? 'password' : 'text',
      placeholder: secret ? (String(value ?? '') === '' ? 'needs refilling' : 'not written to disk') : 'empty',
      'aria-label': 'Value of ' + key,
      spellcheck: 'false',
      oninput: (e) => {
        env.values[key] = e.target.value
        touch()
      },
      onchange: () => commit()
    })
  )

  row.append(
    who.length
      ? el('span', { class: 'vused', title: who.map((r) => r.name).join('\n'), text: who.length === 1 ? who[0].name : who.length + ' requests' })
      : el('span', { class: 'vused none', text: captured.includes(key) ? 'captured instead' : 'nothing' })
  )

  row.append(
    el('div', { class: 'vacts' }, [
      el('button', {
        class: 'lockbtn' + (secret ? ' on' : ''),
        type: 'button',
        title: secret ? 'Secret — never written to disk or an export' : 'Mark as a secret',
        'aria-pressed': String(secret),
        'aria-label': secret ? key + ' is secret' : 'Mark ' + key + ' as secret',
        html: ico(secret ? I.lock : I.unlock, 12, 2),
        onclick: () => {
          env.secrets = secret ? (env.secrets ?? []).filter((k) => k !== key) : [...(env.secrets ?? []), key]
          commit()
          repaint()
        }
      }),
      el('button', {
        class: 'x-btn',
        type: 'button',
        'aria-label': 'Remove ' + key,
        html: ico(I.x, 11, 2.3),
        onclick: () => {
          delete env.values[key]
          env.secrets = (env.secrets ?? []).filter((k) => k !== key)
          commit()
          repaint()
        }
      })
    ])
  )
  return row
}

/**
 * Pasting a block.
 *
 * People arrive here from a terminal or a dashboard with twenty lines in the
 * clipboard, and adding them one field at a time is how an environment goes
 * stale. Anything the parser cannot read is listed rather than dropped.
 */
function pasteBox(env, repaint) {
  const box = el('div', { class: 'pastebox' })
  const area = el('textarea', {
    class: 'pastearea',
    rows: '6',
    spellcheck: 'false',
    placeholder: 'BASE_URL=https://api.example.test\nexport API_TOKEN=…\nTENANT: northwind',
    'aria-label': 'Variables to add'
  })
  const report = el('p', { class: 'pastenote' })

  const preview = () => {
    const { count, skipped } = parseDotEnv(area.value)
    report.replaceChildren(
      el('span', { text: count ? count + ' variable' + (count === 1 ? '' : 's') + ' ready' : 'Nothing readable yet' }),
      skipped.length
        ? el('span', {
            class: 'pasteskip',
            text: ' · ' + skipped.length + ' line' + (skipped.length === 1 ? '' : 's') + ' it cannot read: ' + skipped.slice(0, 2).join(', ')
          })
        : null
    )
  }
  area.oninput = preview
  preview()

  box.append(
    area,
    report,
    el('div', { class: 'envacts' }, [
      el('button', {
        class: 'btn go',
        type: 'button',
        text: 'Add them',
        onclick: () => {
          const { values, count, skipped } = parseDotEnv(area.value)
          if (!count) {
            toast('bad', 'Nothing in that block reads as a variable.')
            return
          }
          const replaced = Object.keys(values).filter((k) => k in env.values)
          Object.assign(env.values, values)
          // A pasted credential is marked on the way in rather than left for
          // someone to notice later: the name is usually the only clue there is.
          for (const name of Object.keys(values)) {
            if (looksSecret(name) && !(env.secrets ?? []).includes(name)) env.secrets = [...(env.secrets ?? []), name]
          }
          envPasting = false
          commit()
          toast(
            'ok',
            count + ' added' + (replaced.length ? ', ' + replaced.length + ' replaced' : '') + (skipped.length ? ', ' + skipped.length + ' skipped' : '')
          )
          repaint()
        }
      })
    ])
  )
  return box
}

/* ============================================================ page shell */

/**
 * The shell Settings and Help share.
 *
 * A nav rail and a scrolling column, at a size where a paragraph is a
 * paragraph. Both are things people read rather than dismiss, and a dialog the
 * size of a confirm is the wrong container for either.
 */
function page({ title, sections, active, onPick, navFoot }) {
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
  // A page whose rail lists things rather than sections needs a way to add
  // one; Settings and Help pass nothing and are unchanged.
  if (navFoot) nav.append(navFoot)
  nav.append(el('span', { class: 'spacer' }))
  nav.append(el('footer', { html: 'Rebind Prism 0.1.0<br />MIT licensed &middot; no account, no key' }))

  const sec = sections.find((x) => x.id === active) ?? sections[0]
  const main = el('div', { class: 'page-main' }, [
    // A section may draw its own head — an environment's name is editable, and
    // an h2 you cannot type into is the wrong control for it.
    sec.head ? el('div', { class: 'page-head' }, [sec.head()]) : el('div', { class: 'page-head' }, [el('h2', { text: sec.label }), sec.blurb ? el('p', { text: sec.blurb }) : null]),
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
  Network: 'Getting out of this network, and proving who Prism is.',
  Data: 'What Prism keeps, where it keeps it, and how to be rid of it.',
  About: 'What this is, and what it will not do.'
}

const SET_ICON = {
  Appearance: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/>',
  Sending: '<path d="M7 4v16l13-8z"/>',
  // Traffic passing through something on the way out, which is what both
  // halves of this group are about: a proxy, and the certificate that says
  // who is on the other end of it.
  Network: '<path d="M2 12h5M17 12h5"/><rect x="7" y="8.5" width="10" height="7" rx="2"/><path d="M10.5 12h3"/>',
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
    box.append(cookieRow(group))
    box.append(storedRow(group))
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

/**
 * The cookie jar, in the open.
 *
 * A jar that silently attaches credentials to outgoing requests is the sort of
 * thing that should be inspectable, so this lists what is held and by which
 * host, and lets any of it go.
 */
function cookieRow(group) {
  const row = el('div', { class: 'prefrow' }, [
    el('div', { class: 'prefwords' }, [el('b', { text: 'Cookies' }), el('p', { text: 'Reading the jar…' })])
  ])

  window.prism.cookies.list().then((all) => {
    const hosts = [...new Set(all.map((c) => c.domain))]
    row.replaceChildren(
      el('div', { class: 'prefwords' }, [
        el('b', { text: 'Cookies' }),
        el('p', {
          text: all.length
            ? `${all.length} held for ${hosts.length} host${hosts.length === 1 ? '' : 's'}: ${hosts.slice(0, 3).join(', ')}${hosts.length > 3 ? `, and ${hosts.length - 3} more` : ''}. Kept in memory only.`
            : 'None held. A Set-Cookie from a response is remembered here and sent back to the same host, which is what lets a session-based API be chained.'
        })
      ]),
      all.length
        ? el('button', {
            class: 'btn',
            type: 'button',
            text: 'Clear',
            onclick: async () => {
              await window.prism.cookies.clear()
              openSettings(group)
              toast('ok', 'Cookie jar emptied')
            }
          })
        : el('span', { class: 'stat', text: 'empty' })
    )
  })
  return row
}

/** Where the autosave lives, and how to be rid of it. */
function storedRow(group) {
  const row = el('div', { class: 'prefrow' }, [
    el('div', { class: 'prefwords' }, [el('b', { text: 'Saved workspace' }), el('p', { text: 'Looking…' })])
  ])

  window.prism.workspace.restore().then((found) => {
    row.replaceChildren(
      el('div', { class: 'prefwords' }, [
        el('b', { text: 'Saved workspace' }),
        el('p', {
          text: found?.path
            ? `Collections, environments, node positions and baselines are kept at ${found.path}. Secret values are not written to it.`
            : 'Nothing saved yet. Your work is written here as you go, so it comes back next time.'
        })
      ]),
      found?.path
        ? el('button', {
            class: 'btn',
            type: 'button',
            text: 'Forget',
            onclick: () =>
              askDelete({
                kind: 'saved workspace',
                subject: subjectGroup(I.folder, 'workspace.json', found.path),
                goes: ['every baseline frozen so far', 'the position of every node on the plane'],
                // Nothing depends on the file the way a request depends on a
                // captured token, but the surprise is worth naming.
                breaks: [],
                danger: 'Delete it',
                onYes: async () => {
                  await window.prism.workspace.forget()
                  openSettings(group)
                  toast(
                    'ok',
                    S.prefs.autosave === false
                      ? 'Saved workspace deleted'
                      : 'Deleted — and written again on your next change, unless you turn off “Remember my work”'
                  )
                }
              })
          })
        : el('span', { class: 'stat', text: 'none' })
    )
  })
  return row
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
  } else if (item.kind === 'text' || item.kind === 'secret') {
    control.append(
      el('input', {
        class: 'preftext',
        type: item.kind === 'secret' ? 'password' : 'text',
        value: String(value ?? ''),
        placeholder: item.placeholder ?? '',
        spellcheck: 'false',
        'aria-label': item.label,
        oninput: (e) => {
          // Not through setPref on every keystroke: that repaints the page and
          // takes the caret with it.
          S.prefs[item.id] = e.target.value
        },
        onchange: (e) => setPref(item.id, e.target.value)
      })
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
          html: '<strong>Import</strong> in the bar — or dropping the file anywhere on the window — reads a Rebind workspace export, a Rebind flow, a Postman collection (v2.0 or v2.1), a Postman environment, an OpenAPI 3 or Swagger 2 document, a browser <strong>HAR</strong> capture, and a Prism workspace of its own. Everything arrives as a <strong>collection</strong>.'
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
        el('p', {
          html: 'An OpenAPI import turns each <em>tag</em> into a flow, fills rows from the examples and enums in the document, and builds a body from the schema. The body is at zero values — empty strings, zeros — rather than plausible-looking ones, because a request that ships an invented email address to a real API is worse than an obviously blank one.'
        }),
        el('h4', { text: 'Or paste one request' }),
        el('p', {
          html:
            '<strong>Ctrl&nbsp;Shift&nbsp;V</strong> takes a <code>curl</code> command from the clipboard and turns it into a request — the method, the query, the headers, the body, and an <code>Authorization</code> header becomes the auth block rather than a literal token. Copy-as-cURL from a browser network tab is how most requests start life.'
        }),
        el('p', {
          html:
            'A <strong>HAR</strong> file is the same gesture for a whole session. Prism drops the fonts, scripts and images, folds the same call made forty times back into one, keeps the request that succeeded over the 401 that provoked the login, and turns the host they share into <code>{{base_url}}</code>. A live token in the capture is replaced by the variable, never imported.'
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
    id: 'environments',
    label: 'Environments',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    blurb: 'The values that change between machines.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html:
            'An environment is a set of values a request refers to as <code>{{name}}</code> — a base URL, a tenant, a login. The same request then works against your laptop and against staging, and switching between them is one click rather than an edit.'
        }),
        el('h4', { text: 'Selected is not in use' }),
        el('p', {
          html:
            'Clicking a name in the rail opens it for editing and changes nothing else. <strong>Use this one</strong> is what switches the workspace, and the one it is switched to says <strong>In use</strong>. Reading an environment should never rearm the thing that sends requests at a server.'
        }),
        el('h4', { text: 'What the counts mean' }),
        el('ul', {}, [
          el('li', { html: '<strong>missing</strong> — a request asks for it and nothing provides it. A captured value does not count as missing; the chain supplies it at run time.' }),
          el('li', { html: '<strong>unused</strong> — defined here and mentioned by no request. Usually left over from an import.' }),
          el('li', { html: '<strong>shadowed</strong> — set here and also captured. The captured value wins, which is worth knowing before you change this one and see no difference.' }),
          el('li', { html: '<strong>to refill</strong> — a secret whose value was never saved. See below.' })
        ]),
        el('h4', { text: 'Secrets' }),
        el('p', {
          html:
            'Marking a variable <strong>secret</strong> hides it in its field and keeps its value out of every export <em>and</em> out of the saved workspace. The name is kept, so reopening tells you exactly what to type again, and a workspace shared with a colleague never carried your token in the first place.'
        }),
        el('div', {
          class: 'callout',
          html: 'A pasted block marks anything that reads like a credential — <code>token</code>, <code>api_key</code>, <code>password</code> — as secret on the way in. The name is usually the only clue available, and asking afterwards is asking too late.'
        }),
        el('p', {
          html: 'In a CI run the value comes from the process environment as <code>PRISM_&lt;NAME&gt;</code>, so <code>PRISM_API_KEY</code> fills <code>{{api_key}}</code> without it ever being committed.'
        }),
        el('h4', { text: 'Built in, always available' }),
        el('p', {
          html:
            '<code>{{$uuid}}</code>, <code>{{$timestamp}}</code>, <code>{{$isoTimestamp}}</code>, <code>{{$randomInt}}</code>, <code>{{$randomAlpha}}</code> and <code>{{$randomEmail}}</code> need no environment. Each is generated fresh every time it appears, so two in one body are two different values.'
        })
      ])
  },
  {
    id: 'running',
    label: 'Running a flow',
    icon: '<path d="M6 4v16"/><path d="M6 8h7a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H6"/><circle cx="18" cy="6" r="2"/>',
    blurb: 'The graph is the plan, not decoration.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html:
            'The plane draws an edge from the request that captures a value to the ones that spend it. <strong>Run flow</strong> follows those edges: dependencies first, and anything genuinely independent at the same time.'
        }),
        el('p', {
          html:
            'So a request placed above the one that provides its token still runs after it. That used to be a 401 with nothing wrong on the server — the runner went down the list, and the list was in the order somebody happened to add things.'
        }),
        el('h4', { text: 'Stages' }),
        el('p', {
          html:
            'The run sheet groups the flow into stages. Everything in a stage goes at once, because nothing in it waits on anything else in it — twelve requests where eight are independent finish in three stages rather than twelve steps, and the toast says how much that saved.'
        }),
        el('div', {
          class: 'callout',
          html: 'A flow where two requests each wait for something the other produces has no valid order, so Prism refuses to run it and names the loop. Any order it picked would be a guess presented as a result.'
        }),
        el('h4', { text: 'Running one thing ten times' }),
        el('p', {
          html:
            'A test that passes nine times out of ten is the expensive kind of broken: the failure gets re-run until it passes, and after a while nobody reads the result. <strong>Run it ten times</strong> in a request&rsquo;s menu sends the same request in sequence and says whether the outcome was stable. A 4xx or 5xx counts as a failure even with nothing asserting on it.'
        })
      ])
  },
  {
    id: 'auth',
    label: 'Auth & inheritance',
    icon: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    blurb: 'Set once, above, instead of forty times.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html:
            'A collection and a flow can each set auth and headers, and a request set to <strong>Inherit</strong> — the default — picks up the nearest one. Forty requests each carrying their own copy of the same token is how a collection rots: the fortieth never gets updated.'
        }),
        el('p', {
          html:
            'The nearest setting wins, the way it does in every config file: a request beats its flow, a flow beats its collection. <strong>No auth</strong> is a decision rather than an absence — it stops the search, which is what a login endpoint needs when it must not carry the token it is about to fetch.'
        }),
        el('p', {
          html: 'Inherited headers are shown on the request, greyed, with the level they came from. <strong>Override</strong> copies one down as the request&rsquo;s own; editing it in place would either fork it silently or change every other request without saying so.'
        }),
        el('h4', { text: 'OAuth 2' }),
        el('p', {
          html:
            'The <strong>OAuth 2.0</strong> kind fetches a token rather than holding one you pasted. Client credentials, password and refresh-token grants; the token is fetched before a send when it is missing or within thirty seconds of expiring, and refreshed rather than re-fetched where the server issued a refresh token.'
        }),
        el('div', {
          class: 'callout',
          html: 'The token lives in memory for the session. It is never written to the workspace, an export, or this disk — and neither is the client secret.'
        })
      ])
  },
  {
    id: 'graphql',
    label: 'GraphQL',
    icon: '<circle cx="12" cy="4" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><path d="M12 6 5 17M12 6l7 11M6 18h12"/>',
    blurb: 'One endpoint, and the request in the body.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('p', {
          html:
            'Set the body kind to <strong>GraphQL</strong> and the query and its variables become two fields. The envelope the server wants — <code>query</code>, <code>variables</code>, <code>operationName</code> — is assembled at send time, and the operation name is read out of the query rather than typed twice.'
        }),
        el('p', {
          html: 'A <code>$name</code> in the query is GraphQL&rsquo;s own variable and comes from the Variables block. <code>{{name}}</code> is Prism&rsquo;s, and comes from the environment — it works in either field.'
        }),
        el('h4', { text: 'Errors arrive inside a 200' }),
        el('p', {
          html:
            'This is the failure a REST-shaped tool misses: the status assertion passes, the body says the query was rejected, and the suite is green. Prism reads <code>errors</code> out of the response and says so on the Result tab, with the server&rsquo;s own message and the line it points at.'
        }),
        el('h4', { text: 'What the endpoint can do' }),
        el('p', {
          html:
            '<strong>Fetch the schema</strong> runs an introspection query through the same sender — same auth, same proxy, same certificate — and lists the queries and mutations. Picking one writes a runnable stub into the query field.'
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
    id: 'automation',
    label: 'Baselines, data & CI',
    icon: '<path d="M4 17V7M4 7l6 4 4-6 6 8"/><path d="M4 20h16"/>',
    blurb: 'Running the same flow again, and again, and in CI.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('h4', { text: 'Baselines' }),
        el('p', {
          html: 'The <strong>Diff</strong> tab compares against the previous run, which answers <em>did anything change since I last pressed Send</em>. <strong>Drift</strong> answers the more useful one: <strong>Freeze</strong> a response and every later run is checked against the shape you agreed on.'
        }),
        el('p', {
          html: 'Findings are grouped by how much they should worry you. A field that vanished or changed type breaks whoever consumes it; a new field almost never does; a changed value is usually just the data being data. Baselines are saved with the workspace, so a drift is reviewable in a pull request.'
        }),
        el('h4', { text: 'Running a table of inputs' }),
        el('p', {
          html: 'The <strong>Data</strong> tab takes a CSV or a JSON array, dropped on it or chosen from disk. The request is sent once per row, with each column shadowing the environment for that send only — so <code>{{email}}</code> in the body picks up the email column. Rows run in order, not at once: a table often walks one resource through several states, and firing them together makes the outcome depend on which finished first.'
        }),
        el('p', { html: 'Prism names any column the request never mentions, which is usually a stale export or a typo.' }),
        el('h4', { text: 'On the command line' }),
        el('p', {
          html: '<strong>Save workspace</strong> writes a <code>.prism.json</code> you can commit beside your code, and <code>prism-run</code> runs that same file:'
        }),
        el('pre', { class: 'src' }, [
          el('span', { class: 'ln', text: 'prism-run checkout.prism.json --env CI --reporter junit --out results.xml' })
        ]),
        el('p', {
          html: 'It exits 0 when every assertion passed and 1 when any did not, which is the only thing a CI runner reads. Chaining, cookies, datasets and assertions behave exactly as they do here, because it is the same code under the same tests.'
        }),
        el('div', {
          class: 'callout',
          html: 'A <strong>secret</strong> is never written to a workspace file — only its name. In CI supply it as <code>PRISM_&lt;NAME&gt;</code> in the environment, where it is never committed: <code>PRISM_PASSWORD</code> fills <code>{{password}}</code>.'
        }),
        el('h4', { text: 'Cookies' }),
        el('p', {
          html: 'A <code>Set-Cookie</code> is remembered and sent back to the same host, respecting domain, path, Secure and expiry — without which a session-based API cannot be chained at all. The jar is in memory only; Settings &rarr; Data lists what it holds and empties it.'
        })
      ])
  },
  {
    id: 'saving',
    label: 'Saving',
    icon: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
    blurb: 'Two different things, and the difference matters.',
    body: () =>
      el('div', { class: 'doc' }, [
        el('h4', { text: 'Your work comes back on its own' }),
        el('p', {
          html: 'Everything on screen is written to the app&rsquo;s own directory a few seconds after you stop typing, and restored the next time Prism opens. You do not have to do anything for this, and there is nothing to lose by closing the window. Settings &rarr; Data says where that file is and can delete it.'
        }),
        el('p', {
          html: 'The file you were editing comes back with it. Reopen Prism and the same <code>.prism.json</code> is still the open document, so <kbd>Ctrl S</kbd> writes straight back to it. If you had changes that were never saved, the dot beside the name says so rather than pretending the file is current.'
        }),
        el('h4', { text: 'A file you can keep' }),
        el('p', {
          html: 'The <strong>Save</strong> button in the bar writes a <code>.prism.json</code> you own — commit it beside your code, send it to somebody, keep it in a folder per project. The first press asks where; every press after that writes back to the same file, like any other document.'
        }),
        el('p', {
          html: 'The button says which file you are editing, and the dot beside it says whether that file is current: <strong>filled amber</strong> means there are changes it does not have yet, <strong>filled green</strong> means it is up to date, and <strong>hollow</strong> means this workspace has never been saved to a file at all. The arrow beside it opens Save as, Open, Show in folder, and Discard changes and reload.'
        }),
        el('h4', { text: 'What a saved file does not contain' }),
        el('p', {
          html: 'The <em>value</em> of any variable marked <strong>secret</strong> is left out, and so are response bodies. The names are kept, so opening a shared workspace tells whoever opened it what to fill in. That is what makes the file safe to commit.'
        })
      ])
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
          el('dt', { text: 'Ctrl Shift V' }),
          el('dd', { text: 'Turn a cURL command in the clipboard into a request' }),
          el('dt', { text: 'Ctrl S' }),
          el('dd', { text: 'Save — writes back to the open file, and asks where only the first time' }),
          el('dt', { text: 'Ctrl Shift S' }),
          el('dd', { text: 'Save as — write a new file' }),
          el('dt', { text: 'Ctrl O' }),
          el('dd', { text: 'Open a saved workspace' }),
          el('dt', { text: 'Ctrl F' }),
          el('dd', { text: 'Filter the request tree' }),
          el('dt', { text: 'Drop' }),
          el('dd', { text: 'A collection on the window, a table on the Data tab' }),
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
            html: 'Collections, environments, node positions and baselines, in a file in the app&rsquo;s own directory — so your work comes back next time. Settings &rarr; Data says exactly where, and deletes it.'
          }),
          el('li', {
            html: 'How long each run took and whether it passed, so the trend and the flaky list survive a restart. Measurements only — no response body, no headers, no URL.'
          }),
          el('li', {
            html: 'Response bodies, cookies and OAuth tokens in memory only, gone when Prism closes.'
          })
        ]),
        el('h4', { text: 'What is never written' }),
        el('p', {
          html: 'The <em>value</em> of a variable marked <strong>secret</strong>, in the autosave or in a saved <code>.prism.json</code>. The name survives, so opening a shared workspace tells you what to refill; in CI the value is supplied as <code>PRISM_&lt;NAME&gt;</code> in the environment and is never committed.'
        }),
        el('h4', { text: 'Credentials' }),
        el('ul', {}, [
          el('li', { html: 'Never resolved into an export, in any target.' }),
          el('li', {
            html: 'Masked in the inspector&rsquo;s request headers, unless you turn that off in Settings &rarr; Safety.'
          }),
          el('li', {
            html: 'A variable marked <strong>secret</strong> on the Environments page is hidden in its field, never written to disk, and left out of every export.'
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

/**
 * A sparkline of the last runs.
 *
 * Drawn rather than described because the shape is the point: a step change
 * three runs ago reads instantly and takes a paragraph to write down. A failed
 * run is marked, so a slow run and a broken one are never confused.
 */
function sparkline(points, width = 168, height = 34) {
  if (points.length < 2) return null
  const top = Math.max(...points.map((p) => p.ms), 1)
  const x = (i) => (i / (points.length - 1)) * (width - 4) + 2
  const y = (ms) => height - 3 - (ms / top) * (height - 8)

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.ms).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`
  const marks = points
    .map((p, i) => (p.failed ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p.ms).toFixed(1)}" r="2.4" class="bad"/>` : ''))
    .join('')

  const svg = el('span', { class: 'spark' })
  svg.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
      <path class="fill" d="${area}"/>
      <path class="line" d="${line}"/>
      ${marks}
    </svg>`
  return svg
}

/** The trend strip above a request's runs. */
function trendStrip(runs) {
  const sum = summarise(runs)
  if (!sum.runs) return null

  const box = el('div', { class: 'trend' })
  const points = spark(runs, 30)
  const chart = sparkline(points)
  if (chart) box.append(chart)

  const stats = el('div', { class: 'trendstats' })
  const stat = (label, value, cls = '') => stats.append(el('span', { class: `tstat ${cls}` }, [el('b', { text: value }), el('span', { text: label })]))
  stat('runs', String(sum.runs))
  stat('median', `${sum.median}ms`)
  stat('slowest', `${sum.slowest}ms`)
  if (sum.failures) stat('failed', String(sum.failures), 'bad')
  box.append(stats)

  const said = headline(sum)
  if (said) box.append(el('span', { class: `verdict ${sum.verdict === 'slower' || sum.failures ? 'bad' : 'ok'}`, text: said }))
  return box
}

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

  const unstable = flakyRuns(S.history)
  if (unstable.length) {
    // First in the rail, because a test that fails one run in four is the most
    // expensive thing in the list and the easiest to never notice.
    sections.unshift({
      id: 'flaky',
      label: `Flaky (${unstable.length})`,
      icon: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 17h.01"/>',
      blurb: 'Requests that have both passed and failed in this workspace.',
      render: () => flakyPanel(unstable)
    })
    if (!ids.includes(historyOf) && historyOf !== 'flaky') historyOf = 'flaky'
  }

  page({ title: 'History', sections, active: historyOf, onPick: (id) => {
    historyOf = id
    openHistory()
  } })
}

/**
 * The requests that cannot make up their mind.
 *
 * A test that fails one run in four is worse than one that always fails: the
 * failure gets re-run until it passes, and after a while nobody reads the
 * result at all.
 */
function flakyPanel(list) {
  const box = el('div')
  box.append(
    el('p', {
      class: 'note',
      text: 'These have both passed and failed. Sorted by how often they fail, because that is how much attention each deserves.'
    })
  )
  for (const x of list) {
    box.append(
      el('button', { class: 'flakyrow', type: 'button', onclick: () => {
        historyOf = x.requestId
        openHistory()
      } }, [
        el('span', { class: 'flakyrate', text: `${x.rate}%` }),
        el('div', {}, [
          el('b', { text: x.name || 'Untitled' }),
          el('span', { text: `${x.pass} passed, ${x.fail} failed` })
        ]),
        el('span', { class: 'pane-gap' }),
        el('span', { class: 'stat', text: 'see the runs' })
      ])
    )
  }
  return box
}

function historyFor(runs) {
  const box = el('div')
  // The trend first: "is this getting slower" is the reason to keep old runs
  // at all, and it is not answerable from a list of times in a column.
  const trend = trendStrip(runs)
  if (trend) box.append(trend)

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

/**
 * Running a flow.
 *
 * The plan comes from the graph, not from the order of the list. The canvas has
 * always drawn an edge from the request that captures a value to the ones that
 * spend it; until now the runner ignored those edges and went top to bottom, so
 * the picture said "independent" while the runner enforced an order, and a
 * request placed above its own provider sent an unresolved {{token}} and failed
 * with a 401 that had nothing to do with the server.
 *
 * Everything in a stage runs at once because nothing in it waits on anything
 * else in it. That is the whole point of drawing the graph.
 */
async function runFlow(only) {
  const req = current()
  // Guarded rather than trusted: this is wired to a click handler, which calls
  // it with the Event, and an Event has no `requests` — the button ran nothing
  // and said "Running undefined" for exactly as long as nobody looked.
  const given = Array.isArray(only?.requests) ? only : null
  const flow = given ?? (req ? flowOf(req.id) : null) ?? allFlows().find((f) => f.requests.length)
  if (!flow) {
    toast('bad', 'There is no flow to run.')
    return
  }

  const known = Object.keys(envValues())
  const p = plan(flow.requests, known)

  if (p.cycles.length) {
    // Refusing is the honest answer: there is no order that satisfies the
    // dependencies, so any order Prism picked would be a guess dressed up as
    // a result.
    sheet({
      title: `${flow.name} cannot run`,
      blurb: 'These requests each wait for a value another of them produces, so there is no order that works.',
      body: el('div', { class: 'doc' }, [
        el('ul', {}, p.cycles.map((r) => el('li', { text: r.name || 'Untitled' }))),
        el('p', { text: 'Break the loop by removing one of the captures, or by setting that value in the environment instead.' })
      ]),
      acts: []
    })
    return
  }

  const flat = p.stages.flat()
  const state = new Map(flat.map((r) => [r.id, { id: r.id, name: r.name, status: 'wait', ms: 0, code: 0 }]))
  const body = el('div', { class: 'suite' })
  const ring = el('div', { class: 'ring' })
  const steps = el('div', { class: 'steps' })

  const paint = () => {
    const all = [...state.values()]
    const done = all.filter((s) => s.status === 'pass' || s.status === 'fail').length
    const failed = all.filter((s) => s.status === 'fail').length
    const pct = all.length ? done / all.length : 0
    const C = 2 * Math.PI * 58
    ring.innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140">
        <circle class="tr" cx="70" cy="70" r="58"></circle>
        <circle class="fl${failed ? ' bad' : ''}" cx="70" cy="70" r="58" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg><b>${Math.round(pct * 100)}%</b>`

    steps.replaceChildren()
    p.stages.forEach((stage, i) => {
      // Only worth labelling when there is something to say: a flow that is
      // one long chain looks exactly as it always did.
      if (!p.sequential) {
        steps.append(
          el('div', { class: 'stage-lbl' }, [
            el('span', { text: `Stage ${i + 1}` }),
            el('em', { text: stage.length === 1 ? 'on its own' : `${stage.length} at once` })
          ])
        )
      }
      for (const r of stage) {
        const x = state.get(r.id)
        steps.append(
          el('div', { class: `step${x.status === 'wait' ? ' wait' : ''}` }, [
            el('span', { class: `state ${x.status === 'run' ? 'busy' : x.status === 'wait' ? '' : x.status}` }),
            el('span', { class: 'nm', text: x.name }),
            x.code ? el('span', { class: `code ${tone(x.code)}`, text: String(x.code) }) : null,
            el('span', { class: 'ms', text: x.ms ? `${x.ms}ms` : x.status })
          ])
        )
      }
    })
    body.replaceChildren(ring, steps)
  }

  paint()
  sheet({
    title: `Running ${flow.name}`,
    blurb: describePlan(p) + (p.unresolved.length ? ` · ${p.unresolved.length} value${p.unresolved.length === 1 ? '' : 's'} nothing provides` : ''),
    body,
    acts: []
  })

  const started = Date.now()
  for (const stage of p.stages) {
    await Promise.all(
      stage.map(async (r) => {
        const x = state.get(r.id)
        x.status = 'run'
        paint()
        await send(r)
        const res = S.results.get(r.id)
        x.ms = res?.timing?.total ?? 0
        x.code = res?.status ?? 0
        x.status = res?.failed || res?.error ? 'fail' : 'pass'
        paint()
      })
    )
  }

  const all = [...state.values()]
  const failed = all.filter((s) => s.status === 'fail').length
  const wall = Date.now() - started
  const serial = all.reduce((n, x) => n + x.ms, 0)
  // Only mentioned when the parallelism actually bought something, so the
  // claim is never larger than the saving.
  const saved = !p.sequential && serial > wall + 100 ? `, ${Math.round(serial - wall)}ms saved by running in parallel` : ''
  toast(failed ? 'bad' : 'ok', `${flow.name} — ${all.length - failed} passed, ${failed} failed${saved}`)
}

/** Every flow in a collection, one flow after another. */
async function runCollection(col) {
  for (const flow of col.flows) {
    if (flow.requests.length) await runFlow(flow)
  }
}

/**
 * The same request, several times over.
 *
 * The only way to see a flaky test is to run it more than once: by definition
 * it passes some of the time, so a single green run says nothing. Same request,
 * same inputs, in sequence — any difference in outcome is the thing being
 * measured rather than a change in the test.
 */
async function repeatRequest(req, times = 10) {
  const results = []
  const body = el('div', { class: 'suite' })
  const ring = el('div', { class: 'ring' })
  const steps = el('div', { class: 'steps' })

  const paint = () => {
    const pct = results.length / times
    const failed = results.filter((r) => r.failed || r.error).length
    const C = 2 * Math.PI * 58
    ring.innerHTML = `<svg width="140" height="140" viewBox="0 0 140 140">
        <circle class="tr" cx="70" cy="70" r="58"></circle>
        <circle class="fl${failed ? ' bad' : ''}" cx="70" cy="70" r="58" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}"></circle>
      </svg><b>${Math.round(pct * 100)}%</b>`

    steps.replaceChildren()
    results.forEach((r, i) => {
      steps.append(
        el('div', { class: 'step' }, [
          el('span', { class: `state ${r.failed || r.error ? 'fail' : 'pass'}` }),
          el('span', { class: 'nm', text: `Run ${i + 1}` }),
          r.status ? el('span', { class: `code ${tone(r.status)}`, text: String(r.status) }) : null,
          el('span', { class: 'ms', text: r.error ? 'no answer' : `${r.timing?.total ?? 0}ms` })
        ])
      )
    })
    if (results.length === times) steps.append(repeatVerdictPanel(results))
    body.replaceChildren(ring, steps)
  }

  paint()
  sheet({
    title: `${req.name} × ${times}`,
    blurb: 'The same request, in sequence. A test that passes nine times out of ten is the expensive kind of broken.',
    body,
    acts: []
  })

  for (let i = 0; i < times; i += 1) {
    results.push(await sendOnce(req, envValues()))
    paint()
  }

  const v = repeatVerdict(results)
  toast(v.flaky ? 'bad' : 'ok', v.flaky ? `Flaky: ${v.failed} of ${v.runs} runs failed` : `${v.runs} runs, all the same`)
}

function repeatVerdictPanel(results) {
  const v = repeatVerdict(results)
  const box = el('div', { class: `find ${v.flaky ? 'bad' : 'ok'}` })
  box.append(el('div', { class: 'find-bar' }))

  const words = el('div')
  if (v.flaky) {
    words.append(el('b', { text: `Flaky — ${v.failed} of ${v.runs} runs failed` }))
    words.append(el('p', { text: `Same request, same inputs, ${v.statuses.length > 1 ? `statuses ${v.statuses.join(' and ')}` : 'and a different outcome'}. Something on the other side is not deterministic.` }))
  } else if (v.failed) {
    words.append(el('b', { text: `Failed every time` }))
    words.append(el('p', { text: 'Consistently broken is at least consistent: this is a real failure, not a flake.' }))
  } else {
    words.append(el('b', { text: `${v.runs} runs, all passed` }))
    words.append(el('p', { text: `Median ${v.median}ms, slowest ${v.slowest}ms.` }))
  }
  box.append(words)
  return box
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
/**
 * `back` is where Cancel returns to.
 *
 * A delete started from the tree has nothing behind it, so closing is the
 * whole answer. One started from a page does: cancelling out of the entire
 * Environments page because you thought better of deleting one environment
 * is a punishment for changing your mind.
 */
function askDelete({ kind, subject, goes, breaks, danger, onYes, back }) {
  const veil = $('veil')
  veil.replaceChildren()
  veil.hidden = false
  sheetUp = true
  onSheetClose = back ?? null

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
        onSheetClose = null
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
    { label: 'Environments', sub: 'variables', run: () => openEnvironments() },
    { label: 'History', sub: 'this session', run: openHistory },
    { label: 'Run the flow', sub: 'along the graph', run: () => runFlow() },
    { label: 'New collection', sub: 'empty', run: newCollection },
    { label: 'Tidy the plane', sub: 'lay out in order', run: tidy },
    { label: 'Paste a cURL command', sub: 'from a browser network tab', run: pasteCurl },
    { label: 'Save workspace', sub: 'write it back to its file', run: saveWorkspace },
    { label: 'Save workspace as', sub: 'write a new file to keep', run: saveWorkspaceAs },
    { label: 'Open a workspace', sub: 'a saved .prism file', run: openWorkspace },
    { label: 'Show the workspace file', sub: 'in the folder it was saved to', run: revealWorkspace },
    { label: 'Discard changes and reload', sub: 'back to the last saved copy', run: revertWorkspace },
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

/**
 * Dropping a file on the window imports it.
 *
 * The same front door as the Import button — readCollection decides what the
 * file is — so a format that imports one way imports the other. Several files
 * at once are read in order rather than refused, because exporting a
 * collection and its environment as two files is the normal case.
 */
function wireDrop() {
  const zone = $('dropzone')
  let depth = 0

  // dragenter/dragleave fire for every child element the pointer crosses, so
  // a plain hide-on-leave flickers the whole way across the window.
  document.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return
    depth += 1
    zone.hidden = false
  })
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (!depth) zone.hidden = true
  })
  document.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) e.preventDefault()
  })

  document.addEventListener('drop', async (e) => {
    depth = 0
    zone.hidden = true
    const files = [...(e.dataTransfer?.files ?? [])]
    if (!files.length) return
    // Chromium's default for a dropped file is to navigate the window to it,
    // which would replace the app with the file's contents.
    e.preventDefault()

    for (const file of files) {
      if (file.size > 64 * 1024 * 1024) {
        toast('bad', `${file.name} is larger than 64 MB.`)
        continue
      }
      applyImport(readCollection(await file.text(), file.name))
    }
  })
}

function wire() {
  wireDrop()
  $('winMin').onclick = () => window.prism.window.minimize()
  $('winMax').onclick = () => window.prism.window.maximize()
  $('winClose').onclick = async () => {
    // The autosave means nothing is lost either way, so this asks only about
    // the *file*: edits that are not in the .prism.json the user is keeping.
    if (!(await keepOrDiscard('Closing Prism'))) return
    // Flushed here, awaited, rather than relying on `beforeunload` — that
    // handler fires while the renderer is being torn down and its IPC is
    // fire-and-forget, so the last few seconds of typing were riding on a
    // race. This path is the one people actually use.
    clearTimeout(saveTimer)
    await autosave({ force: true })
    window.prism.window.close()
  }

  $('saveBtn').onclick = () => void saveWorkspace()
  $('saveMenuBtn').onclick = (e) => openMenu(e.currentTarget, saveMenu())
  $('importBtn').onclick = doImport
  $('emptyImport').onclick = doImport
  $('exportBtn').onclick = openExport
  $('runFlowBtn').onclick = () => runFlow()
  $('envPick').onclick = () => openEnvironments()
  $('envBtn').onclick = openEnvironments
  $('historyBtn').onclick = openHistory
  $('finder').onclick = openPalette
  $('settingsBtn').onclick = () => openSettings()
  $('helpBtn').onclick = () => openHelp()
  $('newCollectionBtn').onclick = newCollection
  $('treeFilter').oninput = (e) => {
    S.filter = e.target.value
    paintTree()
  }
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
  $('saveBody').onclick = () => {
    const req = current()
    const res = req ? S.results.get(req.id) : null
    if (!res || res.error) {
      toast('bad', 'There is no response to save yet.')
      return
    }
    saveBody(res, req)
  }
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
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (e.shiftKey) saveWorkspaceAs()
      else saveWorkspace()
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      pasteCurl()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      openWorkspace()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !sheetUp) {
      e.preventDefault()
      $('treeFilter').focus()
      $('treeFilter').select()
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

async function boot() {
  S.prefs = loadSettings(safeStorage())
  applyTheme()
  wire()
  wirePlane()

  // Whatever was open last time comes back. Only when there is nothing saved
  // does Prism fall back to the worked example — showing the demo over
  // somebody's actual work would be worse than showing nothing.
  const restored = await restoreWorkspace()
  if (!restored) applyImport(readCollection(JSON.stringify(demoWorkspace()), 'demo'))

  commit()
  booting = false
  // Restoring is not a change. `adopt` runs `commit`, which would otherwise
  // leave the app dirty on every start and rewrite an identical autosave.
  if (restored) S.dirty = false
  paintSaveState()

  // A last save on the way out, so the three-second debounce cannot lose the
  // final edit.
  window.addEventListener('beforeunload', () => {
    if (S.dirty) window.prism.workspace.autosave(JSON.stringify(serialise(S, { name: S.savedName })))
  })
}

boot()
