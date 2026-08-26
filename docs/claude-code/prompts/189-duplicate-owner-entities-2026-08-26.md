# Prompt 189 — duplicate owner entities, and the detector that cannot see 1,089 of them

> **Read first:** `docs/audits/P188_TIER0_CONFIRM_LANE_2026-08-26.md`,
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 11 and 13, the `lcc_merge_entity` /
> `dup-pair-planner` sections of `CLAUDE.md`.
>
> The Tier 0 lane (P188) is live with 237 actionable cards. **Duplicate owner entities degrade it
> directly** — Easterly is one firm rendered as 4 cards — and they split deal history, which is the
> signal prospecting ranks on. This is the cleanup that makes the thing we just shipped usable.

---

## 1. ⚠️ The headline is a DETECTOR defect, not a data backlog

**`lcc_normalize_entity_name()` returns NULL for 1,089 live organisations carrying $185.1M of
current annual rent.** Measured 2026-08-26 on LCC Opps.

`v_lcc_merge_candidates` — the repo's duplicate-entity surface — **groups on that column**. So it
is structurally blind to all 1,089. Among them, in the live Tier 0 lane:

| owner | rent | normalizes to |
|---|---|---|
| RMR Group | $16.4M | **NULL** |
| GI Partners | $8.6M | **NULL** |
| AVG Partners | $8.9M | **NULL** |
| MMI Capital, LLC | — | **NULL** |
| Jc Capital Group | $0.8M | **NULL** |

The cause is the documented one, in a **third** location: the normalizer strips `group`,
`partners`, `capital`, `holdings`, `company`, `trust` on top of legal forms, and for an
acronym-named firm nothing survives. CLAUDE.md already records this for
`dup-pair-planner.ownerCore` ("Realty Income Corporation" → empty string) and for
`lcc_owner_strict_core`; **it was never checked on `lcc_normalize_entity_name`, which is the one
the merge detector actually uses.**

This is playbook **Class 11** (a detector that cannot fire) applied to entity dedup: the surface
reports no duplicates for these owners, and the zero is the instrument.

**Second, independent blind spot — a wording difference defeats it.** Easterly's two live entities
normalize to `easterly gov reit` and `easterly government`, so they never group. This is CLAUDE.md's
own note that a polluted or reworded name is invisible to the merge detector, confirmed on the
highest-value owner in the lane.

## 1a. ✅ STEP 1 DONE — the blind spot is now visible (migration `20260827020000`, applied live)

`v_lcc_merge_candidates_normalizer_blind` — read-only, additive, **no `auto_mergeable` flag by
design**. First run:

| | |
|---|---|
| groups | **121** |
| entities covered | **300** |
| combined annual rent | **$136.5M** |
| **groups whose names are BYTE-IDENTICAL** | **60** |

| group key | members | rent | names |
|---|---|---|---|
| `ngpcapital` | **5** | **$68.3M** | "NGP Capital" ×5 — *identical string* |
| `rmrgroup` | 5 | $16.4M | "RMR Group" + "The RMR Group" ×4 |
| `avgpartners` | 4 | $8.9M | identical |
| `gipartners` | 3 | $8.6M | identical |
| `cimgroup` / `aeicapital` / `jlbcapital` / `ngpgroup` | 4 / 6 / 3 / 3 | | |

**Control:** `select count(*) from v_lcc_merge_candidates where norm_name = ''` returns **0** — the
existing surface sees none of these, which is what makes the counts trustworthy (playbook Class 11,
"use a control column").

**Why a companion and not a fix to `v_lcc_merge_candidates`:** that view feeds a destructive path
and currently reports **5,222 groups, 3,053 of them `auto_mergeable`**. Re-keying its grouping
changes which 3,053 auto-merge. That is a gated decision with its own named-row proof, not a side
effect of making a blind spot visible.

## 2. What to build next

