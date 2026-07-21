# unified_contacts split-brain — Phase 0a delta enumeration (2026-07-21)

Two live, diverging copies of `public.unified_contacts` exist:

| | gov (`scknotsqkcheojiaewwh`) | LCC Opps (`xengecqvemvfknjvbvrq`) |
|---|---|---|
| rows | 30,495 | 30,003 |
| sf_contact_id | 16,990 | 17,287 |
| recorded_owner_id | 14,480 | 13,408 |
| gov_contact_id | **0** | 271 |
| dia_contact_id | **0** | 404 |
| entity_id | *(column absent)* | 700 |
| email (non-null) | 16,673 | 17,190 |
| last write | 2026-07-21 13:53 | 2026-07-21 14:00 |

Both are being written **right now** (minutes-fresh on both). `entity_id` and
`sf_last_synced` are ops-only columns; `gov_contact_id`/`dia_contact_id` are only
ever populated on ops.

## Method

gov's full `unified_contacts` (RLS disabled, anon full DML — see note) was pulled
into a temporary staging table `public._recon_gov_uc_stage` on **ops** via `pg_net`
(the codebase's existing cross-DB pull pattern), then diffed entirely in SQL on ops
against the live table. Snapshot is faithful: 30,495 rows staged, distinct-email and
`updated_at` high-water mark match gov exactly. A field **fingerprint** normalizes
each comparable column (lower/trim text; digits-only phones; SF ids compared on the
left-15 base, 15/18 safe; ids as text). Staging objects are `_recon_*`-prefixed and
dropped at the end of Phase 0.

## Set difference (exact — reconciles to both totals)

- **both (shared unified_id): 29,442**
- **gov-only (in gov, not ops): 1,053**  → 30,495 = 29,442 + 1,053 ✓
- **ops-only (in ops, not gov): 561**  → 30,003 = 29,442 + 561 ✓

Divergence is **bidirectional**: gov created 1,053 rows ops lacks; ops created 561
rows gov lacks.

## Field-value drift on the 29,442 SHARED rows

Values **agree on 29,292**; only **150 differ**. The differing set is **entirely
three domain-link columns** — *zero content-field drift* (email, phone, names,
company, title, city, state, SF ids, website, industry, etc. all match 100%):

| field | rows differ | direction |
|---|---|---|
| `dia_contact_id` | 64 | **ops has / gov NULL** (ops enrichment — ops wins, nothing to merge) |
| `recorded_owner_id` | 63 | **gov has / ops NULL** (gov holds 63 owner-links to fill into ops) |
| `gov_contact_id` | 30 | **ops has / gov NULL** (ops enrichment — ops wins, nothing to merge) |

(150 distinct rows; 7 differ on two fields.) There are **no true conflicts**
(both-sides-non-null-but-different) on any field. Which side is newer among the 150:
gov-newer 56 / ops-newer 94 — but recency is moot since the only gov-authoritative
delta is the 63 `recorded_owner_id` fill-blanks.

## gov-only rows (1,053) — two clean classes

- **1,009 owner-link rows** — `recorded_owner_id` set, **no email / no name / no SF
  id**, all `contact_class='business'`. These are the recorded-owner contacts gov's
  writers create. No email → **safe to INSERT** into ops.
- **44 SF person rows** — carry `email` + `full_name` + `sf_contact_id` +
  `sf_account_id`, and **every one email-collides with an existing ops row** (same
  person, different `unified_id`). **Must NOT blind-insert** — email-reconcile
  (fold into the existing ops row, fill blanks, record the gov `unified_id`) via the
  R39 email tier, else a duplicate person is created.

gov is actively producing these: created span 2026-03-19 → today, **461 created in
the last 30 days** (~15/day).

## ops-only rows (561)

All carry an email (`ops_only_no_email = 0`). 517 are email-native to ops; 44
email-collide with a gov row. These are **already on canonical (ops)** → **no merge
action**; gov simply lacks them, which resolves when routing flips (0c). They are
reported for completeness, not remediation.

## Reconcile scope (feeds 0b)

Merging gov → ops (canonical) reduces to a small, conflict-free set:

1. **INSERT** the 1,009 gov-only owner-link rows (no email collision).
2. **Fill-blank** the 63 shared-row `recorded_owner_id` values gov holds and ops lacks.
3. **Email-reconcile** the 44 gov-only SF person rows into their existing ops twin
   (attach/fill-blank, never a new row).
4. **No action**: ops-only 561; the 94 `dia_contact_id`/`gov_contact_id` ops
   enrichments; all content fields (identical on shared rows).

Every merged row/field is tagged `field_sources.*._split_reconcile = '<batch_tag>'`
for reversibility (0b).

## Does the delta change the plan? — NO

No field class exists only on gov. The one gov-authoritative delta is 63
`recorded_owner_id` fill-blanks + the 1,009 insertable owner rows + 44
email-reconcile rows — all handled by the existing FIELD_PRIORITY/R39 machinery.
Conversely **ops** holds `entity_id` (700), `gov_contact_id` (271), `dia_contact_id`
(404) that gov entirely lacks — confirming ops is the richer, correct canonical
side. Proceed with canonical = LCC Opps.

## Security note (surfaced, not changed here)

gov `public.unified_contacts` has **RLS disabled** and **anon holds full DML**
(SELECT/INSERT/UPDATE/DELETE/TRUNCATE). The anon key can read and write every
contact row over PostgREST. Not remediated by this reconcile (out of scope); flagged
for a follow-up hardening pass once gov's copy is read-only (0c) and eventually
retired.
