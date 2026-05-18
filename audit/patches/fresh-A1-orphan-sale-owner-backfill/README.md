# Fresh audit A-1 — Orphan sale owner backfill

First action item from the fresh audit on 2026-05-18. Backfills the
most-recent orphan sale per property using the property's current
`recorded_owner_id`. 4,142 sales backlinked across both DBs in one shot.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/fresh-A1-orphan-sale-owner-backfill
node audit/patches/fresh-A1-orphan-sale-owner-backfill/apply.mjs --dry
node audit/patches/fresh-A1-orphan-sale-owner-backfill/apply.mjs --apply
git add -A
git commit -F audit/patches/fresh-A1-orphan-sale-owner-backfill/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/fresh-A1-orphan-sale-owner-backfill -m "Merge audit/fresh-A1-orphan-sale-owner-backfill: 4,142 orphan sales backfilled"
git push origin main
```

Both SQL UPDATEs are **already applied** to dia + gov via MCP. This patch
only commits the `.sql` files for repo provenance + appends the fresh
audit log to `AUDIT_PROGRESS.md`.

## Verified effect

| | Before | After | Closed |
|---|---:|---:|---:|
| Gov orphan_sale_owner NBA gaps | 2,373 | 1,029 | **−1,344** |
| Gov excellent-band subset | 799 | 385 | **−414** |
| Dia orphan_sale_owner NBA gaps | 283 | 31 | **−252** |
| Dia excellent-band subset | 37 | 5 | **−32** |
| **Total NBA gap reduction** | **2,656** | **1,060** | **−1,596** |

## Why not naively backfill all 7,887 orphans?

The 7,887 NULL-recorded-owner sales included 3,745 earlier sales (gov 3,399 + dia 346) where the buyer at sale-time was a different entity than today's recorded owner. A blind UPDATE would have mis-attributed historical transactions. The safety filter (`row_number() = 1` per property) restricts the backfill to the most-recent sale, which is the only one where the property's current owner is reliably the buyer.

The remaining 1,060 orphan_sale_owner NBA gaps fall into two buckets:
- Earlier sales that need `ownership_history` resolution (out of scope here).
- Sales on properties that don't have a `recorded_owner_id` yet (Item #3 Phase C territory — external enrichment pipeline).

## Fresh audit — full punch list

Captured in `AUDIT_PROGRESS.md`. Five findings, A-1 shipped, A-2 through A-5 queued:

- **A-1 ✅** — Orphan sale backfill (this patch)
- **A-2** — 269 `sales_transactions` 409 dedupe conflicts (24h)
- **A-3** — 579 unlabeled 400 errors (instrumentation gap)
- **A-4** — 54 `upsertDomainLoans:financing` 400 errors (24h)
- **A-5** — gov `agency_drift:agency_disagreement` review UI (807 cases, 204 excellent)

Plus the Phase C punch list (external enrichment, per-tab UI helper adoption, telemetry sweep, etc.) carried forward from the sprint.
