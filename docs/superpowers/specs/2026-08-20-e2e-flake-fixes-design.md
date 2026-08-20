# E2E Flake Fixes Design

## Problem

PR 718 reaches the Playwright suite but intermittently fails in two test-only paths:

- The Electron direct-download test uses an unscoped `New download` role locator followed by `.first()`. The page renders several controls with that accessible name, including a responsive mobile control that is hidden at the CI viewport.
- The controlled Bilibili extension fixture opens the same loopback page used for direct-media sniffing. Its manual `chrome.storage.session` write can race the extension sniffer's queued read/merge/write and be replaced by the direct MP4 source. A badge value of `1` cannot distinguish those states.

The product behavior is out of scope. This change only makes the automated tests deterministic.

## Design

### Electron locator

Scope the `New download` lookup to the page's `main` landmark before clicking it. This excludes the responsive control owned by `AppLayout` and selects an actionable control rendered by the current route. Do not add product-only test IDs or change UI markup.

### Controlled Bilibili fixture

Use a quiet loopback document that cannot emit a media request instead of the direct-media fixture page. After bringing that document to the front:

1. Resolve the active tab once in the extension worker.
2. Write the controlled Bilibili source for that exact tab and return its ID.
3. Poll the badge and stored sources for that exact ID, requiring the expected Bilibili source rather than accepting any count of one.
4. Bring the controlled page to the front immediately before refreshing the popup so the popup reads the same tab.

The quiet page remains local, preserving the existing no-external-network E2E policy. The extension's runtime behavior and storage implementation are unchanged.

## Testing

Add focused contracts that fail against the current ambiguous locator and badge-only fixture. After the minimal test-only changes:

- run the focused contracts;
- run the two previously failing Playwright cases with `--repeat-each=10` and one worker;
- run the complete Xvfb-backed E2E entry when its required ports are available;
- run E2E type checking, formatting, linting, and diff checks.

Port 9900 is owned by an existing user process on the current host. Verification must not terminate or modify that process; if it remains occupied, report the unrelated Web-project preflight failure separately from the Electron and extension results.
