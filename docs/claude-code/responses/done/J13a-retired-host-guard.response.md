# J13a-guard — response record (2026-09-08)

**PR:** `claude/j13a-guard-1788900615` → `main`. **Code: one new test file, one fixture, one moved
directory of artifacts, three doc edits. No DB, no migration, no API change, no deploy.**

## Unit 1 — `test/retired-identifiers-guard.test.mjs`

Fixture: `test/fixtures/retired-identifiers.json` — three entries seeded (host
`life-command-center-nine.vercel.app`, path `docs/os/architecture/`, symbol `GOV_STATE_SIGNALS`).

**`life-command-center-production.up.railway.app` was deliberately NOT seeded.** The prompt's seed
table listed it as a dormant Railway service (I16b). Measured before adding it: it is referenced as
a live fallback default in six `api/*.js` files (`ai-read.js`, `comp-reviews.js`, `comps.js`,
`gov-evidence.js`, `metadata-backfill.js`, `query-comps.js`) with no confirmation it is actually
dead. Asserting it retired without verifying would have repeated the exact dated-blocker mistake
CLAUDE.md warns against (§ "RE-MEASURE A DATED BLOCKER BEFORE QUOTING IT") — inside the very guard
built to stop that class. Left out; a future unit can add it once someone actually probes it.

**Scan:** `git ls-files` (tracked only), every file type, case-insensitive, NUL-byte sniff to skip
binaries (the moved `.zip`s), JS/TS-family comment-stripped (same order rule as
`test/extension-intake-host.test.mjs`: line comments first, then block comments). Exempt by
directory (`docs/history/`, `docs/archive/`, `docs/audits/`, `docs/claude-code/`,
`docs/ops-logs/`, `outputs/`, `audit/`, `docs/capital-markets/`), by a `STALE (DOCMAP…`/`RETIRED`
banner in the first 40 lines, by two top-level doc files (`CLAUDE.md`,
`docs/os/PLANNED-BACKLOG.md`, `docs/os/FLOW-REGISTRY.yaml`), by a short list of specific
`docs/architecture/` investigation reports that document a retirement as their own dated finding
(`flows/FLOW_CHANGES_LOG.md`, `lcc-microsoft-copilot-outlook-audit-2026-05-22.md`,
`power-automate-api-html-triage-2026-08-11.md`, `edge-function-deploy-drift.md`) and
`docs/os/DOCUMENTATION-MAP.md` (documents the DOCMAP1 merge in the past tense), and by a two-row
allowlist keyed by path with a reason and a re-measure date.

**Measurement (first real run, before the allowlist/exemptions were tuned):** tracked 4,482,
scanned 4,399 (non-binary), hits before tuning: 20 → 9 (after dropping the unverified Railway
host) → 2 (after JS/TS comment-stripping + the four narrow doc exemptions) → 0 (after the
two-row allowlist).

**Final state:** `tracked=4482 scanned=4399 hits=0 exempt=76 allowlisted=2`.

**Allowlist (2 entries):**
- `wave0-config-values.txt` / `life-command-center-nine.vercel.app` — SEC2, a tracked plaintext
  secrets/config dump Scott has deferred a decision on; out of scope here.
- `test/sf-deal-promotion.test.mjs` / `GOV_STATE_SIGNALS` — the test's own assertion is
  `assert.equal('GOV_STATE_SIGNALS' in mod, false)`; naming the retired symbol IS the regression
  check (DRIFT1-routing-gap), not a stale reference.

**Seen RED:** removed the `wave0-config-values.txt` allowlist entry, re-ran —
`hits=1 allowlisted=1`, assertion failed naming exactly that file. Restored, re-ran green. (Pasted
in the working transcript; not re-pasted here to keep this record short — reproducible with
`git stash` on the allowlist array.)

Positive controls (in the test file, always run): a synthetic file containing a retired host is
flagged; the same content under `docs/history/` is exempt; the same content under a
`STALE (DOCMAP…` banner is exempt. A fourth test asserts every allowlist entry still actually
contains the identifier it excuses (no stale entries).

## Unit 2 — archived artifacts

Referrers grepped first for each artifact (`.md` files naming the path). Moved to
`docs/archive/retired-vercel-artifacts/` (git mv, byte-identical, never hand-edited):

