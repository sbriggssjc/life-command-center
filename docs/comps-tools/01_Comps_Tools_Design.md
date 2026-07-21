# LCC Comps Platform — Two New Tools

### Direct Salesforce comps query + a multi‑source synthesis orchestrator

**Author:** Drafted with Claude for Scott Briggs
**Date:** July 21, 2026
**Status:** Design / for review before build
**Audience:** Scott + whoever builds/maintains the LCC MCP server

---

## 1. What we're building and why

Today your agents pull comps two very different ways:

- **Structured, on‑demand** for the tenant types you've invested in — dialysis and government — where the data lives in your own Supabase databases and the agent (via the LCC MCP server, e.g. `generate_comps`) queries it directly, cleanly, and repeatably.
- **Manual, batchy** for everyone else — you export a spreadsheet from CoStar / a third party, or run an Ascendix search inside Salesforce, hand the export to an agent, and the `briggs-comps` skill maps it into the Sales/Lease Comps template.

The manual path is the bottleneck. It's slower, it's a person-in-the-loop every time, and it can't be *composed* — an agent can't reason across Salesforce data and your Supabase data in a single request because Salesforce isn't queryable on demand.

This design adds two capabilities that close that gap:

- **Tool 1 — `salesforce.query_comps`:** a first‑class, on‑demand query tool that pulls sales and lease records straight out of Salesforce/Ascendix and returns them in the *same shape* your dialysis and government data already use. This turns Salesforce from a "manual export source" into a live source your agents can call like any other.
- **Tool 2 — the synthesis orchestrator (`comps.synthesize`):** an agent/tool that takes a plain‑language request ("medical sales comps in Ohio," "medical + office lease comps in the Tulsa MSA"), decides *which* sources are relevant, fans out across the dialysis DB, the government DB, and Salesforce in parallel, then merges, de‑duplicates, ranks, and returns one polished comp set in your Briggs template.

The strategic point you already articulated: a lease-comp request that blends office rents from the dialysis DB, VA/GSA leases from the government DB, and Salesforce medical/office leases produces something **more complete than any single source can** — and it does it in one call, in your template, with provenance.

---

## 2. The linchpin: a canonical comp schema (the "comp contract")

Before either tool is worth building, you need **one internal shape that every source maps into.** This is the single most important design decision in the whole effort. If each source returns its own idiosyncratic fields, the orchestrator becomes a pile of special-cases and never stabilizes. If every source returns the same contract, the orchestrator becomes almost trivial — it just concatenates, de‑dupes, ranks, and formats.

Think of it as two record types (sale, lease) sharing a common core.

**Shared core (every comp, every source):**

| Field | Meaning | Notes |
|---|---|---|
| `comp_id` | Stable unique id | Namespaced by source, e.g. `sf:0065f000...`, `dialysis:1234`, `gov:GS-07B-...` |
| `comp_type` | `sale` \| `lease` | Drives which template and which type-specific fields apply |
| `source` | `salesforce` \| `dialysis_db` \| `government_db` \| `costar` … | Provenance |
| `property_name` | | |
| `address`, `city`, `state`, `zip` | Normalized USPS-ish | |
| `latitude`, `longitude` | For radius/market filtering | Geocode on ingest if missing |
| `msa` / `market` | Market label | Normalize to one market taxonomy |
| `property_type` | `medical_office` \| `office` \| `dialysis` \| `retail` … | **Controlled vocabulary — see §2.1** |
| `property_subtype` | `MOB`, `VA_clinic`, `general_office`, `dialysis_center` … | |
| `building_sf` | Rentable/GLA | |
| `year_built`, `year_renovated` | | |
| `tenant_name` | | |
| `tenant_credit` | `government` \| `investment_grade` \| `local` … | Powers credit-weighted views |
| `source_url` / `record_link` | Deep link back to the system of record | Required for citations |
| `as_of_date` | When the fact was true | |
| `confidence` | 0–1 data-quality score | Set by the mapping layer |
| `provenance` | Object: which system, which query, when pulled | Audit trail |
| `raw` | The untouched source record | Never discard it — see §4.4 |

**Sale-specific:** `sale_price`, `price_per_sf`, `cap_rate`, `noi`, `sale_date`, `buyer`, `seller`, `occupancy_at_sale`.

