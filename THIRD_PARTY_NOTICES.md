# Third-party download tools

MediaGo downloads the following executables from pinned upstream GitHub Releases
while preparing build dependencies. The executables are not stored in this
repository. Exact release tags and asset names are recorded in
[`scripts/deps-versions.json`](scripts/deps-versions.json).

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

## yt-dlp 2026.07.04

- Project and corresponding source:
  <https://github.com/yt-dlp/yt-dlp/tree/2026.07.04>
- Release: <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04>
- License: the yt-dlp source is dedicated to the public domain under the
  Unlicense; official standalone executables also contain third-party
  components under their respective licenses.
- Standalone executable notices and license texts:
  <https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/THIRD_PARTY_LICENSES.txt>

## N_m3u8DL-RE 0.6.0-beta

- Project and corresponding source:
  <https://github.com/nilaoda/N_m3u8DL-RE/tree/v0.6.0-beta>
- Release:
  <https://github.com/nilaoda/N_m3u8DL-RE/releases/tag/v0.6.0-beta>
- License: MIT
- License text:
  <https://github.com/nilaoda/N_m3u8DL-RE/blob/v0.6.0-beta/LICENSE>