| artifact | referrers found | disposition |
|---|---|---|
| `flow-loopnet-backfill.json` | `INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`, `scott-pa-flows-reference.md`, `STATUS.md`, backlog | moved |
| `flow-rcm-backfill.json` | same + `04_Comps_Tools_Revised_Architecture.md` | moved |
| `flow-a-lcc-stage-om-http.json` | same + `LCC_OneDrive_Upload_Setup_2026-04-21.md` | moved |
| `copilot_studio_manifest/manifest.json`, `ai-plugin.json`, `LCC-Assistant.zip` (embeds both) | `ROLLOUT_STATUS.md`, `connector-upload-walkthrough-2026-08-02.md`, `COPILOT_STUDIO_SETUP.md`, `lcc-agent/README.md`, `openapi-legacy/README.md` | moved |
| `lcc-agent/appPackage/manifest.json` | none beyond the above (nested path) | moved |
| `lcc-agent/appPackage/build/manifest.dev.json`, `build/appPackage.dev.zip` (embeds the dev manifest) | generated Teams-Toolkit build output, no doc referrers | moved |

`scripts/build_canonical_connector.py` reads only
`docs/setup/copilot_studio_manifest/{replacement-files,lcc-agent/appPackage}/openapi.json` — neither
carried the retired host, and both were left in place; the script's build path is unaffected.

All referrer docs above are historical/procedural narrative already inside exempt directories or
carrying no live directive to re-point (they cite the artifact by its original path as a record,
per the README's reconciliation table) — none needed editing in this change.

## Unit 3 — docs wired

- `CLAUDE.md` § "GREP THE HOSTNAME, NOT THE BRAND" — one paragraph: the guard exists, where the
  list lives, the rule for adding an identifier (edit the fixture, never widen the exempt set).
- `docs/os/PLANNED-BACKLOG.md` — J13a-guard row marked ✅ shipped with the final numbers and the
  dropped-identifier note; J13 row's machine-artifact half marked ✅ closed (the operator half —
  tearing the Vercel deployment down — stays 👤 open, unchanged).
- `docs/os/DOCUMENTATION-MAP.md` §1a — one sentence pointing at the guard as the enforcement the
  prior correction note lacked.

## Verify

- Guard seen RED (allowlist entry removed) and green (restored).
- Full suite: `npm test` → **5471 pass / 0 fail / 6 skipped**, run after the archive move.
- No file touched outside `test/`, `docs/`, the nine moved artifacts, and `CLAUDE.md`.

---

## Cowork reconcile (2026-09-08, after merge as PR #2181)

**Held.** Ran the guard locally on `main`: 6/6 green, `tracked=4486 scanned=4403 hits=0 exempt=86
allowlisted=2` (the response's 4482/4399/76 were measured before two more PRs landed — not a discrepancy).
My own RED run — a synthetic tracked offender staged under `api/` — failed naming the file. A retired
host in a JS *comment* is not flagged, by design (comment-stripped); the P194 class was code strings.
Every moved artifact's referrer is inside an exempt directory or carries a banner; `scripts/
build_canonical_connector.py` reads only the `openapi.json` siblings, which stayed. The decision **not to
seed `life-command-center-production.up.railway.app` was correct and the prompt's seed row was wrong** —
struck in the prompt. Live Railway `/version` = `dbf37d82` = `main` HEAD, so this PR is already deployed.

**Did not hold — and closed in the same reconcile.** `hasRetirementBanner` tested `/STALE \(DOCMAP|RETIRED/i`
over the first 40 lines of *any* file. 40+ tracked files rode the bare word "retired": live `api/_shared/*.js`,
`dc-lanes.js`, four `.github/workflows/*.yml`, `CURRENT-STATE.md`, `AGENTS.md`, `WRITE_SURFACE_POLICY.md`.
Positive control: appended `export const __PROBE = "https://life-command-center-nine.vercel.app/api/intake"`
to `api/_shared/share-extractor.js` → **suite GREEN, `hits=0`**. That is the P194 shape — a fallback URL in
live code — passing the guard built for it. Fix (this branch): the banner exemption applies to `.md` files
only and requires a blockquote line (`> … STALE (DOCMAP` / `> … RETIRED`); two positive controls added (8
tests); the same probe now fails naming the file; the three correctly-framed docs the word had been carrying
(`INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`, `POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md`,
`DOCMAP1_CLASSIFICATION.md`) are exempted by path with reasons. **"Seen red" on an allowlist removal is not
"seen red" on the defect the guard exists for — positive-control the exemptions, not just the match.**

**Live probes (`net.http_get` from LCC Opps, 21:43–21:44 UTC):** the retired Vercel host serves
`/api/daily-briefing` → 200, briefing generated at that instant (P194 re-measured: it executes against the
DB with its service key today); `/version` → NOT_FOUND only because the route postdates the frozen build.
`life-command-center-production.up.railway.app` → `/health` `lcc-mcp-server 1.0.0`, `/` "Life Command Center
MCP Server", `/api/*` Express 404 — **the live standalone MCP server, not a dormant service** → I16b is now a
Conflict for the Railway dashboard to resolve before anything is deleted.
