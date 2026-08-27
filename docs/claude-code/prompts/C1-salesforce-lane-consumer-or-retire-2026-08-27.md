# Prompt C1 — the Salesforce lanes have no consumer. Decide what one would even do.

> **Automation/data-process audit window.**
> **Read first:** `docs/audits/A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md`,
> `A5c_RESEARCH_TASK_VALUE_GATE_2026-08-27.md`, `PLANNED-BACKLOG.md` **P1a**, and the
> **Consumption-Layer doctrine** in `CLAUDE.md`.
>
> ⚠️ **DIAGNOSIS FIRST. Do not build a consumer until §2 is answered** — the obvious plan is already
> refuted by measurement below.

---

## 1. Where this stands

A5a made the research-task producer **correct**; A5c made it **selective** (71,448 → 2,530
admitted). **Neither gave it a consumer**, and:

| lane | open | **real completions ever** |
|---|---:|---:|
| `property_missing_recorded_owner` | 1,289 | **0** |
| `true_owner_needs_salesforce` (dia) | 837 | **0** |
| `owner_needs_salesforce` (gov) | 108 → 1,675 admitted | **0** |
| `property_missing_county_record` (dia) | 109 | **0** |

*(real = `outcome NOT ILIKE '%gap_resolved%'`; the auto-close is not throughput.)*

**Every lane this producer feeds has never completed a single item.** We now have a correct,
value-gated pipeline into a void. **A producer with no consumer should not have shipped** — so the
honest options are *build the consumer* or *retire the lane*, and this prompt decides which.

## 2. ⚠️ The obvious plan is already refuted — measured 2026-08-27

The plan implied by A5 was *"automate the 293 that resolve ID-to-ID, route or retire the rest."*
**Measured against the OPEN QUEUE, that is not available:**

| lane | open | resolves to an LCC entity | **entity already has a `salesforce` identity** |
|---|---:|---:|---:|
| dia `true_owner_needs_salesforce` | 837 | **716 (86%)** | **27** |
| gov `owner_needs_salesforce` | 108 | **0** | **0** |

**A5's 293 is across the full 6,324-gap population, not the open queue.** Both figures are correct
and they answer different questions — **do not quote 293 as available work.** In the queue it is
**27**, i.e. **3%**.

**Two consequences you must design around:**

1. **The gov lane has NO entity linkage at all — 0 of 108.** Those owners are not in
   `external_identities`, so **no ID-based automation can touch them**, now or after more minting.
   This is the *owner* form of the documented "asset-identity coverage is what gates owner
   resolution" problem. **1,675 gov rows are admitted behind that.**
2. **86% of dia rows DO resolve to an entity — but the entity has no Salesforce link either.** So
   the gap is real and it is **outside our systems**, not a join we forgot.

## 3. What to establish

1. **What would completing one task actually DO?** Read the task, the lane's definition, and any
   handler. Does completion write `salesforce_id`, create an SF Account, or merely mark a human
   step done? **If nothing in the system consumes the answer, that is the finding.**
   ⚠️ A5 found `sf-link-reconcile.js` runs the *other direction* (it mirrors an existing
   `salesforce_id` onto the LCC entity) — **read a handler's direction before counting it as a
   consumer.**
2. **Is creating a Salesforce Account even in scope?** `CLAUDE.md`: *Salesforce is
   minimum-necessary and NOT cleaned by LCC; LCC reconciles around SF's duplicates and never writes
   back to clean SF.* **A consumer that mass-creates SF Accounts may violate standing doctrine —
   check before designing one.**
3. **Size the three populations honestly:** deterministically fillable now (27) · resolvable to an
   entity but with no SF link (689) · not in the entity graph at all (108 gov + the dia residue).
4. **P131 category, stated explicitly.** A5 called the dia sibling **(a) + (c) with (b) empty**.
   Confirm or refute for both lanes. **If (c) dominates, an LLM has nothing to read and would
   fabricate** — say so plainly rather than proposing one.
5. **Should the gov lane be minting at all right now?** It is 66% of everything the fleet will mint
   and has zero entity coverage. **Gating it off until entities exist is a legitimate
   recommendation** — the value gate already records `lane_no_consumer` for `owner_needs_sos`, so
   there is precedent and machinery.

## 4. The outcome may well be RETIREMENT, and that is a success

A4 retired 74 unanswerable tasks with a re-open predicate and that was the correct result. If these
lanes cannot be consumed from what we hold:

- **Recommend retiring or gating them**, with a re-open predicate that fires when the missing
  precondition appears (an entity link, an SF account).
- **Do not build a surface for work nobody can complete** — that is the failure this whole arc has
  been unwinding.

**A recommendation of "retire two lanes and automate 27" is a better outcome than a consumer nobody
uses.**

## 5. Guardrails

- **Diagnosis and recommendation. Build only the deterministic fill if it is unambiguous** — and if
  you build it, it must be fill-blanks, reversible, and resolve through `lcc_entity_survivor()`.
- **No LLM anywhere** unless you demonstrate a (b) population exists. Three times in this arc the
  top-ranked "LLM opportunity" measured as (a) or (c).
- **Do not mass-create Salesforce records** without Scott's explicit approval — see §3.2.
- **Do not touch** `establish_ownership_history` (314 real completions, different generator) or the
  A5 backlog rows (A5d–A5h).
- `npm test` locally; branch → PR → both checks green → merge (`docs/os/GITHUB-WORKFLOW.md`);
  expect the Update-branch gate.

## 6. Deliverables

- **What completing a task does today** — the direction of every handler you find.
- The three populations sized, per lane, per domain.
- The P131 category, with evidence.
- **A recommendation with a number attached**: automate N, retire M, gate the rest — or, if a real
  consumer is warranted, what it consumes and who acts on it.
- Backlog rows for whatever is deferred. **Do not build a consumer in this prompt.**

## 7. Verify

There is no drain to verify in a diagnosis. **The test of this prompt is whether the next one moves
`count(*) filter (where status='completed' and outcome NOT ILIKE '%gap_resolved%')` above zero for
any lane here — or whether it correctly concludes that nothing should.**
