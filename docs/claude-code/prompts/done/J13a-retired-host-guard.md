# J13a-guard — make the retired-host class un-recurrable (a test, not a fourth sweep)

> **Filed to `done/` 2026-09-08.** Shipped as PR #2181 (`c544a16c`, `b1825b4d`); reconciled the same day — one seed row below was wrong and is struck in place; the guard's banner exemption was tightened after the reconcile found it exempting live code (see the STATUS entry).

> **Three documentation passes found the same defect class three times** — DOCMAP1 (4 STALE), DOCMAP2 (12
> retired-host defects, 2 fixed by the pass), DOCMAP3 (18 fixed) — and nearly every one was
> `life-command-center-nine.vercel.app` stated as a live target. Every fix is a banner a human has to read.
> Meanwhile the hostname still sits inside **importable** artifacts no `.md` sweep can see: three Power Automate
> definitions at repo root and the Copilot Studio agent package (backlog **J13a**). **This unit converts the
> sweep into a CI guard and retires the machine-read copies.** Record: `docs/claude-code/STATUS.md` 2026-09-08
> DOCMAP3-reconcile entry; `docs/os/PLANNED-BACKLOG.md` J13 / J13a / J13a-guard.

**Repo:** `life-command-center` · **Code: one new test file + one small data file. No DB, no migrations, no API
change, no deploy.** Branch → PR → `App boots` + `npm test` green → merge. `npm test` is
`node --test test/*.test.js test/*.test.mjs`, so a new `test/*.test.mjs` is picked up automatically.

**Read first:** `test/sql-definer-privilege-stanza.test.mjs` (the allowlist-that-cannot-rot pattern — copy its
shape: offenders allowlisted BY PATH with a reason, a stale allowlist entry FAILS, positive-controlled both
directions) · `test/extension-intake-host.test.mjs` (already anchors on `RETIRED_HOST`) · `CLAUDE.md` § "GREP THE
HOSTNAME, NOT THE BRAND".

---

## Unit 1 — `test/retired-identifiers-guard.test.mjs`

**The retired-identifier list lives in ONE place the test reads:** `test/fixtures/retired-identifiers.json` —
each entry `{ id, kind, retired, replacement, note }`. Seed:

| id | kind | retired | replacement |
|---|---|---|---|
| `life-command-center-nine.vercel.app` | host | 2026-07-20 | `tranquil-delight-production-633f.up.railway.app` (`server.js` mounts `/api/*`) |
| ~~`life-command-center-production.up.railway.app`~~ | ~~host (dormant Railway service, I16b)~~ | — | ~~same~~ | ⚠️ **Struck by Cowork 2026-09-08 — this seed was WRONG.** CC refused it (six `api/*.js` default `GOV_API_URL` to it, unverified); Cowork then measured it: `/health` → `lcc-mcp-server 1.0.0` — the live standalone MCP server. Never seed a retirement you have not probed. |
| `docs/os/architecture/` | path (merged by DOCMAP1) | 2026-09-08 | `docs/architecture/` |
| `GOV_STATE_SIGNALS` | symbol (merged into `GOV_SIGNALS`) | 2026-09 | `GOV_SIGNALS` |

⚠️ Do **not** seed `Vercel`, `vercel.json`, `SOS-direct`, `CONTACTS_HUB`, `queue_v2_enabled`, `exec_sql` — those are
brand words or live/blocked features, and DOCMAP3 recorded five of them as read-clean RESULTS. The guard is for
**machine identifiers with a known replacement**.

**Scan:** every file `git ls-files` returns (not a `readdirSync` walk — untracked and ignored files are not the
repo), **every file type**, **case-insensitive**, binary files skipped by a NUL sniff (zips are covered by Unit 2,
not by this test). Fail on any hit **outside** the exempt set:

- directories that are history by construction: `docs/history/`, `docs/archive/`, `docs/audits/`,
  `docs/claude-code/`, `docs/ops-logs/`, `outputs/`, `audit/`, `docs/capital-markets/`;
- any file whose first 40 lines contain `STALE (DOCMAP` or `RETIRED` in a blockquote banner — a bannered doc is a
  correctly-framed record, not a defect;
- the fixture itself, this test, `test/extension-intake-host.test.mjs`, `extension/background.js` (its comment IS
  the guard), `supabase/migrations/20261002090000_lcc_p194_intake_extraction_provenance.sql` (comment);
