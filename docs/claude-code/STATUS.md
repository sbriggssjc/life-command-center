## 2026-09-12 — CONSOLIDATE2 (round 2) SHIPPED: STATUS archived again, backlog folded, topic index extended

**PR (this branch), documentation-only.** `docs/claude-code/STATUS.md` **10,742 → 2,351 lines**
(before this entry) — lines 2226–10644 (dated 2026-08-29 → 2026-09-11: the B6d/B6e CI-and-producer-
health arc tail, PRI2–PRI5, BROKER1, the P18/BUY0 design opens, the AC-series contact/address work,
and a long ID-series/C13-C14 run) moved **verbatim** to
[`docs/history/STATUS_claude-code_2026-08-29_to_2026-09-11.md`](../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md).
An "Open threads" table was added at the top of the trimmed file, and a
`test/status-line-budget.test.mjs` guard now fails the suite if STATUS.md exceeds 2,500 lines
again, naming this archive procedure in its own failure message.

`docs/os/PLANNED-BACKLOG.md` **1,233 → 1,155 lines**: 78 rows whose State column read exactly `✅`
moved **verbatim** into `docs/os/CURRENT-STATE.md` new §2a ("Shipped rows folded from
PLANNED-BACKLOG.md"), deleted from the backlog per its own "How to keep this file honest" rule.
No 🔴/🟡/🟢/👤 row was touched. `docs/audits/README.md`'s DOCMAP2 topic index was **appended to,
not regenerated** — a new "CONSOLIDATE2 (round 2)" section records the archive + fold and flags
three canonical-doc/reality contradictions found along the way (document-capture-and-ocr-status.md
vs the newer document-capture-ocr-and-deeds.md; tier0-owner-contact-system.md not re-verified
against its own P197/P198 corrections; several architecture docs quoting a pre-correction verdict)
for a follow-up pass, not resolved here.

**Nothing was reworded, deleted, or reordered inside a moved block** — every archived STATUS entry
and every folded backlog row is byte-identical to its pre-move text.


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
# Claude Code queue — STATUS

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

## 2026-09-12 — HP1-P1a CORRECTED: the opportunity feed never STOPPED — its upsert has never UPDATED a row, since the day it was built

Six hours ago I filed *"the feed ran once and stopped."* **That was wrong in a way that understated
it.** The flow is healthy and delivers **608 records every 30 minutes**. What has never worked is the
WRITE. Prompt filed: `prompts/HP1-P1a-fix-opportunity-upsert-never-updated.md`.

**Measured end to end, 2026-09-12 06:00 UTC.** PA run **Succeeded**; `Get records` → **608 rows**;
POST `/api/pipeline/ingest-opportunities` → **HTTP 200**; body
`{"ok":true,"total":608,"succeeded":0,"failed":608}`, every `errors[].error` = `upsert_failed` /
`status 502`. Postgres logs at `06:00:43`–`44Z`, **608 times**:
`duplicate key value violates unique constraint "bd_opportunities_workspace_id_sf_opp_id_key"`.
**PostgREST is running a plain INSERT — `Prefer: resolution=merge-duplicates` never takes effect.**

**Ruled out live, do not re-walk:** the constraint exists and is a plain two-column btree (so NOT the
documented partial/expression-index case); **direct SQL `ON CONFLICT … DO UPDATE` succeeds** (probed in
a rolled-back transaction); the upsert call is unchanged since `83cd873f` (2026-07-27) and the
constraint since 2026-05, so **nothing regressed**; `deal_name`/`property_address` were added 07-28 and
wrote fine on 08-03, so not a stale PostgREST schema cache; and a duplicate-key error proves the INSERT
reached the table, so not auth and not RLS.

**Why 2026-08-03 looked like a start date: it is the day the table was POPULATED.** Empty table → 590
inserts, no conflicts; 15 more on 08-04. Every run since collides. The only writes that have landed are
**5 brand-new `sf_opp_id`s**, and **all five have `created_at == last_synced_at` to the second — all
five are INSERTs. Zero UPDATEs have ever succeeded on this path.**

🚨 **So no stage change and no close has EVER propagated from Salesforce into LCC.** The backbone learns
a deal at creation and is frozen at that instant permanently. **This is the single root cause under all
of HP1 Finding 2** — the 22 open deals past their close date (ECU Physicians MOB **746 days**, ATEK
Brainerd 683, GSA-MSHA Oakwood 515), the frozen stages, 57 of 66 overdue `action_items`, the My Work
graveyard. Not task hygiene. Not Salesforce hygiene. One unexecuted `ON CONFLICT`.
⚠️ **`closed_at` on all 569 closed rows is the Aug 3/4 insert timestamp, not the real close date** —
never captured, not recoverable from LCC.

⚠️ **And the reason six weeks of 100% failure was invisible from BOTH ends:** `ingestBatch` ends
`return res.status(200).json({ ok: true, ...summary })` **unconditionally**. It answered **`ok: true`
with `failed: 608`**. Power Automate reads the status code, sees 200, reports Succeeded — while
`summary.errors[]` carried the truth nobody was reading. **A batch endpoint that cannot fail its caller
is not instrumented, whatever its summary says.** Unit 3 of the fix.

**Method note worth keeping.** Three successive readings of this feed were wrong, each from reading a
convenient column instead of the honest one: `max(updated_at)` said the pipe was alive (LCC-side writers
move it); `last_synced_at`'s history said it stopped (only INSERTs ever stamped it); the truth needed
`created_at == last_synced_at` to prove no row had ever been UPDATED. **Each reading was plausible, and
only the one that could distinguish an insert from an update was decisive.**

**Next:** `HP1-P1a-fix` — RPC-first write (the repo's own standing conclusion about PostgREST's write
surface), a non-2xx on a fully-failed batch, and `closed_at` preservation. **Verify on
`UPDATED_not_inserted` in the hour after a run — a number that has been 0 for this feed's entire life —
never on a 200.** ⚠️ Snapshot `bd_opportunities` first: 608 rows and six weeks of stage drift land in
one batch, and a large `deal_next_step` auto-retire follows.

## 2026-09-12 — Sized the 40-property residual from B2: a small, named slice of C2g (Cowork)

Continuing after B2's retirement, sized the 40-property residual flagged there (gov properties with a
working `asset` anchor that were never resolved to an owner in `lcc_property_owner` at all — distinct
from the 2,496-property mint gap, which is `C2e-T2b`).

**Findings:** these 40 are stuck, not merely queued — anchors range from 2026-04-24 to 2026-08-19 (up
to ~4.5 months old) with no resolution having landed. Two sub-shapes: 10 of 40 carry a real
`assessed_owner` name (LLCs, a trust, an individual, a corp, a city) and simply never resolved; the
other 30 have no `assessed_owner` at all despite a `true_owner_id` and a working anchor — thinner data
than the first ten, worth separating before diagnosing either. Checked and ruled out: not a
`cmbs_discovery`-status artifact (all 40 are `status='active'`); not a timing/backlog-catch-up issue
(ages rule that out).

**This is very likely the same machinery as `C2g`** ("why are 489 anchored owner-orgs still
unresolved?" — `lcc_reconcile_property_owner`'s 0.55 confidence gate, a dia-operator-in-owner-slot
case, or a cross-domain anchor), just counted at the property level with no Salesforce-people filter,
so the two counts (40 vs 489) aren't directly comparable. Filed as `C2g-40` right under `C2g` in
`PLANNED-BACKLOG.md` rather than as a new independent row — per the repo's own standing rule against
building a second detector for the same defect class, this should be diagnosed alongside C2g's own
investigation, not separately.

No build taken. Docs updated: `PLANNED-BACKLOG.md` (new `C2g-40` row).

## 2026-09-12 — B2 retired: it's `C2e-T2b`, not a separate gap; asset-anchor coverage re-measured live (Cowork)

Picked B2 as the next gap after PR-scanner-3, per the standing "measure before building" discipline
and the row's own `owner_needs_salesforce` warning about wrong-key artifacts. Re-derived the real join
chain instead of trusting the row's 9,830/6,362/3,468 figures: `properties.true_owner_id` (gov) →
`external_identities(source_system='gov', source_type='true_owner')` (LCC Opps) → gov `asset` anchor →
`lcc_property_owner`.

**Found: B2's premise was itself a wrong-key artifact, the exact class its own warning named.** Of
9,842 live gov properties carrying a `true_owner_id`, only 163 (1.7%) are unindexed at the identity
layer — 97.7% already ARE indexed as a `gov/true_owner` identity. "Never reached the entity graph" is
false at that layer. The real bottleneck is asset-anchor coverage: **2,496 properties have no gov
`asset` entity anchor at all** (resolution can't even be attempted — the anchor-then-resolve chain
never starts), plus a small, previously-uncounted **40-property residual that IS anchored but was
never resolved to an owner link**.

