# STATUS archive — Claude Code queue, 2026-09-11 (RO5 → ID1 reconcile)

Moved **verbatim** out of `docs/claude-code/STATUS.md` on 2026-09-12, before pushing, to restore the 200-line
headroom the file's own convention block requires (`test/status-line-budget.test.mjs`, budget 2,500). Nothing was
reworded, summarised or dropped — a contiguous span lifted whole. Every still-open item named below is tracked in
`docs/os/PLANNED-BACKLOG.md`, the canonical open-work list; read that first and treat this as the narrative record.

Covers 7 entries, from *2026-09-11 -- RO5 sized: joined the 761 gov disputes to the reconciled store; Sc* to *2026-09-11 — ID1 reconciled (PRs #2323/#2325 merged): figures confirmed live; co*.

---

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
