# C2a — at what rent floor does a minted asset actually RESOLVE an owner? Measure the curve.

> **Read first:** `docs/audits/C2_CONNECTIVITY_STALL_MAP_2026-08-28.md` (the stall map — do not
> re-run it), `docs/architecture/connectivity-and-open-threads.md` **§4e** (canonical chain state)
> and **§4b BREAK-3** (⚠️ its 49.2% is *of assets*, not of properties), `CLAUDE.md`
> §"Asset-identity coverage is what gates owner resolution", `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md`
> Classes 11 and 18.
>
> ⚠️ **This is a MEASUREMENT prompt. Mint nothing. Do not lower the floor.** The deliverable is a
> curve and a recommendation; the floor decision is Scott's.

---

## Why this and not something else

C2 measured the binding constraint. **5,144 LCC asset anchors against 32,289 properties (16%)**, and
a property with no asset entity **cannot carry owner evidence at all** — so 4,065 resolved owner
rows, 2,768 owner entities, and a 9,793-person Salesforce book of whom only **669 (6.8%)** can reach
a resolved owner are all downstream of this one gate. The owner→contact hop is *healthy* (52%).

**The 16% is deliberate.** `lcc_mint_gov_asset_entities` **refuses to run without `--min-rent`**;
the doctrine is *"evidence justifies the entity, never the reverse — an asset entity with nothing
attached is noise in every count, search and merge candidate."* P141 minted **663 gov assets at a
$500k floor → 612 resolved owners (92%)**, 51 held by the guards, zero stray.

**So the question is not "should we mint more" but "how far down does the resolve rate hold."**

## What to measure

For **each domain separately** (gov `scknotsqkcheojiaewwh`, dia `zqzrriwuavgrquhisnoa`), across rent
bands — suggested `≥$500k` (the current floor, as the control) · `$250–500k` · `$100–250k` ·
`$50–100k` · `<$50k` · **rent unknown** — report:

| column | meaning |
|---|---|
| properties in band | the population |
| already have an asset entity | current coverage |
| **would resolve an owner if minted** | the number that matters |
| would be held by a guard, **by guard name** | the honest residue |
| distinct owner entities gained | dedup matters — one owner may hold many |
| **new owners above the $500k rent floor** | how much of this reaches the BD surface at all |

**Compute "would resolve" the way the feeder actually does** — the domain's `true_owner_id` →
`external_identities(source_system, 'true_owner', <id>)` → a live entity. **ID-to-ID, never by
name** (the `Realty Income Corporation` → `""` footgun). Do **not** re-implement the resolver;
read `lcc_ingest_domain_owner_evidence` / `v_lcc_domain_owner_candidates` and use their logic.

## Traps this measurement must survive

- **⚠️ `dia.true_owners.is_operator_not_owner` — 7,941 of dia's 10,293 `true_owner` rows are
  OPERATORS** (DaVita, Fresenius in the owner slot, P113). **Exclude them from "would resolve" or
  the dia curve is fiction.** Use the recorded flag, never a name-based operator test — two
  definitions drift.
- **⚠️ Denominators.** BREAK-3's *49.2%* is of **assets**; C2's *13%* is of **properties**; they
  differ ~6×. **State your denominator in every figure**, and never compare across the two.
- **⚠️ A resolve rate that does not degrade is a bug signal until you check the instrument**
  (Class 11). P141 saw no degradation in lower bands **on small samples** — point the query at a
  band you expect to be poor and confirm it *can* report a low number.
- **⚠️ Rent-unknown is not rent-zero.** P161 measured that trade explicitly and gated unknown as
  *not small*. Report it as its own band; do not fold it into `<$50k`.
- **Value is per OWNER, not per property.** One owner holding 40 assets is one BD target. Report
  both, never blended (the documented 2×–4.65× inflation).

## What to recommend — and what NOT to

Recommend **a floor, or a staged sequence of floors**, with the resolve rate and the residue at each.
⚠️ **Do not recommend "mint everything."** ~27,000 evidence-less assets would inflate every
merge-candidate, search and count surface — precisely the noise the gate exists to prevent, and the
Consumption-Layer failure this repo documents at length.

If the curve holds well down to some band and collapses below it, **say where and why**. If it
degrades smoothly, say that the floor is a business call about surface noise rather than a data
call, and give Scott the numbers to make it.

## Verify by

Not by rows minted — **nothing is minted here.** By: a curve with a stated denominator per band; the
guard residue named guard-by-guard; the operator exclusion applied and its size quoted; and a
positive control proving the detector can report a bad band.

---

## Not in scope

- **Minting.** When a floor is chosen, the mint is a separate change: value-gated, `--min-rent`
  enforced, reversible by `metadata->>'mint_batch'`, **identities before entities**, per P141.
- **The Salesforce bridge (C2b)** — downstream of this; most of it connects itself once owners
  exist, and `sf_link_candidate` is the existing consumer to extend, never a second one (C1).
- **A5 / A5a / A5c and the research-task lanes** belong to the other Cowork thread.

## Still open elsewhere (do not action)

**👤 Scott:** whether `canonical_name` becomes an enforced UNIQUE key (**6,608** violating groups —
⚠️ *not* the 3,930 quoted before N15c/N15e; collapsing keys creates collisions); the fcp/tmg sponsor
entries; **N3c** bank/trustee scope; **N13** test-suite pruning.
**Carried:** **N19b** (24 husk duplicate pairs + 9 cross-`entity_type` pairs that must never merge);
**N3a**; **N16**; **N17** (fractional DST/TIC/JV ownership — a *relationship*, never a dedup-key
split); **C2c** (unmeasured: dia ownership depth, developer/investor/buyer split, Outlook per
contact, **WebEx is not in the schema at all**, broker assignment on 2,302 cadences).
