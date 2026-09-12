# STATUS archive — Claude Code queue, 2026-09-11 (ID1/ID2/ID3 reconcile → ID0 identity probe)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12, **before pushing**, per the doctrine added
to `CLAUDE.md` the same day: a shared append-mostly doc grows on `main` while a branch is open, so archive to
restore 200+ lines of headroom rather than trimming when CI goes red (`test/status-line-budget.test.mjs`,
budget 2,500). Nothing was reworded, summarised or dropped — a contiguous span lifted whole. Every still-open
item named below is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list; read that first and
treat this file as the narrative record of how those rows came to exist.

Covers 13 entries, from *2026-09-11 — ID1/ID2/ID3 backlog blocks reconciled (two parallel threads, one table)* to *2026-09-11 -- MB-a3: freshness-honest on-box facts (CMS feed gate) -- flags withheld *.

---

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
