# End-to-end data-process audit — where the operator's hands are actually required

**Measured 2026-08-26 (Cowork), live against LCC Opps `xengecqvemvfknjvbvrq`.**
Continues the thread opened by `W53_AND_OLLAMA_HYGIENE_KICKOFF.md`: *audit our data processes end
to end, and recommend where AI / automation — including the on-prem Ollama model — raises
productivity.*

> **Scope note.** This is the **data-process & automation** audit window. The parallel **app**
> audit (desktop) owns prompts 189 / 192 / 194 and the Tier 0 lane defects. A *finding* about a
> data process belongs here; a *code fix* to the app belongs there.

---

## 1. The headline

**~3,000 research tasks and 419 decisions are open. 983 of the tasks sit in lanes that have never
completed a single item — some for 68 days.**

The system is not short of automation. It is short of **consumption**: several producers are
healthy and their output has nowhere to land. This is the Consumption-Layer doctrine
(`CLAUDE.md`) measured across the whole surface rather than one lane at a time.

### Research tasks — by throughput, not by size

| lane | open | ever completed | skipped | oldest | verdict |
|---|---|---|---|---|---|
| `property_missing_recorded_owner` | 1,189 | **4,772** | 6,515 | 97d | ✅ working well |
| `true_owner_needs_salesforce` | 816 | **595** | 849 | 96d | ✅ working |
| `property_missing_true_owner` | 0 | 386 | 203 | 97d | ✅ **finished** |
| `trace_ownership_to_developer` | 18 | 40 | 1,400 | 82d | ✅ working |
| **`establish_ownership_history`** | **545** | **0** | 1,690 | 68d | 🔴 §2 — the big one |
| `owner_contact_manual` | 311 | **0** | 5 | 60d | 🔴 egress-blocked (known) |
| `npi_missing_inventory` | 62 | **0** | 141 | 20d | 🟡 69% unanswerable (P181) |
| `confirm_tenant_mismatch` | 26 | **0** | 0 | 64d | 🔴 no consumer |
| `npi_new_registration` | 17 | **0** | 0 | 20d | 🔴 no consumer |
| `state_lease_distress_review` | 8 | **0** | 0 | 21d | 🔴 no consumer |
| `person_email_merge_review` | 8 | **0** | 0 | 14d | 🔴 no consumer |
| `confirm_deed_transfer_sale` | 4 | **0** | 0 | 42d | 🔴 no consumer |

**Read the `skipped` column as good news** — the auto-retire sweeps are real and working
(6,515 + 1,690 + 1,400 closed without human touch). The problem is never that too much is
retired; it is the zero-completion column.

### Decision lanes — mostly healthy, four are not

Draining: `junk_entity_name` (1,332 decided, **88 in the last 7d**), `naming_hygiene_review` (454),
`owner_reconcile` (215), `junk_entity_review` (218), `property_twin` (174), `sf_link_candidate`
(102), `sf_link_collision` (84), `exact_name_merge` (62), `tier0_owner_contact` (**33 today** —
Scott working it).

Not draining:

| lane | open | ever decided | age | note |
|---|---|---|---|---|
| `confirm_true_owner` | **152** | 35 | 82d | 0 decided in 7 days — stalled, not dead |
| `milestone_confirm` | **56** | **0** | 21d | never once consumed |
| `match_disambiguation` | 14 | **1** | 81d | a ranked lane nobody works |
| `sf_link_conflict` / `sf_contact_account_mismatch` | 10 | **0** | 42–69d | small, silent |

## 2. ⭐ The single biggest productivity win: `establish_ownership_history` — the answers are
   already computed and nobody can act on them

**545 open tasks. 0 ever completed in 68 days. And 453 of them already have a finished,
deterministic, record-cited answer sitting in `lcc_clean_assist_proposals` (P131/P133).**

The drafts are not LLM guesses — they are built from `gov.ownership_history` with a **record
reference** as the citation, which cannot be hallucinated. Their confidence encodes *chain
quality*, and that turns out to split the lane into **three completely different actions that are
currently presented as one undifferentiated "go research this" queue:**

| bucket | n | what it actually is | correct action |
|---|---|---|---|
| **Agrees with the current owner** | **380** | the recorded chain ends at the owner we already hold. This is a **confirmation**, not a question. (337 gap-free @0.85–0.95; 43 with disclosed gaps @0.80) | **auto-apply** — write the historical links, no human |
| **⚠️ MISMATCH** | **73** | the last recorded grantee **≠** our current owner. Either our owner is wrong or the chain is incomplete. | **a data-integrity ALERT**, not a research task — highest value per item in the whole audit |
| **Nothing on file** | **92** | no recorded transfers exist in the government records | **auto-retire** with a terminal "Not on file" — it is not answerable from what we hold |

**Nobody has completed one in 68 days because every item looks identical from the outside.** A
lane that mixes "please confirm what you already believe" with "your ownership record is
contradicted" with "this is unanswerable" trains the operator to skip all three.

