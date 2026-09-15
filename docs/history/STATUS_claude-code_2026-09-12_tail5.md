# STATUS archive — Claude Code queue, 2026-09-12 tail (fifth cut)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-15, before pushing, per the CLAUDE.md doctrine
*"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY DUPLICATE IT"*: this file grows on `main`
while a branch is open, so archive to hold 200+ lines of headroom rather than trimming when CI goes red
(`test/status-line-budget.test.mjs`, budget 2,500). Nothing was reworded, summarised or dropped. Every still-open
item named below is tracked in `docs/os/PLANNED-BACKLOG.md`; for the HP1 arc the map is
`docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`, and for the owner gap the record is
`docs/audits/OWNERGAP1_FABRICATED_OWNER_AND_UNRECOVERABLE_GAP_2026-09-14.md`.

Covers 9 entries, from *2026-09-12 — HP1-P1a-fix reconciled: code merged, live run not yet confirmed — ⚠️ SUP* to *2026-09-12 — ID2b-caps reconciled: passthrough works, but the gate FAILED — two bands*.

---

## 2026-09-12 — HP1-P1a-fix reconciled: code merged, live run not yet confirmed — ⚠️ SUPERSEDED 12 MINUTES LATER (Cowork, parallel session)

⚠️ **Superseded, and kept for the record rather than rewritten.** This entry was filed at 12:59 UTC by a parallel session on an honest reading — *zero rows synced since 2026-09-09* — which was true when taken. The **12:47 UTC Power Automate run had in fact already landed**, and a second session verified it at 12:50: `updated_not_inserted = 608`, `brand_new_rows = 0`. See the ✅ entry above. Two things below are now false and are corrected here rather than deleted: (1) *"there is no live evidence it is actually deployed"* — there is: `tranquil-delight`'s `/version` reports `c91d5dabe932`, matching `main`; (2) the implied conclusion that the fix was not working — it was not working, but for a reason this reading could not see: **the migration had never been applied, and the function as written raised 42702 on its first call.** Both were found and fixed at ~12:41. The 🟡 backlog row this entry created has been collapsed into the ✅ one.


Reconciling two Claude Code desktop responses sitting in `docs/claude-code/responses/` against git
history. Both `HP1-P1a-fix-opportunity-upsert-never-updated.response.md` (Units 2-5: the RPC-first
upsert, the batch-endpoint honesty fix, the `closed_at` preservation, and the test guards) and
`ID2b caps 2 desktop response.docx` match already-merged commits on `origin/main`
(`4530a341`/`3f0edc24` for HP1-P1a-fix + the HP1-P1a-dup finding; `a8fc2eb2` for ID2b-caps-2, which
`STATUS.md` already had a full entry for). Both response files moved to `responses/done/`.

**ID2b-caps-2:** already ✅ in `PLANNED-BACKLOG.md`, nothing to change.

**HP1-P1a-fix:** the backlog row was still sitting at 🔴 despite the code being merged, so ran the
response's own asked-for verification live rather than trusting the merge alone —
`select date_trunc('day', last_synced_at), count(*) from bd_opportunities group by 1` on
`xengecqvemvfknjvbvrq`. Result: **zero rows have synced since 2026-09-09** — three days *before*
today's fix even shipped. The fix is merged into `main`; there is no live evidence it is actually
deployed and running against the real Salesforce feed yet (Railway redeploy status is outside what
this session can see). Marked the row 🟡 (code shipped, deploy/live-run unconfirmed) rather than ✅ —
per this repo's own standing rule, a merged PR is not itself proof of a working system. **Next
verification step, once Railway is redeployed:** wait for the next PA sync cycle, then re-run the
`UPDATED_not_inserted`-style check the original prompt specified before closing this row.

Docs updated: `PLANNED-BACKLOG.md` (HP1-P1a-fix row corrected from 🔴 to 🟡 with live measurement);
2 response files moved to `responses/done/`.

## 2026-09-12 ✅ — HP1-P1a-fix CLOSED: 608 UPDATED, not inserted — the Salesforce feed writes for the first time (Cowork)

