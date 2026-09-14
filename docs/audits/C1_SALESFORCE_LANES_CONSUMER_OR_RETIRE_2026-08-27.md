# C1 — the Salesforce lanes: the consumer already exists, on a different surface

**Diagnosis only. Nothing was built, nothing was written to any lane, table or Salesforce.**
Measured live 2026-08-27 against LCC Opps `xengecqvemvfknjvbvrq`, dia `zqzrriwuavgrquhisnoa`,
gov `scknotsqkcheojiaewwh`. Prior: `A5_TRUE_OWNER_SALESFORCE_STALL_2026-08-27.md` →
`A5a_AUTOCLOSE_TRUNCATION_FIX_2026-08-27.md` → `A5c_RESEARCH_TASK_VALUE_GATE_2026-08-27.md`.

> ## The one-line finding
>
> **A working consumer for these lanes has existed and been worked since June — it is the
> Decision Center lane `sf_link_candidate`.** It holds **3,369 owner↔SF-Account candidates**,
> every one carrying a resolved `001…` Account id, behind a verdict path that **PATCHes the exact
> column whose NULL-ness defines both research lanes** (`dia.true_owners.salesforce_id`,
> `gov.recorded_owners.sf_account_id`) — null-guarded, provenance-logged, reversible, with an
> active Ollama pre-rank (cron 213) and **59 human verdicts already recorded**.
>
> The research lanes ask the same question on a surface with **no candidate, no input field and
> no write**. They are not a queue without a consumer; they are a **second, capture-less copy of a
> queue that already has one**.
>
> **Recommendation: automate 27, retire 945, gate 1,702, repair 1,292 — build no consumer.**

---

## 1. What completing a task does today: nothing, and then it comes back

`ops.js::completeResearch(id)` posts `{ research_task_id: id }` and nothing else to
`/api/workflows?action=research_followup` → `_shared/research-loop.js::closeResearchLoop` →
`PATCH research_tasks` with `status='completed'`, `outcome={status:'completed',notes:null}`.
**No owner row, no entity, no identity and no Salesforce field is touched.**

Neither lane has a lane-specific action. `renderResearchPage` gates its two capture buttons on
`research_type === 'owner_contact_manual'` (P173) and `=== 'establish_ownership_history'` (P179);
everything else gets Complete / Follow-up / Dismiss / Assist / ChatGPT / Claude. **There is no
`<input>` on the card** — Dead-End playbook **Class 3** (*a surface that notifies but cannot
capture*), the same defect P173 and P179 each fixed for one lane and nobody generalised.

**And the completion does not stick.** `handleGenerateResearchTasks` builds its dedupe set from
`status=eq.queued` only. A task completed with the gap predicate still true is therefore re-minted
on the next tick — the A2 rule (*a task completed WITHOUT a fact would be re-seeded tomorrow*) with
the fact permanently unwritable. Measured churn, lifetime tasks per distinct subject:

| lane | tasks ever | distinct subjects | tasks per subject |
|---|---:|---:|---:|
| `property_missing_recorded_owner` | 12,585 | 2,602 | **4.84** |
| `true_owner_needs_salesforce` | 2,282 | 1,173 | **1.95** |
| `owner_needs_salesforce` (gov) | 108 | 108 | 1.00 (minted 2026-08-27) |

### 1a. The direction of every handler that touches this

| handler | direction | scheduled? | writes the gap column? |
|---|---|---|---|
| `_shared/research-loop.js` (Complete) | — | on click | **no** |
| `_handlers/sf-link-reconcile.js` | **domain → LCC** (mirrors an *existing* id onto the entity) | **no cron calls it** | no |
| `sf-link-assist-tick` (cron 213, active) | annotation only | yes | **structurally cannot** |
| **`sf_link_candidate` verdict (`api/admin.js`)** | **LCC → domain** | human | ✅ **yes — this is the writer** |

⚠️ **The one cron in the family is dead and points at a retired host.** `cron.job` 48
`lcc-sf-link-tick` is `active=false` and its command is
`lcc_cron_post('/api/sf-link-tick?...', '{}', 'vercel')` — the Vercel deployment retired
2026-07-20 and shown by **P194** to still answer. Do not re-enable it without reading P194.

## 2. Creating a Salesforce Account is out of scope twice — doctrine AND capability

Both lanes' instruction text is generated as *"**Link or create** Salesforce account for X"*
(`v_next_best_research`, both domains). The second half cannot be done:

- **Doctrine.** `CLAUDE.md`: *Salesforce is minimum-necessary and NOT cleaned by LCC — LCC is the
  source of truth and reconciles around SF's dups/errors (never writes back to clean SF).*
