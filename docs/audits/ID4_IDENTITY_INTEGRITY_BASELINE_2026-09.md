# ID4 — Identity integrity program: baseline measurement + resolver framework design

**Status: measurement + design only. No migrations applied, no merges, no backfills, no code
changes.** Per the ID4 prompt's own §5 ("What NOT to do") and this repo's data-write discipline,
detectors and per-class repairs are separate, Scott-approved follow-up builds (ID3a–f below), not
this document.

This builds on `ID1_OPERATOR_IDENTITY_AUDIT_2026-09.md` (which found three independent operator
registries and the entity-substring pollution) and `ID0_IDENTITY_VALUE_DOMAIN_PROBE_2026-09-11.md`
(the original cross-domain probe). It does **not** re-derive ID1's operator findings — it extends
the same measurement discipline to the other identity columns named in ID0/ID1 and the sibling
sweep, with live queries run this session against all three Supabase projects
(`scknotsqkcheojiaewwh` / gov, `zqzrriwuavgrquhisnoa` / dia, `xengecqvemvfknjvbvrq` / LCC Opps).

## 0. What could and could not be measured this session

Live, read-only SQL access to all three projects was available. Time/scope was bounded to a
representative slice of the identity columns ID0/ID1 named, not an exhaustive sweep — this is a
**baseline**, not a closed census. Every number below is a live measurement from this session
unless marked `[cited from ID1]`.

## 1. Baseline measurements — I13 (identity collapse)

**Method note, stated up front:** every "collapsible" figure below uses a naive
`regexp_replace(lower(trim(x)),'[^a-z0-9]','','g')` key — the ID0/A2/P189 "alnum-strip" normalizer.
This key is safe for identity ONLY when demonstrated safe on named rows (§1.5 below is the
counter-example). It is used here as a **discovery** instrument, never as a merge key.

### 1.1 gov `true_owners.name`

```sql
select count(*) total, count(distinct name) distinct_raw,
       count(distinct regexp_replace(lower(trim(name)),'[^a-z0-9]','','g')) distinct_norm
from true_owners;
-- total=16,274  distinct_raw=16,195  distinct_norm=15,261

select count(*) collapsible_groups, sum(n) collapsible_rows from (
  select regexp_replace(lower(trim(name)),'[^a-z0-9]','','g') as norm, count(*) n
  from true_owners group by 1 having count(*) > 1
) x;
-- collapsible_groups=991  collapsible_rows=2,004
```

**991 groups / 2,004 rows (12.3% of all owner rows) collapse under punctuation/case normalization
alone.** Sample groups, all read as genuine duplicates on inspection (legal-form punctuation only):
`U S Bank National Association` / `U.S. Bank National Association` / `Us Bank National
Association` (n=5); `Highwoods Properties Inc` / `HIGHWOODS PROPERTIES, INC` / `Highwoods
Properties, Inc.` (n=4); `John Hancock Life Insurance Company (u.s.a.)` in three castings (n=3).

⚠️ **This corrects ID1's cited "1,278 collapsible names" figure** (from the ID0 probe, dated at
audit time) — re-measured live today it is 991 groups / 2,004 rows. Re-derive before quoting; the
underlying table has moved between the two measurements.

### 1.2 gov agency identity — re-confirms ID1 §9.1 exactly, no drift

```sql
select count(*) total, count(agency) with_text, count(agency_id) with_fk,
       count(distinct agency) distinct_raw, count(distinct agency_canonical) distinct_canonical
from properties;
-- total=20,509  with_text=17,512  with_fk=0  distinct_raw=1,286  distinct_canonical=45
```

Unchanged from ID1's session-2 measurement: the normalizer (`agency_canonical`, 45 codes) already
works; `agency_id` is still 0% wired. This is `government_agencies` schema-note: the table has NO
plain `name` column — it is keyed on `code` + `full_name`, so any I13 detector here must key on
`code`, not attempt a generic `name` probe (a schema-blind detector would silently skip this table).

