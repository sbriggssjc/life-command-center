# Claude Code prompt — R9 follow-ups: connect cron + two minting guards

Paste into Claude Code, run from the **life-command-center** repo. Three small
units following the R9 close-out (drain verified live 2026-06-07: 209
developers tagged, ledger 1:1, candidates 0; classify + reconcile crons
applied; chain-connect at gov 31 / dia 29 props with zero errors).

## 1. Chain-connect cron (the drain won't drive itself)

The connect worker (`/api/chain-connect-tick`) has no cron — the classify and
reconcile crons landed in `20260609160000`, but connect was left manual. The
universe is gov 2,912 / dia 575 chain properties; at 10/tick manual it never
drains.

- New migration registering `lcc-r9-chain-connect` via `lcc_cron_post`
  (vercel path), same idempotent unschedule-then-schedule DO-block pattern
  with distinct dollar-quote tags (the R6 nested-`$$` lesson).
- Cadence: every 30 min, `limit=10` per tick (the proven safe batch — 25
  through the proxy hit gateway timeouts during R9 testing; if `lcc_cron_post`
  → pg_net direct tolerates more, ground it with one live POST before raising).
  Alternate domains per tick or pass `domain=both` if the worker supports it —
  at 10 props/30min the gov backlog alone is ~60 days, so if a single tick can
  safely do gov+dia 10 each, do that.
- The ledger cursor (`lcc_chain_connection_log`) already makes re-ticks
  idempotent; the worker is time-budgeted. Route is live, so the cron
  migration can apply immediately (no deploy-ordering hold) — but state that
  explicitly in the migration header either way.

## 2. Address-fragment guard in `isJunkEntityName`

The connect drain minted **"West Mall Dr"** (dia) as an organization — a bare
street fragment from an ownership row. `isJunkTenant()` already rejects street
fragments (`Foo Ave N`, `Bar St SW`) but `isJunkEntityName()` does not.

- Port the street-fragment pattern into `isJunkEntityName` (entity-link.js,
  the choke point): bare `<words> + (St|Ave|Blvd|Dr|Rd|Ln|Pkwy|Hwy|Way|Ct|Cir
  |Ter|Pl)( N|S|E|W|NE|NW|SE|SW)?$` with NO firm suffix and NO personal-name
  shape. Keep it anchored and conservative — "Boulevard Capital LLC" and
  "Parkway Properties" must still pass (the directional/suffix-only shape is
  the signal, not the road word itself).
- Sweep existing entities for rows matching the new pattern (created by the
  connect worker or earlier writers) and soft-flag them into the
  junk_entity_name lane (`metadata.junk_name_flagged`, the R7-2.5 pattern) —
  never hard-delete. Report the count; spot-check 5 against their source rows
  before flagging (a real business named like a street should survive).
- Add the test strings to whatever unit coverage the guard has.

## 3. Pipe-delimited composite owner names

Chain/classify candidates like **"Chad Middendorf | Green Rock USA"** and
**"Vincent Curran | Palestra Real Estate Partners, Inc"** mint as single
entities — and their components ("Chad Middendorf", "Palestra Real Estate
Partners") often exist separately, sometimes both tagged developer and both
now sitting in P0.4. The pipe is a CoStar capture convention: usually
`<person> | <firm>`.

- At the mint boundary (entity-link.js, beside the other guards): when a
  candidate name contains ` | `, split on it. If one side passes
  `looksLikePersonName` and the other looks like a firm, DON'T mint the
  composite — link/mint the FIRM as the owner entity and (where the contact
  machinery supports it) attach the person as a related contact (the
  buyer-contact picker's person→org `associated_with` pattern). If the split
  is ambiguous (both firms, 3+ segments), mint the firm-most segment and
  record the original string in metadata (`metadata.composite_source_name`)
  so nothing is lost.
- Existing composites: sweep entities whose name contains ` | `, classify
  splittable vs ambiguous, and route them to the merge/junk lanes as
  REVIEW candidates (auto-merge ONLY where the firm side exactly matches an
  existing live entity name, the exact-merge worker's SAFE rule). Report the
  split: how many composites, how many auto-resolvable, how many to lanes.
- Watch the ledger interplay: if a composite was tagged developer and its
  firm component absorbs it, the developer role must land on the surviving
  entity (lcc_merge_entity preserves roles — verify on one pair) and the
  classification ledger row should be repointed or annotated.

## Verify + ship
- Unit 1: cron registered + one observed tick in `cron.job_run_details`
  advancing the connect ledger.
- Unit 2: guard rejects "West Mall Dr" / passes "Parkway Properties LLC";
  sweep count reported; 5 spot-checks.
- Unit 3: one composite resolved end-to-end live (firm entity carries the
  role, person attached, ledger consistent); lane routing counts reported.
- House rules: `node --check`; 12 functions; migrations idempotent; crons
  after routes (route already live); effect-first/outcome-truthful; zero
  hard-deletes; report per-unit status.
