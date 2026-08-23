/**
 * The design system, checked rather than eyeballed.
 *
 * "Pixel perfect" is not a thing you can see your way to on a screen this
 * dense — a 0.5px drift or one radius off the scale is invisible in isolation
 * and obvious in aggregate. So the rules the stylesheet is supposed to follow
 * are written down here and enforced.
 *
 * Contrast is computed against the real token values in both themes, because
 * a colour that passes on graphite and fails on white is the single most
 * common way a light theme ships broken.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Carriage returns are stripped on the way in. Git rewrites this file to CRLF
// on checkout under Windows, and a rule that slices the file at a newline
// marker then silently matches nothing and passes without checking anything.
const CSS = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('')

/* ------------------------------------------------------------- utilities */

/** Every `--token: value` inside the first block matching a selector. */
function tokensIn(selector) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`)
  const m = re.exec(CSS)
  if (!m) return {}
  const out = {}
  for (const line of m[1].matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) out[line[1]] = line[2].trim()
  return out
}

const DARK = tokensIn(':root')
const LIGHT = tokensIn(":root\\[data-theme='light'\\]")

/** Resolves a token to rgb, following one level of var() indirection. */
function rgb(value, table) {
  let v = String(value).trim()
  const ref = /^var\((--[\w-]+)\)$/.exec(v)
  if (ref) v = String(table[ref[1]] ?? '').trim()

  let m = /^#([0-9a-f]{6})$/i.exec(v)
  if (m) {
    const n = parseInt(m[1], 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  m = /^#([0-9a-f]{3})$/i.exec(v)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16))
  m = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)/.exec(v)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

const channel = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/* --------------------------------------------------------------- contrast */

/**
 * Text that has to be read, and the surface it is read on.
 *
 * 4.5:1 is the WCAG bar for body text. The dimmest tier, `--ink-4`, is used
 * only for captions and units at a larger size, so it is held to 3:1 — the
 * large-text bar — and nothing smaller is allowed to use it.
 */
const READABLE = [
  ['--ink', '--s1', 4.5],
  ['--ink', '--s0', 4.5],
  ['--ink', '--s2', 4.5],
  ['--ink-2', '--s1', 4.5],
  ['--ink-2', '--s0', 4.5],
  ['--ink-3', '--s1', 4.5],
  ['--ink-3', '--s0', 4.5],
  ['--ink-4', '--s1', 3],
  ['--pass', '--s0', 4.5],
  ['--fail', '--s0', 4.5],
  ['--hold', '--s0', 4.5],
  ['--cyan', '--s0', 3],
  ['--indigo', '--s1', 3],
  ['--magenta', '--s1', 3],
  ['--on-sel', '--sel', 4.5]
]

for (const [theme, table] of [
  ['dark', DARK],
  ['light', LIGHT]
]) {
  for (const [ink, ground, bar] of READABLE) {
    test(`contrast — ${theme}: ${ink} on ${ground}`, () => {
      const a = rgb(table[ink], table)
      const b = rgb(table[ground], table)
      assert.ok(a, `${ink} is not defined in ${theme}`)
      assert.ok(b, `${ground} is not defined in ${theme}`)
      const ratio = contrast(a, b)
      assert.ok(ratio >= bar, `${ink} on ${ground} in ${theme} is ${ratio.toFixed(2)}:1, needs ${bar}:1`)
    })
  }
}

test('the two themes are genuinely different grounds', () => {
  // A light theme that is only slightly lighter is worse than none: it reads
  // as a rendering fault rather than a choice.
  const d = luminance(rgb(DARK['--s1'], DARK))
  const l = luminance(rgb(LIGHT['--s1'], LIGHT))
  assert.ok(l - d > 0.7, `panels are ${d.toFixed(2)} dark and ${l.toFixed(2)} light — not far enough apart`)
})

test('the raised surfaces move in one direction, in both themes', () => {
  // s1 is the panel and s2 through s4 sit on top of it. They must step
  // consistently, or a raised chip looks recessed at one level and nobody can
  // say why. s0 is deliberately excluded: it is the ground the panel sits on,
  // and in the light theme the panel is the *lighter* of the two — so
  // including it would demand a monotonic ramp that the design does not want.
  for (const [theme, table] of [
    ['dark', DARK],
    ['light', LIGHT]
  ]) {
    const ramp = ['--s1', '--s2', '--s3', '--s4'].map((t) => luminance(rgb(table[t], table)))
    const rising = ramp.every((v, i) => i === 0 || v >= ramp[i - 1])
    const falling = ramp.every((v, i) => i === 0 || v <= ramp[i - 1])
    assert.ok(rising || falling, `${theme} raised ramp wanders: ${ramp.map((v) => v.toFixed(3)).join(' ')}`)

    // The ground must be tellable from the panel *as a ratio*, not as a
    // difference in luminance: near black the numbers are tiny and a raw
    // subtraction says two clearly different greys are the same.
    //
    // 1.06:1 is the bar. For reference, GitHub's dark theme separates its
    // canvas from its panels at about 1.10:1 — that is roughly the ceiling
    // this end of the scale allows, so the bar sits just under it.
    const ground = rgb(table['--s0'], table)
    const panel = rgb(table['--s1'], table)
    const apart = contrast(ground, panel)
    assert.ok(apart >= 1.06, `${theme}: s0 and s1 are only ${apart.toFixed(3)}:1 apart, needs 1.06:1`)
  }
})

/* ------------------------------------------------------------ the scales */

test('every radius comes from the scale', () => {
  // One scale, or the corners of adjacent things disagree by a pixel and the
  // whole surface looks hand-assembled.
  const allowed = new Set(['0', '1px', '2px', '3px', '4px', '5px', '6px', '7px', '8px', '9px', '10px', '11px', '12px', '13px', '14px', '20px', '999px', '50%'])
  const bad = []
  for (const m of CSS.matchAll(/border-radius:\s*([^;]+);/g)) {
    for (const part of m[1].split(/\s+/)) {
      if (part.startsWith('var(') || part.startsWith('calc(')) continue
      if (!allowed.has(part)) bad.push(part)
    }
  }
  assert.deepEqual([...new Set(bad)], [], `radii off the scale: ${[...new Set(bad)].join(', ')}`)
})

test('nothing sets a font size below the legible floor', () => {
  const tiny = []
  for (const m of CSS.matchAll(/font-size:\s*([\d.]+)px/g)) {
    if (Number(m[1]) < 8.5) tiny.push(m[1])
  }
  assert.deepEqual([...new Set(tiny)], [], `font sizes under 8.5px: ${[...new Set(tiny)].join(', ')}`)
})

test('interactive controls are big enough to hit', () => {
  // 20px is the floor for a control in a dense row. Anything smaller is a
  // target people miss, and missing the one next to a delete button is a bad
  // day.
  const CONTROLS = new Set([
    'btn', 'pill', 'tab', 'segbtn', 'rowbtn', 'mini-btn', 'icobtn',
    'node-run', 'x-btn', 'tick', 'switch', 'lockbtn', 'chipbtn', 'addbtn'
  ])

  const short = []
  for (const m of CSS.matchAll(/\n(\.[\w-]+)\s*\{([^}]*)\}/g)) {
    const name = m[1].slice(1)
    if (!CONTROLS.has(name)) continue
    const h = /(?:^|;|\s)height:\s*(\d+)px/.exec(m[2])
    if (!h || Number(h[1]) >= 20) continue

    // A control may be smaller than the bar to *look* at, so long as it grows
    // its hit area to meet it. A checkbox is exactly that case: 16px reads
    // correctly in a dense row, and 16px is not a size people reliably hit.
    const grows = new RegExp('\\.' + name + '::before\\s*\\{[^}]*inset:\\s*-').test(CSS)
    if (!grows) short.push(name + ' is ' + h[1] + 'px with no enlarged hit area')
  }
  assert.deepEqual(short, [], short.join(', '))
})

/* ------------------------------------------------------------- the rules */

test('every colour in the body comes from a token', () => {
  // The rule that keeps the light theme honest. Anything literal below the
  // token blocks is a value that cannot change with the theme.
  const at = CSS.indexOf('* {\n  box-sizing')
  // Without this the slice below silently becomes nothing, and every rule
  // built on it passes for the wrong reason.
  assert.ok(at > 0, 'cannot find the start of the body — this rule would check nothing')
  const body = CSS.slice(at)
  const literals = [
    ...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
    // rgb() with real channel numbers, as opposed to rgb(var(--accent) / x)
    ...body.matchAll(/rgb\(\s*\d+\s+\d+\s+\d+/g)
  ].map((m) => m[0])

  // One exception, stated rather than hidden: white on the red close button,
  // which is white in both themes on purpose.
  const unexplained = literals.filter((l) => l !== '#fff')
  assert.deepEqual([...new Set(unexplained)], [], `literal colours in the body: ${[...new Set(unexplained)].join(', ')}`)
})

test('focus is always visible', () => {
  assert.match(CSS, /:focus-visible\s*\{[^}]*outline:/)

  /**
   * Fields whose focus ring is drawn by the container around them.
   *
   * The pattern is deliberate — one ring around the whole address bar reads
   * better than three inside it — but every case is named here, so the list
   * is auditable rather than a blanket excuse.
   */
  const RINGED_BY_PARENT = {
    '.addr-url:focus': '.addr:focus-within',
    '.editor textarea:focus': '.editor',
    '.pal input:focus': '.pal',
    '.bench-grip:focus-visible': '.bench-grip:focus-visible span',
    '.tree-filter input:focus': '.tree-filter:focus-within',
    '.find-field:focus': '.find-bar-row:focus-within'
  }

  for (const m of CSS.matchAll(/([^\n{}]+)\{([^}]*outline:\s*(?:none|0)\b[^}]*)\}/g)) {
    const selector = m[1].trim()
    const parent = RINGED_BY_PARENT[selector]
    if (parent) {
      assert.ok(CSS.includes(parent), `${selector} defers its ring to ${parent}, which is not in the stylesheet`)
      continue
    }
    assert.match(m[2], /(box-shadow|border-color)/, `${selector} removes the outline without replacing it`)
  }
})

test('motion is switched off for anyone who asks', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/)
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(CSS)
  assert.match(block[1], /animation-duration:\s*0\.01ms\s*!important/)
  assert.match(block[1], /transition-duration:\s*0\.01ms\s*!important/)
})

test('the confirm shows the thing and names the damage', () => {
  // The two claims the delete dialog makes over a generic "are you sure".
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8')
  assert.match(app, /function subjectCard/)
  assert.match(app, /function dependants/)
  assert.match(CSS, /\.ask-subject\b/)
  assert.match(CSS, /\.ask-warn\b/)
})

test('every class the app applies is styled somewhere', () => {
  /**
   * The check that would have caught two real regressions.
   *
   * Deleting a block of CSS to rewrite it takes any *other* rule that happened
   * to live inside it. Both times the result was invisible in the diff and
   * obvious on screen — once the row buttons, once every method badge in the
   * tree and on every node. Nothing in the language complains: the class is
   * still applied, it simply means nothing any more.
   */
  const APP = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8')
  const HTML = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8')

  const used = new Set()
  const add = (c) => {
    if (/^[a-z][\w-]*$/.test(c)) used.add(c)
  }

  // Everything is read out of a `class:` expression and nowhere else. A
  // ternary picking a literal appears all over the file for other properties
  // — `type: secret ? 'password' : 'text'` among them — so scanning the whole
  // source for quoted words finds a great many things that are not classes.
  for (const m of APP.matchAll(/class:\s*(`[^`]*`|'[^']*')/g)) {
    const raw = m[1]
    // The words written directly, outside any interpolation.
    for (const c of raw.replace(/\$\{[^}]*\}/g, ' ').replace(/[`']/g, ' ').split(/\s+/)) add(c)
    // And, inside an interpolation, the literals in the *result* position of
    // a ternary. A literal on the left of a comparison — `scope === 'request'`
    // — is a value being tested, not a class being applied.
    for (const hole of raw.matchAll(/\$\{[^}]*\}/g)) {
      for (const lit of hole[0].matchAll(/[?:]\s*'\s*([a-z][\w-]*)\s*'/g)) add(lit[1])
    }
  }
  for (const source of [APP, HTML]) {
    for (const m of source.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) add(c)
    }
  }

  // Words that are a class name somewhere and a value elsewhere.
  const NOT_CLASSES = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

  const missing = [...used]
    .filter((c) => !NOT_CLASSES.has(c))
    .filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(CSS))
    .sort()

  assert.deepEqual(missing, [], `applied but never styled: ${missing.join(', ')}`)
})

test('every var() names a token that exists', () => {
  // A var() pointing at nothing is not an error in CSS — the declaration is
  // simply dropped, so a border vanishes or a colour falls back to inherited
  // and the page still renders. Four dead references shipped before this rule
  // existed.
  const defined = new Set()
  for (const m of CSS.matchAll(/^\s*(--[\w-]+)\s*:/gm)) defined.add(m[1])
  // A few are set from the renderer as an inline style — the line number on a
  // source row is one — so the stylesheet alone is not the whole picture.
  const FROM_JS = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8')
  for (const m of FROM_JS.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])

  const used = new Set()
  for (const m of CSS.matchAll(/var\(\s*(--[\w-]+)/g)) used.add(m[1])

  const dangling = [...used].filter((name) => !defined.has(name))
  assert.deepEqual(dangling, [], `var() with no token behind it: ${dangling.join(', ')}`)
})

test('every theme state tells the browser which one it is', () => {
  /**
   * `color-scheme` is the only thing native controls listen to.
   *
   * A <select>'s open list, the scrollbars and the text caret are drawn by the
   * browser, not by this stylesheet, and they take their colours from this
   * property alone. The dark theme shipped without it and opened a white
   * dropdown over a black app — the tokens had no say in it.
   */
  const block = (selector) => {
    const at = CSS.indexOf(selector)
    assert.ok(at >= 0, `cannot find ${selector}`)
    return CSS.slice(at, CSS.indexOf('\n}', at))
  }

  const states = [
    // The bare :root carries the dark palette, so it declares dark.
    [':root {', 'dark'],
    // Explicit choices, which must win in both directions.
    [":root[data-theme='dark'] {", 'dark'],
    [":root[data-theme='light'] {", 'light'],
    // And the system-light case, where no attribute is stamped at all.
    [":root:not([data-theme='dark']) {", 'light']
  ]

  for (const [selector, want] of states) {
    const text = block(selector)
    const found = /color-scheme:\s*(\w+)/.exec(text)
    assert.ok(found, `${selector} never says which color-scheme it is`)
    assert.equal(found[1], want, `${selector} declares color-scheme: ${found[1]}`)
  }
})

test('no rule targets a data-theme the app never sets', () => {
  // themeAttribute() returns 'dark', 'light' or nothing, so a :root rule for
  // any other value matches nothing and quietly does nothing — which is how
  // half the color-scheme handling went missing.
  const roots = [...CSS.matchAll(/:root\[data-theme='([^']+)'\]/g)].map((m) => m[1])
  assert.deepEqual([...new Set(roots)].sort(), ['dark', 'light'])
})
