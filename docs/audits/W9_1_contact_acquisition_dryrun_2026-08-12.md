# W9.1 (Prompt 98) — Contact-acquisition engine, Stage 1 — dry-run + grounding (2026-08-12)

**Unit:** Wave 9 unit 1, Stage 1 (internal sources only). The lever on the 68-73%
no-contact gap. Proposal-only; flag `W9_1_CONTACT_ACQUISITION` **OFF**.

**Route:** `GET/POST /api/contact-acquisition-engine-tick`
(GET = dry-run; `?score=1&n=` = inline proposal sample; POST = apply, flag-gated).
Distinct from the live R16 `/api/contact-acquisition-tick` SF worker (that route is
untouched; the literal name was taken, so the engine gets `-engine-tick`).

**Migration:** `supabase/migrations/20260812130000_lcc_w9_1_contact_acquisition.sql`
(applied live to LCC Opps `xengecqvemvfknjvbvrq`): `contact_acquisition_batch` /
`_review` / `_apply_log` / `_dropped_log` + `v_contact_acquisition_review_open` +
`v_lcc_contact_acquisition_health` + flag OFF + nightly cron `55 4 * * *`.

**Lane:** new Decision Center federated lane `contact_acquisition_review` — fully
wired (75-guard): admin.js `FEDERATED_DECISION_TYPES` + `fetchFederatedSource` +
`/api/review-counts` lane + `handleDecisionVerdict`; ops.js `_DC_FEDERATED` + count-map
+ lane list; dc-lanes.js `_DC_FED_META` + `_fedCardHTML` render + `dcFedBulkContactAttach`.

## The pool (grounded live, ops v_owner_contact_worklist)

Value-ranked true owners with NO contact (no linked person, no SF Contact):
**3,151 total · 300 ≥ $1M · dia 628 / gov 2,523.**

## Per-stage yield on the top-value pool (grounded live)

The stage runner walks each owner in cost order, **stopping at the first success**.

| Stage | Kind | Top-100 | Top-300 | Note |
|---|---|---|---|---|
| 1a crossref (`lcc_resolve_owner_cross_reference`) | attach | **6** | **17** | the same person already a contact under a related owner (naming-core / same-asset / same-parent). The real Stage-1 yield. |
| 1a institution (`lcc_resolve_institution_contact`) | attach | 0 | 0 | the institution registry (`lcc_institution_contacts`) is thin today — honest zero; scales as the registry fills. |
| 1b deed signatory | mint | 0 | 0 | **honest zero** — `deed_records.raw_payload` carries a signatory name on **0 of 5,771** gov deeds (the deed parser writes the signatory into `property_documents.extracted_data`, not the deed row). Wired for when the deed signatory/OCR backfill lands on the deed row; verbatim-validated at mint time. |
| 1c broker_of_record | mint | tail | tail | 2,830 gov sales carry a `listing_broker`; the person-guard filters firm-only names, and stop-at-first-success means it only fires where 1a/1b found nothing. Modest, real tail. |

**Headline metric (feeds U4 / W9.5 coverage):** on the **top-100-value no-contact
owners, ~6% get a proposal today** (all cross-reference attaches), rising with the
broker tail. This is the honest Stage-1 internal-only floor; Stage 2 (SOS-direct) is
the value-ranked-remainder lift, deferred pending Scott's non-datacenter egress
decision (Prompt 99).

## Sample (cross-reference attach proposals, top pool — grounded live)

| Owner (contactless) | Proposed contact | Strategy | Source owner |
|---|---|---|---|
| (top-value LP) | Christine Russi Couture | naming_core | Pacific Coast Properties, LP |
| (top-value dev) | Nigel Hebborn | naming_core | Acquest Development |
| (office park LLC) | Patty McCullough | naming_core | Cambridge Office Park LLC |

All are **attach** proposals (an existing person entity linked to the owner) with the
cross-reference evidence recorded in `source_pointer`; the firm-suffix guard rejects a
non-person "name". Deed mints (when data lands) carry a VERBATIM quote; brokers are
typed `broker_of_record`, never the owner's own contact.

## Doctrine compliance

- **Proposal-only** — the tick writes ONLY the proposal/ledger tables (no domain
  PATCH/DELETE); a human verdict resolves into the ops entity graph via the shared
  contact-attach helpers (`ensureEntityLink` / `linkPersonToEntity` /
  `stampContactOnActiveCadence`), reversible via `contact_acquisition_apply_log`.
- **Value-gated + windowed cursor** (anti-joins its own proposals — 92-class guard),
  **stop-at-first-success**, **batched** cross-DB reads (owner→property map built once).
- **Attach vs mint routed by stage** (stage canonically owns kind/role — a broker can't
  be re-typed as a direct owner contact). **Verbatim validator** on every deed mint →
  `contact_acquisition_dropped_log` (the precision floor).
- **No new `field_source_priority` rows** — Stage-1 verdicts resolve into the ops graph,
  not domain-contact field writes; `v_field_provenance_unranked` stays 0.
- **Pluggable stage list** — the runner takes the stage order + stage fns, so Stage 2
  (`sos_direct`, reserved in the CHECK) slots in without rework. Web-search proxy PAUSED.

## Tests

`test/contact-acquisition-planner.test.mjs` (21): stage-order/stop-at-success,
pluggable Stage-2 seam, attach-vs-mint routing (stage-canonical kind/role), verbatim
validator on deed quotes (drops name_not_in_quote / quote_not_verbatim / junk_name),
broker_of_record typing guard, value-gate/cursor ordering, subject_ref idempotency, +
structural read-only-until-verdict guards (tick proposal-only, 92-class anti-join,
flag-OFF + staggered cron, ledger-before-mutation). Guard suites green
(operations-subroutes, decision-center-partition, w8-federated-lane-wiring: 74/74 with
the W9.1 tests).

## Operator step before flip

Redeploy Railway → `GET /api/contact-acquisition-engine-tick?score=1&n=10` (cross-ref
attach proposals with evidence; `scan_errors:[]`) → review → flip
`W9_1_CONTACT_ACQUISITION` → on. The nightly cron (`55 4 UTC`) then walks the
value-ranked pool, proposing into the `contact_acquisition_review` lane.
