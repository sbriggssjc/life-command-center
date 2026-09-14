# LCC Data Ingestion, Ownership Research & Propagation Audit
**Date:** July 29, 2026
**Scope:** life-command-center repo (snapshot from scottsurface), Dialysis_DB (`zqzrriwuavgrquhisnoa`), government (`scknotsqkcheojiaewwh`), LCC Opps (`xengecqvemvfknjvbvrq`)
**Method:** Full code review of the repo (api/, supabase/ functions + migrations, scripts/, pipeline/, mcp/, docs/, audit/) by four parallel deep-dive analyses (ingestion, ownership/entity resolution, propagation/provenance, BD human-loop), cross-verified against live queries on all three Supabase projects.

---

## 1. Executive summary

The LCC is a genuinely sophisticated system — the provenance ledger, feed-freshness monitoring, parser diagnostics, and reversible-backfill discipline are better than most commercial data platforms. But the audit found a consistent structural pattern that limits how much value all that machinery produces:

**The system is excellent at *writing* and *watching*, and weak at *closing loops*.** Signals are generated, queues are filled, provenance is logged, and monitors watch the monitors — but a large share of the pipelines terminate in a queue no human ever sees, a feedback table nothing feeds, or a worker that was never scheduled. The highest-leverage work is not building new ingestion; it is connecting the last mile of roughly a dozen already-built loops.

Five headline findings, all verified against the live databases on 2026-07-29:

1. **~100,000 research/review rows are sitting in queues with no drain.** gov `ownership_research_queue`: 57,130 unverified rows (still being written as of 07-27, read by nobody). `sf_link_research_queue`: 30,711 rows across both domains with its drain cron deliberately disabled. `owner_unification_review_queue`: 2,574 rows, no UI. ORE reconcile queue: 986 queued, seeded daily, worker never scheduled.
2. **The self-learning loops are wired for output but not input.** `staged_intake_matches` has 47,368 matcher runs; `staged_intake_feedback` has **1 row**. `template_sends` has 60 sends with `replied` hardcoded `false`, so every template-performance metric is structurally zero. 23,000 `signals` rows sit at `outcome='pending'` forever.
3. **Core ownership coverage is the biggest data gap, not sales/lease data.** 68% of dialysis properties and 65% of government properties have no `ownership_history` at all; ~80% of dialysis `true_owners` have no linked contact; 59–62% of live sales lack a listing broker; 21–37% lack a buyer or seller name.
4. **CMS patient counts — a marquee dialysis dataset — have had no new real monthly data since 2025-03.** The ingest runs daily, reports success, and writes nothing (upsert against an already-loaded snapshot date). GSA inventory recovered from its earlier freeze but sits at 2026-06-01.
5. **The two mechanisms that would automate LLC piercing are both parked.** OpenCorporates key was never configured, so ~2,040 LLC research rows across both DBs are stuck `deferred` — and the code that would re-queue them "later" was never written. All non-FL Secretary-of-State adapters ship `enabled:false` with no parser.

The rest of this document details each area, then gives a prioritized remediation roadmap, automation recommendations, and a concrete plan for supplementing the human loop with locally-run open-source models trained on the labeled decisions you already have.

---

## 2. Verified state of the data (live queries, 2026-07-29)

### Coverage gaps

| Metric | Dialysis | Government |
|---|---|---|
| Properties | 12,312 | 20,175 |
| Properties with **no ownership_history** | 8,382 (68%) | 13,148 (65%) |
| ownership_history rows missing true_owner | 32 recorded_owners unresolved | 3,137 rows |
| Live sales | 3,575 | 5,689 |
| Live sales missing buyer | 1,315 (37%) | 1,174 (21%) |
| Live sales missing seller | 856 (24%) | 1,296 (23%) |
| Live sales missing listing broker | 2,216 (62%) | 3,373 (59%) |
| Active listings missing broker link | 3,178 / 5,129 (62%) | — |
| true_owners with no contact link | 5,588 / 7,021 (80%) | — |
| GSA leases unlinked to a property | — | 430 / 7,924 |

