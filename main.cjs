/**
 * Rebind Prism — main process.
 *
 * Three jobs and no more: own the window, send HTTP requests the renderer is
 * not allowed to send itself, and read or write files the user picks.
 *
 * The renderer runs sandboxed with no Node access, so every capability it has
 * is one of the handlers below. That is the whole security model: if it is not
 * in this file, the page cannot do it.
 */
const { app, BrowserWindow, dialog, ipcMain, protocol, net, shell } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } = require('node:fs')
// Electron already exports a `net`; this is the socket one.
const sockets = require('node:net')
const tls = require('node:tls')
const { join, extname, basename } = require('node:path')
const { pathToFileURL } = require('node:url')
const http = require('node:http')
const https = require('node:https')

// The whole app directory, not just renderer/: the page imports ../lib/*,
// which resolves above the HTML and would otherwise 404 with no error the
// renderer can report.
const ROOT = __dirname

/**
 * Served over a real origin rather than file://.
 *
 * ES modules are blocked over file:// by the same-origin rules, and the whole
 * renderer is written as modules. A custom scheme also gives the page a stable
 * origin, so storage behaves.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'prism', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

/** @type {BrowserWindow | null} */
let win = null

/**
 * The cookie jar, and where the workspace lives.
 *
 * lib/ is ESM and this file is CommonJS, so the jar is pulled in with a
 * dynamic import once at startup rather than at the top.
 */
let jar = null
const jarReady = import('./lib/cookies.js').then((m) => {
  jar = new m.Jar()
})

