# Prompt 86 — [DIALYSIS REPO] Fix the Railway deploy failure introduced by the FRED API changes

**Run this in Claude Code against the DIALYSIS repo (not life-command-center).**

**Grounding (2026-08-08):** the Railway `dialysis` service (auto-deploys from dialysis-repo `main`)
has a FAILED deployment with **no build logs produced**, first failing on the deploy triggered by
the FRED API changes. The previously-running deployment is still serving (verified: dia listing
verification 12:17 UTC + property updates 12:38 UTC today are fresh) — so this is a broken rollout,
not an outage; new code (including the FRED work) is NOT live.

"No logs were built" = the build died at the CONFIGURATION stage, before any step could log.
Typical causes, in likelihood order for this signature:

1. A malformed build-definition edit in the FRED commit: `nixpacks.toml` / `railway.json` /
   `Procfile` / start-command syntax.
2. A broken dependency entry added for the FRED client (`requirements.txt` / `pyproject.toml` —
   bad version pin, typo, or a private/nonexistent package).
3. A build-time reference to a new env var (e.g. `FRED_API_KEY`) that the service doesn't have set,
   used somewhere the build plan evaluates.

## Do

1. `git log` the commits since the last SUCCESSFUL deploy; diff the FRED commit(s) specifically for
   changes to build-definition files and dependency manifests. Lint/validate them
   (`nixpacks.toml` TOML-parse, `railway.json` JSON-parse, requirements resolvable).
2. Fix the defect; if the FRED work needs a new env var at RUNTIME, gate it so absence = feature
   off (registered per the inert-feature registry convention), never a boot/build failure — and
   list the env vars Scott must set on the Railway service before enabling.
3. Verify the build locally to the extent possible (`pip install -r requirements.txt` in a clean
   venv / nixpacks plan if available), commit with the repo trailer, push — Railway auto-deploys;
   Scott confirms the new deployment goes green and `dia` freshness continues.
4. Also confirm the FRED ingestion itself carries its own `timeout=` on every network call (the
   repo's SIGALRM footgun) and honest no-key no-op.

Acceptance: green Railway deployment from dialysis main; FRED feature flag-gated + documented;
data freshness unbroken.