- **Capability, measured.** LCC's entire Salesforce surface is **read-only**. `_shared/salesforce.js`
  states it outright: *"Scott's Salesforce org requires SSO to authenticate and he does not have
  admin rights to register a Connected App for the Client Credentials OAuth flow"* — every SF touch
  is a Power Automate proxy exposing `find_account_by_name` / `find_contact_by_email` /
  record-lookup-by-Id. A repo-wide grep for `sobjects` / `/services/data/v` / a POST to Salesforce
  returns **nothing**. There is no create path and none can be built without an org-admin change.

**So a consumer that mass-creates Accounts is not a design choice that needs Scott's approval —
it is not currently buildable.** Half the lane's stated job has never been available.

## 3. The consumer that already exists — `sf_link_candidate`

Source: each domain's `v_sf_link_review_queue`. Lane config `api/admin.js:1195`
(*"Salesforce link — confirm candidate"*), cards at `:8859`, verdict at `:10764`.

| | rows | distinct subjects | carry a resolved `001…` SF Account |
|---|---:|---:|---:|
| dia `true_owners` | 382 | 382 | **382** |
| gov `recorded_owners` | 1,618 | 1,618 | **1,618** |
| gov `true_owners` | 1,369 | 1,369 | **1,369** |
| **total** | **3,369** | | **3,369** |

The `approve` / `switch` verdict PATCHes `true_owners.salesforce_id` (dia) /
`sf_account_id` (gov), guarded so a pre-existing *different* id raises a three-way conflict card
instead of an overwrite, writes `provenance_event_log`, writes an `entity_match_labels` row, and
the queue row self-retires. `research` spawns a task instead. It has been worked:

| decision | decided | skipped | open | newest |
|---|---:|---:|---:|---|
| `sf_link_candidate` | **59** | 43 | 2 | 2026-08-14 |
| `sf_link_collision` | 84 | — | 30 | 2026-08-27 |
| `sf_link_conflict` | — | — | 6 | 2026-08-17 |

**And it covers the research lanes' own subjects:**

| | DC candidates | of which the research lane also calls a gap |
|---|---:|---:|
| dia | 382 | **360** |
| gov (recorded_owners) | 1,618 | **1,347** |

So for **1,707 of the exact subjects** the research lanes present as unanswerable, a named
candidate SF Account is already sitting on a surface with a working write path — while the
research card offers a Complete button that writes nothing.

⚠️ **On the value-gated populations the coverage is thinner and must be quoted as such:** the DC
lane carries a candidate for **3 of dia's 27 admitted** and **176 of gov's 1,675 admitted** — 179
of 1,702, 11%. The rest have no candidate anywhere, which is the category (c) finding in §5.

## 4. ⚠️ Two key-space defects — the brief's headline gov number is a wrong-key artifact

### 4a. gov "0 of 108 resolve to an entity" is true, and it is not a coverage fact

The gov lane's `entity_id` is **`gov.unified_contacts.unified_id`** — a contacts-hub id.
`external_identities` indexes gov by exactly two source_types, `gov/true_owner` (8,919) and
`gov/asset` (3,422). **`unified_id` is an id space LCC has never indexed**, so the join returns 0
for structural reasons and would return 0 after any amount of entity minting. Same family as
P197 (*a detector that knows one key reports the other key's population as absent*).

Re-keyed correctly — `unified_id` → `recorded_owner_id` → the owner's properties → `true_owner_id`
→ `external_identities(gov, true_owner)` — **111 of 114 resolve to an LCC entity (97%)** and 11
carry an SF Account.

**⚠️ But that re-key is not the same party, and the 11 must not be used.** Comparing the recorded
owner's name to the true owner's name over the 120 pairs: **50 exact, 55 by
`gov_owner_strict_core`, 70 differ.** Read on named rows, the differences are the SPE↔sponsor
relation and, in several cases, an individual:

| recorded owner (what the lane asks about) | true owner (what the re-key lands on) |
|---|---|
| `ARCP GSPLTNY01, LLC` | **`Nicholas Schorsch`** |
| `INGOLD FAMILY INVESTMENTS LLC` | **`Robert Ingold`** |
| `PORTALS OWNER, LLC` | `Republic Properties Corp.` |
| `CH LH CROSSPOINT OWNER LLC` | `CrossHarbor Capital Partners` |
| `GERMANTOWN MD I FGF, LLC` | `FGF Management LLC or affiliated individuals` |
| `201 REGENCY REALTY, LLC` | `Susquehanna Holdings` |

Attaching the sponsor's (or a person's) Salesforce Account to a question asked about the SPE is
the **P188** failure in full — *the evidence answers a different question than the one being
asked* — and the A3 sponsor/SPE finding. **Restricted to the 55 name-agreeing pairs: 53 resolve
and 2 carry an SF Account.** So the corrected gov automation number is **2, not 0 and not 11.**

