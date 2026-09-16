<!-- Converted 2026-09-16 by Cowork from the root file `LCC_Holistic_Audit_2026-05-17.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**Life Command Center**

Holistic Audit — Data, Research Prioritization, UX & BD Pipeline

May 17, 2026

*Prepared for Scott Briggs*

63 findings · 15 critical · 21 high · 22 medium · 5 low

**Executive Summary**

This audit was conducted over the full Life Command Center codebase (\~60k lines of application JS, 160 Supabase migrations across three databases, the Chrome extension, the Python lead-pipeline, and the docs/architecture corpus). Four parallel deep-dives ran across the scopes you selected: data model and ingestion, research-prioritization logic, UI/UX silent failures, and business-development pipeline integration. All findings here are current-state gaps — material already addressed in prior audits (GOV\_UX\_AUDIT\_REPORT, LCC\_FIX\_LIST rounds 1 and 2, docs/round\_76\* notes) was excluded.

**The cross-cutting pattern: collection without consequence**

A single theme threads through almost every finding. The LCC has built first-rate ingestion (Chrome extension, OM email, Copilot Studio, CMS sync, county records), first-rate data infrastructure (field-level provenance, source priority registry, merge function, 9+ data-quality views, listing verification cron, geocode backfill, cap-rate provenance ladder), and a sophisticated cadence engine with a 14-template library. But the glue between them is missing or partial in four critical spots:

1.  **Every entry path dead-ends at the row write.** CoStar sidebar captures, OM intakes, and new-contact writes land their rows and stop. None of them fire runListingBdPipeline, seed a cadence, or enqueue a research follow-up. The cadence engine and template library are starved for callers — the weekly template-health report shows **0 sends across all 14 templates in 120 days**. The system is a research database that does not advance leads.

2.  **The database knows more than the UI asks.** v\_data\_quality\_issues, v\_field\_provenance\_conflicts, v\_field\_provenance\_unranked, v\_llc\_research\_queue\_health, v\_cmbs\_pipeline\_health, llc\_research\_queue, ownership\_research\_queue, lcc\_health\_alerts — all exist, all are populated, all are queryable. None are rendered on gov.js, dialysis.js, detail.js, or the home dashboard. They live only in ops.js (the admin tab). The work is sitting in the database with no front door.

3.  **Ownership chain breaks in the dia domain.** resolveOwnerLinks in intake-promoter.js returns early for dialysis with owner\_resolution\_not\_implemented\_for\_dialysis. OM intake is the dominant entry path for dia — every property landing via OM today gets tenant, rent, and address but no recorded\_owner\_id. Downstream features that depend on owner linkage (nearby-owners, LLC research, Salesforce cross-reference) silently see fewer dia properties than gov.

4.  **Lists are sorted by recency, not by gap-weighted value.** gov.js, dialysis.js, and app.js sort listings/sales/leases by date desc with price only as a tiebreaker. The $40M new listing posted today appears above the $90M six-week-old listing whose owner has never been researched. Value times gap is computed nowhere.

5.  **Silent failure surfaces everywhere.** domainPatch ignores its return value before pushing provenance (so field\_provenance records writes that never landed). The Chrome extension shows nothing on auth/network failure. List-load catches log to console only — empty lists look identical to failed loads. There is no global window.error or unhandledrejection handler.

**What this means for the user objective**

Your stated goal is "driving the research and intelligence pipeline with minimal clicks pushing business development forward." Against that bar, the system today fails in three specific ways: (1) opening a property detail screen produces no next-action CTA — Scott has to manually decide what to do next; (2) the "highest-value research gaps right now" question has no single screen — gaps are siloed in four-plus views; and (3) when a research action is completed, it does not auto-seed an outreach touchpoint, so the work loops back into "more research" rather than escalating into "outreach started."

The good news is that almost every fix is wiring, not new construction. The cadence engine, signal taxonomy, template library, data-quality views, and provenance system are all built. They need three small bridges (signal-router, sidebar-to-BD trigger, OM-to-BD trigger), one unified ranking view (v\_next\_best\_action), and one "data completeness rail" component on detail.js — and a meaningful percentage of the gaps in this audit collapse.

**How to use this report**

  - **Top 10 priority actions** (next section) — what to fix first, in order, with rough effort sizing.

  - **90-day roadmap** (end of doc) — sequenced by leverage, grouping that lets a single PR close multiple findings.

  - **Sections A through D** — the full finding library, by theme, with file:line evidence and specific code-level fixes. Use as the punch list.

**Top 10 Priority Actions**

*The remediation order below is chosen so that each action either unblocks others, removes a silent-failure class, or converts a built-but-disconnected capability into user-visible value. Effort is rough engineering-days.*

|        |                                                                                                                                                                                                                                                                                                                                             |            |              |                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ | ------------------- |
| **\#** | **Action**                                                                                                                                                                                                                                                                                                                                  | **Effort** | **Impact**   | **Closes**          |
| **1**  | Fire runListingBdPipeline from the sidebar and OM intake success paths (not only from the SF webhook). This single change is the difference between research database and BD pipeline — every captured listing immediately triggers T-011/T-012 drafts to peer owners and nearby holders.                                                   | 1-2 d      | **CRITICAL** | A-1, D-1, D-5       |
| **2**  | Drain llc\_research\_queue and ownership\_research\_queue. Add a pg\_cron schedule for /api/llc-research-tick (already-built worker). Build a free SOS-direct scraper path as the user preference over OpenCorporates. Surface both queues in the UI inside gov/dia research modes ranked by linked property value.                         | 3-4 d      | **CRITICAL** | A-1, B-5, D-13      |
| **3**  | Wire resolveOwnerLinks for the dia domain. Remove the early-return at intake-promoter.js:1501; call reconcilePropertyOwnership after promoteDiaPropertyFromOm. Backfill every dia property with NULL recorded\_owner\_id where an OM exists.                                                                                                | 2 d        | **CRITICAL** | A-2                 |
| **4**  | Build v\_next\_best\_action UNION view. Pull from gov ownership/intel queues, dia clinic priority view, llc\_research\_queue, v\_data\_quality\_issues, provenance conflicts, and stale-listings. Score each row by linked-property estimated value times gap weight times decay. Render as the primary card on app.js Home above the fold. | 4-5 d      | **CRITICAL** | B-1, B-3, B-13      |
| **5**  | Fix the silent-write loop in sidebar-pipeline.js. domainPatch must throw on failure (or the caller must check .ok before pushProvenance). Add an ingest\_write\_failures table for triage. Without this, field\_provenance is recording writes that never landed and Phase 3 strict mode will trust ghost data.                             | 1-2 d      | **CRITICAL** | A-3                 |
| **6**  | Add "Data Completeness" rail to detail.js. Re-use gov.js \_completeness scoring; render the per-property %, the ranked list of missing high-value fields, and a "Fix the next gap" button that jumps to the first blank. Persist data\_completeness\_pct to the properties table so every list can sort by it.                              | 3 d        | **HIGH**     | B-2, B-15           |
| **7**  | Seed cadence on new-contact writes. After upsertSidebarContacts inserts a fresh row, call getCadenceState to initialize touch 0 and POST to inbox\_items with source\_type=new\_contact\_qualify. Mirror the same hook for contacts created via contacts-handler.                                                                           | 2 d        | **CRITICAL** | D-2, D-6            |
| **8**  | Sticky next-action bar on detail.js. 4-5 deterministic CTAs whose visibility is driven by gap state — Owner blank to "Research owner"; Owner filled, manager blank to "Look up manager"; all owner data present, no outreach to "Add to BD sequence". Every detail-screen visit ends with a forward step.                                   | 3 d        | **HIGH**     | B-10, B-9           |
| **9**  | Value-weighted sort on every list. gov.js:330, dialysis.js:243/737/8504, app.js listing/lease widgets — replace date-desc default with composite value\_score = COALESCE(asking\_price, estimated\_value, rent x GRM) x gap\_weight x decay. Keep date as toggle.                                                                           | 2 d        | **HIGH**     | B-3                 |
| **10** | Global error visibility. Add window.error + unhandledrejection handlers in app.js with toast + last-10 buffer. Audit all list loaders and async fetchers for swallowed catches — minimum required: failed loads render an inline \[Retry\] CTA, not an empty state. Extend toast duration by severity.                                      | 2 d        | **HIGH**     | C-5, C-6, C-9, C-10 |

*Together, items 1-5 are the highest-leverage interventions. They are mostly wiring of existing functions — none requires building a new subsystem. Items 1, 2, 5, and 7 are CRITICAL because every day they remain unfixed, the silent gap between database state and reality compounds.*

**Section A — Data Model & Ingestion**

17 findings ranked by severity. Theme: provenance and dedupe systems are sophisticated but have specific blind spots that compound silently. The most expensive: owner-linkage gap in dia (A-2) and provenance recording on failed writes (A-3).

**A.1. \[CRITICAL\] A-1 — llc\_research\_queue and ownership\_research\_queue accumulate forever; no cron, no drainer**

**Evidence:** api/admin.js:2623-2774 defines handleLlcResearchTick; api/\_shared/llc-research.js implements the worker

**Evidence:** supabase/migrations/\*.sql — zero cron.schedule entries for llc-research-tick (vs. lcc-auto-scrape-listings, lcc-availability-checker, lcc-merge-log-reconcile which all have schedules)

**Evidence:** sidebar-pipeline.js:6449 enqueues every new private-LLC owner

**Evidence:** sidebar-pipeline.js:2545 enqueues ownership\_research\_queue rows; grep for any consumer returns ONLY the writer

**Impact:** Every sidebar capture and OM intake adds rows to two queues that nobody drains. After the next bulk capture (the user mentioned CMBS Round 76ek imports), the queues will be in the thousands. v\_llc\_research\_queue\_health reports a growing count nobody is watching. The highest-value research target in the entire BD pipeline — the LLC behind every property owner — silently piles up while the system reports fine.

**Fix:** Add cron.schedule('lcc-llc-research-tick', '\*/30 \* \* \* \*', SELECT public.lcc\_cron\_post('/api/llc-research-tick?domain=both\&limit=50', '{}', 'vercel')) gated on OPENCORPORATES\_API\_KEY (or the planned SOS-direct handler). Build a parallel /api/ownership-research-tick worker that drains ownership\_research\_queue. Add UI surfaces in gov.js and dialysis.js research modes that render both queues ranked by linked-property estimated value, with one-click SOS-direct buttons (sosBtns helper at gov.js:2489 already exists).

**A.2. \[CRITICAL\] A-2 — Dialysis OM intake never populates properties.recorded\_owner\_id**

**Evidence:** intake-promoter.js:1501-1503

if (match.domain \!== 'government') return { ok: true, skipped: 'owner\_resolution\_not\_implemented\_for\_dialysis' };

**Evidence:** intake-promoter.js:663-770 — promoteDiaPropertyFromOm patches tenant, year\_built, lot\_sf, building\_size, anchor\_rent, but never touches recorded\_owner\_id; never calls reconcilePropertyOwnership (which IS exported from sidebar-pipeline.js:6742)

**Impact:** OM email is the dominant intake path for dia. Every property landing this way ends up with tenant/rent/address filled and owner NULL. Nearby-owners, LLC research enqueue, Salesforce account-link, and the planned nearby-owners outreach lists feature silently see fewer dia properties than they should. The entire dialysis BD pipeline is operating on incomplete ownership data.

**Fix:** Drop the dia early-return in resolveOwnerLinks; mirror the gov path (match true\_owners + recorded\_owners by ILIKE on snapshot.seller\_name). In intake-promoter.js post-promotion, await reconcilePropertyOwnership('dialysis', match.property\_id). Run a one-shot backfill on every dia property where recorded\_owner\_id IS NULL and a recent OM exists.

**A.3. \[CRITICAL\] A-3 — Sidebar provenance records reflect attempts, not successes**

**Evidence:** sidebar-pipeline.js:3611-3622 (and 3681-3691, 3451-3464, 4541-4555 — same pattern)

if (filteredTaxPatch && Object.keys(filteredTaxPatch).length \> 0) { await domainPatch('dialysis', \`tax\_records?...\`, filteredTaxPatch, '...'); // result ignored } if (existingTaxId) { await linkPublicRecord('dialysis', propertyId, 'tax', existingTaxId); pushProvenance(provCollect, 'tax\_records', existingTaxId, { ... }); // logs even if PATCH failed }

**Evidence:** sidebar-pipeline.js:704 — domainPatch only console.warn on failure; never throws; callers ignore returns

**Impact:** field\_provenance gets decision=write rows for PATCH operations that were rejected (FK violation, RLS, unique constraint, schema-drift columns missing). v\_field\_provenance\_current returns authoritative values that are NOT actually in the curated table. When Phase 3 flips more rules to strict mode, the system will block legitimate writes based on ghost provenance. This is the single biggest threat to the integrity of the provenance system you have built.

**Fix:** Two-part: (1) refactor pushProvenance to require the PATCH result's .ok flag — provenance only writes on success; (2) add an ingest\_write\_failures table that records every domainPatch rejection with record\_pk, source\_run\_id, error, timestamp. Surface in ops.js and the daily briefing.

**A.4. \[HIGH\] A-4 — intake-promoter ok=true on partial success leaves staged items stuck in review\_required**

**Evidence:** intake-promoter.js:2464

ok: \!\!(listingResult?.ok || diaLeaseResult?.ok || contactResult?.ok),

**Evidence:** intake-promoter.js:2494 — status flip to finalized is gated only on listingResult.ok; staged\_intake\_promotions audit row is also gated on listingResult.ok

**Impact:** A promotion that wrote lease + broker contact + property patch but failed the listing INSERT returns success to the caller, never gets a promotion audit row, and the staged item sits in review\_required indefinitely. Daily briefing under-counts intakes. The user thinks the queue is empty when there are partial-success rows hanging.

**Fix:** Change the status-flip gate at 2494 to (listingResult?.ok || diaLeaseResult?.ok). Better: persist ok=false when any expected sub-write failed and add a partial\_success state so the user can retry just the missing piece.

**A.5. \[HIGH\] A-5 — Duplicate CREATE TABLE IF NOT EXISTS migrations with conflicting schemas**

**Evidence:** supabase/migrations/20260414213000\_dedupe\_leases\_and\_rent\_schedule.sql:118 — lease\_extensions PK extension\_id BIGSERIAL; columns prior\_expiration, option\_exercised BOOLEAN, source\_confidence TEXT

**Evidence:** supabase/migrations/20260416231000\_lease\_extensions\_and\_rent\_schedule.sql:13 — same table name, PK id SERIAL; columns term\_added\_months, new\_rent\_psf, data\_source — completely different schema

**Evidence:** Same conflict in lease\_rent\_schedule (line 163 vs line 40). property\_sale\_events has property\_id TEXT in dia vs BIGINT in gov.

**Impact:** Same risk class as the gov.property\_financials shadow that caused Round 76ek.k. Whichever migration ran first wins; the second's IF NOT EXISTS is a silent no-op. Writers and views referencing columns from the wrong schema silently fail with PostgREST 400/401 errors that don't carry a useful trace.

**Fix:** Run a pg\_catalog audit on dia + gov: SELECT every public table any IF NOT EXISTS migration tries to create, diff actual columns vs intent. Author an ALTER TABLE ADD COLUMN IF NOT EXISTS reconciliation migration. Add a check-functions-style pre-deploy guard that fails CI when two migrations declare the same table with different columns.

**A.6. \[HIGH\] A-6 — recorded\_owners dedupe is name-only; collapses cross-state collisions and misses cross-suffix variants**

**Evidence:** sidebar-pipeline.js:6315-6321

function normalizeOwnerName(n) { return n.trim().toLowerCase() .replace(/\\b(llc|inc|corp|ltd|co|company|group|partners|lp|llp)\\b\\.?/gi, '') ... } ownerIds.set(normalizedName, id); // keyed only on normalized name, no state

**Impact:** XYZ HOLDINGS LP and XYZ HOLDINGS LLP collapse correctly. But XYZ HOLDINGS and XYZ HOLDINGS GROUP become different keys — likely the same entity, now duplicated. And two LLCs named Sunrise Holdings LLC in CA and FL collapse into one row. LLC research runs multiple times against silent duplicates; ownership\_history fans out across the dupes; nearby-owner counts overstate holdings.

**Fix:** Key the dedupe on (normalized\_name, address\_state) — or (normalized\_name, filing\_id) where filing\_id is known. When two rows match by normalized name but differ by state, route to a manual-merge queue in the LCC UI instead of silently picking one. Reuse the contact merge UX (contacts-ui.js:776).

**A.7. \[HIGH\] A-7 — Tenant change from OM doesn't propagate to sales\_transactions or available\_listings denormalized tenant copies**

**Evidence:** intake-promoter.js:683 — promoteDiaPropertyFromOm patches properties.tenant only when NULL (fill-blanks-only rule)

**Evidence:** No code in intake-promoter, sidebar-pipeline, or canonicalizer loops over sales\_transactions.tenant / available\_listings.tenant\_agency / leases.tenant for the same property\_id after an OM lands

**Impact:** When an operator transition is detected (e.g. independent dialysis sells to DaVita), properties.tenant catches up if NULL but every historical sale\_transactions row and active listing still shows the old name. Sales-comps export and Sold-by-Tenant Salesforce reports double-count the brand.

**Fix:** Add propagateTenantToDownstreamTables(domain, propertyId, newTenant) called after promoteDiaPropertyFromOm. Conditionally PATCH sales\_transactions.tenant, available\_listings.tenant\_agency, leases.tenant on the same property\_id where mismatched AND the OM lease time-overlaps. Gate every PATCH through lcc\_merge\_field so curated values aren't clobbered.

**A.8. \[HIGH\] A-8 — Cross-domain contact dedupe missing — a broker working both sectors exists as two distinct rows**

**Evidence:** sync.js — nightly cross-domain-match job exists but its scope is properties, not contacts

**Evidence:** api/\_shared/entity-link.js ensureEntityLink matches by (workspace\_id, source\_system, external\_id) — guarantees one entity per source-system, but dia.contacts and gov.contacts each get their own external\_identity

**Evidence:** No code joins dia.contacts to gov.contacts on lowercased email or phone

**Impact:** A broker listed on a federal-office gov sale and a dialysis sale exists as two entities, two unified\_contacts, two cadence states. Pipeline-by-broker reports, Salesforce auto-link decisions, and all-deals-by-this-person queries return inconsistent results.

**Fix:** Add a nightly cross-domain-contact-reconcile job (parallel to cross-domain-match) that joins dia.contacts and gov.contacts on lowercased email (NOT name — too noisy) and registers both as external\_identities of the same canonical LCC entity. Mirror the lcc-merge-log-reconcile pattern that already handles property merges.

**A.9. \[MEDIUM\] A-9 — Matcher-rejected property creates a silent duplicate instead of routing to review**

**Evidence:** sidebar-pipeline.js:2670-2730 — when matcher\_property\_id from CoStar verify-auto-create is not in domain DB (line 2663), code falls back to address lookup. If all address fallbacks miss (legit case: normalizer mangled a unit suffix), a NEW property row is INSERTED.

**Impact:** Recurring CoStar comp captures create distinct property rows per capture. No soft-duplicate review queue. The duplicate is born and silently inherits its own ingestion history.

**Fix:** When matcher\_property\_id is provided but doesn't resolve in this domain, INSERT into a property\_match\_review queue instead of INSERTing a new property. Surface in the LCC dashboard with a Confirm new property / Merge with existing two-click action.

**A.10. \[MEDIUM\] A-10 — recorded\_owner\_address from CoStar can carry broker mailing address, not legal owner — no anti-pattern guard**

**Evidence:** sidebar-pipeline.js:6361-6396 — PATCHes recorded\_owners.address from CoStar metadata; Round 76co added a priority filter but no this-address-belongs-to-listing-broker detection (analogous to isFederalOwnerAntiPattern)

**Impact:** When CoStar shows the listing broker's office address in the owner row (common for Newmark/JLL representation), the bad address propagates through LLC research (which filters by state) and Salesforce auto-link by city/state. Owner outreach mail goes to the broker's office.

**Fix:** Add isBrokerOfficeAddressLeak() — if address matches any known broker firm's office (brokers.firm\_address ILIKE) AND owner\_name is an LLC, skip the address patch and write a data\_corrections row for manual review.

**A.11. \[MEDIUM\] A-11 — Tenant re-capture from CoStar can't refresh stale tenant on properties first ingested via OM**

**Evidence:** sidebar-pipeline.js:2815 — property upsert with isHistoricalCompCapture branch. Through filterByFieldPriority, CoStar (priority 70) is gate-blocked by prior om\_extraction write (priority 30)

**Impact:** A property whose original OM was correct on day 1 but whose tenant has since changed (operator transition) shows the old tenant forever. CoStar re-captures can't update it because om\_extraction's prior write outranks. The CMS un-truncation backfill (Round 76gn.c) is unrelated; this is a different stuck-tenant case.

**Fix:** Either make tenant a confidence-tiered field (CoStar re-capture with confidence \>= 0.8 lets the write through) or add a manual-resync UI that bumps the write through a manual\_edit source path. Long-term: an operator-transition detector that compares CMS chain\_organization deltas with property tenant.

**A.12. \[MEDIUM\] A-12 — Geocode backfill writes lat/lng without provenance — Google Maps source is invisible to priority system**

**Evidence:** api/\_handlers/geocode-backfill.js — PATCHes latitude/longitude directly; grep for recordFieldProvenance returns zero

**Impact:** When a manual edit later corrects lat/lng, there is no provenance record showing the original came from google\_maps\_geocode confidence 0.85. Strict-mode rules for lat/lng can't fire because the priority system never saw the geocoder write.

**Fix:** Add recordFieldProvenance calls in geocode-backfill with source='census\_geocode' (priority 50) or source='google\_maps\_geocode' (priority 55). Seed field\_source\_priority for dia/gov properties.latitude/longitude.

**A.13. \[MEDIUM\] A-13 — CMS chain\_organization to properties.tenant propagation absent**

**Evidence:** Grep for any code that listens for medicare\_clinics.chain\_organization change and updates downstream tables returns zero. Round 76gn.c goes property to CMS (un-truncation), no reverse direction.

**Impact:** When CMS publishes a chain ownership change (DaVita acquires independent operator's clinics), medicare\_clinics.chain\_organization updates via the next CMS sync but properties.tenant for those clinics remains the old operator name. Sales-comps view tenant column is wrong; the dia\_canonical\_tenant rules can't reach those rows.

**Fix:** After every CMS sync, run a propagation pass: for each medicare\_clinics row whose chain\_organization changed since the last sync, if the linked properties.tenant's current provenance source is cms\_sync, patch through lcc\_merge\_field with the new chain name (source=cms\_sync, confidence=0.9).

**A.14. \[MEDIUM\] A-14 — lcc-merge-log-reconcile cron only repoints asset entities; contacts/orgs/leads remain orphaned**

**Evidence:** api/admin.js:243-247

\`entities?entity\_type=eq.asset\&domain=eq.${pgFilterVal(dom)}\` + \`\&or=(metadata-\>\>domain\_property\_id.eq.${pgFilterVal(dropId)},\` + \`metadata-\>\_pipeline\_summary-\>\>domain\_property\_id.eq.${pgFilterVal(dropId)})\`

**Impact:** After a property merge, broker contacts and pipeline-lead entities that point at the dropped property\_id stay pointed at it. Re-promotes link to the kept property; old entities become stale duplicates.

**Fix:** Drop the entity\_type=eq.asset filter (or add sibling queries for person/organization). Ensure every entity carrying domain\_property\_id metadata gets repointed.

**A.15. \[MEDIUM\] A-15 — staged\_intake\_promotions audit insert is best-effort with no fallback or retry**

**Evidence:** intake-promoter.js:2508-2510

} catch (err) { console.warn('\[intake-promoter\] staged\_intake\_promotions insert failed (non-fatal):', err?.message); }

**Impact:** If LCC Opps is briefly unreachable, the promotion audit row is lost — but the actual domain DB writes already landed. Daily briefing's New OM Intakes silently undercounts. Audit trail incomplete.

**Fix:** Buffer to a local table (or use data\_corrections itself) with a retry cron. Surface failures into lcc\_health\_alerts.

**A.16. \[LOW\] A-16 — auto\_supersede\_expired\_leases SQL trigger bypasses provenance system**

**Evidence:** CLAUDE.md auto\_supersede\_expired\_leases trigger description — fires from SQL, never inserts to field\_provenance

**Impact:** Strict-mode rules for leases.status can't be authored (auto-supersede should not flip a lease\_confirmed anchor source) because the trigger is provenance-blind. v\_field\_provenance\_unranked won't surface trigger-driven writes.

**Fix:** Have the trigger also INSERT a field\_provenance row tagged source=auto\_supersede\_trigger with priority 20. Then unranked-fields detector covers it.

**A.17. \[LOW\] A-17 — domainPatch error logs lack record\_pk, sidebar\_run\_id, source — failures hard to triage**

**Evidence:** sidebar-pipeline.js:707-713 — log line is { domain, path, status, error, fields }; no extracted PK, no correlation\_id back to staged\_intake\_items.intake\_id

**Impact:** When a PATCH fails in production, only signature in Vercel logs is the path string. Hard to grep across runs.

**Fix:** Extract pk from path (regex =eq\\.(\\d+)) into a record\_pk field; thread sidebarRunId through. Optionally log to ingest\_write\_failures (A-3 fix).

**Section B — Research Prioritization & Gap Routing**

15 findings. Theme: the database knows the gaps; the UI does not ask. Building the unified v\_next\_best\_action view (B-1) and the per-property fill-next-gap rail (B-2) is the central unlock.

**B.1. \[CRITICAL\] B-1 — No unified next-best-action queue; gaps siloed across 4+ screens**

**Evidence:** api/queue.js:66-197 exposes 8 distinct views (my\_work, team, inbox, sync\_exceptions, research, entity\_timeline, data\_quality, counts)

**Evidence:** research\_tasks is a narrow manual table (queue.js:110-130, research-loop.js:82)

**Evidence:** Gov ownership queue: gov.js \~1100; gov intel queue: gov.js \~1378; dia clinic leads: dialysis.js:6234 (v\_clinic\_research\_priority)

**Evidence:** v\_data\_quality\_\*, v\_field\_provenance\_\*, v\_llc\_research\_queue\_health, v\_cmbs\_pipeline\_health rendered ONLY in ops.js:1020-1190

**Impact:** Scott must navigate Home to Gov-research to Dia-research to Ops-quality to individual property detail to see all gaps. No single ranked list of fix-these-N-things-today-in-this-order. This is the user's literal stated question, unanswered.

**Fix:** Build v\_next\_best\_action as a UNION ALL view across gov + dia property queues, llc\_research\_queue, ownership\_research\_queue, v\_data\_quality\_issues (filtered to severity \>= medium), v\_field\_provenance\_conflicts, and stale-listings. Each row carries comparable value\_score and gap\_score. Render as the primary above-the-fold card on app.js Home. Top-10 of v\_next\_best\_action is the today's research experience.

**B.2. \[CRITICAL\] B-2 — Property detail screen has no missing-data panel and no fix-next-gap flow**

**Evidence:** detail.js (12.7k lines) — has tabs for Operations, Financial, Quality, Lease, etc. No Missing Data panel. Grep for missing.\*field|next.\*action|completeness|fill the gap returns only the AI prompt at line 1800 (Recommended next 3 actions — text, not deterministic walker).

**Evidence:** Property completeness scoring (computeCompleteness) lives only in gov.js:1897, 2126, 2424 inside the research wizard cards — never rendered on the standard detail screen

**Impact:** When Scott opens a detail page, he has to scan tabs visually to spot blanks. The completeness % is computed in one place, used for one view, and thrown away. The user can't see at a glance this property is 40% researched — fill these gaps next.

**Fix:** Add a Data Completeness rail on detail.js showing the same \_completeness percentage plus a Fix the next gap button that jumps to the first missing high-value field (owner to manager to mailing to email to loan to rent). Re-use the guidedField machinery already in gov.js. Persist data\_completeness\_pct to dia/gov.properties as a generated column so every list everywhere can sort by it.

**B.3. \[CRITICAL\] B-3 — Listings, leases, sales sorted by recency, not by value times gap severity**

**Evidence:** gov.js:330 — available\_listings sorted by listing\_date.desc.nullslast, asking\_price.desc.nullslast (price is only a within-day tiebreaker)

**Evidence:** dialysis.js:243, 737, 8504 — sales/listings all sorted by sale\_date / listing\_date desc

**Evidence:** app.js listing/lease widgets never sort by estimated\_value, commission\_potential, firm\_term\_remaining, or hot-buyer proximity

**Impact:** A $40M new listing posted today appears at the top, but a 6-week-old $90M listing with no owner researched is buried below 250 rows. Highest-commission gaps stay invisible.

**Fix:** Replace default sort with composite value\_score = COALESCE(asking\_price, estimated\_value, rent\*GRM) times gap\_weight times time\_decay. Expose toggle chips (By value gap / By recency / By owner-research need). The gov.js intel queue already does this correctly at gov.js:1424-1438 — promote that pattern across all lists.

**B.4. \[HIGH\] B-4 — Data-quality and provenance-conflict views only surfaced in ops.js (admin tab), not where work happens**

**Evidence:** ops.js:1196, 1336, 1471 are the ONLY consumers of v\_data\_quality\_summary / v\_data\_quality\_issues

**Evidence:** ops.js:1075 is the only consumer of v\_field\_provenance\_actionable

**Evidence:** Grep these views in gov.js, dialysis.js, detail.js, app.js returns zero matches

**Impact:** When Scott reviews a property in the gov tab, the LCC silently knows the address has a duplicate, the owner write was rejected by a higher-priority source, or the listing failed its last availability probe — but doesn't tell him. He has to remember to visit Ops Admin.

**Fix:** Surface a Data alerts (3) chip on each property card and detail screen, pulling from v\_data\_quality\_issues filtered by property\_id (the migration already supports the join). Wire v\_field\_provenance\_actionable into the Ownership card inline.

**B.5. \[HIGH\] B-5 — llc\_research\_queue has cron-drainer code (without a cron) and zero UI surface**

**Evidence:** api/admin.js:2604-2757 drains the queue. CLAUDE.md:511-512 documents v\_llc\_research\_queue\_health on both gov and dia.

**Evidence:** Grep llc\_research\_queue in gov.js, dialysis.js, detail.js, app.js, ops.js returns zero UI references

**Impact:** Without OPENCORPORATES\_API\_KEY (the user's stated preference), every new private-LLC owner sits queued forever — and even with the key, no one can flag, escalate, or hand-research from the UI. The system accumulates its highest-value research target with no human funnel.

**Fix:** Add an Owner Research Queue tab inside gov.js and dialysis.js research modes that renders llc\_research\_queue rows ordered by linked-property estimated\_value. Include SOS-direct buttons (sosBtns helper at gov.js:2489 exists). One-click Mark researched writes back to recorded\_owners.manager\_name / registered\_agent\_name. Combine with A-1 fix.

**B.6. \[HIGH\] B-6 — Strategic priority engine for the daily briefing ignores research gaps entirely**

**Evidence:** api/\_shared/briefing-data.js:103-156 — scoreItem() scores DEAL/REVENUE/PURSUIT/RELATIONSHIP keywords on inbox + my\_work + sf\_activity. Never reads v\_data\_quality\_issues, research\_tasks, v\_clinic\_research\_priority, or llc\_research\_queue.

**Evidence:** briefing-data.js:435 buildStrategicPriorities composes today\_top\_5 from only those three pools

**Impact:** The daily briefing — Scott's first read of the day — surfaces follow up on emails but never fill the owner for this $50M gov lease that expires in 14 months and has no recorded\_owner. High-value research gaps are invisible at the briefing layer.

**Fix:** Extend buildStrategicPriorities to pull top-N research-gap rows from v\_next\_best\_action (B-1) and inject as a new tier research\_gap between strategic and important. Add top\_research\_gaps field to today\_priorities in the payload contract (docs/architecture/daily\_briefing\_payload\_contract.md:84).

**B.7. \[HIGH\] B-7 — Per-field freshness/decay only tracked for listing URLs — leases, owners, rents, cap rates have no verified\_at discipline**

**Evidence:** listing\_verification\_history and consecutive\_check\_failures exist for available\_listings. medicare\_clinics.hours\_last\_checked\_at exists.

**Evidence:** Grep verified\_at|last\_checked\_at|stale\_at against leases, recorded\_owners, sales\_transactions, loans schemas returns nothing. field\_provenance records recorded\_at per write but there is no view fields-not-re-verified-in-N-months ranked by property value.

**Impact:** A 4-year-old annual\_rent value with no escalator silently powers cap-rate calcs and lease-comps exports. The user explicitly flagged this: lease rent goes stale, cap rates go stale, owner can change.

**Fix:** Add v\_stale\_curated\_fields view: per (table, field), surface records where (now - max(field\_provenance.recorded\_at)) \> field\_source\_priority.stale\_after. Render in a Re-verify panel on detail.js and as a digest section in the daily briefing.

**B.8. \[MEDIUM\] B-8 — Gov research wizard advances to NEXT QUEUE ROW, not next gap on same property**

**Evidence:** gov.js:2536, 2017 — Save & Next calls researchSave() to researchNav(1) (advance index). The wizard has internal step nav (govStepNav at gov.js:1600) but Next exits the property as soon as the current step's primary action fires.

**Impact:** A property may have owner filled but manager/mailing/lender/rent all blank. User clicks Save, jumps to a different property's owner step, loses context. The graph-walking flow the user described (look up the LLC's manager, find contact info, add to outreach) is broken.

**Fix:** Change Save & Next to advance within the same property if \_completeness \< 100, only jumping to the next queue row when the current property is fully researched or explicitly skipped. Mirror in dialysis.js clinic leads.

**B.9. \[MEDIUM\] B-9 — Research completion doesn't hand off to outreach/cadence**

**Evidence:** closeResearchLoop (api/\_shared/research-loop.js:82-224) creates a follow-up action\_item only when followupTitle is passed; gov.js / dialysis.js researchMark calls don't pass one

**Evidence:** cadence-engine.js is fed by separate touchpoint records, not auto-seeded from a freshly researched owner

**Impact:** Scott researches an owner, hits Approve, and nothing routes the new contact into a 7-touch prospecting sequence. The BD pipeline doesn't advance.

**Fix:** On research approval where recorded\_owners.contact\_email or phone is filled, auto-call getCadenceState({ entity\_id: ownerEntityId }) in cadence-engine.js:65 to seed touch \#1 due today and surface in My Work.

**B.10. \[MEDIUM\] B-10 — Property detail screen has zero deterministic next-action CTAs**

**Evidence:** detail.js — each tab ends with same generic toolbar (Export OM / Export BOV). No Mark researched, Send to BD queue, Add to outreach, Schedule call, Save as listing target.

**Evidence:** AI Assistant section (detail.js:1800, 5781) generates text recommendations but offers no clickable next step

**Impact:** Dead-end interactions. User reaches a detail screen, reads, then has to manually re-navigate to act. The minimal-clicks-pushing-BD-forward objective fails at the most-visited screen.

**Fix:** Add a sticky bottom action bar with 4-5 deterministic next-action buttons whose visibility is driven by gap state: Owner blank to Research owner; Owner filled, manager blank to Look up manager; all owner data present, no outreach to Add to BD sequence; listing active, no peer-owner sweep to Run T-011 BD pipeline.

**B.11. \[MEDIUM\] B-11 — Provenance conflicts and unranked fields are admin-only; user has no inbox for decisions-to-make**

**Evidence:** ops.js:1075-1190 renders v\_field\_provenance\_conflicts and v\_field\_provenance\_unranked as informational widgets. No filter conflicts-on-properties-I'm-working-on. No bulk-resolve. No assignment.

**Impact:** Conflicts accumulate. A skip on recorded\_owners.manager\_name from a low-priority source is a signal that higher-priority data has aged out — exactly the cue Scott would want to re-research the owner.

**Fix:** Treat skip/conflict rows as inbox items: write them into inbox\_items with source\_type=provenance\_conflict so they flow through the same triage UI as flagged emails. Score by linked-property estimated\_value in scoreItem().

**B.12. \[MEDIUM\] B-12 — lcc\_health\_alerts only surfaced in the daily briefing, not real-time**

**Evidence:** CLAUDE.md:177-205 describes v\_cron\_health\_summary and lcc\_health\_alerts. Grep across app.js, gov.js, dialysis.js, detail.js returns zero matches. Only the briefing assembler reads it.

**Impact:** If the availability-checker is bot-blocked for 12 hours, listing freshness silently degrades; Scott learns the next morning.

**Fix:** Add a div id=systemAlerts banner at the top of app.js home that polls lcc\_health\_alerts every 5 min and surfaces unresolved rows. Link the existing offline indicator dot at app.js:5152 to the same surface.

**B.13. \[LOW\] B-13 — Home dashboard Research pulse card points at the wrong table**

**Evidence:** app.js:6094-6098 — Research tile shows c.research\_active (count of research\_tasks rows). That table is fed by closeResearchLoop and manual posts. Does NOT include llc\_research\_queue, gov ownership queue, or dia v\_clinic\_research\_priority.

**Impact:** The number on Home is wrong. User looks at Research: 12 while there are 8,000+ rows of unowned LLCs queued.

**Fix:** Compute research\_active = research\_tasks.active + llc\_research\_queue.queued + v\_clinic\_research\_priority WHERE not resolved + v\_ownership\_research\_priority WHERE not resolved. Expose as a single MV (mv\_research\_backlog) refreshed every 5 min like mv\_work\_counts.

**B.14. \[LOW\] B-14 — Inbox triage doesn't auto-link OM-landed intake events to a deterministic research path**

**Evidence:** fetchNewIntakes (briefing-data.js:293-330) surfaces X-new-deals-landed-overnight. No action attached — user clicks through to the same dead-end detail screen.

**Impact:** The intake event is a perfect trigger for a research-task burst. The chain is missing.

**Fix:** In intake-promoter.js success path, enqueue research\_tasks for each blank field above a value threshold (e.g., asking\_price \> $5M and owner is null).

**B.15. \[LOW\] B-15 — Completeness % computed but never persisted as a sortable column**

**Evidence:** gov.js:1460, 1898, 2126 compute \_completeness client-side per render. The property row has no data\_completeness\_pct column. Other surfaces (listings, BD inbox, briefing) can't sort by it.

**Impact:** A 20%-researched property looks identical to a 95% one in every list outside the wizard.

**Fix:** Persist data\_completeness\_pct to dia/gov.properties as a generated column (or scheduled writer). Once persisted, every B-3 sort can use it as a tiebreaker or primary key.

**Section C — UI/UX & Silent Failures**

16 findings. Theme: failures on async paths and irreversible actions are invisible because UX leans on 3-second toasts and console.error. Two of the four critical findings involve the Chrome extension, which is the most-used surface.

**C.1. \[CRITICAL\] C-1 — Contact merge is irreversible with no confirmation**

**Evidence:** contacts-ui.js:776-785 (executeMerge), app.js:3082-3094 (ucMerge)

async function executeMerge(queueId, contactA, contactB) { try { await contactsApi('POST', 'merge', {}, { keep\_id: contactA, merge\_id: contactB, queue\_id: queueId }); ...

**Impact:** One click and contact B is permanently merged into A. No confirm(), no lccConfirm(), no undo. The sibling dismissMergeAction is also no-confirm. Stray click during merge-queue review wipes out real CRE contacts.

**Fix:** Wrap executeMerge, dismissMergeAction, ucMerge, ucDismissMerge in await lccConfirm('Merge ' + nameB + ' into ' + nameA + '? This cannot be undone.', 'Merge').

**C.2. \[CRITICAL\] C-2 — Chrome extension Send to LCC silently fails on auth or server error**

**Evidence:** extension/background.js:39-73

const result = await resp.json(); if (result.ok) { chrome.action.setBadgeText({ text: 'check', tabId: tab.id }); } // no else branch — no notification, no badge, no log. Also doesn't check resp.ok.

**Impact:** Scott right-clicks Send to LCC on a CoStar listing, walks away thinking it intook, comes back hours later — nothing exists. The primary intake-on-the-fly path is invisible on failure.

**Fix:** Add else branch: chrome.action.setBadgeText({text:'X', color:'\#ef4444'}) + chrome.notifications.create({title:'LCC intake failed', message: result.error || 'HTTP '+resp.status}). Also check \!resp.ok before parsing JSON.

**C.3. \[CRITICAL\] C-3 — Sidebar parser has no stale-parser health signal**

**Evidence:** extension/background.js, extension/content/costar.js, extension/sidepanel.js — badge only shows positive states (CS / LN / CX / OL / check). No surface reports parser-extracted-0-fields-on-this-page or no-successful-capture-in-last-5min on a costar.com tab

**Impact:** When CoStar changes their DOM (which they have, multiple times), captures silently produce blank payloads. field\_provenance fills with nulls. The user has no idea until SQL audit catches it weeks later.

**Fix:** After each capture, count populated keys. If under 3 fields on a property-detail URL, set badge to ? yellow + log to chrome.storage.local.lcc\_health\[\] ring buffer. Surface Recent captures panel in sidepanel.html showing last 10 with field counts. Alert thresholds in the parser nightly health summary.

**C.4. \[CRITICAL\] C-4 — \_intelClearIntake wipes 30KB+ of unsaved OM text/analysis with no confirm**

**Evidence:** detail.js:7775-7787 (rendered at 7457)

function \_intelClearIntake() { \_udIntakeState = { fileName:'', text:'', analysis:'', ... }; refreshDetailPanel(); }

**Evidence:** \_udFormDirty beforeunload guard exists but does NOT cover \_udIntakeState

**Impact:** User pastes 50KB OM body, clicks Analyze, reads AI response, accidentally clicks Clear — gone. Re-paste required.

**Fix:** if (\_udIntakeState.text || \_udIntakeState.fileName || \_udIntakeState.analysis) { if (\!(await lccConfirm('Clear all intake text, file, and analysis?', 'Clear'))) return; }

**C.5. \[HIGH\] C-5 — No global window.error or unhandledrejection handler**

**Evidence:** extension/background.js:9 has one. app.js, gov.js, dialysis.js, detail.js, ops.js — zero global handlers. Any uncaught error in a render path silently dies in console.

**Impact:** Scott sees a stale view, unsure if anything is broken. Bugs accumulate undetected.

**Fix:** Add to app.js bootstrap: window.addEventListener('error', e =\> showToast('Unexpected error: '+e.message, 'error')); window.addEventListener('unhandledrejection', e =\> showToast('Background task failed: '+(e.reason?.message||e.reason), 'error')); Stash last 10 in localStorage for a Recent errors diag pane.

**C.6. \[HIGH\] C-6 — List loaders fail silently — empty list looks identical to load failure**

**Evidence:** contacts-ui.js:765-773 (loadMergeQueue), and similar pattern in gov.js:4293, 4467, 4490, 8270, 8286

} catch (e) { console.error('Failed to load merge queue:', e); // silent } renderContactsPage(); // renders empty list as if zero items

**Impact:** Scott opens Merge Queue, sees 0, assumes nothing to do, ignores it. Reality: load 500'd.

**Fix:** In each list-load catch, also showToast('Failed to load merge queue: ' + e.message, 'error') and render an inline \[Retry\] CTA in the empty state. Apply across all list loaders systematically.

**C.7. \[HIGH\] C-7 — Pipeline-table and players-table search re-render on every keystroke (no debounce)**

**Evidence:** gov.js:5071 — oninput=govPipelineSearch=this.value;govRenderPipelineTable()

**Evidence:** gov.js:9233 — oninput=govPlayersSearch=this.value;govPlayersExpandedIdx=-1;renderGovTab()

**Evidence:** Other search fields use debounceXxxSearch helpers (app.js:1595, 2505, 2640)

**Impact:** Typing in Pipeline/Players filter feels laggy on large datasets. Keystrokes drop on slower hardware.

**Fix:** Wrap in debounceGovSearch(this.value, 'pipeline', govRenderPipelineTable) matching the existing pattern.

**C.8. \[HIGH\] C-8 — \_entityApiFetch returns null on \!resp.ok; callers render Loading forever**

**Evidence:** detail.js:10242-10247

async function \_entityApiFetch(url) { const res = await fetchFn(url, { headers: \_entityApiHeaders() }); if (\!res.ok) return null; return res.json(); }

**Evidence:** Same pattern at app.js:4675 (smart\_reschedule)

**Impact:** Scott opens Entity detail, panel hangs on Loading with no error. Smart reschedule UI continues as if no data existed.

**Fix:** Return { ok: false, status: res.status } and have callers showToast + render an inline retry CTA. Or throw on \!resp.ok and let a global handler catch.

**C.9. \[HIGH\] C-9 — 3-second toast is too short for failure feedback; no error tally**

**Evidence:** app.js:961-973 — setTimeout 3000 ms with no severity differentiation; no click-to-dismiss; no persistent X-errors pill

**Impact:** Glance away during a save and miss every error. No way to recover the message.

**Fix:** Type-aware durations (success 3s, info 4s, warning 6s, error 8s). Add click-to-dismiss. Add a persistent 3-errors pill in the header opening last-N-toasts list.

**C.10. \[HIGH\] C-10 — \_udBtnGuard re-enables button on exception but doesn't toast — flicker, then looks fine**

**Evidence:** detail.js:32-46

try { await fn(...args); \_udFormDirty = false; } finally { btn.disabled = false; ... } // exception then button re-enabled (good), no toast (bad)

**Impact:** Save flickers, button re-enables, user thinks it saved when in fact it failed.

**Fix:** Catch in the guard and showToast('Action failed: '+e.message, 'error') before swallowing or rethrowing. Cover both \_udBtnGuard and \_udActionBtnGuard.

**C.11. \[HIGH\] C-11 — Empty-result re-fetches every tab visit (spinner shows on legitimately empty filter)**

**Evidence:** dialysis.js:8496-8513

if (diaSalesView === 'available' && (\!diaAvailListings || diaAvailListings.length === 0) && \!diaSalesLoading) { diaSalesLoading = true; ... }

**Evidence:** Same pattern likely in gov.js:8278

**Impact:** Wasted API calls. User perception of still-loading when filter genuinely returned zero rows.

**Fix:** Track diaAvailListingsLoadedAt timestamp. Use diaAvailListings === null (uninitialized) vs diaAvailListings === \[\] (loaded, empty) to distinguish states.

**C.12. \[MEDIUM\] C-12 — Inconsistent confirmation UX (native confirm vs lccConfirm vs none)**

**Evidence:** dialysis.js:2535, 2572, 3185, 3247, 3773 and detail.js:989 use native confirm(). The rest uses lccConfirm(). Plus the no-confirm cases in C-1.

**Impact:** Inconsistent visual language. Native confirm() blocks JS thread, can't show formatted text or Don't-ask-again toggles.

**Fix:** Migrate all confirm() calls to await lccConfirm(). Add eslint rule banning confirm(.

**C.13. \[MEDIUM\] C-13 — OM intake analysis lost on panel close — no in-flight indicator**

**Evidence:** detail.js:7636-7673 (\_intelAnalyzeIntake) — if user closes detail panel while invokeLccAssistant in flight, the await resolves but refreshDetailPanel has no effect; state lost

**Impact:** Scott starts analysis, closes panel to do something else, comes back — has to re-run.

**Fix:** Persist \_udIntakeState keyed by property\_id in sessionStorage. Add a header pill: Analysis running for 1234 Main St (2 min).

**C.14. \[MEDIUM\] C-14 — saveLead validation is partial; bad values can save with vague failed-to-update message**

**Evidence:** gov.js:2890-2918

if (rba) propPatch.rba = rba; if (landAcres) propPatch.land\_acres = landAcres; ... if (Object.keys(propPatch).length \> 0) { try { await patchRecord(...) } catch (...) { \_leadPartialWarnings.push('property details'); } }

**Impact:** Bad data goes in (year\_built=99999, cap\_rate=500%). Partial-reject messages show Saved with warnings — failed to update: property details without identifying which field.

**Fix:** Add \_validateLeadFields() before patchRecord. Range-check year\_built between 1850 and 2030, cap\_rate between 0 and 25, etc. Toast field-level errors before submit. Map partial-failure messages to specific fields.

**C.15. \[MEDIUM\] C-15 — Offline toast disappears in 3s; no persistent offline banner**

**Evidence:** app.js:7291-7292 — window.addEventListener('offline', function() { showToast('You are offline — changes may not save', 'error'); })

**Impact:** Scott in an underground parking garage saves a research lead, sees a green-looking UI, thinks it saved, drives away.

**Fix:** Toggle a persistent div id=offlineBanner class=banner-offline (Offline — saves disabled) in index.html. Disable Save buttons while offline.

**C.16. \[MEDIUM\] C-16 — No background-job visibility for end user (LLC research, intake pipeline, CMBS health)**

**Evidence:** Grep llc\_research\_queue, v\_cmbs\_pipeline\_health in front-end .js returns zero. Server-side views exist; no UI fetches them.

**Impact:** Scott can't verify background enrichment is running. Asks why-isn't-this-owner-researched with no diagnostic surface.

**Fix:** Add a Background jobs widget on Home (or a /pageSystemHealth route): 4-tile dashboard showing queued / done last 24h / errors / oldest-queued-age for each pipeline. Backed by existing data-query edge function.

**Section D — Business Development Pipeline Integration**

15 findings. Theme: collection without consequence. The cadence engine, template library, and signal taxonomy are starved for callers. Fixing D-1, D-2, D-3, and D-5 alone converts the LCC from research database to BD pipeline without building a single new feature — they are all call existing function X from existing handler Y.

**D.1. \[CRITICAL\] D-1 — CoStar sidebar captures NEVER fire the listing-BD pipeline**

**Evidence:** sidebar-pipeline.js:2138-2144 upserts available\_listings; propagateToDomainDbDirect returns without calling runListingBdPipeline

**Evidence:** The only callers of runListingBdPipeline: sync.js:2571 (SF ELA webhook) and operations.js:2653 (manual action)

**Evidence:** writeListingCreatedSignal fires in entities-handler.js:1077 but no signal listener consumes it

**Evidence:** api/\_shared/listing-bd.js:21 documents consumed by a signal listener — that listener does not exist

**Impact:** Every CoStar capture of a competing listing in OK / TX / FL silently lands in the DB. T-011 (same asset type / same state) and T-012 (owner near listing) drafts are never queued unless the listing came in via the SF webhook. This is the largest data-in-no-lead-out gap in the system — and it explains why all 14 templates show 0 sends in 120 days (reports/lcc-template-health-weekly-latest.md).

**Fix:** In propagateToDomainDbDirect, after available\_listings upsert returns more than 0 new rows, call runListingBdPipeline(entity, workspaceId, userId, { triggerSource: 'sidebar\_capture' }) for the freshly inserted listing(s). Mirror in intake-promoter for the OM-intake path (D-5).

**D.2. \[CRITICAL\] D-2 — New broker contacts from sidebar dead-end at row write — no qualification queue, no cadence seed**

**Evidence:** upsertSidebarContacts (sidebar-pipeline.js:1657-2050) writes to contacts and returns a count. No call to ensure entity, no getCadenceState, no inbox\_items, no syncSalesforceForEntity.

**Evidence:** A process\_sidebar\_extraction signal is written (sidebar-pipeline.js:1421); nothing consumes it.

**Impact:** Every listing broker, buyer broker, and owner contact CoStar captures is invisible to the cadence engine. The 7-touch sequence in cadence-engine.js:29-37 can only fire after getCadenceState is called — nothing calls it on new contacts. Each fresh broker is a vanished lead.

**Fix:** After upsertSidebarContacts inserts a new row, call getCadenceState({ contact\_id }) to initialize cadence at touch 0, and POST an inbox\_items row of source\_type=new\_contact\_qualify so the contact lands in triage. Mirror via contacts-handler for non-sidebar contact creates.

**D.3. \[CRITICAL\] D-3 — Outlook sends are not captured then cadence never advances, templates never measured**

**Evidence:** recordTemplateSend (templates.js:314) is the only path to advance cadence; called only by operations.js:2528 action=record\_send

**Evidence:** No frontend, Outlook bridge, or Power Automate flow calls record\_send. bridge-handlers-outlook.js:124 is inbound-only.

**Evidence:** reports/lcc-template-health-weekly-latest.md:30-37 — every template is stale, all 14 report zero sends

**Impact:** Even when Scott does send a template-derived email through Outlook, the cadence engine has no knowledge of it. last\_touch\_at never updates, the 7-touch sequence doesn't advance, template\_refinement has nothing to learn from. The entire learning loop is starved.

**Fix:** Either (a) wire a Power Automate flow that fires on Outlook Sent Items (filtered to template-id-tagged drafts) and POSTs /api/operations?\_route=draft\&action=record\_send, or (b) add a Mark Sent one-click button to the draft preview UI that POSTs the same endpoint with the cadence\_id.

**D.4. \[CRITICAL\] D-4 — Salesforce sync is read-only; closed deals never reach LCC, new LCC contacts never reach SF**

**Evidence:** api/\_shared/salesforce.js:1-34 declares the lookup webhook READ-ONLY

**Evidence:** salesforce-sync.js only writes the SF id back onto LCC entities

**Evidence:** bridge-handlers-salesforce.js consumes inbound enrichment\_jobs (SF to LCC, lines 5-11). No outbound writer.

**Evidence:** SALESFORCE\_LCC\_INGESTION\_PLAN.md and SALESFORCE\_LCC\_DOCUMENT\_INGESTION\_AUDIT.md are plan-state, not shipped

**Impact:** Three failures cascading from the same root: (a) new LCC contacts/orgs from sidebar don't appear in SF — Scott has two parallel CRMs; (b) when an SF deal closes, the listing-side cadence (cadence-engine.js:139 phase === converted) never gets the trigger; (c) SF-hosted OMs and flyers on Comp/Listing records are unreachable to the LCC.

**Fix:** Ship the SF Files / Object Sync plan in SALESFORCE\_LCC\_INGESTION\_PLAN.md Section 3. Short-term workaround: Power Automate deal-closed-to-POST-/api/sync/salesforce-deal-closed so cadence-engine can advance to converted.

**D.5. \[HIGH\] D-5 — OM intake promotes a listing but does NOT fire the BD pipeline**

**Evidence:** api/\_handlers/intake-promoter.js contains zero references to runListingBdPipeline, writeListingCreatedSignal, or inbox\_items

**Evidence:** After promotion, the listing lands in available\_listings (line 359) and the broker contact lands in contacts; no T-011/T-012 drafts queue

**Impact:** Every flyer Scott flags in Outlook represents a real listing that should auto-trigger BD outreach to peer owners. Today these are silent deposits.

**Fix:** At the end of promoteDiaPropertyFromOm / promoteGovPropertyFromOm, call runListingBdPipeline(...) with triggerSource=om\_intake.

**D.6. \[HIGH\] D-6 — Cadence engine only covers contacts — not properties, listings, or owners**

**Evidence:** cadence-engine.js:65 getCadenceState({ ids, propertyInfo }) keyed on entity\_id | sf\_contact\_id | contact\_id only

**Evidence:** No property-level or listing-level cadence. 7-touch sequence is hard-coded to one contact-per-property pair.

**Evidence:** No follow-this-listing-weekly-until-status-changes loop. No re-warm-this-owner-every-90-days loop independent of contacts.

**Impact:** Buildings get captured and forgotten. The quarterly CM cadence in cadence-engine.js:248-274 is conceptual — it requires a touchpoint\_cadence row nothing seeds for buildings or unnamed-owner entities.

**Fix:** Extend touchpoint\_cadence to allow subject\_kind = property | owner | listing rows. Seed on each new domain INSERT (combined with D-1 and D-5).

**D.7. \[HIGH\] D-7 — Signals table is write-only; no signal-to-action router**

**Evidence:** api/\_shared/signals.js:27-48 only INSERTs. Consumers: template-refinement, briefing-data (read-only rollup). No file subscribes to drive actions.

**Evidence:** signals.js:144 comment describes a consumer that does not exist (consumed by the listing-as-BD pipeline (or a scheduled task))

**Impact:** listing\_created, sidebar\_extraction\_processed, template\_edited all fire but route nowhere. The signals architecture is observation-only.

**Fix:** Add a signal\_router worker (cron) that reads new signals and routes by type: listing\_created to runListingBdPipeline; sidebar\_extraction\_processed to contact-qualify queue; going\_cold to re-warm draft. Idempotent on signal\_id.

**D.8. \[HIGH\] D-8 — No lead scoring; every contact/property/listing is equal**

**Evidence:** cadence-engine.js:92 defaults every cadence to priority\_tier: B. TIER\_MULTIPLIERS at lines 40-44 are permanently 1.0x for everyone.

**Evidence:** No score / lead\_value column populated. recommended\_next\_action (contact-handler.js:153-162) is a string heuristic, not a numeric rank.

**Impact:** Scott looks at the inbox and can't tell whether the $20M owner or the $2M owner needs a call first.

**Fix:** Add a nightly lcc-lead-score job that computes 0-100 score per contact based on (a) ownership portfolio value (recorded\_owners join), (b) recent activity, (c) proximity to active listings. PATCH touchpoint\_cadence.priority\_tier.

**D.9. \[HIGH\] D-9 — No stale-lead resurfacing for non-active-cadence contacts**

**Evidence:** cadence-alerts.js:51-112 — going\_cold rule requires existing sf\_contact\_id AND v\_contact\_engagement row. Contacts never touched have no engagement row, never go cold, never re-surface.

**Evidence:** Same constraint on heating\_up rule — requires v\_competitive\_touches populated by SF activity history

**Impact:** A broker captured 9 months ago that never made it onto a list never re-surfaces. CRM accumulates dead weight while cadence-alerts cron reports 0 detected.

**Fix:** Add a dormant\_contact rule: contacts with touchpoint\_cadence.current\_touch=0 AND created\_at \> 30 days ago AND no inbox item then land in inbox with priority=low.

**D.10. \[MEDIUM\] D-10 — Capital Markets is a chart API, not a BD pipeline**

**Evidence:** api/capital-markets.js:1-37 exposes only chart/catalog/RCA endpoints

**Evidence:** Grep cm\_pursuit | pursuit\_status | pitch.\*deal returns zero in codebase. T-003 CM Update template ships data but no tracker records who got it or which pursuit it advanced.

**Impact:** Scott can't track CM as a BD discipline — every quarterly send is one-off, not a pursuit pipeline (pitched to won/lost to relationship-built).

**Fix:** Add cm\_pursuits table + endpoint with stages (identified to pitched to engaged to won/lost). Attach property/contact FKs. Have T-003 sends auto-create a pursuit\_touch row.

**D.11. \[MEDIUM\] D-11 — Inbox promote creates action item but no follow-up template draft**

**Evidence:** inboxPromoteToAction (queue.js:906-978) creates an action\_items row and writes writePromotionSignal. No call to generateDraft or seed touchpoint\_cadence.

**Impact:** Promoting an inbox item is a two-step manual journey — most users stop after promote, never draft, never send. The promote-to-draft chain is broken.

**Fix:** In inboxPromoteToAction, when source\_type in (flagged\_email, listing\_bd\_trigger), pre-generate a draft and attach as action\_items.metadata.draft\_id.

**D.12. \[MEDIUM\] D-12 — activity\_events written but no learning loop reads them**

**Evidence:** activity-events.js:50-100 well-built; consumed only by briefing-data.js (daily rollup) and contact-handler.js:120-128 (last-touch summary)

**Evidence:** No scorer reads activity events to say Scott opened this property 3x this week — escalate or no touch in 60 days — re-warm

**Evidence:** Client-side view events (page\_view, click\_event, impression) are not captured at all

**Impact:** System can't notice when Scott implicitly cares about a property — by opening it repeatedly without acting — and can't nudge.

**Fix:** Capture client-side view events at /api/queue?view=\_perf (already an endpoint). Add engagement-uptick rule to cadence-alerts.

**D.13. \[MEDIUM\] D-13 — ownership\_research\_queue has a writer; no contact-resolution worker**

**Evidence:** sidebar-pipeline.js:2545 enqueues when true\_owner\_id is NULL or owner name is first-name-only

**Evidence:** llc-research-tick drains LLC corporate-filings queue. No worker takes BROKER\_FIRSTNAME\_ONLY:John rows (line 1763) and resolves them.

**Impact:** First-name-only brokers from sidepanel are flagged but never resolved. Queue grows; outreach never happens.

**Fix:** Build /api/ownership-research-tick worker. Pair with A-1 fix.

**D.14. \[MEDIUM\] D-14 — generateDraft doesn't create a touchpoint or signal — drafts without sends are invisible**

**Evidence:** templates.js generateDraft returns rendered string. record\_send is the only path that creates a template\_sends row and advances cadence (operations.js:2616)

**Impact:** The funnel drafted-to-sent is invisible. Scott may draft 10 emails, send 0, and the system reports no activity.

**Fix:** Have generateDraft write a signals row of type draft\_generated with entity\_id and template\_id so the daily briefing can flag you drafted 5 things you didn't send.

**D.15. \[MEDIUM\] D-15 — Domain bridge external\_identities write gated on entity.workspace\_id; some paths skip silently**

**Evidence:** sidebar-pipeline.js:2252 — external\_identities upsert gated on entity?.workspace\_id. When entity arrives without one (some code paths), bridge row is silently skipped. Comment notes 172 orphaned assets in 14-day audit.

**Impact:** Orphaned assets don't appear in cross-domain views or BD pipeline — stranded from the rest of the system.

**Fix:** Resolve workspaceId from user.memberships\[0\] as fallback before the gate.

**90-Day Improvement Roadmap**

*Grouped so each phase makes the system observable, then closes loops, then refines. Effort estimates assume one engineer working full-time; with parallelization across the data, UI, and BD scopes, phases can compress.*

**Phase 1 — Stop the bleeding (Weeks 1-2)**

Goal: make every silent failure visible and prevent further provenance corruption. After this phase, the team can trust what the database says about itself.

  - **A-3** — make domainPatch throw on failure; gate pushProvenance on success; add ingest\_write\_failures table.

  - **C-5, C-6, C-9, C-10** — global window.error + unhandledrejection handlers; audit list loaders; type-aware toast durations; persistent error pill.

  - **C-1, C-4** — add confirmations to all irreversible actions (contact merge, intake clear).

  - **C-2, C-3** — Chrome extension failure visibility (badge, notification) + stale-parser health signal.

  - **A-15, A-17** — wire staged\_intake\_promotions retry; enrich domainPatch failure logs with record\_pk and run\_id.

**Phase 2 — Connect collection to consequence (Weeks 3-5)**

Goal: every entry path ends in a BD action, not a row write. This is where the system transitions from research database to BD pipeline.

  - **D-1, D-5, D-7** — fire runListingBdPipeline from sidebar and OM intake; build the signal-router that consumes listing\_created and routes to the BD pipeline.

  - **D-2** — seed cadence + inbox\_items on new contact writes (sidebar and contacts-handler).

  - **A-1, B-5, D-13** — schedule llc-research-tick cron; build ownership-research-tick worker; surface both queues as UI tabs ranked by linked-property value.

  - **A-2** — wire resolveOwnerLinks for dia domain; one-shot backfill on NULL recorded\_owner\_id.

**Phase 3 — Make the database visible (Weeks 6-8)**

Goal: every capability already built shows up in the right screen at the right time.

  - **B-1, B-13** — build v\_next\_best\_action UNION view; render as top card on Home; correct the Research pulse-card count.

  - **B-2, B-15** — Data Completeness rail on detail.js; persist data\_completeness\_pct as a generated column.

  - **B-4, B-11, B-12** — surface v\_data\_quality\_issues and v\_field\_provenance\_actionable as inline chips on property cards/detail. Route provenance conflicts into inbox\_items. Banner for lcc\_health\_alerts.

  - **C-16** — Background jobs widget (4-tile health dashboard) on Home.

  - **B-3** — replace date-desc default sort with value times gap composite across gov.js, dialysis.js, app.js listings/sales/leases.

**Phase 4 — Close the BD loops (Weeks 9-11)**

Goal: from research action to outreach decision to measured response, with no manual hand-offs.

  - **D-3** — capture Outlook sends via Power Automate flow OR Mark Sent button; advance cadence and feed the learning loop.

  - **D-4** — ship SF outbound writer (contact/lead create); short-term Power Automate deal-closed-to-/api/sync/salesforce-deal-closed.

  - **B-9, B-10** — research approval auto-seeds cadence; sticky next-action bar on detail.js.

  - **D-8, D-9, D-11, D-14** — nightly lead-score job; dormant-contact resurfacing; inbox promote auto-drafts; generateDraft writes signal.

  - **D-6** — extend cadence-engine to property + listing + owner subjects.

**Phase 5 — Refinement (Week 12+)**

Goal: address the long tail of data-propagation and same-name-different-state gaps that will accumulate quietly.

  - **A-5** — reconcile duplicate CREATE TABLE IF NOT EXISTS migrations; add CI pre-deploy guard.

  - **A-6, A-8, A-10** — add state to owner-dedupe key; cross-domain contact reconcile; broker-office anti-pattern guard.

  - **A-7, A-13** — tenant change propagation across sales/listings/leases; CMS chain to properties.tenant direction.

  - **B-7** — v\_stale\_curated\_fields view + re-verify panel on detail.js and daily briefing.

  - **B-8** — wizard Save & Next advances within property until complete, then to next queue row.

  - **A-12, A-16, C-7, C-11, C-12, C-13, C-14, C-15, D-10, D-12** — remaining cleanup items.

**How to measure success**

After Phase 2, the weekly template-health report (reports/lcc-template-health-weekly-latest.md) should show \> 0 sends across multiple templates — currently 0/14. After Phase 3, the Home dashboard top-5-research-gaps should be the first thing Scott reads each morning — currently does not exist. After Phase 4, the time from OM-lands-in-Outlook to first-BD-touch-on-a-peer-owner should be under 4 hours — currently indefinite. After Phase 5, the dia-domain recorded\_owner\_id coverage should be over 95% — currently approximately gov coverage minus the OM-intake gap, which is most of dia.
