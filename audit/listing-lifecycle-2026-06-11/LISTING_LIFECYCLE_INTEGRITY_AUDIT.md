# Listing-Lifecycle Integrity — Audit, Doctrine & Gated Remediation Plan

> **Status: EXPLORATION (receipts-first). NO writes performed. No remediation applied.**
> All SQL in Phase 3 is *proposed* and must clear Scott's independent verification at the
> gate before any execution. This is the root-cause companion to the R76 view-layer fix
> (which counts `DISTINCT property` as a safety net). It subsumes Task-6c Phase-A
> (the phantom-writer close).
>
> - Date: 2026-06-11
> - Scope: `public.available_listings` on **dia** (`zqzrriwuavgrquhisnoa`) and **gov** (`scknotsqkcheojiaewwh`)
> - Doctrine target (Scott, 2026-06-10): **exactly one active listing row per property at a
>   time; one on-market iteration = one row; a sale closes the listing; a re-list supersedes
>   the prior; multiple genuine iterations are HISTORY (sequential, non-overlapping), never
>   simultaneous.**

---

## 0. Headline — the two DBs are in *different* states

| | **dia** (`zqzrriwuavgrquhisnoa`) | **gov** (`scknotsqkcheojiaewwh`) |
|---|---|---|
| Total rows | 5,055 | 2,998 |
| Current active rows (`is_active=true`) | 806 | 818 |
| Distinct properties in active set | **806 (1:1 — clean snapshot)** | **589 (POLLUTED)** |
| Properties with >1 active row **right now** | **0** | **116** (67×2, 29×3, 20×4+) → **229 excess rows** |
| Recurrence guard present? | **YES** — partial unique index `available_listings_one_active_per_property` on `(property_id) WHERE is_active IS TRUE` | **NO** |
| Close-on-sale trigger present? | **YES** — `trg_listing_close_if_sold` | **NO** |
| Close-on-sale gap (open listing on a sold property) | **0** | **11** |
| Phantom over-stamp (availability-checker) | ~7 (all already `is_active=false`) | **12** (live; the Task-6c Phase-A slice) |
| Point-in-time overlapping active *windows* (historical) | **332 props** (247 real / 85 synthetic-involving) | n/a — gov pollution is in the live snapshot, not just history |

**The asymmetry is the whole story:**

- **dia is guarded at the snapshot layer** — the partial unique index already enforces one
  active row per property, and `trg_listing_close_if_sold` closes on sale. So dia's *current*
  picture is clean (806 active = 806 properties, 0 close-on-sale gaps). dia's residual
  problem is **historical**: superseded/sold rows whose on-market *window* was never ended
  at supersession, so the R76 point-in-time engine reconstructs overlapping windows (the
  "92 properties at a single quarter" finding). This is masked for the CM charts by
  `DISTINCT property`, but the windows are still wrong.
- **gov is unguarded** — no one-active-per-property constraint, no close-on-sale trigger,
  and its only uniqueness key is `(property_id, listing_source, listing_status, listing_date)`.
  Because `listing_date` is in that key, **every daily OM re-ingest mints a brand-new active
  row.** gov's pollution is therefore *live* in the current snapshot, not merely historical.

The fix is not symmetric: **gov needs the guardrails dia already has** (one-active index +
close-on-sale trigger + a re-list/re-ingest collapse at write time), plus a one-time backfill
to collapse the 229 live excess rows. **dia needs a historical window-repair** (end the
on-market window of superseded/duplicate rows at their supersession date) so the R76 engine
stops seeing phantom overlaps; its write path is already correct.

---

## 1. PHASE 1 — AUDIT RECEIPTS (read-only, per vertical, per category)

### Status vocabulary (as found)

**dia** uses TWO status signals (`is_active` boolean + `status` varchar), and `status` is
dirty with case/spelling variants:

```
is_active:  true=806   false=4249
status:     active=719  Active=81  Available=3          (active-like total 803)
            sold=1289   Sold=1899                       (sold total 3188)
            Superseded=668  Off Market=118  Stale=128
            closed=12  Imported-Estimate=130  Draft-Commenced=6
            Closed but Obligated=1  <null>=1
data_source: synthetic_from_sale=1207   <null>=3848
```
- `is_active=true` (806) vs active-like `status` (803): **9 desync rows** —
  6 `is_active=true` with a non-active status, 3 `is_active=false` with an active-like status.
- `status` is free-text and inconsistent (`active`/`Active`/`Available`); consumers must not
  key on it without normalization. **`is_active` is the authoritative active gate** (it backs
  the unique index).

**gov** uses `listing_status` (text, default `'active'`) + `is_active`, and is cleaner:

```
listing_status: active=771  under_contract=47  sold=2115  orphan=61  superseded=2  withdrawn=2
is_active:      true=818   false=2180          (true == active + under_contract = 818 ✓)
url_status:     live=2944  dead=54
listing_source: synthetic_from_sale=1391  master_curated_sale=692  lcc_intake_om=667
                salesforce_ascendix=127  crexi=112  costar_sidebar=7  email_om/om_extraction=2
exclude_from_market_metrics: false=2942  true=56
```
- gov `is_active=true` aligns exactly with `listing_status IN (active, under_contract)` — no
  desync. **The active gate for gov is `is_active=true AND exclude_from_market_metrics=false`.**

### Category A — Simultaneous active duplicates

**Live snapshot (current `is_active`):**

| | dia | gov |
|---|---|---|
| Properties with >1 active row | **0** | **116** |
| Excess active rows | 0 | **229** |
| Distribution | — | 67 props ×2, 29 props ×3, 20 props ×4+ |

gov composition of the 229 excess rows (keep newest per property → 116 keepers):
- **143 are `lcc_intake_om`** — the same OM re-ingested on consecutive days.
- **86 are other sources** (salesforce_ascendix, crexi, master_curated) — genuine multi-source
  captures of the same property that were never reconciled to one active row.
- 0 synthetic.

> **Smoking gun — gov property 16350:** 12 active rows. One `salesforce_ascendix`
> (2026-03-31) + **11 `lcc_intake_om` rows for broker "Robert Bender / Doug Passon"** with
> `listing_date` on 11 consecutive ingest days (2026-05-22 → 2026-06-09), asking price
> flickering 561,850 ↔ 613,000. This is one OM re-ingested daily, each mint creating a new
> active row because `listing_date` is part of the upsert conflict key. The "96 multi-broker
> dup props" headline is **inflated by string variants of the same two brokers**
> (`"Robert Bender"`, `"Robert Bender / Doug Passon"`, `"Doug Passon, Robert Bender"`), so
> most are NOT genuine re-lists — they are the *same iteration* re-ingested.

**Point-in-time overlapping windows (the R76 Layer C definition):** a listing's on-market
window = `[listing_date, COALESCE(off_market_date, sold_date, last_seen, CURRENT_DATE if active)]`;
two windows on the same property that intersect = "simultaneously active at some instant."

| | dia |
|---|---|
| Properties with overlapping windows (any) | **332** |
| Properties with overlapping windows (real only, excl. synthetic) | **247** |
| Overlap pairs (any / real) | 1,077 / 944 |

> **dia property 28749** illustrates the historical mechanism: a 2021 sale-iteration, a
> 2023 iteration (2 rows), then **15 rows all stamped `listing_date=2025-09-12`** (Boulder
> Group brokers), all now `Superseded` — **but every superseded row carries
> `window_end=2026-03-06`** (a common `last_seen`/`off_market_date`), so its on-market window
> was never ended at supersession. The R76 engine therefore reconstructs 15 overlapping
> windows for Q4-2025…Q1-2026 where in reality only one listing was live. dia's snapshot is
> clean (1 active row today), but the *window history* is wrong.

dia exact-day duplicate burden (same `property_id` + same `listing_date`): **112 groups,
323 rows, 211 redundant** (max 15 in a single group).

### Category B — Close-on-sale gap (active listing on a property that has since sold)

