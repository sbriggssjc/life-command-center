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

## R3 — Sale → ownership; unknown buyer/seller = explicit "not on file", never silent, NEVER A SENTINEL STRING IN THE NAME COLUMN

**⚠️ AMENDED 2026-09-17 (RECON1-b).** RECON1's own migration violated the rule it was writing:
it stamped `sales_transactions.buyer_name`/`seller_name = 'Not on file (pending deed)'` for
sale 15042 — a sentinel string encoded INSIDE a party-name column. That is not the honest value,
it is a fabricated-looking name that will confuse every downstream reader of `buyer_name` (a
rent roll, a comps export, a client-facing exhibit) that has no reason to know that string is
special. Fixed (`20260917_dia_recon1b_no_sentinel_party_names.sql`): `buyer_name`/`seller_name`
stay `NULL`; a new `buyer_name_pending_deed`/`seller_name_pending_deed boolean` column carries
the "we don't know yet" fact explicitly, alongside the `pending_updates` task link
(`entity='sale:<sale_id>'`). A `CHECK` constraint
(`chk_sales_transactions_no_sentinel_party_names`) now refuses `not on file`, `pending deed`,
`unknown` or `tbd` (word-boundary) inside `buyer_name`/`seller_name` fleet-wide — applying it
found a SECOND pre-existing violation (sale 5974, `buyer_name='TBD (buyer unknown)'`), fixed the
same way. **The rule, restated: a "we don't know yet" fact is a flag + a task link, never text
inside the field that field's readers expect to be a real name.**

**Trigger:** an INSERT on `sales_transactions`.
**Inputs:** `buyer_name`, `seller_name` (or resolved `recorded_owner_id`/`true_owner_id`).
**Write:** an `ownership_history` row is ALWAYS created for the sale. If the buyer/seller name
is present, it resolves through the existing owner-identity path (`dia_norm_owner_name`,
`recorded_owners`/`true_owners`). If either is missing, `buyer_name`/`seller_name` stay `NULL`,
`buyer_name_pending_deed`/`seller_name_pending_deed` are set `true`, and a `pending_updates`
research task opens (`action='research_needed'`, `status='open'` — NOT `'pending'`, which is not
in `pending_updates_status_check`'s allowed vocabulary and is why RECON1's own task insert
silently failed; see `dia_recon1_run_log` rows with `note='task_insert_failed'`) to pull the
deed.
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

## R5 — Lease supersession: newer lease deactivates older; is_active can never flip to false WITHOUT CONFIRMED evidence of expiration

**⚠️ SUPERSEDED 2026-09-17 (RECON2), same day it was first written.** The original text of this
rule below said `is_active` cannot be `true` when `lease_expiration < current_date`, and RECON1
shipped exactly that as a standing trigger that flipped `is_active` on date alone. **Scott
overruled it, verbatim:** *"Let's only allow leases to go inactive once we have confirmation
that the lease expired. We can leave it in an unconfirmed status until further research or
evidence updates it."* RECON1's trigger was disabled the same day
(`20260917213000_dia_recon1_lease_guard_disable_pending_recon2.sql`) after measuring **2,454**
leases it would have (or had already, in the Banning case) silently deactivated on date alone —
with zero evidence any of them are actually vacant/re-let/terminated. RECON2
(`20260917_dia_recon2_lease_expiration_confirmation_model.sql`) replaces it. **The rule below is
the corrected one; the original text is preserved nowhere else — this is the record of the
change, not a second copy of the mistake.**

**Trigger:** an INSERT on `leases` with a `parent_lease_id` (supersession, unchanged), OR any
INSERT/UPDATE setting `is_active`/`lease_expiration`/`status`/`expiration_state`.
**Inputs:** `lease_expiration`, `is_active`, `status`, `parent_lease_id`, and the new
**confirmation state** — `leases.expiration_state` (`in_term` | `expiration_unknown` |
`expired_unconfirmed` | `expired_confirmed` | `holdover_confirmed` | `renewed_confirmed`),
`leases.expiration_evidence` (jsonb: evidence_type/source/reference/observed_date/recorded_by/note),
`leases.expiration_state_at`.

