# Prompt 192 — make Tier 0 a living pursuit loop, not a one-time sort

> **Read first:** `docs/architecture/account-based-contact-intelligence.md` (§3a role taxonomy,
> §4 tiers, §5 non-negotiables), `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 7, 10, 12, 14,
> the P192 migration header.
>
> **Nothing in this prompt may write to `owner_contact_pivot` without either an exact-match gate
> or a human verdict.** That table decides who Scott calls.

---

## Scott's framing, 2026-08-26 — this is the requirement, not background

> *"Only propose the strongest candidates… automate as much of this as we can so we are only asking
> the human in the loop when we absolutely need it and can't resolve this automatically with the
> data we have. Especially because this is not a final determination but an ongoing pursuit and
> will change as time goes on or as we learn about new hires or new roles or new fund or new
> targets… We want this whole process, with institutional or large fund buyers that are
> organizations, to be a dynamic and living thing that grows as time goes on and we ingest more
> correspondence or show more deals to each buyer, taking notes and learning from the data."*

Three requirements fall out, and they are separable:

1. **Ask less** — done in P192 (255 → 109 cards). 
2. **Automate the resolvable** — §1 below.
3. **Keep it alive** — §2–§4 below. This is the part that does not exist yet.

## Current state after P192

| | cards | owners | rent |
|---|---|---|---|
| `ask` — the operator's queue | 98 | 90 | $394M |
| `auto` — exact match, ONE candidate, read 11/11 correct | 11 | 11 | $26M |
| `parked_domain_only` — never shown | 146 | 105 | $231M |

## 1. ⭐ The auto-attach sweep (the "automate the resolvable" half)

**Build it in the EXISTING verdict path, not as a new SQL writer.** The JS verdict path carries the
shape gates (`isPersonShaped`, `isJunkEntityName`, `isMisparseName`, the broker `role_bucket`
exclusion) and re-reads the card at write time. A SQL function would bypass all of it — the
"second write path that skips the guards" this repo has been bitten by before.

- **Population: `decidability = 'auto'` only** — `match_strength = 'exact'` AND `n_eligible = 1`.
- **⚠️ Do NOT extend it to `domain_is_core_prefix`.** Read individually that tier is ~9/12, and the
  failures are severe: *JP Morgan Chase CMBS Trust 2018PTC → jpmorgan.com* (a securitization
  vehicle, not the bank, and not a prospect at all) and *Frontier Hub LLC → frontier.net* (an
  internet service provider). One tier of match strength separates 11/11 from 9/12.
- Batch-tagged, reversible through `lcc_tier0_confirm_log`, `active_source = 'tier0_auto'` so it is
  distinguishable from a human verdict forever.
- **Report the state delta, never the tally** — cards that left the queue, not rows attempted.
- Once it runs, `auto` cards stop appearing in `_open`; until it exists they stay visible and
  flagged, because a correct-but-invisible card is Class 7.

**Also fix while here:** the consumer-ISP stoplist tests only `.com` for some hosts —
`frontier.com` is listed, `frontier.net` is not. Add the sibling TLDs.

## 2. The living loop — what makes a parked card come back

`parked_domain_only` is **dated and expiring by construction**: P192 computes decidability live in
the view rather than storing it, so a parked card returns to `ask` automatically the moment new
evidence lands. **Do not "optimise" that into a stored status column without building the sweep
that clears it** — Class 10 (an exclusion nothing ever clears) and Class 12 (a worker whose cursor
is its own output) are both already paid for in this codebase.

What should un-park a card, in rough order of strength:

| new signal | source |
|---|---|
| correspondence with anyone at the domain | `email_bodies` / `activity_events` |
| an SF campaign membership or SF contact appears | `lcc_sf_list_membership`, `unified_contacts.sf_contact_id` |
| a title lands (the Outlook contact sync) | `unified_contacts.title` |
| a confirmed sponsor→domain entry | `lcc_owner_sponsor_domain` (P190) |
| a deal shown to that buyer | `lcc_listing_events` / the deal spine |

## 3. The bench is a RANKING that re-derives, not a winner that sticks

Per `account-based-contact-intelligence.md` §4 Tier 1: **keep a bench, don't collapse to one
winner.** `owner_contact_pivot` already has a `bench` column. The active contact is the current
head of a ranking, re-derived as evidence changes — not a decision recorded once.

**⚠️ The pursuit target is the ACQUISITIONS contact, not the highest-volume one.** Easterly is the
worked example and it is in the live lane right now: Andrew Pulliam (EVP–Acquisitions, 109 emails)
is the target; Lucas Shuler (51 emails, DD/transaction manager on one deal) is not. Volume inverts
the answer. The discriminating signal is **who initiated each deal-flow thread**, not message count.

## 4. Learning from what Scott does — the feedback half

Every verdict in `lcc_tier0_confirm_log` is training data that is currently only an audit trail:

- A **reject** on `(owner, domain)` says that domain is not that firm — which should also demote the
  same domain for *other* owners matching on the same weak token.
- An **attach** confirms a domain↔owner binding — which should promote the other people at that
  domain, and is a candidate for a `lcc_owner_sponsor_domain` row.
- A **reply that redirects us** ("talk to X") is the highest-quality signal available (§4 Tier 3)
  and should update the bench directly.

**Start with the reject signal** — it is the cheapest and it directly attacks the 146 parked cards.

## 5. ⚠️ Do prompt 189 (duplicate entities) FIRST or in parallel

P192 removes most *apparent* duplication (weak second-domain cards). It does **not** touch genuine
duplicate owner entities, and those are now costing operator time on the live lane: Easterly is 2
entities (the same question answered twice, the same person attached to both) and **"NGP Capital"
is 5 entities**. No amount of card triage fixes that — it needs the merge pass, and
`v_lcc_merge_candidates` is blind to 1,089 organisations until its grouping key is fixed.

## 6. Still open for Scott

- **fcp→fcpdc.com and tmg→tmgdc.com** — the two held sponsor entries, pending his check of Google /
  Salesforce / our records. TMG also matched an unrelated `tmgre.com`.
- **Easterly**: attach **Pulliam**, not Shuler, on the restored `easterlyreit.com` card.

## 7. Carried forward, untouched

Probe B (operator-gated, M365); the six Class-9 verdicts; the `autoClassify` backfill (406 + 2,468
— it corrupts the very evidence signals this lane reads, so it is now higher value than when filed);
the Amy Dane / Amy Moyer merge; the NPI binary verdict lane; `contact_merge_queue` re-check.
