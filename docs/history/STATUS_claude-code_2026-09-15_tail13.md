# STATUS archive — Claude Code queue, 2026-09-15 (twenty-first span)

Moved **verbatim** from `docs/claude-code/STATUS.md` on 2026-09-16 to keep that file under its
3,000-line budget. Nothing was reworded or dropped; every still-open item named here is tracked in
`docs/os/PLANNED-BACKLOG.md`. The span covers the 2026-09-15 run from XB1/XB2 live through
HCRIS-TIMEOUT-2/-3, Harris measured at 86%, XB2-precision (scoped → shipped → reconciled → verified),
OWN-T0c, OWNERGAP2's prompt, N15, DEPLOY2-unapplied's prompt, T2b, the 15 dark flags, and XB2-counter.

---
## 2026-09-15 — XB2-counter: the build brief's only producer finding was a false positive (Cowork)

`producer_stall_not_flag_gated` fired on `sidebar_contact_guard` — an event counter written on
every sidebar capture (`trigger_source='sidebar_capture'`), not a scheduled producer; its `0
completions` is the correct steady state once dedupe has already notified a key (already
established under SIDEBARGUARD1/XB2-precision). Fixed structurally: `v_build_brief_producer_stall`
now requires `bool_or(trigger_source = 'cron')` per producer, so any FUTURE event counter is
excluded too, not just this one. Migration
`20261102180000_lcc_xb2counter_producer_stall_scheduled_only.sql`, applied live to LCC Opps.
Verified: `sidebar_contact_guard` excluded (negative control); a synthetic `trigger_source='cron'`
stalled producer, inserted+rolled back in one transaction, still caught (positive control, 0
residue). RPC findings 19 → 18 (`producer_stall_not_flag_gated` 1 → 0); next collector snapshot
should read 24 → 23. See backlog **XB2-counter** for the full writeup and **XB2-counter-eventguard**
(filed, not built — a replacement alert for the guard's own failure mode).

---

## 2026-09-15 — The 15 dark flags are ~5 decisions, and none of them is dead code (Cowork)

`flag_long_dark` is **15 of 24 findings (62%)** of the build brief, so triaged it into something Scott
can act on: `docs/audits/FLAG_LONG_DARK_TRIAGE_2026-09-15.md`.
⚠️ **Corrects my own earlier note.** I wrote that each dark flag is "either work to finish or code to
delete." **Checked all 15: every surface file exists and every flag is still referenced in live code** —
deletion is not on the table for any of them. And for most, "off" means **the env var was never set**:
`return !!process.env.OWNER_ENRICH_ADDRESS_URL`, with `sos-lookup.js` returning `reason: 'unconfigured'`.
These are **unconfigured adapters degrading honestly**, not disabled features.
**15 rows collapse to ~5 decisions:** nine flags are ONE question (stand up owner-enrichment adapters at
all?); two are the Salesforce list import (dark **108 days** — the oldest, and nobody has missed it,
which is itself an answer); one is save-not-send Outlook drafting (touches Northmarq IT constraints);
one is the CM treasury webhook (optional). `ENABLE_OWNERSHIP_RESEARCH_QUEUE` is the `government-lease`
repo's call, not this one's.
⭐ **Recommended first: `DECISION_OWNER_DEED_WINS`** — the only true feature toggle in the set. No
endpoint, no purchase, no IT conversation; just a policy call on whether a recorded deed overrides other
owner sources, and it sits squarely on the OWNERGAP true-owner thread. → **FLAGDARK1**
⭐ **Third instance of one rule-design flaw**, so it is worth naming as a class: after
`producer_stall_not_flag_gated` (event counter vs scheduled producer) and `market_brief_lane_stale`
(one gap vs five), `flag_long_dark` conflates *unconfigured* with *disabled*. The pattern is **a rule
reading one signal that carries two different meanings** — folded into **XB2-counter**.


## 2026-09-15 — T2b shipped: gov ownership resolution's second tranche fully applied (Cowork)

**Decision #5 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"Yes, again, the objective is accurate coverage of all properties in our target submarket. We want
to get there as fast and efficiently as possible."*

**Background** (`docs/audits/C2e_T2a_TRANCHE_TWO_STEP_ONE_MINT_2026-08-28.md` §6,
`connectivity-and-open-threads.md` §4k.1): T2a (gov owners with ≥$100k aggregate rent) shipped
2026-08-28. T2b — the remaining below-$100k + rent-unknown tail, 2,241 properties / 2,054 owners —
was sized safe and cheap (predicted duplicate-group growth actually *lower* than T2a's measured
actual) but left unrun: "the decision is purely whether 'resolve all ownership, rank later' should
be applied to a population ~96% un-contactable today... **Not run. No default taken.**"

**Re-measured live before running** (population moves): `v_lcc_c2e_asset_mint_plan` — which
self-excludes anything already minted, so T2b's population is simply whatever remains after T2a —
held at 2,255 properties / 2,068 owners (805 under $50k / 712 at $50–100k / 537 rent-unknown),
essentially unchanged composition from the original 2,241/2,054 sizing three weeks ago.

**Ran the same mechanism T2a used**, no new code needed (per "review existing machinery before
building"): `lcc_mint_gov_asset_entities(p_rows, p_batch, p_dry_run)`. Dry run matched the live run
exactly — **2,255 would-mint → 2,255 minted, 0 skipped**, batch `t2b_gov_2026-09-15`. Drove the
evidence ingest explicitly in the same pass, as the mechanism requires (cron 225 caps at 400/run):
`lcc_ingest_domain_owner_evidence(false, 3000, 't2b_evidence_2026-09-15')` → **evidence_written
2,262, assets_resolved 2,255, ambiguous_logged 1**. The 7-row gap between written and resolved is the
identical guard T2a hit — all 7 residual `eligible` rows are brokerages (`Stan Johnson Co` ×4, `NAI
Pfefferle`, `Bradford Allen Realty Services`, `SVN®`), correctly filtered out by
`lcc_reconcile_property_owner`'s scoring CTE. Working as designed, not a defect.

**Result**: `v_lcc_c2e_asset_mint_plan` now reads **0** — gov asset-anchor resolution across both
tranches is fully applied. gov asset anchors now 10,255 (external_identities, `source_system='gov'`,
`source_type='asset'`); `lcc_property_owner` now 10,906 rows. Checked for a blowup on the two axes
T2a's own audit flagged (duplicate-candidate growth, Tier 0 card growth) — neither spiked; both
stayed in the range the pre-run sizing predicted.

**Next**: decisions #3 (OWN-T0g supersession rule — needs care, live cron ingestion path) and #6
(owner-role promotion + cadence — needs its own design pass) are the two remaining open items from
Scott's six. #2 (`canonical_name` unique constraint) is gated on reviewing the review-only tail from
the OWN-T0c merge sweep earlier today.
## 2026-09-15 — DEPLOY2-unapplied prompted; the obvious design was measured and killed first (Cowork)

**The N15 migration turned out to be APPLIED** — verified live rather than assumed: mint + unmint
functions and `lcc_n15_sf_campaign_hub_mint_log` all present, batch `n15_sf_campaign_2026-09-15`
carrying **1,475 rows**. So the merged-but-unapplied class is **3 of 4, not 4 of 4** — and that
counterexample is load-bearing, because an existence-only check passes N15 correctly *and* passes
XB2-precision incorrectly. Staleness, not existence, is the discriminator.
⚠️ **Pre-measured the obvious design before writing the prompt, and it is a dead end.** LCC Opps holds
**885 migration files** but only **742 unique version prefixes** (98 timestamps collide);
`supabase_migrations.schema_migrations` holds **770 rows**, newest `20260915142114` — **and no file is
named that**. The repo names migrations with *synthetic sequence* timestamps (`...120000`) while
Supabase stamps the *real apply clock*, so **87 file versions are dated after today**, out to
`20261102170000`. A `file_version NOT IN schema_migrations` rule would flag nearly every recent
migration as unapplied — wrong on its whole visible output, the **XB2-counter** failure on a second
rule in the same brief. The prompt forbids it by name.
🟢 **Prompt written: `prompts/DEPLOY2-unapplied-migration-detector.md`** (175 lines). Rule goes in
`scripts/build-brief-collector.mjs`, not the XB2 SQL RPC — that migration's own header sets the split
(filesystem state is not queryable from Postgres) and this rule needs both halves. Hard requirements:
**UNVERIFIABLE is a finding, never folded into APPLIED** (a data-only backfill is the exact shape that
merges and leaves no trace — P131/P180); a **positive control** (Class 11); and a
measure-the-FP-rate-first gate on the `pg_get_functiondef` normalized compare, with explicit
permission to ship UNAPPLIED+UNVERIFIABLE only and file STALE as a row if the noise is bad. ⛔ Report
only — the prompt forbids applying anything it finds, since some of the 87 future-dated files may be
staged deliberately.
🔭 Two things surfaced and deliberately NOT fixed: canon has **no block on migration application at
all**, and the synthetic-timestamp naming is its own 885-file / 98-collision change.

---

## 2026-09-15 — XB2-precision verified; SIDEBARGUARD1 disproved by reading the source it told me to read (Cowork)

**XB2-precision shipped and hit its acceptance target.** Snapshot 13: findings **32 → 24** (predicted
~23), lane findings aggregated **11 → 3**, `branch_debt` present. The collector produced **13 snapshots
in one day**, each tied to a merge commit — it is genuinely self-running now.
⚠️ **SIDEBARGUARD1 was a false positive, and my framing of it was wrong.** I had called it "either dead
code on a schedule or something unguarded for days". Neither. `sidebar_contact_guard` is an **event
counter**, not a scheduled producer — written on every sidebar capture, where `status='ok'` means
*"raised a NEW misparse review item"*. So **0 completions is the correct steady state** once dedupe has
notified a key. Evidence: 73 runs blocked 166 contacts, and **149 review items exist** (2026-08-10 →
09-14) of which a human **dismissed 105**. The surfacing path works; the guard works. I had written
"read the skip_reason's source before assuming either" into the row itself — doing that is what
disproved it, which is the only reason this did not become a wasted CC round.
**The real defect is in XB2's rule** → **XB2-counter**, now the brief's only wrong finding and therefore
load-bearing: a rule whose single visible output is known-wrong is the "monitor nobody trusts" failure
we have paid for three times already.
👤 **One genuine item survived:** **44 misparse reviews still `new`**, oldest 2026-08-10 (~36 days) →
**MISPARSE-BACKLOG1**. Matters because HP1-P2misparse is the thread about this guard rejecting REAL
people, and `person_junk_name` is the dominant rejection reason.
🔭 New shape of the brief: `flag_long_dark` is **15 of 24 findings (62%)**. Not a monitor defect — a real
backlog awaiting Scott's decision (11 dark >60 days, oldest since 2026-05-30).

## 2026-09-15 — `HCRIS-TIMEOUT-3` reviewed: the HCRIS fix itself is genuinely correct — the real culprit was the diagnostic instrument (`ingestion_tracker`) being blind, plus a second, previously-unnamed bug hiding behind it

`HCRIS-TIMEOUT-3`'s response (`"HCRIS TIMEOUT 3 surface response.docx"`, saved by Scott) read in full and
independently re-checked against Dialysis_DB. **Genuinely different shape of finding than the first two
rounds — not "the fix didn't work," but "the fix worked, and the instrument measuring it was broken."**

**(a) Re-read against the actual deployed code, confirmed clean.** `_download_and_extract`'s bounded
(connect, read) timeout and wall-clock deadline, `HCRIS_DOWNLOAD_TOTAL_TIMEOUT_SEC`/`CMS_HCRIS_INGEST_STEP_TIMEOUT_SEC`,
and `hcris_propagation`'s real call to `save_estimates_batch()` (no leftover dead call site to the old
per-row path) — all genuinely wired as designed. `HCRIS-TIMEOUT`'s original fix (PR #7410) is not the
defect.

**(b) The actual reason the symptom persisted: two previously-undiagnosed bugs in the tracker/heartbeat
mechanism itself**, not in HCRIS-specific code at all. `_write_step_heartbeat()` used one unretried
`.execute()` call on a long-lived Supabase client this repo's own code already documents as degrading late
in a run, failures logged at DEBUG — silently blind on nearly every run (this session's own spot-check:
126–129 of the last 140 `ingestion_tracker` rows carry blank `notes`, close to but not exactly matching the
response's own "139 of 140" figure — noted as a minor precision gap, not a substantive one). `finish_run()`
only retried twice versus `start_run()`'s already-hardened 6-attempt budget for the identical
connection-degradation symptom (`PRI3(e)`) — so a run that actually finishes still reads `started`/`NULL`
forever. **This is exactly `HCRIS-TRACKER-BLIND`, filed last round** — folded in and fixed here rather than
treated as separate, since the fix is the same mechanism.

**A genuinely new, materially important finding: `hcris_cost_reports` and `hcris_propagation` are failing
for their own, still-unidentified reason, separate from `run_timeout`.** The `"Failed steps: hcris_cost_reports,
hcris_propagation, run_timeout"` summary this arc has been reading for three rounds was never one failure —
it names two steps that fail on their own plus a budget cutoff that (per this round's live trace) hits a
**different, later, unnamed step**. The real per-step exception text was never captured anywhere before this
fix — `_log_ingestion_row()` now persists a `step_errors` map with the actual exception per failed step, so
the next run will finally say why `hcris_cost_reports` fails, instead of every round re-guessing. **Flagged,
not fixed, out of scope this round**: `qip_scores_ingestor.py` and `cms_deficiency_ingestor.py` — later,
optional steps in the same pipeline — still carry the exact bare `requests.get(timeout=300, stream=True)`
pattern `HCRIS-TIMEOUT`'s first round already root-caused and fixed for HCRIS, a plausible source of the
multi-hour `run_timeout` tail. New candidate backlog item, not yet a prompt.

**(d) Live proof still not obtained — correctly disclosed, not claimed.** No CMS/Railway egress from the
Claude Code sandbox, and the currently-stuck run (`bc5d3867…`, started 07:33:40 UTC, still `run_status='started'`
at DB time 14:21 UTC — 6.8+ hours in, independently re-confirmed) predates this fix and won't demonstrate it
either way. Scott confirmed `Dialysis` PR #7411 (commit `651c630`, branch `claude/lucid-wozniak-z996iw`)
merged. **The real test is the next full run cycle** — this time with `step_errors` actually populated, so
the next review reads the real cause directly instead of cross-referencing four Supabase tables by hand.
`HCRIS-TIMEOUT` stays 🔴 — not closed — pending that. Prompt moved to `docs/claude-code/prompts/done/`.

## 2026-09-15 — XB2-precision reconciled: the code shipped, the migration never did — third time for one class (Cowork)

PR #2460 merged and `main` carries both halves. The **JS half is live** — `branch_debt` fires in every snapshot
from 12:52 onward, so the 1,722-branch number is no longer silent. **The SQL half was never applied.**

Checked rather than assumed: the live `lcc_build_brief_db_audit()` still had **no `GROUP BY`** and was still
emitting `format('%s/%s', lane, section)` — one finding per cell. Snapshots 7 through 11 all read **32 findings
with 11 lane rows**, unchanged, including the newest at 14:16. **The prompt's stated deliverable was a
before/after findings table after applying and redeploying — the "after" never existed**, so what looked like a
shipped precision fix had changed nothing on the DB side.

✅ **Applied it live.** DB-side findings **27 → 19**; the lane rule collapses **11 → 3** (`government`,
`net_lease`, `dialysis`), with every affected section now named inside `measured` instead of restated as its own
row. Flags (15) and the stall rule (1) are untouched, so the next collector run should read **≈24** total against
the prompt's predicted ~23.

🚨 **This is the THIRD time the same class has bitten, and that is the finding worth more than the fix.**
**HP1-P1a-fix**: migration merged, unapplied — the deployed code called an RPC that did not exist and would have
404'd all 608 deals every 30 minutes. **OWNERGAP1**: caught only because a verification step happened to run.
**XB2-precision**: merged, unapplied — and everybody, including the session that shipped it, believed the count
had dropped.

⚠️ **Prose has failed three times.** `CLAUDE.md`'s *"merged is not running"* doctrine covers **code**, and it
works — `/version` against `main` is a real check that this session has used repeatedly. There is **no equivalent
for migrations**, and that is the actual hole.

✅ **Filed as `DEPLOY2-unapplied`, with the fix that fits: make it an XB2 rule.** XB2 already exists to catch
"looks live, does nothing" — having the self-audit system flag a migration on `main` whose object is absent or
structurally stale in the live DB is the right owner for this. ⚠️ And the rule needs a **staleness** test, not an
existence test: existence alone would have passed XB2-precision, because the function existed — it was just the
old body. Hashing the file's `CREATE` block against `pg_get_functiondef` is one option to evaluate.

## 2026-09-15 — N15 closed: 1,475 Salesforce-campaign orphans minted as unified_contacts hub rows (Cowork)

**Decision #4 of Scott's six compiled ownership-pipeline decisions.** Scott's answer, verbatim:
*"These are members of a specific group? Usually means that there is some vested interest in the
space mapped by the name. Some may be brokers, some may be a new fund exploring the space, but the
vast majority will be owners or prior owners and the membership is evidence that some prior research
has concluded that in our team's BD history and just because the LCC doesn't yet have that connection
mapped, does not mean that its not out there undiscovered."*

**Background** (P197, `docs/audits/P197_TIER0_EMPLOYER_RESOLVER_2026-08-27.md` §4): of the live person
entities with an email and no `unified_contacts` hub row, membership in a Salesforce campaign (via
`lcc_sf_list_membership`) was measured as "the only gate that discriminates" among candidate criteria
— 1,475 admitted. P197 explicitly did not mint ("an operator-surface decision with a blast radius")
and filed it for Scott as this backlog row.

**Re-measured live before building anything** (re-measure-before-acting discipline, this population
moves): total email-orphan population grew from 5,193 to **5,672** since P197, but the SF-campaign
gate held at exactly **1,475** — `lcc_sf_list_membership` turns out to be a frozen 2026-07-16→07-21
snapshot, not a live-syncing producer. Worth its own follow-up (the campaign-membership signal itself
is stale for anything captured since July), not fixed in this pass. Sampled the 1,475 before minting:
side distribution seller 1,030 / unknown 416 / buyer 88 — consistent with Scott's "vast majority will
be owners" read; 15 random rows spot-checked, all real BD-relevant names and campaigns (`VCA Animal
Hospital Owners`, `DMR Urgent Care Owners`, `SAB GSA Prospects`, `GSA Buyer`). Checked mint-collision
risk the way P197 did for its own would-be reconcile: 0 of the 1,475 already resolve to a hub row
under `sf_contact_id`.

**Shipped `lcc_n15_mint_sf_campaign_hub_rows(dry_run, batch_tag)`** — one hub row per entity, picking
the best of that entity's campaign-membership rows (domain-confirmed company preferred, else most
recent). **Never fabricates `company_name`** — reuses the exact `lcc_tier0_company_confirms_domain`
gate P197 built after finding that a bare campaign company label is a human/capture field, not an
employer register, and copying it verbatim manufactures employers (city/zip strings, the person's own
name, a different firm, a bank). Dry run matched live exactly: 1,475 would-create → 1,475 created, 0
failures. Only 228 (15%) got a domain-confirmed `company_name` written; the other 1,247 correctly
render with no company rather than a guess — honest "Not on file," per standing doctrine. Fully logged
to `lcc_n15_sf_campaign_hub_mint_log`, batch `n15_sf_campaign_2026-09-15`, reversible via
`lcc_n15_unmint_sf_campaign_hub_rows('n15_sf_campaign_2026-09-15')`. Migration:
`supabase/migrations/20261102170000_lcc_n15_sf_campaign_hub_mint.sql`.

**Scope, stated plainly**: this does not touch the remaining ~4,197 email orphans outside the
SF-campaign gate, and does not itself change Tier 0's `no_employer_on_file` blockage — P197 already
fixed that separately with a read-time resolver (`lcc_tier0_employer_on_file`), and this row's own
audit found minting hub rows would only have helped 4 of 73 blocking people. This is Scott's stated
connectivity-coverage goal ("truth and accuracy... pushed toward 100%"), not a Tier 0 fix.

**Next**: decisions #3 (OWN-T0g supersession rule), #5 (T2b), #6 (owner-role promotion + cadence) are
still open with decided rules, not yet built. #2 (`canonical_name` unique constraint) is gated on
reviewing the remaining canonical-name collision tail from earlier today's OWN-T0c sweep.
## 2026-09-15 — OWNERGAP2 prompt: the first BUILD in the owner arc, deliberately two adapters wide (Cowork)

The sampling has done its job — two measured rates (Philadelphia **68%**, Harris **86%**), three named miss
causes, and a demonstrated free path. Written the build prompt:
`prompts/OWNERGAP2-match-owners-from-free-sources.md`.

✅ **Checked the existing machinery first, and it changes the shape of the build.** `recorded_owners` **already
exists with 7,487 rows** — `name`, `normalized_name`, `normalized_address`, `source`, `entity_type`,
`registered_agent_*`, `filing_*` — and **5,467 of 11,815 properties already carry a `recorded_owner_id`**. The
destination is built and working for 46% of the book; the 4,021 are the hole in it. **So the prompt forbids a new
table** and scopes the work to *adapters plus a provenance contract*.

🚨 **The provenance contract is the whole prompt, and it is written that way because of what this arc already
found.** Every owner written must cite the source row — jurisdiction, that source's own record id, the query.
**No model may produce an owner name**: a name is copied from a fetched record or it does not exist. A local model
may only normalise and match strings already fetched, and even then the value written is the **source's** string,
not the model's rendering of it. A miss stays `recorded_owner_id IS NULL` and gets reported — **never** filled
from the operator, which would be PDR2 undone.

🔑 **One free gift from the measurement, written into the design:** Harris types every account `Personal` or
`Commercial`, so the assessor draws the operator-vs-owner line for us. The matcher keys on that account type
rather than re-deriving it from name text — which is precisely the mistake PDR2 fixed.

**The two cheap miss causes are handled; the third is refused.** Ranges (`4126 Walnut` ↔ `4126-38 WALNUT ST`) and
aliases (Cypress Creek Pkwy = FM 1960, from an explicit evidence-grown list, **never** by loosening the match
until something returns). Multi-parcel sites — `3300 Henry Ave` returns six owning LPs — are left unresolved and
flagged `needs_parcel_discriminator`. **Guessing which LP would be exactly the failure this arc exists to stop.**

⚠️ **Explicit ambiguity rules**, because this is where a wrong owner gets minted: more than one candidate, a
non-exact house-number-and-street match, or a matched name that is itself an operator → **write nothing, flag,
report**. And the gate requires **hand-checking 5 written owners against the live source** — a match rate is not
proof the right name landed on the right property.

Scope is held deliberately small: **two adapters**, no national pipeline, no scheduler, no `county_authorities`,
and no attempt on a CAPTCHA-gated portal. The closing ask is one number: **how many of the 4,021 now have an
owner.**

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT-2` reviewed, and a prior round's own STATUS/backlog edits never made it to `main` — a real process bug found and worked around

**Two things happened this round.**

**(1) `HCRIS-TIMEOUT-2` reviewed** (this round's response, re-verified live before filing — details below,
since the entry documenting this got lost, see (2)): could not confirm the deployed commit SHA (no Railway
tool access), but independently re-verified three of the response's claims live: zero `public_data_snapshots`
rows ever for HCRIS; the failed run's timing decomposing into 4 URLs × ~4.5h each, matching the OLD
unbounded-timeout bug's signature; and an 8,894-error burst followed by 17h46m of silence. Filed
`HCRIS-TRACKER-BLIND` (below) for a second, unrelated defect found along the way.

**(2) Scott then confirmed Dialysis PR #7410 (the HCRIS fix) is deployed on Railway**, and uploaded a log
snippet claiming the most recent run finished in ~90 minutes. **Checked live rather than accepting that at
face value — the database evidence contradicts it.** The most recent `ingestion_tracker` row (`bc5d3867…`,
started 2026-09-15 07:33:40 UTC) is still `run_status='started'`, `finished_at=NULL` at DB time 13:07:43 UTC
— **5.5+ hours later, not 90 minutes** — and `run_log` has zero entries of any kind after the initial
startup batch at 07:33:37–07:41. `facility_cost_reports` is still frozen at 2026-03-16 (0 rows touched
today), and `public_data_snapshots` still has zero HCRIS rows, ever. **The uploaded log file itself only
covers a 20-second slice at the run's startup (07:34:06–07:34:26 UTC) — it cannot show the run finishing**,
same limitation as the previous log upload in this arc. **With the deploy now confirmed, this squarely
answers `HCRIS-TIMEOUT-2`'s catalog item (a) — the merged fix IS what's running — which means the symptom
persisting is now item (b): a residual bug in the fix's own code, not a stale deploy.** Asked Scott where
the "~90 minutes" observation came from (Railway dashboard/process view), since it doesn't match what
Supabase shows. New follow-up prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-3-deploy-confirmed-still-hung-re-diagnose-the-actual-deployed-code.md`.

**A separate, purely mechanical finding, also from this round: this file and `PLANNED-BACKLOG.md`'s prior
`HCRIS-TIMEOUT-2` entries were silently dropped and never reached `main`.** The merged PR
(`docs/hcris-timeout-2-reviewed`, #2462) contains only the new response `.md` file — `git show --stat`
confirms it. Root cause: the recovery pattern this arc has used for the recurring `checkout -b` failure
(`git branch <name> HEAD` → `git reset --hard origin/main` → `git checkout <name>`) captures only committed
history in the `git branch` step; STATUS.md/PLANNED-BACKLOG.md had been written to Scott's working tree via
the file bridge but were still **uncommitted**, so the very next step, `git reset --hard origin/main`,
silently discarded those two files' edits before `git add` ever ran. The new response file survived only
because it was untracked, and `reset --hard` doesn't touch untracked files. **This pattern is retired as of
this round.** New default: `git checkout -b <branch>` with no explicit start-point (branches from current
HEAD in place, carrying uncommitted changes forward, never touches origin/main), used in this round's git
block instead.

## 2026-09-15 — XB2-precision shipped: `branch_debt` rule + per-lane market-brief aggregation (Cowork)

Both gaps from the XB2-precision reconcile below are fixed. (a) New rule `branch_debt`
(`branchDebtFinding`, `scripts/build-brief-collector.mjs`) fires on `total_remote` alone (warn,
threshold 200, growth trend from a prior snapshot when fetchable) — the count was already recorded
in the payload and never surfaced as a finding. (b) `lcc_build_brief_db_audit()`'s
`market_brief_lane_stale_or_missing` rule now emits ONE finding per LANE, not per lane×section,
with `missing_sections`/`stale_sections` named in `measured`. Lane list left untouched (the
retraction below stands — `net_lease` is the MB9 survivor, not a retired lane). 22/22 tests pass.
Not yet re-measured live post-deploy — next step is a fresh collector run against the redeployed
migration and the before/after findings-count table (32 → ~23 predicted).

---

## 2026-09-15 — OWN-T0c trailing-"The" adopted + the general fuzzy-merge sweep it unblocked; N3c/bank-trustee exclusion also merged (Cowork)

**Scott answered all six compiled open decisions at once (2026-09-14 → 2026-09-15).** This entry
closes decision #1 (trailing "The"); items #2–#6 are filed as their own open threads below and in
`docs/architecture/ownership-truth-pipeline-state.md`'s "Open decisions" section, which is being
updated in the same pass.

**Decision #1 — "if they are the same entities, merge... I don't have a preference about the naming
structure."** `lcc_entity_name_tokens` now strips a trailing "The" token, not just a leading one (this
re-applies, with explicit authorization, the exact change built-then-reverted on 2026-09-14 as
`own_t0c_trailing_the_2026-09-14`). 12 confirmed collision groups (16 entities) merged live via
`lcc_merge_entity`. Effect on the property-conflict-scoped `duplicate_entity` class: 1,183 → 1,177
(only -6) — confirmed most of that population is a **separate** collision class, not explained by
trailing-"The" alone.

**Reviewed existing machinery before building anything new (standing doctrine)** and found the real
scope of Scott's decision was already served by `v_lcc_merge_candidates` + the dormant
`lcc_apply_fuzzy_merges(dry_run, [limit])` — a mature, already-built auto-mergeable detector with
role-priority survivor selection, Salesforce-account-aware guards, name-similarity gating, and a
"pinned" protection for bridged unknown-role entities, applying through the same guarded
`lcc_merge_entity` primitive `lcc_repair_tombstone_portfolio_facts` (OWN-T0d) also uses. Full
canonical_name collision population measured first: **6,636 groups / 14,007 entities** (not scoped to
property conflicts — this is the true size of "if they are the same entities, merge"). Dry run showed
3,021 groups / 3,305 entities `auto_mergeable = true`; sampled for false positives (short-code LLC
names, DBA/legal variants — `cbre`→`CBRE Group, Inc.`, 4-letter LLC codes, etc.) — sane. **Ran live**:
`lcc_apply_fuzzy_merges(false)` — 3,021 groups applied, 3,305 entities merged, 0 failures, fully logged
to `lcc_entity_merge_log` (reversible per-row, same snapshot mechanism as every other merge this
session).

**Result**: canonical_name collision population 6,636/14,007 → **3,772/8,005** groups/entities.
`duplicate_entity` class: 1,177 → **930**. Remaining population is the harder, review-gated tail
`v_lcc_merge_candidates` already routes away from auto-merge: `bridged_unknown_pinned` (1,644g/3,538e),
`no_role_or_sf_signal` (337g/682e), `multiple_sf_accounts` (89g/193e), `low_name_similarity`
(64g/143e), `normalizer_blind_review_only` (64g/175e) — **not** swept here; needs its own review pass
since the view's gates exist precisely because same-canonical-name alone isn't proof of same-entity in
these cases.

**JS/SQL parity kept intact.** `test/entity-canonical-key.test.mjs`'s corpus contradicted the newly
adopted rule (`'Penstar Group, The' → 'penstar group the'`) — updated to the live-verified value
(`'penstar group'`), and `api/_shared/entity-link.js`'s `entityNameTokens()` rewritten to mirror the
SQL's exact `ord`/`total` window semantics, **including a real quirk**: a trailing "The" strips only
when it lands exactly at the post-stoplist survivor count, so a legal-form word (Inc./Co./LLC/...)
anywhere before the "The" prevents the strip (`'Edwin Mcintyre Co., Inc., The'` stays
`'edwin mcintyre co the'`, unstripped — confirmed this is the live SQL's actual behavior, not a JS bug,
and documented in both files so a future session doesn't "fix" it without re-running the backfill and
merge sweep). All 8 subtests in `test/entity-canonical-key.test.mjs` pass. Migration:
`supabase/migrations/20261102160000_lcc_own_t0c_trailing_the_and_fuzzy_merge_sweep.sql`.

**Also merged this window** (built and shipped just before the six-decision answer, PR #2456 already
on `main`): OWN-T0/N3c bank-and-CMBS-trustee prospecting exclusion
(`lcc_owner_name_is_bank_or_trustee`, OR'd into the single `lcc_owner_name_is_not_prospected` choke
point) — 11 owner names excluded live, 0 false positives against individual/family trustees or credit
unions. Closes N3c (`tier0-owner-contact-system.md` §6).

**Open-threads table restored to the top of this file** — a concurrent session's 09-15 entry had been
prepended above it (line 47, past the guard's 40-line limit), reproducing the exact failure mode the
table's own header comment warns about. Reordered, no content dropped; `status-header-integrity` and
`status-line-budget` both pass again.

**Next**: decisions #2 (canonical_name unique constraint — gated on this sweep's result, now much
closer), #3 (OWN-T0g supersession rule), #4 (Salesforce-campaign orphans, N15), #5 (T2b), #6
(owner-role promotion + cadence) are still open, each filed as its own thread in
`ownership-truth-pipeline-state.md`.
## 2026-09-15 — XB2-precision scoped, and I retracted a claim I had already merged (Cowork)

⚠️ **Correction first.** The XB reconcile (PR #2458, merged) asserted that `v_market_brief_staleness`
"reports staleness on a retired lane" because MB9 collapsed `net_lease`. **Wrong.** MB9 collapsed
**`broad_net_lease` INTO `net_lease`** — `net_lease` is the survivor, and the view's three lanes match
`KNOWN_LANES` in `api/_shared/market-brief-render.js` exactly. I read a collapse as a retirement and
asserted it without checking the constant, then shipped it. Corrected at the source in both STATUS and
PLANNED-BACKLOG rather than quietly edited, and the prompt carries the retraction so CC does not "fix" a
view that is already correct.
**The aggregation half stands and is what the prompt covers:** `market_brief_lane_stale_or_missing`
emits per lane×section, so one known fact — no producer has ever written a government or net-lease fact
— becomes **11 of 32 findings (34%)**, burying the one genuinely new find in the same snapshot
(`SIDEBARGUARD1`). Fix is one finding per lane with sections as detail.
**Also measured the trend, not just the level:** remote branches **1,718 → 1,722** in a day, ~4/day. The
collector already records `total_remote` and **no rule fires on it** — the biggest number in the repo,
captured and silent, the same shape as `item_count` before MB2b. Prompt notes why `unmerged` reads 0
(a CI clone has no local branches, so local debt is unmeasurable there by construction — 0 is honest,
not a bug) so nobody "fixes" it into a rule that reads 0 forever and looks healthy.
Acceptance target given to CC: findings **32 → ~23**, with `branch_debt` newly present.



## 2026-09-15 — Harris measured at 86%; two jurisdictions now, and the county hands us PDR2's distinction for free (Cowork)

Second match-rate test, sampled the way a person would do it — HCAD's public search, seven owner-unknown
properties, address by address. **6 of 7 = 86%**, against Philadelphia's 68%.

**Owners recovered:** `CRENSHAW MOB LLC` (FKC Pasadena-Crenshaw) · `BEAMER SCARSDALE LP` (DaVita Sagemeadow) ·
`ROY AND VEVA MORRISON RANCH CORPORATION` (DaVita Garden Oaks) · `US INVESTMENTS` (DaVita Inwood) ·
`AALS PROPERTIES LLC` (FKC Atascocita) · `FULTON SHOPPING CENTER INC` (FMC Moody Park).

🔑 **The most useful finding is structural, not the rate.** Every Harris hit returned two or three accounts at the
same address, **typed by the county itself as `Personal` or `Commercial`** — the tenant's equipment account
(`PIKE DIALYSIS LLC`, `HOLDREGE DIALYSIS LLC`, `BIO-MEDICAL APPLICATIONS OF TEXAS INC`) versus the real property
owner. **That is PDR2's operator-vs-owner distinction, drawn for us, for free, by the assessor.** A matcher should
key on that account type rather than re-deriving operator-vs-owner from name text — which is what LCC was doing
wrong in the first place.

⚠️ **The single miss is a THIRD failure mode.** `4427 Cypress Creek Pkwy` returned Cypress Grove Ln, Cypress Pond
Ct and W Cypress Villas — wrong street entirely, because Cypress Creek Parkway is Houston's renamed **FM 1960**
and HCAD indexes the name it holds. A **street alias**, not a formatting difference, and the one cause a string
normaliser **cannot** fix from our data alone.

**Three miss causes now identified, all cheap, none needing paid data:** address **ranges** (Philadelphia,
`4126-38 WALNUT ST`) · street **aliases** (Harris, FM 1960) · **multi-parcel** sites (3300 Henry Ave → six owning
LPs, needs a parcel discriminator).

⚠️ **Miami-Dade was NOT sampled**, and that is stated rather than implied — two rates of 68% and 86% would not
have been changed by a third, and the sampling has done its job.

👤 **Recommendation, unchanged in direction and far better evidenced:** build nothing yet. The next unit of real
work is a **matcher against free sources**, scoped by those three miss causes, starting with jurisdictions that
publish bulk files or open APIs. A paid provider stays relevant only for **LA-shaped** counties that publish no
owner at all — now demonstrably a small fraction of the 4,021 rather than the whole of it. Audit doc §9.

## 2026-09-15 — ⚠️ `HCRIS-TIMEOUT`'s merged fix did NOT resolve the symptom — live-verified, re-opened as `HCRIS-TIMEOUT-2`

Scott confirmed the `Dialysis` PR (`claude/hcris-timeout-fix-01BWJTdN`) merged and triggered a fresh run to
prove it live. **Checked the actual result rather than accepting "the run finished successfully" — it did
not fix anything.**

The post-merge run (`ingestion_tracker` row `84e215c3…`, started 2026-09-14 13:35:03 UTC, genuinely after
the merge) ran for **17.98 hours** — longer than any pre-fix cycle (13.6h/14.9h) — and its `run_log`
summary reads the **identical** `"Failed steps: hcris_cost_reports, hcris_propagation, run_timeout"`
signature as before. `facility_cost_reports` remains frozen at 2026-03-16 (now 183 days), zero writes in
the trailing 24 hours. Not a smaller regression — the run took longer and produced the exact same failure,
the opposite of what a working fix should do.

**Two live hypotheses, not yet determined**: either the Railway redeploy never actually picked up the
merged commit (checking the deployed commit SHA against the merge SHA is the first thing the follow-up
prompt asks for, before any further code diagnosis), or the fix as coded has a residual bug that didn't
show up in the test suite. `PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row reopened to 🔴 with the live evidence
recorded plainly, not closed as done. New prompt drafted:
`docs/claude-code/prompts/HCRIS-TIMEOUT-2-fix-did-not-resolve-symptom-first-check-if-the-merged-commit-is-actually-deployed.md`
— deliberately ordered to confirm deployment before re-diagnosing code that may not even be running.




## 2026-09-15 — XB1/XB2 live, and the build brief is already running itself (Cowork)

**The third of Scott's three original P18 asks is now live.** PR #2456 merged;
`build_brief_snapshots` holds 2 rows — and snapshot 2 carries `commit_sha 3f391fb1`, generated
**11:42 UTC by the GitHub Action on the merge itself**, not by a human. The collector looks without
being asked, which was the whole point.
✅ **The rule refinement holds structurally, not just in prose.** `producer_stall_not_flag_gated` fires
on exactly one subject and stays silent on `p_rss`, because the SQL excludes `^flag \S+ is off$` rather
than trusting a future reader to remember the distinction. The orphan-prompt false positive is fixed too.
⭐ **First genuinely new find: `sidebar_contact_guard` has run 69 times and completed zero times, ever**
(31 runs on 09-14, so still accruing). Every run skips for an *operational* reason. Either it is dead code
on a schedule, or whatever it guards has been unguarded for days. Nobody was watching producer completion
before this. → **SIDEBARGUARD1**
🔴 **Two precision gaps, both the failure XB2 was scoped to avoid → XB2-precision.** (a) The biggest
number is **measured and silent**: `branches.total_remote = 1,722` sits in the payload with no rule
firing on it — the same "recorded but not surfaced" shape as `item_count` before MB2b. And
`branches.unmerged` reads 0 because a CI clone has no local branches, so **local branch debt is
unmeasurable from CI by construction**; only the remote count works there. (b) `market_brief_lane_stale`
emits per lane×section, turning one known gap into **10 of 32 findings (31%)** . ⚠️ **I also claimed it reports on `net_lease`, "a lane MB9 collapsed" — that was wrong and is retracted:
MB9 collapsed `broad_net_lease` INTO `net_lease`, so `net_lease` is the survivor and the view's lanes match
`KNOWN_LANES` exactly.** I read a collapse as a retirement without checking the constant. The aggregation half
stands. A brief where a third of the findings restate one known fact is on
its way to being a brief nobody reads.