1. **Fix the detector before touching data.** Give `v_lcc_merge_candidates` a fallback grouping key
   for names that normalize to nothing — `lcc_owner_domain_core()` (P187, order-preserving) is the
   obvious candidate and is already live. **Point it at a known positive first** (RMR Group must
   appear) rather than trusting a count.
2. **Re-measure the duplicate population** with the detector fixed. The pre-fix count is a floor,
   not a total.
3. **Propose, never auto-merge.** Duplicates measured in the live lane today: Cambridge $13.2M,
   Cunningham $10.6M, Gray Harbor $3.7M, Procacci $2.5M — plus **Easterly ×2** (4 cards for one
   firm), **NGP ×3**, **Boyd Watterson ×8** (only `Boyd Watterson Asset Management, LLC` is the
   resolved owner; the other 7 carry $0 rent), and duplicate **Andrew Pulliam** person entities.

## 3. ⚠️ Traps that are already paid for — do not rediscover them

- **`lcc_normalize_entity_name` is GROUPING-for-review, never IDENTITY-for-write.** CLAUDE.md:
  "Century Park Partners" == "Century Park Properties LLC" under it. Use `lcc_owner_strict_core`
  for the identity decision and require the core to carry real material.
- **`dup-pair-planner.ownerCore` / `nameSimilarity` are banned for identity** — "Realty Income
  Corporation" reduces to the empty string and fails to match itself; "Agree Realty Corp" and
  "Agree Holdings LLC" both reduce to `agree` and score 1.0.
- **`lcc_merge_entity` is the ONLY path** — it carries the P160 backref repoints, the P153 cycle
  guard (hop-capped at 20) and the tombstone-survivor resolution. Never move backrefs by hand.
- **Class 8: a producer re-creates what the cleanup cleaned.** After any merge, ask what writes
  these rows tomorrow. `lcc_finalize_entity_portfolios` resurrected 119 tombstones' worth of
  portfolio facts because a tombstone still *exists*. Resolve through `lcc_entity_survivor()` and
  require `merged_into_entity_id IS NULL` — existence is not liveness.
- **A survivor row for the same key is not automatically a duplicate (P175a).** Where the ghost
  reads `is_current` and the survivor reads ENDED, the rows *contradict* each other; deleting the
  ghost resolves toward the stale side. Three dispositions, not two.
- **Boyd Watterson's 7 zero-rent siblings are not all merge targets** — several are JV vehicles
  ("Boyd Watterson JV UBP", "Boyd Watterson JV American Nevada Co") and one is a brokerage artifact
  ("Boyd Watterson by Stan Johnson Co"). **Read the names before proposing.**

## 4. Verify by

The lane's own card count for a merged firm (Easterly 4 cards → 2), `v_lcc_merge_candidates`
returning RMR Group at all, and a re-run of the Class 8 sweep a day later (P176: a verified result
has a shelf life).

## 5. Still open for Scott — unchanged, do not decide in code

- **Public universities** — Memphis and UNC Health are public and in scope; **George Washington
  ($23.8M) and Georgetown ($8.0M) are private and must stay.** No name-based rule separates them.
- **The six sponsor→domain entries** — NGP→ngpv.com ($59.8M + ~$26M across 10 SPE variants),
  UIRC→uirc.com, HPI→hpitx.com, JBG→jbg.com, FCP→fcpdc.com, TMG→tmgdc.com. One decision each.
- **Work the Tier 0 lane top-down** — the 10 `measured_high` cards first; the 172 SPE cards are the
  ~60–70% band.

## 6. Carried forward, untouched

Probe B (operator-gated, needs the M365 connection); the six Class-9 verdicts; the `autoClassify`
backfill (406 resolved-owner active contacts + 2,468 SF campaign members misclassified `personal` —
this also corrupts the evidence signals the Tier 0 lane reads, so it is now higher value than when
it was filed); the Amy Dane / Amy Moyer merge and the generalised
local-part-collision-across-a-superseded-domain rule; the NPI binary verdict lane (15 decidable +
47 weak); `contact_merge_queue` re-check after real intake activity.
