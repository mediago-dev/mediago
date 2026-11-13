# Repository Guidelines

## Project Structure & Module Organization

MediaGo is a pnpm/turborepo monorepo registered in `one.manifest.toml`. Feature apps live in `apps/` (`core` for the Go backend, `electron` for desktop, `ui` for the shared frontend, `player-ui` for playback). Reusable logic stays in `packages/`, including `common`, `core-sdk`, `electron-preload`, and `tooling`. Long-form docs and assets sit in `docs/`, `images/`, and `docker/`.

## Tooling and Script Placement

Repository automation is centralized in `packages/tooling`.

- Do not create app-local or package-local `scripts/` directories.
- Put build, development, release, migration, code-generation, and verification entrypoints under `packages/tooling/src/<domain>/` and invoke them from `Taskfile.yml` or package scripts.
- Before adding a new tooling entrypoint, search `packages/tooling` and extend an existing domain module when practical.
- Keep product runtime code in its owning app or package; this rule applies to repository automation and one-off executable tooling, not application features.

## Documentation Site Safety

`docs/` is the production VitePress source directory. Its contents are packaged and deployed to the public documentation site.

- Never create agent planning or working artifacts anywhere under `docs/`. This includes `docs/plans/`, `docs/superpowers/`, design or implementation plans, audit reports, task logs, handoff notes, scratch Markdown, generated prompts, and session notes.
- Only add or edit files under `docs/` when they are intentional public documentation, documentation assets, VitePress source/configuration, or tests required for the documentation site.
- Store persistent internal planning artifacts under `.agents/plans/`. Store disposable artifacts in the system temporary directory.
- This rule overrides any skill, tool, or template that defaults to writing plans under `docs/` or `docs/plans/`.
- Before finishing a task that touches documentation, inspect `git status --short -- docs` and remove accidental internal artifacts without deleting legitimate documentation content.

## Build and Development Commands

Use One CLI 0.1.24 or newer. On a new clone, review `mise.toml`, run `one mise trust`, `one mise install`, then `one setup`. Use `one dev` for desktop + Web, or `one dev:web` / `one dev:electron` for one surface. Use `one build -p core`, `one build -p electron`, `one build -p docs`, and `one build:docker` for the corresponding targets. `one check` runs lint, formatting and type checks. `mise.toml` pins tool versions and delegates product workflows to the existing Taskfile; CI continues to use Task. After changing project scripts, run `one init mise`, review the diff, and run `pnpm one:verify`. Keep `pnpm format` as the formatting command before commits.

## Coding Style & Naming Conventions

Target modern TypeScript with ES modules, two-space indentation, UTF-8, and LF endings per `.editorconfig`. Components, hooks, and services adopt PascalCase (e.g. `UserPreferencesPanel.tsx`). Utilities and helpers stay camelCase, and constants use SCREAMING_SNAKE_CASE. Always run `pnpm format` before committing; reserve comments for clarifying complex logic.

## UI Interaction and Cursor Semantics

Mouse cursors must communicate what an element will do. Define cursor behavior in shared UI primitives whenever possible so every consumer inherits it.

| Interaction                                                                      | Cursor                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------- |
| Enabled buttons, links, menu items, select options, toggles, and clickable cards | pointer                                   |
| Disabled or unavailable controls                                                 | not-allowed                               |
| Editable text                                                                    | text                                      |
| Draggable content                                                                | grab, changing to grabbing while dragging |
| Horizontal or vertical resize handles                                            | col-resize or row-resize                  |
| Work continuing in the background                                                | progress                                  |
| Blocking work where the UI cannot accept input                                   | wait                                      |
| Non-interactive content                                                          | default                                   |

Do not use cursor-default on an enabled interactive element. Avoid pointer-events: none on disabled controls when it prevents the not-allowed cursor from being shown; use native disabled, aria-disabled, or the component library's disabled state to block the action. Cursor styling does not replace semantic HTML, keyboard interaction, focus states, or accessible names.

## Validation Guidelines

The repository does not currently maintain automated test suites. Validate changes with `one check`, `pnpm one:verify`, and the relevant application build. CI retains lint, formatting, type checks, builds, and security scans.

## Commit & Pull Request Guidelines

Follow Conventional Commits (e.g. `feat(frontend-main): add download queue UI`) and use `pnpm commit` (Commitizen) to stay compliant. Pull requests should summarize the change, link issues with `Closes #123`, note local validation results (`one check`), and attach screenshots or recordings for UI updates. Call out new environment variables, migrations, or follow-up tasks so reviewers can reproduce the setup quickly.
