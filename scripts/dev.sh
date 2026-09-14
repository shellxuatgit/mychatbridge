#!/usr/bin/env bash
# Unix development wrapper.
# Cross-platform npm users should use `npm run dev`, which invokes scripts/dev.mjs
# and therefore does not require bash/WSL on Windows.

set -e
cd "$(dirname "$0")/.."
exec node scripts/dev.mjs "$@"
