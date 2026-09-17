# `reconcile_property(property_id)` — spec (RECON1, 2026-09-17)

**Status:** SPEC ONLY. Nothing in this document is implemented as a general queue-driven
worker yet — the individual deterministic rules below mostly already exist as scattered
triggers/functions across the codebase (named per-rule); what does not exist is the single
queue that guarantees every ingest path enqueues into them and that the whole reconciliation
runs to a fixed point after every write. One instance of applying the ruleset by hand is
`dia_recon1_reconcile_banning_clinic()` (migration
`supabase/migrations/dialysis/20260917180000_dia_recon1_banning_clinic_reconcile.sql`),
which fixed one clinic and shipped two of these rules as standing triggers (R5's deterministic
half). This doc generalizes what that migration found.

**Scott's intent, verbatim (the reason this exists):**
> We want the ingestion of any data to trigger a reconciliation of the data so that we have
> one accurate view of the property and all other features. Not many different views in
> different places. … The property should no longer be in the available section when it
> closes.

**Read first:** `docs/architecture/property-identity-and-address-resolution.md` (§P10a),
`docs/architecture/flows/closing-the-loop-overview.md`, backlog rows `DIA-DUP1`, `PI1–PI8`,
`OWNER-WRITERS1`. This CLAUDE.md's "Data-write discipline" section (fill-blanks, conservative
matching, provenance-tagged, reversible, idempotent, never fabricate) governs every rule below
without exception.

## The shape

A queue-driven, idempotent function every ingest path enqueues into **after writing**:

```
OM intake  ─┐
CoStar listing ─┤
Salesforce comp ─┼──▶ dia_reconcile_queue (property_id, reason, enqueued_at) ──▶ reconcile_property(property_id)
Deed record ─┤
Lease abstract ─┤
HCAD/assessor ─┘
```

`reconcile_property(property_id)` is idempotent and safe to call redundantly (a property
enqueued three times in one ingest burst runs the same fixed-point three times and changes
nothing on the second/third pass). It NEVER deletes a row directly — every structural change
(a property fold) goes through the existing ledgered merge path
(`dia_merge_property_reversible` / `dia_unmerge_property`).

## R1 — Identity: resolve incoming address against existing properties INCLUDING range membership

**Trigger:** any ingest path about to INSERT a new `properties` row.
**Inputs:** the incoming address/city/state (+ house number, suffix, directional).
**Write:** either attach the incoming data to an EXISTING property, or (only on a genuine miss)
create a new property row.
**Ledger:** every resolution attempt (hit or miss) is a row in a resolution log, same shape as
`dia_ownergap2_resolution_log`'s pattern (a refusal is a row, never a silent skip).
**Existing vs new:**
- EXISTING: `dia_normalize_address()` (exact single-number match), the property-twin geospatial
  detector `dia_find_property_twins()` (haversine-based, ships with an `auto_blank` /
  `review_*` classification and a review lane `dia_property_twin_review` —
  `supabase/migrations/dialysis/20260814150000...` per CLAUDE.md §"Property address twins"),
  and the general fold-detector `v_dia_merge_candidates`-family functions.
- NEW, genuinely missing today: **range membership** ("6050" belongs inside "6050-6090") and
  suffix/directional normalization (St/Street, W/West) are NOT covered by either existing
  detector — `dia_normalize_address` does exact string comparison and the twin detector is
  geospatial-distance-based, which *would* have caught this pair (Banning's two shells sit
  ~0.001mi apart) but was never run against them because they were minted through the OM
  intake / CoStar sidebar paths, which do not call the twin detector before creating a row.
  **The gap is upstream of the detector, not in it**: R1 needs the ingest paths themselves
  (intake-promoter.js, sidebar-pipeline.js) to call the range/suffix-aware resolver — or the
  twin detector — BEFORE minting a property row, not after.
