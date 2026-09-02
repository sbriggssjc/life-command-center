# LCC desktop app — operator review of 2026-09-02, catalogued and queued

> 📍 **THE canonical page for Scott's 2026-09-02 walk-through of the app** (41 screenshots + notes,
> source: `LCC App Function Notes.docx`, kept outside the repo). Every comment has a **UX id**, a
> type, what is already KNOWN about it (many were measured earlier in this arc), and its queue
> position. **The backlog rows in `PLANNED-BACKLOG.md` §P16 are authoritative for state; this page
> is the map.** ⚠️ None of this pre-empts the OCR thread (OCR1/OCR2) — it queues behind it.

---

## 0. The doctrine Scott stated — this governs every row below

Scott's notes state one rule five different ways, and it is the design constraint for the whole
app, not for one tab. Recorded here verbatim in substance so the next chat builds against it
rather than re-deriving it:

1. **The human sees only the minimum effective dose.** Every call to action in the LCC must be a
   step *only the human can take* that pushes BD forward. Everything that code or the local Ollama
   model can do is done outside human view, and the system **propels itself until it cannot**.
2. **The legitimate human-in-the-loop moments are enumerable:** sending the email · making the
   call · a step that costs money · a source the code cannot reach (SOS bot-wall, a county that
   needs a human) · a judgement no rule can make. **Nothing else earns a card.**
3. **Buyers are pursued by showing them deals** (listings, marketing touchpoints). Linking a buyer
   contact to Salesforce is plumbing, not a BD action. **The priority queue is SELLER prospecting**,
   ordered by date and relative importance — sweet spot **$2.5M–$25M, newer lease, a reason to
   sell, an owner we have not yet reached**.
4. **Every tab and section is designed for one purpose and answers that question exactly.** A tab
   that is a list where a dashboard was needed, or a research-workbench extension where
   intelligence was needed, is wrong even if the data is right.
5. **Truth over signal.** An SF link is a marker, not evidence we are prospecting someone. The
   ownership chain from original developer to current owner should show who we are *actively*
   prospecting and who we have *ever* prospected.

→ Canon: this belongs in `docs/os/canon/blocks/` with a `CANON_VERSION` bump (**UX0** below); until
then `CLAUDE.md` carries it as a doctrine.

## 1. The catalog

Types: **DEFECT** (wrong today, measurable) · **DESIGN** (right data, wrong surface) · **DOCTRINE**
(a §0 consequence) · **FEATURE** (not built) · **REMOVE** · **Q** (a question the docs can answer).
"Known" cites the measured state where one exists — read it before building.

### 1a. Today (home)

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX1** | *Work Your Outreach* shows "Outreach list unavailable / Retry" | DEFECT | The reachable, value-ranked cadence list endpoint is failing on load. Not measured yet — read the handler's response, not the tile. | T0 |
| **UX2** | *Top Data Gaps* ranks by deal size and leads with "resolve agency drift"; that is automation, not human work; ranking should follow the §0.3 sweet spot | DOCTRINE + DESIGN | Agency drift is the `agency_classifier` provenance lane (PR8) — a code/Ollama reconciliation. The value-rank is the C2a/C4a question: **what promotes an owner out of `unknown`** is still Scott's doctrine to state (C4a). | T1 |
| **UX3** | *Top BD actions* pushes buyer contacts to Salesforce — that is plumbing; the list should be seller prospecting by date + importance | DOCTRINE | **Already concluded once for the research lanes (C1): SF linking has an automated consumer (`sf_link_candidate`).** The priority queue's `P-BUYER` (22) and `P-CONTACT` (216) bands and the home "Top BD actions" tile still surface it as human work. Re-rank per §0.3. | T1 |
| **UX4** | Inbox tile on home shows sidebar-intake notifications; wants a daily/weekly ingestion summary instead, with real emails/human-response items in Inbox | DESIGN | `inbox_items` mixes intake receipts with correspondence. Route intake receipts to a digest; see UX36. | T2 |
| **UX5** | A second "priorities" section further down is duplicative (more buyer work) | DESIGN | Collapse into UX3's single seller-first queue. | T1 |
| **UX6** | Activity breakdown + Team Pulse + calendar layout is good; *research* has swelled and automation should be eating it | DOCTRINE | **Known:** P1a — every research lane the generator feeds has ZERO real completions; A5c value-gated the producer 71,448 → 2,530. The swelling is the consumption-layer failure this repo already documents. | T1 |

