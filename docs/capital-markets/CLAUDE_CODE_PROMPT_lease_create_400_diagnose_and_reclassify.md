# Claude Code prompt — diagnose the lease-create 400 + reclassify create-4xx as deterministic

> Live gate on the redeployed bucket-split (PR #1200) found the head-of-queue blockers
> are NOT the benign scanned/`no_factual_fields` tail that was theorized. They are
> **`enrich_create_failed:400`** — the lease INSERT is being REJECTED — on legitimate
> **single-tenant DaVita base leases**. The queue self-unblocks (attempt counter → 3 →
> dead-letter), so this isn't permanently stuck, but we will NOT accept silently
> deferring real leases until we've seen the 400 body. Receipts-first; the queue keeps
> draining the non-400 docs meanwhile.

## What the gate observed (live, read-only)
`POST /api/lease-backfill` returned, for the two head rows:
- id **5171** `/PROPERTIES/D/DaVita/San Jose, CA/San Jose Due Diligence File/Lease - Fully Executed - 7-27-15.pdf`
- id **5175** `/PROPERTIES/D/DaVita/San Jose, CA/San Jose Due Diligence File/San Jose DVA Lease - Fully Executed - 7-27-15.pdf`

both `outcome:'error', reason:'enrich_create_failed:400'`, `subject_hint.lease_backfill_attempts='1'`, unmarked. Single-tenant `/D/DaVita/` folder — NOT `/Multi/`. They have a text layer and extracted enough to ATTEMPT a create (so not the scanned-no-text case).

Key fact: the dia create path **works in general** — it created lease 25312 (dia 40041) earlier this session. So the 400 is **data-specific** to these rows, not a broken create path. A PostgREST **400** on insert is a **NOT NULL (23502) or CHECK (23514)** violation (unique=409, FK=409), so the San Jose extraction is producing a field that violates a constraint OR omitting a required one that the Hertz create happened to satisfy.

## Unit 1 — surface the REAL 400 (the blocker to any decision)
`enrich_create_failed:400` truncates to the HTTP status. In `ensureLeaseRow` (the create
branch in `lease-extractor.js`) capture the PostgREST error BODY on a failed insert —
`res.data` / `message` / `details` / `code` (the SQLSTATE + the offending column). Thread
it into the reason and onto the backfill marker, e.g.
`enrich_create_failed:400:23514:expense_structure` or
`...:23502:leased_area`. Same pattern as the other instrumented reasons (reason +
`text_len`). This is read-only diagnosis — no policy change yet — and it must be
queryable per-row after deploy so the gate can see exactly which constraint each 400 hit.

## Unit 2 — reclassify create-4xx as DETERMINISTIC (unblock on first pass)
The bucket-split currently treats every `create_failed:*` as transient (retry → 3 →
`error_dead_letter`). A create **4xx** (400/409/422) is a bad-payload / constraint
rejection — it fails identically on every retry, so 3 attempts just waste budget and
delay the unblock. Split by status:
- create **4xx** → **deterministic**: terminal on the FIRST pass, carrying the captured
  body reason (a distinct outcome, e.g. `enrich_create_rejected`, so it's separable from
  the benign `enrich_unprocessable` no-terms tail). Drops out of the queue immediately.
- create **5xx / network / timeout / threw** → **transient**: keep the retry + the
  `LEASE_BACKFILL_MAX_ATTEMPTS=3` dead-letter cap (unchanged).

Net: the queue unblocks on the first pass instead of the third, and 4xx rejections are
labeled honestly with their constraint rather than buried as "transient."

## Unit 3 — decide per the body (do NOT blanket-defer)
Once Unit 1 surfaces the constraint, bring me the per-row body reasons for the create-4xx
set (5171/5175 + any siblings the drain surfaces). Then it's evidence-based:
- **Fixable create-payload bug** — e.g. the extractor emits an `expense_structure` /
  `status` value outside the dia.leases CHECK set, a non-positive `annual_rent`, a
  malformed/again-as-year date, or omits a NOT NULL column the create needs. Normalize it
  in the create payload (mirror the proven 25312 payload that succeeded) so these
  **legitimate San Jose DaVita leases ENRICH** instead of being deferred. Any value
  normalization must respect the existing boundary guards (no price/cap advisory bleed,
  fill-blanks only, conflicts → Decision Center) and the one-active-lease dedupe.
- **Genuinely bad/insufficient doc** — if the doc truly lacks a clean required term, the
  deterministic terminal mark (with the real constraint reason) is the honest outcome —
  it joins the OCR/format/follow-up tail, queryable, not silently lost.

## My end-gate (unchanged, after the drain completes)
no duplicate edges; no duplicate leases; no clobber (populated disagreements →
`conflict`, spot-checked); multi-tenant gate held (40041 clean, zero `/Multi//Portfolio/`
enriched); and now also: the `enrich_create_rejected` / `enrich_unprocessable` /
`needs_ocr` tails sized WITH their reasons + `text_len`, so I can confirm the
scanned-base-lease theory, the create-400 root cause, and that no legitimate lease was
deferred for a fixable reason.

## Guardrails
- Receipts-first; surface the body BEFORE any blanket deferral. No schema unless the body
  proves a schema gap (then gate it). Still ≤12 api/*.js; reuse `ensureLeaseRow` /
  `attachLeaseDoc`, don't fork.
- Don't touch the cleaned records (dia leases 25312 / 19530 / 14365; the canonical
  `guaranteed_by` edges; the `superseded` provenance rows 1403859 / 1406606 / 1406607).
- Stay gentle on LCC Opps connections during any continued drain (sequential, capped).
