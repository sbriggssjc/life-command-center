# Claude Code prompt — honest dateless reason + investigate the San Jose cross-operator match (HOLD the drain)

> The live gate diagnosed the `enrich_create_failed:400` head blockers to root cause. The
> 400 itself is BENIGN and correctly handled — but it surfaced a **match-quality question
> that must be answered before the full drain resumes**. Receipts-first; the queue is
> self-unblocking (deterministic terminal mark), so nothing is stuck — but DO NOT drain
> the corpus until Unit 2 reports back.

## What the gate found (live, from Postgres logs + DB)
- `POST /api/lease-backfill` classified ids **5171** & **5175**
  (`/PROPERTIES/D/DaVita/San Jose, CA/San Jose Due Diligence File/…Fully Executed - 7-27-15.pdf`)
  as `enrich_create_rejected`, reason `create_failed:400:23514`, **text_len 120000**
  (full born-digital leases — NOT scanned).
- Postgres log at the exact drain time, twice:
  `dia_reject_dateless_active_lease: refusing to write active lease with both dates NULL
  (property_id=30680, tenant=Total Renal Care, Inc.)`.
- So the real cause is the **`dia_reject_dateless_active_lease` trigger**, not a generic
  CHECK: the extractor produced tenant + rent but **both `lease_start` and
  `lease_expiration` NULL**, and the create tried a dateless ACTIVE lease. This is
  expected for a base lease — the commencement/expiration date is set by a separate
  **Commencement Date Memorandum** (id **5188**, same folder). The reject is CORRECT
  (don't create empty-shell dateless leases). Deterministic terminal-defer is the right
  outcome.
- **The real flag:** property **30680 = `1221 S Capitol Ave, San Jose CA`, stored
  tenant `SHC BLOSSOM VALLEY`** (almost certainly **Satellite Healthcare — a DIFFERENT
  dialysis operator**), `0` existing leases. It is NOT in the San Jose DaVita property
  set (22693, 29975, 29981, 30012, 30076, 30077, 30088, 30096, 30103, 30681). Yet both
  DaVita base-lease docs matched it and the extractor wrote DaVita/"Total Renal Care" as
  tenant. The dateless reject ACCIDENTALLY prevented a cross-operator mis-enrichment
  (DaVita lease onto a Satellite clinic — same class as the Hertz/40041 contamination).

## Unit 1 — honest reason labeling (small, ship anytime)
`describeLeaseCreateError` reports `400:23514` for a trigger-raised rejection. Surface the
real cause so the deferred tail is queryable and honest:
- Detect the `dia_reject_dateless_active_lease` rejection (the trigger message / its
  SQLSTATE) and emit a specific reason, e.g. `create_rejected:dateless_active_lease`,
  carried onto the `folder_feed_seen` marker. Keep the generic SQLSTATE fallback for
  anything else. This is labeling only — the deterministic `enrich_create_rejected`
  outcome (terminal, no retry) is already correct and stays.
- Net: the deferred tail distinguishes "base lease, dates in a memorandum" from "bad
  data" at a glance.

## Unit 2 — the match basis (THIS gates the drain; read-only investigation)
Report, for 5171 & 5175 → property 30680, the EXACT match evidence the matcher used:
- the **address the extractor pulled from each lease**, and
- the **match basis / score** (address-canonical match like the Conyers
  `in_file_address_canonical_address` 0.97, vs city/tenant proximity, vs fallback), and
- whether the matcher required/checked **operator-tenant agreement** between the doc and
  the candidate property.

Two outcomes, very different:
1. **Mis-match** — the matcher matched a DaVita doc to a Satellite (`SHC`) property by
   weak signal (city proximity, fuzzy address). Then base-lease matching has a real
   cross-operator hole: a base lease that DOES carry dates would write straight through
   onto the wrong operator's property. Propose the guard (below).
2. **Stale label** — the lease's extracted address genuinely IS `1221 S Capitol Ave` and
   30680 is really the DaVita property, just mislabeled `SHC BLOSSOM VALLEY`. Then the
   match is fine and the property tenant label is the data-quality item (route to the
   Decision Center / mis-ingestion review), not a matcher bug.

Bring the evidence to me BEFORE changing match logic — I'll confirm which case it is.

## Unit 3 — IF Unit 2 shows a mis-match: the operator-agreement guard (gated, after my OK)
Mirror the `/Multi/` guard philosophy — protect enrichment correctness at the match
boundary:
- For a domain (dia/gov) lease enrich, require **operator/tenant-family agreement**
  between the doc's extracted tenant and the candidate property's operator/tenant (using
  the existing `lcc_operator_affiliate_patterns` canonicalization — DaVita ≠ Satellite ≠
  Fresenius). On disagreement, do NOT enrich/create — route to `match_disambiguation`
  (the existing lane), never write a cross-operator lease.
- This is the same doctrine as the multi-tenant gate: a confident-but-wrong match is
  worse than no match. Add tests; no fork.

## Guardrails
- Receipts-first; Unit 2 is read-only and gates the drain. No match-logic change until I
  confirm mis-match vs stale-label. ≤12 api/*.js; reuse the matcher + the affiliate
  canonicalization; don't fork.
- Don't touch the cleaned records (dia 25312/19530/14365; canonical `guaranteed_by`
  edges; superseded provenance 1403859/1406606/1406607).
- The full lease backfill stays HELD until Unit 2 reports and (if needed) Unit 3 lands +
  is gate-verified.
