# Prompt 195 — merge the 60 byte-identical owner groups ($102.4M)

> **Read first:** `docs/audits/P189_MERGE_DETECTOR_BLIND_SPOT_2026-08-26.md`, the `lcc_merge_entity`
> / Class 8 / P175a sections of `CLAUDE.md`, prompt 193 (the *opposite* problem).
>
> P189 made this population visible; **nothing has been merged.** This is the pass that lands the
> cleanup, and it is the duplication Scott hit working the Tier 0 lane.

---

## The population — the highest-confidence merge set in the system

`v_lcc_merge_candidates_normalizer_blind where names_identical`:

| | |
|---|---|
| groups | **60** |
| entities | **147** |
| combined current annual rent | **$102.4M** |

Every member of every group carries **the same name string, byte for byte.**

| group | entities | resolved owners | rent |
|---|---|---|---|
| `ngpcapital` — "NGP Capital" ×5 | 5 | **2** | **$68.3M** |
| `avgpartners` — "AVG Partners" ×4 | 4 | 1 | $8.9M |
| `gipartners` — "GI Partners" ×3 | 3 | 1 | $8.6M |
| `jlbcapital` — "JLB Capital" ×3 | 3 | **2** | $4.5M |
| `wmcproperties` ×2 | 2 | 1 | $4.4M |
| `ngpgroup` — "NGP Group" ×3 | 3 | **2** | $2.6M |
| …54 more | | | |

## ⚠️ Split the work by RISK, not by rent — the stakes differ by an order of magnitude

| slice | groups | what a merge touches |
|---|---|---|
| **multiple resolved owners** | **3** | `lcc_property_owner` moves — properties change owner. **Highest stakes; do these last, individually, with the named rows read.** |
| exactly one resolved owner | 16 | merge the others into the one that owns; the survivor is determined |
| no resolved owner | 41 | low stakes — nothing owns anything |

The 3 multi-owner groups are `ngpcapital` ($68.3M), `jlbcapital`, `ngpgroup`. **`ngpcapital` alone
is two-thirds of the value of the whole pass.**

## ⚠️ This is NOT prompt 193's problem — and both live in the NGP name space

| | |
|---|---|
| **five entities named "NGP Capital"** | one firm recorded five times → **merge** (this prompt) |
| `NGP VI ESSEX VT LLC`, `Ngp Vi Harlingen Tx LLC`, … | legitimately distinct SPEs → **parent edge + inheritance** (prompt 193). **Merging these would destroy the ownership record.** |

Before merging anything NGP-named, confirm which of the two it is. The name-identity test is the
discriminator: *identical string* = merge candidate; *different SPE name sharing a sponsor token* =
never.

## Traps already paid for — do not rediscover them

- **`lcc_merge_entity` is the ONLY path.** It carries the P160 backref repoints (portfolio facts,
  identities, relationships, cadence, `lcc_property_owner`, `owner_contact_pivot`,
  `bd_opportunities`), the P153 cycle guard (hop-capped at 20), and terminal-survivor resolution.
  Never move backrefs by hand.
- **⚠️ `auto_mergeable` is FALSE on every fallback group ON PURPOSE.** `lcc_apply_fuzzy_merges()`
  loops that flag straight into `lcc_merge_entity()`. **Do not flip it to drive this pass** — drive
  it explicitly, group by group.
- **⚠️ Class 8: ask what re-creates the row tomorrow.** `lcc_finalize_entity_portfolios` resurrected
  119 tombstones' worth of portfolio facts because a tombstone *still exists*. Any writer keyed on a
  domain-supplied id must resolve through `lcc_entity_survivor()` and require
  `merged_into_entity_id IS NULL`. **Re-run the sweep a day later** — a verified result has a shelf
  life (P176).
- **⚠️ P175a: a survivor row for the same key is not automatically a duplicate.** Where the ghost
  reads `is_current` and the survivor reads ENDED, the rows *contradict* each other; deleting the
  ghost resolves toward the stale side and cost $1.7M of live rent last time. **Three dispositions,
  not two.**
- **Boyd Watterson's 7 zero-rent siblings are NOT in this set and are NOT merge targets** — JV
  vehicles ("Boyd Watterson JV UBP") and a brokerage artifact ("Boyd Watterson by Stan Johnson Co").
- **Two side-findings from P189, left as stated gaps:** `jameshowardcpa.com` groups two unrelated
  owners through a shared **CPA**, and `lcc_is_spe_shell_name` under-detects place-named SPEs. Do
  not write a competing SPE detector to fix the second.

## Verify by

Tier 0 lane cards for a merged firm dropping (Easterly-style duplication is the operator-visible
symptom); `v_lcc_merge_candidates_normalizer_blind` shrinking by exactly the groups merged;
`auto_mergeable` unchanged at 3,053; and the Class 8 re-sweep a day later showing no resurrection.
**Report entities merged and rent consolidated — not groups processed.**

## Also open, unchanged

- **N3e — 95 parked Tier 0 cards ($118M) are stuck permanently.** They carry person evidence but no
  link evidence, and the decidability `CASE` reads only link evidence. ⚠️ **Do not fix by widening
  the un-park** (that restores the Gary George noise); they need a different resolution path.
- **fcp→fcpdc.com, tmg→tmgdc.com** — the two held sponsor entries, pending Scott's check.
- **N3c — bank / trustee owners** (Truist $6.2M/15 candidates, Wells Fargo, the JP Morgan CMBS
  trust): a scope rule, not 15 person-picks.
- **Operator steps:** reload the unpacked extension (the sidebar alert is watching for it); add
  `npm test` to branch protection; read `GET /api/tier0-auto-attach-tick` to decide
  `TIER0_AUTO_ATTACH`.
