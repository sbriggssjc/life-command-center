# DOCMAP2 response — retired-dependency sweep (2026-09-08)

> **Reconciled by Cowork 2026-09-08 (verification window), against `git grep` at the base commit `c69ca680` and
> `grep -r` over every file type on `main` after merge.** All seven term counts, the 855 scope and the 232
> reproduce exactly. Five claims below were false or overstated and are **struck in place with the measurement
> attached** — never deleted. Headline: the `Vercel` term was grepped **case-sensitively**, so the six flow docs
> that carry the retired host only inside a lowercase URL were never candidates; **the real defect count for the
> retired host in the swept scope is 12 (2 fixed by this PR, 10 fixed since — 6 by DOCMAP3, 4 by the Cowork
> reconcile), not 2.** Full accounting: `docs/claude-code/STATUS.md` 2026-09-08 DOCMAP2-reconcile entry.

Scope executed: Unit 1 (retired-term grep sweep), Unit 2 (`docs/audits/` banner), Unit 3 (repo-root
`.md` classification). Unit 1b (deep-read of the highest-consequence files) **NOT reached** — see
§4 boundary.

## 1. Unit 1 — retired/renamed-term sweep

Scope: `find docs -name '*.md' ! -path 'docs/history/*' ! -path 'docs/capital-markets/*'` = **855
files**.

| term | files mentioning | defects confirmed | defects fixed |
|---|---:|---:|---:|
| `Vercel` (`life-command-center-nine.vercel.app` as a LIVE endpoint) | 59 — **case-sensitive; `grep -i vercel` = 76, and the retired HOSTNAME itself = 23 files** | ~~**2**~~ **12 of the 23 hostname hits** (Cowork read all 23: 12 defects · 11 correctly-framed history) | **2** by this PR → 12 after DOCMAP3 + the Cowork reconcile |
| `vercel.json` | 17 | 0 (all historical/retirement narrative — `RAILWAY_DEPLOYMENT.md`, `infrastructure-topology.md` correctly framed as "Why LCC moved off Vercel") | — |
| `SOS-direct` | 18 | not evaluated past a listing scan | — |
| `CONTACTS_HUB` | 13 | not evaluated past a listing scan | — |
| `owner-contact-websearch` | 6 | not evaluated past a listing scan | — |
| `GOV_STATE_SIGNALS` | 6 | not evaluated past a listing scan | — |
| `queue_v2_enabled` | 7 | not evaluated past a listing scan | — |
| `exec_sql` | 5 | not evaluated past a listing scan | — |

### The two confirmed and fixed defects

