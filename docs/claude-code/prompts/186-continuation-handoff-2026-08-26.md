# Prompt 186 — continuation handoff from the 2026-08-26 session

> **Read first:** `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` (Classes 1–11),
> `docs/architecture/account-based-contact-intelligence.md`,
> `docs/architecture/contact-reconciliation-outbound.md`,
> `docs/audits/P182_SILENT_DISCONNECTION_SWEEP_2026-08-26.md`.
>
> One session closed eleven invisible defects and opened four new detector classes. This is
> what is left, ranked, with what is known and what is only assumed.

---

## The standing objective (Scott, unchanged)

> *"Get to pursuit of all of the top seller prospects in the space (government and dialysis
> today) through research and business development efforts that push all our efforts toward
> the top prospects in the space regardless of what's in Salesforce yet or not."*

Doctrine that constrains every item below:

- **The ACCOUNT is the pursuit; who to call there is a separate, STANDING function** —
  value-based, ongoing, re-derived as correspondence and transactions land.
- **The pursuit target is the ACQUISITIONS contact**, not the highest-volume one. We prospect a
  buyer by showing them deals. The disposition name is earned *through* them and kept **in
  addition**.
- **Brokers are never prospected** as principal-buyer contacts; broker↔buyer history is kept as
  market intelligence (who transacts with this buyer, where the buyer's-rep gaps are).
- **Municipalities and states are never prospects.** A person CAN be an owner when they are the
  individual in control of the LLC/SPE.

---

## Priority-ranked backlog

### 1. ⭐ Tier 0 promoter — the largest unrealised BD value

**Why first:** 11 top owners worth **$240.5M** are suppressed from contact acquisition AND have
no `owner_contact_pivot` row, so their panels read "— none" while a person sits in the graph.
Easterly ($85.0M), NGP Capital ($59.8M), US Fed Properties Trust ($53.7M), Elman Investors
($29.0M). The proposal layer is built and verified; the promoter that writes is not.

**State:** `v_lcc_tier0_owner_contact_candidates` is live. Verified on named rows — Easterly
proposes all 7 `easterlyreit.com`/`easterlypartners.com` principals including Andrew Pulliam;
Elman → Mitchell Freeman; Trammell Crow → Aaron Thielhorn.

**⚠️ Do these in order:**
1. ~~**Fix the view's performance first — it TIMES OUT at full scale.** A
   `lcc_owner_known_annual_rent()` call per owner plus two `EXISTS` per pair.~~ — **DONE
   2026-08-26, and THIS DIAGNOSIS WAS WRONG ON BOTH HALVES.** Measured: the rent function is
   191 ms of 58,694 ms (0.3%) and the two EXISTS are 53 ms combined (0.09%). The cost is a
   JOIN with **no key** — `EXISTS(unnest(toks) WHERE sld LIKE tok||'%')` forces a Nested Loop
   at `loops = 5,624,400`, 99.5% of the runtime. Fixing the three named suspects would have
   bought 0.4% and left it timing out. Fixed by expanding each person's email SLD into its
   prefixes, which makes the prefix match an equality join: **58,694 ms → 252–473 ms (124×),
   0-row equivalence diff both directions.** Migration
   `20260826234000_lcc_p186_tier0_candidates_hoist_cross_product.sql`.
2. **Have Scott review the bench** for a handful of top owners before anything writes.
   → **BENCH PRODUCED: `docs/audits/P186_TIER0_VIEW_FIX_AND_BENCH_REVIEW_2026-08-26.md`.
   AWAITING SCOTT.** Headline: the view is a recall net, not an identity rule — of 2,358 pairs,
   **1,848 are noise** (CIM Urban → 17 unrelated `urban*` domains; George Washington University
   → `georgesinc.com`, a poultry company; USPS → Postal Realty Trust; Allan Bailey Johnson →
   `johnsonlexus.com`). A two-axis lexical gate cuts it to 510 but still passes known-wrong
   rows, so **corroboration is required, not optional**. Only **A1 — 26 pairs / 20 owners /
   $173M, correspondence + company-name match — reads clean row by row** and is a defensible
   first promoter payload. Also measured: **41 owners ≥$5M ($902M) have an EMPTY bench**,
   Boyd Watterson ($179.8M) among them — Tier 0's real gap is coverage, not ranking.
3. ~~**Then** build the promoter~~ — **RECOMMENDATION REVERSED BY MEASUREMENT. Do not build an
   unattended promoter.** Link precision at the agreed bar measured **~76–80%** (top 45 pairs read
   individually). One write in five would put the wrong firm's employee in `owner_contact_pivot`.
   Build a **confirm-a-draft lane** instead (the `lcc_clean_assist_proposals` pattern already in
   use). **And do P187 first** — it is worth more than the promoter.

**➡️ SUPERSEDED BY `187-tier0-owner-domain-matching-2026-08-26.md`.** The biggest unlock is not
the promoter and not Salesforce: **≈51 people at 9 owners worth $358M are already in `entities`
and invisible to Tier 0**, including Boyd Watterson ($179.8M, the largest owner in the system),
RMR's CEO and Realty Income's CEO. Cause is the matcher's own eligibility test — playbook
**Class 13**.

### Scott's standing decisions, 2026-08-26 — do not re-litigate

- **Corroboration bar:** correspondence is NOT required. Any evidence of "the right source or
  connection or prospect historically" counts — Salesforce campaign membership (285 of 493 gated
  pairs), SF contact record, Outlook address book, company-name corroboration. **⚠️ But that bar
  attests to the PERSON, not the OWNER LINK** — Gary George at `georgesinc.com` (a poultry
  company) passes all three for George Washington University.
