# P194 — the Tier 0 auto-attach sweep, and what a "living loop" actually needs

**Date:** 2026-08-26 · **Prompt:** 192 (§1 auto-attach, §2 the living loop, §4 learning from verdicts)
**Project:** LCC Opps `xengecqvemvfknjvbvrq` · **Migration:** `20260827090000_lcc_p194_*`
**Flag:** `TIER0_AUTO_ATTACH` (**off** — the GET grade decides it) · **Cron:** 241, `55 6 * * *`

Prompt 192 asked for four things. One was built as specified. Two came back **different from the
brief when measured**, and those corrections are the substance of this round. The fourth has no
input at all.

---

## 0. Re-measure first — the brief was two hours old and already stale

P192's header states the triage as **ask 98 / auto 11 / parked 146 = 255**. Live at the start of
this round: **ask 78 / auto 9 / parked 146 = 233**. Twenty-two cards were decided in between.

Nothing was wrong with P192; this is the dated-claim doctrine landing on a note written the same
afternoon. Every count below is re-measured, and the `auto` population was re-read row by row
rather than inherited.

**The 9 auto cards, read individually — 9/9 correct:**

| owner | domain | person | link evidence |
|---|---|---|---|
| Northpath Investments | northpathinvestments.com | Gershon Alexander | — |
| Capital Square 1031 | capitalsquare1031.com | Mike Waddell | ✓ |
| Hunter Properties | hunterproperties.com | Deke Hunter | ✓ |
| REVA Companies | revacompanies.com | Steven M. Sadler | — |
| Healthcare Realty Trust | healthcarerealty.com | John Bryant | ✓ |
| Paolino Properties | paolinoproperties.com | Joseph Paolino | ✓ |
| Welbe Health | welbehealth.com | Ethan Epstein | — |
| Pepper Lane Properties | pepperlaneproperties.com | Myra Reinhard | — |
| MMI Capital, LLC | mmi-capital.com | Miller Heath | ✓ |

Four carry **no link evidence** and are still right — which is the P192 point restated: an EXACT
domain↔owner-core match is stronger than a CRM `company_name` string. (Prologis → prologis.com has
zero link evidence and is near-certain.)

---

## 1. ⭐ The sweep — and the trap that would have deleted two live questions

Built where the prompt said to build it: `api/_handlers/tier0-auto-attach-tick.js`, writing through
the JS verdict path. GET is an ungated dry run; POST is flag-gated, bounded and reversible.

**The prompt's instruction was applied one level deeper than it was written.** Copying the ~90-line
attach block out of `admin.js` into the tick would satisfy "it's in JS" and create a second writer
of `owner_contact_pivot.active_contact_entity_id`. So the effect was extracted once into
`api/_shared/tier0-attach-effect.js::applyTier0Attach`, and **`admin.js` now calls it too** — the
human click and the sweep run the same code, and a test pins that the tier0 verdict block no longer
PATCHes the pivot itself.

### ⚠️ The near-miss: a new enum value silently changed the meaning of an existing `<>`

The lane view hides an owner whose pivot contact came from outside this lane:

```sql
and coalesce(pv.active_source,'') <> 'tier0_confirm'
```

`'tier0_auto'` satisfies that inequality. So the **first auto-attach on an owner would have hidden
every other open card for that owner** — silently, with no error and nothing in any log.

Measured before shipping: **3 of the 9 auto owners hold a second card, two of them live `ask`
questions.**

| auto card | the card that would have vanished |
|---|---|
| Healthcare Realty Trust → healthcarerealty.com | `healthcarerea.com` **[ask]** |
| Capital Square 1031 → capitalsquare1031.com | `capitalsq.com` **[ask]** |
| Hunter Properties → hunterproperties.com | `hunterinvestors.com` [parked] |

The drain metric would have *overstated* the work — cards_open falling because questions were
deleted, not answered. The predicate is now a SET (`not in ('tier0_confirm','tier0_auto')`).

**Durable rule: when you add a value to a column that an exclusion tests with `<>`, go read the
exclusion.** A new enum member changes the meaning of every inequality written against the old one.