### 1.3 gov county/state pairs (I14 vocabulary, not I13 identity — kept separate deliberately)

```sql
select count(distinct county||'|'||state) raw_pairs,
       count(distinct lower(trim(county))||'|'||lower(trim(state))) norm_pairs
from properties where county is not null and state is not null;
-- raw_pairs=2,445  norm_pairs=1,611
```

**834 of 2,445 pairs (34%) collapse under case/whitespace normalization alone** — a pure I14
vocabulary-format defect (not a duplicate-entity question), matching the class this repo's own
CLAUDE.md already sizes for county authorities. Cheapest class in this whole baseline: pure
`lower(trim())`, no ambiguity, no review lane needed.

### 1.4 dia `operators` table (14 rows, not 67)

```sql
select count(*) from operators;  -- 14
select regexp_replace(lower(trim(name)),'[^a-z0-9]','','g') norm, count(*) n, array_agg(name) names
from operators group by 1 having count(*) > 1;
-- usrenalcareinc: 3  ["Us Renal Care Inc","US Renal Care, Inc.","Us Renal Care Inc"]
-- dialysisclinicinc: 2  ["Dialysis Clinic Inc","Dialysis Clinic, Inc."]
```

⚠️ **This table is 14 rows today, not the 67 ID1 cited from an earlier measurement window.** Only
2 groups collapse under alnum-strip. **This does NOT refute ID1's DaVita/Fresenius-family finding**
— those are genuine *brand* variants (`DaVita` vs `DaVita Dialysis` vs `DaVita at Home`), which an
alnum-strip correctly does **not** collapse, because the extra tokens are real content, not
punctuation noise. The two defect classes are different: this table's residual duplication is
punctuation-only (fixable by the normalizer alone); ID1's finding is a missing parent/brand model
(§5.1's `parent_operator_id`), which no string normalizer can fix. **Re-derive counts before
quoting `dia.operators` size** — it has clearly changed shape since ID1's session.

### 1.5 dia `leases.guarantor`

```sql
select count(*) n, count(distinct guarantor) distinct_raw,
  count(distinct regexp_replace(lower(trim(guarantor)),'[^a-z0-9]','','g')) distinct_norm
from leases where guarantor is not null;
-- n=713  distinct_raw=169  distinct_norm=134
```

Small population, modest collapse (35 groups implied). Low reach; deprioritized below.

### 1.6 dia `brokers.broker_name` — ⚠️ the alnum-strip key is UNSAFE on this population

```sql
select regexp_replace(lower(trim(broker_name)),'[^a-z0-9]','','g') norm, count(*) n
from brokers where broker_name is not null group by 1 having count(*) > 1;
-- 147 groups returned
```

**This is the finding, not the count.** Sample groups: `Huffman` (n=2), `Cook` (n=2), `Colliers`
(n=2), `CBRE` (n=2), `SVN` (n=3), `Matthews` (n=3), `Graham` (n=2), `Berman` (n=2), `Young` (n=2).
**Bare surnames and bare brand names collapsing to n=2–4 are exactly as likely to be DIFFERENT
people/offices sharing a name as duplicates of one** — this is the P189/A2/`lcc_owner_strict_core`
hazard (*"the hazard travels with the TECHNIQUE, not the name"*) landing on a population the
alnum-strip key was never validated against. `docs/architecture/broker-and-firm-identity.md`
already establishes `broker_name` is a **composite field** (person / firm / person+firm joined by
`;`), which is precisely why a generic normalizer cannot safely key this column. **Do not build an
I13 detector for `brokers.broker_name` on this key** — it needs the domain-specific comparator
BR1–BR5 is already building, and until that lands this column's "collapsible" count is not
actionable, only a population size (147 groups) to size the eventual work against.

### 1.7 dia CMS truncated-import claim — RE-MEASURED, ID1's cited figure is stale

```sql
select chain_organization, count(*), min(created_at), max(created_at)
from medicare_clinics where chain_organization in ('DaVita','Fresenius Medical Care') group by 1;
-- Fresenius Medical Care: 2,768 rows, min 2025-07-19, max 2026-01-22
-- DaVita:                 2,796 rows, min 2025-07-19, max 2026-01-22
```

⚠️ **ID1's cited "2,450/2,450 exactly, loaded 17 seconds apart" truncated-import signature does
NOT reproduce.** Current counts are 2,796/2,768 — not equal, not round. **What DOES reproduce and
is corroborated independently: both series stop dead at `2026-01-22`**, matching this repo's own
`B6d-cms` note that the CMS feed died then and stayed dead through the audit window. **The
mechanism claim (a truncated single-batch import) was wrong; the underlying fact (the feed is
dead) is confirmed by an independent measurement.** Per this repo's own re-measure-a-dated-blocker
doctrine: correct the wrong mechanism, keep the confirmed fact. This is a B6d-cms follow-up, not
an ID4 identity defect — flagged here only because it was carried in ID1 as an I13-adjacent
citation.

## 2. Writer inventory — not re-run this session

ID1 §2 already inventoried operator writers (W1–W10) by reading `api/`. Extending that inventory
to agency/owner/guarantor/broker writers needs the same file-by-file read ID1 did and was not
repeated here given this session's time-box; **flagged as the first task of whichever ID3 unit
picks up gov owner-entity dedup (ID3b) or gov agency wiring (ID3a)**, since those two units need
the writer list to know which code path to route through the eventual resolver.

## 3. Resolver framework — design decision (not built)

- **Cross-database identity scheme: extend `external_identities`, do not invent a second
  mechanism.** Add `source_type='operator'` / `'agency'` / `'guarantor'` / `'broker'` to the
  existing canonical scheme (`api/_shared/entity-link.js`'s `canonicalIdentitySystem()` /
  `canonicalDomainSourceType()`), keeping the domain database as the owner of the fact
  (dia owns operators/guarantors/brokers; gov owns agencies) and LCC Opps referencing by id — the
  same shape as the existing `asset`/`true_owner` pattern. This matches ID1 §5.6's recommendation
  and this repo's "truth is fixed at its source of record" doctrine: the fact "who is this
  operator/agency/broker" is a domain fact, not an LCC-internal one.
- **No shared normalizer across entity kinds.** §1.6 above is the concrete evidence: a normalizer
  safe for gov agency codes (clean 45-bucket collapse) is unsafe for broker surnames. The registry
  in §4 below carries a `comparator_fn` PER (table, column), never one global function — this is
  the generalization of `lcc_owner_strict_core` / `dup-pair-planner.ownerCore` /
  `lcc_normalize_entity_name` each being sanctioned for one job and catastrophic for another.
- **Every comparator ships with a named-row check before it drives anything beyond a review-lane
  grouping** — the standing P189/A2/A3 rule ("a comparator sanctioned for one gate must be
  re-graded on named rows for the next") applies to every new (table, column) pair added to the
  registry, not just the ones this baseline flagged.
- **Registry-driven, not per-column code.** A single table
  `(db, table, column, entity_kind, comparator_fn, canonical_fk_column, expected_state)` is the
  spine both the I13/I14/I15 detectors and the eventual resolver read — onboarding a new column
  is a new row, not new code, extending this repo's new-database-onboarding checklist
  (`data-coherence-invariants.md`).
- **DB guard, not just a JS resolver.** Per ID1's decided design (§11 of that doc): a hard block +
  alert, never a silent write of an unresolved raw string into a to-be-FK'd column — the resolver
  records a resolution attempt even when it abstains, so a bypass is structurally visible
  (mirrors the `field_source_priority`/`lcc_merge_field` provenance discipline already standing).

## 4. Standing detector shape (I13/I14/I15) — spec, not shipped

**Deliberately not built this pass.** Per the ID4 prompt's own instruction and this repo's
"don't schedule a detector until it has run green once under real credentials" doctrine (D1h), the
next step is a narrow, single-class detector (ID3a, gov agency wiring — see §5) proven against
today's live numbers, generalized into the registry-driven shape only once a second class needs it.
Building the general framework ahead of a second real consumer risks the exact
"framework built ahead of evidence" trap this repo warns about (normaliser drift, N15c/P189).

Planned shape, for when it is built:
- **I13 (identity):** per registered column, emit collapsible-group count, identical-canonical-key
  group count, and orphan rate (text present, FK null) — trend-tracked, alerting only on a rising
  trend or a new column crossing a floor, never a static threshold (B6d monitor-grading doctrine).
- **I14 (vocabulary):** per registered attribute domain, values outside a reference list plus
  case/format split count (the county/state pattern in §1.3, generalized).
- **I15 (import completeness):** per registered bulk load, rows-written-vs-source-count and the
  round-number/near-simultaneous-timestamp truncation signature — **§1.7 above is a worked example
  of why this needs care**: a plausible-sounding "truncated import" signature can itself be a stale
  or wrong claim, so I15's detector must be re-run against current data before any alert is trusted,
  never taken from a prior narrative.

## 5. Ranked class plan (ID3a–f)

Ranked by measured reach against measured build risk, using this session's live numbers where they
differ from ID1's citations.

| rank | class | population (live) | risk | why here |
|---|---|---|---|---|
| **ID3a** | gov agency FK wiring | `agency_id` 0/20,509; `property_agencies.agency_id` 160/132,243 (ID1 §9.1, unchanged) | **Lowest** — normalizer + registry both already exist and work | Cheapest lift, largest reach (every gov CM/firm-term view is agency-sliced); it is plumbing, not a judgment call |
| **ID3e** | gov county/state vocabulary | 834/2,445 pairs (34%) | **Lowest** — pure case/whitespace normalization, no ambiguity | Second-cheapest; no review lane needed |
| **ID3b** | gov owner-entity duplicates | 991 groups / 2,004 rows (`true_owners`), re-measured today | Medium — needs a review lane (P195/P189 pattern), never auto-merge | Real duplicates, moderate blast radius; feeds every owner-facing gov surface |
| **ID3d** | dia guarantor identity | 713 rows / 169 distinct / 134 normalized | Low reach | Small population; do after the cheap wins above |
| **ID3c** | dia broker identity | 147 alnum-strip groups, but the key is UNSAFE (§1.6) | **High** — needs the composite-field-aware comparator BR1–BR5 is building first | Sequence AFTER `broker-and-firm-identity.md`'s BR1–BR5 lands; building this on the naive key would misattribute unrelated people/offices sharing a surname |
| **ID3f** | dia operator/property duplicates | 14-row table, 2 collapsible groups; real defect is the brand/parent model (ID1), not string collapse | Low, and largely covered by ID1/ID2a already in flight | Lowest priority here — the CMS-feed-dead finding (§1.7) is the more urgent sibling and belongs to B6d-cms, not this program |

## 6. What this pass did NOT do

No merges, no backfills, no migrations, no code changes, no flag flips. The alnum-strip keys used
throughout §1 are discovery instruments only and must never be used as a live merge key — §1.6 is
the concrete demonstration of why. The writer inventory (§2) and the general I13/I14/I15 detector
(§4) are both deliberately deferred to the first ID3 unit that needs them.

## 7. Open items for Scott

1. Confirm or reorder the ID3a→f ranking in §5.
2. Confirm ID3c (broker identity) should wait on BR1–BR5, given the measured surname-collision
   risk in §1.6.
3. Confirm the county/state (ID3e) and agency-FK (ID3a) units — both "plumbing, not judgment" —
   can proceed without a review lane, since neither involves merging distinct real-world entities.
4. Decide whether to build the registry-driven I13/I14/I15 framework now or after ID3a proves the
   pattern on one class (§4 recommends the latter).
5. `dia.operators` and gov `true_owners`/CMS `chain_organization` all measured differently than
   ID1's cited figures this session — confirms this repo's own "re-measure before quoting a dated
   number" doctrine rather than indicating anything wrong with ID1's original work.
