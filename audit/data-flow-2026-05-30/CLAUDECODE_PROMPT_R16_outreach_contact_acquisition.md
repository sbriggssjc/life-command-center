# Claude Code — R16: unlock the outreach loop by auto-acquiring contacts from Salesforce

## Why (grounded live 2026-06-13) — this is the conversion point of the whole system
The cadence engine (R10) works, but the outreach loop is NOT closing in production:
**409 cadences, only 3 ever touched, 400 overdue.** Root cause is not the cadence
mechanics — it's that there's no one to contact:

- **395 prospecting cadences, 0 with a contact** (`contact_id` and `sf_contact_id`
  both NULL on every one). The cadences were seeded on owner/developer ENTITIES;
  no human contact was ever attached, so a "draft email" has no recipient and the
  operator can't act.
- Of the 395 prospecting entities: **0 have a related person entity** in the graph,
  but **67 carry a Salesforce account identity** (`external_identities.source_system
  ='salesforce'`) — meaning the contacts almost certainly already exist in
  Salesforce and just aren't being pulled into LCC. 328 have no person + no SF →
  genuine cold contact-acquisition (separate, slower track, out of scope here).

So the single highest-leverage unlock: **auto-acquire the Salesforce contacts for
the 67 SF-mapped entities and attach them to their cadences**, turning dead
contactless cadences into outreach-ready ones with zero manual work. The pieces
exist — `find_contacts_by_account` (built for the P-BUYER picker) — they're just
not wired to the cadence/contact-resolution path.

## Also fixes a reachability-gate asymmetry (grounded)
R10's reachability gate counts an entity as "reachable" if it has an SF account
identity OR a related person. So the 67 SF-mapped (account, but no person contact)
sit in the OUTREACH bands (P0/P6/P7), not P-CONTACT — the operator gets an outreach
card with **no actual person to send to**. Pulling the contacts closes that gap:
either they get a real contact (→ workable), or, if SF has none, they should fall to
P-CONTACT (account identity alone is not a reachable human). Tighten the gate so
"reachable" requires a person/contact, not just an account identity — after the
contact-pull runs, so it doesn't mass-dump the 67 into P-CONTACT before the pull
gets a chance.

## Build
### Unit 1 — the contact-acquisition worker
A worker (`?_route=` sub-route, no new `api/*.js`; GET dry-run / POST drain) that:
- Selects entities with an OPEN/overdue cadence, an SF account identity, and NO
  linked person contact (the 67 set; self-extends as new SF-mapped cadences appear).
- For each, calls `find_contacts_by_account` (the existing SF flow) for the mapped
  account.
- Creates each returned SF contact as a `person` entity (via `ensureEntityLink`,
  guarded — reuse the buyer-contact-picker's create path so we don't fork), links
  person→entity (`associated_with`), and mirrors the SF contact identity
  (`source_system='salesforce'`, the contact id).
- Stamps the PRIMARY contact onto the entity's active cadence
  (`contact_id` / `sf_contact_id`) so it becomes outreach-ready — reuse the
  `select_prospecting_contact` machinery (R10 Unit 3b) rather than re-implementing.
- Effect-first / outcome-truthful: a property that resolves a contact leaves the
  contactless set; one where SF returns no contacts is recorded so it isn't
  re-hammered every tick (and falls to P-CONTACT for manual acquisition).
- Bounded per-tick (count + time budget — the artifact-offload lesson). Gentle cron.

### Unit 2 — the reachability-gate tightening (after Unit 1)
Update the R10 gate so "reachable" = has a linked person/contact (or cadence
`contact_id`/`sf_contact_id`), NOT merely an SF account identity. So SF-mapped-but-
no-contact entities correctly sit in P-CONTACT until Unit 1 (or a human) gives them
a contact — no more outreach cards with empty recipients.

## Don't break / boundaries
- dia/gov pipelines untouched; this reads SF contacts + writes LCC person entities +
  cadence contact links.
- Reuse `find_contacts_by_account`, `ensureEntityLink`, and the
  `select_prospecting_contact` path — do not fork contact creation or cadence
  stamping.
- Feature-flagged / graceful when the SF flow is unconfigured (no-op, same posture
  as the other SF-dependent paths).
- The 328 no-SF entities are NOT in scope — they need cold acquisition (research /
  CoStar capture), a separate track.

## Tests / house rules
≤12 `api/*.js`; `node --check`; full suite green. Tests: an SF-mapped contactless
cadence → contact pulled, person entity created + linked, primary stamped on cadence
(now outreach-ready); SF returns no contacts → recorded, not re-hammered, falls to
P-CONTACT; a non-SF entity is skipped; the gate counts a person-contact as reachable
and an account-only identity as NOT.

## After deploy (Cowork verifies live)
- Run the drain; the 67 SF-mapped contactless cadences acquire contacts and become
  outreach-ready (have `contact_id`/`sf_contact_id`); the count of touchable
  cadences jumps from ~3 toward ~70.
- Then the existing draft → mark-sent → advance loop (R10 Unit 4) can finally close
  on real recipients — verify one cadence advances end-to-end with a real contact.
- The reachability gate no longer shows outreach cards with empty recipients.

## Strategic note
This is the data→action conversion point: every upstream system (intake, enrichment,
queue, context packets, correspondence) exists to drive outreach, and outreach has
been blocked on missing contacts. Unlocking the SF-sourced 67 is the cheapest, most
direct way to make the loop actually close. The 328 cold entities are the next, bigger
contact-acquisition question (research engines / capture) once the SF path proves the
loop closes.
