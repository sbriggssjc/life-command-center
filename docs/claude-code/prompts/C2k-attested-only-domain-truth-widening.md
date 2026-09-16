# C2k — let SOS-attested domain truth compete: widen `v_lcc_domain_owner_candidates` past `unresolved`, but only where a registry backs the claim

**Filed:** 2026-09-16 (Cowork). Decision by Scott 2026-09-16: **attested-only widening**.
**Owner:** LCC (`life-command-center`) for the view/feeder/ledger; one small **gov** dependency
(the attestation flag on the facts export) that must land first — it is step 1 below and is
called out as a gov handoff inside this prompt.
**Read first:** `docs/audits/C2g_58_PAIR_READ_2026-09-15.md` §§3–5 and
`supabase/migrations/20260906120000_lcc_p113_domain_owner_feeder.sql` (the view at l.292, the
`unresolved` CTE at l.302, `lcc_ingest_domain_owner_evidence` at l.428).

## The gate, and why it is wrong for one class of row

`v_lcc_domain_owner_candidates` admits the gov/dia `true_owner` — weight **5.0**, tiered *above*
`rel_purchase` (4.0) and `sf_seller` (3.5) — **only on assets with no resolved owner**. So the
highest-weight source never competes; it fills blanks. `v_lcc_owner_supersession_candidates` carries
the same gate, so whichever feeder touches an asset first wins forever. On the 92 C2g assets:
0 `domain_true_owner` evidence rows.

Sized 2026-09-15: **936 gov + 100 dia** resolved assets have a `true_owner` mapping to a different
LCC entity that would pass the view's own eligibility. But the evidence is uneven: gov-wide, of
3,264 properties where `true_owner ≠ recorded_owner`, **978 have an SOS-registered manager on the
SPE and 858 of those name the `true_owner`**; ~2,300 are unattested. The 43 C2g A-class pairs are
the seed (`C2g_58_PAIR_READ` §A: SPE's SOS manager = the SF org or its contact, `exact` or
`norm_core`).

Scott's decision: the attested 858 may supersede; the unattested stay gap-fill only. Nobody's
resolved owner changes on the strength of a name pattern.

## What to build

**Step 1 — gov handoff (must land first):** `v_property_owner_facts_portfolio` (the REST view LCC's
`lcc_sync_property_owner_facts` pages through, l.117–165) gains
`true_owner_attested boolean` and `true_owner_attested_by text` — true when the property's
`recorded_owners.manager_name` / `managers` (with `llc_research_source IN ('sos_registry','sam_entity')`)
normalizes to the `true_owner` name using the C2g §3 rule (exact, else `norm_core`). Report the
count (expect ≈858) and a positive control that a property with a manager naming someone *else*
is `false`. dia: measure whether any manager data exists; if none, the flag is simply `false`.

**Step 2 — LCC sync carries it:** `lcc_property_owner_facts` gains the two columns;
`lcc_apply_property_owner_facts_page` writes them; the `select=` list in the sync URL adds them.

**Step 3 — the view:** replace the `unresolved` CTE with
`eligible AS (unresolved UNION resolved_but_attested)`, where `resolved_but_attested` is an asset
whose current `lcc_property_owner.owner_entity_id` is set, whose facts row has
`true_owner_attested`, and whose current resolution's source tier is **below** `domain_true_owner`
(i.e. `rel_purchase`, `sf_seller`, `rel_owns`, `supersession` — never `manual`). Expose a
`candidate_kind text` ('fill' | 'supersede') on the view.

**Step 4 — the ingest:** `lcc_ingest_domain_owner_evidence` keeps its dry-run default, ledgers
each `supersede` row to `lcc_domain_owner_evidence_log` with the **prior** owner entity and source,
and a new `lcc_c2k_unsupersede(p_batch_tag)` restores them. Resolution itself still flows through
the existing evidence→owner machinery (weight 5.0 wins on its own; do not hand-write
`lcc_property_owner`).

**Step 5 — run order:** dry run → expect the `supersede` count ≤ 858 gov (+ dia if attested rows
exist); read 20 of them by hand and list them in the response; then real run under a batch tag;
then re-read the 43 C2g A-class pairs — every one should now resolve to the sponsor, and the 16
no-evidence pairs from C2g §B should be **unchanged** (positive control that unattested rows did
not move).

**Step 6 — supersession view:** apply the same `eligible` shape to
`v_lcc_owner_supersession_candidates`, or state why it should stay first-touch-wins.

Tests for each: the gate admits attested-resolved, refuses unattested-resolved, never touches
`manual`; the ledger holds the prior owner; unsupersede round-trips.

## Prohibitions

- ⛔ No bulk write to `lcc_ownership_sponsor_family` (`(sponsor, token)`-keyed; cannot express a
  per-entity manager link — C2g §5).
- ⛔ No new relationship type in this round (that is the "sponsor as first-class edge" option Scott
  did not pick; note it as future work if the model wants it).
- ⛔ No name-pattern attestation. Attested means a registry field names the true_owner, nothing else.
- ⛔ No real run before the dry run's 20-row read is in the response.

## Reporting

Gov step 1 counts; sync row counts; dry-run `fill` / `supersede` counts by domain; the 20 hand-read
rows; the real-run batch tag and ledger count; the 43-pair and 16-pair re-reads. If any step was
skipped, say so.
