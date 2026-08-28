# Packaging and publishing Rebind Prism

Everything in this file is specific to Prism. Engine has its own, in
`rebind-engine/PACKAGING.md`, and it differs in ways that matter — Engine has a
licence key baked in at build time and its own update feed, Prism has neither.
Do not copy a step across without reading both.

```bash
npm run dist          # electron-builder
npm run dist:dir      # skip compression; just dist/win-unpacked/
npm run dist:win      # one platform (also dist:mac, dist:linux)
```

There is **no build step**. The app is plain ES modules and Node built-ins, so
electron-builder runs against the source directly. Config is the `build` field
in `package.json`; output goes to `dist/`.

| Artefact | Size |
| --- | --- |
| `dist/Rebind Prism Setup 0.1.0.exe` | ~91 MB |
| `dist/Rebind Prism-0.1.0-win.zip` | ~126 MB (portable) |
| `dist/win-unpacked/` | ~325 MB installed |

**No licence key is involved.** Prism is MIT with no account, no key and no
gated features, so unlike Engine there is nothing to bake in and nothing that
silently degrades if you forget it.

## The blocker on a fresh Windows machine

The first build fails with a wall of:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client
  ...\Cache\winCodeSign\<n>\darwin\10.12\lib\libcrypto.dylib
```

electron-builder downloads `winCodeSign-2.6.0.7z` for the Windows signing and
resource-editing tools. That archive also carries a macOS OpenSSL build in which
two files are **symlinks**, and creating a symlink on Windows needs an elevated
shell or Developer Mode. Extraction fails; electron-builder retries three times
and gives up.

Nothing in the macOS half is used for a Windows build. Extract the cache
yourself without it:

```bash
CACHE="$LOCALAPPDATA/electron-builder/Cache"

