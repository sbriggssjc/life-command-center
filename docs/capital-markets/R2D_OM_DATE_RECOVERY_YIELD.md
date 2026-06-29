# R2-D — recover real on-market dates for the `date_uncertain` dia listings

**2026-06-29.** Phase-1 investigation (yield-before-write) + Phase-2 recovery +
Phase-3 forward-safe fix. dia `zqzrriwuavgrquhisnoa`, LCC Opps
`xengecqvemvfknjvbvrq`. Constructive, reversible, **no fabricated dates**.

---

## Headline premise correction (the source is Salesforce, not a forwarded email)

The prompt hypothesized the recoverable source was a **forwarded-email `Date:`
header** in the raw email body. **Grounding refuted this.** The ~512 dia
`on_market_date_source='date_uncertain'` listings are **Salesforce `Comp__c`
ingests**, NOT forwarded emails:

- The LCC `staged_intake_items` `seed_data` carries `sf_entity_id` (a `Comp__c`
  Id, prefix `a1Y`) + `source_content_version_id` (a SF ContentVersion). The
  `source_type='email'` is just the SF→LCC sync channel, not a real mailbox.
- Confirmed empty across all 324 intake-linked listings: `source_email_date`,
  `internet_message_id`, and any `body`/`subject`/`receivedDateTime`/`Date`
  key in `raw_payload`. **There is no forwarded-email `Date:` header to parse.**

The **one real recoverable source is `Comp__c.On_Market_Date__c`** — already
harvested into LCC Opps `lcc_sf_comp_on_market` (the T4c machinery), now holding
**1,196 comps with a real OMD** (span 2012–2026, last harvested 2026-06-29).

### Why T4c silently missed this set (two compounding gaps)

1. **Domain filter.** T4c's recovery view (`v_lcc_on_market_backfill_map`)
   filters `match_domain IN ('dialysis','government')`, but these intakes carry
   `extraction_result.match_domain='lcc'` (the domain lives in
   `seed_data.source_vertical='dia'`). So the T4c map **excluded the entire
   date_uncertain set**.
2. **Target-source filter.** T4c's apply (`lcc_apply_on_market_backfill`) is
   fill-`unestablished`-only, but T9d FIX moved these rows to `date_uncertain`.

R2-D closes both.

---

## Phase-1 yield (per source, BEFORE any write)

512 dia `date_uncertain` listings:

| Bucket | Listings | Recoverable now? | Source / disposition |
|---|---:|---|---|
| **Comp OMD harvested + consistent (OMD ≤ exit)** | **45** | **YES (applied)** | `Comp__c.On_Market_Date__c` (27 recent ≥ Sep-2025; 26 active) |
| Comp OMD harvested but re-listing (all candidates postdate the listing's exit) | 27 | No — surfaced | A 2026 OM re-listing was matched+**merged into an OLD already-sold row** of the same property; the comp date is real but belongs to the re-listing, not the sold row. Stays `date_uncertain` (honest). |
| SF-comp-linked, comp **not yet harvested** | ~276* | Gated on Scott | The `Comp__c` isn't in `lcc_sf_comp_on_market` yet → recoverable via the existing **`sf-record-lookup-tick`** worker on Scott's full Comp__c pull; flows through the same idempotent recovery. |
| **Not SF-comp-linked** | ~rest | No (not SF) | Old CoStar/master captures (181 with NULL `listing_date_source`, no LCC intake) — need platform DOM or are genuinely dateless. Stay `date_uncertain`. |

\* 276 = distinct dia listings (numeric id) carrying an SF-comp intake whose
comp has no harvested OMD; not all are currently `date_uncertain`, but they are
the SF-recoverable-pending universe.

Sources that **do not** apply / were ruled out:

- **Forwarded-email `Date:` header / `internet_message_id` / `source_email_date`** —
  do not exist (not emails). 0 recoverable.
- **OM PDF's own stated date** — artifacts are offloaded to Storage and the
  `extraction_result` carries no usable stated on-market date; re-reading
  hundreds of PDFs for an unreliable "flyer date" is low-yield and was NOT
  pursued (would risk fabricated dates).
- **Salesforce** — IS the source (see above); already wired via T4c's harvest.

---

## Phase-2 — recovery (reversible, guarded, applied live)

Migration `supabase/migrations/dialysis/20260629_dia_r2d_date_uncertain_recovery.sql`
(applied live to dia):

- **`lcc_apply_r2d_date_uncertain_recovery(p_rows jsonb, dry_run, batch_tag)`** —
  fill-`date_uncertain`-only. Per listing, picks the **latest candidate OMD that
  does not postdate `COALESCE(off_market_date, sold_date, today)`** (the
  re-listing guard); a listing whose every candidate postdates its exit is
  REJECTED. Never overwrites a non-`date_uncertain` source, never touches
  `listing_date`, never a future/fabricated date. Reversible via
  `r2d_date_uncertain_recovery_log`. Idempotent + re-runnable.
- **Recovered rows get `on_market_date_source='sf_on_market_date'`,
  `confidence='high'`** — the SAME real-evidence source as T4c, so the T9d
  currency model treats them identically (non-synthetic ⇒ on the time axis).

**Verified live (2026-06-29):**
- dry-run = real: matched **72**, applyable **45**, updated **45**, rejected
  (re-listing) **27**.
- `date_uncertain` 512 → **467** (−45). Backup log: 45 rows. Recovered span
  2016-12-15 … 2026-06-17; **27 recent (≥ 2025-09)**, 26 active.
- **0 impossible dates** (`new_on_market_date > exit_date` = 0 — the guard held).
- **Recent-inventory refill** (recovered listings now in the canonical active
  membership `cm_dialysis_active_listings_m`): 12 @ 2025-09-30, 22 @ 2025-12-31,
  **30 @ 2026-03-31** (of 221 distinct active properties). The recovered active
  listings repopulate the recent inventory + the 10+/core cohort for the
  recovered subset; the unrecoverable remainder stays honestly off-axis.

### Reverse a batch
```sql
UPDATE public.available_listings a
SET on_market_date = l.prior_on_market_date,
    on_market_date_source = l.prior_source,
    on_market_date_confidence = l.prior_confidence
FROM public.r2d_date_uncertain_recovery_log l
WHERE a.listing_id::text = l.listing_id
  AND l.batch_tag = 'r2d_recovery'
  AND a.on_market_date_source = 'sf_on_market_date';
```

### Re-run after Scott's full Comp__c pull (the ~276)
Reusable LCC view `v_lcc_date_uncertain_recovery_map`
(migration `supabase/migrations/20260629120000_lcc_r2d_date_uncertain_recovery_map.sql`,
applied live) resolves the domain from `source_vertical` (the bug T4c hit) and
emits the candidate payload:
```sql
-- On LCC Opps: build the payload
SELECT jsonb_agg(jsonb_build_object('listing_id', listing_id,
         'on_market_date', on_market_date, 'sf_comp_id', sf_comp_id))
FROM public.v_lcc_date_uncertain_recovery_map WHERE match_domain='dialysis';
-- On the dia DB: dry-run, then apply
SELECT * FROM public.lcc_apply_r2d_date_uncertain_recovery('<payload>'::jsonb, true);
SELECT * FROM public.lcc_apply_r2d_date_uncertain_recovery('<payload>'::jsonb, false);
```
Idempotent (fill-`date_uncertain`-only) — re-runs only date the newly-harvested
comps and never re-touch an already-recovered row.

---

## Phase-3 — forward-safe (the channel is SF-comp, not a forwarded email)

The literal "parse the forwarded `Date:` header" does not apply — there is no
forwarded email. The forward-safe equivalent for the **actual** channel: a NEW
SF-comp ingest should date itself from the comp's own `On_Market_Date__c`
instead of HOLDing as `date_uncertain` and relying on the post-hoc recovery.

`api/_handlers/intake-promoter.js` (`promoteListing` + both builders):
- `promoteListing` looks up the intake's `seed_data.sf_entity_id` →
  `lcc_sf_comp_on_market.on_market_date` and threads it to the builders.
- New `preferSfCompOnMarketDate(om, sfCompOnMarketDate)` helper: when the
  existing OM/lease/DOM/email ladder HOLDs, fall back to the comp OMD (tagged
  `sf_on_market_date`/high) **before** holding `date_uncertain`. Conservative —
  only fills the HOLD gap (never overrides a lease-inference / DOM / email
  date), never a future date. So the `capture_date_fallback` / upload-path surge
  can't re-form AND SF comps with a known OMD never need the backfill again.
- `source_email_date` capture for the genuine new-flow email path is unchanged.

Ships on the Railway redeploy of merged `main`. `node --check` clean; ≤ 12
api/*.js.

---

## Boundaries
Constructive recovery (no date invention); fill-`date_uncertain`-only;
reversible (backup log); re-listing guard (OMD ≤ exit); dia only (the 2 gov
candidates are out of scope this round); no `listing_date` touched; auth schema
untouched. The 27 re-listing rejects + the ~276 Scott-gated + the non-SF tail
are SURFACED, not silently dropped.
