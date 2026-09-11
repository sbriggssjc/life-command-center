# OWN-T0j — a gov-side reconciled classifier so OWN-T0a's headline number is honest

**Repo: `life-command-center`.**

**Read first:** `docs/audits/OWN_T0_PROPERTY_OWNERSHIP_RECONCILED_2026-09-02.md` (§8's OWN-T0a row and the
whole doc's doctrine: "no portfolio fact is end-dated — both rows are true") · `api/_shared/sponsor-family-planner.js`
in full (the OWN-T0e cache+lane pattern this prompt reuses the SHAPE of, not the code) · the `OWN-T0a` row
in `docs/os/PLANNED-BACKLOG.md`, dated 2026-09-11, in full — it carries the exact live measurement and root
cause this prompt is scoped from, do not re-derive it from scratch · `docs/architecture/ownership-history-lane.md`
§ OWN-T0.

## Why this, why now

Cowork re-measured `OWN-T0a` live on 2026-09-11 and found the headline "43-49% disagree" number is
**structurally wrong as a defect signal**: most of it is the same sponsor↔SPE shape `OWN-T0`'s own audit
already found and correctly declined to "fix" by forcing agreement (both sides are true — a deed/lease
grantee names the SPE, `true_owner_id` correctly rolls up to the sponsor). Proof, not assertion: `Boyd
Watterson`, `UIRC`, `NGP`, and `Highwoods` are ALL already-confirmed sponsor families in
`lcc_ownership_sponsor_family` (LCC Opps), and they STILL read 111 / 24 / 14 / 5 disagreeing government
properties respectively in the raw comparison — because confirming a family only reclassifies the LCC-facing
`v_lcc_property_ownership_reconciled` conflict card; it never touches gov's `properties.true_owner_id` or
`ownership_history`, which is what the raw OWN-T0a comparison reads.

**Do not build anything that makes the two sides agree.** That would erase a legitimate two-level ownership
structure and has already been refuted twice on adjacent shapes (`OWN-T0` §4 on the LCC side, `RO2` on gov's
own `v_ownership_resolution` vs `true_owner`). The job here is a **measurement fix**: report the split between
"expected, already-known sponsor/SPE divergence" and "a genuinely unclassified residual that might be a real
problem," instead of one flat, alarming, uninformative percentage.

## 1. The exact comparison to reproduce (don't re-derive it)

Government DB (`scknotsqkcheojiaewwh`):
```sql
with latest as (
  select t.property_id, t.new_owner_cleaned
  from v_ownership_transitions_portfolio t
  where t.is_latest_for_property
),
joined as (
  select l.property_id, l.new_owner_cleaned, p.true_owner_id, tow.name as true_owner_name
  from latest l
  join properties p on p.property_id = l.property_id
  left join true_owners tow on tow.true_owner_id = p.true_owner_id
  where p.true_owner_id is not null
)
-- name-key comparison: regexp_replace(lower(strip parens), '[^a-z0-9]', '', 'g') on both sides
```
Live 2026-09-11: 5,133 comparable / 2,510 disagree (48.9%) across all sources; restricted to
`data_source='gsa_lease_diff' AND change_type='acquisition'` (the dominant source, closest to the original
2026-09-02 denominator of 3,474): 3,523 comparable / 1,648 disagree (46.8%). Confirm these numbers still hold
before building — if they've drifted, say so and use the fresh figures, but don't silently redefine the
population without noting the change.

## 2. What "confirmed, expected" means and how to compute it — CROSS-DATABASE, this is the actual build

`lcc_ownership_sponsor_family` (sponsor_entity_id, sponsor_token, confirmed_by, confirmed_at, notes) lives in
**LCC Opps** (`xengecqvemvfknjvbvrq`). The disagreement population above lives in **gov**
(`scknotsqkcheojiaewwh`). These are two separate Supabase projects — there is no cross-database SQL join
available. This has to be a **Node-level job**, the same shape as OWN-T0e's own cache refresh (find and reuse
its cron pattern — grep for `lcc_ownt0e_sponsor_family_proposals_cache` refresh, `api/admin.js`): read both
projects, join in application code on the entity's normalized name/token (reuse the SAME normalization
`v_ownership_transitions_portfolio` already applies — `gov_strip_brokerage_suffix` + the
lower/strip-parens/strip-punctuation key — do not write a second, drifting normalizer), and classify each
disagreeing `(property_id, transition_grantee, true_owner)` row as:
- `sponsor_family_confirmed` — the true_owner (or a name-key match to it) appears as a `sponsor_token` in
  `lcc_ownership_sponsor_family` with a `confirmed_at` that is not null. Expected, not a problem.
- `unclassified_rival` — no such confirmation exists. This is the honest residual — the number that should
  actually get attention.

Report BOTH counts, not just the residual — Scott needs to see the split, not just the smaller scarier-sounding
number replacing the bigger one.

## 3. Where this lives

Follow the OWN-T0e precedent: a cache table in **LCC Opps** (new — do not write into gov, LCC does not own
that schema), refreshed by a cron on a sane interval (4-hourly, matching OWN-T0e's own cache cadence, unless
you find a reason to differ — say why if you pick something else), plus a view or a simple reporting query a
human can run to see `sponsor_family_confirmed` vs `unclassified_rival` counts and the property list behind
each. **This is a reporting/measurement surface — it does not need a Decision Center lane, a verdict, or any
write path.** Do not build a confirm/verdict UI here; that already exists (`OWN-T0e`'s
`sponsor_family_confirm` lane) and this prompt's population should point AT it, not duplicate it.

## 4. What NOT to do

- Do not end-date, supersede, or otherwise make gov's `properties.true_owner_id` or `ownership_history` agree
  with the other side. Read `OWN-T0` §4 before touching either table — the prescribed "just end-date the
  earlier owner" repair was tried, measured on named rows, and refuted there for the identical reason.
- Do not build a second sponsor/SPE confirm mechanism. Read from `lcc_ownership_sponsor_family`; if a
  genuinely-unclassified sponsor/SPE pair needs confirming, that's `OWN-T0e`'s lane's job, not this prompt's.
- Do not write a second name-normalization function. `gov_strip_brokerage_suffix` plus the existing
  lower/strip-parens/strip-punctuation key (in `v_ownership_transitions_portfolio`'s own view definition,
  gov project) is the one this repo already uses for this exact comparison — reuse it exactly, in Node, rather
  than reimplementing a slightly-different regex.
- Do not touch `OWN-T0i` (hedge-phrase owner names, ~2.2% of this population) or the tombstone class
  (~3.3%) — those are filed separately and small; mention them in the reporting output as their own small
  buckets if convenient, but they are not this prompt's job to fix.

## Guard + ship

Mutation-guarded tests: a property whose true_owner_id name-keys to a CONFIRMED `sponsor_token` classifies
`sponsor_family_confirmed`; one that doesn't classifies `unclassified_rival`; a property with no disagreement
at all (name keys equal) doesn't appear in either bucket. Positive control: `Boyd Watterson` (already
confirmed, 111 gov properties per the 2026-09-11 measurement) should classify entirely `sponsor_family_confirmed`
— confirm this live, by direct query, not just in a unit test.

## Ship + record

Branch of your choice. `STATUS.md` entry with the real classified counts (both buckets, not just the
residual). **New** `PLANNED-BACKLOG.md` row `OWN-T0j` (search first — confirm no existing row already covers
this before filing).
