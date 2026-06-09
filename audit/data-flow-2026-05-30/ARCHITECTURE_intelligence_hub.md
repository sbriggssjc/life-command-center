# LCC as the Centralized Intelligence Hub — Architecture Design

> Draft 2026-06-08. The design for turning LCC from a BD data system into the
> single brain that (a) ingests from every channel, (b) propagates new
> knowledge everywhere it belongs, (c) makes every agent/chat fully informed
> with the same context, and (d) produces consistent deliverables regardless of
> which tool a team member uses — across all current and future verticals.

---

## 1. North star (the vision, distilled)

One centralized brain that houses everything we know about every **deal,
property, tenant, developer, buyer, prospect, and broker**, so that:

- **Every interaction is fully informed.** Whether a team member opens Copilot,
  Claude, ChatGPT, or LCC, the assistant already knows the full breadth and
  depth of our collective knowledge on the subject at hand.
- **Every interaction is consistent.** The same task produces the same format,
  layout, tone, and quality no matter who runs it or which tool they use.
- **Every interaction enriches the brain.** Emails, call notes, Salesforce
  notes, new documents, research — all of it flows back in and lands everywhere
  it belongs.
- **The brain grows and is liveable.** Conventions, decisions, and learnings
  accumulate as durable memory, not tribal knowledge.
- **The architecture is vertical-agnostic.** Dialysis and government today;
  childcare, vet care, urgent care, and other net-lease verticals tomorrow —
  same pipeline, same interaction model, same standards.

The realization that makes this tractable: **LCC already is this system in
embryo.** The audit work proved it has a system of record (entities,
properties, leases, sales, contacts), an ingestion pipeline (extract → match →
promote → propagate), a propagation/provenance layer, a decision/learning loop,
and a domain-parallel structure (dia/gov). The job is not to build a new system
— it's to add three connective layers (a unified ingestion fabric, a context
layer, and a standards layer) on top of what exists, and to point storage at a
home that scales.

---

## 2. The five layers

```
                ┌──────────────────────────────────────────────┐
   Team member  │  5. STANDARDS & OUTPUT LAYER                  │  consistent
   (any tool) → │     skills · templates · house style · brand │  deliverables
                ├──────────────────────────────────────────────┤
   Any agent  → │  4. CONTEXT LAYER  (the brain's recall)       │  fully informed
                │     "assemble everything known about X"        │
                ├──────────────────────────────────────────────┤
                │  3. PROPAGATION & ENRICHMENT                   │  lands everywhere
                │     cross-propagate · provenance · learning    │
                ├──────────────────────────────────────────────┤
   Every       │  2. INGESTION FABRIC  (everything in)          │  one pipeline,
   channel  →  │     files · email · notes · SF · public · CoStar│  many channels
                ├──────────────────────────────────────────────┤
                │  1. SYSTEM OF RECORD  (canonical memory)       │  the brain
                │     entities · properties · leases · deals …   │
                └──────────────────────────────────────────────┘
```

### Layer 1 — System of Record (the canonical memory)
**Exists today.** The LCC + domain Supabase databases are the single source of
truth: every property, tenant, owner, buyer, broker, deal, contact, and the
relationships among them, with field-level provenance. This is the "brain's
memory." Everything ingested normalizes into it; everything any agent recalls
comes from it. Future verticals are new domain databases that plug in
identically (the dia/gov pattern generalizes).

### Layer 2 — Ingestion Fabric (everything in, one pipeline)
**Partly exists; this is the biggest build.** Today's channels — email OM
intake, CoStar capture, public data (FRPP/GSA/CMS/USASpending/etc.) — all
converge on the same extract → match → promote pipeline. The vision extends
that to **every** channel:

| Channel | Status | What it adds |
|---|---|---|
| Email OMs / flyers | live | deal docs |
| CoStar / public data | live | market + reference data |
| **ShareFile / OneDrive folders** | **to build** | leases, DD, master sheets, comps, OMs, BOVs — the richest source |
| **Outlook email + correspondence** | **to build** | not just OMs — every email as relationship + deal signal |
| **Call / conversation notes** | **to build** | phone notes, meeting notes (transcribe → notes → enrichment) |
| **Salesforce notes** | **to build** | the relationship history already captured in SF |

The doctrine: **one pipeline, many channels.** Each new channel is an adapter
that produces a normalized payload and hands it to the existing
extract → match → promote → propagate machinery — never a parallel pipeline.
The folder path is itself a strong matching anchor (property/tenant/city,state
resolves the subject far more reliably than parsing a cover page).

