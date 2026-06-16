# Audit — dialysis-vertical parity (grounded live 2026-06-16)

**Question:** the recent rounds (county backfill, R23 archived-mirror, owner-facts, R26
portal links) were gov-specific. Does the dialysis vertical get the same connectivity /
value-ranked treatment, or is it underserved?

## Headline: dia parity is largely INTACT — better than first appearance
A naive cut (priority queue `source_domain='dia'`) shows only **37 dia rows** vs gov 448 —
alarming for a 12k-property book. But that's a tagging artifact: `source_domain` is only set
on **property-keyed** rows; **owner-entity** rows (P0.4/P0.5/P-CONTACT/P-BUYER/most P7) are
`source_domain=NULL` regardless of dia/gov origin. Measured by the entity's OWN domain
(`entities.domain`), dia's true footprint is **~547 rows**, on par with gov (~736):

| band | dia (by entity.domain) | gov |
|---|---|---|
| P0.4 resolve-ownership | **319** | 223 |
| P7 cadence | **125** | 124 |
| P0.5 | 63 | 11 |
| P5 aged-building | 19 | 27 |
| P-BUYER | 9 | 12 |
| P-CONTACT | 7 | 115 |
| P1 new-listing | 0 | 67 |
| P3 recent-sale | 1 | 61 |
| P2 | 0 | 26 |
| P8 SAM | 1 | 57 |

dia DATA is well-mirrored: `lcc_property_attributes` dia=12,278 (4,215 with rent),
owner_facts=12,278, portfolio_edges=1,725, **145 dia cadences**. So R8/R11's dia legs
landed — dia ownership-resolution and cadence parity are real.

## Real gaps (two)

### 1. Domain-filter undercount (visibility bug — affects both, perceived as a dia gap)
The priority-queue **domain filter** (operator console "Dialysis"/"Government" tabs, AND the
MCP `get_queue_summary` domain filter per R30) keys on **`source_domain`**, which is NULL on
all owner-entity rows. So filtering the queue by Dialysis shows ~37 of the true ~547 dia
rows (and Government hides its owner-level rows too). The operator's domain view drastically
undercounts owner-level work — the bulk of P0.4/P7/P-CONTACT. **Fix:** attribute each queue
row to `COALESCE(source_domain, entities.domain)` so domain filters reflect the true
footprint.

### 2. dia transactional triggers are sparse (assess — may be legitimate)
dia surfaces almost nothing in the TRANSACTION bands: P1 new-listing=0, P3 sale=1, P2=0,
because `lcc_listing_events` dia = **39 total** (vs gov's large set). Two possibilities:
(a) dia is a hold-heavy, low-turnover net-lease market — few real transactions, so sparse
triggers are correct; (b) dia listing/sale events aren't being captured into
`lcc_listing_events` as completely as gov. Worth a targeted check of dia
`available_listings` / `sales_transactions` → `lcc_listing_events` sync completeness before
concluding it's a wiring gap. dia P-CONTACT=7 vs gov 115 is likely legitimate (dia
"owners" are operators DaVita/Fresenius — few new contacts to chase).

### Not gaps (dia-specific by design)
P8 SAM solicitations (gov-only signal) and P-BUYER concentration (dia operators aren't
registered buyer parents, R8 doctrine) — correctly ~0 for dia.

## Recommended fix → CLAUDECODE_PROMPT_R31_queue_domain_attribution.md
Primary: coalesce queue-row domain attribution to the entity's domain so the operator's
Dialysis/Government filters (and MCP `get_queue_summary`) show the true ~547 dia / ~736 gov
footprint, not the ~37/~448 property-keyed slice. Secondary (assess-only): verify dia
listing/sale-event sync completeness before treating the sparse P1/P3 as a wiring gap.

## Bottom line
dia is NOT underserved at the data/queue level — R8/R11 gave it real parity in ownership +
cadence. The visible "dia gap" is a domain-attribution bug in the queue filter, not missing
dia work. Fix the attribution and dia's true footprint surfaces; then assess whether dia's
thin transaction triggers are market reality or a capture gap.
