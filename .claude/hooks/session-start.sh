#!/bin/bash
# SessionStart hook — install Node dependencies so the test suite
# (node --test) can load exceljs / xlsx / pdf-parse in fresh web
# containers. Without this, tests that import those packages
# (e.g. test/rca-parser.test.js, test/cm-export-bundle-audit.test.js)
# fail with ERR_MODULE_NOT_FOUND and leave the suite red.
set -euo pipefail

# Only needed in the remote (Claude Code on the web) environment, where
# the container is cloned fresh without node_modules. Locally, devs run
# npm install themselves.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent: npm install is a no-op when node_modules is already present
# and in sync with package-lock.json. Prefer install over ci so a cached
# container state is reused rather than wiped.
npm install --no-audit --no-fund
