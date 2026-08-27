# Prompt A1 — `establish_ownership_history` is four different jobs wearing one label. Split it.

> **Numbering:** this is the **automation/data-process** audit window. Its prompts are lettered to
> match their backlog rows (`A1`, `A2`, …) so they cannot collide with the parallel **app** audit
> window running on the desktop, which owns the numeric series (189, 192, 194, …).
>
> **Read first:** `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md`,
> `PLANNED-BACKLOG.md` P1b, `CLAUDE.md` → Consumption-Layer doctrine + the P182 (text-detector)
> and P181 (one label, two facts) footguns.
>
> **This prompt SPLITS ONLY. It applies nothing, writes no ownership links, and retires nothing.**
> A2/A3/A4 do that, and each is gated on this landing first.

---

## The finding

`establish_ownership_history` has **545 open tasks and ZERO completions in 68 days.** It is not
short of answers: **453 of the 545 already carry a finished, deterministic, record-cited draft** in
`lcc_clean_assist_proposals` (source `ownership_chain_draft`, one row per subject, written by
P131/P133).

Nobody completes one because the lane presents **four structurally different jobs as one
undifferentiated "go research this" queue**:

| bucket | n | links | what it actually is |
|---|---|---|---|
| **agrees** — chain ends at the owner we already hold | **380** | **450** | a **confirmation**, not a question (337 contiguous + 43 with disclosed gaps) |
| **mismatch** — last recorded grantee ≠ our current owner | **73** | 120 | a **data-integrity alert**: our owner may be wrong, or the chain incomplete |
| **no records** — `no_transitions_on_file` | **74** | 0 | unanswerable from what we hold |
| **all guarded** — `all_transitions_guarded` | **18** | 0 | ⚠️ transfers EXIST; every one was rejected by a P138 guard |

An operator facing a queue that mixes *confirm what you already believe* with *your ownership
record is contradicted* with *this cannot be answered* learns to skip all of it. Sixty-eight days
of zero completions is what that looks like.

## ⚠️ Classify from the STRUCTURED payload, never from the `reason` prose

`proposed_link` already carries every field needed:

```
draftable                      boolean
terminates_at_current_owner    boolean | null   ← the mismatch classifier
insufficient_reason            'no_transitions_on_file' | 'all_transitions_guarded' | null
continuity.contiguous          boolean | null
continuity.breaks              int
links[]                        [{from,to,date,price,gap_before,citation{...}}]
research_task_id               uuid             ← the join back to the lane
current_owner_name             text
```

The first measurement of this bucketed on `reason ilike '%does not match the current owner%'`.
**Both methods return 380 / 73 / 92 today — and the text one is still wrong to build on.** It is
the P182 trap: a detector that cannot survive a wording change, over prose the drafter generates.
It also **cannot see the 74/18 split**, which only exists in `insufficient_reason`.

**Use the booleans. If you find yourself pattern-matching `reason`, stop.**

## What to build

1. **A lane-split view** — one row per open `establish_ownership_history` task joined to its draft,
   exposing a single `action` column with exactly four values (`agrees` / `mismatch` /
   `no_records` / `all_guarded`) plus the structured evidence each action needs. Additive; no
   writes.
   - Join `research_tasks.id = proposed_link->>'research_task_id'`. **Report tasks with no draft
     as their own count** — do not silently drop them, and do not assume it is zero because the
     drafter claims full coverage (it claimed 545/545; verify).
2. **Surface the four actions as distinguishable work**, not one list. Minimum viable: the lane
   picker / seeder chips already used by `owner_reconcile` and the P139 provenance lane — reuse
   that pattern, do not invent a new one.
3. **Honest counts on the badge.** The lane badge must not read `545`. `agrees` and `no_records`
   are not questions for a human; if the badge counts them it is the badge-that-is-noise failure
   this repo has paid for repeatedly. **Count the work a human must actually do.**

## Guardrails

- **No model anywhere in this path.** P131 lens category **(a)** — the answer is already on-box and
  structured. Adding an LLM here would be strictly worse: it can only introduce error into a chain
  whose citations are record references and therefore cannot be hallucinated.
- **Split only. No writes, no retirement, no auto-apply.** A2 (apply the 380), A3 (route the 73),
  A4 (retire the 74) and A4b (adjudicate the 18) each land separately, and each is reversible.
- **Do not auto-retire the 18 with the 74.** They are the P181 shape — one label, two facts.
  "Nothing recorded" and "we distrust everything recorded" call for different actions.
- Additive view; no `CREATE OR REPLACE VIEW` column reordering (append only).
- **`npm test` before you push** — CI does not run it (backlog N9), so the suite is only a gate if
  a human runs it.

## Deliverables

- The lane-split view + migration, and the surface change that renders four actions.
- The measured split reported as a table, from the **structured** fields, with the no-draft count
  stated explicitly.
- A test that pins the classifier to the booleans. **Anchor it on the field names**
  (`terminates_at_current_owner`, `insufficient_reason`), never on a `reason` substring or a
  sliced source region — that is the block-slice footgun this repo has hit three times.
- Backlog rows A1 → done, and A2/A3/A4/A4b confirmed unblocked in
  `docs/os/PLANNED-BACKLOG.md`.

## The verification that matters

**`establish_ownership_history` completing its first task ever.** Not the view existing, not the
chips rendering — a `completed` row. Until then this lane has produced 545 items and consumed none
for 68 days, and a split that does not change that is a no-op with extra steps.
