# Prompt A5 — `true_owner_needs_salesforce`: 815 open, it worked 596 times, now 1 per week. Find out why.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/DATA_PROCESS_AUTOMATION_AUDIT_2026-08-26.md` (the **RE-AUDIT block at
> the top**), `docs/architecture/ownership-history-lane.md` (the method that worked), and the
> Consumption-Layer doctrine in `CLAUDE.md`.
>
> ⚠️ **This is a DIAGNOSIS prompt. Do not build a consumer until you know what stopped.**

---

## 1. Why this lane and not another

Measured 2026-08-27, completion **rates** rather than lifetime totals:

| lane | open | done 7d | done 30d |
|---|---:|---:|---:|
| `property_missing_recorded_owner` | 1,185 | **159** | **908** |
| **`true_owner_needs_salesforce`** | **815** | **1** | **26** |
| `owner_contact_manual` | 311 | 0 | 0 |

It is **the biggest addressable stall in the system**:

- **Bigger than the ownership lane ever was** (815 vs 545).
- **Proven consumable — 596 lifetime completions.** Unlike `owner_contact_manual` (0 ever,
  externally egress-blocked), this machinery demonstrably worked and then slowed to ~1/week.
- **Never examined.** It has not been split, measured for actionability, or asked the P131
  question.

## 2. ⚠️ Resist the obvious hypothesis

The tempting read is *"it is four jobs under one label, like `establish_ownership_history`."*
**That is a hypothesis, not a finding**, and this arc refuted six plausible ones by measurement —
including two of mine about this same family of lanes. **Assume nothing about the shape.**

Equally, do not assume it is *not* that. **Measure.**

## 3. What to establish, in order

1. **When did it stop, and did it stop or decay?** Completions per week over its lifetime. A cliff
   and a slope point at different causes — a cliff suggests a producer/consumer/config change on a
   date you can then look up; a slope suggests the easy cases were worked first and the residue is
   harder.
2. **What is the residue, structurally?** Sample real rows. What is each task actually asking, and
   what would completing one require? **Read the rows, do not infer from the type name.**
3. **Apply the P131 lens and say which category this lane is:**
   **(a)** the answer is already on-box and STRUCTURED → deterministic plumbing, no model;
   **(b)** on-box but UNSTRUCTURED → an LLM fits;
   **(c)** not on-box at all → neither, and the honest output is a retire or an acquisition route.
   **Two of this repo's top-ranked "LLM opportunities" turned out to be (a) and (c) once measured.**
4. **Is the answer already somewhere?** The lane's name says Salesforce. Check whether the SF link
   already exists via another path — `lcc_sf_list_membership`, `external_identities`
   (`salesforce/Account`), the Tier 0 sponsor map, or the hub. **A2 found that 291 of 331 grantors
   it resolved were already minted by an unattached producer; the same shape is plausible here.**
5. **What is actionable vs unanswerable?** The P181 lesson: an escalation must carry the worker's
   confidence, and a lane that mixes decidable with hopeless trains the operator to skip both.
   **Size the decidable fraction.**
6. **What closes a task, and does anything ever fire it?** If completion requires a human step
   nobody performs, or a sweep whose predicate never becomes true, that is the finding.

## 4. Guardrails

- **Diagnosis only. No new producer, no new surface, no writes** beyond what a dry run needs.
  If the answer is "build X", **say so and stop** — X gets its own prompt with its own gate.
- **Report honest counts**: decidable vs blocked vs unanswerable, with the blocked reasons **named**
  rather than pooled. "815 open" is not a finding.
- **Retirement is a legitimate outcome.** If a large share cannot be answered from what we hold,
  the correct recommendation may be auto-retire with a re-open predicate — as A4 did for 74.
- **Do not touch** `property_missing_recorded_owner` (healthy at 908/30d — **leave it alone**) or
  `establish_ownership_history` (this arc's lane).
- `npm test` locally; branch → PR → both checks green → merge
  (`docs/os/GITHUB-WORKFLOW.md`), and expect the Update-branch gate.

## 5. Deliverables

- **The stall's cause, or an honest "cannot determine, here is what I ruled out."** Ruling things
  out is a real result; a guess dressed as a cause is not.
- The residue characterised: decidable / blocked / unanswerable, reasons named.
- The P131 category, stated explicitly.
- A recommendation with a **size** — how many tasks it would move, at what effort.
- A backlog row (`A5a`…) for whatever the recommendation turns out to be. **Do not build it here.**

## 6. Verify

There is no lane-drain to verify in a diagnosis prompt — and **that is deliberate.** The output is
knowledge. The verification is that the next prompt, built on it, moves
`count(*) filter (where status='completed')` for this lane above **596 + something**.

**⚠️ If you find yourself building a consumer in this prompt, stop and write the finding instead.**
Every build in this arc that worked was preceded by a measurement that changed the plan.
