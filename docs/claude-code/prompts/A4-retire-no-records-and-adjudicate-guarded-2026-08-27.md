# Prompt A4 + A4b — retire the 74 that cannot be answered; adjudicate the 18 that were guarded away

> **Automation/data-process audit window** (lettered prompts).
> **Read first:** `docs/audits/A1_OWNERSHIP_LANE_SPLIT_2026-08-27.md`, the A2 writeup,
> `PLANNED-BACKLOG.md` P1b, `CLAUDE.md` → auto-retire doctrine + P181 (one label, two facts).

---

## Where the lane stands

A1 split it; A2 drained the `agrees` bucket and **took the lane from 0 completions in 69 days to
288**. The 257 still open are now four named populations:

| action | tasks | what it is | this prompt |
|---|---:|---|---|
| `agrees` | 92 | appliable, blocked on entity duplicates / repeat transfers | ❌ A2a (blocked) / A2b |
| `mismatch` | 73 | our owner is contradicted | ❌ A3 |
| **`no_records`** | **74** | nothing recorded exists | ✅ **Unit 1 — retire** |
| **`all_guarded`** | **18** | transfers exist, every one guard-rejected | ✅ **Unit 2 — adjudicate** |

**Why these two now:** `A2a` is **blocked** — it merges duplicate entities, and `lcc_merge_entity`
currently has **no undo** (every dedup DELETE is unrecoverable, and its `owner_contact_pivot` dedup
is uncorrelated). The app window's **prompt 196 Unit 1** is fixing exactly that. Do not build a
third merge driver in the meantime. A3 needs its own hypothesis test first (below). **A4/A4b are
the unblocked work.**

---

# Unit 1 — auto-retire the 74 `no_records`

`insufficient_reason = 'no_transitions_on_file'`: the government records hold no transfers for
these properties. **Not answerable from what we hold, by anyone.** They have sat queued for 69 days
teaching the operator that this lane is noise.

**Build:** a terminal, dated retire — `status='skipped'` with an outcome naming *why*, batch-tagged
and reversible.

**Non-negotiables:**

1. **Read `action='no_records'` off `v_lcc_ownership_history_lane_split`.** Do not re-derive the
   bucket, and do not key on `insufficient_reason` text directly — the view is the single owner of
   that classification (A1's whole point).
2. **⚠️ Only the 74. NOT the 18.** They wear one label in the drafter and are two different facts.
3. **It must RE-OPEN if records land.** A retire that cannot reverse itself is a delete. The seed
   predicate has to admit the property again when `gov.ownership_history` gains a row —
   **state how that happens, and prove it** (a property with a synthetic new transition should
   come back). If nothing can re-open it, say so plainly rather than implying a loop that does not
   exist.
4. **Check what re-mints it tonight.** `lcc_generate_chain_research_tasks` skips a property only
   for an OPEN task or a TERMINAL skip. Confirm `skipped` is genuinely terminal for this seeder, or
   the 74 come straight back and the retire is a chore repeated silently forever (P176).

---

# Unit 2 — adjudicate the 18 `all_guarded`

`insufficient_reason = 'all_transitions_guarded'`. **Transfers exist for these properties and every
one was rejected** by a P138 guard: self-transition, oscillating pair, unclean name, or missing
`true_owner_id`. This is *"data we chose to distrust"*, not *"no data"* — and a guard that is
marginally too strict is recoverable.

**This unit is a MEASUREMENT, not a fix.** Do not loosen a guard in this prompt.

**Produce, per task:** which guard fired, on how many transitions, and the rejected rows themselves
(`proposed_link->'rejected'` carries them; `rejected_count` is on the split view).

**Then group by guard and answer:** is any guard rejecting rows it should not?

- **`is_oscillating_pair`** is the one to look at hardest — `CLAUDE.md` records it as
  per-property *by design*, because `gsa_lease_diff` flickers between an SPE and its parent. If all
  18 are oscillation, this bucket is correct and the honest outcome is **retire them like the 74,
  with the reason recorded**.
- If instead a guard is firing on something recoverable (e.g. a name the brokerage-suffix stripper
  should have cleaned), that is a **finding with a size**, filed as its own row — not a change
  smuggled into this prompt.

**Either outcome is a success.** "The guards are right and these 18 are genuinely unusable" is a
real answer and closes the bucket.

---

## Guardrails (both units)

- **No model anywhere.** Category (a) — structured and on-box.
- **Do not touch `agrees` (92) or `mismatch` (73).** A2a/A2b/A3 own them.
- Reversible by batch tag; dry-run default; **report tasks retired and tasks re-openable**, never
  "tasks scanned".
- `main` is protected and the tree is often dirty — `docs/os/GITHUB-WORKFLOW.md` §0b/§2/§4c, and
  **expect the Update-branch gate** (§3). Run `npm test` locally; the marker guard is in the suite.

## Deliverables

- Unit 1: the retire + its schedule, with the re-open path demonstrated.
- Unit 2: the per-guard table, the verdict, and either a retire (if correct) or a sized finding.
- `PLANNED-BACKLOG.md`: A4 → done; A4b → done **or** rewritten with the measurement.
- Backlog rows updated for anything the guard analysis turns up.

## Verify

```sql
select action, count(*) from v_lcc_ownership_history_lane_split group by 1 order by 2 desc;
```

**Expect `no_records` → 0** and the lane's open count to fall from 257 to ~183 (or ~165 if the 18
retire too). **`agrees` must stay 92 and `mismatch` exactly 73** — if either moves, something
touched a bucket it should not have.
