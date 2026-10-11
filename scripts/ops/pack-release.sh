#!/usr/bin/env bash
# Packs the working tree (tracked + untracked, honouring .gitignore) into release.tgz for upload
# to a server. Secrets (.env), node_modules, build output and evidence media are excluded by
# .gitignore; docs/ and experiments/ are left out because the server does not need them.
# NUL-separated paths keep non-ASCII file names intact.
set -euo pipefail
cd "$(dirname "$0")/../.."
git ls-files -z -co --exclude-standard \
  | grep -zvE '^(docs/|experiments/|backups/|postgres-data/)' \
  | tar --null -czf release.tgz -T -
ls -lh release.tgz
