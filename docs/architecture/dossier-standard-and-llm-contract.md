# Dossier Standard — Property & Deal (grounded, LLM-replicable) — 2026-07-31

Purpose: one fixed format the local LLM fills the same way every time, from a reconciled DATA PACKET, with
a hard **no-fabrication** contract. Worked against a real gold-standard property (5247 Airways Blvd,
Memphis) so the model has an exact target to imitate.

---

## 1. The grounding contract (the LLM's rules) — NON-NEGOTIABLE

These go verbatim into the dossier-authoring system prompt. The model authors PROSE and LAYOUT; it never
authors FACTS.

1. **Only use what's in the DATA PACKET.** Every fact in the dossier must trace to a field the LCC supplied
   in the packet (§2). If it isn't in the packet, it does not go in the dossier.
2. **Never invent, infer, estimate, round-to-impress, or "fill in."** No made-up rents, dates, sizes,
   names, cap rates, market color, or comps. Absent field → render exactly **"Not on file."**
3. **Every material figure carries its provenance** — source system + as-of date + confidence when the
   packet provides them (e.g. "$181,959 · source: lease (documented) · as-of 2018-06-06").
4. **Derived values are allowed ONLY when every input is present in the packet**, and must be **labeled
   "Derived"** with the formula shown (e.g. "Implied cap rate 5.78% — Derived: rent $181,959 ÷ sale
   $3,150,000"). Never derive from a missing or unconfirmed input.
5. **Conflicts are surfaced, not resolved silently.** When the packet flags conflicting source values,
   show the **reconciled** value (per the source-authority ladder) and add a one-line "Conflict" note.
   Never pick one arbitrarily and never average them.
6. **Owner ≠ operator, always.** The "Owner" is the packet's **reconciled property owner** (the recorded
   deed owner when the resolver flagged the true owner as an operator). The operator/tenant is named only
   in the tenancy section. Never print the operator as the owner.
7. **Facts vs. Analysis are separated.** A dossier is facts by default. Any interpretive line lives under a
   clearly marked **"Analysis (not a stated fact)"** block, may only recombine stated facts, and may
   introduce **no** new data. If asked for analysis and the facts don't support it, say so.
8. **No external knowledge.** The model must not use anything it "knows" about DaVita, a market, a REIT, or
   a submarket — only the packet. If a section has no packet data, render the section header + "Not on
   file" rather than composing around the gap.
9. **Every dossier ends with the standard verification line** (see the example footer).

**One-line summary the prompt repeats:** *"If it's not in the packet, it's 'Not on file.' If you compute
it, label it 'Derived' and show the inputs. Owner is never the operator."*

---

## 2. The DATA PACKET — the single grounding source the LCC assembles

The LCC gathers only **reconciled** fields and hands the LLM a JSON where every value is tagged. Missing
fields are **omitted** (the renderer prints "Not on file"), so the model can never mistake absence for a
blank to fill.

```
{ "identity":     { "address": {v, source, as_of}, "city_state_zip": {...}, "county": {...},
                    "property_type": {...}, "building_sf": {...}, "land_acres": {...},
                    "year_built": {...}, "ownership_type": {...} },
  "ownership":    { "owner_of_record": {v, source, confidence}, "recorded_deed_owner": {...},
                    "operator_tenant": {...}, "owner_is_spe": {...} },
  "tenancy_lease":{ "tenant": {...}, "annual_base_rent": {v, source, confidence, as_of},
                    "lease_start": {...}, "lease_expiration": {...}, "expense_structure": {...},
                    "escalations_text": {...}, "renewal_options": {...} },
  "operations":   { "medicare_id": {...}, "clinic_count": {...}, "certification_date": {...},
                    "_conflicts": [ {field, values:[{v,source}], reconciled:v} ] },   // dia
  "transactions": [ {date, grantor, grantee, price, source} ],
  "valuation":    { "model_estimate": {v, source:"lcc_model", confidence}, "last_sale_price": {...} },
  "documents":    [ {type, file_name, source} ],
  // deal dossier only:
  "deal":         { "stage": {...}, "point_person": {...}, "parties": [...],
                    "correspondence": [ {date, direction, subject, source} ],
                    "offers": [ {date, buyer, price, status} ],
                    "cadence": { "next_touch_due": {...}, "next_touch_type": {...} },
                    "roe": { "verdict": {...} } } }
```

