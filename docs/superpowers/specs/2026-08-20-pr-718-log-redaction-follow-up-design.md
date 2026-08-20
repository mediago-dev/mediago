# PR 718 Downloader Log Redaction Follow-up Design

## Context

The downloader currently builds executable arguments correctly, then creates a
redacted copy for the debug log. That redactor recognizes cookies, headers, and
some proxy credentials, but ordinary download URLs and proxy path or query
values can still reach the log. Signed media URLs and query-based proxy
credentials must never be exposed.

## Decision

Stop logging the reconstructed command argument array. Emit a small set of
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

The original argument slice passed to the downloader process is unchanged.

## Error Handling and Security Properties

All sanitizers fail closed. Parse or validation failures produce `[REDACTED]`
rather than falling back to the original input. No generic command parameter
value is included in the debug entry, so future schemas do not become logging
leaks by default.

## Testing

The implementation will follow a red-green TDD cycle:

1. Capture the real `Command arguments built` debug entry from `Download`.
2. Use sentinel secrets in the download URL userinfo, path, query, fragment,
   proxy query, header values, and ordinary argument values.
3. Verify the failing test demonstrates that current logging exposes them.
4. Implement the structured fields and verify no sentinel appears.
5. Assert that the URL origin and valid header names remain available, the
   proxy is represented only as a boolean, and the runner still receives the
   original executable arguments.
6. Run the focused Go package tests, formatting, repository quality checks, and
   the full test suite before completion.

## Scope

This follow-up changes only downloader debug logging and its Go regression
tests. It does not change download execution, persistence, proxy behavior,
schema construction, or unrelated logging.
