/**
 * Preferences.
 *
 * ONE RULE: every setting in here changes what the app actually does. A
 * settings page full of switches that are read nowhere is worse than no
 * settings page — it teaches people the app is lying to them. If a switch is
 * added below it is wired at the same time, and `WIRED_IN` names the place, so
 * a reviewer can check the claim rather than take it.
 *
 * Preferences persist; data does not. What is on the plane and what is in an
 * environment belong to the session, but how the app looks and how it sends
 * should survive a restart.
 */

export const THEMES = [
  { id: 'system', label: 'Follow the system' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

/**
 * @typedef {object} Setting
 * @property {string} id
 * @property {'choice'|'toggle'|'number'} kind
 * @property {string} group
 * @property {string} label
 * @property {string} help      what it changes, in the user's terms
 * @property {*} value          the default
 * @property {string} wiredIn   the function that reads it — checkable
 */

/** @type {Setting[]} */
export const SETTINGS = [
  {
    id: 'theme',
    kind: 'choice',
    group: 'Appearance',
    label: 'Theme',
    help: 'Following the system switches with it while Prism is open.',
    value: 'system',
    options: THEMES,
    wiredIn: 'applyTheme'
  },
  {
    id: 'beamLabels',
    kind: 'toggle',
    group: 'Appearance',
    label: 'Name the beams',
    help: 'Write the variable on the line between two nodes. Turn it off on a crowded plane.',
    value: true,
    wiredIn: 'drawBeams'
  },
  {
    id: 'showPorts',
    kind: 'toggle',
    group: 'Appearance',
    label: 'Show ports on nodes',
    help: 'The needs and gives rows. Off makes every node the same small size.',
    value: true,
    wiredIn: 'nodeFor'
  },

  {
    id: 'timeoutMs',
    kind: 'number',
    group: 'Sending',
    label: 'Timeout',
    help: 'How long to wait for a response before giving up.',
    value: 30000,
    min: 1000,
    max: 600000,
    unit: 'ms',
    wiredIn: 'send'
  },
  {
    id: 'followRedirects',
    kind: 'toggle',
    group: 'Sending',
    label: 'Follow redirects',
    help: 'Follow 301, 302, 303, 307 and 308 up to five times. Off shows you the redirect itself.',
    value: true,
    wiredIn: 'main.cjs request()'
  },
  {
    id: 'verifyTls',
    kind: 'toggle',
    group: 'Sending',
    label: 'Verify TLS certificates',
    help: 'Turn off only for a development server with a self-signed certificate. Anything sent with this off can be read by whatever is in the middle.',
    value: true,
    danger: true,
    wiredIn: 'main.cjs request()'
  },
  {
    id: 'proxy',
    kind: 'text',
    group: 'Network',
    label: 'HTTP proxy',
    help: 'Every request goes through this instead of straight out. Corporate networks usually require one; leave it empty otherwise. http://user:pass@host:port is understood.',
    value: '',
    placeholder: 'http://proxy.company.test:8080',
    wiredIn: 'main.cjs request()'
  },
  {
    id: 'clientCert',
    kind: 'text',
    group: 'Network',
    label: 'Client certificate',
    help: 'A PEM certificate to identify Prism to servers that demand mutual TLS. The file is read at send time, so replacing it takes effect on the next request.',
    value: '',
    placeholder: 'C:\\certs\\client.pem',
    wiredIn: 'certSettings()'
  },
  {
    id: 'clientKey',
    kind: 'text',
    group: 'Network',
    label: 'Client key',
    help: 'The private key that goes with that certificate.',
    value: '',
    placeholder: 'C:\\certs\\client.key',
    wiredIn: 'certSettings()'
  },
  {
    id: 'clientPfx',
    kind: 'text',
    group: 'Network',
    label: 'PKCS#12 bundle',
    help: 'A .pfx or .p12 holding both, for when they were issued together. Use this instead of the two fields above.',
    value: '',
    placeholder: 'C:\\certs\\client.pfx',
    wiredIn: 'certSettings()'
  },
  {
    id: 'certPassphrase',
    kind: 'secret',
    group: 'Network',
    label: 'Key passphrase',
    help: 'If the key or the bundle is encrypted. Held for this session only and never written to disk.',
    value: '',
    wiredIn: 'certSettings()'
  },
  {
    id: 'caBundle',
    kind: 'text',
    group: 'Network',
    label: 'Extra certificate authority',
    help: 'A PEM bundle to trust in addition to the system store — an internal CA, usually. Better than turning verification off, because it still checks.',
    value: '',
    placeholder: 'C:\\certs\\internal-ca.pem',
    wiredIn: 'certSettings()'
  },
  {
    id: 'maxBodyMb',
    kind: 'number',
    group: 'Sending',
    label: 'Keep at most',
    help: 'Response bodies larger than this are truncated for display. Assertions still run against everything that arrived.',
    value: 4,
    min: 1,
    max: 64,
    unit: 'MB',
    wiredIn: 'main.cjs request()'
  },

  {
    id: 'useCookies',
    kind: 'toggle',
    group: 'Sending',
    label: 'Keep cookies',
    help: 'Remember Set-Cookie and send it back on later requests to the same host. Session-based APIs cannot be chained without it. The jar is held in memory and never written to disk.',
    value: true,
    wiredIn: 'sendOnce'
  },

  {
    id: 'confirmProduction',
    kind: 'toggle',
    group: 'Safety',
    label: 'Ask before sending to production',
    help: 'When the chosen environment is named like production, confirm each send. Prism never blocks it — a suite that will not touch production is not much of a suite.',
    value: true,
    wiredIn: 'send'
  },
  {
    id: 'maskCredentials',
    kind: 'toggle',
    group: 'Safety',
    label: 'Mask credentials in the inspector',
    help: 'Hide the value of Authorization, cookie and API-key headers in the panel. Turn this off only when you are not sharing your screen.',
    value: true,
    danger: true,
    wiredIn: 'headersPanel'
  },

  {
    id: 'autosave',
    kind: 'toggle',
    group: 'Data',
    label: 'Remember my work',
    help: 'Write collections, environments and baselines to this machine so they come back next time. Secret values are never written.',
    value: true,
    wiredIn: 'autosave'
  },
  {
    id: 'historyLimit',
    kind: 'number',
    group: 'Data',
    label: 'Keep the last',
    help: 'Runs held in this session. History is never written to disk.',
    value: 80,
    min: 10,
    max: 500,
    unit: 'runs',
    wiredIn: 'remember'
  }
]

export const GROUPS = ['Appearance', 'Sending', 'Network', 'Safety', 'Data']

const KEY = 'prism.settings.v1'

export function defaults() {
  const out = {}
  for (const s of SETTINGS) out[s.id] = s.value
  return out
}

/**
 * Reads what was saved, over the defaults.
 *
 * Anything unrecognised or of the wrong type is dropped rather than trusted: a
 * settings blob is the one piece of state that survives an upgrade, so it will
 * eventually be older than the code reading it.
 */
export function load(storage) {
  const out = defaults()
  let saved
  try {
    saved = JSON.parse(storage?.getItem(KEY) ?? 'null')
  } catch {
    return out
  }
  if (!saved || typeof saved !== 'object') return out

  for (const s of SETTINGS) {
    const v = saved[s.id]
    if (v === undefined) continue
    if (s.kind === 'toggle' && typeof v === 'boolean') out[s.id] = v
    else if (s.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) {
      out[s.id] = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, v))
    } else if (s.kind === 'choice' && (s.options ?? []).some((o) => o.id === v)) out[s.id] = v
  }
  return out
}

export function save(storage, values) {
  // Not optional-chained: `storage?.setItem()` on null succeeds silently and
  // the caller is told the settings were saved when nothing was written.
  if (!storage) return false
  try {
    storage.setItem(KEY, JSON.stringify(values))
    return true
  } catch {
    // A private window, or storage the browser refuses. The app carries on
    // with the values it has; it just will not remember them next time.
    return false
  }
}

export function clear(storage) {
  try {
    storage?.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

/** The `data-theme` attribute for a choice. 'system' sets nothing. */
export function themeAttribute(choice) {
  return choice === 'dark' || choice === 'light' ? choice : null
}