**⚠️ SUPERSEDED IN PART 2026-09-18 (RECON2-b), same round it was reconciled.** Two defects found in
RECON2's own classifier/enqueuer, fixed by `20260918120000_dia_recon2b_lease_expiration_evidence_fix.sql`
(applied live):
1. **`cms_closure` evidence was keyed on ANY `medicare_clinics.status IN
   ('removed','closed','relocated')` row on the property — `status='removed'` is an import/list
   state, 90% of the table (7,690/8,547), NOT a closure.** Measured: 1,489 of 1,494
   `expired_confirmed` proposals fired on `cms_closure`, and **1,481 of those sit on a property
   with an `is_operating=true` clinic row** — leases 13217/10060/12369/6721/8826 (top of the
   rent-ranked list) among them. `dia_recon2_classify_expired_leases` now requires, for EVERY
   `medicare_clinics` row on the property, `is_operating IS NOT TRUE AND status IN
   ('closed','relocated')` — an operating clinic disqualifies `cms_closure` outright and the row
   proposes `expired_unconfirmed` with `evidence_detail='clinic operating (CMS) — no expiration
   evidence; holdover or renewal undetermined'` instead of silently carrying no note. Re-measured
   live post-fix: `cms_closure` proposals **1,489 → 2**.
2. **`expiration_state='in_term'` was being written for leases with NO `lease_expiration` on
   file** (`NULL < current_date` is false in SQL, so "unknown" read as "confirmed current") — 3,801
   rows, 2,334 active, backfilled to a new **`expiration_unknown`** state (added to the CHECK
   constraint); the guard trigger now branches NULL → `expiration_unknown` before the `< current_date`
   test.
3. **The enqueue function had no `is_active` filter** — 563 of its first 1,000
   `pending_updates` worklist rows sat on leases already `is_active=false` (superseded history).
   Fixed (added `l.is_active=true`) and the 563 pre-existing rows closed `status='ignored'`,
   ledgered, reversible. It also now ranks a lease whose property carries an operating CMS clinic
   first — the cheapest case for an operator to confirm/refute.
No fleet write to `is_active`/`expired_confirmed` happened at any point in RECON2 or RECON2-b — both
rounds shipped classifier/worklist fixes only.
**Write, two separate paths, deliberately:**
- **The automatic guard** (`dia_recon2_lease_expiration_state_guard()`, trigger
  `trg_dia_recon2_lease_expiration_state_guard`) sets `expiration_state = 'expired_unconfirmed'`
  on any past-due lease with no confirming evidence yet, `'in_term'` otherwise. **It NEVER
  writes `is_active`.** A newer lease with `parent_lease_id` still deactivates the lease it
  supersedes via the pre-existing merge/supersession machinery (unchanged).
- **The evidence-gated confirm function** (`dia_recon2_confirm_lease_expired(p_lease_id,
  p_new_state, p_evidence_type, p_source, p_reference, p_note, p_recorded_by)`) is the ONLY
  path permitted to move a lease to `expired_confirmed` (and set `is_active=false`),
  `holdover_confirmed` or `renewed_confirmed` (both keep `is_active=true`). It RAISES if
  `p_evidence_type`/`p_source` are not supplied — no confirmation without a stated reason.
  Confirmed evidence classes: a new/successor lease on the same property/tenant, a recorded
  termination, a CMS-derived closure/move signal (`medicare_clinics.status IN
  ('removed','closed','relocated')`), a sale/OM/lease-abstract naming a successor lease, or an
  explicit operator/app decision.
