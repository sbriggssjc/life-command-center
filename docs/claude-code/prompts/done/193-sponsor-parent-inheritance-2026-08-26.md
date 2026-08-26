# Prompt 193 — SPE subsidiaries inherit the sponsor's contact; stop re-asking

> **Read first:** the P193 migration header, `docs/architecture/account-based-contact-intelligence.md`,
> `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 14, prompt 189 (the *different* problem).
>
> **Nothing here may write to `owner_contact_pivot` outside the existing JS verdict path.**

---

## The observation (Scott, 2026-08-26, working the lane)

> *"I've gotten to a spot where I am seeing duplicates that are subsidiaries and matching the
> correct contacts. I feel like these should be automatically merged or connected to the true owner
> parent once we get to this spot where we have a connected domain and person."*

He was looking at `NGP VI ESSEX VT LLC → ngpv.com` directly above `Ngp Vi Harlingen Tx LLC →
ngpv.com` — same three candidates, same sponsor, same answer, asked twice.

## ⚠️ This is NOT the same problem as prompt 189, and conflating them corrupts ownership

| | prompt 189 | **this prompt** |
|---|---|---|
| Easterly ×2, "NGP Capital" ×5 | **one firm recorded twice** — a genuine merge | |
| NGP VI ESSEX VT LLC vs Ngp Vi Harlingen Tx LLC | | **legitimately distinct legal SPEs** holding different properties |
| fix | merge the entities | **a parent relationship + inheritance — never a merge** |

Merging SPEs would destroy the ownership record. Both problems are live simultaneously in the NGP
name space, which is exactly why they must be kept apart.

## Measured — 19 of 107 workable cards are one question asked three times

| sponsor | domain | SPE entities | rent | candidates | registered parent |
|---|---|---|---|---|---|
| `ngp` | ngpv.com | **13** | $26.1M | 3 | NGP Capital ✓ |
| `uirc` | uirc.com | 5 | $4.9M | 7 | UIRC, Urban Investment Research Corp. ✓ |
| `jbg` | jbg.com | 1 | $2.9M | 3 | — not registered |

**19 cards → 3 questions (−84%).** And the judgement is already recorded:
`lcc_owner_sponsor_domain.confirmed_by = 'scott 2026-08-26'` for all three.

## ⚠️ Review before building — most of the machinery exists

| | state |
|---|---|
| `lcc_buyer_parents` | **25 human-curated rows. NGP Capital, UIRC, RMR, Boyd Watterson, Easterly, Elman, Realty Income, Agree Realty, CoreCivic are already in it.** |
| `v_lcc_entity_tier0_parent` | 330 parent proposals; **85 already cover NGP/UIRC SPEs** |
| `v_lcc_tier0_sponsor_rollup` | **shipped by P193** — the proposal surface |
| `entity_relationships` | **0 parent edges, and no parent TYPE exists.** Enum: associated_with, brokers, deal_party, developed, finances, guaranteed_by, leases, owns, purchases, sells |

**The gap is the edge type and the propagation, not the registry.**

⚠️ **Naming trap:** `lcc_buyer_parents.domain` is the VERTICAL (`dia`/`gov`), **not** an email
domain. It does not overlap `lcc_owner_sponsor_domain.email_domain` despite the column name. Two
meanings of "domain" one table apart — check before "consolidating" them.

## What to build

1. **Add the parent edge type** (`subsidiary_of` / `parent_of`) to `entity_relationships` and write
   SPE→sponsor edges for the confirmed sponsors. Additive enum value; reversible.
   ⚠️ The P177 trigger resolves both endpoints through `lcc_entity_survivor` at INSERT — a
   parent edge must survive a later merge of either end.
2. **One rollup card per (sponsor, domain)** replacing the N per-SPE cards, listing the SPEs it
   covers and writing all of them on one verdict. Through the **JS verdict path** — a SQL bulk
   writer would bypass `isPersonShaped` / `isJunkEntityName` / `isMisparseName` / the broker guard.
3. **Inheritance going forward:** a NEW SPE for a confirmed sponsor should arrive already answered,
   not as a new card. This is the "living" property from prompt 192 — the sponsor answer is
   standing, and new subsidiaries inherit it rather than re-asking.

## ⚠️ Two things the rollup must NOT do

- **It must not collapse the WHICH-PERSON choice.** "Do the people at ngpv.com work for the NGP
  SPEs?" is one judgement. **"Do we call Fran Cowan, Kim Phillips or David Kent?"** is a real second
  decision and stays on the card. **UIRC has SEVEN candidates** — auto-picking there would be the
  P188 mistake (attach the first available person) at 5× the blast radius.
- **It must not silently attach across SPEs an operator has never seen.** Show the covered SPE list
  on the card and count them in the confirmation, so a 13-entity write is visibly a 13-entity write.

## Verify by

Cards for `ngp` going 13 → 1; `lcc_tier0_confirm_log` carrying 13 rows for one verdict (the write
count is the honest number, not the card count); and a re-run a day later confirming a newly
ingested NGP SPE arrives answered rather than as a new card (P176: a verified result has a shelf
life).

## Still open for Scott

- **fcp→fcpdc.com, tmg→tmgdc.com** — the two held sponsor entries.
- **Bank / trustee owners** (N3c): Truist $6.2M/15 candidates, Wells Fargo, the JP Morgan CMBS
  trust. A scope rule, not 15 person-picks.
- **JBG has no registered parent** — add one, or leave it as a single-SPE sponsor.
