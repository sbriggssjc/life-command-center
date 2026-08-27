# Prompt A0 — Committed conflict markers are on `main`. Add the guard that catches them.

> **Automation/data-process audit window** (lettered prompts). Small, standalone, and deliberately
> **not** bundled with A2 — that one is about the ownership lane and should stay about it.
>
> **Read first:** `docs/os/GITHUB-WORKFLOW.md` §4b, `CLAUDE.md` → the keep-both-sides footgun.

---

## The defect

`docs/architecture/panel-redesign-verification.md` carries **committed conflict markers**:

```
line 424  <<<<<<< HEAD
line 471  =======
line 571  >>>>>>> f59679a2f9f3948223f894218dec8309f15402c9
```

**148 lines** of that document are an unresolved merge that was committed as file content. It is on
`origin/main`, introduced by **`5bbe8c0f`** ("P122: two decisions NOT to build, and one
75-day-invisible gap made visible"). Roughly half the file is a duplicated, unreadable artifact.

**Git does not flag it.** There is no `UU` — as far as git is concerned the conflict was resolved;
someone simply resolved it by committing the markers. Prose has no parser, so nothing else caught
it either. It has been sitting there unnoticed.

## Why it is worth a guard rather than just a fix

This is the **third** instance of the same failure class in one evening
(`GITHUB-WORKFLOW.md` §4b): a conflict resolved by keeping everything.

- In a **YAML mapping** it produced two `node-version` keys → the workflow could not build a run
  → the required check never reported.
- In **prose** it produces this: no error, no test failure, no symptom at all — just a document
  that quietly stopped being trustworthy **75 days ago**, in a file whose own commit message is
  about a *"75-day-invisible gap made visible."*

A grep-level guard is close to free and would have caught every one of them.

## Build

1. **The guard.** A test (or a `check:boot` step — your call which fits better) that scans **tracked
   text files** for a line beginning with `<<<<<<< `, `>>>>>>> `, or a bare `=======` **that sits
   between the other two**, and fails naming file and line.
   - ⚠️ **A bare `=======` alone is NOT a marker** — it is valid Markdown (a setext H1 underline)
     and appears legitimately in this repo. Match it only *inside* a `<<<<<<<` … `>>>>>>>` span, or
     do not match it at all. **Point the detector at a known positive before trusting a zero**
     (`CLAUDE.md` P182): run it against `5bbe8c0f`'s version of the damaged file and confirm it
     goes red.
   - Skip `node_modules/`, and skip any file whose job is to *document* markers — this prompt and
     `GITHUB-WORKFLOW.md` §4b both contain them as examples. **Prefer excluding by path over
     weakening the pattern**; a weakened pattern is how a detector starts returning comfortable
     zeros.
2. **Repair `panel-redesign-verification.md`.** Read both sides of the 424–571 block and merge them
   properly. ⚠️ **Do not blind-pick a side.** This is a verification document — the two halves may
   record *different measurements*, in which case both belong, reconciled and labelled. If they
   genuinely conflict on a number, **say so in the file** rather than silently choosing; that is
   the house rule for a conflict you cannot adjudicate.
3. **Sweep the rest of the repo** with the new guard and report what else it finds. Fix what it
   catches in the same PR **only if the repairs are mechanical**; anything needing judgement gets
   its own backlog row rather than a rushed call.

## Guardrails

- Docs + test only. No code, no migrations, no flags.
- `npm test` locally before pushing — the gate is Node 24 and green, but it is a gate, not a
  substitute for running it.
- Branch → PR → both checks green → merge (`docs/os/GITHUB-WORKFLOW.md`).

## Deliverables

- The guard, **verified red on the pre-fix file** and green after.
- The repaired document, with a one-line note in it recording that the 424–571 region was a
  committed merge artifact and how it was reconciled.
- The sweep result — every other hit, or an explicit "none".
- A `CLAUDE.md` footgun entry **only if** the sweep shows this is a pattern rather than one file.

## Verify

```bash
# must name file + line, and must be RED here
git stash && git checkout 5bbe8c0f -- docs/architecture/panel-redesign-verification.md
npm test 2>&1 | grep -i "conflict marker"
```

A guard that has never been observed failing is not a guard — it is a line of code that has never
been asked a question.