**Lease-specific:** `lease_type` (NNN / gross / modified), `base_rent_annual`, `rent_per_sf`, `lease_term_months`, `commencement_date`, `expiration_date`, `escalations`, `ti_allowance`, `free_rent_months`, `effective_rent_per_sf`, `renewal_options`.

### 2.1 Two controlled vocabularies you must standardize first

The orchestrator lives or dies on two normalizations that have to be identical across all three sources:

1. **Property type / subtype taxonomy.** "MOB," "medical office," "med office bldg," and "healthcare" must all resolve to one value. Define the canonical list once (medical_office, office, dialysis, retail, industrial, VA/government-clinic, etc.) and make every source's mapper resolve into it.
2. **Market / geography taxonomy.** Decide whether "Ohio" means state = OH, or a set of MSAs, and how sub-market radius searches work. Pick MSA + state + lat/long radius as the three query dimensions and make every source honor them.

Everything downstream — routing, filtering, dedup, ranking — keys off these two. **Build them before you build the tools.**

> **Recommendation on normalization (you asked me to pick):** normalize to this canonical schema *at each source's tool boundary*, and always carry the original record in `raw` plus a `provenance` block. This is the "normalized to comp schema" option, with a safety net. Rationale: the orchestrator sees exactly one shape regardless of source, which keeps it simple and lets you add a fourth or fifth source later without touching orchestrator logic; and because you keep `raw`, you never lose auditability, you can re-map when a source schema changes, and you can debug a bad comp back to its origin. The "raw + light mapping" alternative pushes all reconciliation into the orchestrator, which is faster to stand up but turns the orchestrator into the thing that breaks every time a source changes. For a system you want to trust in front of clients, pay the mapping cost once at the edge.

---

## 3. Where this sits in your current architecture

Both tools should be **added to the existing LCC MCP server** — the same server that already exposes `generate_comps`, `generate_bov`, `get_property_context`, `search_entities`, `log_memory`/`recall_memory`, etc. That keeps one surface for the agents, one auth story, one deploy.

```
                         ┌─────────────────────────────────────────┐
                         │            Claude / LCC Deal Agent        │
                         │   (reads plain-language comp requests)     │
                         └───────────────────┬───────────────────────┘
                                             │ MCP tool calls
                         ┌───────────────────▼───────────────────────┐
                         │              LCC MCP Server                 │
                         │                                             │
   existing ───────────►│  generate_comps  get_property_context  ...  │
                         │                                             │
   NEW  Tool 2 ────────►│  comps.synthesize   (orchestrator)          │
                         │        │  fans out in parallel to:          │
                         │        ├─► dialysis_db.query_comps  (exists) │
                         │        ├─► government_db.query_comps (exists)│
   NEW  Tool 1 ────────►│        └─► salesforce.query_comps    (new)   │
                         └───────┬──────────────┬───────────────┬──────┘
                                 │              │               │
                     ┌───────────▼──┐   ┌───────▼──────┐  ┌─────▼─────────┐
                     │ Supabase     │   │ Supabase     │  │ Salesforce /  │
                     │ Dialysis_DB  │   │ Government_DB│  │ Ascendix      │
                     └──────────────┘   └──────────────┘  └───────────────┘
```

Two design rules that follow from this picture:

- **The orchestrator only ever speaks the canonical schema.** It never touches SOQL or SQL directly; it calls the per-source query tools, each of which returns canonical comps. This is what lets you add sources without rewriting it.
- **Each source query tool is independently useful.** `salesforce.query_comps` should be callable on its own (an agent that just wants Salesforce comps), not only through the orchestrator.

---

## 4. Tool 1 — `salesforce.query_comps`

**Purpose:** given filters (geography, property type, comp type, date window, size), return canonical sale/lease comps from Salesforce/Ascendix, on demand, no human export step.

### 4.1 The auth reality, and the recommended path

You told me Salesforce access today is "strictly Power Automate flows" — i.e., there's no Connected App / API integration provisioned, and data currently moves by flows that dump exports. That's the constraint to design around. There are two viable ways to give the tool live access:

**Option A — Power Automate as a query proxy (ship this first).**
Stand up a single Power Automate flow triggered by **"When an HTTP request is received"** that accepts a small JSON body (the filter set), runs the query against Salesforce using either the **"Send an HTTP request to Salesforce"** action (arbitrary SOQL) or the connector's list-records action, and returns the rows in the HTTP response. The MCP tool just POSTs to that flow's URL.