Active listing whose property has a `sales_transactions` row dated **≥ listing start − 30d**:

| | dia | gov |
|---|---|---|
| Open listings that should be closed-by-sale | **0** | **11** |

dia = 0 because `trg_listing_close_if_sold` fires `BEFORE INSERT OR UPDATE` and closes the
row. gov has no such trigger; its close-on-sale relies on the JS post-insert sale check in
`upsertGovListings` and the availability crons, which leak 11 rows.

### Category C — Phantom over-stamp (NULL `listing_date` + over-stamped `off_market_date`)

| | dia | gov |
|---|---|---|
| `off_market_date` in the FUTURE | 0 | 0 |
| `off_market_date` set but row still `is_active=true` | 47 | 15 |
| NULL `listing_date` + `off_market_date` set | 616 | **12** |

- **gov 12** = NULL `listing_date` + `off_market_date` + `off_market_reason='unverified_assumed_off'`
  on `salesforce_ascendix` rows (`under_contract`×11, `superseded`×1). **This is exactly the
  Task-6c Phase-A availability-checker phantom: the checker stamped an off-market date on a
  row that has no on-market window (no `listing_date`), creating a backward/zero-length
  window.** These are the slice this audit absorbs.
- **dia 616** are NOT phantoms — they are `is_active=false` closed sale-derived rows
  (`Sold`×491, `Superseded`×121, etc.) imported with `off_market_date` but no `listing_date`
  (master-curated sold history). They contribute no on-market window (window has no start) so
  they don't pollute overlap counts; they are a *separate data-shape* note, not a defect to
  remediate here.
- The "**`off_market_date` set but still active**" rows (dia 47 / gov 15) are genuine
  internal contradictions — a row asserting both "off market on date X" and "currently
  active." These need the state machine to forbid the combination.

### Category D — Stale opens (active, not seen in a long time)

| | dia | gov |
|---|---|---|
| Active, `last_seen`/`last_seen_at` > 90 days old | 0 | **41** |
| Active, > 2 years old | 0 | 0 |
| Active, `last_seen` IS NULL | **75** | 0 |

- gov has **41 stale opens** (>90d since `last_seen_at`) — listings the availability-checker
  should have probed and closed but hasn't.
