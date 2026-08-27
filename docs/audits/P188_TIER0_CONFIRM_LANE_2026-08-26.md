> **📍 CANONICAL REFERENCE: [`docs/architecture/tier0-owner-contact-system.md`](../architecture/tier0-owner-contact-system.md)** — live state, the objects, the decisions already made, and the traps paid for. **This file is the EVIDENCE for one round; read the canonical page first to find out whether you need this one.**

# P188 — the Tier 0 confirm lane: the bench becomes calls

> **Status:** BUILT and live in the data layer. The views + the ledger table are applied to LCC Opps
> (`xengecqvemvfknjvbvrq`); the lane, the planner and the card ship on the next Railway redeploy of
> merged `main`.
>
> **Nothing has been written to `owner_contact_pivot` yet, and that is still correct.** The first
> write happens when Scott clicks Attach on a card. This build is the click.
>
> Reads first: `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`,
> `docs/architecture/account-based-contact-intelligence.md`.

---

## What shipped

| artifact | what it is |
|---|---|
| `supabase/migrations/20260827020000_lcc_p188_tier0_confirm_lane_views.sql` | `match_arm`/`match_key` appended to the candidates view; `v_lcc_tier0_owner_contact_lane` (+`_open`); `lcc_tier0_confirm_log` |
| `api/_shared/tier0-confirm-planner.js` | PURE. Card assembly, shape gate, duplicate-person collapse, rent bands, verdict gate |
| `api/admin.js` | `tier0_owner_contact` federated lane: source, subject_ref, badge, and the attach/reject/research write path |
| `ops.js` / `dc-lanes.js` / `review-shared.js` | Decision Center registration + the card renderer with the person picker |
| `test/tier0-confirm-planner.test.mjs` | 29 named-row gates |

**Live counts, 2026-08-26:** 558 pairs → **283 cards** → **237 actionable** (owner not already
reachable AND ≥1 eligible person) across **171 owners**, **434 eligible people**, **$695M** of
distinct-owner annual rent. 6 candidates excluded (5 broker-role, 1 non-person name).

---

## 1. The unit of judgement is (owner, DOMAIN), not (owner, person)

RMR Group carries **19 people at `rmrgroup.com`**. "Do the people at rmrgroup.com work for RMR?" is
ONE judgement. Asking it nineteen times is the badge-that-is-noise failure this repo keeps
documenting, and it buries the second decision — *which* human to call — under nineteen identical
cards.

So the card is one (owner, domain) with a person picker. 558 pairs collapse to 283 cards.

**And the split is real, not cosmetic.** RMR also has `rob@rmrgroupinc.com` — a DIFFERENT domain and
therefore a genuinely different question. Grouping per OWNER would have folded it in silently;
grouping per (owner, domain) puts it on its own card, and `subject_ref` is
`t0:<owner_id>:<domain>` so rejecting one leaves the other open.

---

## 2. ⭐ The evidence had to be split in two, because it answers two different questions

This is P186 §5's structural finding, and it is the single most important thing encoded here.

| class | signals | what it proves |
|---|---|---|
| **PERSON evidence** | Salesforce campaign membership · a Salesforce contact record · Outlook address book · real correspondence · company name matches the email domain | this person is **real and known to us** |
| **LINK evidence** | the contact's stated `company_name` matches **THIS OWNER** | this person **works for this owner** |

Only the second corroborates the decision being made. The card counts them separately, labels the
person-only case with an explicit caveat, and leads with the honest headline.

**Live proof, straight off the built card:**

```
--- George Washington University → georgesinc.com
  matched on      : george (token)
  link/person ev  : 0 / 1
  headline        : No candidate's employer is on file as this owner —
                    the match is the email domain alone.
   · Gary George  gary.george@georgesinc.com  attests=person_only
     | This evidence shows the person is real and known to us.
       It does NOT show they work for this owner.

--- Boyd Watterson Asset Management, LLC → boydwatterson.com
  matched on      : boydwatt (core8)
  link/person ev  : 2 / 2
  headline        : A candidate's stated employer matches this owner.
   · Eric Dowling   edowling@boydwatterson.com  attests=link_and_person
   · Joseph Capra   jcapra@boydwatterson.com    attests=link_and_person
```

Gary George works at George's Inc, a poultry company. He carries Salesforce campaign membership
("SAB Medical Developer"), a Salesforce contact record, AND a company name that corroborates his own
domain — three green signals, none of which says anything about George Washington University. That
is the row P187 recorded as unfixable by any fan-out gate (`george` has fan-out 1), and it is now a
one-click reject rather than an invisible landmine.

