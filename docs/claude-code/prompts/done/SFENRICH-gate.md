# SFENRICH-gate — commit the deployed body of `salesforce-enrichment`, then put the COPILOT-OPEN door on it

> **DRIFT1-sfenrich (🔴 since 2026-09-07):** `salesforce-enrichment` on Dialysis_DB (v23, deployed 2026-03-07,
> `verify_jwt:false`) runs a 15-step write pipeline against `contacts`, `true_owners`, `salesforce_activities`,
> `contact_links`, `touchpoint_schedule` on any `POST /run` — **no credential of any kind**, CORS `*`; `GET
> /diagnostics` leaks row and gap counts. Two things make it a different unit from COPILOT-OPEN-gate (PR #2214,
> the pattern to copy): **(1) the function's source is NOT in this repo** — `supabase/functions/` has no
> `salesforce-enrichment/`; the only copy is the deployed body. `sf-test` was deleted on 2026-09-09 with its body
> never captured; this unit does not repeat that. **(2) it had zero callers in `function_edge_logs` over the last
> 24 h** (2026-09-08 → 09-09) — which is a reason to ship the gate log-only and read the window, not a reason to
> skip it: a monthly or ad-hoc caller is invisible in one day. Two data-quality findings on this function
> (name-equality identity writes in steps 3 and 8B; curated BD columns written with no provenance ladder) are
> **filed, not fixed here** — see the DRIFT1-sfenrich row.

**Repo:** `life-command-center` · **Code: one new function directory (the committed body, verbatim), one gate
block in its router, tests. No behaviour change in log mode. One deploy (Scott).** Branch → PR → CI green →
merge.

**Read first:** `supabase/functions/ai-copilot/index.ts` lines 1–80 (the gate as shipped — copy it, do not
redesign it) · `supabase/functions/_shared/auth.ts` (`authenticateWebhook`) · `docs/os/PLANNED-BACKLOG.md`
DRIFT1-sfenrich (the 2026-09-07 body read: what the 15 steps do, and the two findings) ·
`docs/architecture/edge-function-deploy-drift.md` § 2026-09-09.

---

## Unit 1 — capture before touching (the `sf-test` lesson)

Fetch the deployed body (Supabase MCP `get_edge_function`, project `zqzrriwuavgrquhisnoa`, slug
`salesforce-enrichment`) and commit it **verbatim** as `supabase/functions/salesforce-enrichment/index.ts` (and any
sibling files it returns) in its own first commit, message `chore(sfenrich): commit deployed v23 body verbatim —
never in repo`. Record its `ezbr_sha256` from `list_edge_functions` in the commit body so the next reader can
prove the copy is the deployed one. **No edits in this commit.** If the MCP is not available to you, stop and say
so — Scott can `supabase functions download salesforce-enrichment --project-ref …` and hand you the file; do not
reconstruct it from the May audit's description.

## Unit 2 — the door

Second commit. In the router, before dispatch:

- `GET /health` (if it exists — read the body; if the only read route is `/diagnostics`, that one is **not** a
  health probe and is gated) → open.
- Everything else → `authenticateWebhook(req)` from `../_shared/auth.ts`.
- `SFENRICH_AUTH_MODE`: `log` (default) → `[sfenrich-auth] DENY-WOULD <method> <path> <ua_class> <ip_class>` and
  continue; `enforce` → 401. Reuse `COPILOT_KNOWN_IPS` for the IP classes (same project, same callers) — do not
  introduce a second list; factor the two classifier helpers out of `ai-copilot/index.ts` into
  `_shared/caller-class.ts` and import them from both, with a test that the two functions' output for a fixed
  set of UA/IP pairs is unchanged after the move.
- `verify_jwt = false` pinned in `supabase/config.toml` under `[functions.salesforce-enrichment]` with the dated
  comment, like the three above it.

## Unit 3 — `dry_run` is the only input; make it honest

The May read found the only request data the body reads is `dry_run` and the path. Confirm from the committed
source; if true, add one line to the response doc stating it with the line number. If **anything else** from the
request reaches a query — even a table name or a limit — stop and report; that changes the severity back up.

## Unit 4 — tests

`test/salesforce-enrichment-auth-gate.test.mjs`, structural, mirroring `test/ai-copilot-auth-gate.test.mjs`: gate
before dispatch; `log` never 401s; `enforce` 401s with `unauthorized` only; no hardcoded IP; the committed body's
SQL steps are string literals with no request-derived interpolation (grep for `${` inside the query strings —
positive control: a synthetic body with one interpolation fails).

## Unit 5 — docs

- `docs/architecture/edge-function-deploy-drift.md`: dated section — body committed (sha), gate v23 → v24
  log-only, flip procedure.
- `docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`: `SFENRICH_AUTH_MODE`; `COPILOT_KNOWN_IPS` now shared.
- `docs/os/PLANNED-BACKLOG.md`: DRIFT1-sfenrich → 🟡 (body in repo, gate log-only; enforce after the window;
  the two data-quality findings stay open as their own lines under the row — do not fold them).
- STATUS entry; response `docs/claude-code/responses/SFENRICH-gate.response.md`.

---

## Out of scope — say so

- Fixing steps 3 / 8B (name-equality identity) or the provenance-ladder gap — separate, larger, and they need the
  CONTACT1 ladder machinery, not a gate.
- Disabling the pipeline, changing its schedule, or deciding whether it should run at all (Scott).
- The `enforce` flip.

## Deliverables / Verify on

- Two commits in order: verbatim body (diff against the deployed file is empty — show the `ezbr_sha256` and a
  `sha256sum` of the committed file side by side, noting they are different hashes of different things and the
  proof is the MCP fetch date, not hash equality), then the gate.
- Deploy: `supabase functions deploy salesforce-enrichment --project-ref zqzrriwuavgrquhisnoa --no-verify-jwt`
  → v24 (👤 Scott). One `curl` with no header → allowed + `DENY-WOULD` line; with header → no line. Paste the line.
- `npm test` green, 0 live calls.