- *Pros:* uses the plumbing and permissions you already have; no new Salesforce admin project; you can be live in days; the flow URL + a shared secret is the only credential the MCP server needs.
- *Cons:* Power Automate connectors have record-count limits and throttling under the platform's per-flow/per-connection limits, so this is best for bounded comp pulls (tens to low-hundreds of records), not bulk extracts; latency is higher than a direct API; and you're maintaining a flow as if it were an API. Use pagination in the flow and a hard result cap.

**Option B — Connected App + OAuth Client Credentials flow (the clean end state).**
Provision a Salesforce **Connected App** (or External Client App) tied to a dedicated **integration user**, using the **OAuth 2.0 Client Credentials flow** for server-to-server access, and have the MCP tool run **SOQL directly against the REST API** (`/services/data/vXX.0/query`).

- *Pros:* real API — proper pagination, higher/known limits, lowest latency, cleanest error handling, no flow to babysit; the integration user's profile scopes exactly what the tool can read.
- *Cons:* needs a Salesforce admin to create the Connected App, assign the integration user a permission set, and (depending on your org/Ascendix licensing) confirm the Ascendix comp objects are API-exposed. This is the piece to schedule with whoever admins your Salesforce.

**Recommendation:** build the tool with a **pluggable "connector" seam** and ship Option A now, Option B when the Connected App is approved. Concretely: the tool's public interface (params in, canonical comps out) stays identical; only a private `_fetch(filters)` implementation swaps from "POST to Power Automate flow" to "SOQL over REST." That way the orchestrator and the agents never know or care which backend is live, and the migration is a one-file change, not a redesign.

> One thing to verify with your Salesforce admin early: **where do Ascendix comps actually live** — standard objects, or Ascendix's managed-package custom objects? — and whether those objects are exposed to the API / to the Power Automate connection. That single answer determines the SOQL/flow query and is the most likely surprise. Put it at the top of the build checklist.

### 4.2 Interface

```
Tool: salesforce.query_comps
Input:
  comp_type:        "sale" | "lease" | "both"          (required)
  property_types:   ["medical_office","office", ...]   (canonical vocab)
  geography:
      states:       ["OH"]                              (optional)
      msas:         ["Columbus, OH"]                    (optional)
      center:       {lat, lng, radius_miles}            (optional)
  date_from / date_to:  ISO dates                       (sale/commencement window)
  size_min_sf / size_max_sf:                            (optional)
  tenant_credit:    ["government","investment_grade"]   (optional)
  limit:            default 100, hard cap (e.g. 250)
  include_raw:      bool, default false
Output:
  { comps: [ <canonical comp>, ... ],
    meta: { source:"salesforce", backend:"power_automate|rest",
            total_matched, returned, truncated: bool,
            query_echo, warnings: [...] } }
```

### 4.3 Behavior notes

- **Filter push-down.** Translate the filter set into a WHERE clause / connector filter so Salesforce does the work, not the tool. Never "pull everything then filter in memory" — that's where you hit record limits.
- **Truncation is explicit.** If results exceed the cap, return `truncated: true` and say so. The orchestrator and the agent must know when they're seeing a partial set (silent truncation is how you accidentally hand a client 40 comps when 400 existed).
- **Field mapping table lives in one place.** Maintain a `salesforce → canonical` field map as data (a dict/JSON), not scattered code, so an admin can adjust it when Ascendix field names change.
- **Geocoding.** If Salesforce records lack lat/long, geocode on the way through (cache results) so radius filtering and the orchestrator's dedup both work.

### 4.4 Why keep `raw`

Salesforce/Ascendix comp records carry fields you haven't modeled yet (broker notes, deal conditions, verification status). Stashing the untouched record in `raw` means: (1) you can enrich the canonical schema later without re-querying history, (2) an analyst can audit any comp back to source, and (3) when a mapping bug appears, you can re-map from `raw` instead of re-pulling. It costs a little storage and buys a lot of trust.

---

## 5. Tool 2 — `comps.synthesize` (the orchestrator)

**Purpose:** turn a plain-language comp request into one polished, de-duplicated, ranked, template-formatted comp set assembled from every relevant source.

This is the "beats almost everything we have today" piece. It's worth being precise about its internal stages, because each is a place quality is won or lost.

### 5.1 Pipeline

