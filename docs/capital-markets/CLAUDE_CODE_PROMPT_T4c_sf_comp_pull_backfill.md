# Claude Code prompt — T4c recovery: full Comp__c pull → on-market-date backfill (dia + gov)

> Item 1 (provenance columns + held predicate) is LIVE on all 3 DBs and merged (PR #1327). This is the
> RECOVERY step: fill the held rows' real on-market date from Salesforce `Comp__c.On_Market_Date__c`,
> keyed by `seed_data.sf_entity_id`. **Correction from the gate:** `sf_sync_log` is NOT a sufficient
> source by itself — it prunes to a rolling ~30-day window. Pull the full comp set first, then backfill.
> Runs server-side where the SF OAuth lives. dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`,
> intake + sync on LCC Opps `xengecqvemvfknjvbvrq`. Reversible throughout; never touch curated data.

## Receipts (grounded 2026-06-24)
- **The date is `Comp__c.On_Market_Date__c`**, real and spread (verified in `sf_sync_log.payload`: dates
  2014-10 → 2026-06, **96.9% pre-June** — not June-clustered). Payload is top-level: `->>'Id'` = comp id
  (= `sf_entity_id`), `->>'On_Market_Date__c'` = the date.
- **`sf_sync_log` alone is insufficient: 535 distinct comps (453 with OMD) vs the 941 needed = ~48%.**
  It prunes terminal `object_intake` rows to ~30 days, so older comps are gone. The "97%" figure was 97%
  *of what remains in the log*, not of the 941. → A full `Comp__c` pull is required.
- **941 comps need a date** (460 dia + 481 gov; 940 distinct, 1 shared). Key per intake =
  `staged_intake_items.raw_payload->'seed_data'->>'sf_entity_id'`.
- **Linkage (intake → available_listings row):** dia ~554/657 via `promotion_listing_id`; **gov ~232/901**
  — gov intakes carry only an artifact path, no `promotion_listing_id`. gov under-covers until that
  linkage is widened (see step 5).

## Step 1 — full `Comp__c` pull (durable; this also fixes recurrence)
Trigger / extend the existing **`intake-salesforce`** sync to pull the COMPLETE dia+gov `Comp__c` set —
`Id, On_Market_Date__c, CreatedDate` (+ whatever the sync already carries) — into a **retained** location
(a dedicated comp table, or a persistent sync slice that is NOT subject to the 30-day `sf_sync_log` prune),
so all 941 (and future comps) land and stay. Do NOT rely on the rolling `sf_sync_log` window. This runs
server-side under the existing SF OAuth — no manual CSV, no new SF data entry. Report how many of the 941
resolve a date after the pull (target ~97%, SF's real coverage).

## Step 2 — backfill the held rows (reversible, fill-the-held-set only)
For each held row (`on_market_date_source='unestablished'` / the artifact-clock-dated intake set) that
links to a comp with an `On_Market_Date__c`:
- Write the recovered date per the **committed Item-1 model** (the `on_market_date` field + source/
  confidence — keep consistent with what `bc54157` settled; if the backfill also corrects `listing_date`,
  log the prior value). `source='sf_on_market_date'`, high confidence. `CreatedDate` is a low-confidence
  fallback only if `On_Market_Date__c` is null.
- **NEVER touch `synthetic_from_sale` or `master_curated`** (intended history — keep their dates).
- Only affected rows; prior values logged; fully reversible.

## Step 3 — hold the genuine residual (no fabrication)
Comps with no `On_Market_Date__c` even after the full pull, or held rows with no comp link, stay
`unestablished` / held (excluded from the timing series). Never invent a date. Report the residual count.

## Step 4 — report for the gate
Per domain: comps resolved vs held; rows backfilled; the held residual; and the gov linkage shortfall
(the ~669 gov rows that don't yet link). Confirm dia ≈ its ~554 linkable rows now carry real dates.

## Step 5 — gov intake→listing linkage (flag; widen if cheap, else report)
gov's ~232/901 link rate is the real gov ceiling this round. If there's a safe deterministic key
(e.g. `seed_data.sf_entity_id` ↔ a gov `available_listings` column, or comp `Name`/`City__c` ↔ property
only where exact), widen it — but do NOT fuzzy-match address/tenant (vintage risk: a re-listing would
get the wrong date). If no safe key exists, report it as the gov coverage gap for a follow-up, leave the
unlinked gov rows held.

## NOT in this prompt (next gate)
The **Item-3 timing-view repoint** (point the dia+gov added/DOM/ramp views at `on_market_date`) is the
separate, gated step — it must preserve the `sold−196d` synthetic anchor and hold ONLY the artifact-dated
ACTIVE rows, to the **`dropped_pub = 0`** (published history ≤ 2026-03-31 byte-identical) gate. After this
backfill lands real dates, build that repoint and gate it; until then the recovered dates are stored but
the chart still reads `listing_date`.

## Gate (verify live)
- After the full pull, ~97% of the 941 comps resolve a date; dia held rows backfilled with real
  `On_Market_Date__c` (spread across real months, not June); residual + gov linkage gap reported.
- `synthetic_from_sale` / `master_curated` untouched; no curated value overwritten; every write reversible
  (prior values logged / drop the columns). Published history unchanged (this step writes provenance, not
  the timing views). ≤12 api/*.js. Suite green.

## Boundaries
Full Comp pull server-side under existing OAuth (no manual CSV, no new SF entry); fill-the-held-set only;
never touch synthetic/master/curated; no fuzzy address matching; hold the unrecoverable; reversible; the
timing-view repoint is the next gated step, not this one.
