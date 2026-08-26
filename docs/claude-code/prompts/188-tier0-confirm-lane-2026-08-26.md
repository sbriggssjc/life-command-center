# Prompt 188 — the Tier 0 confirm lane, and the residue P187 left

> **Read first:** `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`,
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 13,
> `docs/architecture/account-based-contact-intelligence.md`.
>
> P186 fixed the view's performance and scope. P187 fixed the matching rule. **Nothing has ever
> been written to `owner_contact_pivot`, and that is still the right state.**

---

## State of the bench, 2026-08-26

| | value |
|---|---|
| candidate pairs | **558** |
| owners with a bench | **208** |
| top-45-by-rent precision | **~91%** |
| precision in the ~$2M SPE band | **~60–70%** |
| owners ≥$5M still with an empty bench | 44 ($738M) |

## 1. ⭐ Build the confirm lane — this is the unit that turns the bench into calls

**Not an unattended promoter.** At 91% top-of-book precision, 1 in 11 writes would still put the
wrong firm's employee in `owner_contact_pivot`, and precision degrades to ~60–70% lower down.

Use the pattern already in the repo — `lcc_clean_assist_proposals` + a Decision Center lane —
rather than a new surface:

- **Rank by owner rent, and work top-down.** Precision is a curve; the operator must meet the
  reliable end first. Report the rent band with any precision claim.
- **Verdicts:** `attach` (write `owner_contact_pivot.active_contact_entity_id` + an
  `entity_relationships` edge), `reject` (terminal, never re-proposed), `research`.
- **Reuse `owner-contact-verdict-planner.js::validateVerdict`'s shape gate** so a stale card
  cannot mint an organisation as a person (P114 precedent).
- **Brokers are never promoted at any tier** — reuse the P161-gated `owner-reachable-via`
  resolver and `NON_REACHABLE_ROLES`.
- **Group the card by (owner, domain), not by pair.** RMR is 20 people at one domain; that is one
  judgement, not twenty. Then let Scott pick the person.
- **Carry the evidence** (Salesforce campaign membership, SF contact, Outlook, correspondence,
  company-name corroboration) on the card. ⚠️ **And label what it proves:** the evidence attests
  the PERSON is real and known to us; it does **not** attest they work for this owner. Gary George
  at `georgesinc.com` (a poultry company) passes all four for George Washington University.

## 2. The residue P187 deliberately left — recorded, not patched

| item | why it was left |
|---|---|
| **GWU → `georgesinc.com`** | token `george` has fan-out 1 and is shared by 2 owners, so no fan-out gate can see it. A confirm-lane reject. |
| **"Southern SSA LLC"** → southern-agency, southerntraditionrealestate | `southern` has fan-out exactly 2 — right at the threshold. |
| **One CMBS securitization trust** ("JP Morgan Chase Commercial Mortgage Securities Trust 2018PTC…", $2.38M, 6 wrong pairs) | A securitization vehicle is not a prospectable owner, but it is **exactly one row**, and a rule matching one row gets trusted as general later. Revisit if more appear. |
| **The curated sponsor→domain map** | The rejected acronym arm's real value sat in ~6 sponsors: NGP→ngpv.com ($59.8M + ~$26M across 10 SPE variants), UIRC→uirc.com, HPI→hpitx.com, JBG→jbg.com, FCP→fcpdc.com, TMG→tmgdc.com. **A curated map of six verified entries is more precise than any rule** — but each entry needs Scott's confirmation, so it is a decision, not a refactor. |

## 3. Still open for Scott — carried forward, do not decide these in code

- **Public universities.** University of Memphis and UNC Health Care System are public and still
  in prospecting scope; **George Washington ($23.8M) and Georgetown ($8.0M) are private and must
  stay.** No name-based rule separates them.
- **The six sponsor→domain entries above** — confirm or reject each.

## 4. Carried forward from 186, untouched

Probe B (operator-gated, needs the M365 connection); the six Class-9 verdicts; the `autoClassify`
backfill (406 resolved-owner contacts + 2,468 SF campaign members misclassified `personal`);
the Amy Dane / Amy Moyer merge and the generalised local-part-collision-across-a-superseded-domain
rule; the NPI binary verdict lane (15 decidable + 47 weak); `contact_merge_queue` re-check after a
few days of real intake.

**Duplicate owner entities — now measured and worth its own pass.** Easterly ×2 (both in the
bench, producing 16 pairs for 8 real people), NGP ×3, Elman ×2, **Boyd Watterson ×8** (only
`Boyd Watterson Asset Management, LLC` is the resolved owner; the other 7 carry $0 rent), and
duplicate **Andrew Pulliam** person entities. These inflate every per-name rollup and split deal
history. Expect ranking to keep exposing duplicates (playbook item 8).
