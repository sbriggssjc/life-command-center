# Backfill artifacts — SF-sourced party backfill (2026-07-30)

Deliverables + regeneration recipe for the correspondent → party backfill and its
Salesforce-contact-gap worklist. Full design lives in
`../contact-reconciliation.md`.

## Files
- `TeamBriggs_Salesforce_Contact_Gaps.xlsx` — the ranked "add to Salesforce"
  worklist (current = **v2**, behavioral classifier). Tabs: Summary · Add to
  Salesforce (215 business + 5 OVERLAP, overlaps floated to top in peach) ·
  Personal & Noise (63 + 11). Keyed on `correspondent_kind.party_kind`.
- `build_worklist_v2.py` — CURRENT builder. Reads `nomatch_kind.json`
  (`{email, touches, last_seen, party_kind, distinct_deal_subjects, category}`),
  splits business+overlap (actionable) from personal+noise (excluded).
- `build_worklist.py` — v1 (domain-heuristic only). Superseded; kept for history.

## Classifier (`correspondent_kind`)
The business/personal/overlap/noise verdict is computed in OPS by
`lcc_recompute_correspondent_kind()` → `correspondent_kind` table, from the
distinct-CRE-deal-thread signal (NOT domain). Overlap threshold =
`distinct_deal_subjects >= 3`. See `../contact-reconciliation.md` §"behavioral
party-kind classifier". Recompute after new correspondence ingest.

## Regenerate (authoritative source = the live OPS DB)
The data is NOT snapshotted here — it regenerates from the DB so it never goes
stale. In OPS (`xengecqvemvfknjvbvrq`):

1. `select lcc_recompute_correspondent_kind();` (refresh the classifier).
2. `json_agg` the `no_match` rows joined to `correspondent_kind` + the touch
   universe + domain→category CASE (query in `../contact-reconciliation.md`).
   Save as `nomatch_kind.json`.
3. `python3 build_worklist_v2.py` → `TeamBriggs_Salesforce_Contact_Gaps.xlsx`.
4. `python3 /mnt/skills/public/xlsx/scripts/recalc.py TeamBriggs_Salesforce_Contact_Gaps.xlsx`
   (computes the Summary SUMs; must report `total_errors: 0`).

## After Scott adds contacts to Salesforce
Delete their `correspondent_backfill_log` row (re-queues the email), redeploy is
not needed, then re-drain `POST /api/correspondent-party-backfill-tick` — the
newly-added SF contacts resolve and link to their full email history.