Assembly reuses existing readers: identity/ownership/tenancy/operations/transactions/valuation from the
property panel loaders + `lcc_property_owner`; documents from `action=documents`; the deal block from the
deal spine (correspondence, `touchpoint_cadence`, offers, `lcc_party_relationships`, ROE).

---

## 3. PROPERTY DOSSIER — standard section order + field grounding

1. **Header** — property name/address · domain · "Property Dossier" · generated date · Team Briggs · Northmarq.
2. **Snapshot** — property type, building SF, land, year built, ownership type, LCC value estimate (labeled
   *model estimate*). Source: `properties`.
3. **Ownership** — Owner of record (reconciled), Recorded deed owner (if different), Operator/tenant (with
   "not the owner"), owner is-SPE. Source: `lcc_property_owner` + `v_ownership_current` (operator-corrected).
4. **Tenancy & Lease** — tenant, annual base rent (+ source/confidence/as-of), term (start–expiration),
   expense structure, escalations (verbatim text), renewal options. Source: `leases` (live only).
5. **Operations** (dia: CMS — Medicare ID, clinic count, certification date; gov: agency, GSA lease #,
   FRPP). Conflicting raw counts shown as reconciled + Conflict note. Source: CMS/agency tables.
6. **Transaction History** — dated grantor→grantee + price rows (sale-leasebacks, transfers). Source:
   deed/sales.
7. **Documents** — OMs / BOVs / leases / comps on file (names + source), each a link. Source:
   `action=documents`.
8. **Analysis (not a stated fact)** — OPTIONAL, clearly fenced; only recombines the above (e.g. implied
   cap on the last sale, years remaining on term). Every line labeled Derived with inputs.
9. **Footer** — verification disclaimer.

## 4. DEAL DOSSIER — standard section order

1. **Header** — deal/property name · stage · point person · "Deal Dossier" · generated date.
2. **The property** — a compact version of §3 (identity, corrected owner, lease).
3. **Parties** — owner/seller, buyer(s), brokers, lender — from the graph (`lcc_party_relationships`),
   REIT/institution flagged.
4. **Correspondence** — the deal's email/call thread, dated + direction (the ingested deal emails).
5. **Offers / LOIs** — dated buyer · price · status.
6. **Cadence & next action** — next scheduled touchpoint + suggested move (from `touchpoint_cadence` /
   the hero resolver).
7. **Rules of engagement** — ROE verdict + reason.
8. **Analysis (not a stated fact)** — optional, fenced, derived-only.
9. **Footer** — verification disclaimer.

(The worked DEAL example is best built on one of the 40 open listings; §5 works the PROPERTY dossier.)

---

## 5. Worked gold-standard example — 5247 Airways Blvd, Memphis, TN (property dossier)

Built from ONLY the reconciled packet for property 23654. Note how absent fields read "Not on file," the
derived cap rate is labeled, the operator (DaVita) never appears as owner, and the CMS chair/patient
conflict is surfaced rather than guessed.

> **PROPERTY DOSSIER**  ·  Team Briggs · Northmarq
> **Airways — 5247 Airways Blvd, Memphis, TN 38116**  ·  Shelby County  ·  Dialysis  ·  Generated Jul 31, 2026
>
> **Snapshot**
> - Property type: Single-tenant medical — Medical Office / Dialysis Clinic
> - Building size: 6,308 SF · Land: 2.51 acres · Year built: 2016 · Ownership: Fee simple
> - LCC value estimate: ~$3,137,221 *(model estimate — not an appraisal; source: LCC valuation model, low confidence)*
>
> **Ownership**
> - Owner of record: **Kingsbarn Realty** *(source: reconciled property owner, confidence 1.00; recorded deed grantee 2018)*
> - Operator / tenant: DaVita Kidney Care — **the operator, not the owner**
> - Owner is a single-purpose entity: No
>
> **Tenancy & Lease**
> - Tenant: DaVita Dialysis
> - Annual base rent: **$181,959** *(source: lease — documented; as-of 2018-06-06)*
> - Term: 2018-06-06 → 2033-06-06
> - Expense structure: NN (double-net)
> - Escalations: "10% every 5 years" *(verbatim from lease)*
> - Renewal options: Two 5-year options
>
> **Operations (CMS)**
> - Medicare ID: 442740 · Clinics at site: 1 · Certified: 2003-02-01
> - Conflict: source station/patient counts disagree (stations 171 vs 29; patients 2,475 vs 33) — **not
>   reconciled; shown as unverified, not asserted.**
>
> **Transaction History**
> - 2018-06-01 — DaVita HealthCare Partners → **Kingsbarn Realty** — **$3,150,000** *(sale-leaseback; source: deed)*
>
> **Documents on file** — 9 offering memoranda / marketing documents + property PDFs *(open from the Documents tab)*
>
> **Analysis (not a stated fact)**
> - Implied cap rate at the 2018 sale: **5.78%** — *Derived: base rent $181,959 ÷ sale price $3,150,000.*
> - Remaining firm term: ~6.8 years to 2033-06-06 *(Derived from lease dates; excludes the two 5-yr options.)*
> - *No current escalated rent is stated in the record; only the $181,959 base + the "10% / 5yr" term are on
>   file, so the present effective rent is **Not asserted** (would require a confirmed post-2023 bump).*
>
> *Generated by the Life Command Center from the reconciled LCC data spine. Facts trace to LCC sources;
> figures are for internal BD use and must be verified against source documents before external distribution.*

