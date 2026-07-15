# Claude Code (LCC) — ORE Tier A: institution-contacts registry + owner→parent resolver + archetype router

## Why (grounded live 2026-07-15 — see `ORE_REALIGNMENT_first_principles_2026-07-15.md`)

The high-value contactless owners are **institutional SPE shells**, and the automated
public-records path (deed/SOS/assessor) cannot reach them:
- 345 ≥$1M contactless owners → 521 gov properties. Of those, only **5 have a deed
  document, 1 OCR-ready**. SOS-direct is IP-blocked (AZ) + narrow (24 owners, all AZ).
- The owner **name** is already known (95% recorded owner, 67% deed grantee), but the
  345 owners carry **0 CoStar contacts, 0 person links, 33 have any relationship, 13
  a resolved manager name.** They are bare `organization` SPEs.
- Their real decision-maker sits at the **parent sponsor** (Blackstone, Boyd Watterson,
  NGP, Easterly, RMR, Hines, Northwestern Mutual…), a *known institution* — not in a
  county SOS record (where the "manager" is a law firm/registered agent).

**So Tier A is a reconciliation problem on data we already hold, not a fetch:** resolve
the SPE → its parent sponsor, and attach the parent's **known** contact from a small
curated registry. One Blackstone contact resolves *every* Blackstone SPE and fans out
across the portfolio. This is the highest-leverage, most-accurate lever for the value.

