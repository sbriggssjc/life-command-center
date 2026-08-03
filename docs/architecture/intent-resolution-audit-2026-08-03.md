# Intent / Resolution Audit — Phase 1

Date: 2026-08-03  
Scope: audit only. No tool code was changed.

## Executive Finding

The request-understanding gap is real, but it is uneven:

- **Comps is now the canonical implementation** for plain-language interpretation, transparency, and Team Briggs comp-quality rules. Its parsing, local gazetteer, unreliable-NOI policy, cap/rent reconciliation, rendered transparency, and `interpreted_query`/`interpreted_params` metadata all live in one shared core (`mcp/comps-tools.js`).
- **BOV is stronger on subject resolution than the design doc implied** because `property_lookup` resolves inside the generator and refuses ambiguous CRE matches with a 409 candidate list. Its remaining exposure is intent/template/quality-contract adoption: `NNN` vs `MOB`, record overrides, lease-term assumptions, and source/assumption transparency are not yet enforced by the same shared contract as comps.
- **Context tools are the highest silent-guess risk**. `get_property_context` and `get_contact_context` still have paths that select `limit=1` or "best" candidates without returning alternatives. `get_deal_dossier` is better: it refuses ambiguity.
- **CMS/NPI matching has good local safeguards** but uses its own resolver/scoring/history model rather than the shared subject resolver that should exist.
- **HTTP mirrors are not always parity with MCP**. In particular, HTTP contact lookup is older/weaker than MCP contact lookup.

## Corrected Exposure Table

| Tool / workflow | Design-doc exposure | Code-corrected exposure | Correction |
|---|---:|---:|---|
| `query_comps` / `synthesize_comps` / `generate_comps` | Fixed | Mostly fixed | `query_comps` / `synthesize_comps` are fixed. `generate_comps` is an exact-params workbook exporter; it inherits the fixed path only when the caller feeds it rows from `synthesize_comps`. |
| `generate_bov` / `bov-underwriting` / `bov-government` | Highest | High | BOV subject resolution is already record-first and ambiguity-refusing in the generator. Intent/template and quality-contract consistency remain high exposure. The `bov-underwriting` / `bov-government` skill files are referenced as external `~/.claude/skills/...` assets, not present in this repo. |
| `get_property_context` / `get_contact_context` / `get_deal_dossier` | High | High | Confirmed. Dossier refuses ambiguous deals; property/contact still silently choose in several paths. |
| `offer-submission` | High | High | Context is delegated to `lcc_offer_context` RPC, and the skill has good human rules. RPC resolution internals are not visible in JS, so ambiguity behavior is unclear from repo code. |
| `cms-npi-analysis` | Medium | Medium | No MCP handler by that name found. Live behavior is `/api/cms-match` plus detail-page Operations UI; local resolver has thresholds/candidates but duplicates address normalization and scoring. |
| `search_entities` | Foundational | Foundational | It is a ranked search front door, not a final resolver. It returns candidate lists but does not produce a normalized `resolved / ambiguous / not_on_file` envelope. |

## Per-Tool Audit