The 12:47 UTC Power Automate run landed against the corrected RPC. **`updated_not_inserted = 608`,
`brand_new_rows = 0`, `max(last_synced_at)` 2026-09-09 20:30 → 2026-09-12 12:47.** Closed on the measurement the
prompt named, not on a 200. **The deal backbone has never taken an UPDATE from Salesforce before today.**

**What six weeks of drift actually turned out to be — far less than feared.** Diffed against
`_hp1_p1a_bd_opportunities_pre_fix_backup` (the snapshot the migration takes before the first correct run):
**10 stage changes, 6 expected-close-date changes, 4 newly closed, 0 amount changes, 0 new rows.** Every one is a
recognisable live deal:

- **Newly closed (4):** *DaVita Succasunna NJ* `non_refundable` → **closed / won** (close date pulled in to 09-09)
  · *DaVita Succasunna NJ* (a second, earlier opp on the same asset) `listing_signed` → **terminated** ·
  *DaVita Portfolio 3 — Realty Income — Aug 2026* `in_escrow` → **terminated** ·
  *DaVita Portfolio 4 — Realty Income — May 2026* `loi_executed` → **terminated**.
- **Advanced (5):** *Banning CA*, *Omaha NE*, *Queens NY* all `listing_signed` → `non_refundable` (Omaha and Queens
  also pulled their close dates from a 2027-01-01 placeholder to 09-25) · *Action Behavior Centers — Duncanville TX*
  and *DaVita Zapata TX* both `loi_executed` → `in_escrow`.
- **Slipped (1):** *DaVita The Villages FL* close date 08-21 → 09-30, stage unchanged.
- ⚠️ **One backward move:** *Essentia Health — Hinckley MN* `loi_executed` → **`listing_signed`**. Worth Scott's eye:
  either a genuine re-trade back to listing, or Salesforce hygiene. LCC now mirrors Salesforce faithfully — which
  means Salesforce's own errors now arrive too, the tradeoff this fix always implied.

**✅ Unit 4 held.** `closed_at` changed on exactly the **4** rows that genuinely transitioned into closed; the 569
already-closed rows kept their original timestamps. The RPC's `COALESCE(t.closed_at, EXCLUDED.closed_at)` absorbed
the fact that `processDeal` still sends `new Date().toISOString()` on every sync, so no real close date was
re-stamped.

⚠️ **The prompt's repeated mass-auto-retire warning was misdirected.** There is **no `deal_next_step` table** in
LCC Opps — `lcc_generate_deal_next_steps()` exists and writes into **`action_items`**. With only 10 stage changes
there was no mass retire to brace for, but the warning as written sent a reader to a table that does not exist.
Corrected here rather than left to mislead the next turn.

⚠️ **Still open, and it should be looked at before HP1-P1d registers a freshness assertion:** `bd_opportunities`
holds **619** rows against the feed's **608** — 11 rows the Salesforce feed does not touch, some with
`sf_opp_id IS NULL`. A second producer keeping `last_synced_at` fresh over a dead Salesforce pipe is exactly the
B6a trap P1d warns about, so P1d must register **the feed**, not the table. Filed as **HP1-P1a-nullsf**.

## 2026-09-12 🚨 — The live `LCC_API_KEY` is committed to this repository (found during the root-clutter sweep) (Cowork)

Scott asked for the repo files and folders to be cleaned and consolidated. Surveying the root turned up
`wave0-config-values.txt` — **tracked**, first committed 2026-04-06 in `d76e00e8` — carrying
`LCC_API_KEY=<64-char value>`. Its prefix matches the `Authorization: Bearer` token in the
`SF Deal → LCC Opportunity Sync` Power Automate flow **exactly**. It is the same live key, and it is the key
`mcp/server.js::authenticate` accepts on every `/api/pipeline/*` and `/api/sf/*` route — so repo read access is
write access to the deal backbone. SEC1 flagged this key as exposed on 2026-08-03 on the strength of the flow
header alone; the repository copy was never noticed, and the key was never rotated.

**Rotation alone no longer closes it** — the value is in git history permanently. Escalated on **HP1-P1a-sec**
with the four steps (rotate · update the flow header in the same change · replace the literal with a
`<from Railway env>` placeholder · decide purge-history vs accept-burned). 👤 **Scott's call, and it should come
before the next PA verification run rather than after.** The rest of that file (Teams/tenant/channel IDs, a dead
Vercel host) is not secret.

