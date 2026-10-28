#!/bin/sh
# Install the pinned Docker FFmpeg build and collect its complete runtime closure.
set -eu

output=${1:?Usage: install-docker-ffmpeg.sh OUTPUT_DIRECTORY}
case "$output" in
  /*) [ "$output" != / ] || exit 2 ;;
  *) echo 'The runtime output must be an absolute directory' >&2; exit 2 ;;
esac

version=8.1.3-1
architecture=$(dpkg --print-architecture)
case "$architecture" in
  amd64) checksum=fbef9f81a53e175194e3f67832618a86111f7bd37197df21a5d748c34289f9c0 ;;
  arm64) checksum=4af743bd776eda082d40c851a4201e51a77a258145dd6ebe164dade39b35b2d0 ;;
  *) echo "Unsupported Docker FFmpeg architecture: $architecture" >&2; exit 2 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
archive="$work/jellyfin-ffmpeg.deb"
asset="jellyfin-ffmpeg8_${version}-trixie_${architecture}.deb"
curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 \
  --max-time 300 --proto '=https' --proto-redir '=https' \
  "https://github.com/jellyfin/jellyfin-ffmpeg/releases/download/v${version}/${asset}" \
  --output "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
[ "$(dpkg-deb --field "$archive" Package)" = jellyfin-ffmpeg8 ]
[ "$(dpkg-deb --field "$archive" Version)" = "${version}-trixie" ]
[ "$(dpkg-deb --field "$archive" Architecture)" = "$architecture" ]
apt-get install -y --no-install-recommends "$archive"

mkdir -p "$output/usr/lib" "$output/app/deps" "$output/var/lib/dpkg/status.d"
cp --parents -a /usr/lib/jellyfin-ffmpeg "$output/"
printf '%s\n' jellyfin-ffmpeg8 > "$work/packages"
: > "$work/libraries"
for binary in ffmpeg ffprobe; do
  ldd "/usr/lib/jellyfin-ffmpeg/$binary" > "$work/ldd"
  if grep -q 'not found' "$work/ldd"; then
    cat "$work/ldd" >&2
    exit 1
  fi
  awk '$2 == "=>" && $3 ~ /^\// { print $3 } $1 ~ /^\// { print $1 }' \
    "$work/ldd" >> "$work/libraries"
  ln -s "/usr/lib/jellyfin-ffmpeg/$binary" "$output/app/deps/$binary"
done
sort -u "$work/libraries" > "$work/sorted-libraries"
while IFS= read -r library; do
  case "$library" in /usr/lib/jellyfin-ffmpeg/*) continue ;; esac
  resolved=$(readlink -f "$library")
  destination="$(readlink -f "$(dirname "$library")")/$(basename "$library")"
  # Keep the SONAME at its canonical directory; do not copy host /lib symlinks.
  cp --parents -L --preserve=mode,timestamps "$destination" "$output/"
  package=''
  for candidate in "$resolved" "$destination" "${destination#/usr}"; do
    package=$(dpkg-query --search "$candidate" 2>/dev/null | sed -n '1s/: \/.*$//p')
    [ -z "$package" ] || break
  done
  if [ -z "$package" ]; then
    echo "No package metadata found for runtime library: $library" >&2
    exit 1
  fi
  printf '%s\n' "$package" >> "$work/packages"
done < "$work/sorted-libraries"
sort -u "$work/packages" > "$work/sorted-packages"
while IFS= read -r package; do
  name=${package%%:*}
  dpkg-query --status "$package" > "$output/var/lib/dpkg/status.d/$name"
  if [ -f "/usr/share/doc/$name/copyright" ]; then
    mkdir -p "$output/app/licenses/ffmpeg-runtime/$name"
    cp -L "/usr/share/doc/$name/copyright" "$output/app/licenses/ffmpeg-runtime/$name/copyright"
  fi
done < "$work/sorted-packages"
printf 'Collected Jellyfin FFmpeg %s for %s with matching runtime libraries\n' "$version" "$architecture"
