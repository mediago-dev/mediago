# PR 718 Downloader Log Redaction Follow-up Design

## Context

The downloader currently logs the complete download URL when a task starts. It
later builds executable arguments correctly, then creates a redacted copy for
the debug log. That redactor recognizes cookies, headers, and some proxy
credentials, but ordinary download URLs and proxy path or query values can
still reach the log. Signed media URLs and query-based proxy credentials must
never be exposed by either downloader log entry.

## Decision

Replace the complete URL in `Starting download task` with its sanitized origin
and remove the download name from that entry. Stop logging the reconstructed
command argument array in `Command arguments built`. Emit a small set of
structured diagnostic fields derived from the typed download inputs instead:

- `arg_count`: the number of executable arguments, without their values;
- `url_origin`: only the parsed URL scheme and host;
- `header_names`: syntactically valid HTTP header field names;
- `proxy_configured`: whether a non-empty proxy is enabled.

This keeps the information needed to identify the target service and request
shape while making parameter-value logging default-deny.

## Data Handling

URL sanitization accepts only a URL with a scheme and host. It removes userinfo,
path, raw path, query, fragment, and every other value-bearing component. An
invalid or incomplete URL is represented as `[REDACTED]`.

Header sanitization reuses the existing HTTP field-name validation. Valid names
are retained without values; malformed entries are represented as
`[REDACTED]`. Duplicate names may remain because they describe the actual
request shape and contain no values.

Proxy diagnostics expose only a boolean. The proxy URL itself is never parsed
for logging and never appears in a log field.

The task ID and download type remain available in the start entry. The original
argument slice passed to the downloader process is unchanged.

## Error Handling and Security Properties

All sanitizers fail closed. Parse or validation failures produce `[REDACTED]`
rather than falling back to the original input. No generic command parameter
value is included in either downloader entry, so future schemas do not become
logging leaks by default.

## Testing

The implementation will follow a red-green TDD cycle:

1. Capture every log entry emitted by a real `Download` call, including
   `Starting download task` and `Command arguments built`.
2. Use sentinel secrets in the download URL userinfo, path, query, fragment,
   proxy query, header values, download name, and ordinary argument values.
3. Verify the failing test demonstrates that current logging exposes them.
4. Implement the structured fields and verify no sentinel appears anywhere in
   the captured log output.
5. Assert that the URL origin and valid header names remain available, the
   proxy is represented only as a boolean, `arg_count` is exact, and the legacy
   `args` field is absent.
6. Add table-driven unit cases for valid, incomplete, and malformed URLs and
   for valid and malformed Header lines. Invalid inputs must produce
   `[REDACTED]` without retaining any partial value.
7. Cover proxy diagnostics when proxy use is disabled, enabled with an empty
   value, and enabled with a non-empty value.
8. Assert that the runner still receives the original executable arguments.
9. Run the focused Go package tests, formatting, repository quality checks, and
   the full test suite before completion.

## Scope

This follow-up changes only the task-start and command-argument diagnostics in
`DownloaderSvc.Download` and their Go regression tests. It does not change
download execution, persistence, proxy behavior, schema construction, or
unrelated logging.
