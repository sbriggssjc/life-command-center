# Backfill artifacts — SF-sourced party backfill (2026-07-30)

Deliverables + regeneration recipe for the correspondent → party backfill and its
Salesforce-contact-gap worklist. Full design lives in
`../contact-reconciliation.md`.

## Files
- `TeamBriggs_Salesforce_Contact_Gaps.xlsx` — the ranked "add to Salesforce"
  worklist delivered to Scott 2026-07-30 (tabs: Summary · Add to Salesforce ·
  Personal & Noise). 217 actionable business contacts + 78 personal/automated,
  295 total (= every `no_match` in `correspondent_backfill_log` at that time).
- `build_worklist.py` — regenerates the workbook from a `nomatch.json` array of
  `{email, touches, last_seen, category}`.

## Regenerate (authoritative source = the live OPS DB)
The data is NOT snapshotted here — it regenerates from the DB so it never goes
stale. In OPS (`xengecqvemvfknjvbvrq`):

1. Run the classification query in `../contact-reconciliation.md` (§"Thread (c)")
   — a `json_agg` over `correspondent_backfill_log` (outcome=`no_match`) joined
   to the correspondent touch universe, with the domain→category CASE. It emits
   one JSON array.
2. Save that array as `nomatch.json` (assert `len == <no_match count>`).
3. `python3 build_worklist.py` → `TeamBriggs_Salesforce_Contact_Gaps.xlsx`.
4. `python3 /mnt/skills/public/xlsx/scripts/recalc.py TeamBriggs_Salesforce_Contact_Gaps.xlsx`
   (computes the Summary SUMs; must report `total_errors: 0`).

## After Scott adds contacts to Salesforce
Delete their `correspondent_backfill_log` row (re-queues the email), redeploy is
not needed, then re-drain `POST /api/correspondent-party-backfill-tick` — the
newly-added SF contacts resolve and link to their full email history.
