# STATUS archive — Claude Code queue, 2026-09-11 tail (second cut)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-14, **before pushing**, per the CLAUDE.md
doctrine *"TWO BRANCHES THAT BOTH ADD TO A SHARED DOC MERGE CLEANLY AND SILENTLY DUPLICATE IT"*: this file grows
on `main` while a branch is open, so archive to hold 200+ lines of headroom rather than trimming when CI goes red
(`test/status-line-budget.test.mjs`, budget 2,500). Nothing was reworded, summarised or dropped. Every still-open
item named below is tracked in `docs/os/PLANNED-BACKLOG.md`, the canonical open-work list; for the HP1 arc
specifically the map is `docs/architecture/HOMEPAGE-ATTENTION-SURFACE.md`.

Covers 6 entries, from *2026-09-12 -- checked the response queue (both already merged), then wrote RO3's fiel* to *2026-09-11 — ID1 shipped: the operator-identity audit, and a THIRD registry the queui*.

---

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


> **📦 ARCHIVE (2026-09-12, sixth span):** the **RO5 → ID1 reconcile** run of 2026-09-11 entries (the RO2–RO5
> recorded-owner arc, ID2a's operator registry, and the ID1/ID2/ID3 backlog reconciliation) was moved **verbatim**
> to [`docs/history/STATUS_claude-code_2026-09-11_ro5_to_id1.md`](../history/STATUS_claude-code_2026-09-11_ro5_to_id1.md).
> Nothing was dropped; every still-open item it named is tracked in `PLANNED-BACKLOG.md`.


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

> **📦 ARCHIVE (2026-09-12, ninth span):** the **ID0 probe → PRI5 deploy** run of 2026-09-11 entries was moved
> **verbatim** to
> [`docs/history/STATUS_claude-code_2026-09-11_id0_to_pri5.md`](../history/STATUS_claude-code_2026-09-11_id0_to_pri5.md).
> A duplicated *"PRI5 merged and deployed"* entry was collapsed to its complete copy first (two sessions restating,
> not amending). Nothing was dropped; every still-open item is tracked in `PLANNED-BACKLOG.md`.
