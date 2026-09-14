> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)** — live state, the objects, the decisions already made, and the traps paid for. **This file is the EVIDENCE for one round; read the canonical page first to find out whether you need this one.**

# P197 — the Tier 0 lane read ONE employer source, by ONE key (2026-08-27)

**Result:** `no_employer_on_file` **67 → 54** cards ($131.2M → $113.6M), parked **142 → 137**,
`ask` **82 → 87** (+$7.6M of newly-askable questions). `auto` unchanged at **9 — the same 9 cards**
(0 lost, 0 gained). Card universe unchanged at 233, 0 appeared, 0 disappeared. **Nothing was minted:
no `unified_contacts` row created, no `owner_contact_pivot` written, no entity touched.**

Migration `20260827170000_lcc_p197_tier0_employer_resolver.sql` (applied live to LCC Opps —
**confirmed `CONTACTS_HUB=ops` empirically before any write**: ops 32,853 rows / 3,068 touched in
3 days vs gov 30,714 / 5, the frozen snapshot). Guard `test/tier0-employer-resolver.test.mjs`
(7 tests, all 7 mutation-verified RED). Suite **4,673 pass / 0 fail**.

---

## 1. The prompt's premise was half right, and the half that was wrong is the finding

P197 framed `no_employer_on_file` (68 cards / $132.3M) as **"a missing hub row"** and prescribed
reconciling the 92 blocking people into `unified_contacts`.

Measured, the blocking population is **73 eligible people**, not 92, and only **4** are missing a
hub row that exists. The rest is not a missing-row problem at all:

| where the employer for a blocking person actually is | people |
|---|---:|
| a hub row reachable **only by `entity_id`** — the lane joins on email only | 4 |
| `lcc_sf_list_membership.company_name` (6,781 such rows; **the lane has never read one**) | 20 |
| `entities.metadata->>'company'` | 20 |
| genuinely nowhere in the system | 56 |

So the defect is that **the lane resolves "employer on file" from one table, by one key**, while the
system holds employer facts in at least three places. Minting hub rows would not have fixed the 40
people whose employer we already hold; it would have fixed 4 and left 36 looking identical.

**This changes what shipped.** Instead of a reconciler, P197 adds
`lcc_tier0_employer_on_file(person_id, email)` — one ranked resolver, `hub_email > hub_entity_id >
sf_campaign > entity_capture` — and points the lane at it.

## 2. ⚠️ The obvious version of this fix is destructive, and it was measured on named rows first

"Copy whatever company we hold onto the card" is the natural implementation, and it manufactures
employers. Neither non-hub source is an employer register; both are human/capture labels. Over the
parked population:

| string in the company field | for a person at | what it is |
|---|---|---|
| `Southbury, CT 06488` | choicerealtyusa.com | a **city/zip** |
| `Hollywood, FL 33021` | healthcarerea.com | a **city/zip** |
| `Steve Blumer` | blumerconstruction.com | the **person's own name** |
| `Inco Commercial` (×2 people on ONE mailbox) | centennialadvisers.com | a **P188-named junk label** |
| `Pop Local` | edwardsrealtyco.com | a **different firm** |
| `The Carpet Shop` | corporaterealty1.com | a different firm |
| `Rocky Knoll Farms LLC` | trademarkconstruction.net | a different firm |
| `Community Trust Bk` | proposed against a **health-centre** owner | a bank |

`contact_company` feeds `ev_company_matches_owner`, which is the **only** signal that attests the
LINK (P188). An invented employer that happens to collide with an owner name manufactures exactly
the claim P188 established these signals cannot make.

**The gate is email-domain corroboration:** the label counts only when the person's own mailbox
agrees with it. It kills every row above and keeps the real ones (`Capstone Partners` ↔
capstone-partners.com, `Master Realty` ↔ masterrealty.net, `SteelWave LLC` ↔ steelwavellc.com).
The two hub tiers are deliberately **ungated** — the hub is the system of record, so whatever it
says is "on file" by definition, which is also the pre-P197 behaviour.

**Positive control before trusting the zeros** (P182): the resolver was probed on 8 named rows with
stated expected answers — 4 expected-resolve, 4 expected-reject. **8 of 8 correct.** A gate that only
ever rejects is indistinguishable from a broken one.

## 3. Salesforce is the live orphan producer, and the count everyone quotes is 247 too high

**The 5,440 figure is wrong.** 247 of those person entities **do** have a `unified_contacts` row —
linked by `entity_id`, which the email-keyed detector structurally cannot see. The true orphan count
is **5,193**. Same family as P189's `IS NOT DISTINCT FROM` inversion: a detector that can only
express one key reports the other key's population as absent.

