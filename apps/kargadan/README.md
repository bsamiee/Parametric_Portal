# Kargadan

Kargadan is the local Rhino assistant for macOS. A TypeScript harness runs outside Rhino and talks to an in-process C# Rhino plugin over localhost WebSocket.

## Runtime Contract

- macOS only
- Rhino 9 WIP only
- Managed PostgreSQL runs through Docker only
- `KARGADAN_DATABASE_URL` is a developer override, not part of end-user setup
- AI providers are `openai` and `gemini`
- Provider/model selection is persisted in app settings
- Secrets live in the macOS Keychain
- `~/.kargadan/config.json` stores only local non-secret paths

## Packaged User Flow

Install these prerequisites first:

- a working local Docker engine
- Rhino WIP (`/Applications/RhinoWIP.app`)
- OpenAI API access or Gemini desktop OAuth credentials

From an extracted release directory:

```bash
./kargadan setup --launch-rhino
```

`setup` is the only first-run mutating command. It starts or repairs the managed Docker database, runs migrations, enrolls credentials when needed, persists the active AI selection, installs the bundled Rhino plugin, and can launch Rhino for a live bridge check.

After setup:

```bash
./kargadan
```

Useful packaged commands:

- `./kargadan setup`
- `./kargadan plugin status`
- `./kargadan plugin install --launch`
- `./kargadan auth status`
- `./kargadan ai status`
- `./kargadan diagnostics check`
- `./kargadan diagnostics live --launch`
- `./kargadan run --intent "Inspect the active scene"`

Non-interactive setup is supported when the required inputs already exist:

```bash
./kargadan setup --yes
./kargadan auth login --provider openai
./kargadan ai select --provider openai --model <live-model>
```

## Repo Dev Flow

Build the Rhino package from the repo root:

```bash
pnpm install
pnpm exec nx run @parametric-portal/kargadan-harness:yak:package
```

Live source-tree commands:

```bash
pnpm --filter @parametric-portal/kargadan-harness exec tsx src/cli.ts
pnpm --filter @parametric-portal/kargadan-harness exec tsx src/cli.ts plugin status
pnpm --filter @parametric-portal/kargadan-harness exec tsx src/cli.ts diagnostics live --launch
```

Release packaging is intentionally strict. `pnpm exec nx run @parametric-portal/kargadan-harness:release` must run on macOS, fails until `apps/kargadan/harness/assets/release.json` contains a real published PostgreSQL image digest, and rewrites the packaged compose metadata to that pinned digest.

The packaged release directory is expected to contain:

- `kargadan`
- `node`
- `main.js`
- `SHA256SUMS.txt`
- `assets/release.json`
- `assets/docker-compose.release.yml`
- `assets/plugin/kargadan-rhino-<version>-*.yak`

## Local State

`~/.kargadan/config.json` should contain only local non-secret path state:

```json
{
  "ai": {
    "geminiClientPath": "/absolute/path/to/client_secret.json"
  },
  "rhino": {
    "appPath": "/Applications/RhinoWIP.app",
    "yakPath": "/Applications/RhinoWIP.app/Contents/Resources/bin/yak"
  }
}
```

Kargadan does not persist database URLs in config. The managed Docker database uses a stable local-only password. `KARGADAN_DATABASE_URL` remains an env-only developer escape hatch.

## Notes

- Bare `kargadan` enters setup in a TTY when the app is not ready.
- Bare `kargadan` in non-TTY prints readiness plus the next action and exits.
- `run` validates readiness and executes only; it does not repair setup.
- `diagnostics live --prepare` is a deprecation rail that points users to `kargadan plugin install`.
- `plugin status`, `plugin install`, and `plugin upgrade` resolve Rhino WIP only and do not fall back to Rhino 8.