function createWindow() {
  win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#08090C',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win?.show())
  win.loadURL('prism://app/renderer/index.html')

  if (process.argv.includes('--devtools')) win.webContents.openDevTools({ mode: 'detach' })

  const push = () => win?.webContents.send('window:state', { maximized: win?.isMaximized() ?? false })
  win.on('maximize', push)
  win.on('unmaximize', push)
  win.on('closed', () => {
    win = null
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

/**
 * Where the working state is kept between sessions.
 *
 * One file, written atomically — a workspace half-written because the machine
 * lost power is worse than one a session out of date, so the new copy is
 * written beside the old and moved over it only once it is complete.
 */
const stateDir = () => join(app.getPath('userData'), 'state')
const autosavePath = () => join(stateDir(), 'workspace.json')

function writeAtomic(path, text) {
  mkdirSync(join(path, '..'), { recursive: true })
  const tmp = `${path}.writing`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

app.whenReady().then(() => {
  protocol.handle('prism', (request) => {
    const path = new URL(request.url).pathname
    // Resolved inside the renderer directory and checked afterwards, so a
    // crafted `..` cannot walk out of it.
    const file = join(ROOT, decodeURIComponent(path))
    if (!file.startsWith(ROOT)) return new Response('Denied', { status: 403 })
    try {
      return new Response(readFileSync(file), {
        headers: {
          'content-type': MIME[extname(file)] ?? 'application/octet-stream',
          // Read from disk every time. Without this Chromium caches the
          // modules and a reload quietly serves the previous build — which
          // looks exactly like a change that did not work.
          'cache-control': 'no-store'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ------------------------------------------------------------------ window */

ipcMain.handle('window:minimize', () => win?.minimize())
ipcMain.handle('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()))
ipcMain.handle('window:close', () => win?.close())
ipcMain.handle('window:isMaximized', () => win?.isMaximized() ?? false)

/* -------------------------------------------------------------------- files */

ipcMain.handle('file:open', async (_e, filters) => {
  if (!win) return null
  const res = await dialog.showOpenDialog(win, {
    title: 'Import',
    properties: ['openFile'],
    filters: filters ?? [{ name: 'Collections', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePaths[0]) return null
  const path = res.filePaths[0]
  // Read as text and handed over as text: parsing is the renderer's problem,
  // and a malformed file should surface as a readable error there rather than
  // as an exception in the process that owns the window.
  return { path, name: basename(path), text: readFileSync(path, 'utf8') }
})

ipcMain.handle('file:save', async (_e, { name, text, filters }) => {
  if (!win) return null
  const res = await dialog.showSaveDialog(win, { title: 'Export', defaultPath: name, filters })
  if (res.canceled || !res.filePath) return null
  writeFileSync(res.filePath, text, 'utf8')
  return res.filePath
})

/**
 * Writing a response body out.
 *
 * Bytes, not text: a PDF or a zip that came back from an export endpoint is
 * exactly the thing worth saving, and re-encoding it as UTF-8 on the way would
 * quietly corrupt it.
 */
ipcMain.handle('file:saveBytes', async (_e, { name, base64: data, filters }) => {
  const chosen = await dialog.showSaveDialog(win, { defaultPath: name, filters: filters ?? [{ name: 'All files', extensions: ['*'] }] })
  if (chosen.canceled || !chosen.filePath) return null
  try {
    writeFileSync(chosen.filePath, Buffer.from(String(data ?? ''), 'base64'))
    return chosen.filePath
  } catch (err) {
    return { error: err.message }
  }
})

ipcMain.handle('shell:open', (_e, url) => {
  // Only ever a documentation link the page already displays.
  if (/^https?:\/\//i.test(String(url))) return shell.openExternal(String(url))
  return null
})

/* ---------------------------------------------------------------- workspace */

ipcMain.handle('workspace:autosave', (_e, text) => {
  try {
    writeAtomic(autosavePath(), String(text))
    return { ok: true }
  } catch (err) {
    // Saving is best-effort. A full disk must not take the window down, and
    // the renderer shows what happened rather than failing silently.
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('workspace:restore', () => {
  try {
    const path = autosavePath()
    if (!existsSync(path)) return null
    return { path, text: readFileSync(path, 'utf8') }
  } catch {
    return null
  }
})

// Deleted, not blanked. Settings offers this as "Forget", and leaving a
// zero-byte file behind would have the row still reporting a saved workspace.
ipcMain.handle('workspace:forget', () => {
  try {
    if (existsSync(autosavePath())) rmSync(autosavePath())
    return true
  } catch {
    return false
  }
})

ipcMain.handle('workspace:saveAs', async (_e, { name, text }) => {
  if (!win) return null
  const res = await dialog.showSaveDialog(win, {
    title: 'Save workspace',
    defaultPath: join(app.getPath('documents'), `${name || 'workspace'}.prism.json`),
    filters: [{ name: 'Prism workspace', extensions: ['json'] }]
  })
  if (res.canceled || !res.filePath) return null
  writeAtomic(res.filePath, String(text))
  return res.filePath
})

/* ------------------------------------------------------------------ cookies */

ipcMain.handle('cookies:list', async () => {
  await jarReady
  return jar.all()
})

ipcMain.handle('cookies:clear', async () => {
  await jarReady
  return jar.clear()
})

ipcMain.handle('cookies:remove', async (_e, { name, domain, path }) => {
  await jarReady
  return jar.remove(name, domain, path)
})

/* -------------------------------------------------------------- proxy & TLS */

/**
 * A tunnel through an HTTP proxy.
 *
 * Node has no proxy support of its own, and the usual answer — swap in a
 * third-party agent — would mean giving up the socket events the waterfall is
 * built from. So the tunnel is opened by hand: CONNECT for https, which is
 * what a proxy expects for a connection it must not read, and an absolute-URL
 * request for plain http, which is what a proxy expects for one it may.
 */
function proxyTunnel(proxy, target) {
  return new Promise((resolve, reject) => {
    let via
    try {
      via = new URL(proxy)
    } catch {
      reject(new Error(`${proxy} is not a proxy URL Prism can read.`))
      return
    }

    const headers = { Host: `${target.hostname}:${port(target)}` }
    if (via.username) {
      const pair = `${decodeURIComponent(via.username)}:${decodeURIComponent(via.password || '')}`
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(pair).toString('base64')}`
    }

    const call = http.request({
      host: via.hostname,
      port: Number(via.port) || 8080,
      method: 'CONNECT',
      path: `${target.hostname}:${port(target)}`,
      headers
    })

    call.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        // The proxy's own refusal, said plainly: a 407 here is a password
        // problem and nothing to do with the server being tested.
        reject(new Error(`The proxy refused the tunnel with ${res.statusCode} ${res.statusMessage || ''}`.trim()))
        return
      }
      resolve(socket)
    })
    call.on('error', (err) => reject(new Error(`Cannot reach the proxy: ${err.message}`)))
    call.end()
  })
}

const port = (url) => Number(url.port) || (url.protocol === 'https:' ? 443 : 80)

/**
 * A client certificate, read from disk at send time.
 *
 * Read each time rather than cached: a certificate that has been rotated
 * should take effect on the next send, not the next restart. The passphrase
 * is passed through and never written anywhere.
 */
function clientIdentity(spec) {
  const out = {}
  const load = (path) => {
    if (!path) return undefined
    try {
      return readFileSync(path)
    } catch (err) {
      throw new Error(`Cannot read ${path} — ${err.message}`)
    }
  }

  if (spec.pfxPath) out.pfx = load(spec.pfxPath)
  if (spec.certPath) out.cert = load(spec.certPath)
  if (spec.keyPath) out.key = load(spec.keyPath)
  if (spec.caPath) out.ca = load(spec.caPath)
  if (spec.passphrase) out.passphrase = spec.passphrase
  return out
}

/* --------------------------------------------------------------------- http */


/**
 * One request, with the phase timings the waterfall draws.
 *
 * Node's own socket events are the only honest source for these: anything
 * measured in the renderer would be one number with a guess split across it.
 * `lookup`, `connect` and `secureConnect` fire in order on the socket, and the
 * gap between the last of them and the first byte of the response is the wait.
 */
function request(spec, redirectsLeft) {
  const maxBody = Math.max(1, Math.min(64, Number(spec.maxBodyMb) || 4)) * 1024 * 1024
  const hops = redirectsLeft === undefined ? (spec.followRedirects === false ? 0 : 5) : redirectsLeft

  return new Promise((resolve) => {
    let url
    try {
      url = new URL(spec.url)
    } catch {
      resolve({ error: `That is not a URL Prism can send to: ${spec.url}` })
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      resolve({ error: `Only http and https are supported, not ${url.protocol}` })
      return
    }

    const t = { start: Date.now(), dns: 0, tcp: 0, tls: 0, sent: 0, first: 0, end: 0 }
    const mark = () => Date.now() - t.start
    const driver = url.protocol === 'https:' ? https : http

    // The jar rides along unless the request already sets a cookie by hand,
    // in which case the hand-written one wins — it was written deliberately.
    const headers = { ...(spec.headers || {}) }
    if (spec.useCookies !== false && jar) {
      const has = Object.keys(headers).some((k) => k.toLowerCase() === 'cookie')
      const line = jar.header(url.toString())
      if (!has && line) headers.Cookie = line
    }

    let identity
    try {
      identity = clientIdentity(spec)
    } catch (err) {
      resolve({ error: err.message })
      return
    }

    const options = {
      method: spec.method || 'GET',
      headers,
      timeout: spec.timeoutMs || 30000,
      // Off only for a development server with a self-signed certificate,
      // and the setting that turns it off says what that costs.
      rejectUnauthorized: spec.verifyTls !== false,
      ...identity
    }

    // Through a proxy, the socket is opened first and handed to the request.
    // For plain http that is the proxy's own socket with an absolute URL;
    // for https it is the far end of a CONNECT tunnel, so TLS is negotiated
    // with the real server and the proxy never sees inside.
    if (spec.proxy && url.protocol === 'http:') {
      options.host = null
      options.socketPath = undefined
      options.createConnection = () => {
        const via = new URL(spec.proxy)
        return sockets.connect({ host: via.hostname, port: Number(via.port) || 8080 })
      }
      options.path = url.toString()
    }
    if (spec.proxy && url.protocol === 'https:') {
      options.createConnection = (opts, done) => {
        const socket = new sockets.Socket()
        proxyTunnel(spec.proxy, url)
          .then((tunnel) => {
            const secure = tls.connect({ socket: tunnel, servername: url.hostname, rejectUnauthorized: spec.verifyTls !== false, ...identity })
            secure.on('secureConnect', () => {
              /* the timing hooks below see this too */
            })
            done(null, secure)
          })
          .catch((err) => done(err))
        return socket
      }
    }

    const req = driver.request(
      url,
      options,
      (res) => {
        t.first = mark()

        // A redirect is followed by re-sending. The phase timings then belong
        // to the request that actually answered, which is the honest reading;
        // the hop count is what stops a loop.
        const to = res.headers.location
        if (hops > 0 && to && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume()
          let next = null
          try {
            next = new URL(to, url).toString()
          } catch {
            next = null
          }
          if (next) {
            // 303, and 301/302 on a POST, become a GET with no body — what
            // every client does and what servers expect.
            const drop = res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && spec.method === 'POST')
            const hop = { ...spec, url: next, method: drop ? 'GET' : spec.method, body: drop ? undefined : spec.body }
            request(hop, hops - 1).then((out) =>
              resolve({ ...out, redirects: (out.redirects ?? 0) + 1, redirectedFrom: spec.url })
            )
            return
          }
        }

        const chunks = []
        let bytes = 0
        let truncated = false
        res.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes <= maxBody) chunks.push(chunk)
          else truncated = true
        })
        res.on('end', () => {
          t.end = mark()
          const kept = spec.useCookies !== false && jar ? jar.store(res.headers, url.toString()) : 0
          resolve({
            cookiesStored: kept,
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? '',
            headers: flatten(res.headers),
            body: Buffer.concat(chunks).toString('utf8'),
            truncated,
            bytes,
            secure: url.protocol === 'https:',
            sentHeaders: headers,
            timing: {
              dns: t.dns,
              tcp: t.tcp,
              tls: t.tls,
              sent: t.sent,
              first: t.first,
              end: t.end,
              total: t.end
            }
          })
        })
      }
    )

    req.on('socket', (socket) => {
      socket.once('lookup', () => {
        t.dns = mark()
      })
      socket.once('connect', () => {
        t.tcp = mark()
      })
      socket.once('secureConnect', () => {
        t.tls = mark()
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({ error: `No response within ${spec.timeoutMs || 30000}ms.` })
    })
    req.on('error', (err) => resolve({ error: err.message }))

    if (spec.body) req.write(spec.body)
    t.sent = mark()
    req.end()
  })
}

function flatten(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  }
  return out
}

ipcMain.handle('http:send', (_e, spec) => request(spec))

// Kept so the renderer never sees an unhandled rejection as a blank window.
process.on('uncaughtException', (err) => {
  console.error('[prism] uncaught:', err)
})
