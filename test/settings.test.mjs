/**
 * Preferences.
 *
 * Two things are worth testing here and they are not the obvious ones. The
 * first is that a saved blob from an older or hostile version cannot put the
 * app into a state it cannot render — settings are the only thing that
 * survives an upgrade, so they will eventually be older than the code reading
 * them. The second is the claim the settings page makes on screen: that every
 * switch is wired to something. That claim is checkable, so it is checked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SETTINGS, GROUPS, defaults, load, save, clear, themeAttribute } from '../lib/settings.js'

/** A localStorage that behaves, for the happy path. */
function store(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
    _map: map
  }
}

/* ------------------------------------------------------------- the shape */

test('every setting is fully described', () => {
  for (const s of SETTINGS) {
    assert.ok(s.id, 'missing id')
    assert.ok(GROUPS.includes(s.group), `${s.id} is in an unknown group ${s.group}`)
    assert.ok(s.label.length > 2, `${s.id} has no label`)
    // The help text is what the page shows instead of the id, so it has to
    // say what changes rather than repeat the label.
    assert.ok(s.help.length > 25, `${s.id} has help too short to explain anything`)
    assert.ok(s.value !== undefined, `${s.id} has no default`)
    assert.ok(['choice', 'toggle', 'number'].includes(s.kind), `${s.id} has kind ${s.kind}`)
  }
})

