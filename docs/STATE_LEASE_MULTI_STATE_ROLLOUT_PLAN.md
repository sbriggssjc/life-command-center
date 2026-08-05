# State-Lease Ingestion — Multi-State Rollout Plan

> **Status:** DRAFT (Cowork session 36, 2026-08-06) · TX complete; producer cadence decision open
> **Companion docs:** `docs/STATE_GOV_LEASE_GAP_MEMO_2026-06-23.md` (the origin story, Topics 1–3,
> closed for TX) · gov repo `docs/STATE_LEASE_INVENTORY_PIPELINE_PLAN.md` §9 (add-a-state recipe),
> §10 (Phase 2 automation) · ROLLOUT_STATUS W5.2 (the consumer).

## 1. Where this stands (grounded 2026-08-06)

**The TX engine is complete but its recurrence is MANUAL by design.** The 2026-06-23 session
built ingest (TFC xls) → `state_lease_snapshots` → `state_monthly_diff` → `state_lease_events`
→ `prospect_leads` (208 live) → R53 `suspected_sale` lane (92 live). The registry row
(`state_lease_sources.tx_tfc`, cadence 'monthly', active) records `last_run_at=2026-06-23`.
Only TWO snapshot dates exist (2023-07-01 baseline + 2026-06-01) — the "producer silent since
June 23" finding from the W5.2 grounding is NOT a broken scheduler; **no scheduler was ever
built.** Phase 2 (auto-pull) is the documented follow-up: `dataset_urls` sits empty pending a
browser recon of TFC's machine-readable URLs.

**W5.2 (2026-08-05) added the missing consumer discipline on top:** the `state-lease-consume`
tick (distress/movement events → tasks, digest counts for the rest) + a 45-day
producer-staleness alarm. That alarm WILL fire on the current state — correctly. The pipe is
sound; it needs feeding.

## 2. Producer cadence — the decision this plan needs from Scott

Two ways to feed the pipe; they compose:

- **(a) Manual folder-drop (works TODAY):** download the TFC Active Lease Summary Report,
  drop it in the state folder, run `python -m src.run_pipeline --steps 44 --state-source tx_tfc
  --state-dir "<…/state/Texas>"` (GovernmentProject repo; idempotent). ~monthly. Everything
  downstream — events, leads, suspected-sale lane, the new W5.2 consumer — flows automatically.
- **(b) Phase 2 automation (gov plan §10):** ✅ **RECON DONE (Cowork, 2026-08-06).** TFC's
  stable machine URL is `https://web.tfc.texas.gov/home/showpublisheddocument/12` — the
  versionless document endpoint serves the CURRENT Active Lease Summary xls directly (no
  auth, no JS; the versioned `/12/<stamp>` form changes per upload). Registered in
  `state_lease_sources.dataset_urls`. Remaining Phase-2 build: a monthly fetch of that URL →
  content_hash compare vs last snapshot (skip if unchanged — TFC may not repost monthly) →
  stage + run pipeline step 44 → the W5.2 consumer picks up new events on its next tick.
  Natural home: a gov-repo unit (fetch pre-step to `run_pipeline`), scheduled like the other
  recurring jobs. If auto-pull ever breaks, the W5.2 staleness alarm is the net.

**Recommendation:** do (a) once NOW (a fresh TFC report also back-fills the missing months and
gives W5.2 its first live consumption), and commission (b) as a small Claude Code/browser-recon
unit. The staleness alarm stays as the net under either.

## 3. The add-a-state recipe (already registry-driven — this is the leverage)

Per gov plan §9 + the Phase 3b design, a new state costs exactly:
1. A `state_lease_sources` row: source_code (`<st>_<agency>`), state, agency_name, home_url,
   format, cadence, `lease_key_prefix` (`'<AGY>-<ST>-'`), field_map.
2. A thin parser adapter (xls/csv/pdf → the snapshot columns; TX's is the template).
3. A first snapshot load (baseline) + second load (first diff → events).
Everything downstream is source-agnostic and REUSED with zero code changes: the diff engine,
`state_norm_lessor_core` (lessor churn vs genuine change), lead-gen, the registry-driven
`v_suspected_sale` state branch, and the W5.2 consumer + staleness alarm (they key on the
events table, not the source).

Also reused: the Topic-1 classifier fixes. NOTE — the sidebar `GOV_TENANT_PATTERNS` state
vocabulary was built from the TX agency roster; each new state's agency roster should be
diffed against the patterns at onboarding (same test harness: `test/gov-classifier-state.test.mjs`).

## 4. Rollout order (data-driven, from the live gov DB 2026-08-06)

Ranked by existing state-gov tracked footprint (where signals act on properties we already
know) blended with total market presence:

| Priority | State | State-gov props tracked | Total props | Notes |
|---|---|---:|---:|---|
| ✅ done | TX | 823 | 2,177 | TFC engine live; needs cadence decision (§2) |
| 1 | **LA** | 148 | — | Standout #2 footprint — 148 tracked state-gov props with zero signal feed |
| 2 | **CA** | 70 | 1,361 | Big footprint + big market; DGS publishes a statewide leased-facilities inventory |
| 3 | **FL** | 29 | 1,036 | Large market; DMS state-owned/leased facilities reporting |
| 4 | **GA** | 18 | 755 | SPC/GBA lease inventory; strong Team Briggs market |
| 5 | **WA / NC / AZ / TN** | 21/14/—/— | —/529/1,011/701 | Batch by source similarity once the adapter pattern is proven 2–3× |

Per-state source recon (find the LA/CA/FL/GA equivalent of the TFC report: URL, format,
cadence, machine-readability) happens AT ONBOARDING, exactly as TX did it — a short
browser-recon session per state, results recorded in the `state_lease_sources` row. Do not
pre-research all 50; the registry is the inventory.

## 5. Execution shape (proposed units)

- **U1 — TX refresh + cadence (operator + Cowork, ~1 session):** fresh TFC folder-drop run;
  check the TFC `Old/` folder for intermediate-month files (back-fills the 2023→2026 gap);
  decide (a)/(b) per §2; if (b): browser recon + populate dataset_urls + schedule.
- **U2 — LA onboarding (Cowork recon + Claude Code adapter, ~1–2 sessions):** find the LA
  Division of Administration lease inventory; registry row + adapter + baseline load; first
  diff after the second monthly load. Verify agency-roster vocabulary vs classifier.
- **U3 — CA, then FL, then GA:** same recipe; by U3 the adapter pattern should be a
  config-mostly exercise. Batch WA/NC/AZ/TN behind them.
- **Standing:** each onboarded state inherits the W5.2 consumer, staleness alarm, lead-gen,
  and suspected-sale lane for free (registry-driven). The W6.6 monthly audit should add a
  one-line "state sources: last_run_at ages" check.

## 6. Out of scope (documented, unchanged)

Rent-$ enrichment for lead ranking (TFC has no rent; gov plan §10 follow-up), finer-grained
TX history beyond the `Old/` folder check, and any LLM involvement in the signal gates
(doctrine: deterministic only).