- dia has **75 active rows with `last_seen IS NULL`** — never observed by the checker, so the
  staleness clock never started. (No dia rows are >90d stale because `last_seen` is null, not
  old — the checker simply hasn't covered them.)

### Category E — Re-list overlaps (same property, ≥2 active rows from different brokers/sources)

This is a subset of Category A, separated by intent (genuine new campaign vs re-ingest):

- **gov:** of 116 dup properties — 42 are single-source (pure re-ingest, e.g. 11× the same
  OM), 74 are multi-source, 96 show >1 distinct broker *string* (but many are formatting
  variants of the same brokers, so genuine "different broker re-list" is a minority).
- **dia:** the 247 historical overlaps are dominated by same-day exact re-ingest (112 groups)
  plus a handful of genuine sequential iterations (e.g. 28749's 2021 → 2023 → 2025 campaigns,
  which ARE legitimate history and must be preserved as non-overlapping windows).

**Doctrinal implication:** the backfill must distinguish *re-ingest of one iteration*
(collapse to one row) from *a genuine later iteration* (keep as a sequential, non-overlapping
history row). The discriminator that works on this data: rows sharing
`(property_id, listing_date)` or contiguous daily `listing_date`s with the same source/broker
are the same iteration; a materially later `listing_date` after the prior closed is a new
iteration.

---

## 2. PHASE 2 — WRITERS, LIFECYCLE INFRA, AND CONSUMER BLAST RADIUS

### 2.1 Writers to `available_listings`

| # | Writer | Domain | Action | Prior-row handling | Gap |
|---|---|---|---|---|---|
| W1 | `sidebar-pipeline.js::upsertDialysisListings` (~api/_handlers/sidebar-pipeline.js:9051) | dia | INSERT new, or PATCH the in-window active | 90-day dedup window: PATCH active row if `listing_date ≥ today−90d`, else INSERT a new campaign row; >90d rows left intact | Correct-by-design; relies on the unique index to prevent two simultaneous actives |
| W2 | `intake-promoter.js::promoteDiaPropertyFromOm` | dia | INSERT | **No prior-row handling documented — appears unconditional INSERT** | Would create dup actives if not for the dia unique index catching it; **gov has no such index → this is where gov dups are born** |
| W3 | `sidebar-pipeline.js::upsertGovListings` (~:9522) | gov | PATCH in-window active, else UPSERT `on_conflict=(property_id,listing_source,listing_status,listing_date)` | Pre-checks for an active row per (property+source) to PATCH | **Conflict key includes `listing_date` → daily re-ingest with a new date bypasses the conflict and INSERTs a new active row (property 16350).** No cross-source reconcile. |
| W4 | OM intake promoter (gov path) → `available_listings` | gov | INSERT (`listing_source='lcc_intake_om'`) | none | **Primary source of the 143 `lcc_intake_om` excess rows** |
| W5 | `lcc_record_listing_check()` RPC (dia + gov variants) | both | UPDATE single row + history | single `listing_id` only | Correct; but availability-checker never writes `sold` (records `off_market`/`unverified_assumed_off`) → the 12 gov phantoms |
| W6 | `fn_listing_close_if_sold()` trigger | **dia only** | `BEFORE INSERT/UPDATE` → `status='Sold'`, `is_active=false`, link sale | applies to every incoming row | **Missing on gov** → gov's 11 close-on-sale gaps |
| W7 | Crons: `lcc-availability-checker` (:30), `lcc-auto-scrape-listings` (:00), `lcc-availability-promotion-sweep` (:45) | both | via W5 RPC | per-row | The sold-path deferral is deliberate; promotion sweep only covers `off_market_date` within 90d |

### 2.2 Existing lifecycle infrastructure (and the gaps)

**Indexes / constraints actually on the tables today:**

- **dia:**
  - ✅ `available_listings_one_active_per_property` — `UNIQUE (property_id) WHERE is_active IS TRUE AND property_id IS NOT NULL` → **the recurrence guard already exists.**
  - ✅ `trg_listing_close_if_sold` (`BEFORE INSERT/UPDATE OF listing_date,is_active,status,property_id`).
  - Cap-rate, broker-id sync, verification-due, off_market_reason CHECK.
  - ❌ No constraint preventing `off_market_date` set while `is_active=true` (the 47 contradictions).
- **gov:**
  - ❌ **No one-active-per-property index.** Only `(property_id, listing_source, listing_status, listing_date)` partial unique (too granular — see W3) and `(source_listing_ref, listing_source)`.
  - ❌ **No close-on-sale trigger.**
  - ✅ `trg_gov_tag_offuniverse_listing`, cap-rate snapshot, verification-due, off_market_reason CHECK, `exclude_from_*` flags + indexes.
  - ❌ No constraint preventing `off_market_date` set while `is_active=true` (the 15 contradictions).

`lcc_record_listing_check` transition map (both DBs): `still_available→re_listed` (if was
inactive) · `price_changed` · `off_market→withdrawn` · `sold→sold` · `inferred_active→`(no
transition, timer only). The availability-checker **never** emits `sold`; it emits
`off_market` + `off_market_reason='unverified_assumed_off'`, leaving the sale-match promotion
to `lcc-availability-promotion-sweep` or a human.

### 2.3 Consumers — blast radius of collapsing to one-active-per-property

**SAFE (count `DISTINCT property` or read per-property context):**
- ✅ **R76 / Capital-Markets views** — `cm_gov_market_turnover_m`, `cm_gov_inventory_backlog_m`
  (`count(DISTINCT property_id)`), `cm_dialysis_market_turnover_m` (logic-dedups + excludes
  synthetics). These are the DISTINCT safety net and are unaffected by the dedup.
- ✅ LCC app UI (`dialysis.js`, `gov.js`) — reads listings per-property for detail/comps,
  not a global active count.
- ✅ Lead promoter / BD listing-events, broker aggregates (`DISTINCT broker_id`), availability
  checker queue selection (per-listing), promotion sweep (deed match).

**AFFECTED (raw-row counts will drop when duplicates collapse — expected and correct):**
- ⚠️ `government-lease/src/db_audit.py` — `count_all("available_listings")` global raw count.
- ⚠️ `government-lease/src/gap_analysis.py` — `active_listing_lease_gap` raw filter count.
- ⚠️ `government-lease/src/govbot.py` — hardcoded "~115 active inventory" reference text.
- ⚠️ dia migration `20260428020000_dia_listing_cleanup_round_76ag.sql` before/after audit
  deltas (one-time, harmless).
- `v_available_listings` (dia) returns raw rows; any consumer that *counts* its rows would
  change — none currently do a headline count.

**Net:** no CM chart, app metric, or BD process changes value from the dedup. Only three
gov diagnostic/raw-count call-sites and one piece of govbot prose need a `DISTINCT property`
tweak (folded into the writer-fix PR, not the data backfill).

---

## 3. PHASE 3 — DOCTRINE + GATED REMEDIATION PLAN (proposed; NO writes yet)

### 3.1 Canonical lifecycle state machine

One **active iteration = one row.** Per property, the active set is size ≤ 1 at every instant.

```
            (new OM / capture, no open iteration)
                         │  INSERT  is_active=true, listing_status/status='active',
                         ▼          listing_date set, off_market_date NULL
                    ┌─────────┐
       price/seen   │ ACTIVE  │  re-ingest of the SAME iteration → PATCH this row
       ───────────▶│ (≤1/prop)│     (never a new active row)
                    └────┬────┘
        sale recorded    │   new broker/source genuine re-list (prior still open)
        on property      │            │
        ▼                ▼            ▼
   ┌────────┐      ┌──────────┐   prior row → SUPERSEDED (off_market_date = new listing_date,
   │  SOLD  │      │ WITHDRAWN│   off_market_reason='duplicate'/'superseded', is_active=false);
   │is_active│     │ /OFF_MKT │   new row becomes the single ACTIVE
   │ =false │      │is_active │
   │offmkt= │      │ =false   │   stale (>N days unseen) ─▶ WITHDRAWN
   │sale_dt │      └──────────┘   (off_market_reason='unverified_assumed_off')
   └────────┘
```

**Invariants (to be enforced by constraint/trigger):**
1. **At most one `is_active=true` row per `property_id`** (gov: + `exclude_from_market_metrics=false`).
2. A row may **not** have `off_market_date IS NOT NULL` while `is_active=true` (and vice-versa
   for a terminal status).
3. A row's on-market window `[listing_date, off_market_date]` must be **non-empty and
   forward** (`off_market_date >= listing_date`); a terminal row must have a `listing_date`
   *or* be flagged window-less (sale-derived history).
4. Active windows for one property must be **non-overlapping** across rows (sequential
   history only).
5. A recorded sale on a property closes any open listing as of `sale_date`.

### 3.2 Backfill plan (one-time, idempotent, provenance-tagged — NEVER hard-delete)

Every state change writes `notes`/`off_market_reason` provenance and (where wired) a
`field_provenance` row tagged `source='listing_lifecycle_backfill_2026_06_11'`. Order matters.

**gov (live snapshot fix):**

| Step | What | Rows | Before → After |
|---|---|---|---|
| G1 | **Collapse re-ingest duplicates.** Per dup property, keep the most-authoritative active row (newest `listing_date`, tie-break source rank `costar_sidebar>crexi>salesforce_ascendix>lcc_intake_om`, then newest `first_seen_at`); set the other 229 → `is_active=false`, `listing_status='superseded'`, `off_market_date=keeper.listing_date`, `off_market_reason='duplicate'`. | 229 → superseded; 116 keepers | 116 props with 2-12 actives → 116 props with 1 active each |
| G2 | **Close-on-sale.** The 11 open listings whose property has a sale ≥ listing start → `is_active=false`, `listing_status='sold'`, `off_market_date=sale_date`, link `sale_transaction_id`. | 11 | 11 gaps → 0 |
| G3 | **Phantom repair.** The 12 `unverified_assumed_off` rows with NULL `listing_date` + `off_market_date` → backfill `listing_date` from `first_seen_at::date` if present, else clear `off_market_date` and re-queue for verification (`verification_due_at=now()`). No backward windows remain. | 12 | 12 phantoms → 0 |
| G4 | **Stale opens.** 41 active rows unseen >90d → `is_active=false`, `listing_status='withdrawn'`, `off_market_reason='unverified_assumed_off'`, `off_market_date=last_seen_at::date`. (Promotion sweep can later upgrade to sold on a deed match.) | 41 | 41 stale → 0 |

After G1–G4, re-run the audit: gov active set must equal `count(DISTINCT property_id)` and 0
overlaps. Expected gov active ≈ 818 − 229(G1) − 11(G2) − 41(G4) ≈ **537 clean actives**
(exact number recomputed at apply time; G2/G4 may overlap G1 keepers).

**dia (historical window repair):**

| Step | What | Rows | Effect |
|---|---|---|---|
| D1 | **End superseded windows.** For each `Superseded` row, set `off_market_date = min(its supersession date, the next iteration's listing_date)` where currently it inherits an inflated `last_seen`. Use the earliest later row's `listing_date` on the same property as the window end. | ~668 superseded (211 in same-day exact-dup groups) | Removes the 247 real point-in-time overlaps |
| D2 | **Collapse same-(property,listing_date) exact dups.** 112 groups / 211 redundant rows → keep one, mark the rest `Superseded` with `off_market_date=listing_date` (zero-length window) + `off_market_reason='duplicate'`. | 211 | The 15-on-one-day pattern stops contributing overlaps |
| D3 | **Normalize `status` vocabulary + fix the 9 desync rows** so `is_active` and `status` agree and case-variants collapse (`Active`→`active`, etc.). | 9 desync + ~2,800 case-variant | Consumers can trust either signal |
| D4 | **Resolve the 47 `off_market_date`-set-but-active contradictions** (invariant 2): if a terminal status, set `is_active=false`; else clear the stray `off_market_date`. | 47 | Invariant 2 holds |

dia active snapshot is already 1:1, so D1–D4 change **no** active counts — they only repair
historical windows so the R76 point-in-time reconstruction stops seeing overlaps.

### 3.3 Writer fixes (enforce at write time)

1. **gov: add `fn_gov_listing_close_if_sold` trigger** mirroring dia's `fn_listing_close_if_sold`
   (`BEFORE INSERT/UPDATE OF listing_date,is_active,listing_status,property_id`).
2. **gov: replace the upsert conflict key.** Stop keying inserts on
   `(property_id,listing_source,listing_status,listing_date)`. New write contract in
   `upsertGovListings` / the gov OM promoter: **find the open active row for the property
   first** (regardless of source/date); if found, PATCH it (update price/broker/seen,
   supersede-and-replace only on a genuinely new iteration); only INSERT when no open active
   exists. This stops the daily-re-ingest row explosion at the source.
3. **dia: `promoteDiaPropertyFromOm` must check for an open active row** before INSERT (today
   it relies on the unique index throwing). Make it PATCH-or-supersede explicitly so it never
   depends on a constraint violation for correctness.
4. **Both: on re-list (new broker/source while prior open), supersede the prior** —
   `off_market_date=new.listing_date`, `off_market_reason='superseded'`, `is_active=false` —
   inside the same transaction as the new INSERT.
5. **Availability-checker: stop the future/over-stamp** — never write `off_market_date` to a
   row with NULL `listing_date` without first setting `listing_date=first_seen`; never stamp a
   date `> CURRENT_DATE` (add the constraint below).

### 3.4 Recurrence guards (so simultaneous-active can't re-accumulate)

- **gov: add the partial unique index dia already has:**
  ```sql
  CREATE UNIQUE INDEX available_listings_one_active_per_property
    ON public.available_listings (property_id)
    WHERE is_active IS TRUE AND property_id IS NOT NULL
      AND COALESCE(exclude_from_market_metrics,false) = false;
  ```
  (Apply **only after** G1–G4 collapse the dups, or the index creation fails.)
- **Both: add CHECK invariants:**
  ```sql
  -- no backward/future off_market window
  ALTER TABLE available_listings ADD CONSTRAINT al_offmkt_not_future
    CHECK (off_market_date IS NULL OR off_market_date <= CURRENT_DATE + 1);   -- +1d clock skew
  -- active ⇒ no off_market_date  (enforced via trigger, not CHECK, since both columns mutate)
  ```
  The active⇄off_market mutual exclusion is best enforced in the existing `BEFORE` trigger
  (set `off_market_date=NULL` when `is_active` flips true; require it when a terminal status
  is set), to avoid CHECK ordering hazards during multi-column updates.
- **Keep the R76 `DISTINCT property` safety net in the CM views until** the backfill is
  applied AND the guards are live AND a re-audit shows 0 overlaps on both DBs. Only then
  consider simplifying the views.

### 3.5 Per-change before/after summary (the gate sheet)

| Change | DB | Rows touched | Active count before → after | Reversible? |
|---|---|---|---|---|
| G1 collapse re-ingest dups | gov | 229 superseded | 818 → ~589-...  | Yes (status/flags only; rows retained) |
| G2 close-on-sale | gov | 11 | −11 active | Yes |
| G3 phantom repair | gov | 12 | 0 active Δ | Yes |
| G4 stale opens | gov | 41 | −41 active | Yes |
| D1 end superseded windows | dia | ~668 | 0 active Δ | Yes |
| D2 collapse same-day dups | dia | 211 | 0 active Δ | Yes |
| D3 status normalize + desync | dia | ~2,800 | 0 active Δ | Yes |
| D4 active/off_market contradictions | dia | 47 | ≤−47 active | Yes |
| Writer fixes (triggers/upsert) | both | code + DDL | n/a | Yes |
| Recurrence guards (indexes/checks) | both | DDL | n/a | Yes |

**Blast-radius confirmation:** every CM/R76 chart and app metric reads `DISTINCT property` or
per-property context and is unchanged; only gov `db_audit.py` / `gap_analysis.py` raw counts
and one govbot string move (folded into the writer-fix change), and they move to the *correct*
deduplicated value.

---

## 4. GATE — what must be independently verified before ANY write

1. The "keeper" selection rule in G1/D2 (which row survives) matches Scott's authority
   ranking — confirm source rank and tie-breaks on a sample of the 116 gov / 112 dia groups.
2. The genuine-re-list vs re-ingest discriminator (same `(property,listing_date)`/contiguous
   days/same source = same iteration; materially later date = new iteration) does not collapse
   a real sequential campaign (spot-check dia 28749's 2021/2023/2025 iterations stay as 3
   non-overlapping history rows).
3. G2's close-on-sale window (sale ≥ listing start − 30d) does not close a listing that
   *post-dates* an old sale (re-list after a prior sale is legitimate) — verify the 11 gov
   candidates individually.
4. The gov one-active unique index and the active⇄off_market trigger pass a dry-run against
   the post-backfill snapshot with zero violations.
5. Re-audit both DBs post-plan shows: gov active = `DISTINCT property`, 0 overlaps; dia 0
   point-in-time overlaps; 0 close-on-sale gaps; 0 phantoms; 0 stale opens.

**No remediation SQL is applied until items 1–5 are signed off.**

---

### Appendix — exact audit queries
The read-only queries that produced every number above are reproducible against
`zqzrriwuavgrquhisnoa` (dia) and `scknotsqkcheojiaewwh` (gov); see the session transcript for
the verbatim SQL. All counts captured 2026-06-11.