| Tool / workflow | Subject / entity resolution | Intent / mode inference | Quality / consistency rules | Status and gap vs comps |
|---|---|---|---|---|
| `generate_bov` | MCP accepts `property_lookup` or `cre_property_id` and passes through to `/generate-bov` (`mcp/server.js:521`, `mcp/server.js:651`). The generator resolves `property_lookup` server-side (`bov-generator/main.py:270`). `resolve_property_id()` treats numeric input as id, otherwise address + optional state; zero match is 404 and multiple matches are 409 with candidates (`bov-generator/bov_record_loader.py:81`). Reviewed extraction loading prefers `status='reviewed'`, and unreviewed records require `BOV_ALLOW_UNREVIEWED` (`bov-generator/bov_record_loader.py:146`). | Requires `asset_type` after record load; only `NNN` and `MOB` are accepted (`bov-generator/main.py:306`). There is no NL intent parser for "government BOV", "dialysis BOV", "standard BOV", "use assumptions", or "update cap analysis"; callers must supply `property_lookup`/id or a fully structured hand-authored body. | Record-first doctrine is in canon: lease terms before assumptions, never fabricate escalations, never overwrite formulas (`docs/os/canon/bov.md:15`, `docs/os/canon/blocks/bov.md:2`). The handler returns workbook metadata only and does not expose assumption/source warnings in the MCP response (`mcp/server.js:684`). | **High, but not for address ambiguity.** Strong record lookup should be reused. Gap is that BOV does not consume comps' shared data-consistency contract for reliable/estimated transparency, cap/rent reconciliation, or source labeling in the response. Posted overrides win over reviewed records (`bov-generator/main.py:291`), which is useful but should be logged and disclosed. |
| `bov-underwriting` / `bov-government` skills | Repo references these as external skills, not audited source files (`SPEC_Capability_Parity.md:67`, `docs/os/canon/bov.md:33`). | The canon says record-first and hand-author only brand-new deals. Skill-specific template-pick logic is not visible in this repo. | Canon carries lease-before-assumptions and no fabrication. Skill code could not be verified. | **Unclear from code.** Treat as adoption targets, but do not claim behavior until the actual skill files are inspected. |
| `get_property_context` | Resolves in order: explicit `entity_id`, domain `property_id`, domain property by address, then LCC asset `address/name ilike` with `limit=1` (`mcp/server.js:953`). Helper `resolveEntityByPropertyIdentity()` checks `dia` then `gov` if no domain is passed and takes first external identity (`mcp/server.js:254`). `findDomainProperty()` also uses `limit=1` (`mcp/server.js:240`). HTTP mirror has similar first-hit behavior (`api/_handlers/property-handler.js:253`). | No intent/mode inference beyond `q` parsing in HTTP into id/property id/address (`api/_handlers/property-handler.js:224`). It always assembles the full property packet. | It returns `context_packet`, tenant/guarantor graph, active tasks, and gov data; domain fallback discloses `resolved_via` and `entity:null` when no LCC entity exists (`mcp/server.js:296`). No shared "Not on file / Derived / Conflict" renderer. | **Highest silent-guess risk.** Address/name lookups can pick one duplicate without surfacing alternatives. `property_id` without `domain` can choose `dia` before `gov`. Needs shared Subject Resolver first after BOV. |
| `get_contact_context` | MCP has newer ranking: explicit id, email with `chooseBestEntity()`, canonical buyer-parent RPC, then value-ranked candidate choice (`mcp/server.js:1106`, `mcp/server.js:219`). But it still returns one entity, not alternatives. HTTP mirror is weaker: person-only, `limit=1`, no canonical parent or value ranking (`api/_handlers/contact-handler.js:84`). | No real intent parser; full contact context is always returned. Recommendation is a simple cadence heuristic based on days since last contact (`api/_handlers/contact-handler.js:152`; MCP has analogous output after resolution). | Provides last touch, touchpoint count, active deals, recent events, recommendation. No shared conflict/not-on-file language. | **High and duplicated.** MCP improved, HTTP mirror regressed. Contact/org/person ambiguity should surface alternatives and the HTTP mirror should call the same shared resolver. |
| `get_deal_dossier` | Local `resolveEntity()` accepts UUID or asset name/address/normalized address. If multiple rows match, it returns `{ error:'ambiguous', candidates:[...] }` (`mcp/deal-dossier-tools.js:23`). HTTP route maps candidates to 409 (`mcp/deal-dossier-tools.js:156`). | Dossier has exact modes: read dossier, list checkpoints, update dossier. No NL section selection; all read output is fixed (`mcp/deal-dossier-tools.js:98`). | Timeline and milestones are projected from `activity_events`; economics note says to join domain/BOV extraction elsewhere (`mcp/deal-dossier-tools.js:64`). No cap/rent or source consistency contract is applied inside the dossier. | **Good ambiguity posture, thin quality contract.** Promote its refuse-ambiguity shape into shared resolver. Add optional intent for "timeline only", "economics", "seller update", etc. later. |
| `offer-submission` | Skill starts with `lcc_offer_context(<deal>)` / `get_offer_context` (`docs/os/skills/offer-submission-SKILL.md:27`). MCP handler delegates to `rpc/lcc_offer_context` with raw `deal` text (`mcp/server.js:934`); route wrapper does the same (`mcp/offer-context.js:19`). The RPC internals are not visible in this repo, so ambiguity behavior cannot be confirmed. | The skill has strong intent rules: trigger on LOI/offer, draft submission through seller email; seller response/counter only when explicitly asked (`docs/os/skills/offer-submission-SKILL.md:1`, `docs/os/skills/offer-submission-SKILL.md:118`). | Strong workflow rules: seller is owner, never tenant; ambiguous seller asks Scott; LOI fields are confidence-gated with `[verify]`; facts-only buyer/broker diligence; no strategy in writing; draft never auto-send; file writeback resolve-or-refuse (`docs/os/skills/offer-submission-SKILL.md:33`, `docs/os/skills/offer-submission-SKILL.md:41`, `docs/os/skills/offer-submission-SKILL.md:81`, `docs/os/skills/offer-submission-SKILL.md:85`). Canon also says Salesforce gets only a generic task, no buyer/price/cap/terms (`docs/os/canon/blocks/offer-submission.md:11`). | **High because context RPC is opaque.** The skill quality contract is strong, but subject/deal resolution should move to shared resolver or at least return the same `resolved/ambiguous/candidates` envelope before drafting. |
| `cms-npi-analysis` / CMS match | No MCP tool named `cms-npi-analysis` found. Live path is `/api/cms-match` mounted through `admin.js` (`server.js:175`, `api/admin.js:6037`). Resolution priority: cached `property_cms_link`; property denormalized CCN; `medicare_clinics.property_id`; fuzzy address/zip scoring; otherwise candidates/debug (`api/admin.js:6403`). Typeahead can search by facility name, address, Medicare ID, state/zip (`api/admin.js:6278`). | Modes are explicit `action=resolve/search/link/delete`; no NL intent beyond UI typeahead. | Good transparency: auto fuzzy requires score >= 0.80; lower scores return candidates and thresholds (`api/admin.js:6520`, `api/admin.js:6556`). Manual links record `matched_by`, `matched_at`, history, and `match_method` (`api/admin.js:6354`, `api/admin.js:6371`). UI shows "No confident match" and candidate scores (`detail.js:1024`, `detail.js:1034`). | **Medium.** Local safeguards are better than most tools, but address normalization/scoring is its own copy (`api/admin.js:6048`) and should become a domain-specific strategy under Subject Resolver / Reference Gazetteer. |
| `search_entities` | Searches Ops entities by name/canonical name, filters junk rows, floats canonical buyer parent, value-ranks by priority rent, optionally adds domain-property hits when address-like or entity results are sparse, and attaches tenant/guarantor deal edges (`mcp/server.js:805`). | No intent beyond entity type/domain filters. It returns ranked candidates, not a single resolved subject. | It strips raw metadata and includes value signals/identities but does not label confidence or ambiguity. | **Foundational but not enough.** It should become one data source under Subject Resolver, not the resolver itself. Also duplicated by HTTP search, which broadens fields and has its own scoring (`api/_handlers/search-handler.js:1`). |
| `generate_comps` | MCP `generate_comps` requires structured row arrays and `comp_type`; it does not perform NL subject resolution (`mcp/server.js:587`, `mcp/server.js:609`). Canon says the workflow should call `SynthesizeComps` first with Scott's verbatim request, then pass returned rows to `generate_comps` (`docs/os/canon/comps.md:15`). | Exact mode only: sales vs lease workbook. Vertical controls template selection (`mcp/server.js:594`). | Strong exporter rules in description: formula columns are protected, dialysis chairs/patients supported, buyer/seller/financing opt-in only, omit unknown fields (`mcp/server.js:589`). Actual Team Briggs selection/quality rules live in `query_comps` / `synthesize_comps`: parse request (`mcp/comps-tools.js:402`), reliability gate (`mcp/comps-tools.js:853`), review signals (`mcp/comps-tools.js:496`), transparency (`mcp/comps-tools.js:909`), interpreted query (`mcp/comps-tools.js:957`). | **Fixed when used canonically.** `generate_comps` itself should not grow NL parsing; the shared Intent Interpreter should preserve the current canonical flow: synthesize first, export second. |