**Reuse, don't rebuild.** The R5/R6 buyer-parent machinery already does SPE→parent for
BUYERS: `lcc_operator_affiliate_patterns` (has a `relationship` column: `operator` |
`buyer_parent`), `lcc_buyer_parents`, `lcc_resolve_buyer_parent`,
`v_lcc_buyer_spe_entities`. Extend that same machinery to the `owner` relationship. Also
reuse: the cross-reference resolver (`lcc_resolve_owner_cross_reference` +
`lcc_reusable_owner_contacts`), `contact-attach.js` (`linkPersonToEntity`,
`stampContactOnActiveCadence`, `maybeSeedValuableCadence`), `owner_contact_pivot`, and
the B1 reconcile worker (`owner-reconcile.js`). Discipline: additive · fill-blanks ·
provenance-tagged · guarded · reversible · ≤12 api/*.js. No paid API, no fetching.

## Unit 0 — reconciliation-first: prefer the sponsor already in the data + weighted signals

**The doctrine (Scott, 2026-07-15): reconcile identity from ALL clues, authority-weighted.**
Manual reconciliation uses every signal — name + name-core, mailing/notice address,
phone, email, city/state, naming convention, deed grantee, `true_owner`, SF account,
CoStar owner-panel, sales buyer, GSA lessor — and weights the more authoritative ones
(manual > deed/county > SOS > CoStar/RCA + `true_owner` > naming-only) to converge on
the true owner + contact. Agreement of several weak signals confirms identity even when
no single field is authoritative. Build the resolver this way, not as one-source rules.

**Grounded fact this MUST exploit first:** the high-value gov SPEs are asset-named
(`Cira Square`, `810 Seventh Avenue SPE`) — so naming-core → parent is WEAK for gov.
BUT **57% of the 521 ≥$1M gov properties already carry the sponsor in `true_owner`**
(Orion, Hyundai Securities, Blackstone, Hana Asset Mgmt, Lincoln Property, C-III, The
Shooshan Company, even named principals). So:
- **Step 1 — prefer the in-data `true_owner` sponsor.** Resolve a contactless SPE
  owner to its sponsor from the property's existing `true_owner` (weighted: it's a
  captured field, higher authority than a naming guess). This is the cheapest, already-
  traceable resolution and it covers a large share of the value with zero new data.
- **Fix recorded↔true reconciliation as part of this.** The recorded↔true field is
  noisy: case-variant duplicates (`CP-MIDWAY…` vs `Cp-Midway…` → merge on name-core)
  and occasional inversions (`IGIS Asset Management` recorded ↔ `810 Seventh Avenue SPE
  LLC` true_owner — backwards → conflicting-authority flag → review). The weighted
  reconciler catches both; don't blindly trust `true_owner` — validate it against the
  other signals (an SPE-shaped `true_owner` with a firm-shaped `recorded_owner` is
  likely inverted).
- Only when the sponsor is NOT already in `true_owner`/the graph do you fall to the
  owner-parent resolver (Unit 2) and then the institution registry (Unit 1).

## Unit 1 — the curated `institution_contacts` registry (the accuracy anchor)

A small, high-trust table on LCC Opps: sponsor institution → its primary
acquisitions/asset-management contact(s), each `source`-tagged and traceable.
- Migration (additive, reversible): `lcc_institution_contacts` (institution_entity_id
  FK → entities, contact_name, contact_title, contact_email, contact_phone, source,
  source_url/note, confidence, added_by, added_at). Partial-unique on
  `(institution_entity_id, lower(contact_name))`.
- **Seed conservatively from the top-value contactless clusters** — do NOT fabricate
  contacts. Seed only institutions where the sponsor is unambiguous and a contact is
  genuinely known/public (Scott can confirm/add via the Decision Center; leave the
  rest `needs_institution_contact`). The seed list is the value: the 345 ≥$1M owners'
  names cluster into a few dozen sponsors — surface that cluster (a
  `v_institution_registry_gaps` view: distinct resolved parent → count of contactless
  SPEs + rolled-up rent, ORDER BY rent desc) so the registry is filled highest-value
  first, one contact resolving many SPEs.
- **NEVER invent a contact.** A registry row is a curated fact; an absent institution
  stays a directed research task (Unit 4), not a guess.

## Unit 2 — the owner→parent resolver (extend R5/R6 to owners)

- Add `relationship='owner_parent'` rows to `lcc_operator_affiliate_patterns` (or a
  parallel owner-parent registry mirroring `lcc_buyer_parents`) for the sponsor→SPE
  name patterns of the top owner clusters. **Per-row domain truth outranks blind name
  patterns** (the R6 doctrine — verify against the owner's actual name, never a bare
  `% FGF%`→X guess; surface ambiguous → review).
- `lcc_resolve_owner_parent(entity_id)` — resolve a contactless owner SPE to its
  registered parent institution via: (a) the owner-parent pattern table, (b)
  distinctive naming-core shared with a registered institution, (c) shared notice
  address (once addresses populate). Conservative/unambiguous — a miss returns null,
  never a wrong parent. Mirror `lcc_resolve_buyer_parent`'s guards
  (junk/implausible/federal/operator filters).
- **`owner_archetype` classifier** (pure, from data we already hold — name shape +
  asset value + sponsor-pattern match + formation state): tags each contactless valued
  owner `institutional` (SPE-shaped, resolvable/likely-sponsor-owned) vs `local`
  (non-SPE, single-property, locally formed). Materialize onto the owner (or a view)
  so B1 + the worklist can route on it.

## Unit 3 — attach + propagate (one contact → the whole sponsor portfolio)

- Worker path (extend `owner-contact-enrich.js` or a new sub-route of operations.js —
  no new api/*.js): for an `institutional` contactless owner, `lcc_resolve_owner_parent`
  → look up `lcc_institution_contacts` for the parent → if a curated contact exists,
  **attach it** (reuse `contact-attach.js`: ensure the person entity, link
  person→owner-SPE `associated_with`, stamp `owner_contact_pivot.active_contact_*`,
  `maybeSeedValuableCadence`). Provenance: the pivot/relationship carries
  `source='institution_registry'` + the parent + the registry row id, traceable.
- **Propagation (the leverage):** attaching a parent's contact must fan out to ALL
  sibling SPEs of that parent in one pass (drive off `lcc_resolve_owner_parent` over
  the contactless set, not one owner at a time). Resolve Blackstone once → every
  Blackstone SPE gets the contact + a seeded cadence. Idempotent, reversible.
- **Never guess-attach.** No parent match OR no registry contact ⇒ the owner routes to
  Unit 4 (directed research), never a fabricated contact.

## Unit 4 — archetype router into B1 + directed residual

- Extend the B1 reconcile classifier (`owner-reconcile.js reconcileOwnerRow`): split
  `needs_enrichment` into `resolve_parent_then_registry` (institutional) vs
  `fetch_public_records` (local). `routed_to` gains `institution_registry`.
- The **residual** after Tier A runs is a small, honest, directed list (surface in the
  Decision Center / worklist, value-ranked): (i) `needs_institution_contact` —
  institution resolved but not yet in the registry (add ONE contact → resolve many;
  this is the highest-value manual action), (ii) `needs_parent_resolution` — SPE whose
  parent is ambiguous (a directed review), (iii) `local_needs_public_records` — the
  Tier-B tail for the deed/SOS path. Never a 3,491-row undifferentiated backlog.

## Boundaries / verify
- LCC-Opps only (owner-parent + registry + attach); no dia/gov writes beyond the
  existing provenance path. Additive · fill-blanks · reversible (drop the registry +
  owner_parent rows → zero trace) · provenance-tagged · ≤12 api/*.js. No fetching, no
  paid API, no fabricated contacts.
- **Verify (dry-run first):** `v_institution_registry_gaps` shows the sponsor clusters
  over the 345 ≥$1M owners (a few dozen sponsors covering most of the value); seeding a
  handful of top institutions + running Unit 3 attaches a curated contact to *many*
  high-value SPEs at once and seeds their cadences (worklist ≥$1M contactless drops
  materially in one pass). Spot-check 5 resolved SPEs → correct parent → correct
  registry contact, each traceable. Ambiguous parents route to review, not a wrong
  attach.

## Note (already grounded — do NOT chase)
The CoStar owner phone/email capture is **not broken** — the org writer lands it when
present (290 org entities carry email/phone), but institutional SPEs don't list a
phone/email on CoStar (0/345 high-value; gov `recorded_owners.contact_info` = 0
phone/0 email). It's a genuine data-absence, a minor Tier-B contributor, not a bug.

## Bottom line
Route by owner archetype. For the institutional value, resolve SPE→parent and attach the
parent's *known* contact from a small curated registry — reusing the R5/R6 parent
machinery + the cross-reference/attach engines — and fan one resolved contact across the
sponsor's whole SPE portfolio. That is how ownership resolution becomes both automatic
AND accurate for the owners that carry the value, with zero fetching.
