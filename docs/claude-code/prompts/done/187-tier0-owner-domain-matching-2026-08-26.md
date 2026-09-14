# Prompt 187 — Tier 0 owner↔person matching: the rule cannot see the biggest owners

> ## ✅ BUILT AND APPLIED 2026-08-26 — migration `20260827010000_lcc_p187_tier0_core_arm_and_stoplist.sql`
>
> **Result:** pairs 2,314 → 558; owners with a bench 346 → 208; empty-bench rent at ≥$5M
> $902M → $738M. Top-45-by-rent precision **76–80% → ~91%**.
>
> **Now visible:** Boyd Watterson ($179.8M) 2 people · RMR Group 20 incl. **Adam Portnoy** ·
> Realty Income 12 incl. **Sumit Roy** · TIAA-CREF · GI Partners · AVG Partners · Cole Capital.
>
> **Shipped:** `lcc_owner_domain_core()` (unsorted, order-preserving — 11/11 named-row gate);
> Arm 2 = 8-char core/domain prefix equality with a fan-out gate; a fan-out gate on Arm 1 that
> P186 had measured but never actually shipped; a widened stoplist (geography, generic CRE nouns,
> consumer-ISP suffixes).
>
> **Rejected after measurement:** the acronym arm. 27.6% of owner names are entirely uppercase,
> so "ALL-CAPS = acronym" identified the naming convention, not an acronym — it produced
> `BOYD DEL RIO GSA LLC` → **dell.com**. See playbook Class 13.
>
> **Everything below is the original spec, kept for the record.** What remains open is in
> `188-*.md`.

> **Read first:** `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md` §6,
> `docs/architecture/account-based-contact-intelligence.md`,
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 13.
>
> **Nothing here has been built.** P186 fixed the view's performance (58.7 s → 0.25 s), excluded
> public bodies, and measured the bench. This is the unit that follows, and it is the highest-value
> one available.

---

## The finding, in one line

**≈51 people at 9 owners worth $358M are already in `entities` and invisible to Tier 0** — because
the matching rule's own eligibility test excludes them. Including **Boyd Watterson ($179.8M, the
largest owner in the system)**, whose two contacts sit at `@boydwatterson.com`.

| owner | rent | people held | notable |
|---|---|---|---|
| Boyd Watterson Asset Management | $179.8M | 2 | Eric Dowling, Joseph Capra |
| NGP Capital | $59.8M | 3 | David Kent, Fran Cowan, Kim Phillips `@ngpv.com` |
| Government Properties Income Trust | $39.7M | 7 | `@govtrealestate.com` / `@govinvpartners.com` |
| TIAA CREF | $26.4M | 2 | |
| RMR Group | $16.4M | 20 | **Adam D. Portnoy**, President & CEO |
| HPI Capital / AVG / GI Partners | $26.9M | 5 | Rick Magnuson (GI founder) |
| Realty Income Corporation | $5.8M | 12 | **Sumit Roy**, CEO |

## Three causes, each verified per owner — do not re-derive, they are measured

1. **`length(tok) >= 5` deletes acronym firms.** NGP, RMR, TIAA, USAA, GI, HPI, AVG produce
   **zero tokens**. These are exactly the institutional buyers Scott's doctrine targets.
2. **Prefix-only matching.** Boyd Watterson's only surviving token is `watterson`; the domain is
   `boydwatterson`. `sld LIKE tok||'%'` cannot match a token that sits in the middle.
3. **The stoplist can consume the entire name.** "Realty Income Corporation" → realty / income /
   corporation are all stoplisted → **zero tokens**. This is CLAUDE.md's documented
   `ownerCore` → empty-string failure appearing in a new place.

## ⚠️ Traps that are already known — do not rediscover them expensively

- **`lcc_owner_strict_core` SORTS its tokens.** `'Boyd Watterson Asset Management, LLC'` →
  `asset boyd management watterson` → `assetboydmanagementwatterson`, which does **not** contain
  `boydwatterson`. CLAUDE.md warns about this for acronym initials; it applies to domain matching
  identically. **The build needs an UNSORTED compacted core.**