`docs/architecture/flows/rcm-power-automate.md` and `docs/architecture/flows/loopnet-power-automate.md`
each stated the live POST endpoint as `https://life-command-center-nine.vercel.app/api/…-ingest`.
That host is the retired Vercel deployment — root `CLAUDE.md` states it was retired 2026-07-20 and
P194 documents that it **still answers and still holds a service key**, so a Power Automate flow
built from this doc would silently write against a frozen pre-cutover build rather than failing.
This is not a new discovery — `docs/os/PLANNED-BACKLOG.md` row **J13** already named both files by
path (*"the retired-URL problem is NOT solved by archiving the root files — it is LIVE in
`docs/architecture/flows/`"*) — but neither file itself carried a warning until now. Both were
bannered in place (original text preserved, per the DOCMAP1 convention), pointing at J13 and at
`infrastructure-topology.md` for the real endpoint.

A third file J13 names, `lcc-personal-calendar-sync.md`, was checked and **no longer contains the
term** — already clean, nothing to do. ~~*"no longer"*~~ ⚠️ **Correction (Cowork, 2026-09-08): it NEVER contained
the term.** `git log -S'life-command-center-nine' --all` over both historical paths returns **no commit** — J13 was
wrong about this file on the day it was filed (`3867a225`). The endpoint it *does* name —
`https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot/sync/calendar-events` — is the **Dialysis_DB
`ai-copilot` edge function (ACTIVE, v77, `list_edge_functions` 2026-09-08)**, not the Railway host;
`flow-personal-calendar-sync.json:110` carries the same URI. "Clean" here means *a live endpoint*, which is a
different fact from *the Railway endpoint*.

### Everything else in the `Vercel` scan: candidates, not defects

~~**58 of 59 files** are correctly-framed historical/retirement narrative~~ ⚠️ **Struck (Cowork, 2026-09-08) — this
sentence recorded 57 unread files as clean.** The response states no read count, so *read-and-clean* and
*counted-only* were collapsed into one number — the prompt's own §2 trap in reverse ("clean" is a third state that
also has to be earned). Re-keyed: **of the 59, the load-bearing subset is the 23 files carrying the retired
HOSTNAME (in scope, at base); all 23 were read. 12 are defects** — a reader is told to POST to / configure /
connect to the retired host, unbannered: `flows/rcm-power-automate.md`, `flows/loopnet-power-automate.md` (fixed
by this PR); `flows/http-parsejson-property-email.md`, `flows/lcc-daily-briefing.md`,
`flows/lcc-morning-briefing.md`, `flows/lcc-outlook-intake.md`, `flows/lcc-weekday-briefing-email.md`,
`flows/lcc-outlook-calendar-write.md`, `docs/setup/production_readiness_checklist_2026-04-22.md`,
`docs/setup/copilot_studio_manifest/lcc-agent/README.md` (fixed by DOCMAP3, PR #2178);
`docs/MOBILE_SHARE_INGESTION.md`, `docs/setup/LCC_OneDrive_Upload_Setup_2026-04-21.md` (fixed by the Cowork
reconcile). **11 are correctly-framed history**: `om_intake_pipeline.md`, `INTAKE_TODO_FLOW_AUDIT_2026-07-23.md`
(§5 *planned* the teardown that never happened), `lcc-microsoft-copilot-outlook-audit-2026-05-22.md`,
`power-automate-api-html-triage-2026-08-11.md`, `POWER-AUTOMATE-API-HTML-TRIAGE-CODEX-PROMPT-2026-08-11.md`,
`flows/FLOW_CHANGES_LOG.md`, `flows/http-init-llc-repair-runbook.md` (a diagnosis of a past run — DOCMAP3 bannered
it anyway; harmless), `audits/W53_…`, two `ops-logs/`, `PLANNED-BACKLOG.md`. The remaining 36 of the 59 mention
`Vercel` without the hostname and stay **counted-only** — not asserted clean. **Why the six flow docs were missed:
none contains the capitalised word `Vercel`** — the host appears only inside the URL. Grep the HOSTNAME,
case-insensitively, never the brand.

Original text follows. **58 of 59 files** are correctly-framed historical/retirement narrative — mentions inside "why we
migrated," "before/after," dated audit exhibits (`vercel_secret_usage_audit.md` already carries its
own DOCMAP1 STALE banner), or `docs/architecture/flows/vercel-github-direct-alert.md`, which
documents the *original alert trigger* and is explicitly framed as historical infra-alert routing,
not a live endpoint claim. **This is a real result, not a failed sweep** — most of a 59-file hit
list turning up one real defect class (2 files, 1 mechanism) is what "measure, then fix" is
supposed to produce; the `vercel.json` sub-term returned zero because every hit was already correct.

### The five terms listed but not run to completion

`SOS-direct`, `CONTACTS_HUB`, `owner-contact-websearch`, `GOV_STATE_SIGNALS`, `queue_v2_enabled`,
`exec_sql` were enumerated (file counts above) but **not read one-by-one for a false-current claim**
— each needs the same per-hit "read the sentence, is it a candidate or a defect" pass the Vercel
term got, and that pass was not completed within this session. Two of these are structurally
different from `Vercel` and worth naming precisely, so the next pass doesn't re-derive it:

- **`SOS-direct` is NOT a retired dependency** — it's a *currently-blocked* capability (CI cannot
  reach the SOS sites; the residential-egress proxy exists and is mid-rollout per `CLAUDE.md` §25).
  A doc saying "SOS-direct yields nothing from CI" is likely still true, not stale. This term should
  be re-scoped in the next pass to "does this doc claim SOS-direct is ENABLED/scheduled when the
  `W9_1_SOS_DIRECT` flag is still off," not "does this doc mention SOS-direct at all."
- **`GOV_STATE_SIGNALS`** is the DRIFT1-routing-gap term from `CLAUDE.md` itself — a symbol that was
  claimed to have a live consumer and does not. The hits are mostly the audit/prompt files that
  already state the correction (`edge-function-deploy-drift.md`, `DRIFT1-routing-gap-two-definitions-of-gov.md`);
  worth one targeted check that no OTHER doc still asserts the old (wrong) mechanism, not done here.

## 2. Unit 2 — `docs/audits/` (~~108~~ **110** files — `git ls-tree c69ca680 -- docs/audits | wc -l` = 110; the README this PR shipped already says 110)

**Not classified individually** (per the prompt's own instruction — an audit's staleness is a
citation-context question, not a per-file verdict). Shipped `docs/audits/README.md`: states the
rule (cite an audit for its mechanism, never its live number; every arc's current state lives on
its canonical page, not the audit trail) and records a spot-check that the audits reachable from
`CLAUDE.md`'s "Pointers to canonical docs" section and from named arc canonical pages
(`tier0-owner-contact-system.md`, `producer-health-and-ci-enforcement.md`,
`public-records-source-lane.md`, `entity-identity-and-dedup.md`) resolve correctly. **Not
exhaustively checked for all ~~108~~ 110** — most audits are already cross-linked from `CLAUDE.md` itself,
since that file's structure is "narrative + audit pointer" throughout, so the discoverability risk
here is lower than the prompt's framing assumed; a genuine orphan-audit sweep (grep every audit
filename against every other `.md` file for a citation) was not run.

## 3. Unit 3 — repo-root `.md` classification

| file | decision | reason |
|---|---|---|
| `LCC-OS.md` | **keep at root** | `CLAUDE.md`'s own first line points here as the architecture entry point; it is a 16-line pointer stub, not content. |
| `AGENTS.md` | **keep at root** | mirrors `CLAUDE.md` for the Codex/Cowork surface — root placement is the convention for agent-instruction files across all three sibling repos (Dialysis, government-lease both keep `CLAUDE.md` at root). |
| `WRITE_SURFACE_POLICY.md` | **keep at root, explicitly** | the file's own header states it is CANON-BOUND: `docs/os/canon/00-INDEX.md` global invariant #4 and `docs/os/REGISTRY.md` §A both bind to it BY PATH, and `test/raw-write-guardrail.test.js` enforces it at merge time. Moving it breaks a live test and two canon references. |
| `BRIGGS-WRITING-VOICE.md` | **fold-candidate, not moved** | canonical, prompt-injectable content (406 lines) — belongs under `docs/` per the post-rule convention, but is likely referenced by path from live prompt-assembly code (not verified in this pass); moving it blind risks a silent break the same class as the flow-doc URL defect above. Flag only. |
| `SALESFORCE_LCC_INGESTION_PLAN.md` | **fold-candidate, not moved** | actively referenced by path from 4+ live docs (`FLOW_sf_file_discovery.md`, `04_Comps_Tools_Revised_Architecture.md`, two audits) — dated 2026-05-14, predates the "no new root `.md`" rule, but is not orphaned. Same reasoning as above: flag for a move, don't move blind. |
| `SPEC_BOV_Lease_Extractor_Unit4.md` | **fold-candidate** | self-labelled `✅ BUILT (2026-07-17)` — a completed implementation spec, historical by its own header. Candidate for `docs/history/` or `docs/architecture/`. |
| `SPEC_BOV_Lease_Extractor_Unit4_BUILD.md` | **fold-candidate** | same — `✅ BUILT`, build-notes companion to the above. |
| `SPEC_forsale_om_and_webpage_ingest.md` | **not classified** | dated 2026-07-31, no explicit status line found; whether it is built/superseded was not checked against the current OM-intake pipeline (`docs/architecture/om_intake_pipeline.md`). |
| `SPEC_sos_direct_scraper.md` | **not classified** | same — not checked against the live SOS-proxy state (`docs/RUNBOOK_sos_proxy_garybuilt.md` in government-lease, referenced from `CLAUDE.md` §25). |