### Layer 3 — Propagation & Enrichment (lands everywhere it belongs)
**Largely exists.** Cross-propagation, field-provenance, the sync functions,
and the decision/learning loops already ensure a new fact enriches the canonical
entity and is trusted by source-priority. The extension: make correspondence and
notes first-class enrichment sources (an email mentioning a tenant renewal, a
call note about a buyer's appetite) and route them to the right entity with
provenance, the same way OM fields are.

### Layer 4 — Context Layer (every agent fully informed) — **the keystone**
This is the new concept that delivers "every conversation has all agents fully
informed." It's a **context-assembly service**: given a subject (a property, a
tenant, a buyer, a broker, a deal), it assembles the full breadth and depth of
what's known — structured facts, documents, correspondence, notes, prior
decisions — into a **context packet** that any agent consumes before responding.

- LCC already has the seed of this (`context_packets`, the MCP-style
  `get_property_context` / `get_contact_context` / `search_entities` surfaces).
- Exposed as an **MCP server** (and a plain API), the same context service is
  callable by Claude, by Copilot Studio agents, by a ChatGPT custom GPT, and by
  LCC itself. **That single shared service is what makes every tool equally
  informed** — they don't each maintain their own knowledge; they all recall
  from the one brain.

### Layer 5 — Standards & Output Layer (consistent deliverables)
This delivers "same format, layout, tone, quality, regardless of tool." The
mechanism is **single-sourcing the "how"**:

- **Skills/templates encode each deliverable's structure** — BOV underwriting,
  Briggs comps, memos, master sheets, underwriting, contracts, correspondence.
  Several already exist as Claude skills (BOV dia/gov, Briggs comps, CMS/NPI,
  docx/xlsx/pptx).
- **A house style + brand standard** governs tone and format (the Northmarq
  brand is already documented and centralized in `branding.py` /
  `cm_brand_tokens.json`).
- **One canonical source, syndicated to every platform.** The skill/template/
  style files live in one place (a repo + shared store). Each tool's wrapper
  *references that same source*: Copilot Studio agents load the instructions,
  Claude loads the skills + project knowledge, a ChatGPT custom GPT loads the
  MD, LCC embeds them. The instruction set is authored once and distributed —
  never re-written per tool.

**Consistency = shared context (Layer 4) + single-sourced standards (Layer 5).**
Those two shared layers are precisely what makes Copilot, Claude, ChatGPT, and
LCC produce the same informed, on-brand output.

---

## 3. Cross-platform consistency — the honest mechanics

The hard truth: Copilot Studio, Claude, ChatGPT, and LCC each have *different*
extension models. You will not get literal identical behavior for free. What
you can get — and what makes the team experience consistent — is two shared
spines that every platform points at:

1. **Shared CONTEXT spine** — the Layer-4 context service, exposed as an **MCP
   server** plus a REST API. MCP is the lever here: Claude consumes MCP
   natively; Copilot Studio and custom GPTs can call the REST/tool endpoints.
   One brain, many front doors.
2. **Shared STANDARDS spine** — the Layer-5 skill/template/style files in a
   canonical repo, mirrored into each platform's instruction slot. A change to
   the BOV format is made once and re-syndicated; it never drifts per tool.

Where a platform can't consume a skill directly, the fallback is an MD
instruction document that encodes the same standard — the same content, a
different delivery slot. The governance rule: **authored once, in the canonical
repo; distributed everywhere; never edited in a platform-specific copy.**

---

## 4. Vertical-agnostic design (dia/gov → childcare, vet, urgent care …)

The pattern already proven by dia + gov generalizes directly. A new vertical is:

- a **new domain database** with the same core shape (properties, leases,
  tenants/operators, owners, sales, the BD spine);
- a **connector** the LCC orchestrator syncs (the existing entity/portfolio/
  listing sync pattern);
- the **same ingestion fabric, context layer, and standards layer** — unchanged.

Nothing about the brain, the context service, or the deliverable standards is
vertical-specific; only the domain data and a few vertical nuances (e.g.
underwriting assumptions) differ. Adding childcare or vet care is "stand up a
domain DB + connector and point the existing layers at it," not a rebuild. This
is the single biggest payoff of getting the architecture right now.

---

## 5. The team interaction model (how members engage)

Every team member, from whatever tool, gets the same loop:

1. **Ask** — "draft a BOV for 123 Main St," "what do we know about this buyer,"
   "pull comps for this submarket," "write the seller correspondence."
2. **Fully informed** — the tool calls the context service (Layer 4) and pulls
   the complete picture of the subject before it does anything.
3. **Consistent output** — the tool runs the canonical skill/template (Layer 5)
   so the deliverable matches house format/brand/tone exactly.
4. **Enriches the brain** — the interaction, the new document, and any notes
   flow back through the ingestion fabric (Layer 2) into the system of record
   (Layer 1), provenance-tracked, so the next interaction is smarter.

