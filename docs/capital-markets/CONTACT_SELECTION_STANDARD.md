# Contact-Selection Standard — which human to prospect for an owner-company (2026-06-20, rev. 2)

> Scott's directive: for each owner (mostly LLCs / trusts / institutional entities), target the
> **correct decision-maker**, and **pivot intelligently as we learn more** — through research on
> the owner's other properties OR feedback from our own outbound calls/emails. Prefer **one
> contact per company at a time**; prospect **multiple** only for genuine partnerships / co-equal
> decision-makers. **Distinguish roles** (agent vs member vs manager vs trustee vs beneficiary…)
> and consider prospecting **complementary functions**. The selected contact is a *hypothesis*
> that updates with evidence — not a one-time pick.

## Principle
Target the person with the most **decision authority** over the asset. Engagement/warmth refines
*how* we work a contact but does not override the goal of reaching the real decision-maker. Each
owner has ONE **active** contact at a time (the current best hypothesis) plus a ranked bench;
prospecting **pivots** down the bench as research and outbound feedback tell us who actually
controls the decision. A contactless owner is a queued **enrichment**, never a dead end.

## Decision-maker authority ranking (who to target, highest first)
1. **Signatory / executing principal** — the human who **signed the deed / loan / PSA** on behalf
   of the entity. Highest authority: they executed control of the asset.
   - *Have now:* `loans.sponsor` / `cmbs_sponsor`. *Enrich:* parse the **signature block** of the
     recorded deed / loan / PSA (the folder feed already ingests these docs); `deed_records`
     holds grantor/grantee **entity** names, so the human signer is an enrichment.
2. **Controlling role of the entity** — LLC **managing member / manager**, trust **trustee**, LP
   **general partner**, corp **president/officer**, CMBS **sponsor**.
   - *Have now:* `recorded_owners.manager_name` / `manager_role` (sparse, ~132 gov). *Enrich:*
     **Secretary-of-State** business-entity lookup (manager/managing member/officers); free
     SOS-direct scrapers preferred over paid OpenCorporates.
3. **Beneficial / economic owner** — LLC **member**, LP **limited partner**, trust **beneficiary**,
   or **the individual at the LLC's registered/mailing address when it's residential** (a home
   address ≈ the principal). Often NOT the day-to-day decision-maker → prospect as a
   **complementary** function, or when the controlling role is unreachable.
   - *Enrich:* reverse-lookup the registered/notice address; SOS member list.
4. **Registered agent** — `recorded_owners.registered_agent_name`. Procedural (often counsel / a
   CSC-type service). Low authority — a path in only when 1–3 are empty and no enrichment pending.
5. **Any captured / SF contact** — fallback handle while higher-tier enrichment runs.

## Role / function taxonomy (capture per contact — never conflate)
- **Decision-maker roles:** signatory, managing_member, manager, general_partner, president/officer,
  trustee, sponsor.
- **Economic / complementary roles:** member, limited_partner, beneficiary.
- **Procedural:** registered_agent.
- **Overlay signal:** engaged_responder (someone who replied / was forwarded our materials).
Differentiate explicitly — **agent ≠ member**, **manager ≠ member**, **trustee ≠ beneficiary**.
Where two functions genuinely co-control (e.g. trustee + beneficiary, manager + key member), it
may be worth prospecting **both functions** for the account.

## Intelligent pivot — the core (the contact is a hypothesis that updates)
The active contact is selected as the highest-authority known candidate, then **re-evaluated as
evidence arrives**. Every pivot is logged with its reason (provenance) so the rubric learns.

**Research signals (passive, raise/lower confidence):**
- Same individual signs deeds/loans across **multiple** of the owner's properties → strong
  decision-maker confirmation → **promote / lock**.
- SOS filing or a newer deed names a **different** manager/officer → **pivot** to them.
- Registered-address reverse-lookup finds the principal → **pivot** / add.

**Prospecting feedback (active, from our outbound):**
- **Referral** ("talk to X") → pivot to X (highest-trust pivot).
- **No response** after N touches → pivot to the next-ranked candidate or a complementary function.
- **Bounce / wrong-person / "I'm not involved"** → demote + pivot.
- **Positive / two-way engagement** → lock the active contact (becomes engaged_responder).

## One contact vs multiple (per company)
**Default: ONE active contact per company.** Escalate to **multiple concurrent** only on genuine
co-equal control:
- Owner name signals a partnership — `&` / `and` / multiple surnames (e.g. "Gilbert & Debbie
  Hagar"), JV / "Joint Venture", multiple distinct manager names in SOS, multiple equal members.
- Complementary functions worth working in parallel (trustee **and** beneficiary; managing member
  **and** a key member) when doing so materially improves odds.
Otherwise hold the bench in reserve and pivot one at a time.

## Tie-breakers within an authority level
1. Named **individual** > entity/role placeholder.
2. **Cross-property recurrence** (signs/manages several of the owner's assets) > one-off.
3. **Recency** — most recent signer/filing/contact.
4. **Title/authority** within the level.
5. Reject junk / operator / broker-attribution / implausible-person classes (reuse the existing
   `ensureEntityLink` guards) — never select a deal-string, a broker, or an operator as the
   owner contact.

## Application (how it drives the engine)
- For each owner in the NBT engine's **`acquire_contact`** set (~656 contactless valued owners):
  compute the **ranked candidate bench** (authority level + role + source), select the **ONE
  active** contact (or the partnership set), and name the **enrichment action** to reach a
  higher-authority contact when the top is empty (deed-signature parse / SOS lookup / address
  reverse-lookup).
- The **contact-acquisition worker** (R16/R20) executes the enrichment, attaches the resolved
  person via `ensureEntityLink` (guards apply), links person→owner with its **role**, sets it
  active, and the owner becomes reachable.
- A **pivot state** per owner tracks: active contact, bench, pivot history (reason + source),
  confidence. Research crons and the outbound-feedback path (the now-live SF activity ingest:
  referrals, no-response, bounces) feed re-ranking.
- Provenance on every selected contact: `contact_role`, `authority_level`, `contact_source`,
  `pivot_reason` — so we can audit WHY a contact is active and tune the rubric.

## Reality check (grounded 2026-06-20)
- Signatory: `loans.sponsor` present; deed/PSA human-signer needs document parsing (enrichment).
- Controlling role: manager/registered-agent on ~132 gov owners — SOS enrichment is the volume.
- Engagement/feedback: thin today (~16 entities) but the warmest pivot signal and growing now that
  the SF activity ingest (Tasks + Events, incl. completed) is live.
- Net: ranking what exists + queuing enrichment for the ~656 contactless owners, with an adaptive
  pivot loop fed by research and our own outbound results.

## Build (CC spec — next step)
1. **`v_owner_contact_candidates`** — per owner, the ranked bench across all sources with
   `authority_level` + `contact_role` + `source`, reject-guarded.
2. **`v_owner_active_contact`** — the ONE active selection per owner (or the partnership set) +
   `enrichment_action` for the next-higher tier when empty.
3. **`owner_contact_pivot`** state — active contact, bench, pivot history (reason+source),
   confidence; updated by (a) research crons (cross-property signer recurrence, SOS, address
   reverse-lookup) and (b) the outbound-feedback path (referral / no-response / bounce / positive
   from the SF activity ingest).
4. **Wire into the contact-acquisition worker** so the NBT `acquire_contact` next-action
   resolves/enriches the rubric-selected contact, attaches it with its role, and pivots on
   evidence. Gated + capped + reversible; provenance stamped; `ensureEntityLink` guards reused.