**Sweep otherwise deliberately NOT taken.** ~12 scratch artifacts sit at the root beside the served front-end JS
(`draft1/draft2/draftsave.json`, `harvest.json`, `twin.json`, `seed-*.json`, `acq-dryrun.json`,
`fix-allother-pagination.patch`, `ACTIVATE_unit4.sql`, two `.bat` files, ~10 loose `.docx` specs). Several are
referenced by name from `docs/` **and from `test/retired-identifiers-guard.test.mjs`**, so moving them in bulk is
a silent test/doc breakage dressed as tidying. Filed as **REPO1-root-clutter** with the method (grep each name,
move only the unreferenced ones into the existing `_superseded/` with a manifest line, fix the rest of the
references, file the loose `.docx` under `docs/` by topic). Consistent with the repo's own never-delete rule —
and `err.txt` (0 bytes) could not be removed anyway: this bridge cannot delete on Scott's machine without an
explicit grant.

**What WAS consolidated this pass:** `docs/claude-code/STATUS.md` had **two stray duplicate `# Claude Code queue
— STATUS` H1s buried mid-file** (lines 83 and 212) from sessions prepending entries above the header — removed
both, one H1 now sits at the top where a reader lands. `responses/` is back to empty-but-README: the ID2b-caps-2
docx and the HP1-P1a-fix response filed to `responses/done/`, the ID2b-caps-2 prompt to `prompts/done/`.
`prompts/` now holds 9 genuinely open items. `HP1-P1a-fix` stays **active on purpose** — its round trip is not
proven yet.

## 2026-09-12 — ID2b-caps-2 GATE PASSED live (three clean bands); the operator-note funnel is ALIVE end to end; audits indexed by topic