- **A CONTAINS match is not automatically looser.** Testing the *whole* compacted core against the
  SLD is STRICTER than the current single-token rule. It is the *acronym arm* that is dangerous.
- **The acronym arm needs a hard gate.** `gi` would match hundreds of domains. Require length ≥ 3,
  SLD starts with the acronym, and the SLD is short (≤ 8 chars) or an exact match. **State the
  named-row expectations before running it** — `ngpv`, `rmrgroup`, `hpitx`, `avgpartners`,
  `tiaa-cref` must pass; a two-letter acronym must never be admitted.
- **Geographic and generic tokens are a measured error class** (P186 §5): `omaha` →
  `omahavaccine.com`, `denver` → `denverrealestate.com`, `worth` (Fort Worth) → `worthsa.com`,
  `hawaii` → `hawaii.rr.com`, `tenant` → `tenantwisdom.com`. Add US city/state names and generic
  CRE nouns to the stoplist in the same change. `lcc_property_attributes.city` is an in-database
  source for the city list — prefer it to a hand-typed one.
- **`hawaii.rr.com` shows the free-mail stoplist is incomplete** — consumer ISP domains
  (`rr.com`, `sbcglobal.net`, `bellsouth.net`, `cox.net`, `charter.net`, `earthlink.net`) are not
  in it.
- **Boyd Watterson has 8 duplicate/adjacent entities at $0 rent**; only
  `Boyd Watterson Asset Management, LLC` is the resolved owner. Expect ranking to keep exposing
  duplicates (playbook item 8).

## What to build

1. **Widen the stoplist** (geography + generic CRE nouns + consumer ISP domains). Measure the
   before/after pair count and read the rows that drop.
2. **Add an unsorted-core containment arm**: SLD is a prefix of, or equal to, the owner's
   compacted core with legal suffixes stripped. Boyd Watterson and Realty Income should both
   appear.
3. **Add a hard-gated acronym arm** for short-core institutional owners.
4. **Re-run the P186 precision read** — top 45 by rent, individually, counting errors. The bar to
   beat is ~76–80%.
5. **Then** the confirm-a-draft lane (below), not before.

## Standing decisions from Scott (2026-08-26) — do not re-litigate

- **Corroboration bar:** correspondence is NOT required. "Additional evidence of the right source
  or connection or prospect historically" — Salesforce campaign membership, SF contact record,
  Outlook address book, or company-name corroboration all count. **But note P186 §5: that bar
  attests to the PERSON, not the OWNER LINK.** Gary George (George's Inc, poultry) passes all
  three and does not work at George Washington University.
- **Municipalities and public bodies are out of prospecting scope**, and their ownership data is
  still reconciled normally. Implemented in `lcc_owner_name_is_public_body` + the Tier 0 view.
- **Brokers are never promoted to the pivot at any tier.**

## Still open, needing Scott — carried forward

- **Public universities.** University of Memphis and UNC Health Care System are still in
  prospecting scope; George Washington ($23.8M) and Georgetown ($8.0M) are PRIVATE and should
  stay. No name-based rule separates them. Needs a call, not a regex.
- **Unattended promoter vs confirm lane.** P186 recommends the confirm lane at ~80% link
  precision. If P187 lifts precision materially, revisit.

## Carried forward from Prompt 186 (unchanged)

Items 2–6 of `186-continuation-handoff-2026-08-26.md` are untouched: Probe B (operator-gated),
the six Class-9 verdicts, the `autoClassify` backfill (406 + 2,468 rows), the Amy Dane / Amy Moyer
merge, the NPI verdict lane, duplicate owner entities (Easterly ×2, NGP ×3, Elman ×2, Boyd
Watterson ×8), and the `contact_merge_queue` re-check in a few days.
