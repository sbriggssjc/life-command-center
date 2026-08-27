# Prompt 196 — make the merge path reversible (N11), then show why cards are parked

> **Read first:** `docs/audits/P195_BYTE_IDENTICAL_OWNER_MERGE_2026-08-27.md`, playbook **Class 15**,
> the `lcc_merge_entity` / P175a sections of `CLAUDE.md`, `STATUS.md` 2026-08-27 03:10 UTC.
>
> Two units, in this order. The first is safety debt the P195 pass created and worked around; the
> second is $98M of BD value currently invisible.

---

# Unit 1 (do first) — `lcc_merge_entity` has no undo

## The defect

```sql
perform lcc_reconcile_tombstone_backrefs(loser, winner, p_snapshot => false);
```

Every dedup DELETE the merge performs — portfolio facts, identities, relationships, watchers, pivot
— is **unrecoverable**. And the `owner_contact_pivot` dedup predicate is **uncorrelated**: it asks
only whether the winner has a pivot *at all*, then deletes the loser's.

**P195 proved this is not theoretical.** On `bamproperties` the winner-by-ownership held a pivot
naming **nobody**; the loser held the group's **only named contact, "Alex Bias"**. A bare merge
deletes it — no error, no ledger, in the very lane the pass exists to clean. P195 worked around it
in its own driver (snapshot externally, fold the pivot fill-blanks first). **The shared function is
still unfixed.**

## ⚠️ Urgency: dormant, not armed — measured, and it matters

`lcc_apply_fuzzy_merges()` would auto-merge **3,053 groups with no undo**. Before treating that as
live risk I measured what fires it: **nothing does.**

| check | result |
|---|---|
| `cron.job` scan for `fuzzy` / `apply_fuzzy` / `merge_entity` | **0 rows** |
| repo callers in `api/` | **0** — the only hit is a *comment* in `cre-registry.js` |

Same disposition CLAUDE.md gives `lcc_sync_property_owner_to_portfolio`: **fix before anything wires
it up.** Do not page anyone. *(Reading "3,053 irreversible merges" without checking for a caller
would have produced exactly the wrong urgency — that is the point.)*

## What to build

1. **Snapshot by default.** `p_snapshot => true` in `lcc_merge_entity`, writing to
   `r40_merge_reconcile_backup` as the reconcile already supports.
   ⚠️ **A reversal path that has never been run is a claim, not a capability** — P195's round trip
   failed first time on `428C9: is_current is GENERATED ALWAYS`, a footgun already documented in
   `CLAUDE.md` that still shipped past review in a `select *` restore. **Run the round trip on real
   data before declaring it reversible.**
2. **Correlate the pivot dedup** — fold fill-blanks rather than deleting, exactly as P195's driver
   does. Reuse that code; do not write a second version.
   ⚠️ `active_source` must be carried across **verbatim, never restamped** — the Tier 0 lane reads
   it with `<>` and `IN`, and a new value there is the P194 trap (a new enum member silently
   satisfies every inequality written against the old one).
3. **Then re-check `lcc_apply_fuzzy_merges`.** With snapshots on, decide separately whether 3,053
   auto-merges should ever run unattended. **That is a decision, not a consequence of this fix.**

## Verify by

A real merge → unmerge → full row comparison showing zero residue, on live data, before the change
is called done. Plus `auto_mergeable` unchanged at 3,053.

---

# Unit 2 — show WHY a card is parked, and route the sponsor-shaped ones

## ⚠️ N3e as filed is wrong, and the correction is the useful part

N3e says 95 parked cards are "stuck permanently" and implies they need rescuing. **Re-measured:
they are mostly parked correctly.**

My own first measurement said **"100% of parked candidates are missing an employer"** — read off the
JSON key `contact_company`. **The key is `company`.** Corrected: **107 of 143 (74.8%) DO carry an
employer.** Class 11, caught only because that contradicted a direct join to `unified_contacts`
(98 of 131 people had a company there). **When two measurements of the same thing disagree, check
the key names before believing either.**

So the cards are parked because **the employer on file does not match the owner** — the gate
working. Population: **75 owners / $98M**.

## The wrong parks cluster in exactly two shapes

| shape | example | fix |
|---|---|---|
| **sponsor / SPE** | `OXFORD BIT GALLERY PLACE PROPERTY OWNER, LLC` ← Stephen Nicotra @ **Oxford Development Company**; `Salus Gov't Properties` ← **Salus Healthcare Real Estate Group LLC** | route into `lcc_owner_sponsor_domain` (P190/P193) — the answer already lives there |
| **junk-formatted company name** | `Savlan Cc Property LLC` ← Zusha Tenenbaum @ **"WWW Savlancapital COM"** | normalise the company string before comparing (strip `www`, `com`, punctuation) |

Correct parks, for contrast: `FORT WORTH TX I MG` ← Windsor Place Realty; `Ngp Vii Dayton Oh` ←
Dayton Street Partners (matched on the token `dayton`); the JP Morgan CMBS trust ← M.R. Champa LLC.

## What to build

1. **A `park_reason` on the card** — `employer_on_file_differs` (with both strings shown),
   `no_employer_on_file`, `weak_match_no_evidence`. An operator who can see *"parked: employer on
   file reads 'Oxford Development Company'"* can resolve it in one second; today they see nothing.
2. **A sponsor-shaped detector** feeding the P193 rollup, NOT the un-park. If the employer looks like
   the SPE's sponsor, that is a `lcc_owner_sponsor_domain` candidate for Scott to confirm — one
   decision covering a family, not N per-SPE questions.
3. **⚠️ Do NOT widen the decidability CASE to admit person evidence.** That restores exactly the
   Gary George noise P192 removed (a poultry-company executive passing three of four signals for
   George Washington University). This was already measured and rejected once.

## Verify by

Parked cards carrying a reason the operator can act on, and sponsor-shaped parks arriving as
sponsor-map proposals rather than sitting in the parked pile. **Report owners moved out of parked,
not cards touched.**

---

## Still open, unchanged

**N10** — the 4 held groups (`partnersgroup` 18 entities, `capital`, `properties`,
`capitalgroupproperties`, ~$0 rent): a **junk-entity / name-repair** job, not a merge.
**N3a** — the wording half of duplicate detection (Easterly ×2); the obvious domain-keyed fix was
measured at **25% precision** and rejected.
**N3c** — bank / trustee owners (Truist $6.2M / 15 candidates, Wells Fargo, the JP Morgan CMBS
trust): a scope rule, not 15 person-picks. **Needs Scott.**
**fcp→fcpdc.com, tmg→tmgdc.com** — the two held sponsor entries. **Needs Scott.**
**`package.json` engines** — `>=20.0.0` is false for the suite (needs ≥22.18 for TS stripping);
whether the *app* runs on Node 20 is unmeasured and touches the Railway runtime.
**Dated checks:** N9v (auto-attach first run, after 07:00 UTC 2026-08-27) and N9w (sidebar stamp
rate, after the next CoStar capture).
