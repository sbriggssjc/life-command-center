# Claude Code prompt — F4: create-from-intake + review-pile disposition + zero-text-PDF rescue

Paste into Claude Code, run from the **life-command-center** repo. Follow-up to
the F1 matcher pass (PR #1043, deployed + cron live — the rematch drain is
running). This round gives the RESIDUAL review pile its three drains.

---

## Context (verified live in LCC Opps, 2026-06-04 post-rematch — don't re-investigate)

The `review_required` pile (~2,731 and falling as the rematch cron drains)
decomposes into three distinct classes:

1. **~613 items have an extracted address** but stay unmatched after the
   improved rematch — these are mostly *genuinely-new properties* (verified
   sample: USPS Minneapolis "5139 34th Ave S" is NOT in gov DB). **334 carry a
   full deal signature (address + tenant + asking_price).** There is NO path
   from a valid extraction to a new property+listing today — this is the
   workflow gap.
2. **~2,018 are no-address email bodies** (`mime=text/plain`), dominated by
   `document_type: email_update` (1,160), `unknown` (410), null (343),
   `broker_email` (61) — newsletters, broker blasts, thread histories. Nothing
   deal-shaped; they will NEVER match or promote, yet they sit in
   `review_required` forever, drowning the real items. (Auto-discards stopped
   2026-05-24.)
3. **39 PDFs parsed to ZERO text** (`diagnostics[0].pdf_text_len = 0`,
   no `pdf_parse_error`) — scanned/image-based PDFs. **24 are named `*OM*`**,
   e.g. `Fresenius - Independence - MO - OM.pdf` (intake
   `837b5319-b877-4981-9ce1-ee39443910fa`): a real deal doc whose extraction
   returned all-nulls and parked silently. Real OMs are being lost with no
   flag and no fallback.

Also observed (fix if cheap, else note): the same email body staged twice ~1s
apart (`email-body-AAPHjgauAAA.txt`, intakes `67c74fe6…` and `03778ba2…`) —
check the outlook-message idempotency guard (internet_message_id?).

## Architecture you must reuse (from the F1 recon — verified symbols)

- `runDownstreamPipeline(intakeId, snapshot, ctx)` — `api/_handlers/intake-extractor.js` ~743; canonical match+promote entry, already reused by `handleIntakeRematch` (`api/admin.js` ~3553-3740).
- `promoteIntakeToDomainListing()` — `api/_handlers/intake-promoter.js` ~2163; REQUIRES `match.property_id` — promotion writes listings/broker contacts/financials/leases(dia)/prospect_leads(gov)/documents + `recordOmFieldsProvenance` (source `om_extraction`).
- `upsertDomainProperty()` — `api/_handlers/sidebar-pipeline.js` ~3060; the existing "create a property when none matches" writer (POST `properties` via `domainQuery`, sets address/city/state/property_type + domain-specific fields). Reuse or extract its core rather than writing a new creator.
- Review UI: `ops.js renderInboxTriage()` ~854-989 — items already have "View match →" (`openIntakeFromInbox`) and "Re-promote ↻" (`repromoteIntake` → `POST /api/intake?_route=promote`). Follow that exact pattern for new buttons/routes.
- Domain creds: `getDomainCredentials()` in `api/_shared/domain-db.js` (accepts dia/gov + long forms).
- **No new `api/*.js` files — stay at 12.** New routes as `?_route=` sub-routes; update `server.js` mounts/aliases + `vercel.json` rewrites as siblings do.

## Task

### 1. Create-from-intake (the workflow gap)

New sub-route (suggest `/api/intake?_route=create-property` next to `_route=promote`):
given an `intake_id` in `review_required` with extracted address but no match:
- Re-run the matcher once more first (cheap guard against racing the cron; if it
  now matches, just promote and return that).
- Create the property in the routed domain via the `upsertDomainProperty` core:
  address/city/state (now persisted by F1), tenant/operator, building size if
  extracted; tag the row's source field (e.g. `source_type='om_intake'`) so
  forensics can tell these from CoStar captures. Record provenance for the
  created fields (source `om_extraction`, modest confidence ~0.6).
- Then call `runDownstreamPipeline` so the fresh match finds the new property
  and the FULL existing promotion path runs (listing, lease, contacts, docs) —
  do not reimplement promotion.
- Multi-address (F2) items: create/match per address, same as the matcher split.

UI: in `renderInboxTriage`, for review items with an address and no match, add
**"Create property →"** calling the new route (toast + refresh, like
Re-promote). Show city/state now that they're persisted.

Guarded AUTO mode (flag-gated, default OFF): env `INTAKE_AUTOCREATE=1` lets the
rematch worker auto-create for items meeting ALL of: full deal signature
(address+tenant+asking_price), parseable state, doc_type in
om/flyer/marketing_brochure (or `snapshotLooksLikeListing`), and rematch already
attempted once (cooldown stamp present). Cap per tick (e.g. 10). Stamp
`raw_payload.autocreated` with property_id + timestamp. Scott flips the flag
after watching manual mode behave.

### 2. Auto-disposition of the no-address non-deal pile

One-shot + ongoing rule. An intake is **non-deal** when: no extracted address
AND no asking_price AND no cap_rate AND doc_type NOT IN
(om, flyer, marketing_brochure, comp) — tenant alone does NOT save it.
- **Ongoing:** at the end of extraction (where status is chosen), route
  non-deal results to `discarded` with a machine reason (e.g.
  `raw_payload.discard_reason='non_deal_no_address'`) instead of
  `review_required`. Soft-disposition doctrine: status change + reason, never
  delete; reversible by re-running extraction.
- **Backfill:** drain the existing ~2,018 the same way — either extend the
  rematch worker with a disposition pass or a small one-shot via the same code
  path. Report the count dispositioned.

### 3. Zero-text PDF rescue (F8)

- **Flag distinctly:** when `pdf_text_len === 0` on an `application/pdf`
  artifact, do NOT emit a normal all-null extraction. Mark the intake (e.g.
  `raw_payload.extraction_quality='ocr_needed'`) and keep it in review with
  that reason visible in the inbox triage UI (badge), so the 24 OM-named ones
  stop hiding among newsletters.
- **OCR/vision fallback (assess + implement if feasible):** the extraction
  AI rides `invokeExtractionAI`/the edge provider (Claude) — Claude models
  accept PDFs natively as document content blocks (vision OCR built in). Add a
  fallback path: when text extraction yields 0 chars and the file is ≤ some MB
  cap, send the PDF bytes as a document block instead of extracted text. If the
  provider plumbing makes that impractical this round, ship the flagging +
  a re-extract sub-route that takes the OCR path, and say so in the PR.
- Re-run the 39 flagged intakes through whatever ships (worker pass or the
  rematch worker) and report how many produce real extractions.

## Verify + ship

- Unit tests: non-deal classifier (email_update/no-address → discarded; OM with
  address+price → not), create-property happy path picks the right domain.
- Live: one real review item with full deal signature → Create property →
  property exists in domain DB with `source_type='om_intake'` + listing + provenance;
  the Fresenius Independence MO intake re-extracts via the OCR path (or is
  flagged `ocr_needed` and visible in the UI).
- Report numbers in the PR: dispositioned count, zero-text rescued count,
  remaining review_required by class.
- `node --check` all touched; `ls api/*.js | wc -l` = 12; any migration/cron is
  idempotent and ordered AFTER the route deploy (same rule as intake-rematch).
  End with merge + deploy commands.
