# Contributing to MediaGo

Thanks for your interest in hacking on MediaGo! This doc covers everything
you need to get a local dev build running. For user-facing usage, see the
main [README](./README.md).

## Prerequisites

- **One CLI** ≥ 0.1.24 — [official downloads](https://github.com/1cli-team/one-cli/releases).
  `mise.toml` pins the tools used by One tasks. Run `one mise trust` after
  reviewing the configuration, then `one mise install` to install those
  versions without changing your global tool selections.
- **Node.js** ≥ 24.14 — install from [nodejs.org](https://nodejs.org/)
- **pnpm** 11.23 — activated from the repository's `packageManager` field
- **Go** ≥ 1.27.4 — install from [go.dev](https://go.dev/dl/)
- **Task** ≥ 3.51.1 and < 4.0.0 — the repository task runner

Install the latest compatible Task v3 release on macOS, Linux, or Windows
(PowerShell) with the Go toolchain. Make sure the Go binary directory is on
`PATH`, then verify the installed version:

```shell
go install github.com/go-task/task/v3/cmd/task@latest
task --version
```

## Clone & install

```shell
git clone https://github.com/caorushizi/mediago.git
cd mediago
task setup
task dev:all
```

`task setup` installs both the Node workspace and the runtime tools required
by the application. Runtime versions come only from
`packages/tooling/manifests/runtime-deps.json`; Task does not automatically upgrade them.
Running `pnpm install` alone installs Node packages, but not BBDown or the
other runtime binaries.

## Repository layout

MediaGo is a pnpm + Turborepo monorepo with three products that share the
same Go Core backend:

```
apps/
  core/            Go backend with embedded main and Player UIs
  electron/        Electron desktop main process
  ui/              Shared React 19 frontend (Electron + Web)
  player-ui/       React frontend embedded inside Go Core for playback
packages/
  common/   Cross-platform types, constants, i18n resources
  core-sdk/        TypeScript SDK for the Go Core REST API
  electron-preload/
  mediago-extension/  Browser extension (Chrome / Edge)
  tooling/         Shared bootstrap, build, release, verification and Vite tooling
.github/
  actions/         Reusable CI setup actions
docker/            Container entrypoint and Docker assets
docs/              VitePress site (zh / en / jp)
```

Deeper architecture notes live in [`CLAUDE.md`](./CLAUDE.md).

## Everyday commands

```shell
# Prepare the Node workspace and all pinned runtime tools
task setup

# Run the unified desktop + web development experience
task dev:all

# Run the Electron desktop app in dev mode (HMR)
task dev:electron

# Run the Web Core and Vite UI in development mode
task dev:web

# Build the deployable Web product as a Docker image
task build:docker

# Build the Electron workspace without creating an installer
task build:electron

# Build an unpacked Electron directory to inspect the package layout
task pack:electron

# Build full Electron installers for distribution (.exe / .dmg / .deb)
task release:electron

# Lint + format + type-check (what CI runs)
task check
```

One is the preferred local entry point. Task remains the implementation of
product preparation and the compatible entry point for existing CI.
Turborepo schedules JavaScript workspace builds; pnpm `:raw` commands,
Go commands and modules under `packages/tooling/` remain implementation leaves.

### One workspace commands

```shell
one run                        # List tasks
one mise trust                 # Trust this clone's reviewed task configuration
one mise install               # Install the pinned toolchain once
one setup                      # Node packages and pinned runtime tools
one dev                        # Desktop + Web, using the existing bootstrap
one dev:web                    # Core + Web UI
one dev:electron               # Desktop only
one dev -p extension           # Browser extension
one build -p core              # Core with embedded Player UI
one build -p electron          # Desktop assets
one build -p docs              # VitePress documentation
one pack -p electron           # Unpacked desktop directory
one check                      # Repository lint, format and types
one dev --dry-run -o json      # Inspect without running or loading secrets
pnpm one:verify                # Verify task plans and configuration synchronization
```

The v2 `one.manifest.toml` records project paths and toolchains without moving
source directories. `mise.toml` contains discovered component scripts plus
explicit product overrides. `one build` defaults to the Electron build;
Docker and documentation use `one build:docker` and `one build -p docs`.
After changing project scripts or workspace dependencies, run `one init mise`,
review the diff and run `pnpm one:verify`. Keep product overrides: they ensure
that Core, runtime binaries, application targets and packaging metadata are
prepared by the existing Taskfile, without duplicate background processes.

This adoption does not configure an Infisical binding. Existing application
and Taskfile environment loaders still apply; One itself does not load local
`.env` files. Use `MEDIAGO_PROFILE=development`, `test` or `production` for the
existing MediaGo profiles. One's `--env` option selects an Infisical environment
when a binding is configured; it does not change `MEDIAGO_PROFILE`.
CI and release workflows continue to call Task directly.

The self-hosted Web product ships only through the Docker image. Task launches
the Go Core binary directly for Web development; there is no Node.js server
adapter. The Core binary embeds both the main Web UI and Player UI.

## Commit style

This repo uses [Conventional Commits](https://www.conventionalcommits.org/).
Typical shapes:

```
feat(ui): add dark-mode toggle to settings page
fix(core): resume m3u8 downloads after process restart
refactor(extension): split options hook per card
chore(deps): bump axios from 1.14.0 to 1.15.0
```

Commits are lint-staged on commit (oxlint --fix + oxfmt --write on
staged files). Type checks run via `turbo type:check`.

## Pull requests

- Open PRs against the `master` branch.
- Keep each PR focused — one feature / fix per PR if possible.
- Include a short "why" in the description; the "what" is in the diff.
- If the change is user-visible, a line in the PR description that would
  fit in a release note is appreciated.

Thanks for contributing! 🚀