### ⚠️ The two company-name tests are DIFFERENT CLAIMS and were nearly one flag

P186 §5 measured "the contact's `company_name` corroborates the token" as a single signal, and
reported that Gary George passes it. He does — but only against his *own domain*. Split apart and
measured over the 558 pairs:

| test | pairs | Gary George |
|---|---|---|
| `company_confirms_employer` (company core ↔ email domain) | 164 | **true** |
| `company_matches_owner` (company core ↔ owner core) | 99 | **false** |

Collapsing these into one "company corroborates" flag is precisely how that row came back green.

**The containment test alone was not enough, and a named row proved it.** "Easterly Partners" does
not contain and is not contained by "Easterly Gov Properties" — so `company_matches_owner` needed a
shared-8-character-opening arm (`easterly` = `easterly`). George's core is `georges`, seven
characters, so it never reaches that arm. Verified on named rows before shipping, not on a rate.

---

## 3. Precision is a curve, and the measured part of it is SHORTER than "top 45" sounds

P187 reported ~91% on "the top 45 pairs by rent" and ~60–70% in the "~$2M SPE band". Measured what
those anchors actually mean:

| rank by rent | owner rent |
|---|---|
| 45th pair | **$16,383,565** |
| 100th | $5,781,648 |
| 200th | $1,969,946 |

So **the ~91% claim reaches roughly $16M and no further.** Everything from $16M down to $2M has
never been graded by anyone. The planner's `rentBand()` says so out loud:

| band | cards | owners | rent | precision |
|---|---|---|---|---|
| `measured_high` (≥ $16M) | **10** | 7 | $521M | ~91%, directly graded |
| `unmeasured_mid` ($2M–$16M) | 55 | 39 | $252M | **`null` — never graded** |
| `measured_low` (< $2M) | 172 | 125 | $161M | ~60–70%, directly graded |

The mid band deliberately carries **no number**. Interpolating one would be exactly the "quote a
precision figure without its rent band" mistake P187 warned about. The lane is value-ranked so the
operator meets the reliable end first; the card prints its band and its note.

---

## 4. Why the match key is on the card

The view has always known *why* it proposed each pair — which token, or which 8-character core
prefix — and threw it away. It is appended now (`match_arm`, `match_key`) and rendered:
**"Matched on `george` (token)"**. For a lane whose entire job is judging *does this person work for
THIS owner*, the matching key is the evidence, and it is the fact that makes georgesinc.com an
obvious reject in one second instead of a research task.

Equivalence: `EXCEPT ALL` both directions against a same-session snapshot of the pre-change view —
**0 rows**. (Snapshot dropped afterwards; a stale baseline left lying around is the P176 shelf-life
trap.)

---

## 5. ⚠️ P187's fan-out gate re-introduced the exact cross product P186 removed

Not the point of this prompt, found while profiling the new lane, and worth its own note.

P186's whole fix was that `people JOIN owner_tok ON EXISTS(unnest(toks) WHERE sld LIKE tok||'%')`
has no join key, so the planner emits a Nested Loop with a Join Filter over the full cross product.
It hoisted that into a prefix-expansion equality join: 58.7 s → 0.47 s.

P187 then added the fan-out gate, written the obvious way:

```sql
tok_fan as (
  select ot.tok, count(distinct p.sld), count(distinct ot.owner_id)
  from owner_tok ot join people p on p.sld like ot.tok||'%'   -- ← the same un-keyed cross product
  group by ot.tok)
```

Measured on the live plan: **`Rows Removed by Join Filter: 6,222,095`**, 1.78 s of a 3.10 s view.
Fixing the JOIN and leaving the GATE on a cross product is the same defect wearing a different hat,
and it was invisible because the gate returns only 160 rows.

The rewrite is P186's own identity reused verbatim — for a token of length ≥ 5,
`sld LIKE tok||'%'` ⇔ `left(sld, length(tok)) = tok`, i.e. exactly the rows `person_prefix` already
materialises.

| | before | after |
|---|---|---|
| `v_lcc_tier0_owner_contact_lane_open`, real consumer shape | **3,099 ms** | **1,263 ms** |
| rows removed by join filter | 6,222,095 | **0** |
| `tok_fan` node | 1,777 ms | 135 ms |

Equivalence on the pair set (`owner_id, person_id, match_arm, match_key`): **0 rows both
directions**.

