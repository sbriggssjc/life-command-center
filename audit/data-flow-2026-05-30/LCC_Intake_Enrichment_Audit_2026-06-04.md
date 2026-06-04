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

## Addendum 2 — LIVE VERIFIED: the drain works (2026-06-04 ~19:30 UTC)

Deployed, cron applied, drain exercised with real writes:

- **Route live** — GET dry-run returns clean JSON (scanned 100 / eligible 70 /
  30 no-address); portfolio OMs now carry `addresses` as a real array (the
  Carbondale IL + Lubbock TX Bio-Medical pair visible in the candidate list).
- **Cron registered** — `lcc-intake-rematch` `*/30 * * * *` active on LCC Opps.
- **First apply tick:** 13 rematched → **9 newly_matched (69%)**, 3 promoted —
  right on the ≥76% estimate's doorstep on a tiny sample.
- **~20 min of manual draining:** review_required **2,900 → 2,747 (−153)**;
  matched 321 → 469 (+148); finalized +5. (Pile had grown 2,705→2,900 since the
  audit — the leak was real and is now reversed.)
- **The original layup closed the loop:** intake `81439334…` ("198 N Springfield
  Ave") → rematch stamp `{outcome: matched, attempts: 1}` → finalized → full OM
  payload landed on **dia prop 37106** (anchor_rent, year_built, building_size,
  lease 24734 with rent/expense_structure/renewal_options/guarantor, listing
  12726 with cap rates + broker, broker contact) — all provenance-tracked as
  `om_extraction`.

Cron takes it from here (~100-row ticks, 2×/hr; still-unmatched rows get a 168h
cooldown so the working set shrinks). Residual unmatched = genuinely-new
properties → **F4 create-from-intake** is the remaining drain.

## Addendum 3 — residual pile decomposed; F8 found (2026-06-04, F4 prep)

Post-rematch forensics on the remaining review pile (~2,731 at sample time):

| Class | Count | Drain |
|---|---|---|
| Has address, unmatched (mostly genuinely-new properties) | ~613 — **334 with full deal signature** (addr+tenant+price) | F4 create-from-intake |
| No-address email bodies (`email_update` 1,160 / `unknown` 410 / null 343 / `broker_email` 61) — newsletters, blasts, thread histories | **~2,018** | auto-disposition → `discarded` + reason (non-deal rule) |
| **F8 (NEW): PDFs parsed to zero text** (`pdf_text_len=0`, scanned/image PDFs) — incl. real OMs like "Fresenius - Independence - MO - OM.pdf" | 39 (24 named `*OM*`) | flag `ocr_needed` + Claude-vision PDF fallback |

Also observed: one email body staged twice ~1s apart (idempotency-guard check
folded into the prompt). All three drains specced in
`CLAUDECODE_PROMPT_F4_create_from_intake.md` (create-property reuses
`upsertDomainProperty` + `runDownstreamPipeline`; auto-create flag-gated
`INTAKE_AUTOCREATE`, default off; soft-disposition doctrine — status+reason,
never delete).

## Addendum 4 — F4/F8 shipped (PR #1044, pending deploy)

Claude Code delivered all three drains on `claude/cool-darwin-17Aa5`:
- **Create-from-intake**: `api/_handlers/intake-create-property.js`, route
  `POST /api/intake?_route=create-property`, race-guard rematch first, creates
  via exported `upsertDomainProperty` tagged `om_intake` (gov `data_source` /
  dia `source` — confirmed live), provenance conf 0.6, then full
  `runDownstreamPipeline`. One property per address on multi-address OMs.
  UI "Create property →" in inbox triage. AUTO mode `INTAKE_AUTOCREATE=1`
  (default OFF, cap 10/tick) in the rematch worker.
- **Auto-disposition**: `api/_shared/intake-classify.js` single source of truth
  (promoter now imports it); extractor routes non-deal →
  `discarded`/`non_deal_no_address`; backfill rides the existing intake-rematch
  cron (new disposition pass) — **no migration, no ordering hazard**.
- **F8 OCR rescue**: 0-char PDFs → bytes to OpenAI Responses API document block
  (`invokeVisionExtractionAI`, gpt-4o), gated on `OPENAI_API_KEY` + byte cap;
  unrescued flagged `ocr_needed` (checked BEFORE non-deal discard), triage badge
  + "Re-extract (OCR)" button + `ocr-reextract` route.

Pre-flight validation (read-only vs live): 613 has-address / 333 full-signature
/ 38 zero-text / **1,940 would-disposition** — matches forensics; Fresenius
Independence MO OM confirmed → rescue path, not discard. 18 new tests; suite
471/0. **Deploy note: confirm `OPENAI_API_KEY` is set in the RAILWAY env**
(CLAUDE.md only documents it for Vercel) or the OCR fallback silently idles.

Post-deploy checklist: dry-run GET intake-rematch → `dispositioned_non_deal`/
`flagged_ocr_needed` counts → POST drain → live Create-property on a
full-signature item (property+listing+provenance in domain DB) → OCR re-extract
the Fresenius intake → `INTAKE_AUTOCREATE` stays off until manual mode watched.

## Addendum 5 — F4 LIVE VERIFIED + F4B follow-ups (2026-06-04 evening)

All three drains verified live with real writes:
- **Create-from-intake works**: FMC Buckeye AZ intake (`8622b5e3…`) → dia prop
  **44309** created ("815 S. Watson Rd / Buckeye AZ / src=om_intake"), matcher
  re-found it at 0.97, LCC entity linked, owner resolution ran. Race guard
  verified: second call `created: []`, no dupe.
- **OCR rescue is a complete win**: the zero-text scanned Fresenius
  Independence MO OM → vision re-extract returned the FULL deal (1135 North
  Claremont Ave, Independence MO 64054, $1.122M @ 7.75 cap, NOI 86,955, lease
  terms, M&M broker) → **matched existing dia prop 26913 → promotion_ok →
  finalized**. `OPENAI_API_KEY` confirmed present on Railway.
- **Disposition drains**: 646 non-deal items moved to
  `discarded/non_deal_no_address` in the first hour; 11 `ocr_needed` flags
  raised. Pile: **2,900 (morning) → 1,942** and falling; matched 321 → 633.

Live test exposed four follow-ups (specced in
`CLAUDECODE_PROMPT_F4B_promotion_hardening.md`):
1. **Cap-rate double conversion** — extractor emits BOTH 0.055 (decimal) and
   7.75 (percent); promoter blindly ÷100 → 0.0006 → listing 23514. Needs
   form-detection heuristic, promoter-wide.
2. **Array-valued snapshot fields crash scalar writers** — multi-tenant/broker
   OMs now emit arrays; broker_contact / property_financials / unified_contact
   all failed `.trim is not a function`; listing text column got raw JSON.
3. **Normalizer gaps** — number-words ("Eight Mile"↔"8 Mile" → would have
   duped existing prop 26639) + hyphenated ranges ("2064 - 2066 Atlantic Ave"
   ↔ existing 22041) + missing-directional tolerance. dia already holds dupes
   from this class (26481/2079983).
4. **Re-promote route 500s** on JSON body — inbox "Re-promote ↻" may be
   silently broken; check payload shape.
