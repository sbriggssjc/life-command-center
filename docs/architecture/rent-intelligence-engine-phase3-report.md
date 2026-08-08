# Rent Intelligence Engine — Phase 3 Report (Reconciliation loop + intake hooks)

**DB:** dia `zqzrriwuavgrquhisnoa` · **Repo:** life-command-center ·
**Branch:** `claude/rent-intelligence-discovery-t7t0ey` · **Date:** 2026-08-08

> **GATE:** Report-back before Phase 4 (serving). Reconciliation + hooks applied live; acceptance
> replayed and cleaned up (0 residue).

## 1. Reconciliation loop — `dia_reconcile_rent_evidence()`

Single SQL writer of the timeline + `rent_reconcile_queue`. On new evidence: **unit-normalize →
[5,200] PSF sanity gate → diff stated vs modeled curve at the evidence date**:

- **within tolerance (5%) → corroborate:** raise confidence on surrounding projected years
  (`+0.10`, capped 0.95) + record corroboration in `provenance`. **No fork.**
- **outside → classify BEFORE forking:** `rba_change` (p_new_rba differs >5%) → `early_extension`
  (new expiry) → `renegotiation` (documented/high-confidence source) → `bad_data` (inferred/low) →
  else `conflict_unclassified`. Classifiable structural changes **fork a new version** (via the
  builder — supersedes v1, never overwrites); `bad_data`/`unclassified` → **queue only, no fork**.

Migration: `20260808_dia_rent_intelligence_phase3_reconcile.sql` (applied live).

## 2. Intake wiring (single writer per source, non-blocking)

Shared hook `api/_shared/rent-reconcile-hook.js` (`reconcileRentEvidence` + `reconcileLatestEvidence`)
delegates to the SQL function. **Non-blocking contract:** every call is wrapped; a reconciliation
failure never fails the parent ingest — it logs and swallows.

| Source path | Hook site | Covers |
|---|---|---|
| CoStar capture (sale + OM + listing) | `sidebar-pipeline.js` Step 5g2 (after recalc) | sales_ingest / om_intake / listing capture |
| OM finalize / lease load / manual anchor | `apply-change.js` (chained after cap-rate recalc, `target_source='dia'`) | om_intake / lease_load |
| Listing price refresh (T9d) | *not hooked — deliberately* | price-only refresh restates no rent, so it is not a rent-evidence source |

The hook reads the freshest evidence (confirmed anchor OR latest non-projected sale) and reconciles
the newest dated point. Conflicts/forks surface a Teams card via the existing `sendTeamsAlert`
pipeline (deep link `#/dia?d=prop:dia:<id>:Rent`, evidence-pair facts, review/open action).
Corroborations are silent (not actionable).

## 3. Acceptance replay (synthetic clone of #22023, cleaned up — 0 residue)

Faithful clone (DaVita 2011, $207,936, 10,300 SF) built to v1 (31 rows), then three evidence events
through the hook:

| injection | input | verdict | result |
|---|---|---|---|
| matching resale | $230k @2018 (within 5% of modeled $228,730) | **corroborated** | no fork; 2017-2019 projected conf 0.70→**0.80** + provenance `corroborated_by` |
| expansion OM | $307,500 @2022, **+2,000 SF** (10,300→12,300) | **rba_change** | **v2 forked** (2022 now rba 12,300 / $307,500 / contract); **v1 preserved** (superseded, 31 rows) |
| unit-scale garbage | $9,999,999 @2019 (psf 970) | **bad_data** | queued (`sanity_gate`), **no fork**, parent ingest unaffected |

All three behaved exactly as specified. v1 fully preserved on the fork; garbage never touched the
curve.

## 4. Hook latency added to each intake path (server-side)

| path | added latency |
|---|---|
| corroborate | **6.5 ms** |
| bad_data (sanity-gate reject) | **0.5 ms** |
| fork + rebuild (30-yr curve) | **15.7 ms** |

Plus one PostgREST round-trip from the JS hook (~50–150 ms), all **off the response path**
(fire-and-forget / chained-after-recalc). No measurable impact on the parent ingest's response.

## 5. Notes / boundaries

- **Single writer:** the SQL function is the only path that writes forks/corroborations; JS hooks
  only invoke it. Consistent with LCC single-writer conventions.
- **RPC reach:** hooks call `rpc/dia_reconcile_rent_evidence` via `domainQuery` (service key, direct
  PostgREST) — **not** the `data-query` edge allowlist, so no edge redeploy needed.
- **Reversible:** forks preserve prior versions (`superseded_at`); queue rows are never hard-deleted.
- **Tests:** apply-change + sidebar suites green; hook modules syntax-clean.

*Awaiting review before Phase 4 (serving: basis-aware cm variants with the conf≥0.7 + non-convention
gate, `get_property_rent_timeline` MCP tool, portfolio coverage stats — which now include the 6,098
no-intercept shells as the research-backlog metric).*
