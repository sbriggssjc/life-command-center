# Prompt 31 — Data-integrity P2: property-record consolidation + multi-source sale reconciliation (NOT "delete repeat sales")

## Why the dups persist (investigated 2026-08-04, Dialysis_DB) — reframes the problem
Of the 610 "duplicate-property" live-sold groups (967 excess rows):
- **497 (81%) are >2 years apart -> GENUINE REPEAT SALES** (a property that legitimately sold twice over the
  years). These are NOT errors. The existing dedup (`dedup_natural_key` = normalized address|state|sale_date)
  correctly leaves them. **Do not delete/collapse repeat sales.**
- **0** are same-date multi-source (exact dups already caught).
- **93 buildings have >1 `property_id`** (same normalized address, different property record) — the resolver
  should have merged these and didn't. **This is the true property-level duplication.**
- **214 groups span >1 `data_source`** — some are the SAME sale ingested from CoStar + Salesforce + CMS at slightly
  different dates/prices (mis-dated near-dups), NOT repeat sales.
So the cleaning gap is **property-record consolidation + multi-source SAME-EVENT sale reconciliation**, not
deleting repeat sales. The workbook dup (Pembroke Pines twice, same date) is a property-record /
portfolio-allocation dup, not a repeat sale.

## Task (doctrine: dry-run first, backup table, conservative match, review lane, NEVER hard-delete, provenance-tagged, idempotent)
1. **Consolidate the 93 same-address/different-`property_id` buildings** into one canonical property via the
   record-linkage resolver (`gracious-radiance`) + the property-merge path (mirror `lcc_merge_entity` semantics:
   move sales/leases/listings/identities to the winner, keep a reversible backup + `batch_tag`). Only auto-merge
   the high-confidence band; route ambiguous to a review lane.
2. **Reconcile multi-source SAME-EVENT sales** (subset of the 214): where 2+ sale rows for one property have
   overlapping/near-equal price and buyer within a short window but different sources/dates, collapse to ONE
   canonical sale (best-sourced per `field_source_priority`), tag the others `superseded` (not deleted).
   Explicitly EXCLUDE genuine repeat sales (>~1yr apart, materially different price) — keep those distinct.
3. **Comp-pull selection unchanged for repeat sales:** the appraisal pull already selects most-recent-per-property
   (prompt 29) — verify it holds; a sale-history view can expose the rest on request.
4. **Prevent recurrence:** tighten the ingest-time linkage so a new sale/listing for an existing building attaches
   to the existing `property_id` instead of creating a 94th dup (the 93 shouldn't have formed).
5. Apply the same pattern to **gov** (the audit found analogous gov dup/coverage issues).

## Verify
- The 93 building-level dups resolve to one canonical `property_id` each (reversible; backup present); repeat
  sales still distinct; multi-source same-event sales collapse to one canonical + `superseded` tags.
- A dry-run report lists every proposed merge with confidence + evidence before any write; ambiguous -> review lane.
- Comp pulls show one row per property for appraisal; no fabricated merges.

## Ollama cleaning-agent — where it fits (and where it does NOT)
Bulk dedup/linkage (the 93 merges, multi-source reconciliation) is ENTITY RESOLUTION — the existing calibrated
resolver (Splink/Fellegi-Sunter + embeddings) is the right engine: fast, auditable, high-volume. **Do not make an
LLM the primary dedup engine.** Ollama adds value as an ASSIST layer, LLM-proposes/human-or-priority-confirms
(never automatic truth): (a) triage the resolver's **review-lane** (ambiguous merges) — read address/notes/OM text,
propose merge + reason, shrink the human queue; (b) **unstructured reconciliation** — link call notes / OM text /
emails that mention a property or sale to the right record; (c) narrate field conflicts. This runs continuously in
P4 via the existing `invokeExtractionAI` Ollama seam, across dia + gov + ops. Design it as a review-lane /
unstructured assistant on top of the resolver, surfaced on the Health surface.