# electron-builder 25 bundles 7za in node_modules; 26 downloads it to the cache
# under a directory with a random suffix. Try both.
Z=$(ls node_modules/7zip-bin/win/x64/7za.exe 2>/dev/null | head -1)
[ -z "$Z" ] && Z=$(ls "$CACHE"/7zip*/*/bin/7za.exe 2>/dev/null | head -1)

# let one build fail first, so the .7z is downloaded, then:
"$Z" x "$CACHE/winCodeSign"/*.7z       -o"$CACHE/winCodeSign/winCodeSign-2.6.0" -xr'!darwin' -y
rm -rf "$CACHE/winCodeSign"/[0-9]*     # the failed partial extractions
```

The glob has to sit outside the quotes, as above. Folding the whole path into a
single variable and globbing that does not work: `$LOCALAPPDATA` contains
backslashes, and they are treated as escapes during expansion, so the pattern
silently matches nothing.

electron-builder looks for a directory called `winCodeSign-2.6.0` and, finding
it, skips the download and the extraction. Builds then work unelevated.

Enabling Developer Mode or building from an Administrator shell also works. The
cache trick is the one that survives being handed to somebody else.

## Icons

`build/icon.ico` and `build/icon.png`. `build/` is electron-builder's default
`buildResources` directory, so they need no config.

Delete them and the build logs `default Electron icon is used` — a log line,
not a warning — and ships an installer wearing the Electron logo. The glyph is
the node-graph mark used on the Delog site's Prism card.

## Installer behaviour

`build.nsis` sets `oneClick: false`, `allowToChangeInstallationDirectory: true`
and `perMachine: false`, matching Engine. electron-builder's default is a
one-click installer that picks its own directory and offers no chance to
cancel; two products in one family installing differently reads as one of them
being unfinished.

## Signing

The installer is currently **unsigned**. SmartScreen shows "Windows protected
your PC" on first run and the publisher reads "Unknown". Not a build fault.

electron-builder signs automatically once the environment carries a
certificate. No config change:

```bash
CSC_LINK=path/to/cert.pfx      # or a base64 blob of it
CSC_KEY_PASSWORD=...
npm run dist
```

---

# Publishing

Prism has **two** publishing targets, and they are independent:

1. **The desktop installers** → GitHub Releases.
2. **The `prism-run` CLI** → npm. The website tells people to run
   `npx prism-run flow.prism.json --reporter junit`, and that only works once
   the package is on npm.

Do both for a release, or the site is describing something that does not exist.

## Before the first publish

Three things in `package.json` still point at a placeholder:

```json
"homepage": "https://github.com/your-org/rebind-prism#readme",
"repository": { "url": "https://github.com/your-org/rebind-prism.git" },
"bugs":       { "url": "https://github.com/your-org/rebind-prism/issues" }
```

npm renders all three on the package page, so publishing with `your-org` in
them ships three dead links. Fix them in the same commit that creates the repo.

The version is `0.1.0`. If that is meant to signal pre-release, publish to npm
with a tag so it does not become `latest` for everyone:
`npm publish --tag next`.

---

## Publishing the installers to GitHub Releases

### Step 1 — tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

### Step 2 — create the release and upload

**With the `gh` CLI** — not currently installed on this machine; get it from
<https://cli.github.com/> or `winget install GitHub.cli`, then `gh auth login`.

```bash
gh release create v0.1.0 \
  "dist/Rebind Prism Setup 0.1.0.exe" \
  "dist/Rebind Prism-0.1.0-win.zip" \
  --title "Rebind Prism 0.1.0" \
  --notes-file RELEASE_NOTES.md \
  --draft
```

Keep it `--draft` until you have checked the asset downloads and installs, then
`gh release edit v0.1.0 --draft=false`.

**Without `gh`** — Releases → Draft a new release → pick the tag → drag the
files in. Both assets are well inside GitHub's 2 GB per-file limit.

### Step 3 — do not publish `latest.yml`

`dist/` contains `latest.yml`, and `dist/win-unpacked/resources/` contains
`app-update.yml`. electron-builder writes both for an NSIS target whether you
asked for them or not.

They are **electron-updater's** manifests. **Prism has no update mechanism at
all** — no electron-updater dependency, no auto-update code, nothing that reads
either file. Publishing `latest.yml` alongside the installer advertises an
auto-update channel that does not exist, and the first person to point an
updater at it gets a confusing failure.

Upload the `.exe` and the `.zip`. Leave the `.yml` files where they are.

(Engine is different again: it *does* have an updater, but a custom one with its
own JSON feed, and it also should not publish `latest.yml`. See
`rebind-engine/PACKAGING.md`.)

### Step 4 — publish the checksum

Nothing in Prism verifies a download, so users have to. Put the hash in the
release notes:

```bash
# Windows
certutil -hashfile "dist/Rebind Prism Setup 0.1.0.exe" SHA256

# anywhere else
sha256sum "dist/Rebind Prism Setup 0.1.0.exe"
```

For 0.1.0 as built here:

```
c02e0e9687406a122941e0d321f719d88998e463bd4af698510d15ffc53515f0  Rebind Prism Setup 0.1.0.exe
```

---

## Publishing the CLI to npm

`cli.mjs` imports only Node built-ins and `./lib/*.js` — no Electron — so it
runs on a bare Node install. That is what makes `npx prism-run` viable, and it
is worth not breaking: an `import` of anything from `electron` in `lib/` would
end it.

### Check the tarball first

`npm publish` includes build output unless told otherwise, and there is no
`.npmignore` here. The top-level `files` field is what keeps `dist/` out:

```json
"files": ["main.cjs", "preload.cjs", "cli.mjs", "lib/", "renderer/"]
```

Without it the tarball is **367 MB**, because it swallows the installers in
`dist/`. With it, 159 kB across 30 files. Always look before you publish:

```bash
npm pack --dry-run | tail -8
```

Expect `package size: ~159 kB`, `total files: 30`. If you see hundreds of
megabytes, `files` has been removed or a new directory needs adding to it.

### Verify the CLI actually stands alone

Packing and running it elsewhere catches a stray dependency that works locally
because `node_modules` happens to be next door:

```bash
npm pack
tar -xzf rebind-prism-0.1.0.tgz -C /tmp
node /tmp/package/cli.mjs --help      # must print usage, not a module error
rm rebind-prism-0.1.0.tgz
```

### Publish

```bash
npm login
npm publish --access public          # add --tag next while 0.x
```

Then confirm the promise the website makes actually holds:

```bash
npx prism-run@latest --help
```

`bin` maps `prism-run` → `./cli.mjs`, so that is the command users get. On a
POSIX system npm sets the executable bit and adds a shim; on Windows it writes
`prism-run.cmd`. There is no shebang requirement for npm to do this, but
`cli.mjs` is also runnable directly with `node cli.mjs`.

---

## macOS and Linux

`build` declares `dmg` + `zip` for macOS and `AppImage` + `deb` for Linux, but
neither can be produced from Windows: macOS has no cross-compilation path
(signing and notarization least of all), and AppImage/deb need Linux or a
container.

A release covering all three needs a runner per platform — one GitHub Actions
job matrixed over `windows-latest`, `macos-latest` and `ubuntu-latest`, each
running `npm ci && npm run dist`, with `CSC_LINK`, `CSC_KEY_PASSWORD` and the
Apple notarization variables as secrets. Prism needs no other secrets, because
it has no licence key.

Not wired up here, because there is no repository yet.
