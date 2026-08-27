# Prompt A3 — the 73 "mismatches" are mostly sponsor↔SPE. Do not build 73 human cards.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`,
> `DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` §E4, the **P190/P193 sponsor-map** and
> **P196 §Unit 2** sections of `CLAUDE.md`, and `PLANNED-BACKLOG.md` A3.
>
> ⚠️ **The backlog row for A3 said "route the 73 to a data-integrity lane, both readings on the
> card." Measured 2026-08-27, that would have been the wrong build.** Read §1 before designing
> anything.

---

## 1. What the 73 actually are (measured, not assumed)

`action='mismatch'` means the chain's last recorded grantee **≠** the owner we hold. The tempting
reading is *"our ownership record is contradicted."* Measured, the dominant pattern is
**sponsor ↔ SPE** — the deed records the **special-purpose entity that holds title**, our field
records the **sponsor**. Both are correct; it is a representation question, not a data error.

| current owner on file | chains | distinct grantees | example last-recorded grantees |
|---|---:|---:|---|
| **Boyd Watterson Asset Management, LLC** | **24** | 11 | `BELTSVILLE GSA FDA, LLC`, `Boyd Bethesda III GSA, LLC`, `Boyd Chantilly …` |
| Easterly Government Properties | 3 | 2 | `EGP 116 Suffolk LLC`, `Easterly Government Properties, Inc.` |
| FGF Management LLC | 2 | 2 | `GERMANTOWN MD I FGF, LLC`, `TYSONS CORNER VA III FGF, LLC` |
| Brookfield Asset Management | 2 | 2 | `1301 FANNIN OWNER LP`, `BOF DPC Denver West Park 54 LLC` |
| Blackstone | 1 | 1 | `BRE 1200 Wall Street Owner LLC` |
| Brent Waldman | 1 | 1 | `Waldman, Brent` *(name order, not a party difference)* |
| DEAMO LLC. | 2 | 2 | `Deamo`, `LuLu Hsu` |

**Boyd Watterson alone is 24 of 73 (33%).** The top four owners are ~31.

**Two hypotheses TESTED and REFUTED — do not re-walk either:**

1. **The `gsa_lease_diff` flicker does not explain these.** It predicted SPE↔parent *name
   similarity* on gsa-sourced chains. Measured the opposite: of 47 chains carrying a
   `gsa_lease_diff` link, only **7** share an 8-character prefix with the current owner, while
   **21 of 27** non-gsa chains do.
2. **A2b is not the same population.** 46 mismatch properties vs 12 `repeat_transfer` properties,
   **overlap zero**. A3 cannot be collapsed into A2b.

## 2. The shape to build: one decision per SPONSOR, not per chain

**~4–8 sponsor decisions could resolve ~31+ chains.** Asking the same question 24 times about Boyd
Watterson is the badge-that-is-noise failure — and the repo already has the machinery for exactly
this: **`lcc_owner_sponsor_domain`** (P190, human-confirmed rows with `confirmed_by`) and the
**P193 SPE-inheritance** rollup.

**Build the sponsor-level question:** *does a chain terminating at an SPE of sponsor X satisfy
"terminates at current owner X"?* One confirm covers that sponsor's whole family, now and future.

**⚠️ Guardrails, each from a measured failure in this repo:**

- **A lexical sponsor detector is a noise generator at ~25% precision** (P196 Unit 2). With the
  three guards — SPE/portfolio marker present, not street-shaped, not person-shaped — it reached
  4 of 6. **Reuse `lcc_tier0_sponsor_brand_token` and its guards; do not write a second detector.**
  A second SPE detector is the normaliser drift this file warns about repeatedly.
- **`lcc_is_spe_shell_name` under-detects PLACE-NAMED SPEs** — a documented gap, and
  `BELTSVILLE GSA FDA, LLC` / `GERMANTOWN MD I FGF, LLC` are exactly that shape. Expect it to miss
  them; **report what it misses rather than widening it silently.**
- **Name similarity is NOT identity.** `Boyd Watterson Global` vs `Boyd Watterson Asset
  Management, LLC` may be a **fund vs its manager** — genuinely different legal entities. Sponsor
  membership must be **human-confirmed per sponsor**, exactly as `lcc_owner_sponsor_domain`
  already requires. Do not auto-accept on a shared token.
- **Do not "resolve" a mismatch by overwriting either side.** The SPE is the title holder; the
  sponsor is who we prospect. **Both facts are true and both should survive.**

## 3. The residue is the real integrity lane

After the sponsor families, what is left is small and genuinely worth a human: cases like
`DEAMO LLC.` ← `LuLu Hsu` (an unrelated person), and any chain where the grantee belongs to no
sponsor family. **That** is the data-integrity lane the original A3 row described — and it is
perhaps 20–30 cards, not 73.

**Size it and report it before building a surface for it.**

## 4. What I want

1. **Classify all 73** into: sponsor-family candidate (with the proposed sponsor), name-order or
   punctuation variant, or genuine unexplained mismatch. **From structured fields plus the shared
   sponsor guards — never a fresh regex.**
2. **A sponsor-confirm path** reusing `lcc_owner_sponsor_domain`, one decision per sponsor,
   `confirmed_by` required, reversible.
3. **The residue, sized and characterised** — do not build its surface in this prompt.
4. **Report what the guards miss** (expect the place-named SPEs) as a stated gap.

## Guardrails

- **No model.** Category (a) — structured and on-box.
- **Do not touch** `agrees` (92), `no_records` (74) or `all_guarded` (18). A2a/A4/A4b own those.
- Dry-run default, reversible, honest counts — **chains resolved per sponsor decision**, never
  "chains scanned".
- `npm test` locally; branch → PR → both checks green → merge (`docs/os/GITHUB-WORKFLOW.md`),
  and expect the Update-branch gate.

## Verify

```sql
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```

`mismatch` should fall by roughly the sponsor-family count once confirmations are applied.
**`agrees`, `no_records` and `all_guarded` must not move.** And the honest headline is
**decisions asked of Scott**, not chains touched: going from 73 questions to ~8 sponsor
confirmations plus a ~20–30 card residue is the win.