## Highest-Risk Silent Guess Points

1. `get_property_context` address/name fallback uses `limit=1` (`mcp/server.js:974`; HTTP mirror `api/_handlers/property-handler.js:275`).
2. `get_property_context` domain-property fallback uses `limit=1` and returns the first domain DB property (`mcp/server.js:240`; HTTP mirror `api/_handlers/property-handler.js:68`).
3. `get_property_context` with `property_id` but no `domain` tries `dia` then `gov` and returns the first hit (`mcp/server.js:254`).
4. `get_contact_context` MCP `chooseBestEntity()` silently picks top-ranked candidate after sorting (`mcp/server.js:219`).
5. HTTP `get_contact_context` uses person-only `limit=1`, no canonical parent, and no ambiguity envelope (`api/_handlers/contact-handler.js:84`).
6. `get_offer_context` delegates raw `deal` text to `lcc_offer_context`; ambiguity behavior is unclear from visible JS (`mcp/server.js:934`).

## Shared Module Extraction Plan

### 1. Subject / Entity Resolver

Promote first:

- Dossier's explicit ambiguity envelope: `{ error:'ambiguous', candidates:[...] }` (`mcp/deal-dossier-tools.js:37`).
- BOV's address-or-id resolver semantics: numeric id direct, address + optional state, zero = 404, many = 409 candidates (`bov-generator/bov_record_loader.py:81`).
- Search front-door data sources: Ops entities, external identities, domain properties, canonical buyer parent, value ranking (`mcp/server.js:805`).
- CMS matching as a domain strategy: Medicare/CCN exact link first, then thresholded address/zip fuzzy with candidates (`api/admin.js:6403`).

Adoption order:

