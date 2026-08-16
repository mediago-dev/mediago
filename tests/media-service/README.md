# Synthetic media fixture

This directory contains a one-second, 160×90 H.264/AAC test pattern generated
entirely by FFmpeg. It does not download or incorporate copyrighted source
media.

Generate a version explicitly from the repository root:

```sh
pnpm exec tsx tests/media-service/generate.ts --version v1
```

Fixture versions are immutable. Regenerating byte-identical files is a safe
no-op; different output fails without overwriting the committed version, so use
a new version instead.

`startMediaServer()` in `server.ts` exposes the committed allowlist as a
read-only loopback HTTP service for tests. A published copy should remain
read-only and can be checked against the committed manifest with:

```sh
pnpm exec tsx tests/media-service/verify.ts https://example.test/v1
```