### 1b. Priority tab

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX7** | Band labels (P0.4, P0.5, P-BUYER, P-CONTACT, P1…P8) are opaque; many rows are automatable; the queue must be **the next human-required action** | DOCTRINE + DESIGN | Bands are doctrinal (`v_priority_queue`), named for the audit that created them, not for the action. Re-label by ACTION ("Call owner", "Send OM", "Decide") and drop rows whose resolution is a code path. Depends on C4a. | T1 |

### 1c. Dialysis — Overview

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX8** | "263" badge on the Dialysis tab — what is it counting? | DESIGN | An honest-count badge must be *actionable work* (Consumption doctrine rule 5). Label it or remove it. | T2 |
| **UX9** | Action-items section does not call for human action; mostly automation/Ollama candidates | DOCTRINE | Same as UX7. | T1 |
| **UX10** | On-market figures on Overview do not reconcile with Deals ▸ Sales ▸ Availables | DEFECT | **Known class:** *"Overview tiles must read ONE canonical view."* gov has `v_gov_on_market`; dia's canonical is `cm_dialysis_on_market_snapshot_q` / `v_dia_on_market_full`. Measure which view each surface reads; make both read one. | T0 |
| **UX11** | Verification status has no human call; the recent-verification feed shows "no update" on every row — looks like an error | DEFECT | **Plausibly known:** `listing_verification_history.asking_price_at_check` / `price_delta` are NULL on 5,636 of 5,637 rows (the lvh writer records `prior_asking_price` only) — a feed built on those columns reads "no update" forever. Measure. | T0 |
| **UX12** | "SJC deal book from Salesforce" buttons don't populate; **Fresenius Woodland Hills (our closing) is missing the Team Briggs flag** | DEFECT | Woodland Hills was propagated into the comp workbook (Prompt 50, sale_id 14832). The Northmarq/Team-Briggs flag on the sale and the SF deal-book link are separate columns — measure both. | T0 |
| **UX13** | Team touchpoints should be dialysis-only; **Kelly's touchpoints have not updated in a while** | DEFECT | **Plausibly known class:** P116 — `source_user_id` id-space collision (`lcc_users` vs `public.users`) silently rejected 10,470 body writes for one user. Check Kelly's mapping through `resolveSourceUserId` first. Domain filter = C19. | T0 |
| **UX14** | CMS data "hasn't updated since Sept 2025"; lease coverage very low; patient-volume movers empty | Q → answered + DEFECT | **Three different facts.** (a) `facility_patient_counts` is a CMS *reporting-period* series (~annual); the newest real period is ~2025-03, so movers cannot move — **not a bug, a cadence** (Dialysis `CLAUDE.md`). (b) `medicare_clinics` DID have a 65-day ingestion outage (B6d-cms), repaired 08-29, but **every CMS run is still being killed mid-flight** — 👤 `B6d-cms-restart` (Railway logs) is open. (c) Lease coverage is genuinely low — it is the CoStar-capture ceiling documented in `property-metadata-coverage.md`. **The dashboard should SAY which of these it is showing** (UX41). | T0 (b) · T2 (label) |
| **UX15** | Clinic financial estimates look high; what is "CMS Chair Count"; does industry revenue reconcile to CMS/HCRIS/10-K; show payer-mix averages | Q → mostly answered | **Known:** `dialysis_econ_reconciled_v1` — DaVita revenue/treatment $380 ≈ 10-K; aggregate is *conservative* (~69% of DaVita's reported US dialysis revenue) because treatment counts are audited CMS. ⚠️ **Likely the "high" figure is `estimated_annual_revenue`, which is CLINIC OPERATING revenue, not owner rent** — A5 recorded that exact misread ($45.5B). Chair count = CMS `total_chairs` per facility (a count, not an average). Payer-mix averages and a 10-K reconciliation tile are a small DESIGN add. | T2 |
| **UX16** | Ownership-coverage section: an SF link is not evidence of prospecting; show *actively* and *ever* prospected across the chain | DOCTRINE + DESIGN | **Known:** C4a is exactly this question and is still Scott's to state; "ever prospected" = `activity_events` / cadence history per entity, which `v_lcc_entity_roles` (C13b) does not yet carry. | T1 |
| **UX17** | Listing-confirmation card — what is the human meant to do? Should be automated | DOCTRINE | The availability-checker / T9d verification loop exists; a card that asks the human to confirm a listing is a code path leaking onto a human surface. Remove from the dashboard; keep an exception lane for what the code could not verify. | T1 |
| **UX18** | LCC-research cards belong in a research lane or the sidebar (per-state lists), filtered to the user's own leads | DESIGN | `v_my_work_scoped` already scopes by point person; the sidebar has no "drive a state list" mode. Combine with UX27. | T2 |
| **UX19** | Research-pipeline metrics don't show progress; wants a flow view ingestion → completion with automation vs human backlog per stage | DESIGN | The lane-summary view (`v_lcc_research_lane_summary`, P180) and B6a's producer-health views hold the numbers; no surface draws them as a flow. | T2 |

### 1d. Dialysis — Deals

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX20** | Deals opens on Pipeline, slow, and **jumps back to Pipeline when another sub-tab is clicked mid-load** | DEFECT | Front-end: an async render re-asserting the default sub-tab after navigation (the `_rendered` once-flag class the footguns warn about). Measure. | T0 |
| **UX21** | Pipeline tasks: default to the signed-in user, link to the contacts page, today-first, and a **sub-drawer per card** with recent activity + account summary + "draft next touchpoint → Outlook Drafts → auto-log SF + LCC with the sent-email / WebEx-call evidence" | FEATURE | **Partly built:** draft-assist saves to Outlook Drafts (never sends) with threading and deal context (P125); SF write-back is link-only by doctrine; `cortex-webex-sync` edge fn exists. What is missing is the *loop*: drawer → draft → detect sent → log. This is the same loop UX33 (Marketing) needs — **build once.** | T3 |
| **UX22** | Sales comps: fields missing/not propagated; show more fields; action buttons unclear — keep one "open record" | DEFECT + DESIGN | Comps read `rpc_query_comps`; chairs/patients were fixed for 217 sales (Prompt 55). Which fields are blank is a measurement. | T0 (fields) · T2 (layout) |
| **UX23** | Property → true owner: **Contacts messed up on the Ownership tab; conflicting data across the record** — ⚠️ Scott 2026-09-02: *"almost every property"*, gaps/lapses, the tab conflicts with itself, no reconciliation. **Measured true at population scale: 756 of 8,068 properties carry >1 current owner; the conflict detector reads 0.** → **OWN-T0** (wholesale), not a named-record fix. | DEFECT (systemic) | **Known class:** two stores for one fact (P175a ghost-vs-ended conflicts, `v_lcc_portfolio_ownership_conflict`), and the panel's contact block reading `reachable_via` vs `subject.email` (P161). Name the record and read it — this is the Class-11 "read named rows" case. | T0 |
| **UX24** | Leases tab → a summary dashboard (renewals, extensions, new leases) with click-through to property and owner, not a workbench link | DESIGN | Data exists (`leases`, firm-term resolver); surface is a list. | T2 |
| **UX25** | Loans tab → summary dashboard; **new Lender account type** + loan brokers, with relationship history like buyers | DESIGN + FEATURE | `loans`/`lenders` tables exist on both domains; no LCC entity role for lender. Adds a role to `v_lcc_entity_roles` (C13b pattern) rather than a new table. | T3 |
| **UX26** | Ownership tab still "covering 500 properties"; wants intelligence (capital type, years active, #properties, recent acquisitions), sortable, click-through | DEFECT + DESIGN | **"500" is the round-number tell** — a paged query rendered as a count (footgun: *a round-number count means a tile is reading a paged query*). Fix the count first. Pacing/roles exist in `v_lcc_entity_roles`. | T0 (count) · T2 |
| **UX27** | Players: numbers don't reconcile internally | DEFECT | Multiple fields reporting the same fact — measure which views feed each tile. | T0 |
| **UX28** | Buyers: duplicates | DEFECT | **Known:** 6,608 canonical-key duplicate groups after N15c; P195 merged the byte-identical set; the rest are human-confirm. The tile should read survivors only (`merged_into_entity_id IS NULL` — P175). | T0 |
| **UX29** | **Sellers: not working at all** (0 in dataset / $0) | DEFECT | Screenshot shape = `diaQuery()` returning `[]` on a non-OK response (documented: a 500/403 and an empty view are the same pixels). Likely a missing edge-allowlist entry or a statement timeout. Measure the response, not the tile. | T0 |
| **UX30** | Brokers: exposes a storage/reporting problem; filter by firm vs individual; lots missing | DEFECT | **Known:** `broker_name` is a composite (persons, firms, teams with `;`), the firm registry is mis-populated (56% composites) — **BR1–BR5**. Do not build a surface on it until BR3 lands. | T0 (link to BR) |

### 1e. Dialysis — Inventory / Research / Reference / Capital Markets

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX31** | Inventory tiles: good; formalize fields, multi-key search/sort, **building size looks too large**, report leased SF | DEFECT + DESIGN | Size: check unit (I12 acres/sq-ft class) and RBA vs leased. Search bar is praised — keep. | T0 (size) · T2 |
| **UX32** | Research workbench: overhaul; each human CTA its own tab, minimum clicks; a flow dashboard of automations and where the human log-jams are | DESIGN (major) | Same doctrine as UX7/UX19. The lane split (A1) is the model: four real actions, not one queue. | T1/T2 |
| **UX33** | Research ▸ Activity looks like a marketing feed; should be a ticker of research/propagation/intake events | DESIGN | Small. | T2 |
| **UX34** | Reference ▸ CMS data tab is broken; should summarize each clinic's latest CMS operating data | DEFECT + DESIGN | Measure the failing query first. | T0 |
| **UX35** | "Flag for research" button — new properties/info should import automatically; human never clicks "allow" | DOCTRINE | Consistent with §0.1. The button is a producer gate; make it a code path with a review lane for what fails guards. | T1 |
| **UX36** | NPI intel: automate; if code + Ollama cannot confirm a signal, do not connect it | DOCTRINE | **Known:** W5.2 NPI consumer routes by confidence (P181 decidability). The human-verify card is the residue the worker abstained on — surface only the decidable few. | T1 |
| **UX37** | Capital Markets: some charts missing/partial or differ from the export; want a default "How to read this chart" under each | DEFECT + DESIGN | **Known:** K13–K18 are five measured CM chart defects already in the backlog. The explanatory text = `cm_chart_catalog.json` `how_to_read` per chart, rendered by default. | T0 (K13–18) · T2 |

### 1f. Government, top-level tabs, lower tabs

| id | comment | type | known / answer | queue |
|---|---|---|---|---|
| **UX38** | Government dashboard: all of the above applies with gov-specific fields | DOCTRINE | Apply each UX row to gov in the same change (C19 — domain filters are candidate defects). | with each |
| **UX39** | **National ST tab: remove** (not needed, does not work) | REMOVE | Check nothing reads its routes; delete. | T0 |
| **UX40** | **Marketing tab = the listing-marketing command center**: per listing → OM downloads, area ownership, blue-suit, prior purchasers, nurture, buyer swimlane; each a call/email list with contact summary → recent activity → draft → send → log SF + LCC; per-listing stats (calls, touchpoints, views, OM DLs, leads) | FEATURE (major) | **Known:** backlog **P6 "Marketing (Domain F)"** is this, designed not built; `lcc_listing_events`, `bd_opportunities`, draft-assist and the SF link-only write-back are the parts. Shares the draft→send→log loop with UX21. | T3 |
| **UX41** | **All Other tab (288): duplicative of Prospects — fold in after checking nothing is lost** | REMOVE | Inventory its routes/views before deleting. | T0 |
| **UX42** | **New tab — Buyer representation / 1031 clients** (~20% of fees): active buyers per user, milestones, criteria, status, next steps (sourcing, showings, LOIs, response summaries, memos) | FEATURE (new vertical) | Not designed anywhere. Belongs in P11 as a designed-not-built item; it reuses UX40's loop and the offer/LOI skills. | T4 |
| **UX43** | Inbox (lower tab): a unified queue of email/calls/texts needing a human response, by user, in priority order — not automated feed alerts | DESIGN | Same as UX4. The mailbox mirror (P119–P121) and `email_bodies` give the substrate. | T2 |
| **UX44** | Decision Center: good layout; audit every bucket for human-required vs code/Ollama-resolvable; design each for one-click resolution; **candidate for a deeper audit** | DOCTRINE (audit) | **Known:** OLLAMA_CLEAN_ASSIST pre-ranks lanes; P134/P137/P139 graded three. The bucket-by-bucket audit is not done. | T1 |
| **UX45** | Data Quality tab looks great — do issues route to something that fixes them? | Q | Partly: `lcc_health_alerts` has auto-resolve arms (B6d); the provenance lanes drive the DC. No single answer per issue class — measure. | T2 |
| **UX46** | Any errors/overlap that belong elsewhere in the DB? Deep-dive candidate | Q | Defer to the P0d coherence campaign (D1–D5). | T2 |
| **UX47** | LCC Health: are failures reported where action can be taken? | Q | Producer-health surface exists gov-side (`v_pipeline_task_health`), dia-side since 2026-09-01; **no alert ships for dia yet** (B6d-cms-escalation-alert). | T2 |
| **UX48** | Metrics tab: **wrong aliases shown as team members** | DEFECT | **Known class:** the two user id-spaces (`users` vs `lcc_users`) + Outlook aliases (98 stale `@stanjohnsonco.com` primaries). Measure the roster query. | T0 |

### 1g. "Generally — what else is missing?" (UX49)

Answered in §3.

## 1h. ✅ T0 SWEPT — 2026-09-02 (`docs/audits/UXT0_APP_DEFECT_SWEEP_2026-09-02.md`)

**9 fixed · 4 owned elsewhere · 4 hypotheses in §1 REFUTED · 2 removals refused · 2 not measured.**
Read the audit before re-opening any T0 row. Corrections to what §1 says above:

- **UX26 — the "500 is the round-number tell" reading is WRONG.** `sum(canonical_total_properties)`
  over the 16 distinct canonicals is **exactly 500**; the `limit: 500` in the loader is a
  coincidence. The genuine finding is OWN1 (the lane is 38 hand-written regexes over 72 of 7,262
  owners and does not say so).
- **UX11 — the feed never read `asking_price_at_check`.** It selects `method`/`check_result`/`notes`
  and the "no update" text is the cron's own note. **1,400 of 1,400 rows in 7 days are cron timer
  advances and the evidence lane last wrote 2026-08-06** — the feed was honest about a dead producer.
- **UX13 — not the P116 id-space collision.** Kelly's `activity_events` land. `email_bodies` is
  **0 for Kelly, Nate AND Sarah**: one mailbox is synced for a four-person team.
- **UX12 — the Team Briggs flag IS set** on sale 14832 (`is_northmarq = true`, one of 382). What is
  missing is `sf_deal_id`, non-null on **0 of 4,785** sales.
- **UX31 — not a unit error.** `building_size` is genuinely square feet and the median is genuinely
  right (8,646 sf). The tile showed the **mean** (24,044 sf), dragged 2.78× by 357 whole-building
  RBA rows.
- **UX39 / UX41 removals REFUSED on measurement — Scott's call, not mine.** National ST is the only
  route to 18 live `cm_natl_st*` views (480 rows) and the RCA upload card that feeds the ST quarterly
  book. `all_other` is **6,245 opportunities, the largest domain bucket**, and Prospects is a search
  box with no list mode to fold it into.

⚠️ **UX1 was not root-caused.** The view is healthy (2,119 ms / 313 rows); the sandbox cannot reach
the live host, so the tile was made to NAME its failure instead of guessing. One live load answers it.

## 2. Priority tiers (the order the backlog P16 section uses)

Ordered so nothing diverts the OCR thread, and so cheap correctness comes before redesign:

- **T0 — defects that mislead the operator today, each with a named mechanism to check first.**
  One measure-first CC prompt (**UX-T0**): UX1, UX10, UX11, UX12, UX13, UX14(b), UX20, UX22
  (fields), UX23, UX26 (count), UX27, UX28, UX29, UX30→BR, UX31 (size), UX34, UX37→K13–18, UX48,
  plus the two removals UX39, UX41. Rule: read the response/view, not the tile; positive-control
  every zero; fix the source, not the pixel.
- **T1 — the doctrine, applied to the surfaces that carry human work.** Needs **UX0** (canon
  block) and **C4a** (Scott states what promotes an owner) FIRST, then one design prompt per
  surface: home + priority queue (UX2/3/5/7/9), research workbench (UX32/35/36), Decision Center
  audit (UX44), ownership "prospected" truth (UX16/17).
- **T2 — dashboards where the data is right and the surface is wrong:** UX4/43 inbox, UX8, UX15,
  UX18/19, UX24, UX26 intelligence, UX31/33/37 text, UX45–47 answers.
- **T3 — features that share one new loop:** the draft → send → log loop (UX21, UX40), the Lender
  role (UX25).
- **T4 — the new vertical:** UX42 buyer-rep tab (design first, P11).

## 3. What is missing that the notes did not name (UX49)

Ideas, not commitments — each would need its own row before anyone builds it:

- **A per-surface contract.** Every tab gets a five-line header in the docs: *purpose · the one
  question it answers · the ONE canonical view it reads · the human action(s) it demands · its
  §7b-style status query.* Most of this review is the absence of that contract.
- **A human-in-the-loop budget.** Count, per surface, the cards shown vs the cards that a code
  path could resolve. Render it. It is the Consumption-Layer badge-honesty rule applied to
  the whole app, and it makes §0.1 measurable instead of aspirational.
- **The send→log loop as ONE shared primitive** (UX21/UX40): Outlook draft created → sent-item
  detected (the mailbox mirror already sees Sent) → `activity_events` + SF task logged with the
  message id as evidence → cadence advanced by the single-advance-owner. Build it once under the
  Pipeline drawer; Marketing and buyer-rep reuse it.
- **"Ever prospected" as a first-class fact** on the entity (UX16): earliest and latest outbound
  touch, channel, by whom — derived from `activity_events`, shown on every owner card and in the
  chain. That is the truth §0.5 asks for.
- **Local-model uses that are cheap and not yet on the map:** draft the *why-now* line on each
  seller card from the lease/rent/pacing facts (the same guarded pattern as the ownership-chain
  role labels); classify inbound email into respond/route/digest for UX43; summarize each
  listing's activity for UX40's stats; explain each CM chart from its own data (UX37).
- **Screenshot-driven acceptance.** Every surface PR carries a before/after screenshot and the UX
  id it closes, and the reviewer checks the screenshot against §0 — the same way a data PR
  carries a state delta.
- **A weekly review cadence** in the same shape as this document: Scott walks the app, appends
  notes with screenshots; the chat catalogs into this page's next dated section and the backlog.
  Reviews become a dated series, not a one-off.