- A miss (no confident match) creates a `property_identity_review` row (mirrors
  `dia_property_twin_review`'s shape), never a silent new property, when confidence is
  ambiguous. Only the FUZZY TAIL of this rule (a genuinely ambiguous multi-candidate case,
  never the range/suffix arithmetic itself, which is pure string/number logic) may consult the
  existing on-box Ollama path, behind a flag, and only to RANK candidates for a human — never
  to auto-decide.
**Test:** `dia_recon1_lease_active_past_expiration_guard` is unrelated to R1; R1's own test
would assert: given "6050 W Ramsey St, Banning, CA" and an existing "6050-6090 W Ramsey St,
Banning, CA" row, the resolver returns the existing property_id, not a new one. (Not yet
written — filed as `RECON1-R1-test`.)

## R2 — Sale closes listings

**Trigger:** an INSERT/UPDATE on `sales_transactions` that sets `sale_date` on a property.
**Inputs:** the property's `available_listings` rows (including any that were separate
property rows before an R1/merge fold — "merged aliases").
**Write:** every active listing on the property closes as terminal (this DB's vocabulary:
`status='superseded'`, `off_market_reason='sold'`, `off_market_date`, `sale_transaction_id`
set — there is no `'superseded_by_sale'` value in the live `chk_dia_listing_status_vocab` /
`al_off_market_reason_check` constraints; use the values those constraints actually allow).
**Ledger:** none needed beyond the ordinary `updated_at`/audit trail on `available_listings` —
the write is the record.
**Existing vs new:** **ALREADY PARTIALLY EXISTS.** Measured live 2026-09-17: when
`dia_merge_property_reversible` repointed listing 12350 and 15146 onto property 29894, both
were closed automatically (status→sold, off_market_date→2026-09-14, sale_transaction_id→15042)
by the merge's own collision/fold handling (`merge_function_version
dia_merge1_fold_on_collision_2026_09_05`) — that machinery folds a *newly-arriving* active
listing against an *already-sold* listing on the survivor. What is genuinely new is the case
where NO fold collision exists to trigger it — e.g. a sale recorded directly on a property that
already has its OWN separate active listing with no competing sold row to fold against
(the safety-net loop in `dia_recon1_reconcile_banning_clinic()` §3.2 is exactly this case,
generalized: a trigger on `sales_transactions` insert/update of `sale_date` that closes every
sibling active listing, independent of whether a merge ever happens).
**Test:** insert a sale with `sale_date` on a property carrying an active listing with no other
sold listing; assert the active listing flips to superseded/sold/`sale_transaction_id` set.
Filed as `RECON1-R2-test`.

## R3 — Sale → ownership; unknown buyer/seller = explicit "not on file", never silent

**Trigger:** an INSERT on `sales_transactions`.
**Inputs:** `buyer_name`, `seller_name` (or resolved `recorded_owner_id`/`true_owner_id`).
**Write:** an `ownership_history` row is ALWAYS created for the sale. If the buyer/seller name
is present, it resolves through the existing owner-identity path (`dia_norm_owner_name`,
`recorded_owners`/`true_owners`). If either is missing, the sale still writes `buyer_name` /
`seller_name` = `'Not on file (pending deed)'` (never blank, never guessed) and opens a
`pending_updates` research task (`action='research_needed'`) to pull the deed.
**Ledger:** the `ownership_history` row itself, plus the `pending_updates` task when a party is
unknown.
**Existing vs new:** PARTIALLY EXISTS. `ownership_source='sales_transactions_seller_exit'` is
the live producer for the SELLER side (CLAUDE.md's "gov's sales table as a source of ownership
history" section, B5, ported to dia) — it correctly wrote the 2022 seller-exit row
(`ownership_history.id=21222`) for the Banning clinic. What is missing: (a) it never fires for
the BUYER side (there is no `ownership_history` row recording DaVita HealthCare Partners as the
2022 acquirer — id 1275 is an orphan carrying only `sale_id`, no owner ids or dates), and
(b) nothing fires at all when the sale carries no party names (the 2026-09-14 sale). New: a
"not on file" write path for a sale with no resolvable party, so silence never substitutes for
an explicit "we don't know yet, and here's the task to find out."
**Test:** insert a sale with `buyer_name IS NULL`; assert `sales_transactions.buyer_name` is
stamped `'Not on file (pending deed)'` and a `pending_updates` row exists referencing the sale.
Filed as `RECON1-R3-test`.

## R4 — Sale → attribution: is_northmarq + listing_broker → team, one rule one source

**Trigger:** an INSERT/UPDATE on `sales_transactions` that sets `is_northmarq=true`.
**Inputs:** `listing_broker_id` (preferred) or the free-text `listing_broker`/`procuring_broker`
resolved against `brokers.normalized_name`, then `brokers.broker_company_id` → `broker_companies`.
**Write:** fill-blanks `listing_broker_id`/`procuring_broker_id` from whichever side of the deal
the sale's own `listing_sale_id`/closing listing carries a resolved broker.
**Ledger:** none beyond the UPDATE itself (this is a derivation, not a judgment call).
**Existing vs new:** NEW. Measured live 2026-09-17: **235 sales with `is_northmarq=true` carry
neither `listing_broker_id` nor `procuring_broker_id`** (Part 4, Q4) — there is no existing
writer that back-fills broker id from the closing listing when a sale is created directly
(e.g. from a Salesforce internal comp, `data_source='salesforce_comp'`, as here). This is fully
deterministic: one lookup (closing listing → its `listing_broker_id`), one rule (fill-blanks
only), one source of truth for "which broker is on this deal."
**Test:** insert a sale with `is_northmarq=true`, `listing_broker_id=NULL`, linked to a listing
via `listing_sale_id` that carries a resolved `listing_broker_id`; assert the sale's
`listing_broker_id` fills from it. Filed as `RECON1-R4-test`.

## R5 — Lease supersession: newer lease deactivates older; is_active can never be true past expiration

**Trigger:** an INSERT on `leases` with a `parent_lease_id`, OR any INSERT/UPDATE setting
`is_active`/`lease_expiration`/`status`.
**Inputs:** the lease's own `lease_expiration`, `is_active`, `status`, `parent_lease_id`.
**Write:** (a) a newer lease with `parent_lease_id` set deactivates the lease it supersedes
(`is_active=false`, `superseded_at=now()`); (b) `is_active` cannot be `true` when
`lease_expiration < current_date`, UNLESS `status='holdover'` (a real month-to-month tenancy
past firm term is not a data error and must not be silently flipped false).
**Ledger:** none beyond the UPDATE.
**Existing vs new:** (a) EXISTING — `leases.parent_lease_id`/`superseded_at` columns already
exist and `dia_property_twin_review`-adjacent merge machinery already sets `superseded_at` on
a fold (seen live on lease 11734/13362, `superseded_at` populated). (b) **NEW, SHIPPED IN THIS
ROUND** as a standing trigger: `dia_recon1_lease_active_past_expiration_guard()` /
`trg_dia_recon1_lease_active_guard` (`BEFORE INSERT OR UPDATE OF is_active, lease_expiration,
status ON leases`), migration `20260917180000_dia_recon1_banning_clinic_reconcile.sql`. This is
the one rule in this list that is BOTH spec'd here AND already built, because the Banning
lease (id 23211) was a live instance of exactly this defect and a one-time UPDATE without a
standing guard would have regressed on the next writer that touches that row.
**Test:** `RECON1-R5-test` (to write): UPDATE a lease's `is_active` to `true` with
`lease_expiration` in the past and `status <> 'holdover'`; assert the trigger forces it back to
`false`. Positive control: the same UPDATE with `status='holdover'` must NOT be overridden.

## R6 — Name variants are not conflicts: run alias/normalize check BEFORE raising an owner conflict

**Trigger:** any writer about to flag an `owner_conflict` / `deed_newer_stale`-class discrepancy
between a recorded owner's display name and a newly-observed name (e.g. deed grantee text).
**Inputs:** both name strings.
**Write:** compute both `normalized_name` (or `dia_norm_owner_name()`); if equal, the write is
NOT a conflict — resolve/clear the flag with a note, never rename either side.
**Ledger:** the resolution note on the `pending_updates`/conflict row.
**Existing vs new:** the NORMALIZER already exists (`dia_norm_owner_name`,
`recorded_owners.normalized_name` — verified live: "DaVita HealthCare Partners" and "Davita
Healthcare Prtnrs" already both normalize to `'davita healthcare prtnrs'`). What's missing is
the ORDERING: whatever writer raises the deed-vs-recorded-owner conflict does so BEFORE
checking normalized equality, so a spelling variant is misreported as a live conflict. NEW: gate
the conflict-raising step on a normalized-name comparison first; only raise the conflict when
the normalized forms genuinely differ.
**Test:** feed the conflict-detector "DaVita HealthCare Partners" vs "Davita Healthcare
Prtnrs"; assert no conflict is raised (normalized forms equal). Feed it "DaVita HealthCare
Partners" vs "Fresenius Medical Care"; assert a conflict IS raised. Filed as `RECON1-R6-test`.

## R7 — Artifacts follow the property: an intake artifact attached to a row that later merges/folds moves with the merge

**Trigger:** `dia_merge_property` / `dia_merge_property_reversible` folding a `drop_id` into a
`keep_id`.
**Inputs:** any `property_documents`, `staged_intake_*`, or `available_listings.intake_artifact_*`
column referencing the dropped property.
**Write:** repoint the artifact reference to the survivor.
**Ledger:** captured in the merge's own `child_keys`/`rewired` JSON (already present).
**Existing vs new:** **ALREADY EXISTS.** Verified live in this round's own merge backups:
`dia_merge_property_reversible`'s `rewired` JSON for the Banning merge shows
`property_documents.property_id: 5` rows repointed for the OM shell and `1` for the CoStar
shell, plus `contacts.property_id`, `property_financials.property_id`,
`property_cms_link.property_id`, `property_cms_link_history.property_id` — the generic child-FK
repoint already covers artifact-bearing tables by construction (any table with a
`property_id` FK is repointed, not just a curated allowlist). Nothing new needed for R7 itself;
it is cited here only because the task spec asked for it explicitly and it is worth recording
that it is NOT a gap.

## Model-touching surface, stated explicitly

Only two things in this whole ruleset may ever call a model, and both are behind existing
flags on the existing on-box Ollama path:
1. **R1's fuzzy tail** — ranking candidates for a human when the deterministic
   range/suffix/directional match and the geospatial twin detector both return more than one
   plausible candidate with no clear winner. The model never decides; it only orders a review
   queue a human confirms.
2. **Lease-abstract term extraction** feeding R5's "newer lease with parent_lease_id" case —
   turning an OM's lease_abstract artifact into actual lease terms is the EXISTING
   intake-extractor.js / lease-extractor.js AI extraction path, unchanged by this spec.

**R2–R6 are fully deterministic and must stay that way.** None of them requires judgment about
what a document says — they are joins, comparisons, and vocabulary-constrained writes. A future
change that routes any of R2–R6 through a model call is a regression against this spec.

## Part 4 — measured blast radius (live, Dialysis_DB, 2026-09-17)

| # | question | measured |
|---|---|---|
| 1 | dia properties sharing a house-number token + street with another row where one is a range and one is a single number (or a directional/suffix variant caught by the same rough key) | **75** distinct properties (approximate — this key matches range-vs-single-number pairs on the same normalized street name; it does not yet do full suffix/directional token normalization, so it understates the true PI-class population) |
| 2 | active listings sitting on properties with a sale dated after the listing's own date | **0** (measured via `available_listings.is_active=true JOIN sales_transactions ON property_id AND sale_date > listing_date` — the Banning case was 0 under this exact query because the shell listings lived on DIFFERENT property_ids before the merge, which is the real defect: this query cannot see a cross-property instance of the same clinic) |
| 3 | leases with `is_active=true` past their own `lease_expiration` | **2,455** |
| 4 | sales with `is_northmarq=true` carrying no team/broker attribution (`listing_broker_id IS NULL AND procuring_broker_id IS NULL`) | **235** |

Note on #2: the literal query answers "0" and that is the honest number for the query as
specified — but it is the wrong instrument for the class this task is about. The Banning clinic
itself would have scored 0 on this exact query too (its active shell listings sat on 35786/51228
while the sale posted against 29894 — three different `property_id`s). The real population for
"a sale somewhere hasn't closed a listing somewhere for the same clinic" needs R1's identity
resolution run FIRST; #2 as asked is downstream of #1, not independent of it. This is recorded
here rather than silently reported as a clean "0" — see the CLAUDE.md doctrine on a comparator
"structurally unable to express the question" returning a plausible zero.
