#!/usr/bin/env bash
# Validates the EKS demo app's two collector configs (upgrades/demo) with the
# real otelcol-contrib binary of the pinned release: downloads it once into
# ${OTELCOL_CACHE:-$HOME/.cache/cloudspider/otelcol}, then runs
# test/demo-otel.test.js with OTELCOL_CONTRIB set. Needs network once and
# `npm ci` in upgrades/demo. Reads nothing from AWS or any cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p 'require("./test/fixtures/otelcol-contrib-components.json").version')
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) plat=linux_amd64 ;;
  Linux-aarch64) plat=linux_arm64 ;;
  Darwin-arm64) plat=darwin_arm64 ;;
  Darwin-x86_64) plat=darwin_amd64 ;;
  *) echo "no otelcol-contrib build for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac
dir=${OTELCOL_CACHE:-$HOME/.cache/cloudspider/otelcol}/$version-$plat
if [ ! -x "$dir/otelcol-contrib" ]; then
  mkdir -p "$dir"
  curl -fsSL "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$version/otelcol-contrib_${version}_${plat}.tar.gz" | tar -xz -C "$dir" otelcol-contrib
fi
OTELCOL_CONTRIB="$dir/otelcol-contrib" node --test test/demo-otel.test.js