> ⚠️ **A full-row diff during the same window showed ONE row differing** — Thomas Finan's
> `contact_company` read `Trammell Crow Co` in the snapshot and `Trammell Crow Company` live. That
> was the Outlook contact sync writing at 21:05:13, between the snapshot and the diff — not the
> change. Confirmed by reading `unified_contacts.last_synced_outlook` directly rather than
> assuming. **A live-data equivalence diff has to survive live data**: diff the columns your change
> can actually affect, and read the row before you accept a one-row delta as a regression.

**Durable rule: a gate that filters a join is part of that join. Fix both or neither.**

---

## 6. The shape gate — four names survived every shared guard

The SQL lane view applies the two HOUSE guards (`lcc_is_rejected_contact_name`,
`lcc_looks_like_person`) plus the broker `role_bucket`; the JS planner adds the shared name-shape
gate (`isPersonShaped`, `isJunkEntityName`, `isMisparseName`); the verdict path re-runs all of it
before writing. Measured over the bench's 430 distinct person names, the shared guards catch
`Equity Funds`, `Managing Partner` and `Public`. **Four got through all of them:**

| name | what it is |
|---|---|
| `Tenants In Common` | a legal ownership FORM captured as a person entity |
| `Inco Commercial` | a firm — `Inco` is not `\binc\b`, so no org marker fires |
| `Stephen Block Deceased` | a real person, and never a prospect |
| `Authorized Signer` | a role label (P186 recorded it in the bench) |

> **Why not `owner-contact-verdict-planner.js::validateVerdict` itself?** Its verdict vocabulary is
> `attach_person` / `same_party` / `reject` over a candidate that may be an ORG name variant of the
> owner. Tier 0 candidates are already `entity_type='person'` rows and the verdicts are
> `attach`/`reject`/`research`, so the SHAPE PRIMITIVES are reused (`isPersonShaped`,
> `hasOrgMarker`, `isGovernmentBodyName`) and the verdict table is this lane's own. Reusing the
> wrong gate wholesale would have offered `same_party` on a card where it means nothing.

`isRoleOrFormLabelName` is a NARROW curated stoplist scoped to this gate only, following the
`lcc_p131_is_document_row_label` precedent. **Measured blast radius: exactly those 4 names, 0 real
people.** It is not exported into the shared guards — there a false positive is destructive; here it
costs one rejectable card. It must be extended by measurement, never by imagination (P158a).

A blocked candidate stays **on** the card, flagged with its reason. "1 excluded (broker role)" is the
honest count; a silently shorter list is not.

---

## 7. The write, and how to undo it

`attach` writes `owner_contact_pivot.active_contact_entity_id` (+ name/role/source/confidence) and a
person→owner `entity_relationships` edge via the shared `linkPersonToEntity`. The person is RELATED
to the org, never stamped AS it.

- **The card is re-read from the view at verdict time**, never trusted from the request. A federated
  decision is minted from client-supplied context; the write path re-fetches the (owner, domain) row,
  rebuilds the card through the same pure planner, and refuses a `person_entity_id` that is not on
  it. A stale card, a misclick or a crafted body cannot attach an arbitrary entity, a broker, or
  "Tenants In Common".
- **Fill-blanks:** an owner that gained a contact since the card rendered is NOT overwritten — the
  verdict records `no_longer_actionable` and supersedes.
- **`active_authority_level` = 5 ("captured"), deliberately not promoted from a job title.** That
  ladder means legal/control authority (1 signatory > 2 controlling > 3 economic > 4 agent > 5
  captured); "President" in a CRM title field does not establish it. The role bucket goes in
  `active_contact_role`, where it belongs. `confidence = 'medium'` — a human confirmed the LINK, not
  the person's authority inside the firm.
- **Every verdict is ledgered in `lcc_tier0_confirm_log` BEFORE the pivot write**, carrying the prior
  pivot state verbatim so a reversal restores what was there rather than nulling a field another
  source had filled. Reject and research are ledgered too — that is how "nobody worked the lane" is
  told apart from "it was all rejected". Full reversal runbook is in the migration header.

### The write path was proven against the live schema, with zero residue

A self-rolling-back gate exercised **both** arms exactly as the handler writes them — ledger-then-
PATCH for an owner that already has a pivot row (Boyd Watterson), ledger-then-INSERT for one that
does not (Elman Investors), plus the `entity_relationships` edge — then `RAISE`d to abort:

```
GATE OK (rolled back): pivot 5412 -> 5413, logs 1/2, rel 4f8f987e-…
```

Every column, NOT NULL and trigger the write path touches is accepted. Nothing persisted.

### ⚠️ Verify by the DRAIN — and the obvious drain metric is the WRONG ONE here