Filed `responses/ID2b caps 2 desktop response.docx` → `done/`. **ID2b-caps-2 (PR #2374, merged, deployed `c91d5dabe932`)
closed the defect that opened the identity thread on 2026-09-11.** It took the source-of-record path — a first-class
`sf_comp_staging.operator_id` resolved through `dia_operator_aliases` (fill-blanks, non-raising trigger, deliberately
lighter than the hard guard on `properties`/`leases` because an external Salesforce sync feeds that table) — predicted a
406/400/6 backfill in dry run and applied exactly that. **Cowork live dry run confirms the gate:** `:5` Fresenius Medical
Care **n=72**, `:4` DaVita **n=78**, `:73` US Renal Care **n=8** — three id-keyed bands, **no text-keyed fragments, no
duplicate labels**, whole-market **n=169 unmoved**, candidates 17 → 15. The counts differ from the 75/78 predicted on
09-11 because the TTM window rolled and the SF-staged arm now contributes (SF TTM: DaVita Dialysis 13 · Fresenius Medical
Care 10 · US Renal Care 2) — arithmetic, not drift. **Declared deviation kept:** the duplicate-label guard is scoped to
two different resolved operator ids sharing a label, not the blanket rule requested, because the blanket version broke an
intentionally-tested fallback.

**OC-v items 1–2 done and verified.** The standalone MCP redeploy is live: `/health` lists `log_operator_note` and
`get_operator_inbox`, and `/api/operator-inbox` is a read route. Cowork POSTed a real note to `/api/operator-notes` →
`{id, disposition:'open'}`, now row 1 of `operator_notes`. **What's left to make it a loop:** the `OPERATOR_NOTE_TRIAGE`
flag row still doesn't exist (`registry_state: null`) and no cron posts the tick; a forced dry run scanned the note and
returned **unclassified** (`no_deterministic_rule_matched_and_model_declined`) — correct fail-closed behavior, but
routing stays unproven until a real bug/idea note goes through.

**Repo hygiene (Scott's standing ask):** added `docs/audits/README.md` — 118 audits indexed by topic (identity,
ownership, comps/capital markets, feeds & monitors, CoStar sidebar, Power Automate, UX, security, one-offs) with the
standing reminder that an audit is a dated measurement, and a pointer to CURRENT-STATE / PLANNED-BACKLOG / STATUS for the
live picture. Next consolidation step drafted as `prompts/CONSOLIDATE2-status-archive-and-topic-folders.md`: STATUS.md is
**10,582 lines / 281 entries** and PLANNED-BACKLOG.md **1,227 lines**, both past the size where a new session can read
them whole.

## 2026-09-12 — HP1-P1a-fix: migration was NEVER applied, and as written it could never have run — both fixed, upsert proven live (Cowork)

PR #2371 merged and both Railway services redeployed, so `mcp/opportunity-sync.js` now POSTs
`rpc/lcc_upsert_bd_opportunities`. Checked the live DB before writing any "fixed" line, per the prompt's own
rule (**verify on `UPDATED_not_inserted`, never on a 200**). Two defects, both silent, both caught before a
live run:

**1. The migration had not been applied.** `20261101170000_lcc_hp1p1a_opportunity_upsert_rpc.sql` was merged
into the repo but never run against LCC Opps — `pg_proc` had no `lcc_upsert_bd_opportunities` at all. The
deployed code was therefore calling an RPC that did not exist, which would have 404'd on all 608 deals of
every 30-minute run. **The redeploy made the feed worse, not better**, and nothing would have said so:
`ingestBatch` still returns HTTP 200. Applied the migration live (it adds a function plus the one-time
`_hp1_p1a_bd_opportunities_pre_fix_backup` snapshot; it changes no data).

**2. The function as written raises `42702` on its first call.** It declares OUT parameters `sf_opp_id` and
`entity_id`; both collide with columns of the same name on `bd_opportunities`. A plpgsql body is not parsed at
`CREATE` time, so the migration applies cleanly and then fails on **every** execution with
`column reference "sf_opp_id" is ambiguous`. That is a second total-failure of exactly the shape HP1-P1a-fix
exists to eliminate, and an HTTP 200 would have hidden it again. Renamed the OUT params `out_sf_opp_id` /
`out_entity_id` and aliased the INSERT target `AS t` so Unit 4's `COALESCE(t.closed_at, EXCLUDED.closed_at)`
and `RETURNING t.id` resolve. **No JS change needed** — `processDeal` reads only `outcome`, `reason` and
`bd_opportunity_id`. Filed as `supabase/migrations/20261101170100_lcc_hp1p1a_upsert_rpc_fix_out_param_ambiguity.sql`
and the superseded function in `...170000_...` is annotated so nobody copies it forward.

**Live proof (rolled back, `sf_opp_id` `00TVs00001J3iCfMAJ`):** `outcome='updated'`, stage `identified` →
`PROBE_ROLLED_BACK`, `closed_at` NULL → set, `closed_won` NULL → true, `last_synced_at` advanced; a payload
with no ids returns `outcome='skipped'`. **This is the first time this path has ever produced an UPDATE.**

**Still NOT verified end to end.** `max(last_synced_at)` on `bd_opportunities` is **2026-09-09 20:30 UTC** and
`updated_not_inserted` over the last 6 h is **0** — no Power Automate run has landed since the migration went
in. The round trip is unproven until a run does. The pass/fail test is `UPDATED_not_inserted ≈ 600` after the
next run, not a 200 and not a green flow-run history (the flow history has been green through six weeks of
100% write failure).

**Incidental finding:** `bd_opportunities` holds rows with `sf_opp_id IS NULL` (the row with the newest
`last_synced_at` is one). They are not Salesforce-sourced, and the RPC correctly returns `skipped` for that
shape rather than inventing a key. Worth confirming which LCC-side writer mints them before P1d registers a
freshness assertion on this table — a second producer is exactly the B6a trap P1d already warns about.

**Root cause of the original defect confirmed** (PR #2373): `mountLccMcp(app)` at `server.js:176` with
`apiPrefix=''` registers `/api/pipeline/ingest-opportunit{y,ies}` **193 lines ahead of** the duplicate
registration at `server.js:368-369`, so the live handler is built from `mcp/server.js`'s positional-`prefer`
`opsQuery` and the correct `api/_shared/ops-db.js` one never runs. Filed as **HP1-P1a-dup**.

Docs updated: `PLANNED-BACKLOG.md` (HP1-P1a-fix → ⚠️ partially shipped + new HP1-P1a-rpc row),
`CURRENT-STATE.md` (§546 P1-blocked line corrected — it was never a Salesforce-hygiene question),
`supabase/migrations/` (+1 corrective migration, original annotated). Repo hygiene: removed two stray duplicate
`# Claude Code queue — STATUS` H1s that prepending sessions had left mid-file (lines 83 and 212); the file now
carries exactly one, at the top.

## 2026-09-12 — ID2b-caps-2 reconciled: SF-arm resolution verified live, band-list gate NOT pasted (Cowork)

PR #2374 merged (`c91d5dab`) and `tranquil-delight`'s `/version` reports `c91d5dabe932` — **deployed and live**,
which closes CC's own "not merged, not deployed" caveat. Response and prompt filed to `done/`.

**Verified live in Dialysis_DB, matches CC's report exactly:** `sf_comp_staging` now carries a first-class
`operator_id` column; **430 rows, 400 resolved, 6 unresolved-with-tenant** — the exact 406/400/6 CC predicted and
reported. The remaining 24 rows carry no tenant text at all, so there is nothing to resolve them from. CC chose
option **(b)** (own column at the source) over (a) (query-time resolution), which is the answer the prompt itself
pointed at.

⚠️ **The prompt's stated deliverable was not delivered, and this is filed rather than waved through.** §3 required
the full band list pasted from a live dry run, with named numbers: one **Fresenius Medical Care** band at
63+12=**75**, one **DaVita** at 68+10=**78**, **US Renal Care** at **6**, whole-market **n≈169 unmoved**, and no
`cap_rate_ttm_band:<text>` keys for operators that have an id — with an explicit instruction to *report and stop*
if any number differed. CC reported "exactly three clean per-operator bands (DaVita, Fresenius Medical Care,
US Renal Care) — no duplicate-labeled leftover" but **pasted none of the counts**. The shape of the gate is
asserted; the arithmetic is not evidenced. Not re-run here (it needs the tick's own dry run against the deployed
build, not a SQL approximation, and approximating it would be exactly the fabrication the standing rules forbid).
→ filed as **ID2b-caps-2-gate** — one dry run, paste the list, close or reopen on the numbers.

⚠️ **Two deliberate deviations CC disclosed, both accepted as reasonable, both now on file** so they are not
rediscovered as surprises: (1) the alias-resolution trigger on `sf_comp_staging` is **fill-blanks-only and
non-raising**, deliberately lighter than the hard-block write guard on `properties`/`leases`, because this table is
fed by an external Salesforce sync — so a bad tenant string here degrades to "unresolved", it does not fail the
sync; (2) the duplicate-label invariant shipped **scoped** to "two different resolved operator IDs sharing a
label" rather than §2's blanket "no two live facts in a lane/section share a label", because the blanket rule broke
an existing intentionally-tested fallback. The blanket invariant §2 actually asked for therefore does **not**
exist — a future fallback that re-mints a canonical-looking label for an *unresolved* operator would still ship
silently.

**Also checked:** the standalone MCP service (`life-command-center-production`) has **no `/version` route** —
`Cannot GET /version` — so "merged is not running" cannot be verified on that service the way it can on
`tranquil-delight`. Worth noting that the Salesforce ingest path does **not** traverse that service at all: it is
served by `tranquil-delight`, which mounts the MCP in-process via `mountLccMcp(app)` (HP1-P1a-dup). Filed as
**DEPLOY1-mcp-version**.

## 2026-09-12 — P1a/C2g dual-top-priority contradiction resolved by measurement, not judgment call (Cowork)

The XB2 audit pass earlier today flagged that `PLANNED-BACKLOG.md` had two rows independently claiming
to be THE top priority: `C2g` (⭐ NEXT, 2026-09-11) and the `P1a` section header (⭐ THE TOP PRIORITY,
2026-08-27). Rather than asking Scott to arbitrate, tallied every sub-item under P1a (C1-C19, DOC1-DOC18,
OCR1-OCR6, EXT1-EXT2a, BROKER1/BROKER1-sf) against its own status markers: the overwhelming majority are
already ✅ shipped, ⛔ refuted/superseded, or 👤 awaiting Scott's decision on file. This makes it a factual
staleness fix, not a subjective priority call — retitled the P1a header to drop its "top priority" claim,
named `C2g` as the current top priority, and explicitly listed the handful of genuinely still-open
sub-items so they aren't lost in the retitle: `C4d`, `C9b`, `C13h`, `DOC2`-`DOC6`, `C15` (the last
deliberately left open by design). Nothing under P1a was deleted or re-parented — REGISTRY.md's
never-delete/keep-canonical rule applied to a section header, not just a file.