### Queue and loop health

| Queue / loop | Live count | Status |
|---|---|---|
| gov `ownership_research_queue` | 57,130 unverified | **Write-only.** Still growing (last write 07-27). Carries `ai_confidence` + `human_verified` columns — a verification workflow with no verification surface. |
| `sf_link_research_queue` (gov+dia) | 27,605 + 3,106 queued | Drain cron **deliberately disabled** (migration `20260608161000`). |
| `llc_research_queue` | dia: 1,155 deferred / 31 done · gov: 885 deferred / 11 done | ~95% parked `deferred` after 3 `no_handler_configured` attempts; **no re-queue code exists**, and rows parked before the FL Sunbiz adapter shipped were never revisited. |
| ORE `lcc_owner_reconcile_queue` | 986 queued | Seeder cron runs daily; **engine drain cron never scheduled** (`20260716141000` leaves it off pending a human gate). |
| `owner_unification_review_queue` (gov) | 2,574 | No UI, no API reader. |
| `dia_comp_review_queue` / `gov_comp_review_queue` | 86 / 96 open | Written by the MCP comps engine on every pull; **zero readers** anywhere. |
| `entity_match_candidates` (both) | 1,340 + 1,483 | Populated `pending_review`; zero app references. |
| `staged_intake_feedback` | **1 row** vs 47,368 matcher runs | Endpoint exists (`api/_handlers/intake-feedback.js`); no front-end caller. The human "pick" in match disambiguation is recorded but never converted to a feedback/training row. |
| `template_sends` | 60 sends, 0 replies | `opened/replied/deal_advanced` hardcoded `false` (`api/_shared/templates.js:338-340`); replies ARE detected in `sf-activity-ingest.js` but never propagated back. |
| `signals` | 126,214 total, 22,996 `outcome='pending'` | No code ever updates `outcome`. |
| LCC `research_tasks` | 2,774 queued (10,433 skipped, 5,475 completed) | The gap-tracker auto-close loop works; the `owner_contact_manual` class has no surface. |

### Feed freshness

| Feed | Latest | Assessment |
|---|---|---|
| CMS `facility_patient_counts` | **2025-03-01** (last real monthly) | 16 months stale. Daily job runs, logs "7,534 inserted," writes 0 (derivation counter vs DB counter; upsert no-ops on existing snapshot_date). |
| GSA inventory snapshots | 2026-06-01 | Recovered from the phantom-snapshot freeze but ~2 months behind; `gsa_lease_events` current (07-27). |
| SAM.gov / USAJobs | 2026-07-27 | Recovered (previously dead for months, found by accident — the reason R56 feed-freshness monitoring was built). **⚠️ SAM.gov re-assessed 2026-08-20 — see the note below the table.** |
| NPPES NPI weekly sweep | 2026-07-26 | Healthy. The cleanest end-to-end automated feed in the system. |
| State lease inventory (TX TFC) | 2026-06-01 | Single state; Phase-3 seams (events → prospect_leads) unbuilt. |

> **⚠️ SAM.gov — SUPERSEDED 2026-08-20. The key is VALID; the constraint is a RATE LIMIT.** (Note: this
> document never carried the `401 API_KEY_INVALID` claim that circulated elsewhere — the correction is
> recorded here because "Recovered / healthy" overstates SAM.gov throughput.) Live evidence: 281
> `sam_entities` (53 in the last 30 days), 497 contacts with `data_source='sam'`, owners stamped
> `sam_checked` as recently as 2026-08-19. Per GSA's published tier table a non-federal personal key with
> **no role** gets **10 requests/day** (with a role: 1,000). A live probe returns
> `{"rate_limited":true,"api_calls":0,"next_access":"…00:00Z"}` and stops on the first owner. The fail-soft
> design (an API error skips the `sam_checked` mark so the owner retries) makes a ~98% rate-limited pipeline
> indistinguishable from a healthy slow one — **measure `sam_checked` stamps per day, never "is the cron
> active"** (exactly the freshness-monitoring blind spot this row was written to close). Bulk alternative
> built 2026-08-20: the PUBLIC MONTHLY entity extract is ONE request covering all registrants
> (`GovernmentProject/src/ingest_sam_public_extract.py` + `gov_match_sam_public_extract`), carrying POC
> name+title but NOT email/phone (FOUO, federal-account-only). See
> `GovernmentProject/docs/RUNBOOK_sam_public_extract_cron.md`.

