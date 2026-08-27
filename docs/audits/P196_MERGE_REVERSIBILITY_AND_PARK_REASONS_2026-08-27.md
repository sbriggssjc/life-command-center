> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)** — live state, the objects, the decisions already made, and the traps paid for. **This file is the EVIDENCE for one round; read the canonical page first to find out whether you need this one.**

# P196 — making the shared merge path reversible (N11), and saying why a Tier 0 card is parked (N3e)

Two units. The first is safety debt P195 created and worked around; the second is the correction of
a backlog row that was filed wrong.

| | before | after |
|---|---|---|
| `lcc_merge_entity` snapshots the loser side | **no** | **yes, unconditionally** |
| `lcc_reconcile_tombstone_backrefs` called with | `p_snapshot => false` | **`true`** |
| the loser's `owner_contact_pivot` on a merge | **DELETED, no ledger** | **folded fill-blanks, then deleted with a ledger** |
| a merge can be reversed | **never** | **`lcc_unmerge_entity(loser)`, round-trip proven on live data** |
| parked Tier 0 cards carrying a reason | **0 of 146** | **146 of 146** |
| sponsor-shaped parks with a route out | **none** | **6 proposals, value-ranked, human-confirm** |
| `auto_mergeable` | 3,053 | **3,053 (untouched)** |
| decidability distribution | ask 77 / auto 9 / parked 146 | **ask 77 / auto 9 / parked 146 (unchanged)** |

---

# Unit 1 — `lcc_merge_entity` had no undo

## 1. ⚠️ THE URGENCY IN THE BACKLOG WAS RIGHT ABOUT THE LOOP AND WRONG ABOUT THE FUNCTION

N11 measured that nothing calls `lcc_apply_fuzzy_merges` — re-confirmed here: a `cron.job` scan for
`fuzzy` / `apply_fuzzy` / `merge_entity` returns **0 rows**, and the only repo reference outside
migrations is a comment. That is true, and it is the right disposition for the *auto-merge loop*.

But `lcc_merge_entity` itself is not dormant. **Nine human-verdict call sites in `api/` drive it**
(`admin.js` × 6, `entities-handler.js`, `owner-reconcile-engine.js`), and the entity table says they
fire: **285 entities carry a `merged_into_entity_id` set in the last 30 days, 176 in the last 7.**
The irreversible pivot delete has been running the whole time. "Dormant, not armed" describes the
3,053-group loop; it does not describe the function, and reading the two as one is how a live path
gets filed as latent.

## 2. ⚠️ ONE CORRECTION TO THE FILED DEFECT: "UNCORRELATED" IS NOT THE BUG

P195 called the pivot dedup predicate uncorrelated:

```sql
delete from owner_contact_pivot l
 where l.entity_id = p_loser
   and exists (select 1 from owner_contact_pivot w where w.entity_id = v_winner);
```

Measured: `owner_contact_pivot`'s PRIMARY KEY is `(entity_id)`, and so is `lcc_property_owner`'s. At
most one row exists per entity, so the un-correlated `EXISTS` is *equivalent* to a correlated one and
correlating it changes nothing. **The bug is that the statement DELETES content instead of FOLDING
it, with no ledger.** That distinction matters because "correlate the EXISTS" is a one-line change
that would have looked like a fix and moved nothing.

## 3. ⚠️ FLIPPING `p_snapshot` ALONE WOULD HAVE LEFT THE WORST PATH EXACTLY AS IT WAS

`lcc_reconcile_tombstone_backrefs` already supported `p_snapshot`, and it covers portfolio facts,
external identities, relationships, watchers and cadence. It does **not** cover the four backrefs the
**P160 block inside `lcc_merge_entity`** handles — `lcc_property_owner`, `lcc_property_owner_evidence`,
`owner_contact_pivot`, `bd_opportunities` — because those statements live in the caller, not the
reconcile, and neither function snapshotted them in any mode.

