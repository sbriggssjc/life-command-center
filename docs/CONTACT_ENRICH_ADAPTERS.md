# Contact-enrichment adapters (CONTACT-SELECTION Slice 4) — build + post-deploy runbook

Drains the **78 contactless high-value owners** in `owner_contact_pivot`
(`active_contact_entity_id IS NULL`, `status='active'`) by resolving a named
decision-maker and attaching it via the existing Slice-3 worker
(`?_route=owner-contact-enrich-tick`). Three phases, three feature-flagged
adapters; **all live network drains run post-deploy on Railway** (the build
sandbox has no egress — every outbound request 403s).

## Grounding (live, 2026-06-20) — the prompt's premises were materially refuted

| Prompt premise | Live reality (what the build targets) |
|---|---|
| Mix of gov + dia owners | **All 78 contactless owners are `dia`. Zero gov.** Re-pointed at dia sources. |
| Phase C source = gov `registered_agent_address` | **`dia.true_owners.notice_address_1` — populated for all 78** (+ `state` for all 78). |
| Phase A "we already ingest [deed/PSA] docs" → parse the block | The 19 deed docs on these owners' properties have **no stored `raw_text`** and live behind a CoStar CDN (deed) / SharePoint PA flow (PSA/master) — bytes are **not** sandbox-reachable. Only **~14 owners / 17 docs** have any deed/dd/master at all. |
| Free SOS partly done | Only **2 of 78** carry a known manager — no meaningful free attach from existing research. |

Route split of the 78: **42 `address_reverse_lookup`** (mostly individuals) ·
**36 `sos_manager_lookup`** (LLC/LP) · (+6 `public_company_ir` = manual IR, no
scraper). The 86 *named* owners are already drained by the Slice-3 free
attach/drill-through path.

## What shipped this session (JS-only, fully unit-tested, feature-flagged, zero DB change)

- **`api/_shared/deed-signatory.js`** — Phase A. `parseDeedSignatory(text)` is a
  pure, deterministic signature-block parser (authority-1 signatory): handles
  `By:`/`/s/` lines, `Name:`/`Title:`/`Its` pairs, picks the highest-authority
  signer (managing_member > general_partner > manager > principal > officer >
  trustee > authorized_signatory > member), and **never** returns an LLC / deal
  string / junk (reuses `looksLikePersonName` + `isImplausiblePersonName`). No
  confident block ⇒ no signer. `buildDeedParseAdapter({fetchDocText})` wraps it;
  the byte fetch is the deferred, network-gated piece.
