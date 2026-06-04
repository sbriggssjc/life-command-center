# LCC Intake & Enrichment Audit — 2026-06-04

Round 3: the INPUT half of the system — where data enters (OM email, CoStar/RCA
sidebar, Copilot, iOS share), gets extracted, matched, promoted, and enriched
over time. Method: funnel forensics on LCC Opps staging + domain-DB cross-checks
+ engine pulse across all self-improvement crons.

## What's healthy (verified)

- **Email intake flows daily** — intakes arriving today; **411 finalized in the
  last 7 days**; extraction AI is solid (clean primary-provider runs, ~5-6s,
  PDF parse fine, no fallback needed in samples).
- **Sidebar channels are extremely active** — 78,039 `costar_sidebar` + 58,693
  `rca_sidebar` + 16,911 `salesforce` provenance-tracked writes in 7 days
  (latest: minutes ago). The field-provenance learning loop is alive, with
  auto-link engines (`auto_link_exact_singleton`, `auto_link_high_confidence`,
  `auto_link_orphan_property`) ticking hourly.
- **FL SOS engine produces daily** — 441 owners enriched + 109 contact links in
  the last 3 days.
- **Geocode coverage**: gov **89.4%**, dia **86.0%** — the backfill cron did its job.
- **OM promoter writes** — 7,978 `om_extraction` provenance writes in 7 days
  (matched OMs do flow through to domain DBs).

## The leak: 2,705 intakes in `review_required`, growing ~142/week

All-time email funnel: 1,071 finalized · 309 matched · 605 discarded · 68 failed ·
**2,705 review_required** (the dominant terminal state; discards stopped 5/24).
Recent review items decompose into four defect classes:

### F1 — Matcher misses layup matches  (HIGH — real deals leaking)
Sampled recent unmatched single-address dialysis OMs: **3 of 3 exist in the dia
DB** and failed purely on street normalization:
- OM "198 N Springfield Ave" ↔ DB "198 **North** Springfield **Avenue**" (prop 37106, the exact DaVita Rockford clinic)
- OM "1809 **West** Chapman Avenue" ↔ DB "1809 **W** Chapman Ave" (prop 30659, the exact FMC Orange clinic)
- OM "506 N Patterson St" ↔ DB "506 **North** Patterson St" (prop 25076, the exact US Renal Care Valdosta clinic)
Every miss strands a real OM (price/cap/lease/term data) in review instead of
attaching it to its property. The matcher needs directional/suffix normalization
(N↔North, Ave↔Avenue, W↔West, St↔Street…) — infra that already exists elsewhere
in the stack (normalized-address backfills, RapidFuzz in the python pipelines)
but evidently not in the intake matcher path.

### F2 — Multi-property OMs concatenate addresses  (MED)
Portfolio OMs produce a single address field containing a **JSON array string**
(`["1208 Scottsville Road", "350 Preakness Avenue"]`), a **pipe join**
(`…Road|350 Preakness…`), or a **semicolon join** — guaranteed unmatched. The
same OM appears in both formats across reruns. Needs split-and-match-per-property.

### F3 — Domain misrouting  (MED)
"Fresenius Medical Care - Jacksonville - FL - OM.pdf" (tenant Bio-Medical
Applications = Fresenius = dialysis) ran with `match_domain: "government"` —
guaranteed unmatch in the wrong DB. Tenant/filename say dia; routing disagreed.

### F4 — No create-from-intake workflow  (MED — the pile's terminal fate)
Genuinely-new properties (verified: USPS Minneapolis "5139 34th Ave S" is NOT in
gov) stage correctly but have **no path** from a valid extraction to a new
property+listing. Review purgatory grows ~142/week with no drain.

### Smaller findings
- **F5 — LLC research engine stalled outside FL**: gov 672 + dia 1,210 queued,
  **0 completed ever** on both. Known deferral (CA/TX adapters in future-todo),
  now quantified — the queue only grows.
- **F6 — iOS shares stranded**: 2 LinkedIn shares in `new` since May 6;
  staged + extracted, but no review/promote surface consumes `intake_share_inbox`.
- **F7 — Persisted summary drops city/state**: the AI extracts them (schema asks;
  mergedSnapshot carries them) but the stored `extraction_result` keeps only
  address/tenant/price/cap — hampers the review UI and forensics (every review
  row shows city NULL).

## Recommended fix order
1. **The matcher pass (F1+F2+F3+F7)** — normalize addresses in the intake
   matcher, split multi-address OMs, fix domain routing, persist city/state —
   **plus a retro re-match job over the 2,705** review items. This converts an
   unknown-but-real slice of purgatory into matched/finalized automatically and
   stops the leak going forward. Prompt: `CLAUDECODE_PROMPT_F1_intake_matcher.md`.
2. **Create-from-intake (F4)** — one-click (or guarded auto) property+listing
   creation from an unmatched-but-valid extraction, so the residual pile drains.
3. **F5/F6** — next-state SOS adapters (already on the future-todo) and a small
   share-inbox review surface.


## Addendum — F1-F3/F7 shipped (PR #1043, pending deploy + ordered cron)

Claude Code delivered the full matcher pass:
- `normalizeStreetAddress()` (new shared helper) — root cause confirmed: the
  pre-existing `normalizeAddress()` collapsed suffixes one-way and never handled
  directionals, which is exactly why the three layup pairs missed. New canonical
  tier narrows by state + house number, equality on normalized keys, city
  disambiguation.
- `splitMultiAddress()` (JSON-array strings, arrays, pipe/semicolon; parallel
  tenant pairing); extractor schema now emits `addresses[]` for portfolio OMs.
- Operator-keyword domain routing (incl. Bio-Medical Applications) + cross-domain
  fallback through the canonical tier.
- city/state persisted in the summary (was 0% before).
- `?_route=intake-rematch` worker (dry-run GET / drain POST, batch + cooldown,
  reuses `runDownstreamPipeline` so promotion is byte-identical) + pg_cron every
  30 min.

**Pre-verified recovery (SQL replication of the new normalizer): ≥334 of 440
dialysis-tenant review items (76%) auto-recover** — conservative lower bound;
gov subset + fuzzy/tenant/LCC tiers add more. 23 unit tests green incl. the
three real OM↔DB pairs.

**Deploy ordering:** merge → Railway redeploy (route live) → THEN cron migration
`20260604120000_lcc_intake_rematch_cron.sql` on LCC Opps. Post-deploy: dry-run,
drain, report actual `newly_matched`/`promoted` counts.
