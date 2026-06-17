# Claude Code — R39: contact/entity dedup — email as a write-time key + auto-work merge candidates

## Why (contacts audit, live 2026-06-16 — completes the dedup-at-source sweep after R37 sales / R38 listings)
The LCC entity graph (`entities`, person+org = 16,527 active) has the same re-capture
duplication shape, but **modest scale + the dedup machinery already exists** (so this is a
wiring/adoption fix, not a new build):
- **898 email-duplicate entity rows** (two+ active entities share an email), **109 created in
  the last 30 days, 11 in the last 7** — `ensureEntityLink` resolves by canonical_name /
  external_identity but **NOT by email**, so the same person captured under a slightly
  different name with the same email mints a new entity. Active, ~11/week.
- **`v_lcc_merge_candidates` already surfaces 436 fuzzy duplicate candidates** — the tooling
  SEES them, but they're not auto-worked, so the dupes persist.
- 210 junk-flagged + 75 "by broker" RCA fragments already route to the existing
  `junk_entity_name` Decision Center lane — no new work there.

## Doctrine (consistent with R37/R38)
Resolve/merge at the source so the graph is the accurate picture; reuse the EXISTING merge
machinery (`lcc_merge_entity`, `v_lcc_merge_candidates`, junk lane) — don't fork. Be
CONSERVATIVE: email is a strong but imperfect key (shared firm inboxes `info@`, assistant
emails), so auto-merge only high-confidence cases and route the rest to review.

## Unit 1 — email as a write-time resolution key (prevent-at-write)
In `api/_shared/entity-link.js::ensureEntityLink` (the single choke point), add email to the
resolution order: when an inbound contact carries an email that ALREADY belongs to an active
**person** entity, ATTACH to / update that entity instead of minting a new one. Guards:
- Person entities only for email-exact auto-attach (an org sharing a general inbox is weaker).
- Skip generic/shared inboxes (`info@`, `sales@`, `leasing@`, `admin@`, role addresses) — a
  small denylist; those don't identify a person.
- Respect the existing junk / implausible-person / federal-anti-pattern guards (don't attach
  to or create from garbage).
This stops the ~109/month new email-dups at the source.

## Unit 2 — auto-work the high-confidence merge candidates (reduce the 898 backlog)
Reuse `lcc_merge_entity` (reversible per its design) to collapse the unambiguous dupes:
- **Auto-merge** person pairs that are **email-exact AND name-compatible** (one name is a
  superset/fragment of the other, or normalized-equal) — same email + compatible name = same
  person, high confidence. Pick the richest survivor (SF identity > portfolio > most-complete).
- **Route the rest** (email-exact but name-INcompatible, org email-shares, fuzzy-only
  candidates) to the existing Decision Center merge/`v_lcc_merge_candidates` lane for one-click
  human merge — don't auto-merge ambiguous pairs.
- The "by broker" fragments (75) + junk (210) stay on the junk lane (no change).
- Bounded, reversible (lcc_merge_entity already snapshots backrefs); run as a one-time pass +
  let the candidates view + Unit 1 keep it clean going forward.

## Unit 3 (optional, light) — surface the merge backlog so it gets worked
436 candidates sit unworked. Confirm `v_lcc_merge_candidates` is rendered in the Decision
Center (it's a built lane) and ranked by value so the high-value dupes get merged first —
mirroring the R34 value-ranking. If already surfaced, just confirm; if not, wire it.

## Guards / house rules
- Reuse `lcc_merge_entity` + `v_lcc_merge_candidates` + the junk lane — no new merge engine.
  Conservative auto-merge (email-exact + name-compatible person only); everything else →
  review. Reversible. ≤12 `api/*.js` (Unit 1 is in `_shared/entity-link.js`). `node --check`;
  suite green. dia/gov domain `contacts` tables are the upstream source — they feed entities
  via the sidebar; fixing the entity choke point (ensureEntityLink) is the leverage point, but
  note any domain-contacts dedup as a follow-up if the upstream is also duplicating.
- Verify live: a re-captured contact with a known email attaches to the existing person (no
  new entity); email-exact+name-compatible person dupes auto-merged (898 drops materially);
  ambiguous pairs surfaced for review, not silently merged.

## Bottom line
Smaller and already-tooled vs R37/R38 — the fix is to make email a write-time identity key
(stop ~109/mo new dupes) and auto-work the unambiguous slice of the 436 merge candidates with
the existing reversible merge engine, routing the ambiguous rest to the human lane. Completes
the consolidate/merge/dedup-at-source sweep across sales, listings, and contacts.