That fourth step is what makes the brain *liveable and growing*: usage is
ingestion. Emails, call notes, and decisions are not exhaust — they are fuel.

---

## 6. Storage — the immediate slice (and how it seeds the rest)

Today's storage pain is the natural on-ramp. The recent ingest-to-Storage change
already writes large files to a bucket and keeps only a reference + extracted
data in the DB. **Slice 1 is repointing that storage adapter from the Supabase
bucket to your company-paid ShareFile (or OneDrive/SharePoint via Microsoft
Graph).**

- Solves the cost/limit problem immediately (files live in company storage, the
  DB keeps only references + extracted data).
- Respect the hot-path rule: store the raw file once, extract once, never make
  the extraction path re-fetch a multi-MB blob synchronously.
- **Platform choice:** you're already deep in Microsoft 365 + Power Automate
  (your whole email-intake channel runs through it), so **OneDrive/SharePoint
  via Graph is likely the lower-friction integration than Citrix ShareFile's
  API** — but where the *authoritative* team files live should decide it. Pick
  one canonical store or the integration doubles.

Critically, this same adapter is the foundation for Layer 2's folder-feed: once
LCC can read/write the company store, ingesting the property folders
(leases/DD/master sheets/comps/OMs/BOVs) is the next, higher-value slice.

---

## 7. Phased roadmap

| Phase | What | Value | Build size |
|---|---|---|---|
| **1. Storage adapter** | Repoint ingest-storage at ShareFile/OneDrive; DB keeps references only | Solves storage limit now; foundation for everything | Small (adapter swap) |
| **2. Folder-feed intake** | Property folders → existing extract/match/promote pipeline; per-file-type extractors (lease, master sheet, comp export) | Data quality jumps a tier; folder path = strong match anchor | Medium |
| **3. Correspondence + notes enrichment** | Outlook email, call/meeting notes, SF notes → entity enrichment with provenance | Relationship intelligence; the brain "remembers" every interaction | Medium |
| **4. Context layer as shared service** | Harden the context-assembly service; expose as MCP + REST for all tools | "Every agent fully informed" becomes real cross-tool | Medium |
| **5. Standards spine + syndication** | Canonicalize deliverable skills/templates/house style; syndicate to Copilot/Claude/GPT/LCC | Consistent output regardless of tool | Medium (ongoing) |
| **6. New verticals** | Childcare/vet/urgent-care domain DBs + connectors on the same layers | Same architecture, new markets | Repeatable |

Phases are independently valuable — returns at each step, not a big-bang
finale. Phase 1 is a concrete next prompt; Phases 2–5 are deliberate designs.

---

## 8. Honest caveats / risks

- **Storage API reality.** ShareFile/Graph are external SaaS APIs (slower,
  rate-limited, OAuth token refresh). Use async/queued offload, never a
  synchronous hot path — the same lesson as the Railway-vs-edge offload.
- **Permissions.** Company files carry access controls; the integration's
  service identity needs proper, least-privilege scoping. Don't let the brain
  read what a given team member shouldn't.
- **Cross-platform drift is the standing enemy.** The single-source-and-
  syndicate rule is the only thing that prevents the BOV format from quietly
  diverging across four tools. Governance, not cleverness, keeps it consistent.
- **Context quality = ingestion discipline.** "Fully informed" is only as good
  as what landed in the brain. The provenance/decision/learning loops we built
  are what keep the recall trustworthy — extend them to the new channels, don't
  bypass them.
- **Don't fork the pipeline.** Every new channel is an adapter into the *one*
  extract/match/promote/propagate machinery. The moment a channel writes
  domain data directly (as the CoStar sidebar partly does), provenance and
  consistency erode.
- **Scope discipline.** This is a multi-quarter program, not a round. The value
  is real at every phase; resist wiring all six phases at once.

---

## 9. Slice 1 — the actionable next step

Storage adapter, as a concrete prompt for Claude Code (drafted separately when
you're ready):

> Add a pluggable storage backend to the OM ingest path so large artifacts
> write to **company storage (OneDrive/SharePoint via Microsoft Graph, or
> ShareFile)** instead of the Supabase `lcc-om-uploads` bucket. The DB keeps
> only `storage_path`/reference + extracted data — never `inline_data`.
> Async/queued, OAuth with token refresh, least-privilege identity, idempotent,
> with the existing offload pattern as the model. Keep the Supabase bucket as a
> fallback during cutover. This both eliminates the storage-limit problem and
> lays the foundation for the Phase-2 folder-feed.

When you're ready, I'll turn Phase 1 into that paste-ready prompt and sketch the
Phase 2 folder-feed (the matching anchor + the per-file-type extractor design)
in detail.
