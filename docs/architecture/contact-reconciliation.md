# Contact Reconciliation (WebEx ↔ Outlook ↔ LCC) — the identity spine

_2026-07-30. One person = one LCC entity, resolvable by BOTH email (Outlook/correspondence) and phone (WebEx),
linked to the deal(s) they're a party to. This is §4 of `unified-intelligence-layer.md` — the prerequisite that
lets "an outbound call to number X" and "an email to contact X" close the SAME to-do, and that sharpens the
sent-email deal attribution the 2026-07-30 backfill surfaced. Extends existing infra; forks nothing._

## Why (the concrete gap the backfill exposed)
The Sent-Items backfill attributed 30/42 sends to entities — but several landed on the **person** (Nick Taylor,
Edwin Ryu…) instead of the **asset/deal**, because the matcher takes the most-recent entity mentioning the
recipient. And a WebEx call (phone only) can't attribute at all yet, because no phone→entity link exists. Both are
the same missing primitive: **a resolved identity keyed on email AND phone that also knows the person's deals.**

## Build on (don't fork)
- **`external_identities`** (LCC Opps) — the canonical link table (`source_system`, `source_type`, `external_id` →
  `entity_id`), guarded by `canonicalIdentitySystem()` + `chk_external_identities_source_system`. Today it carries
  domain assets, owners, CMS, and vendor channels (costar/salesforce/email_intake…).
- **`api/_shared/entity-link.js`** — `ensureEntityLink` (the R4-A choke point: junk/federal guards + email-resolution
  tier + SF-account-as-org edge). The single place a link is created — reuse it.
- **`owner_contact_pivot`**, `lcc_institution_contacts`, `unified_contacts` — existing contact stores.
- **`deal-email-matcher.js`** — attributes email→deal by tenant+city; reuse for contact→deal.
- **ORE / `lcc_merge_entity`** — the authority-weighted reconcile + the single backref-mover for merging duplicate
  person entities (the RCG-dedup pattern, applied to people).

## The model
Two new identity channels on the SAME entity, plus a resolver:
- `source_system='outlook'`, `source_type='email'`, `external_id=<lowercased email>` → person entity.
- `source_system='webex'`,  `source_type='phone'`, `external_id=<E.164 phone>`   → person entity.
Both must funnel through `canonicalIdentitySystem()` (register `outlook`/`webex`) and pass the CHECK — **register
the new source_systems first** (the "never introduce a new spelling" invariant), or the writer 500s.

`lcc_resolve_contact(p_email text, p_phone text)` → `{ entity_id, name, confidence, deals[] }`:
1. Exact hit on `external_identities` (email or normalized phone) → the entity.
2. Else match by normalized email/phone/name across person entities; if a single high-confidence match, **link**
   (write the missing identity) and return it; if multiple, return candidates (resolve-or-refuse — never blind-merge).
3. `deals[]` = the asset/deal entities this person is a party to (via `entity_relationships` deal_party edges +
   correspondence), so callers can attach to the deal, not just the person.

## Build steps (order)
1. **Register `outlook` + `webex` source_systems** in `canonicalIdentitySystem()` + extend the CHECK constraint
   (additive migration, provenance-safe).
2. **Phone/email normalizers** — E.164 for phone; lowercase-trim for email (pure, unit-tested).
3. **Backfill `external_identities('outlook','email')`** from existing correspondence: every distinct correspondent
   email already resolved to a person entity → write the link (fill-blanks, dedup). Immediately sharpens attribution.
4. **`lcc_resolve_contact(email, phone)`** RPC (above) — the single resolver every surface calls.
5. **Sharpen `handleOutlookSent` attribution** — resolve the recipient → prefer the **deal/asset** entity from
   `deals[]`; attach the touch to BOTH the contact and the deal (or the deal when present). Fixes the backfill finding.
6. **WebEx contact import** → `external_identities('webex','phone')`, matched to person entities by email/name overlap
   (surface ambiguity to a review lane; never guess). Enables call attribution + call-based auto-retire (§3).
7. **Dedup fragmented person entities** (RCG/Frank pattern) via `lcc_merge_entity`, provenance-tagged, reversible.

## Invariants
- **Register the source_system spelling** before writing (canonical scheme; CHECK-enforced).
- **Resolve-or-refuse** on ambiguity; **fill-blanks**, **provenance-tagged**, **confidence-scored**, **reversible**;
  duplicate-merge only through `lcc_merge_entity` (the single backref-mover). Never a blind merge.
- One resolver in the engine → every surface (sent-email, WebEx, dossier, cadence) resolves identity identically.

## First implementable slice
Steps 1–3 + 5: register the source_systems, backfill `outlook` email identities from correspondence, ship the
resolver, and point `handleOutlookSent` at it to prefer the deal. That alone fixes the attribution finding and lays
the phone-ready identity table for the WebEx layer — no WebEx dependency to start.

## Progress (2026-07-30)
- **`lcc_resolve_contact(email, phone)` — built + live.** Resolves the person entity (`entities.email` →
  `external_identities` outlook → phone) AND the deal(s) via a **city bridge** — real deal-assets
  (`bd_opportunities`) whose city appears in an activity title mentioning the email (the same bridge
  `lcc_offer_context` uses). Verified: `frankm@rcgventures.com` → `primary_deal` = Snellville ✓.
- **`handleOutlookSent` now prefers `primary_deal`** (asset/deal over person), falling back to the most-recent
  correspondent. `node --check`-clean. **Deploy to activate.**
- **KEY FINDING — the deeper fix:** correspondence is NOT linked to asset entities; both `lcc_offer_context` and
  this resolver lean on the **city bridge** (title match), which is fuzzy and can't attribute a same-city
  same-brand ambiguity. The clean fix is linking **correspondence → deal at INGEST** via `deal-email-matcher.js`
  (tenant+city attribution → set `activity_events.entity_id` to the asset). Once correspondence carries the asset
  `entity_id`, the resolver's deal lookup becomes a direct graph read, not a heuristic. **This is the next
  connectivity item** (and it retro-sharpens offer-context, the dossier, and the sent-email attribution at once).
- **Existing 42 backfilled sent rows** were attributed the old (person-preferring) way and are dedup-locked, so a
  re-run won't re-point them — re-attribute via a one-time `UPDATE ... SET entity_id = lcc_resolve_contact(...)`
  over `source_type='outlook_sent'` rows (reversible).
- **Remaining in slice:** person-entity resolution when the email isn't on a person entity (e.g. Frank Meyrath has
  none) — backfill `external_identities('outlook','email')` or set `entities.email`. WebEx phone side (register
  `webex` source_system + import) is the following slice.