1. **BOV first**: wrap existing generator resolver with shared logging/envelope without weakening its 409 behavior.
2. **`get_property_context` second**: replace first-hit address/name/domain logic; require disambiguation for 35724/29882-style collisions.
3. **`get_contact_context` third**: unify MCP + HTTP and return alternatives instead of silent `chooseBestEntity()`.
4. **Offer context fourth**: make `lcc_offer_context` consume the same resolver or return the same ambiguity envelope.
5. **CMS fifth**: keep domain scoring but move address normalization and candidate envelope into resolver strategy.

### 2. Intent Interpreter

Promote first:

- `parseRequest()` from comps (`mcp/comps-tools.js:402`).
- `routeIntent()` vertical/mode routing (`mcp/comps-tools.js:96`).
- Appraisal-mode defaults (`mcp/comps-tools.js:397`, `mcp/comps-tools.js:937`).
- `interpreted_query` and `interpreted_params` response shape (`mcp/comps-tools.js:885`, `mcp/comps-tools.js:957`).

Adoption order:

1. **BOV**: infer `bov_type/template_family` from request text and resolved subject: `NNN`, `MOB`, government, dialysis, standard; disclose when inferred.
2. **Context tools**: infer requested section/output shape while preserving default full packet.
3. **Offer submission**: classify `submission` vs `seller response/counter` vs `log only`; require explicit ask for counter.
4. **CMS**: map "find NPI/Medicare/facility" to `search` vs `resolve` vs `link`.

### 3. Data-Consistency Contract

Promote first:

- Comps reliability gate (`noiIsReliable`, `mcp/comps-tools.js:202`).
- Cap/rent reconciliation and review detail (`computeReviewSignals`, `mcp/comps-tools.js:496`).
- Transparency line (`mcp/comps-tools.js:909`).
- Buyer/seller/financing opt-in and no-guess exporter rule from `generate_comps` schema (`mcp/server.js:589`).

Adoption order:

1. **BOV**: lease terms before assumptions, override disclosure, reviewed-vs-extracted status, reliable-vs-estimated NOI/rent, cap math basis.
2. **Deal/property dossier**: render `Not on file`, `Derived`, and `Conflict` consistently in packet summaries.
3. **Offer submission**: make OM/listing economics and LOI extracted terms use the same confidence labels.
4. **CMS**: align `source`, `match_method`, `match_score`, and "No CMS link" language with the shared contract.

### 4. Reference / Gazetteer

Promote first:

- Comps `PLACE_GAZETTEER`, state maps, operator patterns, and street normalization (`mcp/comps-tools.js:332`).
- MCP server address normalization and domain aliases (`mcp/server.js:151`, `mcp/server.js:829`).
- CMS street suffix normalization (`api/admin.js:6048`).
- Domain aliases and external identity scheme from the CLAUDE canon.

Adoption order:

1. **Comps + BOV** share place/operator/asset terminology immediately.
2. **Search/property/contact** share address normalization and domain aliases.
3. **CMS** consumes the shared address normalizer with healthcare-specific ID aliases.

## Interpretation Logging Hooks

Add a single append-only interpretation log around the shared modules, not inside every tool:

- Hook at MCP tool entry before dispatch: log raw `args`, tool name, interpreted intent, resolved subject, alternatives, confidence, assumptions, and whether user clarification was required.
- Hook at HTTP route mirrors after auth and before handler dispatch for `/api/query-comps`, `/api/synthesize-comps`, `/api/property`, `/api/contact`, `/api/cms-match`, and BOV generator `/generate-bov`.
- Preserve comps' current `interpreted_query` / `interpreted_params` in responses, but also persist it for review.
- For BOV, log both `property_lookup` resolution and any posted override keys against the reviewed record.
- For subject ambiguity, log `ambiguous` events with candidate ids and do not continue unless the caller supplies a specific id.
- Surface a periodic "misunderstanding review" from the log into LCC Health, grouped by tool and failure type: not found, ambiguous, silent-auto-picked, widened scope, estimated data included, override applied.

Recommended log fields:

`created_at`, `surface`, `tool`, `raw_request`, `raw_args`, `interpreted_intent`, `resolved_subject`, `resolution_status`, `confidence`, `alternatives`, `assumptions`, `quality_flags`, `output_mode`, `handler_result_status`, `user_id`.

## Phase 2 Recommendation

Start extraction with **BOV as the lead adopter**, but do not rewrite the BOV generator's proven resolver behavior. Wrap and promote it:

1. Create shared `SubjectResolver` with BOV's 404/409 contract and dossier's ambiguity envelope.
2. Move comps' `parseRequest`, `PLACE_GAZETTEER`, operator patterns, and transparency metadata into shared modules.
3. Add interpretation logging at MCP/HTTP entrypoints.
4. Adopt in `generate_bov` first for request/mode/quality disclosure.
5. Replace `get_property_context` first-hit lookup paths next, because they are the clearest silent-guess risk.