### Honest counts

The run log records `cards_open_before` / `cards_open_after` beside `attached`. A run where
`attached > 0` and `cards_drained = 0` means the writes are not removing cards from the lane —
the failure that reads as success. Every `skipped_*` is a re-discovery tally and is labelled as one.

---

## 2. The consumer-mailbox stoplist: one owner, and a measured widening

The prompt asked for sibling TLDs (`frontier.com` listed, `frontier.net` not). The deeper cause is
that the list is **copied** — the same equality array and suffix regex appear in the P187 migration,
the P188 migration, and in a third spelling in a P134 note. It is now one IMMUTABLE function,
`lcc_is_consumer_mailbox_domain(text)`.

**Blast radius measured before widening**, because "obviously an ISP" is the shape of reasoning that
produced the P158a `&` near-miss. Across the whole live person pool the widening removes 41 people.
Across the whole Tier 0 lane it removes **exactly one card**: `Frontier Hub LLC → frontier.net`, the
named false positive from the P192 header. Verified by a full before/after diff of the triage view in
both directions.

### ⚠️ The equivalence gate caught a regression I had already made

The first rebuild of the candidates view predicted a one-row diff and produced **20 removed / 1
added**: 13 `ngpv.com`, 5 `uirc.com`, 1 `jbg.com` gone, and George Washington University resurrected.

Cause: I rebuilt from the newest **committed** migration (P188). **P190 applied its two changes LIVE
and deliberately did not commit the view body**, writing:

> *"The full definition is in 20260827020000…; read the LIVE definition (pg_get_viewdef) as the
> authority. It is not duplicated here to avoid two copies drifting apart."*

The intent was right and the effect was the opposite. The newest committed source no longer described
the shipped view, so a rebuild from the repo silently dropped a shipped arm (`sponsor_map`) and a
shipped gate (`lcc_owner_name_is_not_prospected`).

**Durable rule: a migration that changes a view must carry the whole view.** "Read the live
definition" makes the repo an unreliable source and guarantees the next rebuild regresses. A second
copy that is CORRECT beats no copy at all. Both are now committed, and the repo file was hash-verified
against the applied statement (normalized md5 `60326ea1…`, identical).

**And the gate is what caught it.** A predicted diff of 1 against an actual diff of 21 is the entire
value of an equivalence gate; without it this would have shipped as a silent 20-card loss.

---

## 3. §2 — "a parked card returns the moment new evidence lands" is true for ONE of the six signals

P192 states the parked state is *"dated and expiring by construction"* and lists six un-park signals:
correspondence, an SF campaign, an SF contact, a title, a confirmed sponsor domain, a deal shown.

Read the decidability CASE. A `weak_partial` card is un-parked by exactly one term:

```sql
when c.n_link_evidence > 0 then 'ask'
```

and `n_link_evidence` counts only `ev_company_matches_owner` — the candidate's `contact_company`
string matching the OWNER's name. A `lcc_owner_sponsor_domain` row also works, by promoting
`match_strength` to `curated_sponsor`.

**Correspondence, SF campaign membership, an SF contact record, an Outlook entry and a job title all
move `n_person_evidence`, and the CASE never reads `n_person_evidence`.**

> **Measured: 95 of the 146 parked cards ($118M) ALREADY carry person evidence** and are parked
> anyway — and always will be, no matter how much more correspondence lands.

### ⚠️ The fix is NOT to un-park on person evidence

That would re-flood the queue with precisely what P192 removed, and it is the P188 Gary George
finding restated: person evidence attests that the PERSON is real, never that they work for THIS
owner. He is green on three person signals for George Washington University and works at a poultry
company.

**What is wrong is the CLAIM, not the gate.** So this round ships the instrument rather than a
behaviour change: `v_lcc_tier0_park_watch` reports, per parked card, what evidence has already landed
(`evidence_arrived_but_did_not_unpark`) and what would actually have to change (`unpark_requires`).

This is Class 10 wearing a disguise: the exclusion *is* self-clearing, but the only event that clears
it is not among the events anyone expects to arrive.

