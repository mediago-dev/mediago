# Third-party download tools

MediaGo downloads the following executables from pinned upstream GitHub Releases
while preparing build dependencies. The executables are not stored in this
repository. Exact release tags and asset names are recorded in
[`packages/tooling/manifests/runtime-deps.json`](packages/tooling/manifests/runtime-deps.json).

## aria2-next 2.5.5

- Project and corresponding source:
  <https://github.com/AnInsomniacy/aria2-next/tree/v2.5.5>
- Release: <https://github.com/AnInsomniacy/aria2-next/releases/tag/v2.5.5>
- License: GPL-2.0-or-later, with the upstream OpenSSL linking exception
- License text:
  <https://github.com/AnInsomniacy/aria2-next/blob/v2.5.5/COPYING>
- OpenSSL exception:
  <https://github.com/AnInsomniacy/aria2-next/blob/v2.5.5/docs/licenses/OPENSSL.md>

The downloaded executable keeps its upstream contents and is renamed to
`aria2c` or `aria2c.exe` only so existing MediaGo process resolution remains
compatible.

## yt-dlp 2026.08.19

- Project and corresponding source:
  <https://github.com/yt-dlp/yt-dlp/tree/2026.08.19>
- Release: <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19>
- License: the yt-dlp source is dedicated to the public domain under the
  Unlicense; official standalone executables also contain third-party
  components under their respective licenses.
- Standalone executable notices and license texts:
  <https://github.com/yt-dlp/yt-dlp/blob/2026.08.19/THIRD_PARTY_LICENSES.txt>

## Deno 2.9.5

- Project and corresponding source:
  <https://github.com/denoland/deno/tree/v2.9.5>
- Release: <https://github.com/denoland/deno/releases/tag/v2.9.5>
- License: MIT
- License text: <https://github.com/denoland/deno/blob/v2.9.5/LICENSE.md>

MediaGo ships the platform-specific Deno executable as the JavaScript runtime
recommended by yt-dlp for YouTube challenge solving.

## N_m3u8DL-RE 0.6.0-beta

- Project and corresponding source:
  <https://github.com/nilaoda/N_m3u8DL-RE/tree/v0.6.0-beta>
- Release:
  <https://github.com/nilaoda/N_m3u8DL-RE/releases/tag/v0.6.0-beta>
- License: MIT
- License text:
  <https://github.com/nilaoda/N_m3u8DL-RE/blob/v0.6.0-beta/LICENSE>

## MediaGo download engine v0.2.1

The external streaming download engine is distinct from this repository's API
client. Its unmodified v0.2.1 source is rebuilt with Go 1.27.3 for desktop and
container distribution. The build verifies the module checksum recorded in
packages/tooling/src/runtime-deps/rebuild-mediago.go.

- Source: <https://github.com/mediago-dev/mediago-core/tree/v0.2.1>
- License: <https://github.com/mediago-dev/mediago-core/blob/v0.2.1/LICENSE>

## Docker icon

The Docker mark used in the interface comes from [Simple Icons](https://github.com/simple-icons/simple-icons/blob/develop/icons/docker.svg), under [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md). Docker is a trademark of Docker, Inc.

## Jellyfin FFmpeg 8.1.3-1 (Docker)

Docker images use the official GPL portable Linux AMD64 or ARM64 build from
<https://github.com/jellyfin/jellyfin-ffmpeg/releases/tag/v8.1.3-1>.
The archive and license SHA-256 checksums are pinned in
`packages/tooling/src/runtime-deps/install-docker-ffmpeg.sh`.
The portable executables keep their bundled codec libraries and GNU libiconv;
they only use the image's compatible glibc runtime, not distro codec libraries.

- Corresponding source and dependency build revisions:
  <https://github.com/jellyfin/jellyfin-ffmpeg/tree/v8.1.3-1>
- FFmpeg build license: GPL-3.0-or-later. Bundled components retain their own
  licenses: <https://github.com/jellyfin/jellyfin-ffmpeg/blob/v8.1.3-1/LICENSE.md>
- The GPL license and exact asset provenance are included in the image under
  `/app/licenses/ffmpeg/`.

Desktop builds continue to use the platform-specific FFmpeg dependency recorded
in `packages/tooling/manifests/runtime-deps.json`.