**The producer is live** — 542 orphans in 30 days, 94 in 7, one created the day of this audit. The
prompt's hypothesis was the sidebar/CoStar path; measured, it is **Salesforce**:
`metadata->'salesforce'` on 3,994 of them (371 in 30 days), and `external_identities` shows
`salesforce/Contact` 4,032 vs `costar/contact` 1,767.

**Duplicate risk on a future reconcile is nil, and that was checked rather than assumed:** of 3,874
orphans carrying an SF contact id, **exactly 1** already has a hub row under that id. These people are
genuinely absent from the hub, not filed under another key.

## 4. The general rule — sized, not chosen

Prompt step 2 asked which orphans deserve a hub row, with the gate's population quoted **before**
choosing. Over the 5,193:

| candidate gate | admits | verdict |
|---|---:|---|
| in a Salesforce campaign | **1,475** | the only gate that discriminates |
| has correspondence (`activity_events`) | **33** | too small to be a rule |
| has an entity edge | 4,903 | 94% — not a gate |
| person-shaped name | 5,131 | 99% — not a gate |

**No hub rows were minted.** 1,475 rows is an operator-surface decision with a blast radius, and the
Tier 0 blockage it was meant to clear turned out not to need it — 69 of the 73 blocking people would
gain nothing from a hub row, because a hub row with no `company_name` answers no question the lane
asks. Filed for Scott as backlog **N14** rather than decided here.

## 5. What is left, named honestly

**54 cards / $113.6M still park as `no_employer_on_file`, and that is correct** — we hold no employer
for anyone on them, from any of the four sources. It is a genuine acquisition gap, not a plumbing gap.

Of the 13 cards that moved: **5 became `ask`** (real questions) and **8 became
`employer_on_file_differs`** (honest rejects). An honest reject is progress over a non-judgement, but
it is not a call — reported separately, never blended.

⚠️ **Two of the 5 new `ask` cards rest on a generic word stem.** `ev_company_matches_owner`'s
shared-8-character arm fires on `innovati` (*Innovation 2100 LLC* ← "Innovative Renal Care", a
dialysis **operator**, $2.93M) and `corporat` (*Corporate Plaza LP* ← "Corporate Realty Inc"). This
is a pre-existing property of that comparator, not something P197 introduced — but P197 exercises it
more often, so it is stated rather than papered over. These are `ask` cards: a human decision, and the
card now shows the employer, its source and the match key, so a wrong one is a one-second reject.
Tightening the comparator would move the 82 pre-existing `ask` cards and is not in scope here.

## 6. Safety properties, proven not asserted

- **No unattended write can result.** `decidability='auto'` requires `match_strength='exact'` AND
  `n_eligible = 1`; P197 touches neither. Verified: `auto` is the **same 9 cards** before and after
  (0 lost, 0 gained), and `match_strength` / `n_eligible` changed on **0 of 233** cards.
- **The card universe did not move** — 233 → 233, 0 appeared, 0 disappeared. The only change is which
  bucket a card sits in and what it can say about itself.
- **Faster, not slower**, despite adding a per-person resolver: **793.9 ms → 553.6 ms**, buffers
  **32,841 → 22,820**, measured before and after in ONE session (the timing is session-variable; the
  buffer count is the durable evidence). The plan showed the old hub join being pushed down to all
  **7,890** people in the `people` CTE; the resolver is bounded to the ~600 matched pairs in a
  MATERIALIZED CTE, so the work shrank.
- **Provenance reaches the operator.** All 81 `employer_on_file_differs` cards name their source; all
  54 `no_employer_on_file` cards correctly name none. A park resting on a corroborated Salesforce
  label and one resting on the hub are different qualities of judgement — collapsing them is the
  one-label-two-facts failure (P181).

## 7. Durable lessons

- **⚠️ WHEN A CONSUMER REPORTS "NOT ON FILE", ASK HOW MANY PLACES IT LOOKED.** The lane's single
  email-keyed join made "we hold no employer for this person" and "we hold one and cannot reach it"
  produce the identical card. 40 of 73 were the second thing.
- **⚠️ A DETECTOR THAT KNOWS ONE KEY REPORTS THE OTHER KEY'S POPULATION AS ABSENT.** 247 of 5,440.
  Before quoting an orphan/gap count, enumerate every link column the table actually carries.
- **⚠️ THE HAZARD TRAVELS WITH THE TECHNIQUE (P189/A2 again).** `company_name` is sanctioned in the
  hub and is a landmine in `lcc_sf_list_membership` and `entities.metadata` — same column name,
  different provenance, different trustworthiness. Re-grade a field on named rows for every new gate.
- **A corroboration gate turns an untrusted label into a usable fact** without minting anything —
  cheaper and more reversible than reconciling the source into the system of record.
