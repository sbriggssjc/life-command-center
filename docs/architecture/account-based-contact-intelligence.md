# Account-Based Contact Intelligence — design brief

> **Status:** design, not built. Written 2026-08-26 from Scott's doctrine statement plus the
> live evidence that prompted it. Supersedes the narrower "pivot promoter" framing in
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` item 5d.

---

## 1. The doctrine this implements (Scott, 2026-08-26)

Recorded close to verbatim, because the design follows from it:

1. **The ACCOUNT is the primary pursuit** for a large repeat buyer. *Who* to call at that
   account is a **separate, secondary function** — and it is not one decision, it is a
   standing one.
2. **Contact determination is value-based and ONGOING, not one-and-done.** It must update as
   new information and new transactions are ingested.
3. **Professionals change roles and firms.** Track where prior contacts moved, so a past
   working relationship can be leveraged at their new employer.
4. **Never pursue brokers for a principal-buyer working relationship.** But broker↔buyer
   history is *valuable market intelligence*, and should be kept and surfaced:
   - which brokers have transacted with this buyer, and how many;
   - **gaps where we could represent the buyer as a BUYER'S rep**;
   - where our largest competitors are selling deals, so we can shape a value proposition
     against them.
5. **Email correspondence explains WHY we contacted someone**, and therefore what function
   they cover — that should shape who we pursue and for what.
6. Preferred shape: **Ollama automates it; humans give feedback** as replies arrive, as new
   information lands, or when a contact redirects us to the right person.

## 2. The defect that prompted it

`v_owner_contact_worklist` excludes any owner that already has a linked person — correct, they
need no *acquisition*. **But nothing promotes that person into `owner_contact_pivot`.** Of 120
suppressed owners ($875.3M): 72 work as designed, 37 have an empty pivot, and **11 have no
pivot row at all ($240.5M)** — invisible to the contact engine.

**Easterly Government Properties is the worked example, and it is stark.** The owner panel
reads "— none". What we actually hold:

| linked to the OWNER entity | in our data but NOT linked |
|---|---|
| 7 competitor brokers — CBRE, JLL, Newmark, Cushman, Avison Young — all roled `prospecting_contact` | **Andrew Pulliam** `apulliam@easterlyreit.com` — **71 emails**, 37 edges |
| 2 personal-email contacts of uncertain provenance | **Lucas Shuler** `lshuler@easterlyreit.com` — **51 emails** |
| | 5 more @easterlyreit.com / @easterlypartners.com with 0 emails |

**122 emails with two Easterly principals, and the system says we have no contact.** The
principals were never linked; only the brokers were.

## 3. Functional role is inferable from correspondence — demonstrated

From subject lines alone, no body parsing:

- **Andrew Pulliam** — *"188 Harvest Lane, Williston, VT — Escrow 202500342NCS — Closing
  Documents"*, *"draft press release"* → transaction closing + corporate communications.
- **Lucas Shuler** — *"188 Harvest Lane Prorations"* → closing finance / accounting.

That is exactly the "what does this person cover" signal Scott described, and the cheap tier
(subjects) already carries it. Bodies would refine it; they are not required to start.

## 4. Proposed shape

**Tier 0 — link what we already know (deterministic, no LLM).**
Match person entities to the owner by **email domain** ↔ owner identity, and create the
`entity_relationships` edge + promote the best into `owner_contact_pivot`. Easterly alone
yields 7 people, 2 with heavy correspondence. Value-gate by owner rent; reuse the P161-gated
`owner-reachable-via` resolver (it already excludes brokers via `NON_REACHABLE_ROLES` and
value-gates weak `works_at` links). **Broker-only owners must fall THROUGH to acquisition
rather than be suppressed** — that is the P166 doctrine applied at the pivot.

**Tier 1 — rank the bench, don't pick one winner.**
An account has several relevant people. Score each on: correspondence volume, recency,
two-way vs one-way, seniority signal, and inferred function. Keep a **bench** (the pivot
already has a `bench` column) rather than collapsing to a single "the contact".

**Tier 2 — Ollama infers function and drafts the account strategy.**
Feed subjects (+ bodies where available) per person and ask for: function/remit, evidence
quote, and confidence. **Carry the confidence and gate the surface on it** — this is the P181
lesson: a worker's residue must escalate with its confidence attached, or a 0.80 judgement and
a 0.28 guess wear the same label.

**Tier 3 — the standing loop.**
Re-run on new correspondence, new transactions, and on reply. A reply that redirects us
("talk to X") is the highest-quality signal available and should update the bench directly.
**Never a one-and-done write** — every conclusion carries `as_of` and is revisited.

**Tier 4 — broker intelligence, kept separately and deliberately.**
Never a prospect target. Surfaced as account intelligence: who has transacted with this buyer,
volume, recency, and **where the gaps are** (markets/product where we could represent them as
a buyer's rep, and where competitors are winning their business).

## 5. Non-negotiables

- **Brokers are never promoted to the pivot**, at any tier.
- **Every conclusion is evidence-backed and reversible**, with the correspondence that
  produced it citable.
- **Confidence travels with the escalation** (P181).
- **Value per OWNER, never per task** (P180).
- **A curated `answerable`/actionable flag is updated in the same change** as any new capture
  path (P180).

## 6. Spin-off defects found while investigating (each its own item)

1. **Professional emails are landing in the "personal" bucket.** Scott flagged this
   independently; it is very likely the same bucketing that produced P124's
   `cold_bd_outreach` catch-all in `draft-assist`. Needs its own measurement — a professional
   counterparty misfiled as personal corrupts both the voice corpus and this engine's inputs.
2. **`Andrew Pulliam` is duplicated** — two live person entities on the same address, 37 edges
   vs 1. Merge candidate.
3. **`v_lcc_prospecting_edge_review` (P166) does NOT contain the Easterly broker edges**, so it
   is narrower than its name implies and returned a false zero when used as a broker test. The
   detector needs widening before it is trusted again.
4. **7 competitor-broker edges on Easterly wear role `prospecting_contact`** — real, wrong per
   doctrine, and not the cause of the suppression. Re-role, don't delete: they are the
   Tier-4 intelligence.
