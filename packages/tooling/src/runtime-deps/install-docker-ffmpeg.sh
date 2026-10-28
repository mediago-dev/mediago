#!/bin/sh
# Keep FFmpeg's bundled codecs/iconv together; do not mix in distro codec libraries.
set -eu

output=${1:?Usage: install-docker-ffmpeg.sh OUTPUT_DIRECTORY}
case "$output" in
  /*) [ "$output" != / ] || exit 2 ;;
  *) echo 'The runtime output must be an absolute directory' >&2; exit 2 ;;
esac

version=8.1.3-1
architecture=$(dpkg --print-architecture)
case "$architecture" in
  amd64) platform=linux64; checksum=b86dc023c64a5a9a410e6e3a938a970460214fae78f31c1553c9f88f1c289b6a ;;
  arm64) platform=linuxarm64; checksum=7bc8e8d0986f7f4693f63e9728570f671f07b6e21c05d5465dd7ce461d1631dc ;;
  *) echo "Unsupported Docker FFmpeg architecture: $architecture" >&2; exit 2 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
archive="$work/jellyfin-ffmpeg.tar.xz"
asset="jellyfin-ffmpeg_${version}_portable_${platform}-gpl.tar.xz"
url="https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v${version}/${asset}"
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 \
  --max-time 300 --proto '=https' --proto-redir '=https' "$url" --output "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status

# This pinned upstream archive contains exactly these two root-level executables.
tar -tJf "$archive" | sort > "$work/members"
printf 'ffmpeg\nffprobe\n' > "$work/expected-members"
cmp "$work/members" "$work/expected-members"
mkdir -p "$output/usr/lib/jellyfin-ffmpeg" "$output/app/deps" "$output/app/licenses/ffmpeg"
tar -xJf "$archive" --no-same-owner --no-same-permissions -C "$output/usr/lib/jellyfin-ffmpeg"
for binary in ffmpeg ffprobe; do
  chmod 755 "$output/usr/lib/jellyfin-ffmpeg/$binary"
  ln -s "/usr/lib/jellyfin-ffmpeg/$binary" "$output/app/deps/$binary"
done
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 \
  --max-time 60 --proto '=https' --proto-redir '=https' \
  "https://raw.githubusercontent.com/jellyfin/jellyfin-ffmpeg/v${version}/COPYING.GPLv3" \
  --output "$output/app/licenses/ffmpeg/COPYING.GPLv3"
printf '%s  %s\n' 8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903 \
  "$output/app/licenses/ffmpeg/COPYING.GPLv3" | sha256sum --check --status
printf 'Jellyfin FFmpeg: %s\nArchitecture: %s\nAsset: %s\nSHA-256: %s\nSource: https://github.com/jellyfin/jellyfin-ffmpeg/tree/v%s\n' \
  "$version" "$architecture" "$asset" "$checksum" "$version" \
  > "$output/app/licenses/ffmpeg/BUILD-INFO"
printf 'Collected Jellyfin FFmpeg %s portable build for %s\n' "$version" "$architecture"
