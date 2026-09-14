# N15c — BUILD: give `entities.canonical_name` one writer. Decision 1 is answered.

> **Read first, in this order:** `docs/audits/N15b_CANONICAL_NAME_AUTHORS_2026-08-27.md` (the
> measurement — do not re-run it), `docs/architecture/tier0-owner-contact-system.md` §4 (the
> decision table) and §5 (traps), `docs/audits/DEAD_END_AUDIT_PLAYBOOK.md` Classes 8, 11, 17, 18.
>
> **N15b measured and wrote nothing. This prompt builds.** The normalization choice is settled;
> two smaller decisions are still Scott's and are marked 👤 below — **build around them, do not
> guess them.**

---

## The decision that is settled

**Scott, 2026-08-27: a DST, its Trust and its LLC are ONE entity — the TRUE OWNER.**
`Rainier Rockford DST Trust` = `Rainier Rockford Llc`; `SE VALPO LLC` = `Se Valpo Dst`; Syndicated
Equities likewise. **So the `trust|dst|reit` strip is CORRECT and adopted.** What N15b listed as
that rule's "named residue" is the desired behaviour, not a defect.

⚠️ **The aspirational future — individual investors as direct owners, and their fractional
positions in a DST / TIC / JV — is backlog N17 and must NOT be built by splitting this key.**
Fractional interest is a **relationship**, not an identity split.

## ⚠️ Adopt the TOKEN RULE, not the function — this is the one thing to get right

N15b recommended "`lcc_owner_domain_core`". **Do not point `canonical_name` at that function.**
It ends `string_agg(tok, '')` — **no separator** — so it is a *domain* comparator, not a name key.
Measured live 2026-08-27 19:15 UTC:

| | value |
|---|---:|
| live entities | **62,368** |
| `canonical_name` = `lcc_owner_domain_core(name)` today | **1,973 (3.2%)** |
| distinct keys, organizations, **space-joined** | 37,519 |
| distinct keys, organizations, **no separator** | 37,404 |

Those **115 fewer keys under the no-separator form are false collisions** — the `Gate Way` /
`Gateway` hazard the audit named. Rows collapsed: **5,700 space-joined** (vs 5,665 under today's
`normalizeCanonicalName`, and 5,823 no-separator).

**So the key is: the token stoplist of `lcc_owner_domain_core`, joined with SPACES.**

**And build it as ONE token list with two join styles — never two token lists.** That is the
normaliser drift this repo has paid for repeatedly (`lcc_normalize_entity_name` vs
`lcc_owner_strict_core` vs `dup-pair-planner.ownerCore`, each measured wrong for a different job).
Suggested shape: a `lcc_entity_name_tokens(text) returns text[]` that owns the stoplist, with
`lcc_entity_canonical_key(text)` joining on `' '` and `lcc_owner_domain_core(text)` refactored to
join on `''`. **If `lcc_owner_domain_core`'s output changes for even one row, stop** — P187/P188/P198
all depend on it; prove it byte-identical over all 62,368 live entities before continuing.

## ⚠️ N15b's writer census missed one — there are EIGHT

`field_source_priority` carries a row for `entities.canonical_name`: **`w8_u5_naming_hygiene@40`**.
That is an eighth writer the census did not list. **Find it, add it to the census, and route it
through the same function.** ⚠️ It also means this column is inside the provenance system: register
the new writer, or `v_field_provenance_unranked` will flag drift.

## What to build

1. **One function** owning the token rule (above). Pure, `IMMUTABLE`, `search_path` pinned.
2. **A `BEFORE INSERT OR UPDATE OF name` trigger on `entities`** that derives `canonical_name`.
   It covers all eight writers at once and **closes the staleness class in the same stroke**,
   because it recomputes when `name` changes.
   ⚠️ **It must set `NEW.canonical_name` and `RETURN NEW` unconditionally.** A trigger that returns
   NULL to skip a row silently defeats `ON CONFLICT DO UPDATE` (P196), and
   `lcc_finalize_classified_owners` upserts `ON CONFLICT (id) DO UPDATE`.
