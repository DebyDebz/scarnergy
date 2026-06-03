# EAS Cloud Builds + "Dev build required" Fix — 2026-06-03

Two related goals this session:

1. Trigger **EAS iOS cloud builds programmatically** from the server (no Xcode/Android SDK locally).
2. Fix the **"Dev build required"** alert that blocked **Take Photo / Choose from Library** in the
   Sessions → *Draw Floor Plan* flow.

Both converged on the same root issues (a missing/undeclared `expo-image-picker` and a stale device
build), so they're documented together.

---

## Part A — Programmatic EAS iOS build

**Goal:** kick off iOS builds in Expo's cloud with only an Expo Access Token + App ID — no local
build tooling.

**What already existed:** the App ID (`app.json` → `extra.eas.projectId =
e41c9a9f-d0c2-4076-9392-3e36e42169c0`, owner `fabricelaba`) and `eas.json` build profiles
(`development` / `preview` / `testflight` / `production`).

**Reality check:** Expo's public GraphQL API supports *verifying a token* and *reading build status*,
but there is no stable public endpoint to *create* a build from source. The supported automation path
is `eas-cli` run non-interactively with `EXPO_TOKEN` set — the build still runs entirely in the cloud.

**Added:**
| File | Purpose |
|---|---|
| `scripts/eas-build-ios.sh` | Resolves `EXPO_TOKEN`, verifies it (`viewer` GraphQL query), confirms project access, then runs `eas build --platform ios --profile <profile> --non-interactive --no-wait`. |
| `package.json` | `build:ios:cloud` script alias → `bash scripts/eas-build-ios.sh`. |
| `docs/EAS_BUILD.md` | Operator guide (credentials, usage, profiles, iOS prerequisite). |

Usage:
```bash
npm run build:ios:cloud              # production
npm run build:ios:cloud -- preview   # any eas.json profile
```

---

## Issues detected & how they were solved

### Issue 1 — Secret would be committed: `.env` is git-tracked
`EXPO_TOKEN` was added to the root `.env`, but `.env` is **tracked by git** (the `.gitignore` entry was
added *after* the file was first committed), so the token was at risk of being committed.

**Fix:** moved `EXPO_TOKEN` to **`.env.local`** (git-ignored *and* untracked) and removed it from
`.env`. The build script reads `.env.local` first, so behavior is unchanged. Verified the `.env` diff
no longer contains the token.

### Issue 2 — Build script exited silently (`set -e` traps)
The script aborted with no error message when the token came from `.env.local`. Two `set -euo pipefail`
traps:
- A `grep` with no match (exit 1) inside a `$(... | sed ...)` command substitution aborted the script.
  **Fix:** appended `|| true`.
- A bare `return` after `[[ "$f" == .../.env ]] && warn …` inherited the *false* test's exit status (1),
  making the resolver "fail" under `set -e`. **Fix:** explicit `return 0` and an `if` block instead of
  `&&`.

### Issue 3 — `eas-cli` version mismatch
`eas.json` requires `eas-cli >= 18.4.0`, but the local devDependency was `^10.0.0`.
**Fix:** the script invokes `npx eas-cli@latest`, so the correct version is always used.

### Issue 4 — Root project had no `node_modules`
First real build failed:
`Failed to resolve plugin for module "expo-router" relative to ".../ScanergyV2". Do you have node
modules installed?` EAS evaluates `app.json` locally before upload, which needs dependencies installed.
The repo root had no `node_modules` (only the nested `scarnergy-app/` checkout did).
**Fix:** ran `npm install` at the root.

### Issue 5 — `expo-image-picker` undeclared (the core bug behind the alert)
After installing root deps, the build still failed:
`Failed to resolve plugin for module "expo-image-picker"`. The package is referenced as a config
**plugin** in `app.json` and was installed in `scarnergy-app/node_modules` (v17.0.11), but it was
**declared in neither `package.json`** — a latent bug that breaks any clean install, CI, or cloud build.
**Fix:** declared `expo-image-picker: ~17.0.11` in **both** `package.json` files (root and
`scarnergy-app/`) via `npx expo install` (SDK-correct version). `npx expo config` then resolved all
plugins cleanly.

### Issue 6 — "Dev build required" alert on Take Photo / Choose from Library
**Symptom:** in Sessions → *Draw Floor Plan*, tapping the photo buttons showed
*"Image upload is not available in Expo Go. Run the app with `expo run:ios` or install the EAS preview
build…"*.

**Root cause:** the screens lazily load the native module and fall back to the alert if it fails —
`components/inspection/FloorPlanImageUpload.tsx:10-11` (same pattern in
`app/tabs/sessions/facade-photos.tsx` and `app/tabs/sessions/inspect.tsx`):
```js
let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch { ImagePicker = null; }
```
The custom dev build installed on the iPhone was produced **before** `expo-image-picker` was added, so
`require('expo-image-picker')` threw at runtime → `ImagePicker` was `null` → the guard fired. The native
iOS project was already correct (`ios/Podfile.lock` includes `ExpoImagePicker 17.0.11`); only the
*installed binary* was stale. This box is a Linux VPS (no Xcode), so iOS builds can only come from EAS.

**Fix:** declared the dependency (Issue 5) and produced fresh EAS iOS builds that include the native
module. **No UI, design, or guard changes** — the guard message is accurate and was left as-is.

---

## Builds produced

iOS credentials were already on EAS (distribution cert + ad-hoc provisioning profile, Apple Team
`6DDL8YV935` — KRONTIVA AFRICA LTD), and two iPhones were already registered (including the target
device `00008110-001465323678801E`), so no `device:create` was needed.

| Profile | Build ID | Result |
|---|---|---|
| `development` (dev client, live reload) | `afb48670-e739-4586-b584-b9029c9ca57c` | FINISHED |
| `preview` (standalone) | `f9420b19-018e-4e6b-b8fc-e62b88c50f0b` | FINISHED |

Install links: `https://expo.dev/accounts/fabricelaba/projects/scarnergy-app/builds/<id>`

---

## Verification

1. `npx expo config --type public` — exits cleanly (all plugins resolve, incl. `expo-image-picker`). ✓
2. Install the build on the iPhone (preview = no Metro; development = `npm run start:tunnel` from root).
3. Sessions → *Draw Floor Plan* → **Take Photo** / **Choose from Library** → permission prompt + picker
   open (no "Dev build required").
4. Pick image → trace polygon → **Save Floor Plan** → uploads to the Supabase `floor-plans` bucket
   (`FloorPlanImageUpload.tsx:164-178`).
5. Regression-check the sibling flows: facade photos and element photos (inspect screen).

---

## Notes / follow-ups

- **Two checkouts:** the EAS build, `app.json`, `eas.json`, and now `node_modules` all live at the
  repo **root**; the nested `scarnergy-app/` is a second git repo. Standardize on the root for builds
  and Metro to avoid divergence (e.g. the undeclared-dependency drift in Issue 5).
- The stale local `eas-cli` devDependency (`^10`) could be bumped to satisfy `eas.json`'s `>= 18.4.0`;
  not required because the script uses `npx eas-cli@latest`.

## Files changed this session
- `scripts/eas-build-ios.sh` (new), `docs/EAS_BUILD.md` (new)
- `package.json` — `build:ios:cloud` alias + `expo-image-picker` dependency
- `scarnergy-app/package.json` — `expo-image-picker` dependency
- `.env` / `.env.local` — moved `EXPO_TOKEN` to the untracked file