- **Municipalities and public bodies are OUT of prospecting scope**, while their ownership data
  continues to be reconciled normally. Shipped: `lcc_owner_name_is_public_body` widened (27/27
  named-row gate) + excluded in the Tier 0 view (−14 owners, −44 pairs).
- **Public universities are still an open call** — Memphis and UNC Health are public; George
  Washington ($23.8M) and Georgetown ($8.0M) are private and must stay. No regex separates them.

**Hard rules:** brokers are never promoted. Owners whose only links are brokers must fall
THROUGH to acquisition, not be suppressed. Reuse the P161-gated `owner-reachable-via` resolver.
**The stoplist is the whole rule** — a first pass matched "Boyd Watterson Asset Management" to
`dforsyth@assetmre.com` on the token *asset*.

### 2. Probe B — does `PATCH /me/contacts` actually stick? (operator-gated)

Blocks all outbound contact work. Scott edited a contact in the Outlook **client** and it saved,
so the "read-only" marker is Stan Johnson migration residue, not a live link. **That does not
prove the API can write** — Graph can return `200` and discard.
`flow-lcc-probe-outlook-contact-write.json` is built (7 structural guards) and writes a
sentinel, re-reads to compare, restores, and re-reads again. **The verdict comes from the
re-read, never the status code.** Needs Scott's M365 connection to run.

**⚠️ Even if it works, the payload is small.** Measured: across all 2,809 Outlook-linked rows,
the hub holds a non-Outlook value for only `title` 3, `company_name` 25, `phone` 39,
`mobile_phone` 144 — **~211 field-values total, an upper bound.** Everything else came *from*
Outlook. **The real outbound payload is CREATE, not PATCH:** 30,024 hub rows absent from the
address book, of which only 828 have real correspondence and 487 are named and touched within
24 months. Non-destructive, no conflict model needed, and it needs junk guards — the ranked
head already contains `emails@campaigns.crexi.com` filed as a person and Scott himself at his
own dead address.

### 3. Class 9 candidates — six never-fed receivers, each needs a RECORDED verdict

`unified_contacts.last_synced_calendar`, `webex_person_id`, `teams_user_id`,
`icloud_contact_id`; `lcc_sf_list_membership.sf_lead_id`; `listing_bd_runs.sf_deal_id` — all
**0 populated**. The handler ships `ingest_calendar_contacts`, `ingest_webex_calls`,
`send_teams`, `send_webex`: built, never fed.

**"Not used at Northmarq" is a legitimate answer — but it must be WRITTEN DOWN.** A zero column
with a documented verdict is resolved; one without is an open question forever.

**The calendar one is different and is the highest-value of the six.** A calendar sync IS live
and healthy — pointed at a *different* Supabase project, into `dia.calendar_events` (1,007
events, synced same day) — **and that table has no `attendees` column.** Every attendee list is
discarded at ingest, which is exactly the people-discovery signal the unfed LCC receiver was
built to consume. **This needs an operator decision, not code:** repoint the flow at
`/api/calendar-changes?bridge=calendar.event.link` (reuses the built, P116-hardened receiver),
or add `attendees` to the Dialysis path (widens a lossy schema).

### 4. `autoClassify` backfill — 406 + 2,468 already misclassified

The forward fix shipped (business evidence outranks a consumer email domain). Existing rows did
not move: **406 resolved-owner active contacts and 2,468 Salesforce campaign members** sit on
consumer domains and were classified `personal` under the old domain-only rule. Needs a
reversible, evidence-gated backfill — **not a blanket flip** (P164 cleared 103 individual owners
that way and had to be reverted).

### 5. Small, contained, low-risk