So the prescribed one-line fix (`p_snapshot => true`) would have made four tables recoverable and
left the pivot — the one P195 proved destroys real contacts — untouched. Every P160 dedup DELETE and
repoint now writes its own action-labelled backup row **before** it runs
(`p196_po_dedup_delete`, `p196_po_repoint_entity`, `p196_po_repoint_owner`, `p196_ev_dedup_delete`,
`p196_pivot_dedup_delete`, `p196_pivot_repoint`, `p196_bd_repoint`). Knowing *which* of delete or
repoint happened is what makes the reversal exact rather than approximate.

The reconcile's own snapshot rows land with `note IS NULL`; the merge stamps them with its
per-merge tag afterwards (`id > <high-water mark> AND tombstone_id = loser AND note IS NULL`) rather
than changing a signature that has three callers.

## 4. ⚠️ THE ROUND TRIP CAUGHT A BUG REVIEW DID NOT — WHICH IS THE WHOLE POINT

The first cut restored `entity_relationships` / `external_identities` / `watchers` with
`INSERT ... ON CONFLICT (id) DO UPDATE`. Both tables carry a **BEFORE INSERT** survivor-resolving
trigger (P177/P178), and **P177's SKIPS a row that duplicates an edge the resolved entity already
holds** — it returns `NULL`, so the row never reaches the `ON CONFLICT` clause and the `DO UPDATE`
never runs.

Live on `Monaco Holdings`: three **byte-identical** `(loser → 4f1b724a, 'purchases')` edges. Edge 1
restored. Edges 2 and 3 were then duplicates of edge 1, were silently skipped, and stayed on the
**winner** — while `lcc_unmerge_entity` returned `restored`. Nothing errored.

Fix: repoint rows that still EXIST with an `UPDATE` (both triggers are BEFORE INSERT only, so an
UPDATE bypasses them) and `INSERT` only the rows the merge actually DELETED. And because a deleted
duplicate can still be refused by the trigger, the unmerge now **counts what came back** and returns
`restored_with_residue:relationships_not_restored=N` rather than passing a partial restore as clean.

**A reversal path that has never been RUN is a claim, not a capability** — P195 learned that on
`428C9 is_current is GENERATED ALWAYS`; this is the same lesson arriving through a different door,
and neither instance was findable by reading the code.

## 5. Verified live, before it was called done

- **Real round trip** on `Monaco Holdings` (`77a2e107`) → `Monaco Holdings LLC` (`69ed8a49`), an
  `auto_mergeable` byte-name duplicate. The merge dedup-DELETED a portfolio fact (`dia:26141`) and
  the loser's pivot, and repointed 3 relationships, 1 external identity and 1
  `lcc_property_owner.owner_entity_id`. `lcc_unmerge_entity` restored 10 rows. Full-row diff across
  entities / portfolio facts / identities / relationships / pivot / property-owner / evidence /
  cadence / opportunities / watchers for BOTH entities: **16 rows before, 16 after, 0 lost, 0 new.**
  `auto_mergeable` **3,053 → 3,053**.
  *(`updated_at` is excluded from the diff — both the merge and the unmerge touch it. Content is
  restored; the timestamp is not rewound.)*
- **The FOLD path**, which Monaco could not exercise (both its pivots were blank), proven by a
  self-rolling-back synthetic gate: winner names nobody, loser names *"Alex Bias Test"* with
  `active_source='tier0_confirm'`. After the merge the winner holds the contact, `active_source` is
  **still `tier0_confirm`** (carried VERBATIM — a new value there is the P194 `<>`-exclusion trap)
  and `pivot_history[0].source='entity_merge_fold'`. After the unmerge the winner is blank again on
  `worklist_sweep` and the loser holds its contact. **0 residue.**
- **The pre-P196 backlog, stated rather than hidden:** `v_lcc_entity_merge_reversibility` reports
  **2,411 existing tombstones, `reversible = false` for every one.** Those merges have no snapshot
  and never will. The view exists so that stays visible instead of being assumed away.

## 6. Not done, deliberately

**Nothing wires up `lcc_apply_fuzzy_merges`.** Whether 3,053 groups should ever auto-merge unattended
is a decision, not a consequence of making the path reversible — and P195's own §1 is the argument
against it: `v_lcc_merge_candidates`'s byte-identical population contained 4 groups where a name
match is *weakest*, and only reading the named rows separated them. Reversibility lowers the cost of
being wrong; it does not make the grading unnecessary. `auto_mergeable` is untouched at 3,053.

