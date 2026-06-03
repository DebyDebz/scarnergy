# EAS iOS Cloud Build

Trigger an **iOS** app build programmatically on Expo's cloud — no Xcode or Android SDK needed
locally. The build runs entirely on Expo's servers; this machine only sends an authenticated request.

## What you need

| Credential | Value | Where it lives |
| --- | --- | --- |
| **App ID** (`projectId`) | `e41c9a9f-d0c2-4076-9392-3e36e42169c0` | already in [`app.json`](../app.json) → `extra.eas.projectId` |
| **Expo Access Token** | your Personal Access Token | `.env.local` (you add it — see below) |
| **Project owner** | `fabricelaba` | `app.json` → `owner` |

Build profiles (`production`, `preview`, `testflight`, `development`) are defined in
[`eas.json`](../eas.json).

## One-time setup

### 1. Store the Expo Access Token

> ⚠️ **Do not put the token in `.env`** — that file is git-tracked and would leak the secret.
> Use `.env.local`, which is git-ignored and untracked.

Add this line to `.env.local` in the repo root (create the file if it doesn't exist):

```bash
EXPO_TOKEN=your_token_value_here
```

The token comes from **expo.dev → avatar → Account Settings → Access Tokens → Create Token**
(it is shown only once). The token must belong to, or be a member of, the `fabricelaba` account that
owns this project.

Alternatively, export it in your shell or CI secrets instead of using `.env.local`:

```bash
export EXPO_TOKEN=your_token_value_here
```

The script resolves the token in this order: environment → `.env.local` → `.env`.

### 2. iOS Apple credentials (first build only)

iOS cloud builds need Apple Developer credentials (distribution certificate + provisioning profile)
registered on the EAS project. The easiest path is **EAS managed credentials** — set them up once on
expo.dev for the `scarnergy-app` project. Until they exist, a non-interactive build will fail asking
for credentials.

## Trigger a build

```bash
npm run build:ios:cloud              # production profile (default)
npm run build:ios:cloud -- preview   # any profile from eas.json
bash scripts/eas-build-ios.sh testflight
```

The script ([`scripts/eas-build-ios.sh`](../scripts/eas-build-ios.sh)):

1. resolves `EXPO_TOKEN`,
2. verifies it against Expo's GraphQL API and prints your username,
3. confirms the token can see the `fabricelaba` account,
4. runs `eas build --platform ios --profile <profile> --non-interactive --no-wait`,
5. prints the build URL.

`--no-wait` means it returns immediately. Watch progress at:
<https://expo.dev/accounts/fabricelaba/projects/scarnergy-app/builds>

## Verify your token without building

```bash
curl -s -X POST https://api.expo.dev/graphql \
  -H "Authorization: Bearer $EXPO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query { viewer { username } }"}'
```

A healthy response is `{"data":{"viewer":{"username":"<you>"}}}`. A `401` / `errors` payload means the
token is wrong or expired.

## Notes

- The script uses `npx eas-cli@latest` because `eas.json` requires `eas-cli >= 18.4.0`, which the
  stale local devDependency (`^10`) does not satisfy.
- Extending to Android later is a one-line change (`--platform android`) — intentionally out of scope
  for now.
