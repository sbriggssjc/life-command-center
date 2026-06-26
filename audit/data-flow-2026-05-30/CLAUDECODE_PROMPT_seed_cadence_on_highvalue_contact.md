# Claude Code (life-command-center) — wire contact-acquisition → cadence (make high-value owners workable outreach)

## Why (grounded live on LCC Opps `xengecqvemvfknjvbvrq`, 2026-06-26)

The outreach work-surface (PR #1352) is built and the loop mechanics work — but
the surface is currently filled with the LOW-value tail. The high-value money is
stranded one wire short:
- The draftable/active cadence set is **low-value person contacts** (top ~$598k,
  **0 cadences ≥ $1M**).
- Meanwhile **357 owners worth ≥ $1M are contactless** (`v_owner_contact_worklist`,
  top ~$27M) — they have neither a contact NOR a cadence.
- Contact-acquisition (the free-attach drain PR #1350, the owner-contact-enrich
  worker, the P-CONTACT picker) *links a person* to an owner and stamps the
  contact onto an **existing** active cadence (`stampContactOnActiveCadence`,
  `onlyContactless`). **But a high-value owner has no cadence to stamp** — so after
  it gains a contact it's connected/reachable yet still **absent from the outreach
  focus surface**. The supply (contacts) and the consumer (the work-surface) exist;
  the wire between them does not.

This round adds that wire: when a BD-valuable owner gains its first real
person contact and has no active cadence, **seed one** — so it flows into the
value-ranked focus session and Scott works the $27M owners, not the $598k tail.
Reuses the R63 seed + R16 contact-attach + the single `advanceCadence` owner. No
new api/*.js; no migration.

## The single rule (one place, all acquisition paths inherit it)

In the shared contact-attach path (`api/_shared/contact-attach.js`, used by the
owner-contact-enrich worker, the free-attach drain, and the P-CONTACT /
prospecting-contact pickers): after a person is linked to an owner entity and the
existing-cadence stamp is attempted, **if the owner has no active cadence AND the
owner clears the BD-value floor, seed a prospecting cadence with that contact.**
- **Value gate (reuse, don't invent):** the owner passes the existing R63
  `entityHasBdSignal` / `CADENCE_SIGNAL_MIN_VALUE` gate (portfolio rollup or
  connected value ≥ floor). A newly-contacted high-value owner passes by
  construction (it has value + now a contact). Below the floor: link the contact
  but DON'T seed (no low-value cadence spam — preserves R63).
- **Seed via the existing path** (`getCadenceState` / `lcc_seed_*`), phase
  `prospecting`, with `contact_id`/`sf_contact_id` set so it's immediately
  reachable + draftable, `next_touch_due = now()` so it surfaces in the focus
  session. Idempotent: never create a second cadence (ON CONFLICT on the existing
  `uq_cadence_contact_property` index — the E2E#6 rule); if a cadence already
  exists, keep the existing stamp behavior (no change).
- **Single advance owner preserved** — seeding only creates the cadence; advances
  still go through `advanceCadence` exclusively.

## Boundaries / verify

- life-command-center; `api/_shared/contact-attach.js` (+ any caller that needs the
  value context threaded); reuse R63 seed + the value gate + `advanceCadence`. No
  new api/*.js (stays 12); no migration (cadence columns exist).
- Never seed below the value floor (no spam); never a duplicate cadence
  (index-inference ON CONFLICT); never a second advance owner.
- `node --check`; suite green; extend `test/contact-acquisition.test.mjs` /
  `test/contact-attach.test.*`: a high-value owner with no cadence that gains a
  contact gets exactly one prospecting cadence (contact set, `next_touch_due` now);
  a low-value owner gains a contact but NO cadence; an owner with an existing
  cadence keeps the existing stamp (no duplicate).
- **Live proof (Cowork verifies after deploy):** run the free-attach drain
  (PR #1350) + this wire; confirm a ≥$1M contactless owner, once it gains a
  contact, gets a prospecting cadence and **appears value-ranked at/near the top of
  the outreach focus surface** (PR #1352) — i.e. the focus list's top value rises
  from ~$598k toward the $1M+ owners. The two surfaces (acquire-contact worklist →
  workable-cadence focus) now connect.

## Sequencing

Deploy order: PR #1350 (free-attach drain — supplies contacts) + PR #1352
(work-surface — the consumer) + this wire together. Then the chain is whole:
contactless $1M+ owner → acquire contact → seed cadence → value-ranked focus card
→ worked. Verify the end-to-end live on one real high-value owner.

## Documentation

Update life-command-center CLAUDE.md (cadence/outreach): contact-acquisition now
seeds a prospecting cadence when a BD-value-floor owner gains its first contact and
has none (reusing the R63 value gate + seed), so high-value owners become workable
outreach instead of stranding connected-but-cadence-less. Idempotent; value-gated;
single advance owner intact.

## Bottom line

The work-surface and contact-acquisition both exist but don't connect for the
owners that matter: $1M+ owners get a contact and then vanish from the outreach
list because nothing seeds them a cadence. One value-gated seed at the contact-
attach choke point closes the chain, so the focus session fills with the
high-value owners — the actual point of the outreach engine.