Guard: `test/merge-entity-reversible.test.mjs` (10 tests), mutation-verified RED on each of
(a) reintroducing `ON CONFLICT (id) DO UPDATE`, (b) moving the fold after the pivot DELETE, and
(c) reverting `p_snapshot` to `false`.

---

# Unit 2 — say WHY a card is parked, and route the sponsor-shaped ones

## 7. N3e as filed was wrong, and the corrections are the useful part

Re-measured 2026-08-27 over `v_lcc_tier0_owner_contact_lane_triage`:

| park_reason | cards | owners | rent |
|---|---:|---:|---:|
| `employer_on_file_differs` | 76 | 67 | **$96.3M** |
| `no_employer_on_file` | 68 | 56 | $132.3M |
| `employer_not_comparable` | 2 | 2 | $1.9M |
| **total parked** | **146** | **105** | **$180.3M** |

The `$98M / 75 owners` in N3e is the **`differs` slice specifically** ($96.3M / 67 owners today,
after the merges that landed since), not the whole parked pile. Those cards are not stuck by
accident: a candidate's stated employer is on file and it is not this owner. That is the gate
working. What was missing is that **the operator could not see it** — parked cards never reach the
Decision Center, because `_open` serves only `ask` and `auto`.

`employer_not_comparable` is kept as its own reason rather than folded into `differs`: the
comparator has a 6-character floor on **both** sides, so for those 2 cards it could not run at all.
"It could not run" and "it ran and disagreed" are different facts, and one bucket hides the first —
the same shape as P181's single `low_confidence` label covering two different questions.

## 8. ⚠️ ONE OF THE TWO PRESCRIBED FIXES WAS IMPLEMENTED, MEASURED, AND REJECTED

"Normalise the company string before comparing (strip `www`, `com`, punctuation)" unparks **0 of 146
cards**. The motivating row does not survive its own fix:

```
Savlan Cc Property LLC      → owner core   savlanccproperty
"WWW Savlancapital COM"     → raw core     wwwsavlancapitalcom
                            → normalised   savlancapital
```

Containment still fails, and the 8-character prefix arm compares `savlancc` against `savlanca`.
**The mismatch is at character 8, not in the www/com noise.** The comparator is therefore NOT changed
— a change that moves nothing is not free, it is a new arm nobody has graded. Savlan is a
*sponsor-shaped* park and is routed as one below, which is where it always belonged.

## 9. ⚠️ AND THE MEASUREMENT BEHIND N3e WAS READ OFF THE WRONG JSON KEY

N3e's own note records it: the first figure said *"100% of parked candidates are missing an
employer"*, read from `contact_company`. The card's `people[]` element carries the employer as
**`company`**. Corrected: **107 of 201 eligible parked candidates (53.2%) DO carry one**. Worth
restating because the correction only happened when the number contradicted a direct
`unified_contacts` join — playbook Class 11, *the zero is the instrument*. When two measurements of
the same thing disagree, check the key names before believing either.

## 10. ⚠️ THE SPONSOR DETECTOR'S PRECISION IS MEASURED, AND THE NAIVE VERSION IS A NOISE GENERATOR

Leading-brand-token equality alone over the parked population returns **19 pairs at roughly 25%
precision** — the same number P189 measured and rejected for domain-keyed merge grouping. The false
positives are not random; they are two named classes:

- **shared GIVEN NAMES** — `George Kurz` ← *George's Inc* (this is P188's Gary George trap in a new
  dress), `Steve Blumer` ← *Steve Eustis Co*, and two `JAMES` trusts ← *James & Margaret Howard
  Trust* at `jameshowardcpa.com`, which is the shared-CPA grouping P189 already named;
- **PLACE / NATURE words** — `MAPLE HILL LLC` ← *Mapletree Investments* (a Singapore REIT),
  `Steel Station Rd, LLC` ← *Steel Equities*, `Carmel Crossings LLC` ← *Carmel Partners*.

Three guards, each earned against a named row: the owner must carry a **portfolio/SPE marker**
(`property|properties|holdings|owner|propco|holdco|fund`), must not read as a **street**, and must
not be **person-shaped**; a brokerage company is excluded on principle.

