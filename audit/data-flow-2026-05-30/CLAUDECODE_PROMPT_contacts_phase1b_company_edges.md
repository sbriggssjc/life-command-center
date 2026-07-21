# Claude Code (LCC) — Phase 1b: connect owners to people via company resolution

**Phase 0 and Phase 1a are DONE and live. This is the payoff round.** All numbers below
are measured on production LCC Opps (`xengecqvemvfknjvbvrq`) on 2026-07-21 — not estimates.

---

## Where things stand

**Phase 0 (complete):** the `unified_contacts` split-brain is closed. Ops is canonical at
**31,012 rows** (gov's 1,009 unique rows merged in, reversible via `_recon_merge_log`),
`CONTACTS_HUB=ops` is live, the edge readers (`daily-briefing`, `copilot-chat`) were
repointed and redeployed, and a live write was verified to land the contact **and** its
`contact_change_log` row on ops with gov receiving nothing. gov contact PII was hardened
(RLS enabled, anon DML+SELECT revoked; every live reader/writer is `service_role`).

**Phase 1a (complete):** exact-key `entity_id` backfill via `sf_contact_id` →
`external_identities(salesforce, Contact)`. All 4,995 resolutions were strictly 1:1 — zero
ambiguity. `entity_id` coverage went **700 → 5,695**. Reversible:
`UPDATE unified_contacts SET entity_id = NULL WHERE field_sources->>'_entity_backfill' =
'phase1a_20260721'`.

**Phase 1a set NO edges.** The entity graph is untouched; owners-with-a-person is still
**92 of 15,257**. That is what this round fixes.

## What 1b can achieve (measured, not projected)

```
entity-linked contacts carrying a company_name .......... 5,687
  → company_name matches an owner org (exact norm core) . 1,198
     distinct people ..................................... 1,196
     distinct owner organizations ......................... 931

of those 931 owners:
  currently in the contactless worklist ................... 176
  ≥ $1M rank_value ......................................... 10
  rolled-up annual rent ................................. $68.9M
```

**931 owner organizations gain a named contact, against 92 today.**

The match used for that count is deliberately narrow: `lower(regexp_replace(name,
'[^a-zA-Z0-9]+','','g'))` equality with `length >= 6`, against organization entities that
carry a `true_owner` external identity and are not tombstoned.

## Blast radius — smaller than earlier rounds assumed. Do not over-engineer for it.

Earlier planning (including my own prompt) warned this was ~15k edges and the shape of the
2026-07-19 incident that collapsed `v_priority_queue_live` to >60s and forced a DB reset.
**The measurement does not support that.** ~1,200 edges against 101,506 existing
`entity_relationships` is ~1% growth. Queue refresh is currently ~2.0s with the PR #1422
fix in place.

So: keep a queue-health assertion as a cheap sanity check, but **do not build elaborate
batch-and-pause machinery for 1,200 rows.** Apply it, then verify.

---

## What to build

### Unit 1 — exact-core company resolution → auto-apply

For each `unified_contacts` row with `entity_id IS NOT NULL` and a `company_name` that
resolves by **exact normalized core** to exactly one owner organization entity, write a
person→organization edge via **`linkPersonToEntity`** (`api/_shared/contact-attach.js`) —
the same helper the contact picker and acquisition worker use. Dupe-guarded,
`associated_with` / `works_at`, `metadata.via='contacts_phase1b:<batch_tag>'`.

- **Exactly one** match required. A company core matching multiple owner orgs is
  ambiguous → Unit 2, never a guess.
- Apply the existing guards: skip junk/implausible names
  (`isJunkEntityName`, `isImplausiblePersonName`), skip tombstoned entities.
- Reuse the normalizers already in the codebase (`lcc_normalize_entity_name`, the ORE
  name-core helpers) — **do not write a fourth normalizer.**

### Unit 2 — fuzzy tier → review lane, not a silent write

Exact-core matching leaves value on the table, but LLC names are exactly where false
positives live: `Excelsior Capital` vs `The Excelsior Group` vs `Excelsior Partners` are
distinct firms, and the codebase already learned this.

**Reuse `api/_shared/owner-cross-reference.js`'s policy verbatim** — `sharedCoreOf`,
`isDistinctiveSharedCore`, `namingCoreMatches`. That module solved this exact ambiguity
problem for owner cross-referencing; its distinctive-core rules (multi-token core, or a
single token ≥8 chars not in the industry/geo denylist) are the precedent. Do not re-derive
a similarity threshold.

Fuzzy candidates go to a **Decision Center lane** (`decision_type='contact_company_link'`)
carrying the contact, the candidate owner, the shared core, and the owner's `rank_value` so
the lane is value-ranked. Verdicts: `link` (writes the edge via the same helper) /
`not_a_match` (records, stops asking) / `research`.

Follow the established lane pattern in `admin.js` + `ops.js` — federated or seeded per the
existing partition rules, and keep `test/decision-center-partition.test.mjs` green.

### Unit 3 — report what actually moved

Response/summary must include: `edges_created`, `owners_gaining_first_contact`,
`owners_in_worklist`, `owners_ge_1m`, `ambiguous_to_review`, `skipped_guard`. The headline
number to verify against is **owners-with-a-person: 92 → expected ~1,000**.

---

## Explicitly OUT of scope

- **Minting new person entities.** ~11,600 unified rows carry an `sf_contact_id` with no
  LCC identity. Creating those would grow the entity graph ~20% and is a separate decision
  on its own evidence (Scott's call, 2026-07-21). **Do not mint.** This round only connects
  people who already exist as entities.
- The ~14,400 rows whose only key is `recorded_owner_id` — there is **no
  `recorded_owner` source_type in `external_identities`** (verified: only `true_owner`,
  gov 8,866 + dia 6,514), so they have no bridge. Some will be reachable via company
  matching once they have a person entity; the rest need the minting decision first.
- Phase 2 (incremental reconcile tick, merge-queue worker that can reach past the top ~200
  rows, scheduled `engagement_score` recompute) and Phase 3 (Outlook contact ingest,
  received-mail harvesting, bounceback parsing, signature-block extraction).

## Boundaries

LCC-Opps only · no SF writes · no dia/gov writes · no migration expected · every edge
reversible by `metadata.via` batch tag · reuse `linkPersonToEntity` /
`owner-cross-reference.js` / existing normalizers — **do not fork a matcher** · ambiguity
is reviewed, never guessed · no new `api/*.js`.

## Verify

1. `npm run check:boot`, `npm run verify:deploy`, full suite.
2. **Dry-run first**, report the counts, then apply.
3. Owners with a person attached: **92 → report the real number**.
4. `entity_relationships` grew by ~the edge count (~1,200), not by tens of thousands.
5. Queue refresh stayed low single-digit seconds:
   `select duration_ms from lcc_refresh_log where refresh_name='lcc_refresh_priority_queue_resolved' order by refreshed_at desc limit 5;`
6. Report the priority-queue band shift — owners gaining contacts should move out of
   P-CONTACT / the contactless worklist into outreach bands. That is the intended outcome;
   confirm it happened rather than assuming.
7. Rehearse reversal: show a batch tag can be removed cleanly.