The instinct is `v_owner_contact_enrich_queue`, because it keys on
`active_contact_entity_id IS NULL`. **Measured: that view holds 6 rows in total, and exactly 2 of
this lane's 171 owners are in it.** It excludes `enrichment_action IN ('manual_research',
'find_person_at_manager')` and owners with an open `owner_contact_manual` task (P159/P182), which is
almost the entire Tier 0 population — 4,031 pivot rows carry no active contact and only 6 are
queue-eligible. Quoting it would have reported ~0 movement on a lane doing real work.

**The populations this lane actually drains, measured 2026-08-26:**

| metric | today |
|---|---|
| `v_lcc_tier0_owner_contact_lane_open` cards | **237** (an attach removes the owner's cards — `owner_already_has_contact` flips) |
| this lane's owners on `v_lcc_owner_unreachable_worklist` | **161 of 171**, **$642M** of annual rent |
| `v_lcc_owner_reachability.reachable_hero_qualified` | **299** (of 2,568 owner entities) |

**And 18 of the 171 owners already carry an edge to a candidate person** — Boyd Watterson's Eric
Dowling and Joseph Capra are both `already_linked`. For those the graph was never the gap; the gap
is that `owner_contact_pivot` names nobody, so no surface says *who to call*. Their gain is the
pivot write, not the edge. A count of clicks is not throughput (P159a).

---

## 8. Badge and list read ONE source

The Decision Center summary already computes federated badges through `fetchFederatedSource`. The
`/api/review-counts` work-lane badge does too — deliberately **not** a bare count on
`v_lcc_tier0_owner_contact_lane_open`, because the JS name-shape gate can empty a card the SQL view
still counts. The two agree today by luck (0 cards lose all candidates to the JS gate) and would not
stay agreeing. That is the P132 defect — the Research badge reporting healthy open counts off a
summary view while the list itself 500'd.

`dc-lanes.js` also joined the cache-buster guard set. It was extracted out of `ops.js` into the SAME
global scope (ops.js owns `_DC_FEDERATED` = which lanes exist, dc-lanes.js owns `_DC_FED_META` +
`_fedCardHTML` = how each renders) and was sitting at a **different `?v=`** than the rest of the set
when this prompt added a lane — a fresh ops.js offering a lane a cached dc-lanes.js cannot render.

---

## 9. Residue, carried forward — recorded, not patched

- **George Washington University → `georgesinc.com`** — reaches the lane as a confirm-lane reject,
  by design. No fan-out gate can see it.
- **"Southern SSA Limited Liability Company"** ($0.9M) → `southern-agency.com`,
  `southerntraditionrealestate.com`. `southern` has fan-out exactly 2, right at the threshold.
- **One CMBS securitization trust** ($2.38M, 6 pairs). A securitization vehicle is not a prospectable
  owner, but it is exactly one row and a rule matching one row gets trusted as general later.
- **The curated sponsor→domain map** (NGP→ngpv.com, UIRC→uirc.com, HPI→hpitx.com, JBG→jbg.com,
  FCP→fcpdc.com, TMG→tmgdc.com). Still a decision per entry, not a refactor.
- **Duplicate OWNER entities are visible on the lane and not fixed here.** Easterly ×2 produces four
  cards (2 owner entities × 2 domains) for one firm. The planner collapses duplicate PEOPLE within a
  card (Andrew Pulliam ×2 → one row, alternates recorded in `duplicate_person_ids`, chosen by an
  explicit ranked rule rather than first-row-wins); it cannot collapse duplicate owners, which is its
  own pass.

## 10. NOT touched here — carried forward from P186/P187, unchanged

Named so nothing looks silently dropped: Probe B (operator-gated, needs the M365 connection); the
six Class-9 verdicts; the `autoClassify` backfill (406 resolved-owner contacts + 2,468 SF campaign
members misclassified `personal`); the Amy Dane / Amy Moyer merge and the generalised
local-part-collision-across-a-superseded-domain rule; the NPI binary verdict lane (15 decidable + 47
weak); the `contact_merge_queue` re-check.

## 11. Still open for Scott

- **Public universities.** University of Memphis and UNC Health Care are public and still in
  prospecting scope; **George Washington ($23.8M) and Georgetown ($8.0M) are private and must stay.**
  No name-based rule separates them.
- **The six sponsor→domain entries** — confirm or reject each.
- **Work the lane top-down.** Start with the 10 `measured_high` cards (7 owners, $521M). The 172 SPE
  cards are the ~60–70% band and are worth doing only after the top of the book is drained.
