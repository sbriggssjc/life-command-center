# Claude Code (life-command-center) — ORE Phase 1 Units B+D: capture owner phone/email (stop dropping it)

## Why (audited 2026-06-27)

We already RECEIVE owner phone/email/address in CoStar captures, but drop it twice
and have nowhere to store it on the graph:

- **Unit B gap — org entities can't carry contacts.** In `api/_shared/entity-link.js`
  the entity field whitelist **explicitly deletes `phone`/`email` for any
  non-person entity** (the `if (entityType !== 'person') { delete picked.phone;
  delete picked.email; }` block, ~lines 710-715), and address is person/asset-only
  (~725-730). Owners are `organization` entities — so even when an owner's phone/
  email arrives, the entity layer discards it.
- **Unit D gap — the sidebar drops owner phone/email before that.** In
  `api/_handlers/sidebar-pipeline.js`, `selectAuthoritativeOwner` (~7290-7321)
  receives the owner contact object (which carries `phone`/`email`/`address` in the
  metadata contacts array) but returns **name only** — the phone/email are never
  passed forward to the owner write.

Net: owner decision-maker phone/email we already have in hand never lands. With
Unit A now populating manager names + the SOS path walled, capturing the contact
DETAILS we do receive is a free win — and it makes the attached managers/owners
actually reachable (phone/email), feeding the outreach + cross-ref paths.

## Unit B — let owner organization entities carry phone/email/address

In `entity-link.js`, allow `organization` entities that are OWNERS (or generally —
your call, but at minimum owner orgs) to retain `phone`, `email`, and a
mailing/notice `address` (+ city/state/zip) instead of deleting them:
- Adjust the field whitelist so org entities keep `phone`/`email`/`address` when
  provided. Keep the existing person/asset handling unchanged.
- Apply the existing guards (don't store junk — reuse `isJunkEntityName` /
  the contact validators; a phone/email must look real). Provenance-tag the writes
  via the existing field-priority machinery.
- If the `entities` table or a migration is needed for org address columns, add it
  additively (entities already store address for person/asset, so columns exist —
  just lift the type gate).

## Unit D — carry CoStar owner phone/email through to the owner record

In `sidebar-pipeline.js`:
- `selectAuthoritativeOwner` should return the owner's `phone`/`email`/`address`
  alongside the name (not name-only).
- The owner write path (`upsertDomainOwners` / `ensureRecordedOwner` and the owner
  entity link) should write those: to `recorded_owners` (dia flat `address`/`city`/
  `state` + phone/email columns if present, or the gov `contact_info` jsonb) AND to
  the owner organization entity (now that Unit B lets it carry them). Fill-blanks,
  never clobber curated, provenance `source='costar_sidebar'` (the existing
  aggregator priority).
- Guard: don't write a phone/email that's actually a broker's or a generic inbox —
  reuse the existing junk/role guards.

## Flow-through

Once owner orgs carry phone/email, the CONTACT-SELECTION signal pull + the
owner-contact-enrich attach path surface a *reachable* owner contact (not just a
name), so the outreach draft can resolve a recipient and the cross-reference
resolver can match on shared phone/email/address. Verify the attached owner/manager
now shows phone/email where CoStar provided it.

## Boundaries / verify

- life-command-center (`entity-link.js` + `sidebar-pipeline.js`); additive migration
  only if a column is missing; no new api/*.js (stays 12); reuse the guards +
  provenance; fill-blanks, reversible.
- `node --check`; suite green; extend `entity-link` + sidebar tests: an owner org
  with a phone/email retains them (not deleted); `selectAuthoritativeOwner` carries
  phone/email; a junk/broker contact is still rejected.
- **Live proof (Cowork):** a new CoStar owner capture with a phone/email lands on
  the owner record + entity (provenance costar_sidebar); a spot-check owner shows a
  reachable contact where before it was name-only.

## Documentation

Update CLAUDE.md (entity-link + sidebar): owner organization entities now carry
phone/email/(mailing) address (the non-person delete is lifted for owners, guarded);
CoStar owner phone/email is carried through `selectAuthoritativeOwner` to the owner
record + entity with provenance. Part of ORE Phase 1 (capture everything).

## Bottom line

We already receive owner phone/email and throw it away — once at the sidebar
(name-only), once at the entity layer (org delete). Lift both so the owner
decision-makers we capture are actually reachable, feeding outreach + cross-match.
Free, guarded, provenance-gated.
