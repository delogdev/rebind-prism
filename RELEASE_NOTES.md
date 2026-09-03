# Rebind Prism 0.1.0

First release. **MIT licensed** — no account, no licence key, and no feature held
back for a paid tier. Everything the app does, it does for everyone.

Prism is a desktop workspace for API **workflows**. A request is rarely
interesting on its own; what breaks is the join between two steps — log in, take
the token, fetch the profile, take the id, place an order. So the middle of the
screen is a plane with your requests laid out on it and the variables drawn
travelling between them, with a timeline underneath saying where the
milliseconds went.

It is a program in its own right. It shares no code with Rebind Engine, does not
read its database, and does not need it installed — the two meet at a file and
nowhere else.

---

## Download

**Rebind Prism Setup 0.1.0.exe** — Windows 10/11, 64-bit · 91 MB
*(about 325 MB installed)*

Installs per-user, so it needs no administrator rights.

**Rebind Prism-0.1.0-win.zip** — 126 MB · portable, no installer
Unzip and run `Rebind Prism.exe`. For locked-down machines and CI images.

### Verify the download

```
SHA-256  c02e0e9687406a122941e0d321f719d88998e463bd4af698510d15ffc53515f0
```

```powershell
certutil -hashfile "Rebind Prism Setup 0.1.0.exe" SHA256
```

### Windows will warn you

This build is **not code-signed**, so SmartScreen shows *"Windows protected your
PC"* and the publisher reads *Unknown*. **More info → Run anyway**.

That is about the absence of a certificate, not about anything found in the
file. The hash above is the real check.

---

## What works

Wired end to end, not mocked:

- **Sending** from the main process, with real DNS / TCP / TLS / wait / download
  timings taken from Node's own socket events. A number measured in the renderer
  would be one figure with a guess split across it.
- **Assertions** — 7 subjects (status, response time, size, content type,
  header, body, JSON path) each reporting what it actually saw. A red row that
  will not say what it found is a row people delete.
- **Chaining.** A captured value lands in the environment, so the next request
  uses it without anyone copying anything.
- **Schema tree**, **response diff** against the previous run of the same
  request, **history**, and **flow runs** with a progress ring.
- **Baselines and drift**, **data-driven runs**, **GraphQL**, and auth set once
  and inherited.
- **Insights** — every finding is a rule over the response that just came back,
  carrying the evidence that produced it. Not a model: a checklist that is
  always right about six things beats a paragraph that is usually right about
  ten.
- **Export to 15 targets** with a live preview — cURL, Python, pytest, fetch,
  axios, Node, Playwright, Java, REST Assured, C#, Go, PHP, Postman, OpenAPI
  and canvas.

## The one rule about credentials

**No credential is ever inlined in an export.** A `{{token}}` comes out as a
read of an environment variable in every one of the fifteen targets, because
exported code gets committed, pasted into tickets and put on screen shares. The
Postman export declares variable *names* with empty values for the same reason.

This is enforced by a test that hands every generator an environment full of
real-looking secrets and fails if any of them reaches any file. Request headers
in the inspector are masked on the same grounds.

## What it imports

Drop a file on the window or use **Import** — both go through the same front
door, so what works one way works the other.

| File | Result |
| --- | --- |
| Rebind **workspace** export | A collection, with its recorded calls and environments |
| Rebind **flow** export | One flow |
| **Postman** collection v2.1 / v2.0 | Folders become flows; auth, query rows and test scripts come across |
| **Postman** environment | The variables |
| **OpenAPI** 3 / Swagger 2 | Tags become flows; examples and enums fill the rows |
| **Prism** workspace | Everything, including baselines and layout |
| **HAR** capture | Assets and duplicates dropped, the shared host becomes a variable |
| **cURL** command | Pasted from the clipboard with `Ctrl+Shift+V` |

Postman test scripts are JavaScript, so Prism reads the handful of shapes that
make up most real scripts and **leaves the rest**. A collection that imports
with two of its five checks is honest; one that imports with five checks it does
not actually perform is not.

---

## Deliberately not built

Listed because a missing feature you were told about is a decision, and one you
discover is a bug:

- **Replay.** That is Rebind Engine's job.
- **Network recording.** Prism has no browser. It receives recordings from
  Engine.
- **Postman pre-request scripts.** Read as text, not executed.
- **Performance analytics across runs.** History holds a session; there is no
  P95 or latency heatmap, because there is nothing durable to compute one from.
- **Binary request bodies.** Export the request to send one.

## Known limitations

- **Windows only** in this release. macOS and Linux targets are configured but
  not produced yet — each needs a machine of its own to build on.
- **Unsigned**, as above.
- **No auto-update.** Prism has no update mechanism at all; watch this
  repository's releases.
- **`prism-run`, the CI runner, is not on npm yet.** The command ships inside
  the app, but the `npx prism-run` invocation needs the npm package published —
  that is a separate release step and has not happened. Until then, run it from
  a source checkout.
- **0.1.0 is a first cut.** The version says so on purpose.

---

## For the curious

No framework, no bundler, no build step — the app is plain ES modules and Node
built-ins. Electron and electron-builder are its only dependencies and both are
dev-only, so there are **zero runtime dependencies**. The test suite is **399
tests** that run on a bare Node install: no Electron, no browser, no display.
