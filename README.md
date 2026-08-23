# Rebind Prism

A workflow-first API testing workspace. An open-source desktop application in
its own right — it shares no code with Rebind and does not need Rebind
installed. It reads Rebind's exports and Postman collections and takes it from
there.

MIT licensed. No account, no licence key, no gated features: everything the app
does, it does for everyone.

```bash
git clone https://github.com/your-org/rebind-prism
cd rebind-prism
npm install
npm start
```

```bash
npm test          # 110 tests. No Electron, no browser, no display needed.
npm run dist      # installers for the current platform
```

The only dependencies are Electron and electron-builder, both dev-only. The
application itself is plain ES modules and Node built-ins — no framework, no
bundler, no build step. `npm test` runs on a bare Node install, which is why
CI needs nothing but `actions/setup-node`.

---

## Collections, flows, requests

Three levels, because that is what a Postman file and a Rebind export both
actually are. Flattening them lost where a flow came from and made a re-export
produce a file shaped differently from the one you opened.

Every level can be created, and every level can be deleted — with a dialog that
says what goes with it, because deleting a flow takes its requests and a count
is the difference between a decision and a surprise.

## Why it is not laid out like an API client

A request is rarely interesting on its own. What people are actually testing is
a *sequence* — log in, take the token, fetch the profile, take the id, place an
order — and the thing that breaks is usually the join between two steps rather
than either step by itself.

So the middle of the screen is a plane with the requests laid out on it and the
variables drawn travelling between them. Everything else serves that: the rail
lists flows rather than folders, the inspector reads whichever response is
selected, and the timeline underneath says where the milliseconds went.

The beams are **derived, never stored**. One exists where a request captures a
value that another one actually mentions, so you make a connection by making
the test work. There is no separate wiring step to fall out of step with
reality.

### A node is a label, not an editor

Nodes used to open into the whole request form, which made them a different
size at every zoom and unreadable at half of them. A node now shows only what
you need to *read the graph*:

- the method, as a colour down its left edge
- the endpoint
- **needs** — every variable it wants, outlined in cyan on the left, and turning
  red when nothing anywhere provides it
- **gives** — every variable it captures, filled magenta on the right
- how it went last time, and a button to send it

Everything editable is in the workbench on the right, in one fixed place. The
beams leave and arrive at the same edges the ports are drawn on, so a line
lands where the name is.

Nodes are stacked by their *measured* height, not a fixed row gap — a node with
four ports is half as tall again as one with none — and a node you drag stays
exactly where you put it.

### The colour system

The mark is a prism: one beam in, a spectrum out, and the interface takes that
literally.

| | |
| --- | --- |
| **Spectrum** — cyan, indigo, magenta | values in motion, and nothing else |
| **Outcomes** — green, amber, red | pass, warn, fail. Never on the spectrum |
| **Selection** — white | light and weight, not a hue |

On a graph screen you read three kinds of thing at once — structure, data flow
and results — and they must never share a colour.

---

## What it imports

| File | What Prism does with it |
| --- | --- |
| Rebind **workspace** export | A collection, with its recorded calls and environments |
| Rebind **flow** export (a suite) | One flow |
| **Postman** collection v2.1 / v2.0 | Folders become flows; auth, query rows and test scripts come across |
| **Postman** environment | Just the variables |

Two generations of the Rebind request shape are read, because a file exported
today and one exported six months ago are both files somebody will open.

Postman test scripts are JavaScript, so Prism reads the handful of shapes that
make up most real scripts and **leaves the rest**. A collection that imports
with two of its five checks is honest; one that imports with five checks it does
not actually perform is not.

### Getting the recording out of Rebind

Prism and Rebind are separate programs that meet at a file, and nowhere else.
Rebind's API page has **Export workspace** beside Run collection; every other
export it offers writes a suite, which is enough to run elsewhere but throws
away the captured traffic — and that traffic is the part no other tool can
reproduce. The bundle it writes is what Prism opens.

Prism never reads Rebind's database, imports its modules, or requires it to be
installed. If you have a bundle, Prism will open it; if you have a Postman
collection instead, that works just as well.

---

## What actually works

Everything below is wired end to end, not mocked:

- **Sending**, from the main process, with real DNS / TCP / TLS / wait /
  download phase timings taken from Node's own socket events. Anything measured
  in the renderer would be one number with a guess split across it.
- **Assertions** — seven subjects × their operators, each reporting what it
  actually saw. A red row that will not say what it found is a row people
  delete.
- **Chaining.** A captured value lands in the environment, so the next request
  in the flow uses it without anyone copying anything.
- **Insights** — see below.
- **Schema tree**, **response diff** against the previous run of the same
  request, **history**, **flow runs** with a progress ring.
- **Export** to 15 targets with a live preview.

## Insights is not a model

Every finding is a rule over the response that just came back, and each one
carries the evidence that produced it. That is deliberate: a checklist that is
always right about six things beats a paragraph that is usually right about
twenty, and on a screen full of red and green the one thing that must never be
guessed is *why* something failed.

It reads status class, timing, truncation, empty bodies, JSON that claims to be
JSON and is not, null fields, empty collections, credential-shaped values,
missing content types, HSTS, cache headers, and which assertions failed. A 401
is explained differently depending on whether an `Authorization` header was
even sent.

## The one rule about credentials

**No credential is ever inlined in an export.** A `{{token}}` in a request comes
out as a read of an environment variable, in every one of the fifteen targets.
Exported code gets committed, pasted into tickets and put on screen shares.

The Postman export declares variable *names* with empty values for the same
reason — writing the live token into a collection file is precisely the leak the
rule exists to prevent.

This is enforced by a test that hands every generator a loaded environment
containing real-looking secrets and fails if any of them reaches any file.

Request headers shown in the inspector are masked on the same grounds.

---

## Layout

```
rebind-prism/
  main.cjs          window, HTTP with phase timings, file dialogs
  preload.cjs       the entire surface the page can touch
  lib/              pure, all of it directly tested
    collection.js     import: Rebind (both shapes) and Postman
    request.js        request as edited -> request as sent
    assert.js         assertions and what they saw
    insights.js       the rules over a response
    schema.js         tree, type sketch, diff
    codegen.js        fifteen export targets
  renderer/
    index.html  styles.css  app.js  demo.js
  test/             110 tests, node:test
```

The renderer is sandboxed with no Node access; every capability it has is a
named handler in `main.cjs`. If it is not in that file, the page cannot do it.

`lib/` is pure on purpose. Sending is a handful of lines in the main process,
and every decision worth being wrong about — how a URL is assembled, whether an
assertion passed, what changed since last time, what lands in an exported file
— is a function that can be called from a test.

---

## Deliberately not built

- **Replay.** Excluded by request; that is Rebind's job.
- **Network recording.** Prism has no browser to record. It receives
  recordings from Rebind, which is the round trip described above.
- **Postman pre-request scripts.** Read as text, not executed.
- **Performance analytics across runs.** History holds a session; there is no
  P95 or latency heatmap yet, because there is nothing durable to compute one
  from.
- **Binary bodies.** Export the request to send one.