- **Amy Dane / Amy Moyer merge** — `adane@stanjohnsonco.com` vs `adane@northmarq.com`, same
  local-part, one person after a name change. Blocked the P185 swap. **Generalise it:** a
  local-part collision across a superseded/live domain pair is a strong duplicate signal, and a
  name matcher scores "Dane" vs "Moyer" LOW and misses it — the fuzzy-name lesson running
  backwards, producing a false negative rather than a false positive.
- **49 remaining dead `@stanjohnsonco.com` primaries** with no live address on file. Nothing to
  swap to; needs external evidence, not a guess.
- **NPI match verdict lane** — 15 decidable + 47 weak, needs a binary confirm/reject surface
  ("is clinic X the same facility as NPPES org Y?"). Decision Center, not a research card.
- **Duplicate owner entities** — Easterly at $85.0M *and* $0; NGP at $59.8M/$8.5M/$0; Elman at
  $29.0M/$447k. Inflates any per-name rollup and splits deal history.
- **Extend the contact ingest contract** — Outlook exposes `Department`, `Manager`,
  `Office location`, `Profession`; none has a home. `Department` is arguably a *stronger* role
  signal than free-text job title. **Do NOT cram it into `title`.**

### 6. Verify later, not now

- **`contact_merge_queue`** — the split-write is fixed (read ops / write gov / FK violation /
  swallowed 409). It only fills when a NEW OM intake creates a fresh contact matching an
  existing one, so **check ops in a few days.** Still zero after real intake activity ⇒ the
  matcher gate is the next suspect, not the write.
- **The Outlook contacts flow** — recurrence should now be delta-only (`hwMark`
  `2026-08-26T16:00:00Z`). Confirm a scheduled run processes a handful of rows, not 2,809.

---

## Known-broken / unexplored, carried forward

| area | state |
|---|---|
| `v_lcc_tier0_owner_contact_candidates` | **times out** at full scale — correlated subplans |
| `v_lcc_prospecting_edge_review` (P166) | **narrower than its name** — does NOT contain the Easterly broker edges, and returned a false zero when used as a broker test |
| 7 competitor-broker edges on Easterly | wear role `prospecting_contact`; wrong per doctrine. **Re-role, don't delete** — they are Tier-4 market intelligence |
| `lcc_sf_list_membership` | stale 36 days, but it is a **manual bulk import**, not a stopped schedule (clusters on four days in July) |
| dedup ceiling | **44% of contacts (14,465) have no email at all** — undedupable on the identity key. A stated ceiling, not a backlog |
| `action_items.completed_at`, `lcc_owner_contact_propagate_review.decided_at` | never stamped — breaks every age/SLA/throughput analysis over them |
| `lcc_reusable_owner_contacts`, `lcc_owner_evidence_cache`, `lcc_sf_comp_on_market` | **no `_at` column at all** — no freshness measure possible by any method |
| `lcc_sync_property_owner_to_portfolio` | carries the same existence-not-liveness guard P175 fixed; no cron, no caller today — fix before anything is wired to it |

---

## Method — the part that actually matters

**Eleven wrong conclusions were reached on 2026-08-26 and caught by measurement.** Every one was
plausible enough to ship with a convincing write-up. The recurring shapes:

1. **Wrong datastore.** `unified_contacts` exists on two projects; `govQuery()` routes by path,
   so its NAME says nothing about where a write lands. Cost two consecutive wrong reports about
   a sync that was working — including "stop the run."
2. **A detector that cannot fire.** The published Class 10 regex matched 0 of 210 views because
   Postgres deparses `NOT EXISTS (` to `NOT (EXISTS (`. **Point a detector at a known positive
   before trusting a zero.**
3. **Declaring something unmeasurable** when the answering column was right there
   (`created_at`, not `updated_at`).
4. **Calling a three-week-old lane dead.** Check the age.
5. **Routing to a destination that cannot accept an answer** (NPI is display-only).
6. **A pattern true on one named row and zero fleet-wide** (the broker-suppression theory).
7. **Assuming ranking fixes reachability** — it moved to page 62, and the lanes above had 4,772
   and 595 completions.
8. **A gate that matched 115 when 5 qualified** — 104 were phantom self-echoes with no email
   and no phone.
9. **Using a label as a discriminator** — `org_marker` put PS Business Parks and Rexford
   Industrial in the "individual" bucket.
10. **Quoting a 6× overstated figure** (`email_aliases` "preserves history on 1,196" — really 199).
11. **A positional bug in new code** — `pickBestEmail` took the first business domain, so an
    acquired firm won on array order: 101 contacts on a dead primary.

**The discipline that caught all eleven: name the expected answer before running the query, and
prefer a named row with a stated expectation over an aggregate.** Every aggregate was plausible.
The named rows were not.

**Do not fix on suspicion.** Every repair was dry-run first, gated on named rows, batch-tagged
and reversible. Three would have destroyed real data had the "obvious" version shipped.