**The one genuinely-link-shaped signal from the prompt's table that is NOT wired is "a deal shown to
that buyer" (`lcc_listing_events`).** Showing a deal to someone at a domain is real evidence about
the employer relationship, and it is the honest next candidate — stated here as a gap, not patched,
because it needs its own measurement.

---

## 4. §4 — the reject signal has ZERO rows, and the attach analogue is refuted

> *"Start with the reject signal — it is the cheapest and it directly attacks the 146 parked cards."*

**`lcc_tier0_confirm_log` holds 27 attaches and nothing else.** The 6 rows that read `reject` in
`lcc_decisions` are `status='superseded'` — the `owner_already_reachable` no-op branch, not an
operator saying "wrong firm". A demotion engine built on that is a consumer wired to a producer that
does not exist (P137), so **it was not built.**

### ⚠️ And the obvious substitute is destructive

The tempting move is to run the same rule on the 27 **attaches**: a domain already attached to owner
A is evidence against proposing it to owner B. Measured over every colliding pair — **16 open cards
collide with an already-attached domain, and 0 of 16 are contradictions:**

- **13** are the NGP SPE family sharing `ngpv.com` (NGP VI ESSEX VT, Ngp Vi Harlingen Tx, …)
- `Cunningham Development` vs attached `Cunningham Development Co` — a duplicate entity (P189)
- `Kb Exchange Trust` vs `Exchangeright` — the DST program and its sponsor
- `Genesis Kc Dev` vs `Genesis Financial Group`

A shared domain across owners is **corroboration or a merge signal, never a contradiction**, and
demoting them would suppress exactly the sponsor inheritance P193 exists to deliver. Same 25%-precision
trap P189 measured and rejected for domain-keyed merge grouping.

**A classifier for this cannot be lexical.** `lcc_owner_domain_core` puts the NGP SPEs in
"genuinely different name" (`ngpviessexvt` vs `ngpcapital` — neither is a prefix of the other), so a
first pass at bucketing them reported 14 conflicts where reading the names gives 0. Verified on named
rows, per the doctrine; the aggregate was wrong.

---

## 5. Deliberate behaviour change worth naming

The human verdict path previously continued when the `lcc_tier0_confirm_log` write failed. It now
aborts. The ledger is what removes the card from the lane AND what makes the write reversible, so a
pivot write with no ledger row is an irreversible write to the field that decides who Scott calls,
on a card that stays open and will be re-attached. Aborting is strictly safer.

---

## 6. Verify

```sql
-- population + the instruments
select decidability, count(*) from v_lcc_tier0_owner_contact_lane_triage group by 1;
select count(*) filter (where evidence_arrived_but_did_not_unpark) from v_lcc_tier0_park_watch;
select * from v_lcc_tier0_auto_attach_run_health limit 5;
```

```
GET  /api/tier0-auto-attach-tick            # ungated dry run — read the 9 proposals
POST /api/tier0-auto-attach-tick            # flag-gated; no-ops while TIER0_AUTO_ATTACH is off
```

Reverse a batch:

```sql
update owner_contact_pivot p
   set active_contact_entity_id = l.prior_active_contact_entity_id,
       active_contact_name      = l.prior_active_contact_name,
       active_source            = l.prior_active_source
  from lcc_tier0_confirm_log l
 where l.batch_tag like 't0auto_%' and l.reverted_at is null
   and p.entity_id = l.owner_entity_id;
```

**Judge the sweep by `cards_drained`, never by `attached`** — and now that the `<>` trap is fixed,
those two agree.

## 7. Not done

- **The `lcc_listing_events` un-park signal** (§3) — the one link-shaped signal from the prompt's
  table that is not wired.
- **§3 of the prompt (the bench as a re-derived ranking)** and **P193's bulk sponsor attach** — both
  need the WHICH-PERSON choice to stay human (UIRC has 7 candidates), so they are an operator
  surface, not a sweep, and are a separate build.
- **§6 open for Scott** — `fcp→fcpdc.com` / `tmg→tmgdc.com`, and Easterly (attach Pulliam, not Shuler).