3. **Delete the inline copy in `api/_handlers/entities-handler.js`** (both sites, POST ~2686 and
   PATCH ~2840) and import `normalizeCanonicalName`. Two copies of one rule is exactly how writers
   #1 and #2 drifted apart on a single character.
4. **Repoint `v_lcc_developer_classification_candidates`** to compute
   `lcc_normalize_entity_name(e.name)` rather than read `e.canonical_name`. It is the one surface
   that wants the aggressive normalizer, and it is **already ~19% blind — 222 of 274 resolve today,
   269 would.** Do this even if the backfill is deferred.
5. **Handle the empty key.** **75 organization entities reduce to `''`** under the adopted rule
   (acronym-and-legal-form-only names). Say what the key is for them — the P189 blind spot is
   exactly this failure, and `v_lcc_merge_candidates_normalizer_blind` is the existing precedent
   (namespaced fallback, deliberately **not** `auto_mergeable`).

## 👤 Two decisions still Scott's — surface, do not guess

- **The 540 stale rows** (`canonical_name` left behind after `name` was repaired — `Scott W. Beynon`
  still keyed `buyer contactsscott w beynon 801 568 1031 p`). Recomputing discards a captured string
  some of them preserve. **Propose; do not rewrite them in this build unless Scott has said yes.**
- **Whether `canonical_name` becomes an enforced UNIQUE key.** Today **3,930 groups would violate
  it**. The index today is a plain btree `idx_entities_canonical (workspace_id, canonical_name)`.

## Traps already paid for — do not re-discover

- **⚠️ `v_lcc_merge_candidates` does NOT read `canonical_name`** — it groups on
  `lcc_normalize_entity_name(e.name)`; the column is a dead passthrough. **A rewrite cannot move
  `auto_mergeable`, and a non-zero move means you touched something you should not have.** Gate on
  it staying put (it is **3,040** as of 2026-08-27 17:05 UTC).
- **A one-shot backfill is Class 8.** The producer is live: **+5 live entities in the ~40 minutes
  between two of today's measurements**, and the steady-state leak is **79 in 21 days (~4/day)**.
  ⚠️ **Never quote the blended 1,879/30d** — burst-dominated, off by ~24×.
- **An implausibly clean result is a bug signal** (Class 11). Point every detector at a known
  positive: `671 Poplar LLC`, `BALTARA ENTERPRISES, L.P.`, `Rainier Rockford DST Trust`.
- **Read the function, not its name** — `lcc_name_has_spe_marker` returns FALSE for names containing
  the literal string "SPE" (P198).

## Verify by

**Not rows rewritten.** By:

1. **`ensureEntityLink` finds an existing row for the 10,340 currently-invisible entities** — the
   headline number, re-measured.
2. **`lcc_owner_domain_core` output is byte-identical** over all live entities (the refactor is
   provably a no-op for its existing callers).
3. **`auto_mergeable` moves by ZERO.**
4. **`v_lcc_developer_classification_candidates` resolves 269 of 274**, up from 222.
5. **Class 8 check, a day later:** re-run the recurrence query. Post-fix mints of disagreeing pairs
   should go to **0** against today's ~4/day. **That is the check that separates a fixed producer
   from a backfill.**

---

## Not in scope — the other window owns this

**A5 and the `gap_resolved` auto-close class (playbook Class 18) belong to the A-series thread.**
Do not touch `handleGenerateResearchTasks`, the research-task lanes, or
`property_missing_recorded_owner` here. Two Cowork threads plus Claude Code share this repo and the
handoff is the repo — **check `docs/audits/` for a round's output before assuming it is unstarted.**

## Still open elsewhere (do not action)

**⏳ Dated:** `TIER0_AUTO_ATTACH` — cron 241 at 06:55 UTC is the first honest test, expect
`active_source='tier0_auto'` 0 → 9. Sidebar `_provider` stamp rate still 0%.
**👤 Scott:** `fcp→fcpdc.com` / `tmg→tmgdc.com`; **N3c** bank/trustee scope; **N15** the 1,475
SF-campaign orphans; **N13** test-suite pruning.
**Carried:** **N3a** (wording-difference duplicates — the domain-keyed fix was measured at 25% and
rejected); **N10**; **N12**; **N16**; **N17** (fractional ownership, unsized).
