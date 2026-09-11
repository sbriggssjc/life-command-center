# PDR2 — close the operator-as-owner guard gap in `assemblePropertyPacket` (systemic, ~4,026 properties)

**Repo: `life-command-center`.** Code-only read-path fix; no domain-DB writes expected.

**Read first:** `docs/os/PLANNED-BACKLOG.md` §P17 **PDR2** (root cause + blast radius, measured 2026-09-11)
and **PDR13/PDR14** (the shared dia-dedup cause, now shipped — context only) · `docs/claude-code/STATUS.md`
entry "2026-09-11 — PDR2/PDR3/PDR6 root-caused" · `CLAUDE.md` "Core doctrines" + "Known footguns" ·
`.github/AI_INSTRUCTIONS.md` (required before touching `/api/`).

## Why this, why now

`get_property_context` (via `api/operations.js` `assemblePropertyPacket()`, ownership block ~lines
8811–8830 as of commit `0128336e`) resolves `lease_data.true_owner_id → true_owners.name` **unconditionally**
and returns it as `ownership.true_owner_name` — it never selects or checks `is_operator_not_owner`. So when
a property's `true_owner_id` points at an operator placeholder row (e.g. dia `true_owners` "DaVita Kidney
Care", correctly flagged `is_operator_not_owner=true`, `owner_role='operator'`), every consumer of the packet
is told **the tenant owns the building**. The flag is right; the read ignores it.

Measured live 2026-09-11 (read-only): **1,182 properties point at that one DaVita placeholder; 4,026
properties fleet-wide have `recorded_owner_id IS NULL` and `true_owner_id` → an `is_operator_not_owner=true`
row.** This is a guard-gap bug with a four-figure blast radius, not a DaVita defect. The repo already has
the correct pattern twice — mirror it, don't invent a third:
- `api/_handlers/entities-handler.js` `assemblePropertyDossier` §1.6 (~lines 742–751): looks up
  `is_operator_not_owner`, and if set treats the name as the **operator**, falling back to the recorded owner
  for owner-of-record.
- `api/_handlers/sf-link-reconcile.js` `isOperator()` (~line 270): `is_operator_not_owner` OR
  `owner_type='operator'` OR `owner_role='operator'`.

Note the dossier path calls `assemblePropertyPacket` first and then re-guards on top — so the dossier is
right, but every *other* consumer of the packet (MCP `get_property_context`, `mcp/context-assemble.js`
`assemblePropertyPacketViaApi`, and anything else that reads `ownership.true_owner_name`) is not.

## 1. Measure first (read-only)

Re-measure the blast radius before building — do not quote the 4,026 above as today's number. Report:
(a) count per domain (`dia` and `gov`) of properties whose `true_owner_id` → an operator-flagged row,
split by `recorded_owner_id` null vs. not-null; (b) **confirm whether gov's `true_owners` even has
`is_operator_not_owner` / `owner_type` / `owner_role`** — this was not established in the investigation;
if the column doesn't exist on gov, say so and make the guard degrade safely (no-op, never throw) there.

## 2. Fix the packet at the source

In `assemblePropertyPacket`'s ownership block: select the operator signals alongside `name`, apply one
shared predicate (extract `isOperator()` to `api/_shared/` if that's the cleanest way to have one
definition — your call, say which), and when the true owner is an operator:
- do **not** return it as `ownership.true_owner_name`;
- surface it explicitly instead (e.g. `ownership.true_owner_is_operator: true` + `ownership.operator_name`
  — match any field names the packet/dossier already use rather than coining new ones);
- leave `recorded_owner_name` as the owner of record. When `recorded_owner_id` is also null, the honest
  answer is "owner unknown" — never backfill with the operator.

Then make `entities-handler.js` §1.6 consume the packet's verdict rather than re-querying, **only if** that
doesn't change dossier output (prove it with a test); otherwise leave it and say why.

## 3. Audit the other true-owner readers — report, fix only what's clearly the same bug

Candidates found by grep (not yet assessed — do not assume any is buggy): `api/admin.js` ~5600 (owner-name
fetch for the owner-reachability sweep), `api/_handlers/intake-promoter.js` ~2027 (dia) and ~2198 (gov)
(`result.true_owner.resolved_name`), `api/operations.js` ~562 and ~2169–2186 (the latter already honors
`true_owner_is_operator`), plus `sidebar-pipeline.js` true-owner lookups. For each: does it present a true
owner's name *as the owner* to a user/agent/SF write? Fix the ones that do with the same predicate; list the
rest with a one-line reason they're fine. **Do not touch any Salesforce write-back logic** beyond reporting.

## 4. What NOT to do

- No writes to `true_owners`, `properties`, or any domain table — the data is correct; this is a read fix.
  Do not "repair" the 4,026 rows by re-pointing `true_owner_id`.
- Do not touch PDR12 (Rock Hill planner), PDR14/14b machinery, or the 167 `needs_human` entities.
- Do not edit any file whose header says GENERATED; canon/surface instruction files are out of scope.

## Guard + ship

Mutation-guarded tests (pure where possible, stubbed `_domainGet`/`deps`): operator-flagged true owner is
never returned as `true_owner_name` (for each of the three signals); non-operator true owner unchanged;
recorded owner preserved; both-null → no owner, no operator backfill; gov without the column → no throw.
`npm run check:boot` green. **Live positive control after deploy:** `get_property_context` for entity
`d90be440-c4f2-4e6c-a50e-8a0be44c9d76` (DaVita/Donna-TX, dia `property_id=39874` per PDR14b) must no
longer name DaVita as owner — report exactly what ownership it shows, plus 2–3 other sampled properties
from the §1 measurement, before/after.

## Ship + record

Branch → PR → CI green (main is protected). `STATUS.md` entry with the re-measured blast radius (per
domain), the audit table from §3, and the live before/after. `PLANNED-BACKLOG.md` PDR2 row updated to its
real outcome.
