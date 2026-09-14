# Prompt 104 — W9.2/W9.4 reachability create_contact precision (kill the shared-broker fan-out)

Grounding (read first): `docs/claude-code/STATUS.md` (2026-08-14 connectedness-audit entry — gap #3 is this),
`api/_shared/reachability-harvest-planner.js` (the create_contact / comms-header arm), the confirm-mint writer
in `api/admin.js` (`reachability_harvest_review` verdict branch), the W9.1 broker-of-record typing in
`api/_shared/contact-acquisition-engine.js` (`planContactMinting`), the W9.6 brokerage guard from Prompt 103
(`isBrokerageOwnerName` / `lcc_is_brokerage_owner_name` in `api/_shared/comms-owner-attribution.js` +
`20260830120000`), the TrafficMetrix fan-out detector (`api/_shared/tm-misparse.js`), the Producer/Consumer +
honest-counts doctrine. **Deterministic-first, additive, reversible, reuse-don't-rebuild.**

## The problem (grounded live, 2026-08-14)

W9.2's harvest is live and delivering (2 real owner contacts minted night one), but the **`create_contact` arm
mis-attributes deal advisors/brokers as an owner's OWN contact**. Both of the first batch's rejects were the same
person: **Philip Sharrow `<philip.sharrow@scopecre.com>` proposed as a `create_contact` for TWO unrelated owners
— Boyd Watterson Global AND BLOOMINGTON IRS LLC**. scopecre.com is a CRE advisory; Sharrow corresponded about
each owner's property as a broker, so the header-pair harvest bound his email to both owners. He is a *party on
the deal*, not either owner's principal. Scott correctly rejected both — but this is noise the lane should not
surface as an owner's direct contact (the exact class we fixed in W9.6 Path B; now apply it to the harvest's
mint arm).

Scope: this is ONLY the `create_contact` / comms-header-and-signature arm (the one that MINTS a new owner
contact). The **deterministic fill-blanks arm** (an SF-identity-key-matched value onto an existing contact) is
NOT noisy and must stay untouched.

## Do — two deterministic guards on the create_contact arm (no LLM)

1. **Fan-out cap (the strongest signal — catches Sharrow).** A candidate contact (keyed by normalized
   name + email, or by email alone) that would be `create_contact`'d for **≥2 distinct owners** is almost never
   a genuine owner principal — it's a broker/advisor/shared mailbox spreading across deals. Reuse the fan-out
   logic already proven in `planContactMinting` (W9.1) and the `tm-misparse` fan-out lesson: compute the
   candidate's distinct-owner count within the scan, and **drop (or route to a single tighter review) any
   create_contact whose contact fans out past a threshold** (start at ≥2 distinct owners → suppress; make it a
   named tunable, e.g. `HARVEST_MINT_FANOUT_MAX`). Count them honestly (`fanout_suppressed`).

2. **Brokerage/advisor-contact guard.** A create_contact whose evidence email is on a brokerage/advisory domain
   (or whose name matches the brokerage stoplist) should **never be minted as the owner's OWN contact.** Reuse
   the Prompt-103 `isBrokerageOwnerName` / `lcc_is_brokerage_owner_name` guard, and extend it (or add a sibling)
   with an **email-domain check** — grep first for an existing brokerage-domain constant (the sidebar/own-firm
   modeling may already carry one; `INTERNAL_DOMAINS` is the own-firm analogue) before adding a new list; if
   none, add a small documented brokerage-domain stoplist (scopecre.com + the majors' domains) alongside the
   name stoplist. Two acceptable dispositions, pick the tighter that still keeps real owners:
   - **Preferred:** mirror W9.1 — if the contact is a broker/advisor, either DROP it from this arm (the owner's
     *own* contact is what this lane is for), or type it `broker_of_record` so it is NEVER confused with an
     owner principal (same discipline as `contact-acquisition-engine.js`). Do NOT silently mint it as the
     owner's direct contact. Count `brokerage_contact_suppressed`.

Keep the house discipline: deterministic-first, verbatim evidence retained, per-reason drop counts surfaced in
the tick output (`fanout_suppressed` / `brokerage_contact_suppressed`), loud `scan_errors`, proposal-only
(human verdict unchanged), reversible. The fill-blanks arm and the Path-A-equivalent deterministic fills are
unchanged.

## Reuse, don't rebuild
- `isBrokerageOwnerName` / `lcc_is_brokerage_owner_name` (Prompt 103) — the brokerage stoplist already exists;
  extend for email-domain, don't fork.
- `planContactMinting` fan-out cap + `broker_of_record` typing (W9.1) — the mint-vs-attach + broker-typing
  pattern is already written; mirror it.
- `tm-misparse.js` fan-out detector — the "one email fanned across many subjects" precedent.
- `INTERNAL_DOMAINS` (exported from `voice-corpus-clean.js`) — the own-firm domain analogue for the domain check.

## Acceptance
- Re-run `GET /api/reachability-harvest-tick?score=1&n=20` (or the planner over the live pool): the Sharrow-class
  fan-out (one contact → ≥2 owners) no longer appears as a create_contact; `fanout_suppressed` /
  `brokerage_contact_suppressed` counters are surfaced and non-zero; genuine single-owner owner contacts still
  propose. Honest count of what remains.
- Tests extended in `test/reachability-harvest-planner.test.mjs`: fan-out suppression (a contact across 2 owners
  drops/routes), brokerage-domain suppression (scopecre.com-class dropped or typed broker_of_record), and a
  genuine single-owner owner-contact still passes; deterministic fill-blanks arm unaffected.
- Migration only if the brokerage-domain list lives in SQL (extend the `20260830120000` helper); otherwise
  planner-only. Additive + reversible either way.
- Update `docs/audits/W9_CONNECTEDNESS_KICKOFF.md` status + ROLLOUT_STATUS W9.2 row with the precision pass;
  note the fan-out + brokerage guards. Prompt → `done/`.

Commit with the repo Co-Authored-By + Claude-Session trailer. One PR. Report the suppressed counts and the
post-fix create_contact sample.