**Ledger:** every confirm-path write logs to `dia_recon1_run_log`
(`step='confirm_expiration'`, `prior_value` captured for manual reversal). The automatic guard's
writes are the UPDATE itself (state-only, no destructive change to reverse).
**Existing vs new:** (a) supersession-on-INSERT — EXISTING, unchanged. (b) the confirmation
model — **NEW, SHIPPED 2026-09-17 (RECON2)**, replacing RECON1's date-only guard (dropped by
the same migration). A DRY-RUN classifier (`dia_recon2_classify_expired_leases`) proposes a
state + evidence per row without writing `leases` — measured live over the 2,454-row population:
**1,489 `expired_confirmed`/cms_closure, 4 `expired_confirmed`/termination_record, 1
`expired_confirmed`/successor_lease, 960 `expired_unconfirmed`** (no `holdover_confirmed`/
`renewed_confirmed` proposals — this round implements no deterministic "continued occupancy"
evidence signal; that is a stated gap, not a guess). A fleet WRITE of these proposals to
`leases` is a separate, future unit — not run in RECON2 (Scott reviews a 25-row sample first).
`expired_unconfirmed` leases are routed into the existing `pending_updates` research lane
(`dia_recon2_enqueue_expired_unconfirmed_research`, status=`'open'`, ranked by `annual_rent`).
**Test:** `RECON1-R5-test` is superseded by: (1) UPDATE a lease's `lease_expiration` into the
past with no other change; assert `expiration_state` flips to `expired_unconfirmed` and
`is_active` is UNCHANGED. (2) Call `dia_recon2_confirm_lease_expired` with a real
`evidence_type`/`source`; assert `is_active` flips per `p_new_state` and a ledger row is
written. (3) Call it with `p_evidence_type` or `p_source` NULL; assert it raises and nothing
changes.

**⚠️ SUPERSEDED IN PART 2026-09-18 (RECON2-c), evidence-rule fixes found from Scott's own
field check of the seven `expired_confirmed` proposals** (`docs/audits/RECON2-b-confirmed-
expired-leases-review-2026-09-18.md`, "Scott's read — round 34"). `dia_recon2_classify_expired_leases`
(migration `20260918130000_dia_recon2c_lease_evidence_rules_and_confirmations.sql`) adds four rules:

(a) **A `medicare_clinics` row with `dedup_status = 'demoted_duplicate'` is never read as evidence**,
on the lease's own property OR a twin property. Sierra Vista (lease 23273, property 22471) is the
case that found this: the clinic reading `closed` on the lease's own property was a demoted-duplicate
Fresenius row — a different operator's stale duplicate, not a closure signal for this DaVita lease.

(b) **`cms_closure` requires the clinic's `chain_organization` to resolve, via `dia_resolve_operator`,
to the SAME operator as the lease's own `tenant`.** A clinic on the property belonging to a different
operator says nothing about this lease's tenant, confirming or refuting.

(c) **Evidence lookup also reads the property's R1 twins** — another property sharing the same
normalized street-number+street (`dia_recon2_street_twin_key`, built on the existing
`dia_normalize_address` primitive; no dedicated twin-detection migration existed in this repo to
reuse verbatim). **If a twin carries an OPERATING clinic (not demoted-duplicate) resolving to the
same tenant, the row proposes `expired_unconfirmed` with evidence_detail `"operating on twin
<property_id>"` — NEVER `expired_confirmed`**, even overriding a would-be `termination_record`/
`cms_closure` signal on the lease's own property. A genuine same-property `successor_lease` is
NOT overridden by twin evidence (that is direct same-property evidence). This is the shape behind
rows 3/5/6/7 of the field check: Scott's sidebar sends (CoStar lease data) landed on the TWIN
properties (37640/51243/39982), not the original lease's property, so the original rows read
`Terminated`/expired while the tenant is operating — on the record, at a different address.

(d) **A `conflict` output column** is true when twin evidence contradicts a same-property
termination/cms signal (the Sierra Vista shape), or when the lease's own recorded
`expiration_evidence` array already holds both a positive (`active`/`operating`/`current`/`open`)
and a negative (`closed`/`terminat*`/`vacat*`/`relocat*`/`expired`/`removed`) observation.

**`expiration_evidence` is now an ARRAY** of `{source, observed, observed_date, recorded_by}`
objects, `source ∈ costar_lease, operator_locator, google_hours, cms, deed, sale_om`
(`dia_recon2_record_evidence`, closed vocabulary, raises on an unrecognized source). Pre-RECON2-c
scalar-object rows are wrapped into a single-element array, never discarded or reshaped into the
new vocabulary. `dia_recon2_confirm_lease_expired` now APPENDS its own evidence object onto the
array rather than replacing the column, so a confirmation never destroys prior field-check
evidence recorded against the same lease.