test('no two settings share an id', () => {
  const ids = SETTINGS.map((s) => s.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('a number setting has a range its default sits inside', () => {
  for (const s of SETTINGS.filter((x) => x.kind === 'number')) {
    assert.ok(typeof s.min === 'number' && typeof s.max === 'number', `${s.id} has no range`)
    assert.ok(s.value >= s.min && s.value <= s.max, `${s.id} defaults outside its own range`)
  }
})

test('a choice setting defaults to one of its options', () => {
  for (const s of SETTINGS.filter((x) => x.kind === 'choice')) {
    assert.ok(s.options?.some((o) => o.id === s.value), `${s.id} defaults to something not offered`)
  }
})

/* ------------------------------------------------- the claim on the page */

test('every setting names a place it is read, and that place exists', () => {
  // The page prints `wiredIn` beside each switch, which is a promise to the
  // user that the switch does something. This checks the promise: the named
  // function has to be findable in the source that is supposed to read it.
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../main.cjs', import.meta.url), 'utf8')

  for (const s of SETTINGS) {
    assert.ok(s.wiredIn, `${s.id} claims no home`)
    const inMain = s.wiredIn.startsWith('main.cjs')
    const name = s.wiredIn.replace('main.cjs ', '').replace('()', '')
    const source = inMain ? main : app
    assert.ok(source.includes(name), `${s.id} says it is read in ${s.wiredIn}, which is not there`)
    // And the id itself must appear where it is read.
    assert.ok(
      source.includes(s.id) || main.includes(s.id),
      `${s.id} is never mentioned in the code that claims to read it`
    )
  }
})

/* ---------------------------------------------------------- loading back */

test('an empty store gives the defaults', () => {
  assert.deepEqual(load(store()), defaults())
})

test('saved values come back', () => {
  const s = store()
  save(s, { ...defaults(), theme: 'light', timeoutMs: 5000, verifyTls: false })
  const back = load(s)
  assert.equal(back.theme, 'light')
  assert.equal(back.timeoutMs, 5000)
  assert.equal(back.verifyTls, false)
})

test('a value of the wrong type is dropped, not trusted', () => {
  // The blob outlives the code. A string where a boolean belongs must fall
  // back to the default rather than turn a safety switch into something truthy.
  const s = store({ 'prism.settings.v1': JSON.stringify({ verifyTls: 'no', timeoutMs: 'soon', theme: 42 }) })
  const back = load(s)
  assert.equal(back.verifyTls, true, 'a junk value disabled certificate checking')
  assert.equal(back.timeoutMs, defaults().timeoutMs)
  assert.equal(back.theme, defaults().theme)
})

test('a number outside its range is clamped, not accepted', () => {
  const s = store({ 'prism.settings.v1': JSON.stringify({ timeoutMs: 99999999, maxBodyMb: -5 }) })
  const back = load(s)
  const timeout = SETTINGS.find((x) => x.id === 'timeoutMs')
  const body = SETTINGS.find((x) => x.id === 'maxBodyMb')
  assert.equal(back.timeoutMs, timeout.max)
  assert.equal(back.maxBodyMb, body.min)
})

test('a choice that is not on offer falls back', () => {
  const s = store({ 'prism.settings.v1': JSON.stringify({ theme: 'sepia' }) })
  assert.equal(load(s).theme, defaults().theme)
})

test('unknown keys are ignored rather than carried', () => {
  const s = store({ 'prism.settings.v1': JSON.stringify({ nonsense: true, theme: 'dark' }) })
  const back = load(s)
  assert.equal(back.nonsense, undefined)
  assert.equal(back.theme, 'dark')
})

test('a corrupt blob does not throw', () => {
  for (const junk of ['{oops', '[]', 'null', '"a string"', '5']) {
    const s = store({ 'prism.settings.v1': junk })
    assert.doesNotThrow(() => load(s))
    assert.equal(load(s).theme, defaults().theme)
  }
})

test('no storage at all does not throw', () => {
  // A private window, or a browser told to block site data. The app should run
  // and simply not remember.
  assert.doesNotThrow(() => load(null))
  assert.deepEqual(load(null), defaults())
  assert.equal(save(null, defaults()), false)
  assert.doesNotThrow(() => clear(null))
})

test('storage that throws on write does not take the app down', () => {
  const angry = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {}
  }
  assert.equal(save(angry, defaults()), false)
})

/* ------------------------------------------------------------- the theme */

test('an explicit choice stamps the attribute, and system stamps nothing', () => {
  // 'system' must set no attribute at all: that is what leaves the
  // prefers-color-scheme block in charge, and stamping anything there would
  // freeze the app to whatever the machine was on at boot.
  assert.equal(themeAttribute('dark'), 'dark')
  assert.equal(themeAttribute('light'), 'light')
  assert.equal(themeAttribute('system'), null)
  assert.equal(themeAttribute(undefined), null)
})

/* ------------------------------------------------------- the light theme */

test('every colour token has a light value', () => {
  // A token defined only in the dark block renders one theme's text on the
  // other theme's ground — the classic unreadable-in-light bug.
  const css = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8')
  const block = (re) => {
    const m = re.exec(css)
    return m ? new Set([...m[1].matchAll(/^\s*(--[\w-]+):/gm)].map((x) => x[1])) : new Set()
  }
  const dark = block(/:root \{([\s\S]*?)\n\}/)
  const light = block(/:root\[data-theme='light'\] \{([\s\S]*?)\n\}/)

  // Sizes, fonts and timings are the same in both; only colours must differ.
  const colourish = /(void|s\d|edge|lift|ink|cyan|indigo|magenta|beam|pass|fail|hold|sel|verb|sx)/
  const missing = [...dark].filter((t) => colourish.test(t) && !light.has(t))
  assert.deepEqual(missing, [], `no light value for: ${missing.join(', ')}`)
})

test('the light theme is reachable both by choice and by system preference', () => {
  const css = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8')
  assert.match(css, /@media \(prefers-color-scheme: light\)/)
  // Guarded, so an explicit dark choice still beats a light machine.
  assert.match(css, /:root:not\(\[data-theme='dark'\]\)/)
  assert.match(css, /:root\[data-theme='light'\]/)
})

test('no colour is left hardcoded in the markup or the script', () => {
  // Inline SVG inherits custom properties, so the spectrum in the logo and on
  // the beams has to come from the theme rather than being frozen dark.
  for (const file of ['../renderer/app.js', '../renderer/index.html']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    const found = text.match(/#[0-9a-fA-F]{6}\b/g) ?? []
    assert.deepEqual(found, [], `${file} still has literal colours: ${found.join(', ')}`)
  }
})
