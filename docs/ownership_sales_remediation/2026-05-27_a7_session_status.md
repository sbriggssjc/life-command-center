# Ownership & Sales Remediation — 2026-05-27 Session Status (A7)

Picks up after PR #948 (C2 sales completeness, merged + deployed). Focus this round: **A7 — owner → Salesforce link backfill**.

## What landed this session

### Schema — per-domain `sf_link_research_queue`

Mirror of the existing `llc_research_queue` pattern. One row per `(source_table, source_id)`, with a `priority_score` generated column that puts owners with the largest portfolios at the front of the line.

```
sf_link_research_queue(
  queue_id uuid PK,
  source_table text CHECK ('recorded_owners' | 'true_owners'),
  source_id uuid,
  owner_name, canonical_name, state,
  property_count int,
  priority_score int GENERATED ('property_count * 10 + (true_owners ? 1 : 0)') STORED,
  status text CHECK ('queued'|'in_progress'|'linked'|'needs_review'|'no_match'|'failed'|'unsupported'),
  attempts int, last_attempted_at, resolved_at,
  sf_account_id_resolved text, sf_account_name_resolved text, score_resolved numeric(4,2),
  last_error text, created_at, updated_at,
  UNIQUE(source_table, source_id)
)
```

Index `idx_sf_link_queue_status_priority(status, priority_score DESC, created_at)` partial WHERE status IN ('queued','needs_review') for cheap worker pull.

### Queue seeded — 30,711 owners

| Domain | Source table | Queued | Max property_count |
|---|---|---:|---:|
| dia | `true_owners` | 3,106 | 2,498 |
| gov | `true_owners` | 12,472 | 25 |
| gov | `recorded_owners` | 15,133 | 78 |
| **Total** | — | **30,711** | — |

`dia.recorded_owners` is excluded — it has no SF column. SF linkage on dia routes through `true_owners.sf_company_id` (account-level) / `salesforce_id` (contact-level).

### Worker — `handleSfLinkTick` in `api/admin.js`

Sub-route `?_route=sf-link-tick` (also `/api/sf-link-tick` via vercel.json rewrite). Same shape as `handleLlcResearchTick`:

- GET = dry-run (returns the next N queue rows it would process)
- POST = apply (drains N rows)
- Domain param: `dia` | `gov` | `both` (default both)
- Limit 1-50, default 10
- Reuses the existing `_shared/salesforce.js::findSalesforceAccountByName` — Power Automate flow proxy that already does fuzzy scoring (1.00 exact, 0.85 substring, 0.50-0.80 jaccard)

**Outcome map per row:**

| `findSalesforceAccountByName` result | Worker action |
|---|---|
| `ok && account && score >= 0.90` | Auto-link: PATCH source row with `sf_account_id` (gov) or `sf_company_id` (dia.true_owners); queue row status='linked' with candidate metadata |
| `ok && account && 0.50 <= score < 0.90` | Queue row status='needs_review' with candidate stored — no source-table write |
| `ok && account === null` | status='no_match' (also captures best_candidate_score for visibility) |
| `!ok && reason='sf_not_configured'` | status='queued' — leaves it for a future tick after env lands |
| `!ok` (other) | status='failed' — attempts++ for retry |

PATCH targets:
- `gov.recorded_owners` → `sf_account_id` + `sf_last_synced`
- `gov.true_owners` → `sf_account_id` + `sf_last_synced`
- `dia.true_owners` → `sf_company_id` (matches existing `crossReferenceSalesforce` pattern)

### Triage view — `v_sf_link_review_queue`

Per-domain view surfacing `status='needs_review'` rows ordered by `priority_score DESC`. Carries the candidate `sf_account_id_resolved` + `sf_account_name_resolved` + `score_resolved` for a reviewer to approve or reject.

### Cron — `lcc-sf-link-tick`

