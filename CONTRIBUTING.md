# Contributing to MediaGo

Thanks for your interest in hacking on MediaGo! This doc covers everything
you need to get a local dev build running. For user-facing usage, see the
main [README](./README.md).

## Prerequisites

- **Node.js** ≥ 20 — install from [nodejs.org](https://nodejs.org/)
- **pnpm** ≥ 10 — `npm i -g pnpm`
- **Go** ≥ 1.22 — only needed if you're working on the Go Core backend
  (`apps/core/`). Install from [go.dev](https://go.dev/dl/).

## Clone & install

```shell
git clone https://github.com/caorushizi/mediago.git
cd mediago
pnpm install
```

## Repository layout

MediaGo is a pnpm + Turborepo monorepo with three products that share the
same Go Core backend:

```
apps/
  core/            Go backend (download orchestration, SSE, REST API)
  electron/        Electron desktop main process
  server/          Node.js launcher for the self-hosted web build
  ui/              Shared React 19 frontend (Electron + Web)
  player-ui/       React frontend embedded inside Go Core for playback
packages/
  shared/common/   Cross-platform types, constants, i18n resources
  core-sdk/        TypeScript SDK for the Go Core REST API
  electron-preload/
  mediago-extension/  Browser extension (Chrome / Edge)
docs/              VitePress site (zh / en / jp)
scripts/           Dep downloaders, extension packager, etc.
```

Deeper architecture notes live in [`CLAUDE.md`](./CLAUDE.md).

## Everyday commands

```shell
# Download third-party binaries (ffmpeg, yt-dlp, N_m3u8DL-RE, BBDown,
# aria2-next, mediago-core) for the current platform — run once per clone
pnpm deps:download

# Run the Electron desktop app in dev mode (HMR)
pnpm dev:electron

# Run the self-hosted web server in dev mode
pnpm dev:server

# Build an unpacked Electron directory (fast, for smoke-testing layout)
pnpm pack:electron

# Build full Electron installers for distribution (.exe / .dmg / .deb)
pnpm release:electron

# Lint + format + type-check (what CI runs)
pnpm check
```

The self-hosted web server doesn't have a dedicated packaging script — it
ships via the Docker image published to GHCR, or you can run the build
output (`pnpm -F @mediago/server build`) directly under Node.

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