### 4b. ⚠️ The gov lane reads one column and the only writer writes another — 1,292 owners

The lane's predicate is `unified_contacts.sf_account_id IS NULL`. The `sf_link_candidate` verdict
writes `recorded_owners.sf_account_id`. They are different columns on different tables and
**nothing mirrors one to the other**:

| gov `recorded_owners` with an `sf_account_id` | 1,961 |
|---|---:|
| have a `unified_contacts` row | 1,407 |
| **that row is still NULL → the lane still reports a gap** | **1,292** |
| the two columns agree | **29** |

So a human who works the DC lane and successfully links a gov owner **does not clear the research
task** — it stays open forever and is re-minted. Of the **1,675 admitted** gov rows, **96
($314.7M) are already linked** and are phantom work; 1,579 ($3.70B) are genuinely unlinked.

**dia is not affected** — its lane reads `true_owners.salesforce_id`, the same column the verdict
writes. The asymmetry is worth stating because it is invisible from either side alone.

### 4c. ⚠️ dia's two "27"s are different sets — overlap 3

The value gate admits **27** dia owners. **27** open dia tasks resolve to an entity carrying an SF
Account. These look like the same finding and are not: **the overlap is 3.** Quoting either as
"the 27" would merge a value population with an automation population.

## 5. The three populations, sized, per lane

**dia `true_owner_needs_salesforce` — 837 open, gap pool 6,324, admitted 27 ($21.7M / 27 owners)**

| population | n | note |
|---|---:|---|
| **deterministically fillable now** (entity carries exactly one `001…` SF Account, ID-to-ID) | **27** | 0 tombstones, 0 operators, 0 multi-account; 6 own ≥1 property, 35 properties, **$5.59M** known rent |
| resolves to an entity, entity has no SF link | **689** | 716 resolve − 27 |
| **not in the entity graph at all** | **121** | no `external_identities(dia, true_owner)` row |

**gov `owner_needs_salesforce` — 108 open, gap pool 13,724, admitted 1,675 ($4.01B / 1,674 owners)**

| population | n | note |
|---|---:|---|
| **deterministically fillable now** | **2** | only via the name-agreeing re-key (§4a) |
| owner already linked, lane reads a stale mirror | **1,292** pool-wide / **96** admitted ($314.7M) | §4b — a repair, not research |
| resolves safely to an entity with no SF link | 51 of the 108 | (53 name-agreeing resolvers − 2) |
| **not resolvable in the lane's own key space** | **108 of 108** | `unified_id` is not indexed |

**Value is per OWNER throughout.** gov's 1,675 admitted rows are 1,674 distinct recorded owners;
dia's 27 are 27 distinct true owners. ⚠️ A5's *"293 resolve ID-to-ID"* is across the full
6,324-gap population and A5's *"963 real prospectable owners"* is a decidability figure with no
value floor — **neither is available work and neither should be quoted here.**

## 6. P131 category — (a) small, (b) ZERO, (c) dominant, for both lanes

| category | dia | gov | verdict |
|---|---:|---:|---|
| **(a) on-box and STRUCTURED** | **27** (+3 with a DC candidate) | **2** (+176 admitted with a DC candidate) | deterministic plumbing, no model |
| **(b) on-box but UNSTRUCTURED** | **0** | **0** | **no LLM** |
| **(c) not on-box at all** | ~810 open / 6,297 pool | ~106 open / 13,722 pool | a CRM lookup by a human, or acquisition |

**(b) is zero and that is a measurement, not an assumption:** a Salesforce Account id exists only
in Salesforce. There is no document, email, OM, deed or capture anywhere in the fleet that states
one, so a model pointed at this gap has nothing to read and would fabricate an 18-character id
that looks exactly like a real one. **This is the fourth time in this arc a top-ranked "LLM
opportunity" has measured as (a) plus (c).**

The one thing that *could* widen (a) is `find_account_by_name` — but that is name matching for
identity, banned by `CLAUDE.md`, and it is precisely what the dormant Dialysis-repo Python and the
splink `v_sf_link_review_queue` already do. Its correct output is a **candidate for a human**,
which is the DC lane that already exists.

## 7. Should the gov lane be minting? No — three reasons, any one sufficient

1. It is **66% of everything the fleet will mint** (1,675 of 2,530 admitted) into a lane with zero
   real completions and no capture path.
2. Its key is not resolvable (§4a) and its predicate reads the wrong column (§4b), so **96 of its
   admitted rows are already done**.