LCC Opps, hourly at `:40`, drains both domains 25 rows/tick via `lcc_cron_post('/api/sf-link-tick?domain=both&limit=25', ...)`. With ~30,700 queued, 25/tick × 24 ticks/day = **600 lookups/day → ~51 days to drain on the conservative cadence**. Limit is tunable per-tick if PA flow can handle higher throughput.

The worker no-ops gracefully when `SF_LOOKUP_WEBHOOK_URL` env is missing — `handler_configured: false` in the response, queue rows stay `queued`.

## Live state at session end

| Table | Active | SF-linked before A7 | Coverage % | Queue |
|---|---:|---:|---:|---:|
| dia.true_owners | 3,783 | 676 | 17.9% | 3,106 |
| gov.true_owners | 12,894 | 421 | 3.3% | 12,472 |
| gov.recorded_owners | 15,359 | 226 | 1.5% | 15,133 |

Coverage will lift as the cron drains. Expected outcomes given the score distribution from prior fuzzy-name matches on similar corpora:
- ~40-60% of queued rows → `linked` (high-confidence exact / near-exact)
- ~15-25% → `needs_review` (analyst triage)
- ~25-40% → `no_match` (LLCs that simply don't exist as SF Accounts yet)

## Audit-log inventory (LCC Opps)

Three new entries this session:

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 25 | A7_dia_sf_link_queue_seed_2026_05_27_001 | dia | 3,106 |
| 26 | A7_gov_sf_link_queue_seed_2026_05_27_001 | gov | 27,605 |
| 27 | A7_infra_2026_05_27_001 | all | 0 (infra only) |

## Cron workers active after this round (14 total, ↑1)

Existing 13 from prior rounds plus new:
- `lcc-sf-link-tick` (LCC Opps, hourly :40) — drains the SF-link queues

## Migrations applied this round

| Project | Migration | Purpose |
|---|---|---|
| dia | `dia_sf_link_research_queue_a7` | Queue table + indexes |
| dia | `dia_v_sf_link_review_queue_a7` | Triage view |
| gov | `gov_sf_link_research_queue_a7` | Queue table + indexes |
| gov | `gov_v_sf_link_review_queue_a7` | Triage view |
| LCC Opps | `lcc_sf_link_tick_cron_a7` | Hourly cron |

JS/config changes:
- `api/admin.js` — `findSalesforceAccountByName` + `isSalesforceConfigured` imports; new `handleSfLinkTick` handler (218 lines); `sf-link-tick` route added
- `vercel.json` — `/api/sf-link-tick` rewrite added

## Plan status

- ✅ **DONE** (21, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, B1, B2, B4, B5, B7, A1, A2, A3, A4 (partial), A5, A6 (A6b only), **A7 (this round)**
- ⏳ **PARTIAL** (1): A6 — A6a still TODO
- ⬜ **TODO** (10, ↓1): C5, C7, C8, C9, B3, B6, B8, A4b, A8, A9

## What's needed for A7 to start ticking

The cron is registered and the queue is populated. The worker needs `SF_LOOKUP_WEBHOOK_URL` set in the Vercel env to make real lookups. Without it the cron runs at :40 every hour but exits immediately with `handler_configured: false` and `0 linked` — same defensive behavior as `llc-research-tick` runs without `OPENCORPORATES_API_KEY`.

A first verification once the env lands:
```
# Dry-run (no DB writes, no SF calls)
GET /api/sf-link-tick?domain=dia&limit=5

# Then apply
POST /api/sf-link-tick?domain=dia&limit=5
```

Expected response shape includes `handler_configured`, `linked`, `needs_review`, `no_match`, `failed` counters and per-row `items[]` with outcomes.

## Recommended priorities for next session

1. **A6a ownership_history chronological closure** — 1,111 dia rows; gates C5 EXCLUDE constraint. Now the natural next.
2. **B8 Data Health dashboard tile** — surface 30-day completeness trend + SF-link coverage in ops.js as A7 ramps.
3. **C8 RCM/LoopNet auth fix** — small Power Automate header tweak.
4. **C9 standard ingest contract** — long-term anti-regression mechanism.