### Provenance enforcement

`field_provenance` = 1.58M rows. `field_source_priority`: **1,851 rules record_only, 78 warn, 76 strict** (~3.8% enforcing). The ramp plan exists (`docs/architecture/field_source_priority_ramp_plan.md`) but most rules have never observed a write, largely because SQL-trigger writes bypass `lcc_merge_field` and the `provenance_event_log` drain crons ("R2-W-1b/2b, future") were never built — gov has 16,860 undrained provenance events, dia 94.

---

## 3. Findings by area

### 3.1 Ingestion

**What's strong:** the OM email-intake pipeline (idempotent correlation IDs, race-safe claims, stuck-intake retry crons, extract-drain time budgets); LoopNet/RCM email parsing with unique-key dedup; the NPPES sweep; the availability-checker's careful bot-block handling; `sales_parser_diagnostics` + `v_sales_parser_miss_rates_7d` (empirical parser-fix prioritization — genuinely rare in the wild); R56 feed-freshness registry; `ingest_write_failures` dead-letter telemetry.

**The gaps:**

1. **The highest-volume writers live outside this repo.** The CoStar Chrome extension (the #1 domain-DB writer), the CMS bulk fetchers (`DialysisProject`), and the GSA/county/public-record fetchers (`GovernmentProject`) are all in sibling repos. `sidebar-pipeline.js` (11,297 lines) consumes a parser it cannot review or version-pin — it even carries defensive comments about stale-extension captures. Every major feed failure found in this audit (GSA phantom snapshots, CMS no-op writes, county linkage loss) happened in out-of-repo fetchers where the in-repo monitoring could only detect, not explain.
2. **The county scraper captured owner data and threw away the linkage — unrecoverably.** 9,402 gov parcel owner names with no `property_id`, no APN, and near-zero situs/mailing addresses (`SPEC_deed_county_ingestion_fix.md`, `GAPS_AND_FINDINGS_REGISTER.md:51`). The scraper knew the property_id at fetch time and didn't persist it. Neither domain has a recurring county-ingest cron; coverage sits ~4.5%.
3. **Config-gated features that are silently inert.** Folder-feed (`SHAREPOINT_LIST_URL` unset), `sf-list-import` (`SF_LIST_IMPORT_URL`), all four owner-contact enrichment adapters (`OWNER_ENRICH_*_URL`), OpenCorporates (`OPENCORPORATES_API_KEY`), Geocodio/Google geocode fallbacks, every non-FL SOS adapter. There is no "inert feature registry" — a flag-gated no-op looks identical to a healthy quiet pipeline.
4. **Gov pipeline crons shipped with literal `PIPELINE_TRIGGER_URL` placeholder strings** (`schema/026b_gov_pipeline_cron.sql:30,45`) and the whole `pipeline/*.py` FastAPI service has no deploy target — dead code that looks like automation.
5. **The sidebar OM-upload path bypasses `stageOmIntake`**, skipping the noise filters and provenance that the email path gets — the documented cause of the 2026-04-25 Hondo OM corruption. Provenance coverage in the sidebar is "still deferred" for deeds, loans, owners, document links, and broker links.
6. **Duplicate implementations drift:** RCM/LoopNet ingest exists in both `api/sync.js` and the `lead-ingest` edge function; SF routes have regressed out of existence at least three times (`..._REGRESSED_AGAIN.md`); the gov schema-mirror audit found three sidebar write paths silently failing because dia columns were never mirrored to gov.
7. **Manual steps hiding inside "automated" flows:** Sunbiz FL bulk file is a manual download + manual CLI; GSA diff catch-up was a manual operator to-do; master-workbook comps import needs a workstation artifact not in the repo; a fleet of ~9 stuck-intake recovery scripts substitutes for self-healing.

### 3.2 Ownership research & entity resolution

**What's strong:** the layered design (recorded → true owners, LLC piercing, ORE evidence-weighted reconciliation, Decision Center lanes); the FL Sunbiz mirror (2.8M entities) with a daily enrich-link cron; the dead-letter LLC triage that actually reaches the Decision Center; junk-party filtering on sales ingestion with SQL trigger defense-in-depth.

**The gaps:**

1. **No fuzzy matching, no embeddings, no learned models — anywhere.** Every matcher is deterministic string work: Jaccard token sets, suffix-stripping, substring `ilike`. The gov recorded→true owner resolver is an **unanchored substring match with no threshold** — first row wins and is written to `properties.true_owner_id` (`sidebar-pipeline.js:9411-9483`). This is the sole source of gov true-owner links and it feeds the ORE's second-strongest signal.
2. **Hourly unreviewed auto-merge on a lossy key.** gov `owner_merge_tick()` merges every `recorded_owners` row sharing a `canonical_name` produced by a normalizer that strips `group|partners|company|co` — "Smith Group LLC," "Smith Partners LP," and "Smith Co" all collapse to `smith` and merge, with properties, sales, and SF accounts following. This directly contradicts the ORE doctrine (weighted score ≥60 + name-core variant) running elsewhere in the same system.
3. **The ORE engine — the layer built to do this right — has no scheduled drain**, while its seeder runs daily. Its output tables (`lcc_owner_reconcile`, evidence, review view) have zero readers.
4. **The address-evidence signal has no fuel.** `shared_mailing_address` (weight 50) is nearly always empty: deed `grantee_address` = 0, SOS `mailing_address` = 0, gov `recorded_owners.mailing_address` = 0, parcels = 7 rows. The county fix (#3.1.2) and SOS enrichment are prerequisites for the ORE ever performing as designed.
5. **`chain-connect-tick` permanently starves** once ~2,000 properties are in its ledger (fetch-window arithmetic in `admin.js:6535-6551`) — the cron keeps running, doing zero work, silently.
6. **Confidence is computed and never gated.** `pivot_confidence` is selected and never read; any name passing `looksLikePersonName` becomes an outreach-ready decision-maker with a cadence stamp and no review.
7. **One LLM call in the entire subsystem** (`cre-owner-extract.js`, PDF owner extraction, gpt-4o-mini) — with no token budget, no result cache, and no dedup. The ~3,408 contactless owners (incl. ~344 with ≥$1M portfolios) funnel to a flat-priority manual worklist nobody reads.
8. **The Boyd Watterson cluster was reconciled by hand and frozen into a migration as 200 hardcoded UUIDs** — the clearest signal that the automated resolver isn't trusted for the highest-value clusters.

### 3.3 Propagation & provenance architecture

**What's strong:** the concept and schema of `lcc_merge_field`/`field_provenance`/`field_source_priority` is the right architecture; the mirror-leg pattern (fire/finalize with inflight tracking) is workable; R22 mirror-orphan reconcile exists; the disabled-cron watchdog and cron-health rollups exist.

**The gaps (these are the deepest architectural risks):**

1. **Three provenance systems, not one.** The LCC canonical ledger, the per-domain `provenance_event_log` (never drained — the flush crons are still "future"), and gov's legacy `field_value_provenance`/`check_provenance_allows_write` all coexist. SQL triggers and bulk backfills bypass `lcc_merge_field` entirely, so the ledger arbitrates against known-incomplete state: strict rules can block correct writes based on phantom values.
2. **`lcc_merge_field` is an unlocked read-modify-write with no uniqueness invariant.** No advisory lock, no `FOR UPDATE`, no unique index on (db, table, pk, field, decision='write'). Concurrent captures produce two live "write" rows with nondeterministic ordering. A single sale PATCH fans ~20 concurrent RPCs.
3. **Provenance is recorded before the write, and the post-write flush records the *unfiltered* payload** (`sidebar-pipeline.js:5985-6034`): blocked fields get logged as written; a failed PATCH leaves the ledger claiming a value that never landed. This also corrupts `sales_parser_diagnostics` — **the empirical basis for the warn→strict ramp measures intent, not effect.**
4. **Hard-coded page ceilings with no completeness guard** on every pg_net mirror leg (14/18 pages; listing events a bare `limit=1000` with no paging). Gov is at 20,175 properties — the 18-page ceiling is at/near the silent-truncation point *now*. Freshness monitoring watches `max(updated_at)` on one table, so a sync where only page 0 lands looks healthy.
5. **Fire/finalize race with stale-overwrite:** late pg_net responses consumed on a later run overwrite newer values (COALESCE upsert takes EXCLUDED when non-null), and the 24h `net._http_response` purge makes the window silently lossy.
6. **Inconsistent null semantics across mirrors** (`lcc_property_attributes` fill-blanks vs `lcc_property_owner_facts` last-writer-wins-including-nulls) and `lcc_listing_events` is insert-only — a sale later demoted to `duplicate_superseded` in dia keeps feeding the live P-BUYER pool.
7. **Per-domain SQL duplication has already diverged:** `propagate_sales_recompute` exists twice with different column sets; dia got the R42 cap-rate extension, gov didn't; three gov sidebar write paths failed silently on missing columns. The `domain_table_columns` check is a stale-by-default cache refreshed by an external GH workflow and only catches registry typos, not logic drift.
8. **Null writes are dropped from provenance** (`recordFieldProvenance` returns on null), so cleared fields become permanently un-refillable under warn/strict; and after the 90-day prune, forgotten keys return `no_prior_provenance` → a scraper can re-clobber curated data once the ledger forgets.
9. **Fail-open everywhere:** the priority guard returns `{write:true}` on any RPC error and every call site `.catch(() => patchData)`. An LCC Opps outage silently disables all enforcement. (The guard also silently returned `no_rule` on every call for an unknown period due to wrong RPC arg names — documented in the code.)
10. **Bounded ticks with no watermark:** `LIMIT 1500` with no ORDER BY/cursor on cap-rate recompute; the shortfall is never counted; the disabled-cron alarm deliberately excludes every propagation cron.

### 3.4 BD / human-in-the-loop

**What's strong:** the Decision Center (23 lanes) with don't-re-ask exclusion; the research-task gap tracker that auto-closes when the gap disappears; the listing-sale-event consumer; cadence engine + priority queue; reply detection locking in the right owner contact.

**The gaps:**

1. **Every actionable BD signal terminates in prose.** A closed sale becomes a research task whose *instructions tell the human to run three SQL functions by hand*. `state_lease_events`, `agency_risk_signals`, and NPI signals have **no code path at all** from signal to task.
2. **Listing-BD is the largest producer/consumer imbalance:** ~1,080 runs/14 days fanning up to 100 inbox rows per listing, while the outreach templates it feeds have **0 sends in 120 days**. No inbox filter chip, no batch-draft action wired, no cross-listing contact dedupe.
3. **The learning stack is a chain of unfed tables:** feedback (1 row) → accuracy stats (rolls up nothing) → thresholds (compile-time literals that never read the stats). The reply signal exists but never reaches `template_sends` or `signals`.
4. **`/api/review-counts` computes seven lanes; the UI renders one** (`sos_owner_links`). The 57k-row ownership research queue is invisible.
5. **Two known-broken feedback joins:** `get_contact_recommendation_weight` is called with `unified_id` but filters on `entities.id` — can never match, weight silently 1.0 for every contact (both in `briefing-data.js` and the edge function). `recommendation_ignored` is never emitted, so dismissed gaps regenerate forever.
6. **`fetchExcludedRefs` truncates at 5,000 with no pagination** — the same PostgREST-cap bug class that already caused a documented "5.2× dupe explosion" elsewhere and was fixed there with paging.
7. **MCP is blind to the review backlog:** `get_queue_summary` exposes BD work only — an agent asked "what needs my decision?" cannot answer.

---

## 4. Recommendations

### 4.1 Close the loops you already built (highest ROI, mostly small changes)

1. **Wire the match-disambiguation "pick" to `staged_intake_feedback`.** One insert in `api/admin.js:3069-3082`. This single change turns 47k+ matcher runs into a growing labeled dataset — the foundation for everything in §4.3.
2. **Propagate replies to `template_sends` and `signals`.** The detection already exists in `sf-activity-ingest.js:679`; PATCH the send row and emit a `template_response` signal. This activates `evaluateTemplateHealth`, `chooseBestTemplate`, and the weekly health report in one move.
3. **Schedule the ORE engine drain** (it was left unscheduled pending a human gate — give it a low limit + the Decision Center lane as the gate), and **surface `v_lcc_owner_reconcile_review`** as a lane.
4. **Adopt a queue policy: no queue without a drain, an SLA, and a depth alert.** Then triage the six orphans: comp review queues (add a simple lane or MCP tool — the data is already curated), `owner_unification_review_queue`, `entity_match_candidates`, `property_metadata_backfill_queue`, `owner_contact_manual` tasks, and the six unrendered review-counts lanes. For `sf_link_research_queue` (30k rows), don't just re-enable the cron — see §4.3; draining it manually is ~30k decisions.
5. **Re-queue `deferred` LLC research rows** now that the FL adapter exists (one UPDATE for FL-state rows), add the promised bulk-requeue path, and **set the OpenCorporates key** (or explicitly decide against it and delete the tick).
6. **Fix the two broken joins** (`get_contact_recommendation_weight` ID space; `recommendation_ignored` emission) and **paginate `fetchExcludedRefs`** using the same fix already applied at `admin.js:9077`.
7. **Kill the chain-connect starvation** (cursor on the ledger instead of fetch-window arithmetic) and the `fl-sos-enrich-link` stage-2 pagination bug (add an "already compared" predicate + ordering).

### 4.2 Harden the propagation spine

1. **Make `lcc_merge_field` safe under concurrency:** partial unique index on `(target_database, target_table, record_pk_value, field_name) WHERE decision='write'`, upsert semantics, `id` as recorded_at tiebreaker. Cheap, removes a whole class of nondeterminism.
2. **Record provenance from effect, not intent:** move `recordCoStarFieldsProvenance` after the PATCH and pass the *filtered* payload; on PATCH failure, mark the provenance row failed. This also fixes the parser-diagnostic telemetry your strict-ramp decisions depend on.
3. **Build the `provenance_event_log` flush crons** (the "R2-W-1b/2b future" work) so trigger-driven writes reach the ledger — or, cheaper, have the ledger read-through to the actual domain column value when deciding, treating `field_provenance` as history rather than truth.
4. **Replace page-ceiling pg_net mirrors with watermark-based incremental sync** (`updated_at > last_watermark`, loop until empty with a hard time budget). Gov is already at the truncation edge. Add per-mirror freshness rows to the health check (owner facts, portfolio facts, listing events — not just property attributes).
5. **Unify null semantics** across mirrors (pick fill-blanks or LWW deliberately, per table, and document it in the migration comment), and add retraction handling to `lcc_listing_events`.
6. **Fail-closed option for strict rules:** when the guard RPC errors, queue the write for retry instead of writing unguarded — at least for the 76 strict-mode fields.
7. **Stop hand-duplicating dia/gov SQL.** Generate both migrations from one template (even a simple `.sql.tpl` + a build script), and extend the disabled-cron watchdog to cover propagation crons.
8. **Schema hygiene:** ~40 `*_backup_*`/`*_purged_*`/one-off log tables now live in `public` across the two domain DBs. Move them to an `archive` schema with a documented drop policy; it will make `list_tables` legible again and shrink the RLS/advisor surface. Also run `get_advisors` (security + performance) on all three projects as a routine — the deferred-RLS workstream ("service-role only") tables are accumulating.

### 4.3 Where a locally-trained open-source model genuinely helps

You asked specifically about supplementing the human loop with a local open-source model. The honest framing: **your bottleneck is not extraction intelligence — it's entity resolution at scale, and you are unusually well-positioned for it because your review queues are labeled training data.** You already have: `lcc_decisions` (3,566 human verdicts), dq5/dq7 owner merge maps (~4,300 confirmed merges), `staged_intake_matches` + promotions (47k runs, 4.2k human promotions), `match_logs` (12.9k), `cm_entity_alias`, `owner_canonical_patterns`, `broker_enrichment_rules`, and the Boyd Watterson hand-reconciliation. That's tens of thousands of positive/negative pairs sitting idle.

Recommended stack, in order of impact:

1. **Probabilistic record linkage with Splink (open source, runs on DuckDB, CPU-only) as the blocking + scoring layer** for: recorded_owner ↔ true_owner, owner ↔ SF account (the 30k `sf_link_research_queue`), owner ↔ unified_contact, and property dedup. Splink gives you calibrated match probabilities, explainable comparisons, and trains its m/u parameters from your labeled pairs. This alone converts the 30k-row SF queue from "30k human decisions" into "auto-link ≥0.95, auto-reject ≤0.20, human-review the middle" — realistically shrinking the human set by 80–90%.
2. **libpostal for address normalization** (C library, local, battle-tested). Your `shared_mailing_address` ORE signal is starved partly because every pipeline normalizes addresses with hand-rolled regex. Normalize once at ingest, store `normalized_address` consistently, and both the ORE and property matching improve immediately.
3. **A small fine-tuned cross-encoder as the pairwise "same entity?" judge** for the middle band Splink can't decide. Fine-tune ModernBERT-base or DeBERTa-v3-small (both Apache/MIT, 100–300M params, train in minutes-to-hours on a rented GPU, infer on CPU) on your merge maps + decisions as sentence pairs ("BOYD WATTERSON GLOBAL ASSET MGMT" vs "Boyd Watterson Asset Management LLC" → same). Run it inside the existing tick workers as an HTTP microservice (a $5–20/month CPU container on Railway handles your volumes easily; no GPU needed at inference).
4. **GLiNER (or a fine-tuned token classifier) for party extraction from free text** — sale notes, OM excerpts, deed text, news alerts. Today this is regex (`SALES_PARTY_JUNK_RE`, `isJunkSalesParty`, deal-email-matcher string rules). A small local NER model extracting {buyer, seller, listing_broker, procuring_broker, lender, price, cap_rate} from `sale_notes_raw` would directly attack the 59–62% missing-broker and 21–37% missing-buyer/seller rates using text you already store. GLiNER runs CPU-fine at your volumes.
5. **A local 7–8B instruct model (Qwen3-8B or Llama-3.1-8B via Ollama/vLLM) for the judgment tail:** LLC-name → sponsor inference ("PTV VII LLC" → likely sponsor?), SOS filing officer-name interpretation, research-task triage, and drafting the first pass of Decision Center dispositions with citations to the evidence rows. Fine-tune with LoRA (Unsloth/Axolotl) on your decision history if the base model underperforms. Hardware honesty: the Surface can't train and will struggle to serve an 8B model; rent a GPU by the hour for fine-tuning (~$5–30 per run on RunPod/Lambda) and serve quantized (Q4) on a small dedicated box or a modest cloud instance — or keep gpt-4o-mini for this tail, since your call volumes there are low and the economics only favor local at the high-volume matching layers (items 1–4), which don't need an LLM at all.
6. **Embedding-based candidate generation you're already half-built for:** `property_embeddings` and pgvector exist. Add entity-name embeddings (bge-small-en-v1.5 or nomic-embed-text, both open, CPU-fast) for owners/contacts/brokers, and use vector similarity as Splink's candidate blocker for hard cases (subsidiaries, DBAs, misspellings) where token blocking fails.

**Sequencing matters:** fix the feedback capture first (§4.1.1), because every model above improves with the labels the loop generates — and the accuracy stats table you already built becomes the model-monitoring dashboard. Register model outputs as a provenance source (`source='splink_v1'`, confidence = calibrated probability) so `field_source_priority` governs them like any other source — the architecture for safe model-assisted writes already exists; it just has no model behind it.

### 4.4 Structural / repo architecture

1. **Monorepo (or at least submodule + CI) the fetchers and the extension.** `GovernmentProject`, `DialysisProject`, and the Chrome extension are where the worst incidents originated, and they're outside the repo where all the monitoring and review lives. At minimum: pin extension versions, log `extension_version` on every sidebar capture, and mirror fetcher source into CI so schema changes are reviewed against consumers.
2. **One ingestion contract.** Route the sidebar OM-upload path through `stageOmIntake` like every other channel; finish provenance coverage for the deferred writers (deeds, loans, owners, doc links, broker links); deprecate `api/sync.js`'s copy of the RCM/LoopNet ingest in favor of the edge function.
3. **Inert-feature registry:** one table listing every env-gated capability (flag name, purpose, owner, since-when-off) with a weekly digest line in the briefing email. Half the "automation" found in this audit was silently off; make "off" visible.
4. **Consolidation decision:** you have `SUPABASE_CONSOLIDATION_PLAN.md` already. The per-DB duplication tax (finding 3.3.7) is the recurring cost of three projects. If full consolidation is too disruptive, an intermediate step: shared SQL template generation + a single "domain contract" schema doc that CI diffs against both DBs.
5. **Front-end decomposition** (secondary, but worth noting): `app.js` 643KB / `detail.js` 879KB / `dialysis.js` 695KB / `gov.js` 551KB single files are past the point where the documented Edit-tool truncation incidents (`GAPS_AND_FINDINGS_REGISTER.md` §F) become a recurring data-loss risk for your own AI-assisted development workflow. Splitting by tab/route would reduce that risk materially.

---

## 5. Prioritized roadmap

**Now (days, mostly one-file changes):**
- Wire disambiguation picks → `staged_intake_feedback`; propagate replies → `template_sends`/`signals`
- Re-queue FL `deferred` LLC rows; set or explicitly abandon OpenCorporates
- Fix `fetchExcludedRefs` pagination, the two broken feedback joins, chain-connect starvation, fl-sos stage-2 pagination
- Unique index + upsert on `field_provenance` writes; record provenance post-write with filtered payload
- Add mirror freshness rows for all four mirror tables; extend disabled-cron watchdog to propagation crons
- Fix the CMS patient-count no-op (snapshot-date derivation) — 16 months of data is waiting

**Next (weeks):**
- Stand up Splink + libpostal; run the SF-link queue through it; auto-link/auto-reject bands with Decision Center for the middle
- Schedule the ORE engine with its review lane; county scraper fix (persist property_id/APN/situs/mailing) + recurring county cron — this also fuels the ORE address signal
- Queue policy sweep: drain, alert, or delete each orphan queue; render the missing review-counts lanes
- Watermark-based mirror sync replacing page ceilings; unify null semantics
- Listing-BD consumer: inbox filter + batch-draft wiring + contact dedupe (the producer already works)

**Later (quarter):**
- Cross-encoder + GLiNER party extraction over `sale_notes_raw` backlog; embedding blocker for hard entity cases
- Provenance unification (drain event logs or read-through); strict-mode expansion driven by now-accurate diagnostics
- Fetcher/extension monorepo + CI contract checks; dia/gov SQL template generation
- Signal-to-outreach automation for `state_lease_events`, `agency_risk_signals`, NPI signals (the tables exist; the paths don't)
- Archive-schema cleanup; routine `get_advisors` runs; front-end decomposition

---

## 6. Closing observation

The audit trail in this repo (GAPS_AND_FINDINGS_REGISTER, the round-numbered prompt docs, reversible backfill ledgers) shows a system that learns from its incidents unusually well. The pattern to break is that **learning currently lands in documents and monitors rather than in drains and feedback tables**. The single most valuable habit change: when a queue, signal, or metric is created, its consumer ships in the same round — and when a human makes a decision anywhere in the system, that decision is captured as a label. Do that, and the local-model layer in §4.3 compounds instead of starting cold.