Result: **6 proposals, of which 4 read as genuine, and the 4 are the top 4 by rent.**

| proposed token @ domain | SPE | employer on file | rent | reads |
|---|---|---|---:|---|
| `gardner@gardnercompanies.com` | Gardner Tanenbaum Holdings | Gardner Companies | $7.99M | ✅ |
| `salus@salusgroup.us` | Salus Gov't Properties | Salus Healthcare Real Estate Group LLC | $5.28M | ✅ |
| `oxford@oxforddevelopment.com` | OXFORD BIT GALLERY PLACE PROPERTY OWNER, LLC | Oxford Development Company | $2.46M | ✅ |
| `savlan@savlancapital.com` | Savlan Cc Property LLC | WWW Savlancapital COM | $1.99M | ✅ |
| `royal@royalamerican.com` | Royal Blue LLC Smsh LLC Jaesun Properties LLC | Royal American | $1.26M | ❌ |
| `maple@maplestmanagement.com` | Maple Tree Place Owner LLC | Maple St Management | $0.84M | ❌ |

The view is **value-ranked**, so the operator meets the reliable end first — the same shape as the
Tier 0 rent-band precision curve, and the reason a 67% detector is usable at all.

**Stated gaps, not patched:** `lcc_looks_like_person` calls `Genesis Kc Dev` a person, so a plausible
proposal is dropped — a false negative costs one missed card, a false positive writes a stranger's
firm onto an SPE family. And `lcc_owner_name_is_brokerage` does not catch *Wilson Kibler Commercial
Real Estate*, which the SPE-marker guard happens to drop for a different reason.

## 11. ⚠️ THE DECIDABILITY CASE IS NOT WIDENED, AND THAT IS THE POINT

Nothing here changes what is `ask`, `auto` or `parked_domain_only` — verified: **ask 77 / auto 9 /
parked 146 before and after**. Admitting person evidence to un-park is the tempting fix and it was
already measured and rejected in P188/P192: Gary George at `georgesinc.com`, a poultry company,
passes three of the four person signals for George Washington University. The guard
(`test/tier0-park-reasons.test.mjs`) fails RED if `n_person_evidence` ever appears in that CASE.

The classifier is a **SQL CASE, and the only one** — `park_reason` is computed in the view and
rendered by the handler, never re-derived in JS (the A1 rule: a JS mirror of a SQL classifier is the
normaliser drift this repo has recorded a dozen times). The guard also fails RED on any `ilike` in
the classifier, because a text detector over generated prose agrees with the boolean today and is
structurally wrong tomorrow (P182).

## 12. What the operator gets, and how to confirm a sponsor

`GET /api/tier0-auto-attach-tick` — already the ungated dry-run grade for the auto set — now also
returns the parked half:

```json
"parked": { "cards": 146, "by_reason": { "employer_on_file_differs": {"cards":76,"owners":67,"rent":96301092}, … },
            "examples": [ { "owner_name":"OXFORD BIT GALLERY PLACE PROPERTY OWNER, LLC",
                            "park_reason":"employer_on_file_differs",
                            "employer_on_file":"Oxford Development Company",
                            "sponsor_shaped": true }, … ] },
"sponsor_map_proposals": [ … ]
```

Confirming a proposal is the existing curated INSERT — the same way the 4 live
`lcc_owner_sponsor_domain` rows were created, and the same decision still pending for
`fcp→fcpdc.com` and `tmg→tmgdc.com`:

```sql
insert into public.lcc_owner_sponsor_domain(sponsor_token, email_domain, confirmed_by, notes)
values ('oxford', 'oxforddevelopment.com', 'scott', 'P196 sponsor proposal — SPE names the sponsor');
```

That moves every SPE in the family to `match_strength='curated_sponsor'`, i.e.
`decidability='ask'` — **one decision covering a family, not N per-SPE questions.** Nothing in this
unit writes.

## 13. Verify by

**Owners moved out of parked, never cards touched.** Today: 105 parked owners / $180.3M, of which 4
sponsor proposals cover 4 owners / $17.7M that a single confirm each would move to `ask`. The
detector's precision is measured on named rows, not on a rate — re-read the 6 before confirming any
of them.
