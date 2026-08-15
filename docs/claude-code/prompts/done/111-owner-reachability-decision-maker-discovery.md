# Prompt 111 — Owner reachability: close the decision-maker discovery gap (BREAK-1)

**Origin:** proving the 2026-08-15 property/owner panel redesign end-to-end
(`docs/architecture/panel-redesign-verification.md` §3, `connectivity-and-open-threads.md` §4b BREAK-1).

**Why this is the top priority.** The redesign made the property panel hand off to the owner panel via
`Work this owner →`. That hand-off is correct — and it dead-ends. **Only 104 of 690 owner entities (15.1%)
have any contact method**, so the owner panel's hero action resolves to *"Find a contact"* for ~85% of
owners, and the public-records enrichment chain behind it is PAUSED / CI-blocked. Every other BD surface
(My Day, cadence, Decision Center) inherits the same ceiling. **This is the binding constraint on the whole
BD loop, not a UI issue.**

---

## Grounded baseline — do NOT re-derive, but DO re-verify before building

Measured 2026-08-15, read-only. SQL in `panel-redesign-verification.md` §3.2.

| Fact | Value |
|---|---|
| asset entities (dia+gov) | 3,886 |
| assets with a resolved owner (`lcc_property_owner`) | 1,396 (35.9%) |
| distinct owner entities reachable from an asset | 690 |
| owners with email/phone on the **org** record | 50 |
| owners with a **linked person** carrying email/phone | 60 |
| **owners reachable by any route** | **104 (15.1%)** |
| unreachable owners | **586** |
| …of those, with a **`salesforce` external identity** | **80** |
| …of those, with **any** graph edge | 583 |
| …of those, with a **NAMED person** but no contact detail | **1** |
| …of those, with **no person known at all** | **585** |
| …of those, **already on a touchpoint cadence** | 94 |
| gov `recorded_owners.manager_name` populated | **1,469** of 17,229 |
| gov `recorded_owners.mailing_address` / `registered_agent_name` | 31 / 137 |
| dia `recorded_owners.manager_name` / `address` | 31 / 551 of 7,217 |

### The reframe this forces
**585 of 586 have no person known at all.** This is NOT "we know the decision-maker but lack their email."
It is "we hold an LLC name and nothing behind it." So contact-detail *enrichment* is the wrong lever;
**decision-maker discovery** is the right one. Two of the three leads below need **no new external fetching**.

---

## Investigate, in this order (highest confidence first)

### Lead A — the domain→entity propagation gap (likely the biggest free win)
gov `recorded_owners.manager_name` is populated on **1,469** rows — ORE Phase 1 Unit A already extracted the
managing member/firm behind those LLCs from the SOS registry. Yet the LCC owner graph shows **1** named
person across all 586 unreachable owners.

**Hypothesis:** the manager name lands in the domain DB and is rendered on the ownership ladder, but is never
**minted as a `person` entity** and **linked to the owner org** in LCC Opps — so `buildContact360` /
`/api/contacts?entity_id=` never sees it and the hero says "Find a contact".

Determine:
1. How many of the 690 LCC owner entities map (via `external_identities` `source_system in ('dia','gov')`,
   `source_type='true_owner'`) to a domain `recorded_owners` row that HAS a `manager_name`? **This number is
   the size of the free unlock — report it before writing any code.**
2. Is there an existing path that was meant to do this (`ensureEntityLink`, `owner-contact-enrich`,
   `lcc-owner-contact-signals-sync`/`-finalize`, `owner_contact_pivot`)? **Review existing machinery before
   building** — the CLAUDE.md doctrine and the P3.3 notes suggest `v_owner_contact_signals_portfolio`
   already carries the manager to the pivot. If the pipe exists, find where it stops (flag off? cron
   disabled? value gate? `junk_entity_review`?) rather than building a parallel one.
3. A manager name with **no email/phone** still does not make the owner *reachable* — but it changes the
   owner-panel hero from *"Find a contact"* (a dead end) to *"Connect in Salesforce"* / *"Research this
   person"* (actionable). **Quantify both**: owners that would gain a NAME, and owners that would gain a
   reachable CONTACT.

### Lead B — Salesforce contacts we already have rights to
**80** unreachable owners carry a `salesforce` external identity. SF very likely holds Contacts under those
Accounts.

Determine: does any current path pull SF Contacts for a linked Account onto the LCC entity as person
records + `unified_contacts`? (`sf-account-link.js`, the SF sync, `_entityAcquireContact`'s
`buyer_contacts` route.) If the acquire-contact picker can already surface them **on demand**, the gap is
that nothing does it **in bulk / ahead of time**, so the hero still reads "Find a contact" until a human
opens the panel. Consider a value-gated backfill.

**Doctrine constraint:** Salesforce is a *reconcilable source, never automatic truth*, and LCC does not clean
SF. An SF Account binds as an **org edge** on the person, not an identity on the person
(`api/_shared/sf-account-link.js`). Fill-blanks only; never overwrite a curated contact.

### Lead C — correspondence + documents we have already ingested
Only **3** of the 586 have any `activity_events`. But the repo has ingested deal correspondence (872 emails,
and prompt 110 widened body capture) and OM/deed party extraction (ORE Phase 1 Unit C/E) that write
`contacts` in the domain DBs.

Determine: for the 586, is there a party name/email sitting in `dia.contacts` / `gov.contacts` (from
`om_extraction`) or in `deed_records.grantee_address` / correspondence participants that never reached the
entity graph? Same propagation question as Lead A, different source.

### Lead D — bound the blocked path honestly
The SOS-direct fetcher (`W9_1_SOS_DIRECT`) and the web-search proxy are OFF/paused. **Do not re-provision or
recommend a new provider** (§25 of the gov CLAUDE.md is explicit; the residential proxy is BUILT and the
remaining blocker is TLS/bot-wall fingerprinting, not egress). Just state how many of the 586 could *only*
be solved by that path, so the paused flag has a measured cost attached.

---

## Deliverable

1. **A grounded findings section** appended to `docs/architecture/connectivity-and-open-threads.md` §4b
   BREAK-1: the four lead sizes, which pipe is broken vs missing, and the honest ceiling of each.
2. **The highest-value unlock, built** — with the standing discipline: fill-blanks-only · conservative /
   unambiguous matching (ambiguity → review lane, never guess) · junk-guarded (`isMisparseName`,
   `validateContactIngest`, the TrafficMetrix fan-out cap) · provenance-tagged
   (`field_source_priority` row registered, else `v_field_provenance_unranked` flags drift) · reversible via
   a batch tag · idempotent · **dry-run default**.
3. **A value gate + a named consumer** (Consumption-Layer doctrine). Do not mint 586 person entities because
   we can. Rank by the owner's portfolio value / our open deals, cap the emission, and say which surface
   consumes each new contact.
4. **Re-run the §3.2 reachability SQL and report the before/after**: 104 / 690 → ?. If the honest answer is
   "this unlocks 40, not 400," say so — a measured small win beats an unmeasured claim.

## Explicitly out of scope
- Re-enabling or replacing the SOS-direct / web-search enrichment path.
- Any write to Salesforce beyond the existing sanctioned direct-team-benefit cases.
- UI changes — the panel already renders whatever the data provides.