Docs updated: `PLANNED-BACKLOG.md` (P1a header retitled + reconciliation note added).

## 2026-09-12 — First real run of XB2's audit rules (manual, not the automated system) — four findings, one fixed live (Cowork)

Scott asked for the repo's docs/files to be cleaned and consolidated by topic so future threads aren't
misdirected by conflicting or stale files. `docs/architecture/EXEC-BRIEFS-SPEC.md` §5 already specs an
automated system for exactly this (XB1 collector + XB2 audit rules + XB3 dashboard + XB4 narrative) —
all four rows in `PLANNED-BACKLOG.md` are still 🔴, unbuilt. Building that system is its own project
(a GitHub Action, an on-box Ollama synthesis tick, a new dashboard route) and out of scope for this
turn. Instead, ran XB2's own audit-rules checklist manually, once, across the categories the spec
names, using three read-only sub-passes.

**1. Orphaned prompts** — none found. All 13 active files in `docs/claude-code/prompts/` are ≤1 day
old and referenced in `PLANNED-BACKLOG.md`/`STATUS.md`. Adjacent finding: three prompts marked ✅
SHIPPED in the backlog were still sitting in `prompts/` instead of `prompts/done/` (filing lag, not
abandonment) — moved in this same change: `OWN-T0j-gov-side-reconciled-classifier.md`,
`ID3e-county-city-vocabulary-fold.md`, `PR-scanner-3-county-records-needed-action.md`.

