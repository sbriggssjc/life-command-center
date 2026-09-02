# PR5c-entities-b-dupes — the Salesforce bridge mints a duplicate on 4.3% of creates; find the mechanism, then fix the LOOKUP, not the rows

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. Diagnosis first — the
14 named rows are the evidence, and the fix is whatever single predicate in `findEntityForUpsert`
(`api/_shared/bridge-handlers-salesforce.js:209`) let them through. **No merges in this prompt.**
Merging is a separate, reversible decision (`lcc_merge_entity` / P196) once the mechanism is known.

**Read first:** backlog **PR5c-entities-b-dupes** and **N15c-D / N21** (`PLANNED-BACKLOG.md`);
`docs/audits/PR5c_entities_LADDER_WIRED_2026-09-02.md` §5; `CLAUDE.md` § N15c (canonical_name has ONE
writer — a trigger — and `ensureEntityLink` dual-reads); § "account-based contact intelligence"
(*people change firms — track where they went*, which is why 6 of the 14 must NOT be merged on name).
Deploy: live `/version` = `886cdf86` (read via `net.http_get` from the DB — see `CLAUDE.md` provenance
invariants for the URL trap).

## The population (re-derive the 14 in one query and keep the ids)

Of 336 `salesforce/Contact` identities in 30 days, 329 minted an entity and **14 landed on a
`canonical_name` an older LIVE entity already held**. 8 of 14 share the older row's email
(Adam Gallistel, Blaze Katz, Frank Johnson ×2, John Rooney, Nick Taylor, Ransome Foose, W. Aaron
Poling); 6 differ by email and read as firm changes (Kari Fiske, Rene Ristau, …). Same workspace,
not a race (2 of 8 within 5 min).

## Test these mechanisms, in order, on the 8 email-sharing pairs — each is one query

The lookup is `entity_type=eq.person & email=ilike.<email> & workspace_id=eq.<ws> & limit=1`.
For each older row, which of these is true?

1. **`entities.email` on the OLDER row is not where the email lives.** "Shares the email" — from
   which column? If the older row's `entities.email` is NULL and the address sits on
   `unified_contacts`, `external_identities`, or `metadata`, the lookup is correct and BLIND by
   design. Count: older rows with `email IS NULL`, and where the address actually is.
2. **`entity_type` on the older row is not `person`** (`organization`, NULL, `asset`). C13c
   measured 76 org-typed entities carrying a `salesforce/Contact`; the lookup filters on
   `person` first.
3. **Case / whitespace / encoding.** `ilike` with no wildcard is a case-insensitive EXACT match.
   A trailing space, a `+` in the local part (URL-decoded to a space unless `pgFilterVal` encodes
   it), a `%`/`_` (which ilike treats as wildcards — check `pgFilterVal`), or a non-ASCII
   character breaks equality. Compare `lower(btrim(older.email))` to the bridge's payload email
   byte-for-byte; show the bytes where they differ.
4. **`workspace_id` on the older row differs or is NULL.** CC said same workspace — confirm on
   `entities.workspace_id` specifically, not on a derived view.
5. **The older row is a tombstone that reads live.** `merged_into_entity_id IS NULL` but
   `metadata->>'merged_into'` set (the N15f `[MERGED]` bypass), or `status`/`archived` flags.
6. **The older row was created AFTER the bridge's lookup ran** — i.e. both are new and the
   "older" one is the bridge's own earlier create in the same run. Check `created_at` deltas at
   second resolution, and whether both carry a `salesforce/Contact` identity.

Then for the 6 firm-change pairs: confirm they are NOT duplicates (different email domains, both
rows legitimate) and state that the correct treatment is an `entity_relationships` "moved to"
edge or a `works_at` change — **filed, not built** (`account-based-contact-intelligence.md` §5a).

## Fix — only the predicate the evidence names

- If (1): the lookup gains a second arm over `external_identities`/`unified_contacts` by email —
  ONE extra GET, and ONLY if the measured share justifies it. Do not fuzzy-match on name.
- If (2): decide whether an org-typed row with the same email is the same party (C13c says a
  `salesforce/Contact` on an org-typed row is a **person mis-typed as org**) — if so, drop the
  `entity_type` filter for the EMAIL arm only, and file the retype as C13g's.
- If (3): fix `pgFilterVal` / the ilike pattern (escape `%`/`_`, encode `+`) and normalise with
  `lower(btrim())` on both sides. Guard with the exact 8 addresses as fixtures.
- If (4)/(5)/(6): name it and fix the one predicate.
- **Rolled-back proof:** replay each of the 8 creates' payloads through the fixed lookup; all 8 must
  resolve to the older id. Positive control: a genuinely new email must still return null.
- **Do NOT merge the 14 here.** Emit them as a review list (`v_lcc_sf_bridge_duplicate_mints`,
  read-only, no `auto_mergeable` column — the P198 rule) with the mechanism column filled, so the
  merge is one human decision per row with the reason attached.

## Verify on

- Mechanism attribution: 8 of 8 email-sharing pairs explained by a named predicate (or the honest
  split if two mechanisms).
- Post-deploy, over the next 30 days: duplicate-mint rate on the bridge **4.3% → ≤ N15c's 0.48%**,
  measured by the same query (creates landing on an existing live key). Quote the query.
- `v_lcc_canonical_name_drift` still 0; `field_provenance where source='salesforce'` still
  accruing (~12/day).
- The review view: 14 rows, mechanism named on each, 0 auto-merged.

## What NOT to do

- No `nameSimilarity` / `lcc_normalize_entity_name` / `strict_core` for identity (banned; every
  section of CLAUDE.md on this). No merges. No change to `insertEntity` (PR5c-entities-b owns it).
  No retyping of entities here (C13g).

## Report back

The mechanism table (8 rows: older id · which test failed · the byte-level evidence) · the 6
firm-change rows confirmed non-duplicate · the one-predicate fix + rolled-back 8/8 proof · the
review view · the 30-day rate query · anything that outranks this.
