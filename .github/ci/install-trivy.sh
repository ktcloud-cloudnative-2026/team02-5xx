#!/usr/bin/env bash
set -euo pipefail
trivy_dir="${RUNNER_TEMP:?RUNNER_TEMP is required}/peakorder-trivy"
mkdir -p "$trivy_dir/bin"
curl --fail --silent --show-error --location --retry 3 --max-time 180 \
  'https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz' \
  --output "$trivy_dir/trivy.tar.gz"
printf '%s  %s\n' \
  'bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf' \
  "$trivy_dir/trivy.tar.gz" | sha256sum --check --strict
tar -xzf "$trivy_dir/trivy.tar.gz" -C "$trivy_dir/bin" trivy
"$trivy_dir/bin/trivy" --version