- `CLAUDE.md`, `docs/os/PLANNED-BACKLOG.md`, `docs/os/FLOW-REGISTRY.yaml` — the places that *document* the
  retirement (the registry's `exported_endpoint` lines for the dormant Railway host are tracked state, I16b).

**Allowlist, BY PATH, with a reason** — the pre-existing offenders as of the day you run it. Expected from the
2026-09-08 measurement (re-measure; do not copy): `wave0-config-values.txt` (SEC2, tracked plaintext — do not
touch here), and whatever Unit 2 has not yet moved. **A stale allowlist entry fails the test.**

**Positive controls, both directions, in the test file:** (a) a synthetic in-memory "file" containing the host
is flagged; (b) the same content under a `docs/history/` path, and with a `STALE (DOCMAP` banner, is not.

**State the count:** the response reports `tracked files scanned / hits / exempt / allowlisted / failing` — five
numbers. The first run must be **green with the allowlist populated**, and you must show one run **red** with an
allowlist entry removed (paste the failing assertion) before it ships.

## Unit 2 — retire the machine-read copies (measure referrers first)

Repo-root Power Automate definitions and the Copilot Studio package still carry the retired host:

- `flow-loopnet-backfill.json`, `flow-rcm-backfill.json` (`uri` → `…/api/loopnet-ingest`, `…/api/rcm-ingest`),
  `flow-a-lcc-stage-om-http.json` (`LccHost` variable);
- `docs/setup/copilot_studio_manifest/manifest.json`, `ai-plugin.json`, `lcc-agent/appPackage/manifest.json`,
  `lcc-agent/appPackage/build/manifest.dev.json`, and four URLs inside `LCC-Assistant.zip`
  (`websiteUrl` / `privacyUrl` / `termsOfUseUrl` / `api/copilot-spec`).

**For each: `grep -rn <filename>` across every tracked file first.** Known referrers to re-point or annotate
(2026-09-08): `docs/architecture/flows/google-news-alert-power-automate.md`,
`docs/architecture/INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`, `docs/architecture/scott-pa-flows-reference.md`,
`docs/comps-tools/04_Comps_Tools_Revised_Architecture.md`, `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md`
(flow JSONs); `docs/setup/COPILOT_STUDIO_SETUP.md`, `docs/audits/ROLLOUT_STATUS.md`,
`docs/comps-rollout/connector-upload-walkthrough-2026-08-02.md`, **`scripts/build_canonical_connector.py`**
(Copilot package — ⚠️ a script reads this directory; read the script before moving anything it opens).

Then **move, don't edit**: `git mv` each artifact to `docs/archive/retired-vercel-artifacts/<original-path>` and
write `docs/archive/retired-vercel-artifacts/README.md` in the style of `docs/archive/openapi-legacy/README.md`
— original path → archived name, the live equivalent for each (the Railway route in `server.js`; for the
Copilot package, the canonical `copilot/lcc-deal-intelligence.connector.v1.swagger.json` and the current host),
and *"do not re-import; re-export the live flow instead"*. **Never hand-edit a flow definition's `uri`** — a
re-imported flow must come from a fresh export of the live flow (J14 / PA5 own that side).

If a referrer is live code (the `scripts/build_canonical_connector.py` case), **stop and report** rather than
move — file it, do not break a build to satisfy a doc guard.

## Unit 3 — wire the docs

- `CLAUDE.md` § "GREP THE HOSTNAME, NOT THE BRAND": append one line — the guard exists, where the list lives,
  how to add an identifier (edit the fixture; never widen the exempt set to silence a hit).
- `docs/os/PLANNED-BACKLOG.md`: J13a → ✅ for the repo half; J13 stays 👤 (teardown). `docs/os/DOCUMENTATION-MAP.md`
  §1a: one sentence pointing at the guard as the enforcement DOCMAP1–3 lacked.

---

## Out of scope — say so, do not drift

- **Tearing down `life-command-center-nine.vercel.app`** (J13 👤 — Scott; it still holds an LCC Opps service key).
- Repointing any **live** Power Automate flow, or editing `FLOW-REGISTRY.yaml`.
- `wave0-config-values.txt` (SEC2 — a secrets decision, deferred by Scott).
- DOCMAP4 (canon block facts, the 87 title+skim rows, `AI_CHAT_ROLLOUT_CHECKLIST` policy claim, `SPEC_forsale` B/C).

## Deliverables

1. The test, the fixture, the five scan numbers, one red run and one green run (pasted).
2. Unit 2: per artifact — referrers found, moved or held (with the reason), README written.
3. Response in `docs/claude-code/responses/J13a-retired-host-guard.response.md`; dated STATUS entry.

## Verify on

- **The guard has been seen RED** on a real removal, not only green.
- Every allowlist entry carries a reason and a re-measure date.
- `npm test` green on the PR; no file outside `test/`, `docs/`, the moved artifacts and `CLAUDE.md` touched.