- The **73** exactly matches the "~73 current-owner-vs-deed mismatch flags" that backlog row V3
  predicted as *"a free data-integrity signal."* It is free, it is real, and it is buried.
- The **380** carry ~707 historical ownership links that the BD spine is missing — the lane exists
  precisely because `owner_links <= 1` in `lcc_entity_portfolio_facts`. Applying them is a genuine
  data enrichment, not a bookkeeping no-op.

**P131 lens:** this is category **(a)** — *the answer is already on-box and STRUCTURED*. It needs
**deterministic plumbing, not an LLM.** No model should be added anywhere in this path.

## 3. Ranked recommendations

Ordered by operator-time saved per unit of build effort. Every one satisfies the producer/consumer
rules (named consumer · value gate · auto-retire predicate · actionable-only surface · honest counts).

| # | Recommendation | Effort | Why it ranks here |
|---|---|---|---|
| **A1** | **Split `establish_ownership_history` into its three real actions** (agrees / mismatch / not-on-file) before automating anything. | S | Everything else in §2 depends on it. Cheap: the classifier is `confidence = 0` and the `does not match the current owner` predicate already in `reason`. |
| **A2** | **Auto-apply the 380 "agrees" chains** — write the historical owner links through the existing merge/provenance path, reversible by batch tag, dry-run first. | M | Removes 380 of 545 items from a human queue and adds ~707 missing ownership links. **Never through a new SQL writer that skips the shape gates.** |
| **A3** | **Route the 73 mismatches to a data-integrity lane**, value-ranked, with both readings on the card (our owner may be wrong OR the chain incomplete — do not presume). | S | The highest-value-per-item finding in this audit, and it is currently invisible. |
| **A4** | **Auto-retire the 92 "not on file"** with a terminal, dated state that re-opens if new records land. | S | Auto-retire doctrine. Stops 92 permanently-unanswerable items ageing into "overdue". |
| **A5** | **Give `milestone_confirm` (56) a consumer or retire it**; same question for `confirm_tenant_mismatch` (26), `npi_new_registration` (17), `state_lease_distress_review` (8), `person_email_merge_review` (8), `confirm_deed_transfer_sale` (4). | S each | 119 items across six lanes with **zero** lifetime completions. Per doctrine, a producer with no consumer should not have shipped; the honest fix is often retirement, not a surface. |
| **A6** | **Re-measure `confirm_true_owner` (152 open, 0 in 7d, 82d).** It decided 35 once, so it is *stalled*, not dead — a different diagnosis. | S | Find what stopped, per the "what advances the working set?" test. |
| **A7** | **Decide `match_disambiguation`'s fate.** It is a ranked lane with **1** lifetime decision. Either surface it or stop ranking it. | S | Ranking a queue nobody works is spend with no return. |

**Ollama-specific opportunities remain as ranked in `PLANNED-BACKLOG.md` P2 (L1–L10) and N4–N7** —
unchanged by this audit, with one caveat now measured: **do not reach for the model on A1–A4.**
The lane that looked like the best LLM candidate in the system turned out to be pure plumbing.

## 4. What this audit did NOT find

Recording the negatives, because they are what stop the next pass re-walking the same ground.

- **No evidence the assists are under-producing.** `ownership_chain_draft` 545, `w9_3_sf_assist`
  247, `ollama_clean_assist` 72 and climbing (45 → 63 → 72 across today). The two that read zero
  were **undeployed, not broken** (see the STATUS entry for the deploy-cutoff diagnosis).
- **No evidence the auto-retire sweeps are too aggressive** — 9,605 skipped across three lanes with
  healthy completion counts alongside.
- **No new LLM opportunity surfaced by this pass.** The biggest apparent one (§2) is deterministic.
  That is the P131 lens working as designed, for the third time.

## 5. Reproduction

```sql
-- research lanes by throughput (the zero-completed column is the finding)
select research_type,
 count(*) filter (where status in ('queued','in_progress')) open_,
 count(*) filter (where status='completed') ever_completed,
 count(*) filter (where status='skipped') skipped,
 (current_date - min(created_at)::date) oldest_days
from research_tasks group by 1 order by open_ desc;

-- decision lanes
select decision_type,
 count(*) filter (where status='open') open_,
 count(*) filter (where decided_at is not null) ever_decided,
 count(*) filter (where decided_at > now()-interval '7 days') decided_7d
from lcc_decisions group by 1 order by open_ desc;

-- the three-way split of the ownership-history lane
select case
   when confidence = 0 then 'a_no_records_on_file'
   when reason ilike '%does not match the current owner%' then 'c_MISMATCH_integrity_flag'
   else 'b_agrees_with_current_owner' end bucket,
 count(*) n, round(avg(confidence)::numeric,2) avg_conf
from lcc_clean_assist_proposals
where source='ownership_chain_draft' group by 1 order by 1;
```