```
plain-language request
        │
   (1) INTENT PARSE ──► structured query {comp_type, property_types,
        │                                  geography, date window, size, intent notes}
        │
   (2) SOURCE ROUTER ─► decide which sources to call, with which filters
        │                (e.g. "medical in Ohio" → gov_db[VA/clinics] +
        │                 dialysis_db[dialysis+MOB] + salesforce[medical_office])
        │
   (3) PARALLEL FAN-OUT ─► call the per-source query tools concurrently
        │                   each returns canonical comps
        │
   (4) MERGE + DEDUP ──► concatenate; collapse the same deal seen in two sources
        │
   (5) RECONCILE ──────► when sources disagree on a field, apply precedence rules
        │
   (6) SCORE + RANK ───► relevance to the request (geo proximity, type match,
        │                 recency, size similarity, credit); sort; keep top N
        │
   (7) EXPORT ─────────► hand the ranked canonical set to the briggs-comps
                          template writer → Sales/Lease Comps .xlsx (+ summary)
```

### 5.2 Stage detail and the decisions that matter

**(1) Intent parse.** Let the model do this — it's exactly what LLMs are good at. Parse "medical + office lease comps in the Tulsa MSA, last 3 years, 5k–30k SF" into the structured query object from §4.2. Crucially, **echo the parsed query back in the result** ("Interpreted as: lease comps; types medical_office + office; Tulsa MSA; 2023-07 to 2026-07; 5,000–30,000 SF") so Scott can catch a misread before trusting the sheet. When the request is ambiguous and a human is present, ask one clarifying question; when unattended, state the assumption and proceed.

**(2) Source router — the piece of real IP here.** This is a small rules table (start hand-written, not ML) mapping *intent → sources + per-source filter overrides*. Examples of the rules you'd encode:

- `property_type ∈ {medical_office, dialysis}` → **always** include `dialysis_db` (it has MOB/office rents and dialysis comps) and `salesforce`.
- `tenant_credit includes government` **or** request mentions VA/GSA/federal/state → include `government_db`.
- `property_type = office` (plain office) → `salesforce` primary; `dialysis_db` **only** for its office-rent records; skip `government_db` unless credit filter says otherwise.
- Geography always passes through to every selected source.

Keep this table declarative and versioned. It's the thing you'll tune most as you learn which sources actually carry signal for which requests, and it's where your domain edge lives.

**(3) Parallel fan-out.** Call the selected source tools concurrently, not in series — latency should be ~the slowest source, not the sum. Each source failing should degrade gracefully: if Salesforce times out, return dialysis + government comps **and a warning** that Salesforce was unavailable, never a hard failure. Partial-but-labeled beats all-or-nothing.

