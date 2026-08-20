# PR 718 Controlled Bilibili E2E Race Design

## Context

The controlled Bilibili extension scenarios need an active loopback tab so the
fixture can inject a deterministic source into `chrome.storage.session`. They
currently reuse the direct-media test page. That page fetches `sample.mp4` as
soon as it loads, so the extension can automatically capture a direct source at
the same time that the fixture writes the controlled Bilibili source.

The two asynchronous writes race. When the direct-media callback finishes after
the controlled injection, the tab contains two sources and its badge becomes
`2`; the helper expects the isolated controlled fixture to have badge `1`.
GitHub Actions exposed this ordering while local repetitions commonly complete
in the opposite order.

## Decision

Give the existing loopback test server a second, neutral page that does not
request any media. `startTestPage()` will continue returning `url` for the
current direct-media page and will additionally return `blankURL` for the
neutral page.

Direct MP4 scenarios will continue to use `url`. Controlled Bilibili scenarios
will use `blankURL` before injecting their source. This removes the competing
automatic capture at its source and keeps the production extension behavior
unchanged.

## Components and Data Flow

`tests/e2e/support/test-page.ts` will serve two routes from the same lifecycle-
managed HTTP server:

- `/` returns the existing page that fetches `sample.mp4` and exposes
  `window.fixtureMediaLoaded`;
- `/blank` returns a simple local HTML document without scripts or media
  requests.

The returned `StartedTestPage` object will expose both route URLs. The extension
runtime fixture continues to start and stop one server. Callers that test real
media capture retain the existing `url`; callers that manually seed controlled
Bilibili state pass `blankURL` to `openControlledBilibiliPopup()`.

No retry, sleep, or relaxed badge assertion is added. The helper keeps requiring
badge `1`, so unexpected additional captures remain visible as failures.

## Error Handling

Unknown paths and non-GET requests retain the existing `404 Not Found`
behavior. Server startup and cleanup semantics remain unchanged. The blank page
contains no external dependencies and therefore introduces no new network or
readiness conditions.

## Testing

Implementation will follow a red-green TDD cycle:

1. Add a focused test that requests the new neutral route and proves its body
   neither references the sample media URL nor contains the media-fetch script.
   This test must fail first because `blankURL` does not yet exist.
2. Implement the neutral route and make the focused test pass while preserving
   the existing media page response and `404` behavior.
3. Switch only the controlled Bilibili callers to `blankURL`.
4. Repeat the previously failing `missing Download ID` Playwright scenario to
   exercise the former race window.
5. Run the complete three-surface Playwright suite, repository checks, and the
   normal unit test suite before completion.

## Scope

This change is limited to E2E support code and tests. It does not change
extension production code, source detection, badge behavior, download imports,
or the existing direct-media E2E coverage.