**No file was moved or deleted.** `CLAUDE.md`'s own destructive-op-order doctrine and the
"never delete, always banner or fold with a stated reason" convention from DOCMAP1 apply here too —
a move that breaks a live reference is worse than the drift it fixes.

## 4. NOT REACHED (stated honestly, DOCMAP1's format)

- **Unit 1b (deep-read of high-consequence files)** — the prompt's own follow-up correction: grep
  alone cannot find a superseded design, a flipped flag, or a renamed interface, only a named dead
  dependency. **Zero files were deep-read in this pass.** The candidate list (files with `BUILD`,
  `PLAN`, `SPEC`, `ROADMAP`, `SETUP` in the name, plus anything `CLAUDE.md`/`DOCUMENTATION-MAP.md`
  cites as authoritative) was never enumerated.
- **5 of 7 swept terms** (`SOS-direct`, `CONTACTS_HUB`, `owner-contact-websearch`,
  `GOV_STATE_SIGNALS`, `queue_v2_enabled`, `exec_sql`) got a file count only, no per-hit
  candidate/defect read.
- **`docs/setup/` (24), `docs/os/canon/` (22), `docs/copilot/` (6), `docs/data-quality/` (2),
  `docs/resolver/` (3)** — never opened in this pass beyond appearing in the term-grep hit lists.
- **`docs/claude-code/` (313 files, including `done/` (84))** — DOCMAP1 handled `done/` as one
  banner unit; not re-verified here, and the other ~230 files in `docs/claude-code/` (prompts not
  yet done, `responses/`, `STATUS.md`) were not swept independently — they surfaced only as grep
  hits for the 7 terms.
- **`docs/architecture/` `title+skim` tier (87 rows per DOCMAP1)** — DOCMAP1's own follow-up already
  deep-read part of this and found 7 more STALE docs (none Vercel-related); whether the remaining
  `title+skim` rows still stand was not re-verified here.
- ~~**The exact count of `docs/architecture/` has grown to 232** since DOCMAP1's 181 — the new ~51
  files were never classified at all, by either pass.~~ ⚠️ **Corrected (Cowork, 2026-09-08): it did not grow.**
  `docs/architecture/` held **232 `.md` at DOCMAP1's own commit `7ffa8bf3`** and 232 today; **181 is the
  top-level count** (`-maxdepth 1`). The 51 are the **subdirectories** — `flows/` **45**, `ai-chat-routing/` 4,
  `backfill-artifacts/` 1, `office-scripts/` 1 — which `DOCMAP1_CLASSIFICATION.md` never listed. The "never
  classified" half is true and now has a cause: a non-recursive count. Classified by DOCMAP3 (47 rows) + the
  reconcile (4 rows).

Net for this session: **2 confirmed defects found and fixed** (out of ~990 unswept files) ⚠️ *(Cowork: 2 of 12 in
the retired-host class alone; the machine-read hits outside `.md` — three root `flow-*.json` PA definitions, the
Copilot Studio package `manifest.json`/`ai-plugin.json`/`LCC-Assistant.zip` — are a further class this sweep could not
see because it was scoped to `*.md`, the §2b trap. Filed **J13a**.)*, one
directory-level banner shipped, 9 repo-root files classified with reasons (0 moved). The dominant
finding, consistent with DOCMAP1's own conclusion, is that most retired-term mentions are correctly
historical — but the sweep is nowhere near complete, and Unit 1b (the harder, higher-yield pass) has
not started.