**(4) Dedup.** The same building can appear in two sources (a dialysis-anchored MOB that's also a Salesforce medical_office sale). Match on a blocking key — normalized address + (sale_date or lease commencement) within a tolerance, or lat/long proximity + price/rent within a band. When two records match, **merge** into one comp rather than showing it twice.

**(5) Reconcile.** When merged records disagree on a field, apply an explicit **source-precedence policy** per field. A sensible default: for government-tenant facts trust `government_db`; for dialysis operational facts trust `dialysis_db`; for deal price/cap/broker-verified terms trust `salesforce`/CoStar; ties break to the higher `confidence` and more recent `as_of_date`. Write these down — reconciliation you can't explain is reconciliation a client will catch.

**(6) Score + rank.** A transparent weighted score, not a black box: geographic proximity, property-type exactness, recency, size similarity, and (when relevant) tenant-credit match. Surface the score so a reviewer sees *why* a comp ranked where it did. Cap to a sensible N for the template.

**(7) Export.** Reuse what you already have — the `briggs-comps` skill and its formula-protected Sales/Lease Comps templates. The orchestrator's job ends at "ranked canonical comp list + provenance"; hand that to the existing template writer. **Honor the existing hard rule: never overwrite the formula-protected columns** (RENT/SF, CAP RATE, TERM, DOM, PRICE/SF, EFFECTIVE RENT/SF). The orchestrator populates inputs; the template computes the derived columns.

### 5.3 Output

The orchestrator returns both a **file** (the populated template) and a **structured payload** so an agent can keep reasoning:

```
{ file: <Sales/Lease Comps .xlsx>,
  comps: [ <ranked canonical comps, with per-comp source + score + link> ],
  summary: { count_by_source, count_by_type, geo_covered,
             interpreted_query, warnings, excluded_count },
  provenance: [ per-source: query run, records returned, truncated? ] }
```

The **provenance and the interpreted-query echo are not optional.** They're what make the output defensible in front of a client and debuggable in front of yourself.

---

## 6. How the agents call these

Because both live on the LCC MCP server, adoption is just exposing two new MCP tools. Update the relevant agent instructions / skills so they know:

- **Prefer `comps.synthesize`** for any plain-language comp request that isn't obviously single-source. It's the front door.
- **Call `salesforce.query_comps` directly** only when the user explicitly wants just Salesforce, or when composing a bespoke flow.
- The `briggs-comps` skill's role shifts slightly: it becomes the **template-writer that the orchestrator feeds**, in addition to its current "map an uploaded export" job. Both entry points converge on the same template logic.

---

## 7. Phased build plan

**Phase 0 — Foundations (do first, don't skip).**
Define the canonical comp schema (§2), the property-type vocabulary, and the market taxonomy. Confirm with your Salesforce admin **where Ascendix comps live and whether they're API/connector-exposed.** Deliverable: a schema doc + field-mapping tables for all three sources.

**Phase 1 — `salesforce.query_comps` via Power Automate (Option A).**
Stand up the HTTP-triggered flow; build the tool against it behind the connector seam; validate that its output matches the canonical schema exactly (diff against a hand-built comp set). Deliverable: an agent can pull live Salesforce comps on demand.

**Phase 2 — Orchestrator MVP.**
Wire `comps.synthesize` to the two existing Supabase query paths + the new Salesforce tool. Implement intent parse, a v1 source-router rules table, parallel fan-out, and template export. Skip fancy dedup/scoring at first — get an end-to-end unified sheet out. Deliverable: "medical comps in Ohio" produces one merged, template-formatted sheet.

**Phase 3 — Quality layer.**
Add dedup, the reconciliation precedence policy, weighted scoring/ranking, graceful per-source degradation, truncation signaling, and the provenance/interpreted-query echo. Deliverable: output you'd put in front of a client unedited.

**Phase 4 — Harden + migrate.**
Swap the Salesforce backend to the Connected App / Client Credentials REST path (Option B) behind the same seam; add caching, rate-limit handling, and a small eval set of golden requests to catch regressions when you tune the router. Deliverable: production-grade, low-latency, auditable.

A reasonable sequencing note: Phase 0 and the Salesforce-admin question gate everything, so start them this week even if the build waits.

---

## 8. Risks and how the design handles them

- **Silent partial results.** Mitigated by explicit `truncated` flags, per-source result counts in provenance, and graceful degradation with warnings — never a silent drop.
- **Schema drift in Ascendix/Salesforce.** Mitigated by data-driven field-mapping tables and keeping `raw`, so a field rename is a config edit, not a code change.
- **Power Automate limits/throttling.** Mitigated by filter push-down, hard result caps, pagination in the flow, and treating Option A as a bridge to the real API.
- **Bad merges / wrong reconciliation.** Mitigated by conservative blocking keys, an explicit written precedence policy, and surfacing merge decisions in provenance so they're reviewable.
- **Wrong interpretation of the request.** Mitigated by the interpreted-query echo and a clarifying question when a human is present.
- **Data governance.** The Salesforce integration user's profile scopes what the tool can read; log every query (you already have `log_memory`) for auditability; decide up front whether client-confidential comps may be blended into shared outputs.

---

## 9. The one-paragraph version

Build a **single canonical comp schema** first; it's the contract that makes everything else composable. Add **`salesforce.query_comps`** to the LCC MCP server behind a pluggable connector — ship it on a Power Automate HTTP flow now, migrate to a Connected App + SOQL/REST later without changing its interface — and have it return canonical comps, not raw Salesforce rows. Then add **`comps.synthesize`**, which parses a plain-language request, routes it to the relevant subset of {dialysis DB, government DB, Salesforce} via a small declarative rules table, fans out in parallel, merges and de-duplicates, reconciles conflicts by an explicit precedence policy, ranks by a transparent score, and feeds the result into your existing Briggs comps template — with the interpreted query and full provenance attached. Build it in phases: schema → Salesforce tool → orchestrator MVP → quality layer → harden. The result is exactly what you described: "medical comps in Ohio" or "medical + office lease comps in a market" answered in one call, richer than any single source, in your template, defensible to a client.
