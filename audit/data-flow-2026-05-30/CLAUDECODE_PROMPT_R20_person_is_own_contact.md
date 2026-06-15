# Claude Code — R20: recognize a person-entity as its own contact (the near-free outreach unlock)

## Why (grounded live 2026-06-15)
R16 unlocked the 67 SF-mapped prospecting entities by pulling SF contacts. Auditing
the remaining "328 cold" cadences (no SF, no contact) found they're not all cold —
they break into three buckets:
- **~158 person-entities that ALREADY have an email or phone** on the entity record
  (verified: Steven Manela, Clifford Wetherill, Akram Abdeljaber — email+phone;
  Neil McMurry, Paul Mann, Gopal Bathija — phone). The cadence is seeded ON the
  person (the owner IS an individual), the person has contact info, but the cadence's
  `contact_id`/`sf_contact_id` is null → the reachability gate treats it as
  contactless → it sits un-actionable in P-CONTACT. **Pure wiring gap — a person is
  their own contact.**
- ~102 person-entities with NO email/phone → genuine contact research (out of scope).
- 69 org-entities with no person → LLC/SOS/CoStar acquisition (out of scope).

This prompt does the first bucket only — the near-free ~158-cadence unlock. Combined
with R16's SF-acquired set, it takes outreach-ready from ~22 toward ~180 with zero
research cost.

## The fix — person-as-own-contact (two small, consistent changes)
### 1. Reachability gate (`v_priority_queue_live`, the R16 Unit 2 `reachable_cadence`)
Add a third reachable condition: the cadence's ENTITY is itself a `person` with a
non-null `email` OR `phone`. So `reachable_cadence` = cadence has `sf_contact_id` OR
`contact_id` OR a related person-contact **OR the entity is a person with
email/phone**. These move out of P-CONTACT into the real outreach bands (P0/P6/P7)
because there's a real recipient — the person themself.
(Apply alongside / after the held R16 Unit 2 gate so the two reachability changes
land together and consistently.)

### 2. Self-stamp the contact so the draft path has a recipient
A backfill + a forward path that, for a prospecting cadence whose entity is a
`person` with email/phone and no `contact_id`, sets **`contact_id = entity_id`** (the
person is their own contact). Reuse the shared `contact-attach` stamp helper (R16) so
the cadence-stamp logic stays single-sourced. Then the draft/mailto path resolves the
recipient email from the contact entity (= the person) exactly as it does for a
linked contact — confirm `getBuyerContacts`/the draft recipient resolver handles
"contact entity == cadence entity" (a person who is their own contact) without
assuming a separate contact row.
- Backfill: a one-shot pass (or fold into the `contact-acquisition-tick` worker as a
  second branch) stamping the ~158 eligible cadences. Idempotent, guarded on
  `contact_id IS NULL AND entity.entity_type='person' AND (email OR phone)`.
- Forward: the same branch in the acquisition worker catches new person-with-contact
  cadences automatically.

## Boundaries / guards
- Only `person`-typed entities self-stamp (an org is NOT its own contact — orgs stay
  in the cold/LLC track).
- Skip mistyped firms: a person-typed entity whose NAME has a firm suffix (the
  R7 Phase 2.5 / `looksLikePersonName` guard) should NOT self-stamp — e.g. "DAUM
  Commercial Real Estate Services" is a firm mistyped as a person; it shouldn't be
  treated as a reachable individual. Reuse the existing person-plausibility guard.
- dia/gov pipelines untouched; this is LCC-side cadence/queue wiring only.
- Don't fabricate contact data — only wire what's already on the record.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Tests: a person-entity cadence with
email/phone + no contact_id → self-stamps + becomes reachable; a person with no
contact info → stays cold (P-CONTACT); an org → never self-stamps; a firm-suffixed
mistyped-person → not self-stamped (guard). Reachability view: the new condition
moves exactly the eligible persons out of P-CONTACT, touch bands otherwise unchanged.

## After deploy (Cowork verifies live)
- The ~158 person-with-contact cadences self-stamp and leave P-CONTACT for the
  outreach bands; outreach-ready jumps from ~22 toward ~180.
- A draft for one of them resolves the recipient from the person's own email.
- P-CONTACT shrinks to the genuinely-cold remainder (~102 no-contact persons + 69
  orgs) — the real contact-research backlog, now honestly sized.

## Follow-on (separate, the genuine-cold tail — NOT this prompt)
- 102 persons with no contact info → contact-enrichment/skip-trace path.
- 69 orgs with no person → LLC-research/SOS/CoStar-broker acquisition (extend the
  R16 worker beyond SF).
Both are real research work; R20 first clears the half that needs none.
