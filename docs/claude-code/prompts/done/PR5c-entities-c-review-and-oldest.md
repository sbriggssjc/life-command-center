# PR5c-entities-c-review + -oldest — prepare the 15 genuine pairs for a one-decision merge, and SIZE the "oldest row wins" attach defect before anyone proposes a gate

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`**. Two halves, both
measurement-first. **No merges in this prompt** — the merge is Scott's per-row confirm; you build the
plan he confirms against. **No behaviour change to `ensureEntityLink`** — you size the population
the change would touch.

**Read first:** `docs/architecture/entity-identity-and-dedup.md` (§1 model incl. the banned
comparators, §2 live state, §4 the P195/N15c/dupes/entities-c lessons verbatim) → backlog
**PR5c-entities-c-review**, **PR5c-entities-c-oldest**, **N15e** → `docs/audits/PR5c_entities_c_EMAIL_TIER_DOMAIN_SCOPE_2026-09-03.md`
§4 and §6 → the P195 merge machinery (`lcc_p195_merge_byte_identical` dry-run default, winner rule
`owns_assets → current_rent → portfolio_facts → external_ids → relationships → created_at → id`,
snapshot BEFORE merge, `lcc_p195_unmerge`) and the A2a plan/ledger pattern
(`v_lcc_a2a_ambiguity_merge_plan`, `lcc_a2a_merge_log`, `lcc_a2a_unmerge`).

Deploy: `/version` via `net.http_get('https://tranquil-delight-production-633f.up.railway.app/version')`;
nothing here needs a redeploy.

## Half 1 — the 15 genuine pairs, as a plan Scott confirms row by row

1. Re-derive the 15 from `v_lcc_entity_email_tier_blind_pairs` with a stated predicate (do NOT
   hand-pick from the audit's list — the view is the population; state which rule selected the 15
   and why the other 40 fail it). Expect: same non-generic email, both person-typed, canonical names
   that differ only by a nickname/expansion (`Andy`/`Andrew`, `Nick`/`Nicholas`, `Vince`/`Vincent`,
   `Ravi`/`Ravindra G.`). **If the rule needs a name-similarity score, stop** — that is the banned
   comparator; the honest answer is then "human read, no rule", and the plan carries `basis='human_read'`.
2. For each pair, compute the winner by the P195 rule, and the delta a merge would move: portfolio
   facts, relationships, external identities, pivot rows, current rent. Emit
   `v_lcc_entities_c_review_merge_plan` (read-only, **no `auto_mergeable` column**, P198) with
   winner / loser / basis / deltas / `reversible=true`.
3. **Run the P195 round trip on ONE pair, rolled back** (merge → unmerge → compare): 0 lost / 0
   new / 0 changed. A reversal never run is a claim (P195).
4. Hand Scott the confirm: one SQL per row (`select lcc_merge_entity(loser, winner)` with the
   snapshot-first wrapper P196 added), or one batched function with a dry-run default and a batch
   tag. **Do not run it.**

## Half 2 — size the "oldest row wins" defect

The email tier resolves `order=created_at.asc&limit=1`: an inbound real person attaches to the
oldest row on that mailbox even when it is a P131 document row label (`Income & Expenses` predates
the real broker on `alex.sharrin@am.jll.com`). Within a domain this is live today.

1. **Population:** for every non-generic email held by ≥2 live entities in the SAME domain and
   workspace, is the OLDEST row person-shaped (`isPersonShaped` / `lcc_looks_like_person` AND not
   `lcc_p131_is_document_row_label` AND not `isJunkEntityName`)? Count mailboxes where the oldest
   row fails — those are the mailboxes where the next inbound person attaches to junk. Quote the
   count and the top 10 by inbound frequency (SF campaign membership / correspondence volume).
2. **Has it already happened?** Rows whose `email` matches an older junk-shaped row and whose own
   name is person-shaped, created after the junk row — i.e. the attach that DID land, or the
   duplicate the junk row forced. Count, named rows.
3. **What would a "prefer person-shaped" rule do wrong?** Run it as a query only: for the same
   population, does preferring the newest/most-evidenced person-shaped row over the oldest ever pick
   a DIFFERENT real person (the Jack Minter / Creighton Stark shape — two real people on one
   mailbox)? Count those; that is the rule's false-attach rate. **Report, do not ship.**
4. Verdict in one sentence: is -oldest worth a gate (rate, blast radius), or is the right fix
   retiring the junk rows (P131 row labels minted as entities — how many, and is there a sweep)?

## Verify on

- Half 1: plan view rows = 15, each with a stated basis; round-trip 0/0/0 on the sample pair;
  `auto_mergeable` count unmoved; nothing merged.
- Half 2: three counts with the queries quoted; a named-row table for the top 10; a verdict.
- `v_lcc_canonical_name_drift` still 0.

## What NOT to do

- No merges. No `ensureEntityLink` change. No name-similarity comparator anywhere in a predicate.
- No sweep of the P131 row-label entities here — size it, file it (it has its own reversibility
  question: `junk_entity_review` + `unstampMisparseMember` exist for the TM-misparse class; check
  whether row labels already route there before proposing a new one).

## Report back

The 15-row plan with basis + deltas · the round-trip proof · the confirm SQL for Scott · the
three -oldest counts + top-10 table · the verdict · anything that outranks this.