3. Its subjects are `unified_contacts` rows with **0 emails and 0 full names** across all 108 —
   they are owner shells in a contacts table, and the table is gov's **pre-cutover snapshot**
   (`CONTACTS_HUB='ops'`). ⚠️ A5c already refuted "the verdict is stale" by sampling the live hub;
   this is a separate point about what the rows *are*.

The precedent and the machinery both exist: `owner_needs_sos` is already gated `lane_no_consumer`
(16,873 gov + 7,204 dia), `gate_value` is still computed, and re-admitting is one predicate.

## 8. Recommendation — automate 27, retire 945, gate 1,702, repair 1,292

| # | action | size | why |
|---|---|---:|---|
| **C1a** | **Repair the gov mirror** — either repoint the lane predicate to `recorded_owners.sf_account_id`, or have the `sf_link_candidate` verdict write both. | **1,292** stale (96 admitted, **$314.7M**) | Cheapest, largest, and it is a correctness bug: the existing consumer's work is invisible to the lane. Do this **before** anything else — it changes both lanes' sizes. |
| **C1b** | **Gate both lanes `lane_no_consumer`** in `v_next_best_research`, exactly as `owner_needs_sos` is gated. | admitted **1,675 gov + 27 dia = 1,702** stop minting | The consumer is `sf_link_candidate`, a different surface. Keep `gate_value` computed so re-admitting is one predicate. |
| **C1c** | **Retire the 945 open tasks** (837 dia + 108 gov) with a re-open predicate, on the A4 pattern (`lcc_a4_retire_no_records` + `_reopen_tasks` + a `_watch` view). ⚠️ `status='skipped'` alone is **not** terminal to the seeder — stamp `outcome->>'terminal'='true'` or they re-mint at the next tick (P176). | **945** | A4's precedent: retirement with a sensor is the honest fix for an unanswerable lane. |
| **C1d** | **Automate the 27** as a **new unit of `_handlers/sf-link-reconcile.js`** (its Units 1–3 run domain→LCC; this is the missing LCC→domain unit), fill-blanks, resolved through `lcc_entity_survivor()`, reversible by batch tag. | **27** owners, 35 properties, **$5.59M** | The answer is already held by ID; this is plumbing. |
| **C1e** | Register `dia.true_owners.salesforce_id` in `field_source_priority`. | 1 row | gov has ladders for both its tables; **dia has none** — pre-existing `v_field_provenance_unranked` drift, and C1d would be an unranked writer without it. |

**⚠️ C1d must NOT be a new writer.** The `sf_link_candidate` verdict is the single owner of that
column and carries the null-guard, the provenance row, the `entity_match_labels` row and the
reversal. A standalone deterministic filler would be the second-writer/one-owner-per-transition
defect this file warns about a dozen times (P119, P194, N15c) — which is why it is **filed, not
built here**, despite the population being unambiguous.

**Nothing here recommends building a consumer.** The consumer exists; it has 3,369 candidates and
59 verdicts. If anything deserves the operator's attention it is **that** lane's backlog, ranked by
rent, with its Ollama pre-rank already running — not a second copy of it with no write path.

## 9. Verify

C1 is a diagnosis and has no drain. The gate for whatever acts on it:

```sql
-- real completions, never the auto-close
select research_type,
       count(*) filter (where status='completed' and outcome::text not ilike '%gap_resolved%')
  from research_tasks
 where research_type in ('true_owner_needs_salesforce','owner_needs_salesforce')
 group by 1;                                   -- today: 0 and 0
```

**If C1b + C1c are taken, that number correctly stays 0 and the lanes disappear instead** — the
open counts go to 0 and `gate_reason` reads `lane_no_consumer`. **That is the success condition,
not a failure to move the metric.** The number that must move if C1d ships is
`count(*) from dia.true_owners where salesforce_id is not null` (**822 → 849**), and the number
that must move if C1a ships is the gov admitted count (**1,675 → 1,579**).

## 10. Ruled out, so nobody re-walks them

- **"Mint entities for the gov lane so ID automation becomes possible"** — refuted. The lane's key
  is `unified_id`, which no amount of minting indexes; and the available re-key is a different
  party 70 of 120 times.
- **"Use the 11 gov entities that carry an SF Account"** — refuted on named rows (§4a). 9 of them
  are the sponsor or an individual, not the SPE the task asks about.
- **"An LLM can find the Salesforce id"** — refuted. Category (b) is zero; no corpus states one.
- **"Build a create-Account consumer"** — not buildable (§2): read-only PA proxy, no Connected App,
  no admin rights — before doctrine is even considered.
- **"`sf-link-reconcile.js` is the consumer"** — refuted; it runs domain→LCC and no cron calls it.
- **"A5's 293 / 963 are available work"** — different populations, different questions (§5).