**⚠️ Two-source bar, stated as a rule now, not just observed in the data: no `expired_confirmed`
on a single evidence source.** Every genuine confirmation in the RECON2-c field check rested on
at least two independent facts (a CMS status change AND an operator-locator relocation; an
operating-clinic corroboration AND a CoStar lease date; a status text AND the absence of any
CMS/twin signal contradicting it) — the one case that rested on a single automated signal
(CMS `closed`, unconfirmed by anything else) is exactly the one that was wrong (Sierra Vista).
`dia_recon2_confirm_lease_expired` does not enforce this mechanically (it takes one
`evidence_type`/`source` pair per call, by design, so a caller can record several before
confirming), but no human confirmation should be entered off one source, and the classifier's
own automated proposals never combine more than one derived signal into a single
`expired_confirmed` — each of `successor_lease`/`termination_record`/`cms_closure` already reads
as one fact class, and rule (c)'s twin check exists specifically to add a corroborating (or
contradicting) second read before anything downstream treats the first as sufficient.

**Confirmed 2026-09-18 (RECON2-c), all through `dia_recon2_confirm_lease_expired`, all idempotent:**
lease 23506 (Washington DC) → `expired_confirmed` — CMS closed + DaVita relocated to 920
Bladensburg Rd NE, verified by two independent sources; lease 6912 (Cartersville) →
`expired_confirmed` — site use changed to a restaurant (2019), Google evidence; leases 23259
(Goldsboro), 12599 (Orlando), 12678 (Dixon), 13058 (Scranton) → **confirm-with-successor**, one
transaction each (insert the successor lease with the same tenant, `data_source =
'costar_field_check'`, `parent_lease_id` → the old row, THEN confirm the old row — if the insert
fails, nothing about the old row changes); Orlando's successor carries `lease_expiration =
2028-06-30` (Scott's CoStar read); the other three carry no `lease_expiration` (unknown — no
CoStar date supplied — `expiration_unknown`, never guessed). Lease 23273 (Sierra Vista) gets **no
write** — both field-check evidence rows are recorded, the conflict flag is set, and it stays
`expired_unconfirmed`; the underlying defect is a property-identity split (a real DaVita clinic
minted on twin property 35849 while the lease's own property, 22471, carries only a
demoted-duplicate Fresenius row) — a RECON1-class fold, filed but not performed in RECON2-c.

⚠️ **This migration was authored without live Supabase access** (the session that wrote it had no
Supabase MCP connection) — its live dry-run counts and the exact twin-key match for the Sierra
Vista pair (22471/35849) are UNVERIFIED. Re-run `dia_recon2_classify_expired_leases(null)` after
applying and correct any figure here that does not reproduce.

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

## Part 1 — Banning trace table (RECON1's own task spec asked for this and RECON1 shipped without it; added here 2026-09-17, RECON1-b)

Every store that named the DaVita Banning clinic, before the RECON1 merge, which ingest path
wrote each row, and which join should have fired and did not:

| store | row(s) (pre-merge) | ingest that wrote it | join that should have fired | did it fire? |
|---|---|---|---|---|
| `properties` | 29894 (`6050-6090 W Ramsey St`), 35786 (`6050 W Ramsey St`), 51228 (`6090 W Ramsey St`) | 29894 = original master-sheet row; 35786 = OM intake (`e26e414f…`, 2026-09-01); 51228 = CoStar sidebar capture | R1's identity resolver (range membership: `6050`/`6090` both belong inside `6050-6090`) | **No** — `dia_normalize_address` does exact string comparison only; the range/suffix gap R1 exists to close |
| `available_listings` | 3 active listings, one per property_id (29894, 35786, 51228) at the same $4.75M ask | sidebar/CoStar capture per property row | property-identity resolution (above) — once the three properties are one, the listings dedup naturally | No (upstream of the fix) |
| `sales_transactions` | 2022 sale (id 4980, on 29894) + 2026-09-14 sale (id 15042, on 29894) | Salesforce comp export / internal comp | R2 (sale closes listings) and R4 (attribution) | Partial — 2022 sale correctly wrote a seller-exit ownership row; 2026 sale wrote no team attribution and no buyer/seller |
| `leases` | 4 rows on 29894, incl. lease 23211 (DaVita Kidney Care 2013-07-14→2018-07-13, `is_active=true`) | `davita_subledger`/`master_import` | R5 (expiration confirmation) | No — is_active read true 8 years past its own expiration until this round |
| `ownership_history` | id 21222 (2022 seller-exit, correct) + id 1275 (orphan, `sale_id`-only, no dates/owner) | `sales_transactions_seller_exit` producer | R3 (sale → ownership, buyer side + "not on file" path) | No — buyer side never fires; 2026 sale wrote nothing (no party names to resolve) |
| `recorded_owners` | `DaVita HealthCare Partners` (807949a9-…) | master sheet | R6 (name-variant check before flagging conflict) | Would have fired incorrectly — deed grantee text "Davita Healthcare Prtnrs" already normalizes identically; any stale conflict flag comparing the two predates the normalized-equality check running first |
| intake artifact (OM lease abstract) | attached to shell property 35786 (the OM's own address, `6050`) | LCC OM intake pipeline | R1 (identity, so the artifact lands on the SAME property as everything else) + R7 (artifact follows a merge) | R7 fired correctly once merged (verified live: `property_documents` for 35786/51228 repointed to 29894, 5+1 rows); R1 is why it was on the wrong property in the first place |
| Salesforce comp (`salesforce_internal_comp`) | the 2026-09-14 sale row, `is_northmarq=true`, `listing_broker='Scott Briggs'` (text), no `listing_broker_id` | Salesforce internal-comp sync | R4 (sale → attribution) | No — text broker name never resolved to `listing_broker_id`/team, fixed this round via the closing listing's own `listing_broker_id` (broker_id 1373) |

The seven rows above are the "seven stores" the RECON1 task spec named. R1 (identity) is the
root cause behind five of the seven downstream symptoms — everything else is a consequence of
three property rows existing for one clinic.

## Part 5 — RECON1-b close-out (2026-09-17)

Applied, live, via Supabase MCP against Dialysis_DB (`zqzrriwuavgrquhisnoa`):

- `20260917_dia_recon2_lease_expiration_confirmation_model.sql` — R5's confirmed-expiration
  model (see R5 above). Backfilled `expiration_state` on all 12,839 leases (7,632 `in_term`,
  5,207 `expired_unconfirmed`; `is_active` untouched by the backfill).
- `20260917_dia_recon2_classify_dedupe_fanout_fix.sql` — fixed a join fan-out in the classifier
  (multiple `medicare_clinics`/successor rows per property produced duplicate output rows for
  the same lease; aggregated to one row per lease).
- `20260917_dia_recon1b_no_sentinel_party_names.sql` — R3's amendment (see R3 above): no
  sentinel strings in `buyer_name`/`seller_name`, fixed on sales 15042 and (caught by the same
  guard) 5974.
- Data fixes, direct SQL (idempotent, targeted, not migrations — same convention as RECON1's own
  one-time row fixes): the deed-pull `pending_updates` task for sale 15042
  (`update_id=f4aa9e70-1252-40e2-800d-d0dced72b223`, `status='open'`); listing 14798 → `sold`,
  listing 12350 → `superseded` (they were backwards — 14798 is the listing that actually
  recorded the 2026-09-14 sale).
- `dia_recon2_enqueue_expired_unconfirmed_research(false, 1000)` run for real: the top 1,000
  `expired_unconfirmed` leases by `annual_rent` now carry an `open` `pending_updates` research
  task. Deliberately capped at 1,000 of 5,207 rather than enqueuing the whole population —
  consistent with this codebase's value-gate-the-producer doctrine (CLAUDE.md
  "Producer/Consumer"); the remaining rows are reachable by re-running the function with a
  higher `p_limit`/offset logic, which the function does not yet page — a stated gap, not run
  here.
- **Not done, deliberately:** the OM lease-abstract extraction for intake `e26e414f…` (task-spec
  5e) — running the actual `intake-extractor.js`/`lease-extractor.js` AI extraction path needs
  live API credentials and the running Node service, neither available from a SQL-only MCP
  session. `ownership_history` row 1275 stays orphaned, as instructed, pending the deed task
  above.