---

## 6. How this plugs into the build
- The **renderer already exists** (property dossier v1) — this standard defines the section order/labels it
  targets and the "Not on file / Derived / Conflict" conventions.
- The **LLM layer** (`invokeExtractionAI` / Ollama seam) gets §1 as its system prompt and the §2 packet as
  the user content; it returns prose that slots into §3/§4. Because the packet is pre-reconciled and the
  contract forbids outside data, the model **cannot** fabricate — the worst case is "Not on file."
- **Next:** wire the packet assembler (server-side, reusing the panel loaders), drop §1 into the prompt,
  and produce the same layout with LLM prose; then repeat §5 for a chosen open **deal** to lock the deal
  format.

---

## 7. v2 field additions (2026-08-01) — from the enhancement + audit pass

The v2 gold-standard render is `dossier-example-5247-airways-v2.html`. It extends §3 with the fields below.
Each field keeps the same grounding rules (§1): source-tagged, "Not on file" when absent, "Derived" (with
inputs) when computed, "Conflict" surfaced not resolved.

**Snapshot** — add **Stations (chairs)** (`medicare_clinics.stations`, with capacity), **price/SF** (value ÷
`building_size`), and a one-line **value-estimate basis** inline ("current rent $X · Y.y yrs term · applied
Z.ZZ% cap"); label "model estimate."

**Ownership** — add **Original developer** row (graph `developed` edge / `properties.developer`; "Not on
file" until a developer feeder populates it).

**Tenancy & Lease** — split into distinct rows: **Tenant** (specific entity) and **Guarantor** (with
"guaranty limited to Initial Term; excludes options" when the guaranty says so); **Year-1 base rent + $/SF**
AND **Current (escalated) base rent + $/SF** (current is Derived from anchor × bump math or
`lease_rent_schedule`); **Term remaining (years)** (Derived); **Renewal options** with a **bumps-continue-in-
options?** flag; **Responsibilities (roof / structure / parking / HVAC)** — the dialysis differentiators
(repair/maintenance/replacement split). Rent/SF is **computed on read** when `rent_per_sf` is null.

**Operations (CMS)** — read the CMS tables as source of truth (NOT the property denorm): **Stations (13)**,
**Current patient count + trend** (`facility_patient_counts` history), **Annual treatments (TTM)**, **Est.
revenue + EBITDA + trend** (only when clinic economics are computed — else "Not asserted"; never surface the
property-denorm revenue). **Drop the Medicare ID row.** Add a **relocation paragraph** (operator's earlier
cert date vs this facility's cert date; prior site "Not on file" until lineage backfilled). Add a **Market
Competition** block (nearby CCNs + rents/SF ⇒ renewal-rent pressure; "Not on file" until the query exists).

**Transaction & Marketing Timeline** — one chronological table across prior listings (`available_listings`,
off-market), the reconciled sale (`sales_transactions` live: price + **cap-at-close** + **firm-term-at-close**),
and the current active listing (asking, $/SF, cap, brokers, days-on-market, **portfolio vs single-asset flag**).

**BD Efforts** — owner-entity cadence / recent touches / correspondence / ROE (from the deal spine), joined
property→owner.

**Documents on File** — table of every source (Supabase `lcc-om-uploads`, `sharepoint_pa` intake,
`lcc_cre_property_documents` SharePoint folder feed, Salesforce files) with **date** and a **reconciled?**
status badge (linked / not yet reconciled). Document + research history is presented as the sources behind the
facts.

The paired audit/triage (what displays vs. what exists vs. where the pipeline is broken, with the P0–P3
backlog) is `dossier-v2-audit-and-triage.md`.