**2. GENERATED hand-edits** — none found. All five `docs/os/surfaces/*.canon.md` files and
`docs/os/OPERATOR-INBOX.md` show their last edits coming from genuine `render-surfaces.mjs`/canon-bump
commits, not hand edits.

**3. Dead producers** — pg_cron itself is healthy across a ~20-job sample; no job is silently disabled
or failing. The real pattern is jobs that run green but produce nothing useful, and the docs already
self-report both known cases: cron 219 (`comms-owner-attribution-tick`, green daily, zero new proposals
since 2026-08-20) and cron 104 (`r9_chain_connect`, green, 4,943 of 5,207 minted entities orphaned/no
consumer). Nothing new to file — flagging for whoever picks either one up next.

**4. Flags ON with no consumer** — two real findings. `OCR_CLOUD_DOCAI` and `W51_PARTY_EXTRACT` are
both marked `on` in `docs/os/CURRENT-STATE.md`'s feature-flags registry with **zero code path anywhere
that reads either flag name** — both domains are actually gated by differently-named env vars/flags
instead (OCR: `OCR_CLOUD_ESCALATION`/`OCR_CLOUD_PROVIDER`/`OCR_CLOUD_OCR_URL`; W51: its own migration
comments it as a deliberately inert registry row, real control is `W51_ALLOW_CLOUD`/CLI args). Cosmetic
registry drift, not a live risk — filed here, not fixed (deciding whether to retire the flag names or
wire real reads to them is a judgment call, not this pass's job).

**5. Doc contradictions** — two real findings, one fixed live this pass:
- **Fixed:** `PLANNED-BACKLOG.md` carried **four near-duplicate copies of the `PR5c-enforce` row**
  (accumulated 2026-08/09, pre-CONTACT1a, saying the same thing with slightly different wording).
  Consolidated into one row and re-measured live while at it: `field_provenance` on `entities`
  (email/phone) has grown from the 2026-09-03 blocked baseline (4 rows / 1 source / all `write`) to
  **130 rows / 3 sources** — CONTACT1's numeric unblock condition (>~50 rows, ≥2 sources) is now
  cleared. ⚠️ Not a clean green light: all 130 rows are `decision='write'` — zero `skip`/`conflict`
  ever recorded, so the ladder has volume but has never been tested on a case where it would actually
  need to protect a value or arbitrate a conflict. Flagged 🟢 unblocked-for-grading, not shipped —
  flipping `enforce_mode` to `warn` is a build decision, not something this pass took.
- **Not fixed, flagged for Scott:** `PLANNED-BACKLOG.md` has two rows independently claiming to be
  THE single top priority in overlapping sections — `C2g` ("⭐ NEXT", dated 2026-09-11) and the `P1a`
  section header ("⭐ THE TOP PRIORITY", dated 2026-08-27, now over two weeks stale) — with nothing in
  the document reconciling which is actually first. Also: the spec's own worked example of a
  contradiction (backlog's `C2g` ⭐NEXT vs. the live queue's `PDR2`, both noted 2026-09-11 in the
  original XB2 finding) is **still unresolved today**, unchanged since the day it was found.

**6. Stale dated blockers** — one flagged, not resolved: `B6d-cms-restart` has stood since 2026-08-31
blocked on "Railway deploy logs no agent can reach," but three PRs since (PRI1/PRI3/PRI4, all
2026-09-11, in the same ingestion pipeline) fixed a connection-drop crash and a broken
timeout/shutdown path that PRI4 itself flags as "plausibly the same mechanism" behind unexplained
hangs elsewhere in this arc. Nobody has gone back to check whether B6d-cms-restart's mystery is now
explained. Left for whoever owns that pipeline next — this session didn't have the Railway log access
the row's own blocker names.

**Not built:** the XB1/XB3/XB4 automated system remains entirely unbuilt (all still 🔴). This was a
one-time manual pass, not a standing process — if Scott wants this repeated automatically, that's the
actual XB1/XB2 build, sized at a GitHub Action + on-box Ollama tick + dashboard route, a real project
on its own.

Docs updated: `PLANNED-BACKLOG.md` (`PR5c-enforce` deduped + re-measured), 3 prompts moved to
`prompts/done/`.


## 2026-09-12 — ID2b-caps reconciled: passthrough works, but the gate FAILED — two bands now share one display name; root cause is our own SF-staged comps

Filed `responses/ID2b caps desktop response.docx` → `done/`; prompt → `prompts/done/`. ID2b-caps (PR #2366) did the
additive work correctly: `rpc_query_comps` returns `operator_id`/`operator_canonical` on the sale and listing arms with
every pre-existing field byte-identical (so `operatorTier()` comp selection is structurally unchanged), the tick groups
on the id, and it caught a real retire-logic bug in testing before touching the live DB. 12 new tests, suite 6,044/0.
**But the prompt's gate did not hold.** Cowork's dry run against deployed `c5fc261f` returns five per-operator bands,
two pairs sharing a display name: `:5` **Fresenius Medical Care n=63** beside `:fresenius_medical_care` **n=12**, and
`:4` **DaVita n=68** beside `:davita_dialysis` **n=10**. Expected one band each (74 / 76). **That is worse than the
original defect** — before, two bands had different labels; now two bands claim the same operator with different
numbers. **Root cause (measured):** the passthrough covers the sale and listing arms, which read dia `properties` where
coverage is fine (every TTM DaVita/Fresenius sale resolves). The leftovers come from a **third source —
`sf_comp_staging`, our own Salesforce-staged closed deals** — which has no property link and no `operator_id`, and
carries **196 `DaVita Dialysis` + 179 `Fresenius Medical Care`** rows spelled exactly as `dia_operator_aliases` already
maps them. The tick's text fallback never consults that alias table. New row **ID2b-caps-2** with prompt
`prompts/ID2bcaps2-sf-staged-comps-operator-resolution.md`: resolve the SF-staged arm through the aliases (or give it a
guarded `operator_id`), plus the invariant this class needs — **no two live band facts may share a display label** — as
a test. Audit doc `ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md` has an addendum recording the failed gate; its
original claim was left intact.


> **📦 ARCHIVE (2026-09-14, twelfth span):** a further run of 2026-09-12 entries was moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-12_tail4.md`](../history/STATUS_claude-code_2026-09-12_tail4.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.