- **`api/_shared/sos-lookup.js`** — Phase B **framework** (NOT a live scraper).
  `inferFilingStates` (state_of_incorporation → owner state proxy → DE/NV),
  `SOS_STATE_ADAPTERS` registry (FL/CA/TX, all `enabled:false`, `parse:null`),
  `sanitizeSosResult` guard, `buildSosLookupAdapter({fetch,cache})`. Per-state
  response parsers are **deferred** (validate against captured responses
  post-deploy — per Scott: do not blind-ship scrapers we can't validate).
- **`api/_shared/address-reverse.js`** — Phase C **framework**.
  `isRegisteredAgentServiceAddress` (rejects CSC / CT Corp / Cogency /
  Registered-Agents-Inc / law firms / PO boxes — so a service address never
  attaches as the principal), `classifyReverseAddress`, `sanitizeAddressResult`,
  `buildAddressReverseAdapter({fetch,cache})`.
- **`api/_handlers/owner-contact-enrich.js`** — wired the three real adapters
  into `buildDeps()` behind thin webhook fetchers. **Unconfigured behavior is
  byte-identical to Slice 3** (each adapter returns `unconfigured` without its
  `OWNER_ENRICH_*_URL`, and SOS also requires an enabled state parser).
- Tests: `test/deed-signatory.test.mjs`, `test/sos-lookup.test.mjs`,
  `test/address-reverse.test.mjs`, + a deed case in
  `test/owner-contact-enrich.test.mjs`. Full suite 1075 pass / 0 fail / 6 skipped.

The resolved contact in every phase rides the **same** attach→pivot→NBT wiring
(`attachPersonToOwner` → `ensureEntityLink` guards → `linkPersonToEntity` →
`stampContactOnActiveCadence(onlyContactless)` → `owner_contact_pivot.
active_contact_entity_id` → queue refresh), so the owner becomes
connected/reachable and leaves the NBT `acquire_contact` state. Reversible:
delete the relationship + null the pivot pointer.

## Env flags (set on Railway to activate; unset ⇒ inert no-op)

| Flag | Phase | What it points at (Scott provides) |
|---|---|---|
| `OWNER_ENRICH_DEED_URL` | A | webhook/PA flow that fetches a deed/PSA doc's text by reference and returns `{ok, text, source_url}` |
| `OWNER_ENRICH_SOS_URL` | B | free SOS-direct proxy fetcher (per state) — **also requires** an enabled+validated per-state parser in `SOS_STATE_ADAPTERS` |
| `OWNER_ENRICH_ADDRESS_URL` | C | free, rate-limited reverse-address proxy returning `{person_name, role}` |

## Post-deploy activation + per-phase gate (run on Railway, where egress works)

1. **Phase A routing (DB follow-up, required for Phase A to fire).** No owner is
   currently routed to `parse_deed_signatory`. Add `has_deed_doc` through the
   owner-signals chain so deed-owning owners prefer the authority-1 signatory:
   - dia `v_owner_contact_signals_portfolio` → append `has_deed_doc` (`EXISTS`
     deed/dd/master `property_documents` on a property the owner's
     `true_owner_id` owns).
   - LCC `lcc_owner_contact_signals` + `lcc_sync_owner_contact_signals`/`_finalize`
     → carry `has_deed_doc`.
   - LCC `v_owner_active_contact` → in the `enrichment_action` CASE, prefer
     `'parse_deed_signatory'` when `has_deed_doc` (before sos/address); the
     seeder re-routes unlinked owners. Additive / cache-or-live-safe / reversible.
   - **Addressable: ~14 owners / 17 docs** (the deed/dd/master set).
2. **Phase A gate.** Set `OWNER_ENRICH_DEED_URL`. `GET …owner-contact-enrich-tick`
   dry-run, then a capped `POST` (`limit=5`). Confirm: real signatories parsed
   from owned docs, correct role/authority 1, owner flips `acquire_contact →
   cadence_touch`, 0 junk, reversible.
3. **Phase B gate.** Capture a sample response per state, implement + validate
   that state's `parse`, flip `enabled:true`. Set `OWNER_ENRICH_SOS_URL`. Capped
   per-state run (start FL) → real managers attached, `state_resolved` logged, 0
   junk/operator. Expand state-by-state. Respect each site's robots/TOS + rate
   limits; gentle concurrency + jitter; cache.
4. **Phase C gate.** Confirm the residential-vs-agent-service split on a sample,
   set `OWNER_ENRICH_ADDRESS_URL`, capped run → residential principals attached
   (never agent services), 0 junk, reversible.

**Honesty contract:** owners whose filing state can't be resolved / have no
enabled SOS parser / have only an agent-service address stay **queued** — never
guess-attach a wrong person. Report per-phase drain as attached / queued /
unresolved.

## Amendment (Scott, 2026-06-20) — free-only + web search + cross-ref + manual worklist

Decision: **stay free** (no paid OpenCorporates). The worker's external branch is
now an **ordered chain** — first confident resolve wins; the unresolvable tail is
SURFACED to a worklist, never dropped or guess-filled:

```
deed/SOS/address (routed by enrichment_action)  ← Phases A/B/C
   wrapped in:  cross-ref (free) → public-IR terminal → routed adapter
                → web search (Phase D) → manual-research worklist
```

- **Cross-reference (run FIRST, free, zero-network).** Reuse a principal already
  resolved on a *sibling* owner. Wired as a deps-injected `crossRef` hook ordered
  first in the chain; resolve → attach `source='cross_reference'`. **The production
  sibling resolver** (shared `notice_address` / property cluster / true-owner
  family) needs cross-DB grounding and is the post-deploy piece — until then the
  step no-ops (`no_sibling`) and the row flows on. (The Slice-2
  `lcc_detect_contact_recurrence` recurrence-lock already covers the in-portfolio
  recurrence case.)
- **Phase D — free web-search enrichment** (`api/_shared/web-search-enrich.js`,
  framework). `extractPrincipalCandidates(results, owner)` takes a name ONLY when
  adjacent to a STRONG labeled role cue (manager / managing member / registered
  agent / authorized person / principal), guarded to a plausible human, scored
  (≥2 corroborating results = high). `buildWebSearchAdapter({search})`
  feature-flagged on **`OWNER_ENRICH_WEBSEARCH_URL`** (+ `OWNER_ENRICH_WEBSEARCH_MIN=high`
  to require corroboration). No labeled candidate ⇒ `no_confident_match` → worklist.
  The search HTTP is the deferred fetcher; the parser is the tested core.
- **Manual-research worklist** (`api/_shared/manual-research-worklist.js`). Every
  owner the chain can't crack → an idempotent `research_tasks` row
  (`research_type='owner_contact_manual'`, one OPEN per owner) carrying the
  breadcrumbs: owner name, inferred state, notice address, **the methods tried +
  why each failed**, the bench rejected, and **2–3 pre-built Google queries**
  (`buildGoogleQueries`). A hand-found contact attaches via the SAME
  `ensureEntityLink` + pivot path, so a manual resolution flows into NBT
  identically. **Backoff:** once a manual row is OPEN, subsequent ticks skip the
  external attempts (`manual_research_pending`) and only re-try the free cross-ref
  (as siblings resolve over time) — no re-hammering.

### Env (amendment)
| Flag | What it points at |
|---|---|
| `OWNER_ENRICH_WEBSEARCH_URL` | free search proxy returning `[{title,snippet,url}]` |
| `OWNER_ENRICH_WEBSEARCH_MIN` | optional; `high` requires ≥2 corroborating results |

### Post-deploy follow-ups (amendment)
- Build the production **cross-ref sibling resolver** (cross-DB: shared
  notice_address / property cluster / true-owner family → reuse a resolved
  sibling's contact). Highest-value free win for the contactless set.
- Load the dia **owner context** (state / notice_address / city) into each
  worker row so the SOS/address/web adapters + the worklist Google queries get
  real inputs (today they no-op/degrade gracefully without it).
- Wire the free web-search provider + (per-state) SOS parsers, then run the
  capped per-phase drains.