**This 2,496-property gap is not new — it is `C2e-T2b`** (`connectivity-and-open-threads.md` §4k.1),
sized 2026-08-28 at 2,241 properties / 2,054 owners, already measured safe-to-run and low-value, and
already left as an explicit, un-taken decision for Scott ("safe to run, low-value to run. No default
taken."). The two-week population growth (2,241 → 2,496) is ordinary property-intake drift, not a new
finding. `PLANNED-BACKLOG.md`'s `B2` row had drifted out of sync with `C2e-T2b` and was carrying stale,
wrong-key numbers as if it were a distinct, still-unsized gap — retired into a pointer at `C2e-T2b` so
there is one authoritative row for this population, not two disagreeing ones.

**New, smaller finding not previously counted anywhere:** 40 gov properties that DO have an asset
anchor but were never resolved to an owner in `lcc_property_owner` — distinct from T2b's mint-eligible
population (T2b is entirely about properties with no anchor yet). Small enough to be worth a quick
look on its own rather than folding into the T2b decision.

**No build taken** — T2b remains explicitly Scott's call, and this session did not override that.
Docs updated: `PLANNED-BACKLOG.md` (`B2` row retired/redirected to `C2e-T2b`).


## 2026-09-12 — ID2b-caps SHIPPED: rpc_query_comps carries operator_id, the cap-rate band fragmentation is fixed

Closed the row filed earlier today (ID2b-caps, prompt `prompts/ID2bcaps-comps-engine-operator-id-passthrough.md`
→ `prompts/done/`). `rpc_query_comps` (Dialysis_DB, applied live) now returns `operator_id`/`operator_canonical`
(ID2a registry, survivor-resolved via `dia_operator_survivor`) on the sale and listing arms, additive-only —
appended via `jsonb || jsonb_build_object(...)`, never editing an existing key, so `mcp/comps-tools.js`'s comp
SELECTION/scoring (`operatorTier`/`compTenantText`, which read only the pre-existing fields) cannot have
changed. New pure `planOperatorCapRateBands()` in `market-brief-psql-tick.js` groups the TTM cap-rate band on
`operator_id` when resolved, falls back to the old raw-tenant-text grouping for the ~20% of dia properties
ID2a hasn't backfilled yet, and supersedes the stale text-keyed fragments a resolved id makes obsolete via a
new `retireStaleFact()`.

**Verified live on the tick's own TTM window (2026-09-12):** the exact fragmentation the earlier dry-run
found — `Fresenius` vs `Fresenius Medical Care`, `DaVita` vs `DaVita Dialysis` — is gone: DaVita (72 comps)
and Fresenius Medical Care (68 comps) each collapse into ONE band, both well clear of the `MIN_N_CAP_BAND=5`
floor. The residual `:fresenius_medical_care`(13)/`:davita_dialysis`(12)/`:davita_kidney_care`(5) text bands
are comps whose linked property has no resolved `operator_id` at all — a coverage gap (ID2a backfill sits at
80.1%), not the fragmentation defect re-emerging; they are correctly kept separate rather than guessed into a
bucket.

**One defect caught by the test suite before shipping, not by a live probe:** the first draft of the
retire-stale-key logic would have retired a `fact_key` the SAME run's own unresolved comps still needed as a
genuinely live band, whenever a resolved operator and an unresolved property happened to share the identical
raw tenant text. Added a guard (never retire a key this run also emitted) and a regression test for it before
this went anywhere near the live DB.

Guard `test/id2b-caps-operator-id-bands.test.mjs` (12 tests, all pass). Full suite: 6,044 pass / 0 fail / 6
skipped (all pre-existing skips, unrelated). `MARKET_BRIEF_PSQL` not touched (MB-b's call). Full writeup +
sized ID2b-remaining follow-up (CM views, dossier, MCP tools): `docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md`.
Backlog rows ID2b-caps and MB1e (item 1) updated to ✅ in `docs/os/PLANNED-BACKLOG.md`;
`docs/architecture/EXEC-BRIEFS-SPEC.md` §9 addendum added.
## 2026-09-12 — HP1-P1a ANSWERED read-only: it is NOT a Salesforce hygiene gap. The opportunity feed has written 5 rows in 36 days.

HP1 framed the frozen deal backbone as *"a Salesforce hygiene gap or a Power Automate scope gap — do
not assume"* and sent Scott to check Salesforce. **Both options were wrong, and one column settled it
without leaving the database.** `bd_opportunities.last_synced_at` is stamped unconditionally on every
ingest write (`mcp/opportunity-sync.js:217`), so it records *the feed touched this row*, independently
of whether anything changed. Its write history:

| date | rows written by the SF feed |
|---|---:|
| **2026-08-03** | **590** ← one bulk backfill |
| 2026-08-04 | 15 |
| 2026-08-20 | 1 |
| 2026-09-03 | 1 |
| 2026-09-07 | 2 |
| 2026-09-09 | 1 |

**Five rows in 36 days — and one of the five is `Test Property SN 05032024`.** Of 569 CLOSED
opportunities, **zero have been synced since the backfill** (`max(last_synced_at)` on closed rows is
2026-08-04 21:00:45, the backfill itself). A brokerage does not go 36 days with no closes. **The feed
ran once and stopped.** The surviving five carry `:00:4x`-second timestamps on the hour, which reads
like a scheduled flow that still fires and delivers almost nothing — a too-narrow filter or a broken
query, not a dead trigger. Distinguishing those two is a **Power Automate run-history** question, not
a Salesforce one.

⚠️ **This corrects my own HP1 finding 2c, which said the opposite.** It read *"the table as a whole is
still being written (`max(updated_at)` 2026-09-10, 619 rows), so the pipe is not dead — the
transaction-stage rows specifically have not changed."* **`updated_at` was the wrong column.** It also
moves for LCC-side writers, and the proof is on one row: `DaVita Dialysis - Succasunna - NJ` reads
`last_synced_at` **2026-09-07** against `updated_at` **2026-09-10** — that later change came from
inside LCC, not from Salesforce. Reading `updated_at` as feed liveness produced a confident, plausible
and wrong conclusion, and it is the same class this file documents a dozen times: *the convenient
counter answered instead of erroring.* **For any pushed feed, read the column the WRITER stamps
unconditionally, never the row's own mtime.**

**This re-orders HP1's P1 and kills one premise.** The stale tasks, the 22 past-close deals and the
graveyard My Work are **symptoms of a dead feed**, not of missing task hygiene — so **P1d (the
backbone freshness assertion) is now FIRST**, not last. It should have fired on 2026-08-05 and there
was nothing to fire it: `lcc-bd-sync-health-check` (05:00) and `lcc-feed-freshness-sync` (05:30) watch
other feeds, and `bd_opportunities` is in neither registry. ⚠️ **Do NOT build P1b (the deal-status
confirmation lane) next** — on a stopped feed it becomes a surface that asks Scott to hand-reconcile
data we stopped receiving, which is the producer/consumer inversion, and it would make the outage
*more* comfortable to live with rather than fixing it.

⚠️ **And note what a restarted feed will do on its first run:** 569 closed rows and 37 frozen open rows
will all arrive at once. `lcc_generate_deal_next_steps()` retires on stage change, so a backlog of
real closes lands in one batch — expect a large auto-retire and verify it against the ledger rather
than being surprised by it.

**👤 Scott's step changed:** not "check the stage in Salesforce" but **"open the Power Automate
opportunity-sync flow and read its run history since 2026-08-04"** — is it failing, is it succeeding
with 0 records, or has it been turned off? Each answer is a different fix. Backlog **HP1-P1a** rewritten.

**Next:** HP1-P1d (freshness assertion on the deal backbone) once the flow's state is known; HP1-badge
is unaffected and still ready to build.

## 2026-09-12 — PR-scanner-3 reconciled against the merged desktop response (Cowork)

Read the pasted Claude Code desktop response for PR-scanner-3 in full and independently re-verified
its claims live against both Supabase projects rather than trusting the report text:

- `v_lcc_ownership_history_lane_split` action distribution on LCC Opps matches exactly:
  `agrees` 147, `county_records_needed` 126 (27 human_actionable), `sponsor_spe` 110,
  `mismatch` 101 (37 human_actionable), `all_guarded` 27 (4 human_actionable), 1 null —
  `human_actionable` total unchanged at 68. Confirms the response's "predicted-vs-actual delta
  was exact" claim rather than assuming it.
- The new mirror table `lcc_gov_property_record_coverage` has exactly 254 rows, all synced at one
  single timestamp (`2026-09-12 05:26:52.77913+00`) — confirms it was seeded once, live, and is
  not yet on a recurring sync, exactly as both the response and `PLANNED-BACKLOG.md`/`STATUS.md`'s
  own PR-scanner-3 entries already disclose.
- **Deploy status, both Railway services** (per the repo's standing "redeploy both" rule for engine
  changes): `tranquil-delight-production-633f.up.railway.app/version` returns `bd679c4321c8` —
  byte-identical to this change's merge commit (`bd679c43`), so it is live at the correct commit.
  The standalone MCP service (`life-command-center-production.up.railway.app`, the `mcp/` directory)
  does not import any file this change touched (`ops.js`, `api/_shared/gov-property-record-coverage.js`,
  `api/_shared/ownership-lane-split.js` are all outside `mcp/`) and exposes no git-sha `/version` route
  to check directly — its own `/health` reports a static `"version":"1.0.0"`. **Conclusion: this
  shipment did not require a second-service redeploy, and none is owed.**
- CC's own doc updates (`PLANNED-BACKLOG.md` PR-scanner-3 row, `ownership-history-lane.md` §5,
  `research-workbench.md` §7d, and this file's PR-scanner-3 entry above) were read in full and found
  accurate, complete, and consistent with the live numbers above — no corrections needed.

**Outstanding decision for Scott, not yet made:** the `lcc_gov_property_record_coverage` mirror was
seeded once (254/254 rows) and has no recurring sync. It will silently drift stale as A2/A3 apply
tasks and PR-scanner-1/2 scans change gov's `parcel_records`/`tax_records`/`deed_records` — a stale
mirror can only ever fail *safe* (an unsynced row stays at its base action, `IS FALSE` not `= false`),
but it will under-report `county_records_needed` over time rather than staying accurate. Options:
(a) schedule `syncGovPropertyRecordCoverageForOwnershipLane()` on a cron now (a small follow-up build,
mirroring cron 244/245's cadence), or (b) leave it manual/on-demand until PR-scanner-1/2 show real
adoption (their writers still show 0 rows on either domain as of this reconciliation), since a cron
syncing an unused signal has no payoff yet. No action taken pending Scott's call.

Response filed: `docs/claude-code/responses/done/PR-scanner 3 desktop response.docx`.

## 2026-09-12 — ID2b reconciled: real but not yet visible — the cap-rate fragmentation Scott flagged is unchanged; ID2b-caps drafted

Filed `responses/ID2b desktop response.docx` → `done/`; prompt → `prompts/done/`. **ID2b (PR #2359) shipped one switch:**
`v_market_brief_cms_operator_counts` now groups on `properties.operator_id` through `dia_operator_survivor` — verified live,
0 rows lost (6,695 → 6,695), Satellite's two spellings collapsed into one bucket of 69, plus a repo-wide class-guard test.
It corrected the prompt's own figure (**96** grouping-relevant views, not 45 — the remainder are review/audit surfaces where
raw text is intentionally correct) and **refused to switch `comps-tools.js` blind** because the 5-subject comp-set diff
hadn't been run — the right call, filed as ID2b-c. **What the reconcile found:** the switched view feeds the CMS clinic
counts, which MB1d already withholds behind the staleness gate, so **nothing user-visible changed**. Cowork re-ran the
P-SQL tick's dry run against the deployed build: `cap_rate_ttm_band:fresenius` **n=63** alongside `:fresenius_medical_care`
**n=11**, `:davita` **n=67** alongside `:davita_dialysis` **n=9** — the exact defect that started the identity thread on
2026-09-11, still live. Root cause named: the bands group on the comps RPC's `comp_tenant` **text** and key on
`normKey(text)`, so `operator_id` never reaches the engine's output and every engine consumer re-fragments the same way.
New row **ID2b-caps** with prompt `prompts/ID2bcaps-comps-engine-operator-id-passthrough.md`: return `operator_id` +
`operator_canonical` from `rpc_query_comps` **additively** (existing fields byte-identical, so `operatorTier()` selection
cannot change — proven on 5 subjects), group bands on the id, supersede the text-keyed fragments. Gate: Fresenius 63+11 →
one band n=74, DaVita 67+9 → n=76, whole-market n≈167 unmoved.

## 2026-09-12 — HP1 P0 reconciled: the Today 500 is fixed, DEPLOYED and verified — and the "See all (N)" badge was never honest

Filed `responses/HP1 desktop response.docx` → `done/`; prompt → `prompts/done/`. **PR #2358 merged
(`42158f17`) and LIVE — `/version` reads `42158f174956`** (probed from LCC Opps via `net.http_get`,
the sandbox-reachable route), so this one is *running*, not merely merged.

**What shipped, verified live in the merged source rather than from the response:** `Promise.all` →
**`Promise.allSettled`** with a `settledQueryResult()` mapper (1b); explicit **`timeoutMs: 20000`** on
the seller-prospect read and 12 s on the other three ops calls (1a); **`countMode` `'exact'` →
`'estimated'`** on all four (1c); and a real per-lane failure state (1e) — `today-sections.js` now
returns **`source_error`** per section, `app.js` renders *"This section is unavailable right now"*
instead of the blanket "Today unavailable — HTTP 500", and `assembleTodaySections` folds a
per-request degradation note into the existing **`named_gaps`** contract reading *"Section shown
empty, not exhausted."* That last distinction is the whole point: before this, a lane whose source
died rendered **"Nothing here right now. ✓"** — a green checkmark over a failure. CC also found and
wrapped a **seventh** previously-unguarded `opsQuery` in the same handler (the entity-name lookup),
which the brief had not named. Guard `test/today-sections-degraded-source.test.mjs` asserts a thrown
source empties exactly its own lane, leaves the other two intact, and the endpoint returns **200**;
full suite 6,013 pass / 0 fail / 6 skipped.

🔴 **NEW FINDING, mine, found while reconciling — `total_open` is the CAPPED PAGE LENGTH, not the
population, and two of the three "See all (N) →" badges under-report.** Every section returns
`total_open: all.length` (`today-sections.js:79/103/182`) where `all` is the rows the query
returned — and every source query carries **`limit=200`**. Measured live 2026-09-12:

| lane | badge reads | true population | honest? |
|---|---:|---:|---|
| Significant (`v_lcc_seller_prospect_queue`) | **200** | **517** | ❌ under-reports 61% |
| Urgent (`v_lcc_bd_worklist` contact_writeback half) | **≤200** | **1,587** | ❌ under-reports 87% |
| Important (`bd_opportunities` open) | 50 | 50 | ✅ (below the cap) |

**The module's own header promises the opposite** — *"`total_open` (the full population, for the
'See all →' link)"* — and cites **P159a**, the rule that a rendered count and a population must be
two distinct numbers and never blended. It is the honest-counts rule (Consumption Layer §5) failing
inside the module written to enforce it. **Be precise about the blast radius: the RANKING is not
affected.** Each query is `order=rank_value.desc` before the `limit=200`, so the eight rows rendered
really are the top eight; only the badge lies.

⚠️ **And this corrects my own filing, in place.** HP1's 1c said *"the only consumer of `total_open`
is the 'See all (N) →' button text"*, which implies the PostgREST header count fed it. **It never
did** — CC checked and reported correctly that `.count` is read nowhere in the handler, which is
exactly why the downgrade to `'estimated'` was safe. What that check actually exposed is that the
exact `COUNT(*)` we were paying ~750–800 ms for on every page load was **pure waste**, and the badge
has been wrong since UX-T1a-today shipped. **Re-enabling `count=exact` is NOT the fix** — an
estimated planner count over one of these views is the documented ~58× trap, and an exact one
re-imposes the cost 1c just removed. Filed as **HP1-badge**: either a cheap dedicated count-only
read, or render the badge as *"top 200"* and stop claiming a total. 👤 A count nobody can afford to
compute may simply not belong on the card.

**1d re-measured and correctly NOT built.** Post-1c the 200-row page is **~1.2 s warm** and the
separate exact COUNT that 1c removed was **~0.8 s** (my own pre-fix measurement was 815 ms + 750 ms;
wall-clock on this box moves 2–4× between sessions, so read the structural facts, not the
milliseconds). The structural cost is untouched — seq scans on `entities` / `lcc_property_attributes`
/ `lcc_entity_portfolio_facts` plus the `activity_events` subplan at `loops=1518` — so the
materialized-view question stays open as **HP1-1d** rather than being taken on a number that moved.

**Still open, unchanged:** **P1** (deal-backbone freshness + the deal-status confirmation lane) is
held 👤 pending Scott's determination of whether the frozen transaction stages are a Salesforce
hygiene gap or a Power Automate scope gap — *do not assume*. **P2** (Inbox routing/ranking, My Work
re-rank onto the shared function) untouched. The 12 s front-end race in `renderTodaySections` was
correctly left alone.

⚠️ **Deploy note:** the doctrine is *redeploy BOTH Railway services*. `tranquil-delight` is confirmed
on `42158f17` and serves this endpoint and `app.js`; the standalone MCP service does not serve
`today_sections`, so the surface is fixed either way — but confirm the MCP redeploy before assuming
any other engine change in the same merge is live.

**Next:** HP1-badge (smallest, and it is an honest-counts defect on an operator surface), then P2's
inbox routing. P1 stays 👤-blocked.
## 2026-09-12 — PR-scanner-3 shipped: `county_records_needed`, the sixth ownership-history-lane action

Re-measured live before building (unchanged from the 2026-09-12 sizing already in `PLANNED-BACKLOG.md`):
of gov's 68 `human_actionable` `mismatch`/`all_guarded` tasks in `v_lcc_ownership_history_lane_split`,
27 (40%) carry no trustworthy `parcel_records`/`tax_records`/`deed_records` on file; fleet-wide (254
tasks) it is 126 (49.6%). The spec's `ai_gpt4o_presumed` model-leg label does not exist as a literal in
gov's tables — the live tag is `ai_recall_gpt` (11 deed / 23 parcel / 14 tax rows), used instead.
Shipped as a RECLASSIFICATION inside the existing split (mirroring A3's `sponsor_spe` precedent) rather
than a new lane/table. Cross-database constraint (the view is on LCC Opps, the source tables on the gov
project) solved with a small mirror table (`lcc_gov_property_record_coverage`) synced by
`api/_shared/gov-property-record-coverage.js`; the SQL CASE in the view stays the single owner of the
classification, and an unsynced property (`IS FALSE`, never `= false`) is left at its base action —
never guessed into the reclassification on an absence of information. Reuses B1's existing
`lcc_chain_human_value_floor()` unchanged.

Predicted-vs-actual delta was **exact**: `mismatch` 192→101, `all_guarded` 62→27,
`county_records_needed` 0→126, `human_actionable` held at 68 (split 37/4/27), `agrees`/`sponsor_spe`
untouched. Wired the first live consumer of PR-scanner-5's previously-unwired `/api/recorder-portal`
route: a "County portal →" button on these cards (`researchOpenCountyPortal`, `ops.js`).

Migration `supabase/migrations/20260912150000_lcc_pr_scanner3_county_records_needed_action.sql`
(applied live to LCC Opps + coverage table seeded for today's 254-property population). Guards:
`test/ownership-lane-split.test.mjs` (6 new/updated assertions) + `test/gov-property-record-coverage.test.mjs`
(7 behavioural tests, injected deps). Full suite: 6,022 pass / 0 fail (6 pre-existing skips, unrelated).

**Not done — an operator/scheduling step:** `syncGovPropertyRecordCoverageForOwnershipLane()` is not
yet wired to a cron; today's mirror was seeded once against the live population this measurement
covers. As PR-scanner-1/2's capture writers get adopted (still 0 rows on either domain per the
2026-09-12 research-workbench.md §7c note), the mirror needs a periodic re-sync to stay current.
Docs updated in the same change: `PLANNED-BACKLOG.md` (row `PR-scanner-3`), `research-workbench.md`
§7d, `ownership-history-lane.md` §5.
## 2026-09-12 — ID2b partially shipped: market brief's operator-count source switched to `operator_id`; comps/CM/dossier measured and deferred

Executed `prompts/ID2b-consumer-switch-to-operator-id.md`. **Re-measured the population first: the real grep hit is
96 views, not 45** — most are review/audit queues where raw operator text IS the deliverable (switching would hide
the ambiguity they surface), correctly left alone. **Shipped:** `v_market_brief_cms_operator_counts` (the market
brief's only CMS-operator-count source) now groups on `properties.operator_id` (survivor-resolved via
`dia_operator_survivor`), fill-blanks fallback to raw text for the 14.7% of clinics with no resolved operator.
Measured live: row-count parity 6,695→6,695, `Satellite Healthcare`(54)+`Satellite Dialysis`(14)→one bucket of 69.
`market-brief-facts.js` needed no code change — it was already agnostic to the grouping key, so it is unblocked.
Migration `supabase/migrations/dialysis/20260912120000_dia_id2b_market_brief_operator_id.sql`; guard
`test/id2b-consumer-operator-id.test.mjs` (6 tests, incl. a repo-wide class guard against a NEW module grouping on
raw operator text). Full suite 6,017/0/6-skipped.

**Deferred, named, not silently declared done** (per the prompt's own "ship the highest-value subset, name the
rest" instruction): `mcp/comps-tools.js` fuzzy comp SELECTION (`operatorTier`/`tenantMatches`) was read — its
substring filter already tolerates most alias variance, but the required 5-subject live comp-set before/after diff
was NOT run (needs a live MCP tick invocation this session's budget didn't reach) — filed **ID2b-c**, Scott's call.
`cm_dialysis_operator_unit_economics`/`v_dia_econ_operator_benchmark` already ILIKE-bucket via `dia_operator_bucket()`
(so the exact Fresenius/DaVita string split mostly doesn't occur there today, but it's a heuristic, not the
registry); `cm_dialysis_available_by_tenant[_q]` and `cm_dialysis_industry_participants` still group on raw/
precomputed text — filed **ID2b-cm**. `dossier-generator.js`/`rent-projection.js`/`team-context.js`/
`sidebar-pipeline.js` and the ~85 remaining views not read this round — filed **ID2b-remaining**/**ID2b-mods**.
Full report: `docs/audits/ID2b_OPERATOR_ID_CONSUMER_SWITCH_2026-09-12.md`. Branch `claude/dreamy-pascal-i97j44`.

## 2026-09-12 — ID2b scoped: the identity fix is stored but unread — 45 views + 12 modules still group on operator text

With ID2a/ID2a-cleanup live (`operator_id` on 9,449/11,804, guards on, 207 aliases, 71-row queue) Cowork measured how far
the canonical truth actually reaches: **45 Dialysis_DB views reference an operator text column and never mention
`operator_id`**, and at least 12 repo modules do the same (`mcp/comps-tools.js`, `api/_shared/dossier-generator.js`,
`market-brief-facts.js`, `rent-projection.js`, `team-context.js`, `api/_handlers/sidebar-pipeline.js`). So the split Scott
flagged is still live in every report — only storage is fixed. Drafted `prompts/ID2b-consumer-switch-to-operator-id.md`:
inventory every consumer with its current numbers as the parity baseline, switch by category (grouping → `operator_id`,
display → registry canonical name with the existing `short_operator` chart label, filtering → accept canonical **and**
aliases), and state per surface how the 2,355 properties with no `operator_id` are treated so nothing silently drops out of
a count. **One surface is deliberately not switched blind:** `comps-tools.js` scores comps with `operatorTier()` over joined
tenant/operator text, so an id-based switch changes **which comps are selected**, not just their labels — the prompt
measures 5 real subjects and hands the decision to Scott. Switching grouping also drops MB-b's
`operator_identity_pending:ID2` gap and unblocks the per-operator brief bands. **Also open:** PR #2352 (ID3a-d) to merge,
ID3a-e (the real drift run, needs both repos), ID3e (county vocabulary), OC-v (redeploy the standalone MCP so the notes
funnel goes live).

## 2026-09-12 — ID3a-d reconciled: ownership table settled (LCC owns Dialysis_DB); blast radius measured at 188 live objects; drift run still owed

Filed `responses/ID3a-d desktop response.docx` → `done/`; prompt → `prompts/done/`. ID3a-d shipped on branch
`claude/id3a-d-db-ownership` — **PR #2352 is OPEN, not merged; `main` is still at #2351**, so the retirement README, the
CI guard and the drift-check design are not on `main` yet. It wrote the ownership table into `CLAUDE.md`/I16/`REGISTRY.md`,
marked all 213 `migrations/government/*` files historical (README + per-file header, naming the stale canonicalizer and the
two mappings a re-apply would restore), added a CI guard against new gov migrations landing here, and **refused to fabricate
a drift result** it had no DB access to produce — the right call. **Cowork measured what ID3a-d could not:** of the 194
objects those retired files define, **188 are live right now (86 functions, 102 views)** — the retirement is a live-overwrite
hazard, not housekeeping. Live gov census: 277 functions, 252 views, 91 triggers. 👤 **Scott decided: `life-command-center`
owns Dialysis_DB**, not the Dialysis repo as ID3a-d proposed — the operator registry, aliases, guards, comps engine and
market-brief producers all ship from here, and declaring otherwise would orphan this week's ID2a work; the Dialysis repo owns
CMS/NPI **ingestion** (rows, not schema). That closes **ID3a-d-dia**: LCC's 277 `migrations/dialysis/*` stay live and owned,
and must NOT be retired. New row **ID3a-e**: run the drift detector for real in a session that has both repos, report the
drift list, then schedule it. **Next:** merge PR #2352, then ID3e (county vocabulary) or MB-b (the visible brief).
## 2026-09-12 — HP1 filed: the homepage Today 500 root-caused, and My Work / Inbox measured as pre-doctrine widgets

Live read-only Cowork triage of Scott's screenshot (all three Today lanes showing `HTTP 500`; My Work
and Inbox behind actual deal status). Filed `prompts/HP1-homepage-attention-surface-triage.md`. Nothing
built, nothing written to the DB.

**The 500 is one endpoint and one unhandled throw.** `GET /api/operations?action=today_sections`
(`api/operations.js:2038`) fires six queries in `Promise.all`; `opsQuery` (`ops-db.js:63`) calls
`fetchWithTimeout` with an **8 s default and no try/catch**, and an `AbortController` abort makes
`fetch` **throw**, not resolve `{ok:false}` — so the handler's `sellerQR.ok ? … : []` guard is dead
code for the timeout case and the rejection reaches `withErrorHandler` as a 500. All three lanes
render from that one response, which is why one failure draws three errors. The slow source, measured
with `EXPLAIN ANALYZE`: `v_lcc_seller_prospect_queue` = **815 ms** for the 200-row page + **750 ms**
for the exact `COUNT(*)` PostgREST runs alongside it under `count=exact`, on a plan carrying two
`Seq Scan`s of `entities` (56,289 rows), a `Seq Scan` of `lcc_property_attributes` (30,928), 33,812
heap fetches on `entity_relationships`, and a `SubPlan` executed 1,518×. Cold cache on first load
after idle is what crosses 8 s — matching "every so often when we log into the app." **The fix already
exists in this repo and was never applied here:** `ops-db.js:80-84` documents the R6 `timeoutMs`
option added for exactly this ("heavy aggregate views … need more headroom so a slow-but-successful
read isn't aborted into a blanket 500"); `getTodaySections` passes none on any of its six calls.

**My Work is stale because the deal backbone froze, and no task ever ages out.** 66 open
`action_items`, **57 overdue, 38 by more than 30 days**; 37 are `deal_next_step` from
`source_type='deal_stage_engine'`. `lcc_generate_deal_next_steps()` (cron `lcc-deal-next-steps-daily`,
active) retires a task ONLY when `bd_opportunities.stage` changes or the deal closes — **there is no
time-based retirement**. And the stage data it keys on has not moved: `off_market_listing` and
`loi_executed` last updated **2026-08-03**, `bov` **2026-08-04**, while **22 of the 50 open deals have
an `expected_close_date` already in the past** (ECU Physicians MOB 2024-08-27; Pops Mart Fuels
2025-09-25). Scott's two screenshot cards trace exactly here: *DaVita Portfolio 4 - Realty Income* is
still `loi_executed` with close 2026-07-16 (58 days past, task due = close−14 = Jul 2), *Queens - NY*
still `listing_signed`. `bd_opportunities` is **pushed** from Salesforce via Power Automate into
`/api/pipeline/ingest-opportunity` — nothing pulls, and there is no freshness assertion on the deal
backbone even though `lcc-bd-sync-health-check` and `lcc-feed-freshness-sync` exist for other feeds.
**Not determined read-only, and NOT to be assumed: whether the frozen stages are a Salesforce hygiene
gap or a PA scope gap — 👤 Scott.**

**The Inbox is a reverse-chronological mailbox holding mostly machine work.** 953 items at
`status='new'`, of which **850 are `new_contact_qualify` and 38 `contact_misparse_review` — 93% data
hygiene**, not broker judgment. The human-facing residue is market data, not decisions: a competitor's
Spokane DaVita listing blast present **twice** (original + FW, not deduped), an SSA Minden new-listing
announcement, a Fresenius Pittsboro SOLD COMP notice, and a **bank balance alert**. Four of the 21 new
`email_om` rows are titled from the raw MIME filename (`OM: email-body-AAVtKA8aAAA.txt`) because no
property resolved. `inbox_items.priority_score` **exists and is dead**: written only by
`api/intake.js:1054` for `domain='infra'` rows, never read — `v2GetInbox` (`api/queue.js:517`) orders
`received_at.desc`. The classifier is fine (3,847 triaged + 2,252 dismissed vs 21 new); this is a
routing-and-ranking problem, not a classification one.

**The design finding underneath all three:** the homepage runs three widgets at three orderings —
Today (client-value ranked, per operator-doctrine 1.8.0, and the one that 500s), My Work
(`due_date.asc`, so the most-ignored task is pinned to the top), Inbox (`received_at.desc`). My Work
and Inbox are **pre-doctrine widgets never re-cut when UX-T1a-today shipped 2026-09-03**. The
alignment Scott is asking for is finishing that cut: make Today reliable, make My Work its Urgent
detail view on the same ranking function, and reduce the Inbox to items needing a human verdict.

**Next:** HP1 P0 (`allSettled` + timeout budget + count mode + per-lane error, with a guard test that
a thrown source degrades one lane and still returns 200), then P1 (backbone freshness + deal-status
confirmation lane) after Scott settles the SF-vs-PA question.

## 2026-09-12 — ID3a-c reconciled: agency class closed (live-verified), and a repo-ownership hazard found — gov DB now owned by `government-lease`

Filed `responses/ID3a-c desktop response.docx` → `done/`; prompt → `prompts/done/`. **Verified live (Cowork, read-only):**
`Immigration & Customs Enforcement` → **ICE** (root cause: `&` never normalized to `and`, so ICE fell through CBP's bare
`customs` match), `Border Patrol` → CBP, `Dept of Homeland Security` → DHS; **9 federal `Department of X` patterns were
matching state departments of the same name** — `TEXAS DEPARTMENT OF AGRICULTURE` → USDA, now NULL with `US Department of
Agriculture` intact, via one shared state-qualifier guard. GSA rule **474/624 → 624/624** (Scott's own `GSA - Social
Security Admin` example was the broken one). Registry **65 → 79**; `properties.agency_id` **7,369 → 8,875**;
`property_agencies.agency_id` **119,361 → 120,471**; review lane gained a retire mechanism (348 retired, 1,135 open).
**The finding that outranks all of it:** this work shipped in the **`government-lease`** repo (PR #398), while
`life-command-center` holds 213 `migrations/government/*` files — including its own copy of this same function **without**
the state guard and with the old ICE branch order. Re-applying it would silently restore both defects. 👤 **Scott decided:
`government-lease` owns the government DB.** Recorded as a new `CLAUDE.md` core doctrine, as the repo-level instance of
invariant **I16**, and as backlog **ID3a-d** (retire LCC's gov migrations with a pointer, name the owning repo for dia and
LCC Opps, ship the deployed-vs-committed drift check). **Next:** `prompts/ID3ad-db-ownership-and-drift-guard.md`, then ID3e
(county vocabulary, ready). Deferred from ID3a-c: USFS/BLM/NSF regex gaps, 10 FK granularity judgment calls, the
drift-detector views (built, unscheduled).

## 2026-09-12 — ID3a-b reconciled: agency contamination fixed live (NAVY 150→3, STATE 213→9), but registry + wiring didn't land; new invariant I16

Filed `responses/ID3a-b desktop response.docx` → `done/`; prompt → `prompts/done/`. **Verified live (Cowork, read-only):**
`canonicalize_agency()` now returns NULL for `Navy Federal Credit Union`, `State of Texas`, `Handel's Homemade Ice Cream`,
bare `DOC` and `RICHMOND FIELD OFFICE (VA)`, while `Department of the Navy` still resolves to NAVY. NAVY 150→3, STATE 213→9,
ICE 44→43, DOC 16→1. The `(XX)` state-suffix rule is general across 15 `<CITY> FIELD OFFICE (XX)` strings. `using_agency_*`
columns exist on properties/leases/sales_transactions, 456 of 623 GSA-compound rows populated. **ID3a-b's own key discovery:
the DEPLOYED `canonicalize_agency()` had drifted from its committed migration** (undocumented hand-patch; the regexes already
had word boundaries and were merely too permissive) → new invariant **I16: running is not committed** — the inverse of the
repo's "MERGED is not RUNNING" doctrine — with the detector specified and the interim rule (read the deployed definition
before editing any DB object). **Three gaps found by the live check → ID3a-c:** (1) `Immigration & Customs Enforcement`
canonicalizes to **CBP** (the `customs` branch wins), so 16 properties carry the wrong DHS component; `Border Patrol` and
`Dept of Homeland Security` resolve to NULL though DHS is in the registry. (2) The GSA-compound rule is inconsistent —
150 `GSA - Social Security Admin` rows put SSA in the lease-counterparty column while 473 others correctly keep GSA there;
Scott's rule is *tenant is GSA, user is whatever is second*. (3) §3/§4 never landed: `government_agencies` still 65 rows
(no NAVY/ARMY/LSC/…), `properties.agency_id` still **7,369/20,509**, 1,347 canonicalized-but-unlinked, review lane 1,483 open.
**Next:** send `prompts/ID3ac-agency-finish-registry-wiring-and-dhs-components.md`. ID3e (county vocabulary) remains ready.

## 2026-09-12 — ID3a-b SHIPPED: canonicalize_agency() contamination fixed (NAVY/STATE/DOC/ICE), GSA using-agency added

Ran the ID3a-b prompt live against gov (`scknotsqkcheojiaewwh`). Migration
`supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`,
applied and backfilled (properties/leases/sales_transactions), reversible via
`_gov_id3ab_agency_backup_20260912`. Guard `test/gov-id3ab-agency-canonicalizer.test.mjs` (14
tests); full suite green (5,992 pass / 0 fail / 6 skipped).

**The regex fixes, live-measured before/after (properties table):**
- NAVY **150 → 3** — `*federal credit union` excluded before the NAVY branch (145 *Navy Federal
  Credit Union* rows now resolve NULL → review `private_company_name_collision`).
- STATE **213 → 9** — bare `\mstate\M` replaced with a closed allowlist. It was matching the
  ordinary English word inside 213 STATE-GOVERNMENT names: "State of Texas", "Washington State
  Dept of Social and Health Services", and "DEPARTMENT OF STATE HEALTH SERVICES" (Texas DSHS),
  which contains the literal substring "department of state" and would have survived a
  substring-only fix.
- Bare DOC **16 → 1** (the 1 survivor is "North Carolina Department of Commerce", spelled-out
  phrase). The other 15 (`DOC`, `DOC/P&PO`, `DOC&PS`) route to review as
  `ambiguous_doc_commerce_or_corrections` — never auto-linked to Commerce.
- **Found while shipping, not in the original brief:** ICE **44 → 43** — `\mice\M` was matching
  "Handel's Homemade Ice Cream & Yogurt". Same shape as NAVY, fixed the same way.
- `RICHMOND FIELD OFFICE (VA)` and every trailing `"(<two letters>)"` state-code suffix are now
  stripped BEFORE any keyword match, generally — not a Richmond/VA-specific patch.
- ACE aliased to USACE **case-sensitively on the raw input only** — a bare lowercase `\mace\M`
  was deliberately NOT added (this exact repo's gov CLAUDE.md documents an "Ace Hardware" sale
  existing in this database; a lowercase word-boundary match would misread it as the Army Corps).
- NAVY/ARMY/DOC/LSC/DOL/USGS/NRC/NIH/NLRB/USAF/TREAS were **already live** in
  `canonicalize_agency_full()` — a QA-24/QA-30 hand-patch the committed migration never reflected
  (a "running but not merged" case). Committed the live body verbatim rather than re-adding rows
  that already existed.
- `GSA - <AGENCY>` measured at **624 properties / 106 distinct raw strings** (not the ~168–330
  estimated). `agency_canonical` stays GSA (lease counterparty, unchanged); a second pair of
  columns, `using_agency_canonical`/`using_agency_full`, carries the occupying agency — one lease,
  two facts. 456 of 624 resolve today; the rest use an abbreviated form ("dept of" not "department
  of") the comparator doesn't expand — a stated gap, NULL not guessed.

**Still live, confirmed, filed as ID3a-c, NOT fixed here (scope discipline):** DOJ (includes
`TEXAS JUVENILE JUSTICE DEPARTMENT` ×5), EPA (a Georgia state environmental dept), DOL (two
Pennsylvania Dept-of-Labor-and-Industry variants), ED (Alabama's + a NJ school board's education
depts), DOT (California's + NY State's transportation depts) each fold in a same-named STATE
agency, the identical shape STATE just had fixed. The separate `government_agencies`/
`gov_agency_aliases` FK registry ID3a wired is untouched by this change — display column and FK
registry are two different systems on purpose (`ID3a-regdup`, `ID3a-registry-gaps`,
`ID3a-detector-schedule`, `ID3a-consumer-switch` all remain open, unrelated to this fix).

Docs updated in the same change: `PLANNED-BACKLOG.md` (§P0d rows ID3a-b, ID3a-canonical-repair,
ID3a-gsa-compound closed/updated; new row ID3a-c filed), `data-coherence-invariants.md` (I13),
`CURRENT-STATE.md`.
## 2026-09-12 — ID3e SHIPPED: county/city vocabulary fold (I14), never merges across state

Built from the pre-written prompt (`docs/claude-code/prompts/ID3e-county-city-vocabulary-fold.md`) and its own
measurement note. Re-measured live before building (numbers move slightly, as expected): gov `properties.county`/`state`
2,445→1,611 (834 collapse), gov `city`/`state` 3,454→3,225 (229 collapse), dia `medicare_clinics.city`/`state`
4,367→3,635 (732 collapse). **This is I14 controlled-vocabulary work, not ID3a's FK-wiring pattern** — no registry
table, no `_id` column: one IMMUTABLE normalizer (`gov_normalize_place_token`/`dia_normalize_place_token`) + STORED
generated columns (`county_norm`/`city_norm`) keyed on `(normalized_name, lower(trim(state)))` as a **pair, never name
alone**. Verified live: `St Louis|mn` ≠ `St Louis|mo` (cross-state same-name counties never fold); `RICHMOND (CITY)`
and `Richmond city` fold to one `richmond city|va` key (VA independent cities fold across punctuation, never with a
same-named county — punctuation normalizes to a **space**, never deleted, which is what keeps the `city` token alive).
The two corrupted-state rows (`property_id 6638` state=`M`, `property_id 16465` state=`|`) route to
`v_gov_place_vocab_state_review`, untouched. Parity views `v_{gov,dia}_{county,city}_fold_groups` expose every merged
group. `property_type` (96 values, only 9 collapse) confirmed a taxonomy question, not a case-fold — scoped out as
`ID3e-property-type-taxonomy`. Migrations applied live + committed
(`supabase/migrations/{government,dialysis}/20260912120000_*_id3e_*_vocab_fold.sql`); offline structural guard
`test/id3e-migration-shape.test.mjs` (13/13 pass, comments stripped before matching); live positive-control
`test/sql/id3e-place-vocab-fold.live.test.mjs` (kept out of the `npm test` glob per the hermetic-suite doctrine — it
reaches Supabase directly, so it's a manual/CI-secret-gated check, not a `npm test` member). Full suite: 5,991 pass /
0 fail / 6 skipped. **Not built:** no consumer repointed to read the new columns yet — that's a separate decision.

## 2026-09-12 — ID2a-cleanup + ID3a reconciled: operator registry clean; gov agency WIRED but the NAVY regex is still live

Both responses filed. **ID2a-cleanup (PR #2337) verified live:** aliases 42 → 207, review queue 1,020 → 71 open, 807
category/payer rows routed to `properties.operator_class`, 5 subsidiaries parented (not merged), 9 junk rows
reclassified, `operator_id` 9,307 → 9,449, parity byte-identical on the 7 canonicals. **ID3a (PRs #2338/#2339)
measured before building** — and caught a live contamination bug: `canonicalize_agency()` prefix-matches `^navy`
with no word boundary, so 145 **Navy Federal Credit Union** rows (a private bank) carry `agency_canonical='NAVY'`.
Wiring shipped anyway: `properties.agency_id` 0 → **7,369/20,509**, `property_agencies.agency_id` 0.12% → **90.3%**,
alias/review tables and both guards live. **Cowork live check: the bug is NOT fixed** — the NAVY rows are unlinked only
because no `NAVY` registry row exists, and `canonicalize_agency('Navy Federal Credit Union')` still returns `NAVY`, so
adding that row would promote a credit union to a federal agency across 145 properties. Also open: 1,732 rows
canonicalized-but-unlinked, 8,838 with agency text and no canonical, and the registry lacks NAVY/ARMY/DOC/LSC/DOL/
USGS/NRC/NIH/NLRB/USAF/TREAS (it has `USACE` but no `ACE` alias — the 614 Tully Rd twin, ID3i). **Scott decided
(2026-09-12):** `RICHMOND FIELD OFFICE (VA)` is **Virginia**, not Veterans Affairs; bare `DOC` is state **Corrections**
— verify all 16, auto-link none; **`GSA - <AGENCY>` is SINGLE-TENANT** — *"the tenant is the GSA but the user is whatever
is second"* — so keep one lease and add a using-agency field beside the lease-counterparty agency. New row **ID3a-b**
carries all of it, regex fix first. **Next:** send `prompts/ID3ab-agency-canonicalizer-fix-and-finish-wiring.md`.

## 2026-09-12 — ID2a-cleanup SHIPPED and live-verified against Dialysis_DB (aliases 42→207, review 1,020→71)

Ran the ID2a-cleanup prompt against live Dialysis_DB (`mcp__Supabase__apply_migration`, real writes,
measured before AND after in the same session — not a static-analysis prediction). Migration
`supabase/migrations/dialysis/20260912120000_dia_id2acleanup_operator_registry_finish.sql`.

The fix that shrank everything else: **seeded an exact-match alias for every live company operator's
own name + `dba_names`** — `dia_resolve_operator` only ever knew the 6 hardcoded families, so a
property whose raw text was literally a registered operator's own name (Northwest Kidney Centers,
Wake Forest University, Sanford Health, ...) still hard-blocked into the review queue. Aliases
42 → 207; review queue 1,020 open → **71 open** (142 resolved onto 14 real operators, verified
byte-exact against the parity table; 807 dismissed as classifications, see next). Also: merged the
two byte-identical `Us Renal Care Inc` / `Dialysis Clinic Inc` duplicates ID2a's exact-string array
missed; parented (never merged) BMA Quincy / BMA OF NORTH CHARLOTTE / KNICKERBOCKER under Fresenius
and DCI East Gainesville under DCI; reclassified 9 person/junk rows to a new `kind='junk'`; added
additive `properties.operator_class` (category/payer/non_operator) so those rows never occupy a human
queue slot again, backfilled on the 807 already-existing rows too; shipped the orphan-registry-gap
detector (`v_dia_operator_orphan_registry_gap`, reads 0 today) for the ID3a-class generalization.
**Parity proven, not asserted:** the 7 pre-existing merged canonicals are byte-identical
before/after (0 properties moved by the two new dedup merges — both duplicates carried 0 properties).
Guard `test/id2a-cleanup-operator-registry.test.mjs` (13 tests) + full suite green (5,966/0).
**ID2b is now unblocked on the registry side** — `operator_id` covers 9,449/11,804 (80.1%), see
`PLANNED-BACKLOG.md` §P0d ID2a-cleanup/ID2b/ID2c-payer. **Next:** ID2b (consumer switch) or ID3a
(gov agency wiring), per Scott's priority.
## 2026-09-12 -- ID3a measured before wiring: the canonicalizer itself has a live contamination bug

Picked up ID3a next (Scott's #1 identity class, ranked first 2026-09-12). Before touching the
alias/backfill/guard build the drafted prompt calls for, did its own Section 1 ("measure before
wiring") live against the gov database -- the same discipline that caught OWN-T0h's counting bug and
RO4's root cause.

Two findings that change the prompt's scope, both live-verified:

1. The "811 distinct uncanonicalized agency strings" population is contaminated by literal archived
   junk: 2,670 rows / 20 strings carry `data_source='junk_backfill_archived_2026-06-09'` (e.g. "10
   Federal Self Storage" duplicated across 10+ property_id rows at one address). Excluding them, the
   real population is 6,168 rows / 804 distinct strings.

2. More important: even the ALREADY-canonicalized 8,674 rows have drift -- 887 carry a code with no
   matching row in the 65-row `government_agencies` registry. Read each code's raw strings rather than
   assuming they're all registry gaps, and found one is not a gap at all but a live bug: `NAVY` (150
   rows) is 145 rows of "Navy Federal Credit Union" -- a private bank -- because
   `canonicalize_agency()`'s own regex (`gov_round_76bg_agency_canonicalizer.sql` line 53,
   `x ~ '^navy|department of the navy'`) prefix-matches "Navy" with no word boundary. `DOC` (16 rows,
   mostly bare `DOC`/`DOC/P&PO`/`DOC&PS`) is plausibly the same class -- likely a state Department of
   Corrections abbreviation read as federal Commerce -- flagged as unconfirmed rather than guessed. The
   other 9 missing codes (LSC/DOL/USGS/ARMY/NRC/NIH/NLRB/USAF/TREAS, ~400 rows) are genuine, safe
   registry gaps -- real federal agencies just missing a row.

This flips the ID3a build order: wiring `properties.agency_id`/`property_agencies.agency_id` to the
existing canonicalizer BEFORE fixing the NAVY regex would durably promote a private credit union to a
federal-agency record on every property it touches -- a worse defect than the unwired FK it was meant
to fix. Documented both findings in the ID3a backlog row and added a warning block directly to
`docs/claude-code/prompts/ID3a-gov-agency-wiring-and-first-detector.md` (the artifact a build session
will actually read) so this isn't rediscovered the hard way mid-build.

No code changed -- this was measurement only, same as RO4/RO5's pattern. The safe registry-gap
backfill (9 codes) can proceed independently since it's additive and doesn't touch the regex; the NAVY
fix and the DOC verification are prerequisites for the FK wiring itself.

## 2026-09-12 -- checked the response queue (both already merged), then wrote RO3's field-mapping design

Two pasted Claude Code responses were waiting in docs/claude-code/responses/: ID2a (the operator
registry backfill, including its live schema-mismatch fix, multi-tenant write-bug fix, and parity
fan-out fix) and ID4 (the identity-integrity baseline measurement + resolver framework design). Traced
both through git history rather than assuming -- ID2a's full branch (`claude/affectionate-feynman-ozqb87`,
all three follow-up commits) is merged via PR #2333, and ID4's docs-only PR #2329 is merged via
`c3f10537`. Nothing to reconcile; moved both .docx files to responses/done/ (gitignored, no commit
needed for the move itself).

Then did the RO3 next step I'd recommended in the last PR: wrote the field-mapping design rather than
touching code. Added a new section to `docs/architecture/ownership-history-lane.md` (the canonical
page for this whole thread) covering: the population query (`v_ownership_resolution`'s 761-row
filter -> the reconciled store's gov `conflict`-state properties, 1,752 today), which card fields move
unchanged (still read from gov's own `recorded_owners`/`true_owners`), which fields map from the
reconciled store's shape but aren't a 1:1 rename (`proposed_owner_name`, `primary_signal`, `evidence`,
`recommended_action`, `owner_guards_pass`), and which fields have no reconciled-store equivalent at all
(the deed/lessor/discrepancy-specific columns -- `latest_deed_date`, `deed_conflict_kind`,
`suspected_grantor/grantee`, etc.). Flagged two real design calls for Scott rather than guessing:
whether `sponsor_family_confirmed` properties should surface on the card at all (OWN-T0e already
confirmed them), and whether to drop the deed/lessor/discrepancy-only fields or keep reading
`v_ownership_resolution` alongside the reconciled store just to backfill them (which would undercut the
whole point of the migration). The write side (`keep`/`update_owner`/`confirm_sale`/`research`) needs
no changes -- it already writes to gov's own tables, not the reconciled store.

Updated `docs/os/PLANNED-BACKLOG.md`'s RO3 row to point at the design section. No code changed --
still waiting on Scott's answer to the two open questions before writing the actual repoint.

## 2026-09-12 — ID2a + ID4 reconciled: operator FK live (9,307/11,804); the CMS 2,450 tie is OUR dedup, not CMS; ID3 order set

Filed both responses → `done/`. **ID2a (merged):** registry gained `kind`/`parent_operator_id`/`merged_into_operator_id`,
`dia_operator_aliases` (42) and `dia_operator_write_review` shipped, **hard write guards live on `properties` and `leases`**,
backfill applied (9,309 auto / 1,018 review). It also self-caught two defects while verifying: the DaVita regex matching the
first token of the piped multi-tenant artifacts, and a parity-view fan-out — both fixed in SQL and the JS mirror in lock-step.
**Cowork verified live:** `operator_id` 9,307/11,804; review 1,020 open; parity DaVita 4,435 · **Fresenius Medical Care 3,769
(= 3,733 + 36, the approved merge)** · US Renal Care 465 · DCI 301 · ARA 244 · Satellite 92 · DaVita at Home 1.
**Two corrections to ID4's baseline:** (1) it read `operators` as 14 rows — live it is **67**, and inside `kind='company'` the
duplicates, clinic-level rows (BMA/Knickerbocker = Fresenius subsidiaries) and person/junk rows survive unmerged, with only 1
parent link → new row **ID2a-cleanup**, which also records that **683 `Independent` + 84 `Other` of the 1,020 review rows are
categories, not review work**, and that the remaining ~253 are known operators absent from the 42-row alias table because the
resolver still knows only 6 families. (2) Its I15 retraction was half right: raw counts are 2,796/2,768, but on eligible rows
both are **exactly 2,450** — cut by **our own dedup pass, 2026-07-22 16:01:22**, which demoted 346 + 318 rows → new row
**B6d-cms-dedup**. ID4's framework lesson stands and is stronger than the original plan: **per-class comparators, never one
shared normalizer** (broker surnames collide). ID4's duplicate backlog section merged into §P0d. **Scott decided:** ID3a
(gov agency wiring) first, then ID3e (county vocabulary), then ID3b/ID3d; **ID3c holds for BR1–BR5**; detectors prove out on
the agency class before generalizing. **Next:** ID2a-cleanup + ID3a.

## 2026-09-11 -- RO5 sized: joined the 761 gov disputes to the reconciled store; Scott decided RO3

Scott answered the RO3 design question directly: repoint `resolve_ownership` at the reconciled
store (merge into OWN-T0's conflict lane), not build it as a separate door. Before touching a live
financial-write lane, did RO5's sizing first -- read the full current `resolve_ownership` GET/apply
contract in `api/admin.js` (GET ~line 8757, apply ~line 12386), then pulled `v_ownership_resolution`'s
761 genuine-dispute gov properties from the gov project and `v_lcc_property_ownership_reconciled`'s
gov-domain current/primary rows (9,717 properties) from LCC Opps, and joined them locally in Python
(cross-project SQL join isn't possible -- separate Postgres instances).

Result: 742 of 761 (97.5%) disputed properties are present in the reconciled store; 19 absent
(mostly person-name-format mismatches, e.g. `LIDDELL ANDY` / `Andy Liddell`). Of the 742 present:
169 (23%) match the lane's `proposed_owner_name`, 198 (26%) match only `current_recorded_owner_name`
(reconciled store rejected the lane's proposal), 253 (33%) match only `true_owner_name` (reconciled
store already agrees with gov's own true-owner field), and 122 (16%) are hard disagreements where
the reconciled store's primary owner matches none of the lane's three names -- 88 of those still
carry the reconciled store's own `conflict_class` (mostly `unclassified_rival`, largely the Boyd
Watterson/Easterly/Gardner Tanenbaum sponsor-family SPE shapes OWN-T0e already handles), 57 are
`is_domain_true_owner=true` (high confidence) vs 65 not.

This means repointing the lane isn't a narrow fix: the reconciled store's gov `conflict` population
is 1,752 properties today, not 761 -- a larger, different population (it carries lessor/
relationship-graph disagreements the deed-only lane never saw, and drops the 253 that already agree
with true_owner). Documented the migration scope in RO3's row rather than writing code: the four
write-verdict paths (`keep`/`update_owner`/`confirm_sale`/`research`) call real gov RPCs behind
existing guards (`DECISION_GOV_WRITEBACK`, $50k floor) and should be preserved as-is; only the
source population/context query needs repointing, with a field mapping from the reconciled store's
ranked-candidate shape onto the card's recorded/proposed/true-owner fields (not a 1:1 rename).
Recommended a written field-mapping design before any code change, given this lane's live write
actions.

Updated `docs/os/PLANNED-BACKLOG.md`'s RO5 row (closed, sized) and RO3 row (decision recorded,
migration scope documented, not built).

## 2026-09-11 -- RO4 root-caused: the missing deed dates are genuinely unknown, not lost

Picked up RO4 next (why 391 of 598 deed-arm properties carry no `latest_deed_date`, and whether
`is_newer_than_recorded` is misnamed as the audit suspected). Re-measured live: 391 of 599 today
(65.3%, matches). Traced the whole path rather than guessing: `v_ownership_resolution`'s
`DISTINCT ON ... ORDER BY latest_deed_date DESC NULLS LAST` already prefers a dated row when one
exists, so the view isn't swallowing dates. `properties.latest_deed_date` is fed from
`deed_records.recording_date` via a write path (`deed-parser.js`) that always writes the grantee but
only writes the date when one parses. Checked `deed_records` directly for all 391 properties: zero
have a `recording_date` that `properties` is failing to pick up -- every one is null all the way down
to the raw capture. Sampled the raw payload: a minimal grantee-only stub (`grantor`, `deed_type`,
`document_number` all null, `consideration: 0`) across 229 distinct counties nationwide -- not one
source's formatting bug, a genuine capture limitation spread across the whole footprint.

Conclusion: nothing upstream to fix -- the date is truly unknown for these 391, not lost by a bug.
The real, actionable finding is the one the audit already named: `is_newer_than_recorded`
(`latest_deed_date IS NOT NULL`) collapses "confirmed not newer" and "we don't have a date" into the
same `false`. Documented that whoever eventually builds RO3's card should expose
`latest_deed_date IS NULL` as its own explicit "date unknown" state. Not built here -- RO3 (whether
this lane should exist beside OWN-T0e or become OWN-T0's gov arm) is a design question for Scott,
not decided yet, so there's no card today to fix.

Updated `docs/os/PLANNED-BACKLOG.md`'s RO4 row (closed, root-caused).

## 2026-09-11 — ID2a SHIPPED (unapplied): operator registry + alias table + resolver + hard write guard + reviewed backfill

`prompts/ID2a-operator-registry-resolver-and-guard.md` executed. Migration
`supabase/migrations/dialysis/20260911200000_dia_id2a_operator_registry.sql` (Dialysis_DB) rebuilds
`operators` (kind company/category/payer/non_operator, `parent_operator_id` for brand children,
`merged_into_operator_id` for retired dupes — retire, never delete), adds `dia_operator_aliases`
(seeded), the single resolver `dia_resolve_operator(text)` (fails closed, never mints), `operator_id`
FKs on `properties`/`leases`, a **hard-block** write-guard trigger on `properties.operator` (RAISEs on
an unresolved non-blank value; leases guarded only if it turns out to carry a raw text `operator`
column — unverified from this sandbox), and a dry-run-default reviewed backfill function.
`api/_shared/operator-normalize.js` renamed the canonical Fresenius/US Renal Care targets to match
Scott's §11 decisions, in lock-step with the SQL mirror re-declared in the same migration, and gained
`resolveOperatorAgainstRegistry()` — the JS wrapper over the SQL resolver RPC. Guard
`test/id2a-operator-registry.test.mjs` (22 tests, full suite 5,950/5,950 green).

⚠️ **NOT live.** This sandbox has no Dialysis_DB credentials — the migration was never applied and
none of its own numbers (registry before/after, alias count, auto/review split, FK coverage, the §4
cap-band parity gate) were measured. The migration ships the exact verification queries (§13); Cowork
or Scott must run the dry-run backfill first, read the split, apply, then run the parity check before
ID2b (consumer switch) relies on anything here.

🔴 **New finding, from this guard's own first run, not either audit pass:** `api/_shared/tenant-canonical.js`
is a live, pre-existing FOURTH operator canonicalizer (writes `dia.leases.tenant`, not
`properties.operator`) whose spellings now DISAGREE with the ID2a decision
(`'DaVita Kidney Care'`/`'U.S. Renal Care'`/`'DCI'`/`'Innovative Renal Care'` vs the registry's
`'DaVita'`/`'US Renal Care'`/`'Dialysis Clinic, Inc.'`/`'American Renal Associates'`). Out of scope
for ID2a (different column, and "no new normalizer" means adding none, not retrofitting a pre-existing
one) — filed as **ID2c** in `PLANNED-BACKLOG.md`.

Backlog: `PLANNED-BACKLOG.md` ID2a marked shipped-unapplied; ID2b (consumer switch) and ID2c (the
tenant-canonical.js finding) opened.
## 2026-09-11 -- RO2a sized: 1,380 gov recorded_owners name-variant groups, merge lane deferred

Picked up RO2a next (fleet-wide sizing of same-party name variants in gov `recorded_owners`, named
but not run by the 2026-09-08 audit). Grouped live (unmerged) owners by `gov_owner_strict_core`,
gating on core length >= 4 after finding the suffix-stripper produces false-positive collisions
below that (`GLP` strict-cores to `g` because its trailing `lp` reads as the "Limited Partnership"
suffix token -- 26 short-core groups / 60 rows excluded on this basis).

Split what's left into two real populations rather than one number: 311 exact-duplicate-name groups
(628 rows, 589 properties touched) where the identical literal name sits on multiple separate
`recorded_owner_id` rows -- the safest, purely mechanical class -- and 1,069 true name-variant groups
(2,242 rows, 800 property-referenced, 1,218 properties touched) that are genuine punctuation/
abbreviation/suffix variants of one party. Spot-checked both the largest groups and the short (4-6
char) end; mostly clean, but found the SAME risk class RO2b just fixed sitting inside this
population too -- `CBRE` / `CBRE, Inc.` and a 4-way `U.S. Bank National Association` group are a
brokerage and a lienholder, not obviously real owners to blind-merge. Flagged that any future merge
sweep must run every group through `isCompetitorBroker` / `isFederalOwnerAntiPattern` / a bank-lender
check before merging, same guards RO2b just added.

Recommendation: this population (1,380 groups / 2,870 rows / ~1,807 properties combined) is big
enough to be its own build, not a quick follow-on -- the merge itself has to move
`properties.recorded_owner_id` and any deed/lease FK refs, log a reversible batch, and dry-run first.
Did not build it this pass; sized and documented only, per the row's own ask ("size... before
proposing a merge lane").

Updated `docs/os/PLANNED-BACKLOG.md`'s RO2a row (closed, sized).

## 2026-09-11 — ID2 decisions settled by Scott; ID2a prompt drafted (registry + resolver + hard guard)

Scott decided the four 👤 items ID1 raised: canonical **`Fresenius Medical Care`** (with `short_operator: 'Fresenius'`
kept for chart labels) and **`US Renal Care`**; the registry lives in **Dialysis_DB** with LCC referencing it through
`external_identities` (`source_type='operator'`), not a second identity; the write guard is a **hard block plus alert**
(unresolvable text is refused and routed to a review lane); gov agency identity is a **separate** build (ID3a). ID2 is
split into **ID2a** (registry with parent/brand hierarchy, alias table, one resolver replacing the second canonical,
`operator_id` FK, hard guard, reviewed backfill with a cap-rate-band parity gate) and **ID2b** (consumer switch with
per-surface parity). Audit §11 records the decisions. **Next:** send `prompts/ID2a-operator-registry-resolver-and-guard.md`;
`prompts/ID4-identity-integrity-program.md` is also unblocked and can run in parallel (detectors only, no data writes).

## 2026-09-11 -- RO2b fixed: RMR/USPS/hedge-phrase can never become a recorded owner again

Picked up RO2b next (the 9 named deed-grantee capture artifacts the 2026-09-08 audit found passing
`granteePassesOwnerGuards`). Fixed at the guard, not just the 9 existing rows: `RMR` / `The RMR
Group` (the property MANAGER of GPT/OPI-portfolio assets, 7 of the 9) and `USPS` (the federal
TENANT, 1 of the 9) are now a small literal-name reject inside `granteePassesOwnerGuards` -- the
audit was right that 2 capture artifacts don't earn a generalized regex class. The hedge-phrase row
(`CIM Group or affiliated investors`, the 9th) is different: OWN-T0i sized that exact shape
fleet-wide earlier today (57 live entities in LCC `entities`), so it IS a real class, not a one-off
-- reused the same regex here rather than writing a second one.

This closes the loop the guard was supposed to close: any FUTURE deed capture of these names is now
rejected before it can become a recorded owner, not just the 9 instances the audit already found.
Added 3 new unit tests covering all three (RMR variants, USPS variants, two different hedge
phrases); ran the full `owner-deed-propagation` (39/39) and `deed-parser` (58/58) suites clean.

One bump along the way worth naming honestly: my first attempt at the hedge-phrase regex silently
wrote literal backspace bytes instead of `\b` word-boundary escapes (a Python string-literal
footgun in the edit script, not a JS issue) -- caught it because the new test for that exact case
failed, fixed by writing the JS source as a raw string, re-ran clean. Recorded here so the pattern is
recognized faster next time a generated regex needs debugging.

Updated `docs/os/PLANNED-BACKLOG.md`'s RO2b row (closed, fixed).

## 2026-09-11 — ID1 reconciled (PRs #2323/#2325 merged): figures confirmed live; composite attribution resolved; ID3i (multi-tenant + cross-lane twins); 4 decisions gate ID2

Filed `responses/ID1 desktop response.docx` → `done/`; ID1 prompt → `prompts/done/`. ID1 produced
`docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` (writer inventory W1–W10, registry duplication across dia `operators`,
LCC `lcc_operator_affiliate_patterns` and `operator-normalize.js`, design §5), then a live follow-up (§9): gov already has
`agency_canonical` (45 codes) and a 65-row `government_agencies` registry, but **neither is wired** (`agency_id` 0/20,509); LCC
`entities` is polluted with operator-named asset entities; `cortex_market_intel` exists (writer outside the repo). Claude
Code also merged the two ID backlog blocks into one table. **Cowork (read-only) confirmed** the gov and LCC figures exactly and
**resolved open item 3**: the `DaVita | …` values are multi-tenant buildings stored as one piped tenant string; operators
70–80 were minted in one bulk batch on 2026-04-28 04:26 UTC. **New:** 614 Tully Rd, San Jose exists as dia 30681 **and** gov
30447 (`agency='ACE'`, canonical NULL) with no link → **ID3i** (multi-tenant modeling + cross-lane twins, ties to P10a). Audit
§10 added. **ID2 waits on Scott's 4 decisions** (canonical names, registry home, DB guard, gov sequencing). **ID4 is ready to send.**

## 2026-09-11 — ID1/ID2/ID3 backlog blocks reconciled (two parallel threads, one table)

`docs/os/PLANNED-BACKLOG.md` §P0d carried two independently-sourced `ID1`→`ID2`→`ID3` blocks: the
Cowork-prompted operator-identity audit (this file's own ID1 entries above) and a separately-run,
more granular ID0 probe (`docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`) with its own
`ID1`/`ID2`/`ID3a–f` rows. Per this repo's own "two windows, one file" doctrine, folded into ONE
table rather than adjudicated: the duplicate pre-audit `ID1`/`ID2` restatements are retired in
place with a note (nothing deleted from history), the ID0 probe's six sub-classes (`ID3a`–`ID3f`)
are kept verbatim and cross-referenced against the audit's own §9.1/§9.5 findings where they
overlap (gov agency identity, `ID3a` — the two passes corroborate, not duplicate, each other's
numbers), and the audit's two NEW findings not in the ID0 probe are added as `ID3g` (LCC Opps
entity-name operator-substring pollution) and `ID3h` (`cortex_market_intel.tenant`, confirmed
real). `ID4`'s prompt was written to fire "after the ID1 response is reconciled" — that gate is now
satisfied, and its row is marked unblocked/ready to send.

## 2026-09-11 — ID1 live-DB follow-up: government + LCC Opps measured (PR #2323); corrects the sibling ranking below

The ID1 entry immediately below this one shipped with no live DB credentials and marked
government/LCC Opps as proposed-but-not-run queries. This pass had live Supabase access
(read-only `SELECT`/`information_schema` only — no writes, no migrations, no flag flips) and ran
them. New `§9` appended to `docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` (nothing above §9
was rewritten — corrections point back to it, per this repo's own "correct in place with the
measurement, never delete" doctrine).

**Corrects a claim in the entry below: government does NOT have "no normalizer at all."**
`gov.properties.agency_canonical` already collapses 1,286 raw strings to 45 clean codes (VA 2,174,
GSA 1,911, SSA 1,408, USDA 672, …), and a 65-row `government_agencies` registry already exists.
**The real defect is unwired plumbing, not a missing normalizer**: `properties.agency_id` is **0 of
20,509** populated, and the multi-tenant bridge `property_agencies` (132,243 rows, 7,865
properties) sits at **160/132,243 (0.12%) FK coverage** against **498 distinct, unnormalized**
`agency_code` values — worse FK coverage than dialysis operator (30–78%), via a different
mechanism. Still ranked #1 sibling by reach, now for a cheaper reason: wire two already-existing FK
columns to an already-existing registry, don't build a normalizer from nothing.

**Resolves an open item: the LCC Opps `lcc_operator_affiliate_patterns` seed did NOT degrade.** 230
patterns / **29 distinct parent entities** live — well beyond the four operators named in the
migration's own text. Confirms the live canonical Fresenius entity is stored as `fresenius medical
care` (lowercase), directly from the row, not just from reading the seed SQL.

**Confirms `cortex_market_intel` exists and is live**, resolving the "could not locate" flag from
the prior pass: 922 rows, 897 carry a `tenant` value, **671 distinct strings**, no FK column at
all. Its writer is still not located in this repo — flagged as an open attribution gap, since this
repo's doctrine requires fixing a fact at its source of record and the source is unidentified.

**New finding, not in the original prompt: `entities.canonical_name` on LCC Opps carries 250+ rows
with `davita`/`fresenius` as a bare substring** — almost entirely `domain='dia'` property/deal
names minted by the asset-entity mint path (`asset-entity.js`), not operator identities (e.g.
`davita corpus christi padre island drive tx`, `fresenius kidney care center located in
hillsboro`). Worse: the operator's own bare name has been independently re-minted — **4 distinct
entity rows literally named `davita`**, **4 named `fresenius medical care`** — and only one of each
is the row the affiliate-pattern registry actually points at. This directly blocks the ID2 design's
planned "link entities to the operator registry by name match" step: a naive match would mismerge
hundreds of properties into the operator identity. Moved into the ranked sibling list at #3.

Backlog: `docs/os/PLANNED-BACKLOG.md` §P0d ID1/ID3 rows updated with the corrected government
ranking, the resolved seed/`cortex_market_intel` open items, and the new §9.4 entity-pollution
finding as a ranked sibling. **Still open, unchanged by this pass**: Scott's 👤 canonical-name
decision (§5.2 of the audit), the `DaVita | ...` composite-string attribution gap, and the
`cortex_market_intel` writer identity.
## 2026-09-11 -- OWN-T0i sized and filed: 57 hedge-phrase entities queued to junk_entity_review

Picked up OWN-T0i next (a small, well-scoped item OWN-T0e's design doc had already named but not
run). Sized `entities.name ~* '\m(or|and/or) (affiliated|related)\M'` fleet-wide: 57 live entities
(one match was already a merged tombstone, excluded) -- names like `GRE Partners LLC or affiliated
individuals`, `FGF Management LLC or affiliated individuals`, `Mercantil Servicios Financieros or
related stakeholders`. These are an extractor's stated uncertainty written as an owner name, never a
real party -- the same class RO2b already named one database over (`CIM Group or affiliated
investors`).

Sized the blast radius before filing anything: these 57 touch 50 distinct properties in
`lcc_entity_portfolio_facts` (38 current rows) and are a contributing owner-candidate on 24 of the
2,065 conflict properties from today's corrected OWN-T0h count -- so clearing them where possible
would shrink the real conflict count by up to that many.

Filed all 57 to `junk_entity_review` (`entities`/`lcc` is already a registered JUNK_TARGET with an
FK guard on `lcc_entity_portfolio_facts`) as `proposed_verdict='dismiss'`, `status='proposed'`,
`source_run_id='own_t0i_sql_2026-09-11'` -- queued for the existing human-gated apply path in
`api/admin.js` (`planJunkApply`), not auto-retired. That apply path's own FK guard means any of
these still standing as a property's ONLY current owner will route to a conflict card for a human to
pick a real replacement, rather than silently leaving the property with no owner on file.

Updated `docs/os/PLANNED-BACKLOG.md`'s OWN-T0i row (closed, sized + filed).

## 2026-09-11 — ID1 shipped: the operator-identity audit, and a THIRD registry the queuing note above missed

Executed the ID1 prompt in full (read-only against every live DB; no writes, no migrations, no flag
flips — no live DB credentials in this sandbox, so the deliverable cites Cowork's 2026-09-11 numbers
already on record plus a fresh repo-side writer inventory, per the doctrine's own "re-measure a dated
blocker" and "never fabricate" rules). Full deliverable:
`docs/audits/ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md`.

**The queuing note below said "operator-normalize.js and the registry disagree on the canonical
Fresenius name" — singular registry. There is a THIRD.** `supabase/migrations/20260522340000_lcc_
operator_affiliate_registry.sql` seeds `lcc_operator_affiliate_patterns` (LCC Opps), a subsidiary-
name-pattern registry keyed to `entities.id`, independent of both `dia.operators` and
`operator-normalize.js`. **Its seed resolves the Fresenius parent entity by `LOWER(name) = 'fresenius
medical care'`** — so 2 of the now-3 stores, plus CMS `chain_organization`, already say `Fresenius
Medical Care`; only `operator-normalize.js` says the shorter `Fresenius`, and by its own comment it
chose that spelling only because it was the majority instance of the free-text defect it exists to
clean up, not because any external authority uses it. This is the audit's central finding: a fix to
any one of the three stores alone cannot close the split, because none references either of the
others.

Also produced: a 9-writer inventory (this repo's OM promoter, sidebar/CoStar lease carry-forward,
the LCC-Opps entity-mint fallback that reads `properties.operator` as a name source with no FK back
to any registry, the P113 owner-guard reader, plus the Dialysis-repo CMS ingester); a ranked sibling
list (**government agency naming ranked #1** — same free-text-no-FK shape with *no* normalizer at
all, worse off than dialysis operator today); an 👤 canonical-name decision for Scott (Fresenius vs
Fresenius Medical Care, with the export-layer `short_operator` display token already able to absorb
either choice); and an open attribution gap on the `DaVita | ...` composite strings that needs a
direct row read to resolve. Backlog: ID1 marked ✅ shipped, ID2 gated on the 👤 decision, ID3 revised
with the ranked list (one item, `cortex_market_intel.tenant`, could not be located in this repo's
`api`/`mcp`/`scripts` this session and needs a direct DB check before it can be ranked at all).

**Next:** Scott's naming decision (ID1 §5.2), then ID2 (the build) split into the safe steps ID1 §5
lays out, starting with the comps engine as the shared substrate every other consumer reads from.
## 2026-09-11 -- Correction: OWN-T0h's "conflict count doubled to 4,478" was my own counting bug

Caught and fixed my own error from the OWN-T0h entry earlier today. That entry re-measured the
reconciled store's conflict count with `count(*)` and reported it had more than doubled since the
2026-09-02 audit (2,097 -> 4,478). That number was wrong: `count(*)` on
`v_lcc_property_ownership_reconciled` counts owner-CANDIDATE ROWS, not properties -- and every
conflict property carries >=2 rows by construction (that's what makes it a conflict), so `count(*)`
systematically inflates the property count.

Re-ran it correctly as `count(distinct (source_domain, source_property_id))`:
**2,065 conflict properties today (gov 1,752 / dia 313) -- essentially flat vs. the audit's 2,097**
(gov 1,769 / dia 328). The small drop is fully explained by OWN-T0e's confirm lane, which has been
converting `unclassified_rival` pairs into `sponsor_family_confirmed` (1,617->1,508 rival, 64->142
confirmed) plus a handful of merges (`duplicate_entity` 417->415). No mystery growth, no root-cause
follow-up needed -- retracting that flag entirely.

I'd already written the false "doubled" claim into three docs (`PLANNED-BACKLOG.md`'s OWN-T0h row,
`ownership-history-lane.md`, `CURRENT-STATE.md`) and told Scott directly. All three are corrected in
this commit, and this entry says so plainly rather than quietly overwriting the earlier claim.
Lesson for this lane going forward: always `count(distinct property)` on
`v_lcc_property_ownership_reconciled`, never `count(*)` -- the row/property distinction is easy to
miss because most other counts in this codebase (fact ledger rows, task rows) ARE the thing being
measured.

## 2026-09-11 — ID0: identity/value-domain probe across dia + gov — the operator split is a class, not an incident; ID4 drafted

Scott (after sending ID1): *"protection and cleaning code in place so we aren't operating a database with divergent
naming and connections… one intelligent and reconciled source of truth for all properties."* Cowork ran a read-only
probe on both domain DBs: for every identity/grouping-like text column, raw distinct vs normalized distinct (case,
punctuation, corporate suffix). Findings: `docs/audits/ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`. Worst:
**gov agency** (SSA split 4+ ways, VA 5+, ~3,300 properties; `RICHMOND FIELD OFFICE (VA)` ambiguous); **gov owners**
(`true_owners` 1,278 collapsible names + 81 identical-canonical groups; `recorded_owners` 1,241 / 115); **gov county**
(832 county/state pairs split by case); **dia guarantor** (DaVita/Fresenius legal entities split; subsidiaries must link,
not merge); **dia brokers** (116 identical-normalized groups). New invariants **I13 identity, I14 controlled
vocabularies, I15 import completeness** in `data-coherence-invariants.md` (detector table updated). Backlog §P0d:
ID3 → ID3a–f, plus **ID4** (standing detectors + shared resolver framework). Probe gotcha recorded: Postgres regex ``
is backspace; use `\y`. **Next:** ID1 is running; send `prompts/ID4-identity-integrity-program.md` after ID1 is reconciled.

## 2026-09-11 — Doctrine: truth is fixed at its source of record; operator-identity audit (ID1) queued ahead of MB-b

Scott, on the MB1e operator-name split: *"for any of these factual errors, we want to track the source to ensure that the
truth persists in all places, not just a patch… include a deeper review to ensure that there are not greater problems
underlying these naming and sorting issues."* Added as the first **Core doctrine in `CLAUDE.md`** (trace to the
source of record and every writer, fix with provenance, guard writers, move consumers to canonical ids, look one level
deeper). Cowork's read-only probe of Dialysis_DB confirms a **systemic identity defect**: the comps engine groups on
free-text `properties.operator` (no FK, 45 variants); the `operators` registry has duplicates (USRC ×3, DCI ×2, DaVita ×5)
plus categories and non-operators; `operator-normalize.js` and the registry disagree on the canonical Fresenius name;
FK coverage is partial (leases 30%); 979 clinics have no chain and no operator and drop out of every count. Backlog §P0d
gains **ID1** (audit, prompt drafted), **ID2** (build), and **ID3** (sibling sweep, linked to PDR2/OWN4/B6d-cms). MB1e item 1
re-scoped to ID; MB-b §0.1 now consumes `operator_id` (per-operator bands withheld as a named gap until ID2); spec design
rule 5. **Next:** send `prompts/ID1-operator-identity-source-of-record-audit.md`.

## 2026-09-11 -- OWN-T0h decided: reconciled store is canonical conflict count; found it doubled since 09-02

Picked up OWN-T0h next (the "756 vs 2,097 conflict denominators" question CURRENT-STATE.md had been
flagging as open since OWN-T0). Read both view definitions in full: `v_lcc_property_multi_current`
only checks whether `lcc_entity_portfolio_facts` disagrees with itself (>1 distinct current-survivor
entity on one property); `v_lcc_property_ownership_reconciled` additionally admits the resolver's
`lcc_property_owner` proposal and the domain true_owner mirror as competing current-owner candidates
-- which is what the property panel and Decision Center actually read, per OWN-T0's own "one door"
doctrine. **Decision: the reconciled store's count is canonical**, not `multi_current`'s -- they
answer different questions (data-hygiene-within-one-table vs. genuine cross-source ownership
disagreement), and the original audit had already said as much in its own §9.6 without finishing the
thought.

Re-measuring live to write the decision down surfaced something bigger than the original question:
the reconciled conflict count has **more than doubled since the 2026-09-02 audit -- 2,097 -> 4,478**
(gov 1,769->3,635, dia 328->843; by class: `unclassified_rival` 3,229, `duplicate_entity` 942,
`sponsor_family_confirmed` 307), confirmed stable on a second read minutes later. `multi_current`
itself barely moved (756->740, expected drift -- nothing end-dates those facts). Fleet size is flat
(8,068->8,070 current properties), so the growth isn't more properties -- it's more competing
current-owner-candidate claims landing on an unchanged fact ledger (more `lcc_property_owner`
resolver rows and/or `lcc_property_owner_facts` domain-mirror rows). **Did not investigate why** --
flagged plainly in all three docs so nobody quotes 4,478 as settled, and left as a named follow-up
rather than guessing at a cause I hadn't verified.

Updated `docs/os/PLANNED-BACKLOG.md` (OWN-T0h closed, decided + re-measured),
`docs/architecture/ownership-history-lane.md` § OWN-T0 (canonical page, replaced the stale
2,097/756 callouts with the decision and the live re-measurement), and `docs/os/CURRENT-STATE.md`'s
OWN-T0 row (same).

## 2026-09-11 — PRI5 merged and deployed; recommended another live CMS test run

Scott confirmed `Dialysis` PR `#7408` merged. `PLANNED-BACKLOG.md`'s `PRI5` row moved to ✅. Recommended
triggering another CMS ingestion run to verify live: does `ingestion_tracker`'s `reclaim_stale_started_runs()`
actually run and does a fresh run's own row close correctly this time; and does `census_demographics`
now either succeed or fail with an honest, recorded `run_status='failure'` instead of orphaning a
snapshot row. Every fix in this arc so far has been proven or caught out by an actual run, not by tests
alone — same discipline applies here.

## 2026-09-11 — PRI5 merged and deployed; recommended another live CMS test run

Scott confirmed `Dialysis` PR `#7408` merged. `PLANNED-BACKLOG.md`'s `PRI5` row moved to ✅. Recommended
triggering another CMS ingestion run to verify live: does `ingestion_tracker`'s `reclaim_stale_started_runs()`
actually run and does a fresh run's own row close correctly this time; and does `census_demographics`
now either succeed or fail with an honest, recorded `run_status='failure'` instead of orphaning a
snapshot row. Every fix in this arc so far has been proven or caught out by an actual run, not by tests
alone — same discipline applies here.
## 2026-09-11 — MB-a3 reconciled (PR #2313 merged): deployed + dry-run verified by Cowork; MB1e found; MB-b drafted

Filed `responses/MB-a3 desktop response.docx` → `done/`; prompt → `prompts/done/`. MB-a3 fixed `source_date` (source
as-of, never run time; justified exceptions for on-market count and zero-trades), added the CMS 45-day feed gate,
confirmed the DaVita = Fresenius = 2,450 tie is a single import batch (17 s apart; B6d-cms, Dialysis repo), declined to
flip because its sandbox saw a pre-fix build. **Cowork (read-only):** `/version` via pg_net = `78082f46` (the MB-a3 merge),
so the fix is live. GET dry-runs via pg_net with the vault key: **P-SQL `gaps:[]`**, 17 candidates — TTM band median
7.00% IQR 5.69–8.03% n=169; 211 on-market, 6.00% median ask; 8 `cms_census_gap:*` facts, no stale counts. **P-RSS:
Ollama reachable** (6 articles, 0 model failures), 0 facts (no dialysis content). New **MB1e**: operator-band
fragmentation (`Fresenius` vs `Fresenius Medical Care`, `DaVita` vs `DaVita Dialysis`), windowless/daily-keyed trades
zero-fact, no dialysis feed. Removed the duplicate 🔴 MB1d row the merge left behind. Spec design rule 4 (canonical fact
identity). **MBa-hold can lift — Scott's call** (flip SQL in OPERATOR-ACTIONS). OC-v still half done: standalone MCP not
redeployed (still 21 tools), 0 notes, no triage flag row. **Next:** `prompts/MBb-lane-briefs-daily-block-and-tab.md`.

## 2026-09-11 -- B1b graded: developer-chain floor NOT lifted (only 1.4% resolvable)

Picked up B1b as the next recommended step after OWN-T0j closed out. B1's own audit had
deliberately left `trace_ownership_to_developer`'s 983 below-floor skips (gov 514, dia 469) ungated,
pending grading its consumer (cron 145 / `developer-chain-resolve-tick`) the way A2 was graded for
`establish_ownership_history`.

Confirmed cron 145 is active (`cron.job`, every 6h, gov-only, limit=50) and its handler
(`api/_handlers/developer-chain-resolve.js`) is a mature, already-fully-automated, correctly
auth-gated consumer with two auto-write tiers (`bts_origin` conf 0.85, `developer_keyword` conf
0.7). But `lcc_chain_lane_has_auto_consumer()` is **hardcoded** to `gov + establish_ownership_history`
only -- it was never updated to recognize this lane, so `lcc_b1_reopen_below_floor()` is gated off
for it (`gov_has_consumer=false`, `dia_has_consumer=false`, confirmed live via
`pg_get_functiondef`).

Replicated the handler's exact classifier (`classifyDeveloperOrigin` -- read in full from source,
faithfully ported the bank/REIT/financier/agency/junk-shape/placeholder/dev-keyword/dev-brand
regexes into SQL) against the live 514 gov below-floor properties, joined to
`v_developer_chain_candidate` (0 missing from the view). Result: **only 7/514 (1.4%) would
auto-resolve** -- all 7 via Tier A `bts_origin`, zero via Tier B `developer_keyword`. The rest: 465
`ambiguous_generic_org`/`origin_is_person`, 36 `origin_equals_current`, 6 `no_chain`. dia's 469 have
no automated consumer at all -- the handler hard-returns a no-op for any domain other than `gov`.

This is a real, load-bearing contrast with A2's 89% automation rate for the other lane -- it
confirms B1a's "expect COVERAGE, not depth" caution was correct, and gives a live number behind it.
**Recommendation: do not lift the floor for this lane.** Reopening all 514 would mostly just refill
the queue with tasks cron 145 will immediately not-resolve (`origin_is_person`/`ambiguous_generic_org`
stay queued, retried every 7 days, forever). The 7 `bts_origin` resolves are few enough to hand-verify
and write directly if wanted, without reopening the other 507.

Also corrected a stale note found along the way: B1b's row said "Do B5 first" -- B5
(`docs/audits/B5_GOV_SELLER_EXIT_FEEDER_2026-08-28.md`) already shipped 2026-08-28. This grading ran
against B5's already-updated `gov.ownership_history`, so the prerequisite is satisfied; the note was
just never removed. Fixed in the same edit.

`PLANNED-BACKLOG.md` B1b row rewritten with the full grading result and marked closed
(graded · declined -- deliberately not automating this lane further, not a build left undone).

## 2026-09-11 -- MB-a3: freshness-honest on-box facts (CMS feed gate) -- flags withheld pending redeploy

Closed MB1d (`market-brief-facts.js`/`market-brief-psql-tick.js`): every P-SQL-derived fact's
`source_date` now comes from the SOURCE's own as-of, not the tick's run date. CMS operator counts
gate per-operator on `max(last_seen_date)` vs a 45-day SLA (mirrors dia `feed_freshness_registry`);
a stale operator (DaVita and Fresenius both measured live at max(last_seen_date)=2026-01-22, ~8
months stale, while their `cms_last_checked`/`source_last_seen` touch columns read days-old --
exactly the B6d-cms nightly-reupsert trap one column over) writes a named `cms_census_gap:<op>`
fact instead of a confident count. Cap-rate bands and the trades-since-last-run fact now date off
the newest comp `sale_date`, not `asOfIso`. Migration applied to Dialysis_DB (appended
`source_as_of` to `v_market_brief_cms_operator_counts`). 15 new tests, full suite 5,925/0/6-skipped.

Investigated the DaVita=Fresenius=2,450 tie (read-only): both operators' live rows share an
identical `created_at` batch window ending 2026-01-22 (max timestamps 17s apart) -- strong evidence
of a shared import-cap/pagination artifact in the last real CMS ingest before the outage, not
coincidence. Filed to the Dialysis repo's B6d-cms backlog; not fixed here (cross-repo, out of scope).

Verified live via `net.http_get` from LCC Opps: `tranquil-delight` `/version` still reads
`fc863b43d48f` -- this fix is committed, not deployed. **Deliberately did NOT flip
`MARKET_BRIEF_PSQL`/`MARKET_BRIEF_PRSS`** -- both are DB-controlled (`feature_flags_registry.state`,
via the env-OR-registry resolver), so flipping now would activate the OLD pre-fix code the moment it
next runs, re-shipping the exact staleness bug this unit closes. Flip only after a post-merge
Railway redeploy is confirmed (`/version` + `merge-base --is-ancestor`). P-RSS's `OLLAMA_URL`
reachability from `tranquil-delight` could not be confirmed from this session (no Railway env
access) -- named as an operator-verification item, not assumed either way.

See `docs/os/PLANNED-BACKLOG.md` §P18 row MB1d and `docs/architecture/EXEC-BRIEFS-SPEC.md` §9
"MB-a3" addendum for full detail.
## 2026-09-12 — ASC50 governed review workbench built and locally verified; publication pending

The completed 50-property source pass exposed two execution gaps: only the six source exceptions had review
rows, and their legacy property-form vocabulary did not match `healthcare_property_review:1.0`. Implemented an
authenticated `/asc-review.html` workbench plus `/api/asc-research-review`, exact request validation, and two
invoker RPCs for primary and independent second review. The migration maps persisted legacy forms to the
aggregate contract, retains `unresolved` only as a pre-scorecard exception sentinel for compatibility, stores
the two reviewer identities/timestamps separately, rejects self-second-review, and preserves disagreement.
Existing `final_disposition` values are never overwritten by primary scorecards. No candidate judgment or
production row-level review was made.

Verification: focused ASC/property-review suite **37/37 passed**; full suite **5,933 total / 5,927 passed /
0 failed / 6 skipped**; app boot passed after lockfile dependency install; changed files pass syntax and whitespace checks. Repository-wide lint remains red on pre-existing,
unrelated errors in `sidebar-pipeline.js`, `bridge-handlers-outlook.js`, and other files; this change introduced
no lint error in its API files. Protected-PR checks remain to run.

## 2026-09-11 — BUY0 Phase 0 complete: Geller Round 1 client deliverable + email draft; build handoff written (spec §9) and backlog rows BUY1a/1b + BUY-G1…G6 filed

Cowork. Round 1 for Jordan Geller is client-ready in `Team Briggs - Documents/Clients/Jordan Geller/2026 Industrial Search/Deliverables/Round 1 - Sep 2026/`
(Buyer Showing: 19 Focused ranked best→worst on Credit/Lease/Real Estate, Market Ranking, 207-row Broad Market, Sources & Notes, How to Use; full MSA
workbook; email draft in Scott's voice). Client folder reorganized with `00-README.md` as the pickup file. Credit leg automated on a bond-style scale
(American Airlines Ba3/B+ and Oil States ratings looked up). Spec gains §4.7 (OM sourcing, BUY-G3) and §9 (deliverable contract, seed code, gaps, build
order). Supersedes the unpushed local branch `docs/buy0-om-sourcing-layer` (its §4.7 content is included here). **Next:** Scott sends Round 1; build
starts with BUY1a when authorized.
## 2026-09-11 -- OWN-T0j verified end-to-end: real write succeeded, cache populated, closed out

Triggered the real POST directly via `select public.lcc_cron_post('/api/ownt0j-sponsor-classify-tick',
'{}'::jsonb, 'railway')` after the auth-convention fix deployed (Railway `a95fef46`, confirmed via
git merge-base against the fix commit). Got back `200 {"written":2462}`.

**Cache table now holds real data**: `sponsor_family_confirmed=482`, `unclassified_rival=1,980` --
byte-for-byte the same numbers every earlier independent measurement produced (this session's direct SQL
replication, the live GET dry-run before this write, the build's own original claim). The reporting view
(`v_lcc_ownt0j_sponsor_disagreement_report`) reads them back correctly too.

OWN-T0j is now genuinely done: built, two real bugs found post-ship and fixed (both in the untested
handler-level HTTP/auth code, not the well-tested pure classifier), and the whole path verified working
end-to-end rather than trusted on a response's say-so. Condensed the PLANNED-BACKLOG.md row (it had grown
through three separate verification passes into one very long entry) into a single closing summary; this
file keeps the full blow-by-blow.

**Next step.** Genuinely nothing left open on OWN-T0j. The ownership/contact-propagation thread's remaining
open items: `B1b` (developer chain, gated behind an unstarted `B5`) is the one entirely untouched item;
`OWN-T0e`'s own confirm lane still has the four candidates from the earlier investigation
(Realty Income, Elman Investors, Gardner Tanenbaum, USAA Real Estate) sitting for a human decision; and the
`gov`-token precision caveat above is worth a look before anyone confirms more short-token sponsor families.

## 2026-09-11 — MB-a2 reconciled (PR #2307 merged): fixes confirmed live; new blocker MB1d (false-fresh CMS facts); MB-a3 drafted

Filed `responses/MB-a2 desktop response.docx` + the already-reconciled `OWN-T0j desktop response.docx` (that thread's
review is the 2026-09-11 "OWN-T0j reviewed" entry) → `done/`; MBa2 prompt → `prompts/done/`. **Cowork live check
(read-only):** MB-a2 confirmed — `fact_key` + index, `MARKET_BRIEF_PSQL/PRSS` = off, crons `lcc-market-brief-psql`
07:15 / `-rss` 10:10 UTC active, `v_market_brief_cms_operator_counts` faithful (sum 6,695). App `tranquil-delight`
redeployed at `e42dbcb7` (per the OWN-T0j thread) → ticks are live behind OFF flags; 0 `producer_runs` yet. Standalone
MCP still lacks `log_operator_note`/`get_operator_inbox` → not redeployed; `operator_notes` still 0. **New defect
MB1d:** `buildCmsOperatorFacts` dates CMS counts with the run date (confidence 0.9) while the census is stale —
DaVita/Fresenius last seen 2026-01-22, `last_ingested_at` NULL, no inactive rows (B6d-cms outage) — and
**DaVita = Fresenius = 2,450 exactly** (likely capped import). Flipping PSQL now would publish a January census as
today's fact. Spec §9 design rule 3 (source-as-of dating + feed gate); OPERATOR-ACTIONS MBa-hold extended; OC-v item 1
marked half-done. **Next:** send `prompts/MBa3-freshness-honest-facts-and-live-flip.md`; after it merges, redeploy BOTH
services (carries OC-a's MCP tools).

## 2026-09-11 — ASC frozen 50 source collection complete; review gate is now the named next step

Read-only production reconciliation against the four healthcare research tables confirms Scott completed the
full frozen collection pass: **50/50 resolved, 0 pending — 44 captured and 6 reviewed source exceptions**.
The 44 captured candidates have 54 distinct payload rows (retry history retained); CoStar covers 44 candidates,
RCA covers 1, and only 1 has both licensed sources. Exception dispositions are 4
`licensed_sources_not_found`, 1 `parcel_owner_evidence_only`, and 1 `parcel_situs_evidence_only`.

Latest-capture identity distribution is 22 exact-token and 22 governed/non-exact or historical-mode-missing.
**Sixteen captured candidates plus all six exceptions require second review: 22/50, with 0 second reviewers
recorded.** Two historical captures have no stored identity mode; that is instrumentation missingness and must
not be silently backfilled. Structured collection coverage is strong for lot size (44/44), contacts and land SF
(43/44), tenant fields (42/44), parcel (41/44), and building class/SF (40/44), but weak for occupancy (12/44),
cap rate (10/44), and NOI (2/44). Those are availability measures, not commercial gate results.

Canonical docs now distinguish **collection complete** from **aggregate review complete**. New aggregate-only
checkpoint: `docs/audits/HEALTHCARE_ASC_50_PROPERTY_CAPTURE_CHECKPOINT_2026-09-11.md`. Updated the economics/
sampling plan, property-identity contract, CURRENT-STATE, BUILD-BACKLOG, PLANNED-BACKLOG, and documentation map.

**Next step:** complete the 22 independent second reviews, populate exactly one governed scorecard for each of
the 50 frozen fingerprints using the latest capture per candidate while preserving retries and exceptions,
run the existing privacy-safe aggregate-review contract, and apply the predeclared lane gates. Do not start
PI2–PI3, IDTF, canonical/CRM writes, outreach, or production promotion on collection completion alone.

## 2026-09-11 -- OWN-T0j: URL-length fix confirmed live, then a SECOND bug found -- POST always 401'd

Confirmed the previous fix (fix/ownt0j-true-owners-url-length) deployed: Railway /version now reads e42dbcb7,
an ancestor check confirms the fix commit is included, and curling the live GET route returns 200 with the
exact classification counts independently verified earlier (5,133/2,462/482/1,980).

Tried to trigger the real POST immediately rather than waiting ~30 min for the next cron fire -- called
`select public.lcc_cron_post('/api/ownt0j-sponsor-classify-tick', '{}'::jsonb, 'railway')` directly (the exact
call the cron makes, with the real X-LCC-Key pulled from Supabase Vault). It came back 401
`{"error":"unauthorized"}` -- with the correct key. That is not how an auth check should ever behave, so this
was investigated rather than shrugged off as a fluke.

**Root cause, in the same handler as the last fix**: `authenticate(req, res)` (api/_shared/auth.js) is async
and returns a user object, or null having already sent its own 401 -- the contract every other handler in this
repo follows (`const user = await authenticate(req, res); if (!user) return;`, per that file's own header
comment). OWN-T0j's tick instead called `authenticate(req)` with one argument and no `await`, then checked
`auth.ok` -- a property that does not exist on the real return shape, and would not exist even if awaited
correctly (authenticate() returns a user object or null, never {ok, status, error}). The unawaited Promise's
`.ok` is always undefined, so the POST path 401'd unconditionally, key or no key.

**Fixed** (branch `fix/ownt0j-auth-call-convention`): rewrote the auth check to the real calling convention.
node --check clean; the 11 existing classifier tests (pure functions, untouched) still pass.

**Why two bugs shipped in one handler**: both are HTTP/auth-layer mistakes in the one part of OWN-T0j that
had no test coverage -- the 11 shipped tests are all against the pure classifier functions
(api/_shared/ownt0j-sponsor-classifier.js), and nothing exercises api/_handlers/ownt0j-sponsor-classify-tick.js
itself end-to-end. Worth a look for a follow-up: a lightweight handler-level test (mocked domainQuery/opsQuery)
would have caught both.

**Docs**: PLANNED-BACKLOG.md OWN-T0j row appended again.

**Next step.** Get this fix merged and deployed, then re-trigger via lcc_cron_post (or wait for the next
`39 */4 * * *` fire) and confirm the cache table actually populates -- that's still the one thing not yet
verified end-to-end.

## 2026-09-11 — MB-a2: P-SQL source defects fixed against the live schema + both migrations applied; flags still OFF, live tick unverified

Fixed all four MB1c defects (verified live via Supabase MCP, not guessed). Cap-rate band + trades-since-
last-run now call the comps engine's own `rpc/rpc_query_comps` RPC (the same one `query_comps` uses)
instead of a raw `sales_transactions` select missing `operator_name/address/city/state`; cap value reads
`reliableCompCap()` (the engine's displayed rent÷price basis via `displayedCompCap()` imported from
`mcp/comps-tools.js`, falling back to the RPC's own `coalesce(cap_rate_final, cap_rate)`) — measured live:
RPC returns 200 TTM rows (175 dialysis_db + 25 salesforce, 98+21 with a cap) vs the raw table's 94
market-eligible, a proper superset. `v_dia_on_market` now reads `current_cap_rate`. CMS operator counts
now read a new server-side view `v_market_brief_cms_operator_counts` (migration
`dialysis/20260911190000_dia_mba2_cms_operator_counts_view.sql`, **APPLIED to Dialysis_DB**,
`sum(clinic_count)=6695` confirmed against the full 6,695-row population). Every paged read carries a
`truncationGap()` tripwire. Migration `20260911180000_lcc_mba_market_brief_producers.sql` is now
**APPLIED to LCC Opps** (`fact_key` + partial unique index present; both flags `off`; both crons scheduled,
no collision checked against live `cron.job`). Guard: `test/mba2-market-brief-psql-source-fixes.test.mjs`
(12 tests, mutation-verified). Full repo suite: 5,913 pass / 0 fail / 6 skipped. MB2 (P-RSS) swept for the
same defect class and found clean (ops-side JSON, no domain-DB row limits). **⚠️ NOT verified: a live tick
call** — this session has Supabase DB access but no Railway/API reach, so the code is committed and the
DB is applied, but `/api/market-brief-psql-tick` has not been redeployed to or exercised, and the flags
stay `off`. **Operator next step:** merge the PR, redeploy both Railway services, `GET
/api/market-brief-psql-tick?lane=dialysis` and confirm `gaps[]` is empty, one flag-forced `POST`, compare
against a direct `query_comps` call for the same window, flip both flags.
## 2026-09-11 -- OWN-T0j reviewed: classification logic verified correct, but the deployed route 502s -- found and fixed a real bug

Scott: "the OWN-T0j prompt is done and the response is saved... review and update all documentation and plans
accordingly." Reviewed by independently reproducing the numbers, not by re-reading the response.

**Classification logic verified correct, byte-for-byte.** Ran the identical classification directly against
both live Supabase projects (not through the app): 5,133 comparable / 2,462 disagree / 482 sponsor_family_confirmed
(19.6%) / 1,980 unclassified_rival (80.4%) -- matches the shipped PLANNED-BACKLOG claim exactly. The Boyd
Watterson positive control also holds live.

**But the deployed route is broken -- curled it directly and got a 502.** `GET /api/ownt0j-sponsor-classify-tick`
on the live Railway deploy (confirmed current: `/version` matches this session's git HEAD) returns
`{"error":"gov true_owners fetch failed at chunk 0"}`. Root cause: the true_owners fetch batches up to 1,000
UUID ids into a single PostgREST `in.(...)` filter -- roughly 39KB of query string, which Railway's edge
rejects. The properties fetch just above it uses the identical shape but with short numeric ids (~8KB for
1,000), which is why only this one fetch failed -- and why the shipped 11-test suite (pure classifier functions
only) could not have caught it; nothing in that suite exercises an HTTP fetch.

**Fixed** (branch `fix/ownt0j-true-owners-url-length`): scan `true_owners` unfiltered, paged by limit/offset
like the transitions fetch already does, and keep only the needed ids via a client-side Set lookup -- no
`in.()` filter, no URL-length ceiling regardless of population size (16,274 total true_owners today).
`node --check` clean; the 11 existing classifier tests (they test pure functions, untouched by this fix)
still pass.

**The cache table remains empty in production** -- this fix hasn't shipped yet. Once it's merged and Railway
redeploys, the next `lcc-ownt0j-sponsor-classify-refresh` cron fire should populate it for real; that's the
thing to re-check next, not the classification math (already independently confirmed correct).

**Docs**: `PLANNED-BACKLOG.md` `OWN-T0j` row appended with the verification + bug fix. Did not touch the
`OWN-T0a`/`OWN-T0e`/`AC11` rows from the prior entry -- nothing here changes those findings.

**Next step.** Get this fix branch pushed and merged, confirm the Railway redeploy, then re-check the cache
table and the reporting view actually populate on the next cron fire.

## 2026-09-11 — PRI5 response reviewed: both real root causes found and fixed (not "undetermined" again), the orphaned-row gap resolved with live before/after, `census_demographics`'s months-old bug finally identified — held pending `Dialysis` PR #7408 merge confirmation

`PRI5`'s response (`"PR15 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics.response.md`.
A strong round — this is the first time `census_demographics` got an actual root cause instead of
"confirmed vulnerable, cause undetermined."

**(a) The orphaned `ingestion_tracker` row — fixed with live proof.** `start_run()` returns `None` on
exhausted retries but is never checked by its caller — the pipeline just proceeds, and nothing ever
revisits the row it tried to create. Confirmed this session's own flagged row
(`c817274e…`) is exactly this mechanism. **Found a second, distinct orphan class unprompted**:
`ingestion_lock`'s own acquire call can leave a second row type orphaned the same way — 6 total orphans
existed, not the 5 this session's own live count caught (which only checked one source). Fixed with a
new `reclaim_stale_started_runs()` — deliberately not a lock, only touches rows past a 2-hour safety
window so an in-flight run's own row is never touched — with a real rejected alternative explained (why
reusing `acquire_ingestion_lock` for the outer row would create a lock collision with the inner sub-step).
**Live before/after applied**: 2 of 6 orphans (past the safety window) closed immediately; the other 4,
including this session's own flagged row, correctly left alone since they're still within the window.

**(b) `census_demographics` — actual root cause found.** `_fetch_acs_data()` is a bare, unguarded HTTP
call to `api.census.gov` (unrelated to this arc's Supabase connection-instability story) with no retry
and no auth (`CENSUS_API_KEY` never configured, so every call hits Census's more rate-limited
unauthenticated tier). The tell: `oig_leie_ingestor`'s equivalent fetch already has this exact guard
pattern — `census_demographics_ingestor.py`'s own comment claims it was fixed "alongside" LEIE in an
earlier round, but only the upsert-loop hardening was copied, never the fetch guard. **Confirmed against
live data**: 3 snapshot rows from April/May/June 2026 show the identical months-old orphan pattern. Fixed
to mirror LEIE's guard exactly. **Bonus fix found while wiring this in**: the step-loop's own success/
failure check would have silently treated a clean `{"error": ...}` return as success — generalized the
check to every step so this and `oig_leie_exclusions` (same latent gap) report honestly. Recommended
(not required) setting `CENSUS_API_KEY` in Railway as a config action to reduce recurrence.

**(c) The "benign all-zeros" conclusion — actually re-checked, not re-asserted.** Traced which modules
populate the summary counter machinery — neither `run_cms_ingestion.py` nor
`census_demographics_ingestor.py` appears in that list, so structurally `census_demographics` cannot be
the cause either way. Confirmed live for this specific run: `facility_patient_counts` (the sub-step that
does feed the counter) had zero new rows this date, matching the repo's documented near-annual CMS
publish cadence — an expected no-op, not a defect.

Tests: 7 new, full adjacent surface 285/286 passing (1 pre-existing, unrelated failure disclosed
explicitly, reproduces on unmodified `main`).

**PR `sbriggssjc/Dialysis#7408` was actually opened this round** (a step further than `PRI3`/`PRI4`,
which only referenced a tracking PR number) — **merge status still unconfirmed**, same open item as every
round. Asked Scott to confirm directly.

`PLANNED-BACKLOG.md`'s `PRI5` row updated to 🟡. Prompt moved to `docs/claude-code/prompts/done/`.
Response docx pending archive to `responses/done/` on Scott's machine.

## 2026-09-11 — MB-a reconciled (PR #2301 merged): live check finds 4 source defects; MB-a2 fix prompt drafted

Processed `responses/MB-a desktop response.docx` → `done/` (CC had already filed the prompt). MB-a built MB1 (P-SQL)
+ MB2 (P-RSS, Ollama-only, verbatim-number check), 74 tests, 5,890/0, filed MB1a (`cortex_market_intel` writer) and
MB1b (CMS closures are net-count only). **Cowork live check (read-only):** migration `20260911180000` **not applied**;
0 `producer_runs`. Against Dialysis_DB: `sales_transactions` has no `operator_name/address/city/state` (→ 400);
raw `cap_rate` on 37 TTM rows vs `cap_rate_final` on 106 with 66 excluded rows (→ band must come from the shared comps
engine); `v_dia_on_market` has `current_cap_rate` not `cap_rate` (→ 400); `medicare_clinics` read capped at 1,000 of
6,695 (→ **silent** undercount). New backlog row **MB1c**; two design rules added to spec §9 (comps-engine parity for
every cap-rate fact; SQL aggregation + truncation tripwire + column contracts). OPERATOR-ACTIONS **MBa-hold**: do not
flip MB flags. **OC-v unchanged** (0 notes, no triage flag row, MCP not redeployed). **Next:** send
`prompts/MBa2-psql-source-fixes-and-live-verify.md`; redeploy both Railway services after it merges (ships OC-a too).
## 2026-09-11 — OWN-T0j shipped: gov OWN-T0a disagreement split into `sponsor_family_confirmed` vs `unclassified_rival`

Built the cross-database classifier the prompt above asked for. **Node-layer job, not SQL** — gov's
`v_ownership_transitions_portfolio` (project `scknotsqkcheojiaewwh`) and LCC Opps'
`lcc_ownership_sponsor_family` (project `xengecqvemvfknjvbvrq`) are separate Supabase projects; no SQL
join is possible between them.

**Shipped:**
- `api/_shared/ownt0j-sponsor-classifier.js` — pure functions (`normalizeGovNameKey` is a byte-for-byte
  JS port of gov's own key expression from `v_ownership_transitions_portfolio`'s view def, confirmed by
  reading `pg_get_viewdef` live; `classifyDisagreement`/`classifyDisagreementBatch` do the split).
- `api/_handlers/ownt0j-sponsor-classify-tick.js` — GET dry-run (reads both sides, classifies, no
  writes), POST writes the cache (paged at 1000/PostgREST's hard cap on both the gov and ops reads).
  Wired in `api/admin.js` (`case 'ownt0j-sponsor-classify-tick'`) and `server.js`
  (`/api/ownt0j-sponsor-classify-tick`).
- Migration `supabase/migrations/20260911190000_lcc_own_t0j_sponsor_disagreement_classifier.sql`,
  **applied live to LCC Opps** — cache table `lcc_ownt0j_sponsor_disagreement_cache` (default grants
  revoked from `public`/`anon`/`authenticated` per the B6d/OCR2 lesson, verified with
  `has_table_privilege`), reporting view `v_lcc_ownt0j_sponsor_disagreement_report` (plain view, no
  SECURITY DEFINER function — nothing here needed elevated privilege, so the definer-privilege stanza
  rule doesn't apply), and cron `lcc-ownt0j-sponsor-classify-refresh` at `39 */4 * * *` (OWN-T0e's own
  4-hourly cadence, offset 12 minutes to avoid two ~5,000-row cross-source jobs landing in the same
  minute).
- Test `test/own-t0j-sponsor-disagreement-classifier.test.mjs` — 11 tests, spot-checked against two
  mutations (both went RED: removing the `confirmed_at` guard, removing the substring-match line).

**Real measured counts (live, both projects, 2026-09-11):**
- Reproduced the OWN-T0a comparison exactly as specified: **5,133 comparable / 2,462 disagree**
  (drift from the brief's 2,510 is normal re-measurement noise, not a defect — population definition
  identical). Restricted to `gsa_lease_diff`/`acquisition`: 3,523 comparable / 1,641 disagree (brief:
  3,523 / 1,648 — matches almost exactly).
- LCC Opps `lcc_ownership_sponsor_family` currently holds **21 confirmed rows / 18 distinct tokens**
  (agree, arc, boyd, briarcliff, east, elliott, gip, gov, greenleaf, highwoods, jlb, kilroy, ngp,
  rainier, rxr, sunflower, uirc, wmc).
- Classified against the full 2,462-row disagreement population: **`sponsor_family_confirmed` = 482
  (19.6%)**, **`unclassified_rival` = 1,980 (80.4%)**. Both counts reported, not just the residual.
- **Positive control — Boyd Watterson:** all 192 gov properties whose disagreeing true_owner name-key
  contains the confirmed token `boyd` classify **entirely** `sponsor_family_confirmed` (0 leak into
  `unclassified_rival`, as required — the match is by construction). Restricted to
  `gsa_lease_diff`/`acquisition` alone: 115 (close to the OWN-T0e investigation's quoted "~111";
  the small gap is a population-definition detail, not a defect).
- ⚠️ **Precision caveat, stated honestly, not swept under the 19.6%:** the confirmed token `gov` (2
  entities: "gov san antonio", "gov ft myers") is a 3-character substring that will match ANY
  true_owner name containing "gov" anywhere — a real precision risk for a token this generic, distinct
  from the Boyd/UIRC/NGP/Highwoods cases where the token is a genuine surname/brand fragment. Not
  fixed here (matches spec: port the classification rule as designed, report what it does — this is
  new information for whoever curates future sponsor-family confirms, not a defect in this build).

**What this is NOT:** it does not touch gov's `properties.true_owner_id` or `ownership_history`, does
not build a second sponsor/SPE confirm mechanism (reads `lcc_ownership_sponsor_family`, routes
genuinely-unclassified pairs conceptually to OWN-T0e's existing `sponsor_family_confirm` lane rather
than duplicating it), and does not re-implement gov's name normalizer independently.

**Deviations from the prompt, stated:** (1) The gov side is fetched via `domainQuery('government', ...)`
against `v_ownership_transitions_portfolio` + `properties` + `true_owners` directly rather than reading
a single pre-joined view, because no such view exists — this matches the two-step read the prompt's own
Step 1 SQL performs. (2) No dedicated "reporting UI" was built beyond the plain SQL view + the cache
table itself, per the "simple reporting view or query a human can run" instruction — no Decision Center
lane, consistent with the explicit prohibition. (3) The live cache table is currently EMPTY — the tick
has not run in production yet because it ships on the next Railway deploy of merged `main` ("merged is
not running" — this repo's own doctrine); the counts above come from a direct one-off measurement run
against both live projects during this session, not from the tick itself, and are reported as such.

Branch: `claude/own-t0j-sponsor-classifier`, pushed to origin (not merged, no PR opened per instructions).

## 2026-09-11 — Not actually a crash: `ownership_linker`'s fix confirmed working live for the first time; one new orphaned-tracker-row gap found, `census_demographics` still failing — filed as `PRI5`

Scott reported the latest CMS ingestion run as "crashed" and sent logs. **It wasn't a crash** — no
traceback, no hang; the process ran its full course and printed a complete, orderly summary. Two pieces
of real good news:

- **`PRI3`'s `ownership_linker` fix is confirmed working live for the first time**: `Properties →
  true_owners: {'from_recorded_chain': 1, 'from_tenant_match': 0, 'from_cms_chain': 6570}` and `Contacts
  → Salesforce: {..., 'by_company': 19}` — real, non-zero linkage counts, versus the original crash where
  all 9 sub-steps failed with every counter at `0`. This is the live-fix proof this arc has been waiting
  on since `PRI3` first shipped.
- The process did **not** hang this time, consistent with (though not proof of) `PRI4`'s daemon-thread +
  `os._exit(2)` mitigation.

**One real, distinct new gap found and filed as `PRI5`**: `ingestion_tracker.start_run` failed after
retries again (same persistent connection instability — expected per `PRI3`'s Section 2 conclusion), but
this time **the pipeline continued anyway and completed successfully**, leaving that run's
`ingestion_tracker` row permanently orphaned (`run_status='started'`, `finished_at=null`, 30+ minutes
later — confirmed live). A live count shows this isn't isolated: **5 of `cms_medicare_clinics`'s
`ingestion_tracker` rows are stuck at `started` forever, out of 118 `success`** — every stuck one traces
to this arc's problem runs. This is a distinct code path from `PRI4`'s catalog (which covered the
*preflight-abort* exit only) — this is the *pipeline proceeds and finishes normally after `start_run`
itself failed* path, never revisited to close its own tracker row.

Also filed in `PRI5`: `census_demographics` failed again (`PRI3`'s still-unresolved catalog item (g),
recurring rather than a one-off), and the same all-zero-counters + "not recorded" warning `PRI3` called
"two conflated but benign phenomena" — asked the next round to re-confirm that conclusion against this
specific run rather than re-assert it, since it keeps recurring in the identical shape.

Prompt: `docs/claude-code/prompts/PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics.md`.
Not urgent — the pipeline is genuinely producing real writes now — but worth closing since this arc has
leaned on `ingestion_tracker` for run-timing correlation throughout, and orphaned rows undermine that.

## 2026-09-11 -- all three recommended next steps done: OWN-T0j prompt drafted, OWN-T0e confirm-lane gap found (not forced), AC11 re-measured (still 0, now explained)

Scott: "let's do it all in the order you recommend" (build the gov-side classifier; prioritize OWN-T0e confirms
on the big sponsors; re-measure AC11). Did all three.

**1. OWN-T0j prompt drafted and sent to CC** (`docs/claude-code/prompts/OWN-T0j-gov-side-reconciled-classifier.md`).
Scoped from the 2026-09-11 OWN-T0a re-measurement directly -- reuses the exact comparison query, points at
OWN-T0e's cache-table shape as the architecture template, and is explicit that this has to be a cross-database
Node job (the sponsor registry lives in LCC Opps, the comparison population lives in gov -- no SQL join is
possible). Explicit "do not build a sweep that forces agreement" guardrail, citing OWN-T0/RO2's prior refusals
of the identical shape.

**2. OWN-T0e confirm-lane prioritization -- investigated before forcing anything, and the investigation is the
finding.** Checked whether the 22 gov-side sponsors with >=5 disagreeing properties (from the 2026-09-11
measurement) are even reachable through OWN-T0e's existing confirm lane before confirming any of them. Only 4
of 22 appear in `lcc_ownt0e_sponsor_family_proposals_cache` at all, each at a small fraction of their gov-side
count (Gardner Tanenbaum: 32 gov-side properties vs 1 in the LCC cache) -- live, concrete confirmation of the
already-filed `OWN-T0b` gap (no LCC mirror of the domain's transition chain): the two populations barely
overlap, so confirming through this lane, however many sponsors get confirmed, cannot move OWN-T0a's number.
That alone is why `OWN-T0j` (a build that reads gov's population directly) is the right next step, not more
confirms. Of the 4 that do exist as candidates, none were blind-confirmed -- each had a specific reason not to:
`Realty Income Corporation` is a flagged generic token, `Elman Investors`'s only SPE name IS itself a hedge
phrase (`OWN-T0i` material), `Gardner Tanenbaum Holdings`'s SPE name looks like a same-party name variant (a
merge question, not a family confirm), and `USAA Real Estate` is a single property, immaterial either way. All
four left for a human on OWN-T0e's own lane.

**3. AC11 re-measured -- still zero, and now the finding is specific.** `entity_relationships` carries 0 rows
of type `llc_member`/`llc_manager`, fleet-wide, nine days after `PR-scanner-2` shipped the writer. This is not
the producer being broken -- it's a forward capture-path fix that only fires when someone actually scans an
SOS/bizfile page through the extension, and nobody has done that yet since it shipped. So the population is
correctly zero today; it isn't evidence the fix doesn't work, and re-checking on a calendar basis again won't
change that -- the next real re-measurement should follow the first live SOS scan, not another date.

**Docs**: `PLANNED-BACKLOG.md` -- new `OWN-T0j` row, `AC11` row appended with the re-measurement. **⚠️ Branch
note**: local `main` in this session's clone is stale (git fetch/pull fails here, the standing proxy
limitation) -- `docs/own-t0a-reinvestigate`'s local ref shows "behind origin by 6 commits," meaning more has
landed on that branch name upstream than this session can see. This entry's new commit is built on this
session's last-known-good local tip of that branch; reconcile against the real origin state before merging,
not assumed clean.

**Next step.** `OWN-T0j` needs a Claude Code build session to pick it up. `AC11` stays filed, waiting on real
SOS-scan usage rather than a rebuild. `B1b` (developer chain, gated behind `B5`) remains the one entirely
untouched item on the ownership/contact-propagation thread.
## 2026-09-11 — MB-a: MB1/MB2 market-brief producers built (dialysis lane), flags OFF, NOT live-verified

Branch `claude/sweet-gates-83wyu7` → PR (see docs). Built `MB1` (P-SQL, `api/_handlers/market-brief-psql-tick.js`)
and `MB2` (P-RSS, `api/_handlers/market-brief-rss-tick.js`) per `prompts/MBa-market-brief-producers-dialysis.md`,
producers only — no rendering, no email, no UI, no cloud-model calls. Migration
`20260911180000_lcc_mba_market_brief_producers.sql` adds `market_brief_facts.fact_key` (+ a partial unique index
scoped to `status='live'`, the identity a source-url-less SQL derivation needs — EB1's own
`uq_mbf_source_identity` only fires when `source_url`+`source_date` are both present), registers
`MARKET_BRIEF_PSQL`/`MARKET_BRIEF_PRSS` in `feature_flags_registry` (both `off`), and schedules both crons
(guarded `NOT EXISTS`, not flag-gated — the P138 pattern: an unscheduled job is invisible even when its flag is
off). New shared modules `api/_shared/market-brief-facts.js` (fact builders + the pure `decideFactWrite`
supersede/skip/conflict decision + the RSS verbatim-number check) and `api/_shared/market-brief-rss.js`
(extraction prompt/parse/verbatim-filter, fails closed with no cloud fallback — mirrors the OC2/Analyst's-Take
on-box pattern). 74 new tests (`market-brief-facts.test.mjs`, `market-brief-rss.test.mjs`,
`market-brief-tick-handlers.test.mjs`), all fixture-based, no network. Full suite 5,890/0/6-skipped.

**Measured (repo-only, no live Supabase/Railway reach this session):** dia sources wired are
`sales_transactions` (TTM cap-rate band, per-operator with a 5-comp floor, and trades-since-last-run),
`v_dia_on_market` (on-market count + median ask cap), `medicare_clinics` (top-8 operator counts + net-change vs.
prior run). **NOT wired:** `cortex_market_intel` (writer still unlocated across two sessions — new row **MB1a**)
and gov GSA lease events (dialysis-first per the prompt). CMS "closures" are a count net-change, not a real
open/close event feed — no termination/status column could be confirmed from the repo (new row **MB1b**).
PLANNED-BACKLOG §P18 rows MB1/MB2 updated with the full source list, gaps, and the exact live-verify steps.

**What could NOT be done here, per this repo's own doctrine (dry-run-first, verify-live-then-flip):** running
either tick against live Supabase/Railway, confirming `v_dia_on_market`'s actual column names (the GET dry run's
`gaps[]` array is designed to surface a 400 there before any POST), the before/after `v_market_brief_staleness`
snapshot for the dialysis lane, and sampling 5 real facts with citations. **Next: an operator/session with live
reach runs the GET dry run for both ticks, reads `gaps[]`, runs one POST with the flag forced on, reports the
five things above, then flips both flags and confirms the cron minutes (`7:15`/`10:10` UTC, picked without
reach to `cron.job` — check for a collision before relying on them).**

## 2026-09-11 — OC-a reconciled (PR #2298 merged): funnel built, NOT yet a live loop; MB-a prompt drafted

Processed `responses/OC-a desktop response.docx` → `done/`; prompt → `prompts/done/`. OC-a shipped EB1a (applied
live: 16 facts, staleness view 20 cells) + OC1 (endpoint, in-app Note button, MCP `log_operator_note`, Outlook
`LCC-Note` — regex bug that silently dropped the category fixed), OC2 (triage tick, deterministic + Ollama, flag
OFF), OC3 (OPERATOR-INBOX render + `get_operator_inbox` + session-start hook). 62 new tests, 5,839/0.
**Live measurement (Cowork, read-only):** `operator_notes` = 0 rows; `OPERATOR_NOTE_TRIAGE` **absent** from
`feature_flags_registry` (flag-flip step must insert it); no pg_cron job for the tick; the connected LCC MCP
exposes neither new tool after refresh → **standalone MCP not redeployed**. Fixed `CURRENT-STATE.md` (claimed
the hook was not wired — it is). New backlog row **OC-v** collects the six operator steps; `OPERATOR-ACTIONS.md`
OCa rows annotated. **Next:** Scott redeploys both Railway services + runs OC-v; Claude Code gets
`prompts/MBa-market-brief-producers-dialysis.md` (does not depend on OC-v or EB1b).

## 2026-09-11 — BUY0 cont.: Geller Round 1 sourcing — 1,683 exported rows → 213 in-metro industrial → Focused 24

Cowork. Scott's CoStar / CREXi ×5 / Salesforce Comps exports normalized, metro-assigned on OMB county lists,
de-duped and screened; preliminary Derived leg scores; delivered `Jordan Geller - Buyer Showing - Sep 26 (Round 1
draft).xlsx` (Focused = top 8 per DFW / Austin / Charlotte). Spec §4.6 records the import pipeline + per-source quirks;
seed scripts saved to the client Data folder. Austin supply is thin (11 industrial) → re-pull requested.
## 2026-09-11 — OC-a: operator funnel v1 shipped — EB1a applied live, intake + triage + inbox built

`prompts/OCa-operator-funnel-v1.md` executed end to end on branch `claude/oca-operator-funnel-v1`.

**EB1a — applied live to LCC Opps** (was not applied per the 2026-09-11 reconcile note): all 5 tables +
2 views verified present via Supabase MCP; the dialysis exemplar's 16 facts inserted (11 `[UNVERIFIED]`
items correctly excluded); `v_market_brief_staleness` returns 20 (lane, section) cells, 5 populated /
15 `is_missing` (only the `dialysis` lane has facts yet — expected, MB producers are unbuilt). Re-run is
idempotent (the migration's own `uq_mbf_source_identity` unique index — not re-verified by a second
insert in this session, but the constraint is live).

**OC1 — intake v1, three of four channels built:**
- **In-app Note button** (`operator-note-client.js`, mounted in `index.html`): floating button + one-
  textbox modal on every page, auto-captures `route` (hash), open entity id/type (best-effort off
  `_detailStack`), and the last 10 client-side errors (a small ring buffer added to `index.html`'s
  existing global error handler). POSTs to `POST /api/operator-notes`.
- **MCP `log_operator_note`** (`mcp/server.js`), sibling of `log_memory`, same auth/session shape.
  Write tool, no HTTP route (matches `log_memory`'s Claude/MCP-only convention).
- **Outlook** (`intake-tagged-comm.js`) — **dormancy diagnosed and fixed, not just diagnosed.** The
  pre-existing `LCC`/`LCC:<hint>` category gate (`parseLccCategoryHint`, regex `^lcc$` / `^lcc[:=](.+)$`)
  structurally could never match a category literally named `LCC-Note` (the hyphen fails both patterns)
  — every note tagged that way has always silently fallen through to `no_lcc_category` and been dropped.
  This is a DIFFERENT, narrower defect than the broader "6 rows ever / dormant since 2026-08-07" finding
  the 2026-09-11 reconcile recorded for the whole tagged-Outlook flow — that finding is about whether the
  PA category-assigned trigger itself still fires at all, which this fix does not by itself prove (needs
  a live post through the flow — see OPERATOR-ACTIONS.md). Added a second arm: a plain reply (`Re:`) to a
  recognizable briefing subject with no LCC tag at all, per the contract's `outlook_reply` channel.
- **Teams**: endpoint-ready only (`/api/operator-notes` accepts `channel:'teams'` authenticated via the
  existing `PA_WEBHOOK_SECRET` pattern, mirroring `intake-tagged-comm.js`'s `authenticateWebhook()`
  exactly) — the PA flow itself is an operator step (OPERATOR-ACTIONS.md), no bot built.

**OC2 — triage tick built and flag-gated OFF** (`OPERATOR_NOTE_TRIAGE`, `/api/operator-triage-tick`,
GET=dry-run/POST=apply). Deterministic rules first (error signatures → bug, "stuck loading" →
not-connecting, "missing/no data" → data-gap, "would be nice"/idea language → idea, "confusing"/"hard to
find" → ux, trailing `?` → question); on a miss, falls to on-box Ollama (`invokeOnPremGeneration` — fails
closed, no cloud fallback, matching `briefing-analyst-take-tick.js`'s pattern) for type/lane/severity/
title. Dedupes against prior open notes (Jaccard token overlap ≥0.5) AND a generated PLANNED-BACKLOG
index (`scripts/generate-operator-note-backlog-index.mjs` → `docs/os/operator-note-backlog-index.json`,
181 rows parsed). Routes via `docs/os/operator-note-routing.json` (7 threads seeded from the spec's own
list). Logs to `producer_runs` (`producer='operator_triage'`) on the P123 open-before-work lifecycle.
An unclassified note stays `open` with a named reason — never guessed at.

**OC3 — the one to-do list built.** `scripts/render-operator-inbox.mjs --write` renders
`docs/os/OPERATOR-INBOX.md` (GENERATED header) from `operator_notes`, grouped by `routed_to` thread
(severity-sorted within a thread, unrouted last). MCP `get_operator_inbox` read tool (+ `/api/operator-
inbox` HTTP route for ChatGPT/Copilot) reads the identical query, so every surface sees the same list.
Not yet wired into `.claude/hooks/session-start.sh` or `NEW-CHAT-KICKOFF.md` — filed as a follow-up
(the render script itself is done and tested; the hook wiring is a one-line addition once a live
Railway deploy exists to read from).

**What was NOT done, per the spec's own scope fence:** no market-brief producers/rendering/email
changes; no cloud-model calls anywhere in triage; no canon edits; PLANNED-BACKLOG promotion from an
inbox item stays a manual session-loop step. **Also deferred, stated plainly:** the live multi-channel
verification (§6 — post one note through each channel, run the tick with the flag on, confirm a fresh
inbox) could not be completed in this session — it needs a live Railway deploy of this branch's merged
`main`, which has not happened yet. `OPERATOR_NOTE_TRIAGE` therefore stays off in
`feature_flags_registry` until that live verify runs.

**Tests:** 62 new (`test/operator-notes.test.mjs` 34, `test/operator-triage-tick.test.mjs` 6,
`test/operator-inbox-render.test.mjs` 8, `test/operator-note-outlook-channel.test.mjs` 8, plus fixing
one pre-existing guard — `mcp/server.js`'s `READ_ONLY_HTTP_TOOLS` allowlist needed `get_operator_inbox`
added, caught immediately by `test/chatgpt-curated-spec.test.mjs`). Full suite: **5,839 pass / 0 fail /
6 skipped** (pre-existing skips, unrelated).

PR opened: branch `claude/oca-operator-funnel-v1` → `main`. Not merged (CI + Scott's call).
## 2026-09-11 — PRI4 merged and deployed live; no new prompt needed — next step is another live test run

Scott confirmed `Dialysis` PR `#7407` merged and the redeploy live. `PLANNED-BACKLOG.md`'s `PRI4` row
moved to ✅. **Not yet independently re-verified** — this fix hasn't been proven against a real run yet,
same discipline as every other round in this arc (a green PR is not the same as a proven fix).

**No new prompt is warranted right now.** Everything currently open in this arc — `PRI3`'s original
live-fix proof (never exercised because every run so far died before reaching those call sites) and
`PRI4`'s own open questions (the (b) tracker-close discrepancy, (c)'s unconfirmed root cause) — is best
answered by **triggering another CMS ingestion run and watching what actually happens**, not by more
code-reading. Recommended to Scott: trigger the run now. On the next report-back, verify directly against
Dialysis_DB: does `facility_patient_counts`'s preflight step now succeed or retry-and-recover instead of
failing outright; does the run get **past** preflight this time (the first real test of `PRI3`'s fixed
call sites); if it still hits trouble, does the process now exit promptly via the new `os._exit(2)` path
instead of hanging; and does whichever `ingestion_tracker` row this run creates actually close out
(`finished_at` set, `run_status` not stuck at 'started') — directly answering the (b) discrepancy this
round couldn't resolve from the code alone.

## 2026-09-11 -- OWN-T0a re-investigated: the finding changed shape, nothing built, a real decision surfaced for Scott

Picked OWN-T0a (gov's own 43.4% recorded-transition-grantee vs true_owner_id disagreement) as the next lever
per the ownership/contact-propagation thread. Read the source audit first (OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md,
per this repo's own citation doctrine), then re-measured live against scknotsqkcheojiaewwh rather than re-quoting
the 2026-09-02 number.

**Re-measured, still real and if anything slightly larger**: plainest replication reads 48.9% (5,133 comparable /
2,510 disagree) today vs 43.4% nine days ago -- consistent with population growth from ongoing ingestion, not a
regression. The gsa_lease_diff/acquisition-restricted population (3,523 comparable) lands closest to the original
3,474 and disagrees at 46.8%.

**Read the actual disagreeing rows -- same sponsor<->SPE shape OWN-T0's own audit already named** (e.g. property 180:
"GOVERNMENT PROPERTIES INCOME TRUST LLC" the SPE/transition-grantee vs "RMR" the sponsor/true_owner -- both true).
Ruled out the boring explanations: only 3.3% tombstoned true_owner rows, only 2.2% hedge-phrase owner names
(OWN-T0i's class). The sponsor population is a long tail -- 1,163 distinct sponsor names, only 22 with >=5
properties each (21.4% of the disagreement) -- not concentrated the way OWN-T0e's boyd-family case was.

**The real finding: OWN-T0e's sponsor-family confirms do not move this metric, even for big already-confirmed
names.** Boyd Watterson (confirmed 2026-08-27), UIRC (2026-09-09/10), NGP (2026-09-09), Highwoods (2026-08-27) are
all live rows in lcc_ownership_sponsor_family -- and still read 111, 24, 14, and 5 disagreeing gov properties
respectively today. The confirm only changes how the LCC-facing reconciled view classifies the conflict; it never
touches gov's properties.true_owner_id or the transition grantee, which is what OWN-T0a's raw comparison reads.
So OWN-T0a as defined can never reach zero, and a fix that forced the two sides to agree would be wrong -- the
same conclusion OWN-T0 (LCC side) and RO2 (gov's own v_ownership_resolution vs true_owner, an adjacent store)
already reached on this identical shape.

**Nothing built.** The correctly-scoped fix is a measurement fix, not a sweep: a domain-side reconciled view
(gov mirror of v_lcc_property_ownership_reconciled's conflict_class logic, reading the existing
lcc_ownership_sponsor_family registry) that would split the flat 43-49% into "sponsor_family_confirmed" (expected,
not a problem) vs a genuinely unclassified residual -- turning an alarming-looking number into an honest, much
smaller one. That's real scope, so it's surfaced to Scott as a decision rather than assumed or built blind.

**Docs**: PLANNED-BACKLOG.md OWN-T0a row rewritten with the re-measurement, the root-cause read, and the OWN-T0e
non-effect finding; cross-referenced to OWN-T0e, OWN-T0i, and RO2.

**Next step.** Waiting on Scott: build the gov-side reconciled classifier, prioritize OWN-T0e confirms on the 22
big-population sponsors even though it won't move this specific metric (it does fix what brokers actually see in
the LCC panel), or move on to AC11's population re-measurement instead.

## 2026-09-11 — BUY0 cont.: Geller Phase 0 deliverables shipped; living-engagement design + sourcing audit added to spec

Cowork session (Jordan Geller 2026 industrial search). Delivered to the client folder: `Jordan Geller - Industrial
MSA Ranking - Sep 26 (Draft v2).xlsx` (75 MSAs × 15 public factors — Census PEP V2025, ACS 2024, BLS QCEW 2019/2024,
Tax Foundation 2026, CNBC Top States 2026; editable weights) and `Jordan Geller - Buyer Showing - Sep 26.xlsx`
(lightweight client file on the Team Briggs Buyer Showing Template: static Market Ranking tab 1 + Focused / Broad
Market / Passed with Credit / Lease / Real Estate leg scoring). Both restyled to BDPS (`bov_constants.py` palette,
Calibri, role heights). Spec `BUYER-ENGAGEMENT-MODULE-SPEC-v0.1.md` gained §4.4 (living engagement = reuse deal
spine + W7 matcher/propagation + Ollama proposals, no parallel pipeline), §4.5 (sourcing audit: email alerts lack
location → **BUY-G1**; no SF path for industrial `Comp__c` → **BUY-G2**), §6a (Scott's answers: files-in-folder,
query-on-demand, three-leg scoring, rent evidence hierarchy) and §7a (egress: census/bls/bea blocked from sandbox
and local shell). **Next:** top-3 markets (DFW, Austin, Charlotte) sourcing — Scott exports CoStar/LoopNet/RCA + an
SF report; Claude normalizes into Broad Market. No build authorized yet.
## 2026-09-11 — PRI4 response reviewed: uncovered preflight call site fixed, tracker close-out fixed for one path but a live check contradicts the other, and a genuine `safe_execute()` timeout defect found (possibly explaining PRI1's own unanswered Unit 4 mystery) — held pending `Dialysis` PR #7407 merge confirmation

`PRI4`'s response (`"PRI4 surface response.docx"`, saved by Scott) read in full and transcribed to
`docs/claude-code/responses/done/PRI4-preflight-abort-hang-and-uncovered-call-site.response.md`.

**Fixed**: (a) the real no-retry location — `src/health.py::preflight_health_check` (the prompt's own
framing of `preflight_checks.py` was corrected by the response) — now routed through `safe_execute()`,
plus two more unguarded probes found along the way, a broader sweep than asked. (d) confirmed safe for
Scott to kill the hung deployment — no partial state.

**(b), a real discrepancy caught by an independent live check, not just accepted from the response**:
the response claims the exact failure branch this prompt was built from already calls
`finish_run(run_status="aborted")` correctly — implying that row should already close. **This session
re-queried `ingestion_tracker` live and found the actual row (`started_at 15:53:15.083884 UTC`) still
open, `run_status='started'`, 1.5+ hours later.** Two explanations fit equally well and can't be
distinguished from here: the described code path doesn't match what actually ran in production, or
`finish_run()`'s own call silently hung/failed under the same connection instability — which would tie
(b) directly to (c) as one shared symptom. Flagged plainly rather than accepting "already correct." A
second, separate abort branch (`has_blockers`) genuinely had no close-out at all and was fixed.

**(c), the hang itself — root cause not proven, but a real and potentially significant defect found**:
couldn't attach to the live process to confirm (the prompt's ask went unmet, stated honestly). Found that
`core_utils.safe_execute()`'s timeout only stops waiting on the future — the underlying
`ThreadPoolExecutor`'s own `shutdown(wait=True)` then blocks again on the same stuck worker thread,
silently defeating the timeout. Stated as the strongest candidate, not confirmed. **Worth flagging
prominently**: if real, this is a plausible shared mechanism behind `PRI1`'s own still-unanswered Unit 4
question (the 5-hour idle gap before "Stopping Container") and this run's 90+-minute hang — one
explanation across multiple rounds of this arc's mysteries, though not independently verified. Mitigation
applied regardless: abort/cleanup now runs on a daemon thread with a bounded 60s join, then `os._exit(2)`
— terminates the process no matter what's stuck underneath.

Full suite: **3222 passed** (up from `PRI3`'s 3183), 0 failed, no regressions.

**Merge status of `sbriggssjc/Dialysis#7407` (branch `claude/inspiring-feynman-y8l6mh`) is
unconfirmed** — same pattern as `PRI3`'s `#7406`. Asked Scott to confirm directly.

`PLANNED-BACKLOG.md`'s `PRI4` row updated to 🟡 (fixed and tested per the response, held short of ✅
pending merge confirmation and given the live-check discrepancy on (b)). Prompt moved to
`docs/claude-code/prompts/done/`. Response docx archived to `responses/done/`.

**Still outstanding, unchanged by this round**: `PRI3`'s own live-fix proof — no run has yet gotten past
preflight to actually exercise `oig_leie_ingestor`/`ownership_linker`/`utils_shared`/
`ingestion_tracker.start_run`'s retry logic in production.
## 2026-09-11 — EB1 reconciled (PR #2291 merged) + live measurement; OC-a prompt drafted

Processed `responses/EB1 Executive Briefs foundation desktop response.docx` → `responses/done/`; prompt →
`prompts/done/`. EB1's §1 cells marked UNMEASURED were measured live (Cowork, Supabase read-only, LCC Opps):
**(1)** EB1 migration **not applied** — 0 of 5 tables live (→ EB1a, folded into OC-a step 0). **(2)** RSS: 4 streams
live, 6/stream cap, **gov empty 09-07/08, tax empty 3 of 8 days**. **(3)** Ollama Analyst's Take healthy daily.
**(4)** `ANTHROPIC_API_KEY` set but **every snapshot call 09-02→09-11 fails "credit balance too low"** → new 👤 row
**EB1b**; MB5 (P-WEB) blocked until funded. **(5)** `TAGGED_COMM_INTAKE` on but **dormant** (last row 2026-08-07).
**(6)** **Correction to EB1:** `cortex_market_intel` **exists live** (922 rows, written today; listing alerts with cap
rate/price/tenant/type; writer outside the repo) → added to MB1 as a source. Spec §9 records all of it; backlog
§P18 updated (EB1, EB1a, EB1b, MB1, MB2, MB5, OC1–3). **Next:** send `prompts/OCa-operator-funnel-v1.md`; Scott
decides EB1b. Other open prompts in `prompts/` (PDR2, PDR14b, PRI4) belong to other threads — untouched.

## 2026-09-11 — EB1 shipped: Executive Briefs foundation (schema + contracts + measurement, no rendering)

Ran `docs/claude-code/prompts/EB1-exec-briefs-foundation.md` (spec `docs/architecture/EXEC-BRIEFS-SPEC.md`
v0.2). Branch `feat/eb1-exec-briefs-foundation`, pushed. **No sandbox DB/network access in this
environment** — every §1 measurement below is either static-analysis (repo code read) or explicitly marked
UNMEASURED where it needs a live query/network call this session cannot make.

**§1 measurements (table):**

| # | Question | Answer |
|---|---|---|
| 1 | `briefing-intel-snapshot` feeds/streams | Code confirms exactly the 4 streams the spec names — `healthcare` (MedCity News, KFF Health News, Health Affairs), `government` (GSA News, Government Executive), `net_lease` (GlobeSt, Bisnow National, Commercial Observer), `tax_policy` (Tax Foundation) — `RSS_FEEDS` in `supabase/functions/briefing-intel-snapshot/index.ts`. Items/day per the last 7 `briefing_intel_snapshot` rows and which feeds are currently failing: **UNMEASURED — no DB/network access this session.** |
| 2 | Analyst's Take on-box path | Flag state + last-known measurement (2026-08-26, `briefing-analyst-take-onprem.md`): `BRIEFING_ANALYST_TAKE_ONPREM` reads `on`; that day's row carried a 774-char take, `analyst_take_meta.source='onprem_ollama'`. **Not re-measured this session** (dated per CLAUDE.md's own re-measure doctrine — flag `on` here.) |
| 3 | `ANTHROPIC_API_KEY` presence/success, web-search tool | Presence per runtime: **UNMEASURED** (cannot read Railway/Supabase env, and must not print a key value if it could). Last known call outcome (2026-08-26, code comment in `briefing-analyst-take.js`): key is SET on the `briefing-intel-snapshot` edge fn but every call since 2026-07-08 returns `Anthropic API 400: ... credit balance too low` — billing-dead, not unconfigured. **Web-search tool: NOT enabled in the current code path** — `supabase/functions/briefing-intel-snapshot/index.ts`'s `fetch('https://api.anthropic.com/v1/messages', ...)` body carries no `tools` field at all (static fact, confirmed by reading the request body construction). |
| 4 | Scheduler / tick registration + health check | pg_cron (`lcc_cron_post`) posts to Railway/edge on a schedule; every recent tick follows the P123/P133 lifecycle — a run-log table opened at entry (`status='started'`) and closed on exit (`completed`/`failed`), read via a `v_..._run_health` view (mirrored exactly from `lcc_ownership_chain_draft_run_log` / `20260826230000_lcc_p133_ownership_chain_draft_run_log.sql`). `producer_runs` (this migration) generalises that pattern across every MB/XB/OC producer instead of minting a new dedicated run-log table per producer. |
| 5 | Tagged Outlook intake (`intake-tagged-comm.js`) | Handler exists (`api/_handlers/intake-tagged-comm.js`) — viable reuse for the `outlook_tagged` operator-note channel per the contract doc. Flag state + rows in the last 30 days: **UNMEASURED — no DB access this session.** |
| 6 | MCP `log_memory` write template | Read directly from `mcp/server.js`: one POST to `cortex_memory` (`domain`, `kind`, `summary`, `detail`, `source:'mcp:log_memory'`), returns `{ok, logged}`. `log_operator_note` (OC1, later prompt) should mirror this exactly — one call, one row, no read-back. |
| 7 | Overlap tables | `cm_report_snapshots` — pattern reused deliberately (`market_brief_issues.fact_ids` freezes a fact set the same way). `cortex_market_intel` — table is referenced live (RLS-enabled in `20260728120000_rls_security_hardening_ops.sql`) but its `CREATE TABLE` is not in this repo's migration history and no `api/` code reads/writes it; **could not determine its schema or purpose from repo-only analysis** — flagged as a possible pre-repo or externally-created table, not reused. `staged_intake_feedback` — different domain (intake-match human feedback), no overlap. Decision Center lanes — different shape (verdict-per-row, not fact-per-claim); not reused. |

**Migrations applied:** **NO** — written as a file only, not applied to any live Supabase project (per the
prompt's explicit instruction; this session has no Supabase credentials regardless).
`supabase/migrations/20260911165100_lcc_eb1_exec_briefs_foundation.sql` — five tables
(`market_brief_facts`, `market_brief_issues`, `build_brief_snapshots`, `operator_notes`,
`producer_runs`) + two views (`v_market_brief_live`, `v_market_brief_staleness`), RLS enabled on all five
new tables using the existing lockdown pattern (`service_role` FOR ALL + `authenticated` FOR SELECT,
mirrored from `20260522140000_lcc_rls_lockdown_new_backend_tables.sql`).

**Contracts (docs only):** `docs/architecture/market_brief_payload_contract.md` +
`docs/architecture/operator_note_contract.md`, mirroring `daily_briefing_payload_contract.md`'s style.
Both are explicit that no endpoint they describe exists yet — MB-a/MB-b/MB-c and OC1/OC2/OC3 build to
these contracts, not the reverse.

**Seed script:** `scripts/eb1-seed-dialysis-exemplar.mjs` (dry-run by default). Dry-run over the dialysis
exemplar (`docs/briefs/exemplars/2026-09-11-dialysis-market-brief.md`) plans **16 facts** — operators 6,
policy 4, capital_markets 3, trades 1, implications 2 (14 `reported` + 2 `opinion`) — and explicitly
excludes the exemplar's 5 `[UNVERIFIED]` items (a 2026 FMC rating action, USRC's Moody's timing, IRC M&A,
a dialysis-specific cap-rate average, GLP-1 demand impact). Idempotent via the migration's own
`uq_mbf_source_identity` unique index (`Prefer: resolution=ignore-duplicates`).

**Guard + suite:** `test/eb1-market-brief-foundation.test.mjs` (16 tests — migration structural invariants:
table/constraint/index presence, the staleness view's CROSS-JOIN-before-LEFT-JOIN shape per the Class-20
lesson, comment-stripping positive control) + `test/eb1-seed-exemplar.test.mjs` (7 tests — pure-function
idempotency, `[UNVERIFIED]` exclusion, TTL math). **Full suite run: 5,791 pass / 0 fail / 6 skipped**
(pre-existing skips, unrelated to this change).

**What EB1 did NOT touch (per the prompt's §5):** no change to `briefing-email-handler.js`, no new cloud-
model call, no producer tick, no email sent, no flag flipped, nothing sent to a cloud model. Everything
ships flag-gated OFF by construction — there is no flag yet, because nothing reads this schema yet.

**Contradicts/missing from the spec:** nothing found. `EXEC-BRIEFS-SPEC.md` v0.2, `PLANNED-BACKLOG.md` §P18
and the two exemplars all existed exactly as the prompt described; no gap between the spec and what was
built. The one thing worth flagging forward: §1.7's `cortex_market_intel` could not be graded reuse-vs-new
because its schema is not in this repo — MB-a should re-check it live before deciding whether any MB table
should fold into it instead.

**Branch:** `feat/eb1-exec-briefs-foundation`, pushed to `origin` (`git push -u origin
feat/eb1-exec-briefs-foundation` succeeded). **No PR opened** — not requested, and this session cannot
merge to `main` regardless (branch-protected, required check `npm test`).

**Files created:** `supabase/migrations/20260911165100_lcc_eb1_exec_briefs_foundation.sql`,
`docs/architecture/market_brief_payload_contract.md`, `docs/architecture/operator_note_contract.md`,
`scripts/eb1-seed-dialysis-exemplar.mjs`, `test/eb1-market-brief-foundation.test.mjs`,
`test/eb1-seed-exemplar.test.mjs`. **Files modified:** `docs/os/PLANNED-BACKLOG.md` (§P18 EB1 row),
`docs/claude-code/STATUS.md` (this entry). `docs/os/CURRENT-STATE.md` not touched — nothing here is live
(unmigrated + unread by any consumer), so there is nothing yet to add to the LIVE map.
## 2026-09-11 — AC2/AC3 (bench ranking + Ollama role inference) flipped live: migration applied, `BENCH_RANK_WRITE` registered on

The last open item from `ACI-phase2-unitC`'s own verification note was a pure operator action: apply
`20261010150000_lcc_bench_rank_run_log.sql` and register `BENCH_RANK_WRITE` in `feature_flags_registry`.
Did both against `xengecqvemvfknjvbvrq`.

**Migration applied clean** — `lcc_bench_rank_run_log` and `lcc_bench_rank_write_log` both confirmed live,
correctly permissioned (`service_role` INSERT, `anon`/`authenticated` revoked on both).

**Flag registered**: `BENCH_RANK_WRITE` inserted into `feature_flags_registry` with `state='on'`,
`surface='api/bench-rank-tick'`. `feature-flag.js`'s own resolution order (explicit env var wins if set,
else the registry decides) means this alone is enough — no Railway env var or redeploy needed.

**What this does and doesn't do**: `GET /api/bench-rank-tick` was already ungated (dry-run only) and stays
that way. `POST` (the real write) was a no-op end-to-end until both the migration and the flag existed —
now it isn't, but nothing calls the route on a schedule (checked: no cron references
`bench-rank-tick` anywhere in the repo, it's purely an on-demand admin route). So this makes the write path
genuinely live and ready rather than actually causing anything to write yet — the first real POST still needs
a person (or a future cron, not built) to trigger it.

**Docs**: `PLANNED-BACKLOG.md` `AC2` row updated from "ledger migration written, not applied live" to the
live-confirmed state.

**Next step.** The ownership/contact-propagation thread's other open items are unchanged by this:
`OWN-T0a` (gov's 43.4% recorded-vs-true-owner disagreement, still the largest untouched upstream gap),
`B1b` (developer chain, gated behind `B5`), and `AC11` (individual-owner control-chain population needs
re-measuring now that `PR-scanner-2`'s SOS capture has shipped — it was sized at zero before that existed).

## 2026-09-11 — BROKER1 applied live: a real bug found and fixed in production, 1,303 prospects assigned (870 gov→Scott, 414 dia→Kelly, 19 catch-all→Scott), Nate confirmed untouched

The shipped code (`8a40073d`, merged) could not be run by the session that built it — no DB credentials there.
This session applied the migration directly against `xengecqvemvfknjvbvrq`.

**The migration's own self-check passed, but the first live call to the function it created did not.**
`lcc_broker1_assign_prospect_brokers(p_dry_run)` declares `RETURNS TABLE(bucket text, n bigint)`, which makes
`bucket` an implicit PL/pgSQL variable inside the function body — three `count(*) FILTER (WHERE bucket = '...')`
lines collided with it (`42702: column reference "bucket" is ambiguous`), a bug the shipped test suite's 13
Node tests never could have caught since none of them touch live Postgres. Fixed live by qualifying every
reference with the temp table's own alias; no behavior change, same buckets, same rule.

**Ran the real dry-run, then the real apply.** Final counts over the 1,355-prospect seller-prospecting queue:
`already_manual_assignment_left_alone=52`, `defaulted_gov_to_scott=870`, `defaulted_dia_to_kelly=414`,
`defaulted_catchall_to_scott=19`. The design's ordering requirement (the JS ROE self-signal pre-pass must run
*before* the SQL default sweep, or a real "someone's already pursuing this" signal could get overwritten by a
vertical default) couldn't be honored by calling the actual `/api/broker1-assign-tick` route — it's
auth-gated behind `LCC_API_KEY`, which this session doesn't hold. Instead of skipping the check, the JS pass's
exact query (`external_identities` where `source_system='salesforce'`, `source_type='account'`, for every
currently-unassigned prospect) was run directly in SQL first: **0 of 1,303 unassigned prospects carry any SF
Account-owner metadata at all**, confirming the pre-pass has nothing to write — not skipped, genuinely empty —
so applying the default sweep directly was safe.

**Nate verified untouched, the way the rule requires**: 7 `lcc_entity_owner_override` rows do name him, but
every one carries `set_by='reconciled'` — an older, unrelated `deal_owner`/`sf_task` signal that predates this
build. BROKER1's own function never references Nate's `lcc_user_id` as an assignable value, and fill-blanks-only
means it could not have touched these regardless. Spot-checked 8 random post-sweep rows live via the new
`v_lcc_broker1_prospect_assignment_state` view — all correctly bucketed by domain.

**Confirmed the deployed app is current**: Railway `/version` on `tranquil-delight-production-633f` reads
`8716d86d406f`, matching this session's `git` HEAD exactly — `/api/broker1-assign-tick` is live, this session
simply lacks the key to call it. Running the JS pre-pass for real through the actual route (a harmless no-op
today, given the confirmed-empty population, but worth closing the loop formally) is the one remaining operator
action — not a build gap.

**Docs**: `PLANNED-BACKLOG.md` `BROKER1` row updated with the live-applied outcome and the bug fix; `C4c`'s
supersession note is unaffected. Moved `BROKER1-prospect-assignment.md` and its response to `done/`.

**Next step.** `BROKER1-sf` (the Salesforce connect-back) stays correctly unbuilt — no write path into
Salesforce exists yet, unchanged from the shipped finding. The rest of the ownership/contact-propagation
thread (`OWN-T0a`, `B1b`, `AC11`'s population re-measure, the AC2/AC3 migration+flag operator action) is
still open and untouched by this entry.


> **📦 ARCHIVE (2026-09-12):** entries for **2026-08-29 → 2026-09-11** (the B6d/B6e CI-and-producer-
> health arc tail, the PRI2–PRI5 ingestion-hang investigation, BROKER1, the P18/BUY0 design opens, the
> AC-series contact/address work, and a long ID-series/C13-C14 run) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-29_to_2026-09-11.md`](../history/STATUS_claude-code_2026-08-29_to_2026-09-11.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

---

## Open threads (updated 2026-09-12, CONSOLIDATE2 round 2)

One-line read on each active multi-round thread. Full narrative for anything older than this file's
current window lives in `docs/history/STATUS_claude-code_*.md`; durable state lives in
`docs/os/PLANNED-BACKLOG.md` and `docs/os/CURRENT-STATE.md`.

| thread | backlog rows | last entry | state (one line) |
|---|---|---|---|
| **Identity / operator canonicalization (ID-series)** | ID0–ID4, ID2a-cleanup, ID2b, ID2b-caps, ID2b-caps-2, ID3a–ID3e, ID3a-d | 2026-09-12 | ID2b-caps-2 shipped + live-verified (3rd comp source fixed at source); ID3a-d retired LCC's stale gov migration copy; ID2b's remaining 45 views/12 modules still group on operator text |
| **Market briefs (MB/EB)** | MB1d, MB-a2, MB-a3, EB1, P18 | 2026-09-11/12 | ID2b partially wired operator_id into the market-brief operator count; P18 swimlane spec + EB1 design-only; MB-a2 fixes confirmed live, MB1d (false-fresh CMS facts) is the open blocker |
| **Operator funnel (OC / HP1)** | HP1, HP1-P1a, HP1-P1a-fix, HP1-P1a-dup | 2026-09-12 | HP1-P1a-fix CLOSED live (608 rows UPDATED, first-ever Salesforce UPDATE to `bd_opportunities`); HP1 P0 (Today 500 badge) fixed+deployed+verified |
| **Ownership (OWN/RO)** | OWN-T0a–T0j, RO3, B1b, AC2/AC3/AC6–AC11 | 2026-09-12 | OWN-T0j verified end-to-end live; RO3 field-mapping design drafted; OWN-T0a/B1b/AC-series propagation work still open |
| **CoStar sidebar / public records (PR5/PRI)** | PR5d, PR-scanner-3, PRI2–PRI5 | 2026-09-12 | PR-scanner-3 shipped (`county_records_needed` action); PRI5 merged+deployed, awaiting another live CMS ingestion test run to confirm the hang is actually cleared |
| **App / UX** | ASC50, HP1, UX-T1a | 2026-09-12 | ASC50 governed review workbench built + locally verified, publication pending |
| **Buyer engagement (BUY0)** | BUY0, BUY1a/1b, BUY-G1–G6 | 2026-09-11 | Phase 0 complete for Geller Round 1 (client deliverable + email draft shipped); build handoff written, BUY1a/1b + BUY-G1..G6 filed as next steps |
| **Broker identity (BR) / BROKER1** | BR1, BR2, BROKER1, BROKER1-sf | 2026-09-11 | BROKER1 prospect-assignment applied live (1,303 assigned) with a real bug found+fixed in production; BROKER1-sf (Salesforce write-back) correctly left unbuilt — no write path exists |
| **gov agency canonicalization (ID3a\*)** | ID3a, ID3a-b, ID3a-c, ID3a-d, ID3e, I14, I16 | 2026-09-12 | ID3a-b/c/d/e all shipped and live-verified; repo-ownership hazard (I16) found and closed — `government-lease` owns the gov DB's migrations, LCC's copy retired |
| **CI / producer health (B6d/B6e)** | B6d-cms-*, B6d-assessor-*, B6d-pri-*, B6e-ci-*, B6e-fred-* | archived 2026-09-11 | Suite is a real merge gate (`Run Tests` unmasked, green once on `main`); `pip-audit`/secrets-grep/ruff still masked; full detail in the 2026-08-29→09-11 archive and `docs/architecture/producer-health-and-ci-enforcement.md` |

> **📦 ARCHIVE (2026-09-08):** entries for **2026-08-31 → 2026-09-01** (the CMS-ingestion restart,
> DOC1–DOC18 document pipeline, C13/C14 entity-role work, and the trailing pointers for two earlier
> cuts) were moved **verbatim** to
> [`docs/history/STATUS_claude-code_2026-08-31_to_2026-09-01.md`](../history/STATUS_claude-code_2026-08-31_to_2026-09-01.md).
> Nothing was dropped; every still-open item was already in `PLANNED-BACKLOG.md` and the canonical pages.

---

## 2026-09-12 — ID3a-d: named the owner of every database, retired LCC's government migrations (Claude Code)

`government-lease`'s ID3a-c fix (PR #398) showed that two repos ship migrations to the same
government database, and `life-command-center`'s own copy of the same canonicalizer fix
(`supabase/migrations/government/20260912030000_gov_id3ab_agency_canonicalizer_contamination_fix.sql`)
was **stale relative to what is actually deployed** — no state-qualifier guard, old ICE/CBP branch
order. Re-applying it would have silently restored `TEXAS DEPARTMENT OF AGRICULTURE → USDA` and
`Immigration & Customs Enforcement → CBP`.

**Shipped:**
- **Ownership table** (all three Supabase projects, measured, not guessed) in `CLAUDE.md` →
  "ONE REPO OWNS EACH DATABASE'S OBJECTS", mirrored in `docs/architecture/data-coherence-invariants.md`
  I16 and pointed-to from `docs/os/REGISTRY.md`. government → `government-lease` (settled by
  Scott); Dialysis_DB → `Dialysis` (proposed from evidence — 555 migration files there vs. LCC's
  277 duplicate copy, 👤 not yet Scott-confirmed); LCC Opps → `life-command-center` (this repo IS
  the app that reads/writes it).
- **Retired `supabase/migrations/government/`** — a `README.md` marking the directory historical
  and naming both defects the stale canonicalizer file would restore, plus a per-file historical
  header prepended to all 213 `.sql` files (script-generated, verified). Searched for any tooling
  that globs and applies this directory live against the government database — **found none**.
- **Guard:** `test/gov-migrations-directory-retired.test.mjs` (6 tests, all pass, includes a
  positive control that proves the detection logic can actually fail). Existing tests that read
  the retired canonicalizer migration (`test/gov-id3ab-agency-canonicalizer.test.mjs`,
  `test/id3a-gov-agency-identity.test.mjs`) still pass unchanged — the header is comment-only and
  those tests strip comments before asserting.
- **I16 drift-check design:** `scripts/db-drift/gov-deployed-vs-committed-drift.sql` +
  `scripts/db-drift/README.md`. Computes the live-side definition hash for every
  function/view/materialized-view/trigger in the government database's `public` schema; documents
  the "expected"-side replay of `government-lease`'s migrations and the final diff query inline.
  **NOT executed** — this sandbox has no network access to Supabase, so no drift result is
  reported (would be fabrication). Run it for real under credentials with access to the
  government project before scheduling anything on the I11 alert path.
- **ID3a-c deferred items closed/filed:** the "10 FK-vs-canonicalizer granularity judgment calls"
  are already surfaced by `government-lease`'s own `v_gov_agency_fk_display_drift` view
  (`sql/20260912_gov_id3a_c_agency_class.sql` §12) rather than a fresh list — filed as
  `ID3a-c-fk-granularity` in `PLANNED-BACKLOG.md`, pointed at `government-lease`, with the
  recommendation that Scott review that view's 10-row output in one pass. USFS/BLM/NSF
  canonicalizer gaps: the registry seed rows exist (`sql/20260305_phase4_financials.sql`) but no
  confirmed live regex branch was found — filed as `ID3a-c-usfs-blm-nsf`, low urgency pending an
  orphan-string volume measurement.
- **Not built, filed:** retiring LCC's `supabase/migrations/dialysis/*` (277 files) the same way —
  needs Scott to confirm `Dialysis` as the formal owner first (`ID3a-d-dia`).

**Not touched:** no live gov/dia/LCC-Opps DB object was edited. No migration was deleted. Full
suite not re-run wholesale in this pass (repo has thousands of tests); the new test file and every
test that reads a file this change touched were run directly and are green — see the branch's own
commit for the exact list.

## 2026-09-12 — ID2b-caps-2: the third comp source, fixed at the source of record, live-verified (Claude Code)

Cowork's live re-check of ID2b-caps found the gate had not actually held: `sf_comp_staging` (Team
Briggs' own Salesforce-staged closed comps) has no `properties` join, so `rpc_query_comps` could
only ever emit `operator_id: null` for that arm — 196 `DaVita Dialysis` + 179 `Fresenius Medical
Care` rows, exact matches of already-registered aliases, were minting a second, text-keyed band
under the identical canonical label the id-keyed band already carried.

**Shipped:**
- `sf_comp_staging.operator_id` — a new first-class column, fill-blanks resolved via the SAME
  ID2a resolver (`dia_resolve_operator`) every other caller uses, through a `BEFORE INSERT/UPDATE
  OF tenant` trigger that never raises (deliberately lighter than the `properties` hard-block
  guard, because this table is fed by an external Salesforce sync this repo does not control) and
  a dry-run-default backfill mirroring `dia_id2a_backfill_property_operator_ids` exactly.
- `rpc_query_comps`'s SF arm now resolves `operator_id`/`operator_canonical` from that column
  through `dia_operator_survivor`, identically to the sale/listing arms — every other key
  byte-identical.
- A structural duplicate-display-label invariant in `planOperatorCapRateBands()`
  (`market-brief-psql-tick.js`): two DIFFERENT resolved `operator_id` groups may never render
  under one canonical label. Scoped to id-keyed groups only — the documented ID2a coverage-gap
  fallback (an unresolved property sharing a raw-text label with a resolved sibling) is explicitly
  exempted, per the pre-existing accepted test for that case. On collision it logs loudly, keeps
  the larger-n band, and routes the loser through the existing `retireStaleFact()` supersede path.

**Live-verified against `zqzrriwuavgrquhisnoa`** (had DB access this session, unlike some prior
rounds): dry-run backfill predicted `406 candidates / 400 auto-apply / 6 review`, applied and
matched exactly. Re-ran the tick's own TTM window afterward: exactly three bands clear the small-n
floor (`id:4` DaVita, `id:5` Fresenius Medical Care, `id:73` US Renal Care); the one residual
same-label fragment (n=1) traces to an unrelated ID2a property-coverage gap on the `dialysis_db`
arm, not a recurrence of the SF-staging defect, and never clears the floor regardless.

Migrations: `supabase/migrations/dialysis/20260912140000_dia_id2bcaps2_sf_comp_staging_operator_id.sql`,
`.../20260912150000_dia_id2bcaps2_rpc_query_comps_sf_operator_id.sql` (both applied live). Guard:
`test/id2bcaps2-sf-operator-resolution.test.mjs` (13 tests). Full suite: 6,057 pass / 0 fail / 6
skipped (up from 6,044). Docs updated in this change: `docs/os/PLANNED-BACKLOG.md` §P0d (ID2b-caps-2
row), `docs/audits/ID2b_caps_RPC_QUERY_COMPS_OPERATOR_ID_2026-09-12.md` (addendum),
`docs/architecture/EXEC-BRIEFS-SPEC.md` §9 (correction appended in place, not rewritten).

**Not done, deliberately:** `MARKET_BRIEF_PSQL` not flipped; no change to comp SELECTION/scoring,
the registry merge machinery, or any alias-table write beyond calling the existing resolver; the 6
unresolvable `sf_comp_staging` tenants sit in `dia_operator_write_review` like any other unresolved
operator string, resolvable the normal way (`dia_id2a_resolve_review`).
