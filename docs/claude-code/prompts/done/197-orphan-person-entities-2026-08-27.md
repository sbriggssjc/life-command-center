# Prompt 197 — 5,440 person entities are not in the contacts hub. 92 of them are blocking $132.3M.

> **Read first:** `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Class 9 (and its corollary: *a zero is
> not automatically a defect*), `docs/architecture/contact-reconciliation-outbound.md`,
> `STATUS.md` 2026-08-27.
>
> ⚠️ **Do NOT start by bulk-reconciling 5,440 rows.** The actionable population is 92. Read §2
> before writing anything.

---

## The measurement

`entities` (person, live, with an email) vs `unified_contacts`, joined on lowercased email:

| | |
|---|---|
| person entities with an email | **11,107** |
| reconciled to a `unified_contacts` row | 5,667 |
| **orphaned — no hub row at all** | **5,440 (49%)** |

`unified_contacts` is what carries `company_name`, `title`, `sf_contact_id`, `outlook_contact_id`.
An orphan has **none of them**, which is why the Tier 0 lane cannot judge it.

**Measured on the parked Tier 0 cards** — 189 candidate people behind 142 parked cards:

| | people |
|---|---|
| have a hub row | 97 — **and all 97 carry an employer**, i.e. these are the `employer_on_file_differs` parks, correctly parked |
| **no hub row** | **92** — no employer, no title, no SF, no Outlook |
| of the 97: in Outlook | 15 · with a title 7 · with correspondence 2 |

**The split is exact and it is the whole finding.** `employer_on_file_differs` (76 cards, $96.3M) is
the gate working. **`no_employer_on_file` (68 cards, $132.3M) is not a judgement at all — it is a
missing hub row.**

## ⚠️ 49% orphaned is very likely CORRECT, and that is the trap

`entities` and `unified_contacts` are **not meant to be the same population**:

- `entities` is the graph — everyone ever seen: CoStar-captured brokers, deed grantees,
  OM-extracted names, transaction counterparties.
- `unified_contacts` is the hub — people we actually track, with a CRM identity.

So **do not read 5,440 as a defect count.** Playbook Class 9's corollary applies exactly: the
detector produces CANDIDATES, and each needs *"should this be in the hub?"* answered on its own
terms. A bulk reconcile would be the Consumption-Layer failure this codebase documents repeatedly —
and it would pour thousands of untracked broker records into the surface Scott works.

## What to build — value-gated, in this order

1. **Reconcile the 92 that are blocking parked Tier 0 cards.** They are attached to owners worth
   **$132.3M**, they are already proposed as contacts for a specific owner, and each one either
   resolves the card or converts it to an honest `employer_on_file_differs` reject. **That is the
   unit.** Report cards moved out of `parked`, never rows reconciled.
2. **Then decide the general rule**, with the value gate stated before measuring: *which orphans
   deserve a hub row at all?* Candidate gates, in descending strength — appears in a Tier 0 bench
   for an owner above the rent floor; has correspondence; is in a Salesforce campaign; carries a
   title. **Quote the population each gate admits before choosing one.**
3. **Find out WHY they are orphaned before building a reconciler.** ⚠️ This has not been diagnosed.
   Likely the sidebar/CoStar path mints a person entity without an `ensureContact`-style hub write —
   but that is a hypothesis, not a finding. **If a live producer is still minting orphans, a
   one-shot reconcile is a chore repeated forever** (Class 8). Check `created_at` on the orphans:
   recent ones mean the producer is live.

## Traps already paid for

- **⚠️ The join is on lowercased email and 44% of `unified_contacts` rows carry NO email at all**
  (`contact-reconciliation-outbound.md` §4D). Those can never match on the identity key, and
  **name-fuzzy matching is banned for identity here.** State the ceiling; do not reach for
  `nameSimilarity`.
- **Junk-guard before minting anything** — `isMisparseName`, `isJunkContactName`,
  `isPersonShaped`. The bench has previously carried `"Authorized Signer"`, `"Public"` and
  `"This information was confirmed by an SEC filing."` as person entities.
- **Brokers are never promoted to the pivot at any tier** — but they are legitimate hub entries.
  The outbound doc makes that distinction explicitly; keep it.
- **⚠️ `CONTACTS_HUB` decides WHICH PROJECT `unified_contacts` means** (currently `ops`; the gov
  copy is a frozen 2026-08-17 snapshot that answers queries happily with stale data). The function
  is called `govQuery()` regardless. **Confirm which project you are writing to before any write.**

## Verify by

`parked` dropping from 142, and the `no_employer_on_file` slice specifically shrinking from 68 —
not by a count of hub rows created.

---

## Still open

**Dated:** N9v — `TIER0_AUTO_ATTACH` was set and redeployed 2026-08-27; the tick last ran **06:55
UTC and reported `flag_off`** (pre-redeploy). **The next run is 06:55 UTC tomorrow** and is the
first honest test: expect `active_source='tier0_auto'` 0 → 9. N9w — sidebar still 0% stamped, last
row pre-reload; one CoStar capture settles it.

**Needs Scott:** `fcp→fcpdc.com` and `tmg→tmgdc.com` (the two held sponsor entries); **N3c** the
bank/trustee scope rule (Truist $6.2M / 15 candidates, Wells Fargo, the JP Morgan CMBS trust);
**N13** whether to prune the test suite at all.

**Carried:** N10 (4 held junk-name groups, ~$0 — a name-repair job); N12 (four Windows-only path
tests); N3a (the wording half of duplicate detection — Easterly ×2; the domain-keyed fix was
measured at 25% and rejected); the `autoClassify` backfill; Probe B.
