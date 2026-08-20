# PR 718 Review Fixes Design

## Goal

Close the four unresolved review findings on PR 718 without changing public download behavior, blocking browser navigation on network access, weakening dependency provenance, or excluding portable tests from the default suite.

## Header redaction

Downloader arguments remain unchanged when passed to child processes. The copy written to logs treats every syntactically valid HTTP header value as sensitive: it retains the validated field name and replaces the complete value with `[REDACTED]`. Malformed header arguments remain fully redacted. Tests cover standard, authentication, and arbitrary custom header names and verify that executable arguments are not mutated.

## Ad-blocker loading and cache

Browser navigation never awaits rule loading. Once the initial Go configuration has seeded the Electron cache, enabling ad blocking starts a single background load. A serialized blocker cache under Electron's `userData` directory supplies rules immediately on later starts. Fresh caches are used directly; stale caches are used immediately and refreshed in the background with a bounded fetch. A missing or invalid cache triggers the same bounded background download. Cache writes are atomic, refresh failures retain the last usable cache, and transient failures may be retried.

The cache contains only the public EasyList-derived blocking engine and is shared across persistent and privacy browser sessions. A versioned filename invalidates incompatible cache formats. The freshness interval is 24 hours and network attempts are bounded to 10 seconds.

## Runtime dependency integrity

Every asset selected from `scripts/deps-versions.json` must have a pinned lowercase SHA-256 value for the same platform key. Missing or malformed values fail before a cached file is reused or a downloaded candidate is installed. A manifest contract test checks exact platform-key coverage. Hashes come from publisher release metadata where available and otherwise from a controlled download of the exact pinned release asset.

## Cross-platform tests and canonical paths

Only suites whose helper contract explicitly requires `linux-x64` are skipped on other hosts. Portable support tests remain in the root Vitest suite. Filesystem-backed pnpm shim validation performs a read-only probe (`realpath`, `lstat`, and optional marker reading; never process execution) of a syntactically valid declared target, then performs its trust-boundary check using the canonical real paths of both shim and target. An escaping target may be inspected to obtain its canonical path but is never returned as an executable entrypoint. This preserves symlink-escape rejection while treating macOS `/var` and `/private/var` aliases consistently.

## Verification

Each behavior is introduced through a failing regression test, followed by the smallest implementation needed to pass it. Focused Go and Vitest suites run after each item, followed by repository formatting, type checks, linting, Go tests, and the root TypeScript test suite.
