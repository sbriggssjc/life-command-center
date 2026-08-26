# Prompt 132 — Research-page task list is dead: PostgREST dual-`users` embed collision

## Symptom (live, 2026-08-26)
Every lane on the Research page renders **"0 tasks / No research tasks match this filter"**, for
every lane and every status filter — even though `?view=research_lanes` correctly reports open counts
(e.g. `establish_ownership_history` = 545 open, `answerable: true`). The v1 path returns the generic
`{"error":"Failed to fetch research tasks"}` (500); the **v2 path leaks the real PostgREST error**:

```
GET /api/queue?_version=v2&view=research&status=active&research_type=establish_ownership_history
→ {"view":"research","items":[],"error":"table name \"research_tasks_users_1\" specified more than once", ...}
```

## Root cause
Both research branches embed the `users` table **twice** (assignee + creator) via two FK hints with
**no distinct alias**, so PostgREST assigns both the same internal alias (`research_tasks_users_1`) and
aborts the query. `api/queue.js`:

- **v1** line ~154 (`case 'research':`)
- **v2** line ~468 (`v2GetResearch`)

Both use:
```
select=*,entities(name),users!research_tasks_assigned_to_fkey(display_name),users!research_tasks_created_by_fkey(display_name)
```

This means the **entire operator-facing Research task list has been unreachable** — which is why every
research lane reads "0 completions ever" (Dead-End playbook Class 3: surface exists but cannot display/
capture; Class 7: a capability that exists but is unreachable). It also currently hides the 453
P131 ownership-chain drafts (they attach onto the card via `attachOwnershipChainDrafts`, but no card
renders).

## Fix — name each embed (PostgREST alias syntax `alias:table!fkey(...)`)
In **both** branches, change the select to:
```
select=*,entities(name),assignee:users!research_tasks_assigned_to_fkey(display_name),creator:users!research_tasks_created_by_fkey(display_name)
```

Then update the row-mappers to read the aliased embeds:

**v1 (`case 'research':`, ~line 168–171):**
```js
const items = rows.map(r => ({
  ...r,
  entity_name: r.entities?.name || null,
  assignee_name: r.assignee?.display_name || null
}));
```

**v2 (`v2GetResearch`, ~line 483–487):**
```js
const items = rows.map(r => ({
  ...r,
  entity_name: r.entities?.name || null,
  assignee_name: r.assignee?.display_name || null,
  creator_name: r.creator?.display_name || null
}));
```

(Drop the old `r['users!research_tasks_assigned_to_fkey']?.display_name` / `r.users?.display_name`
bracket reads — the named alias replaces them.)

## Guard against silent recurrence
Add a regression test (extend an existing `test/` queue test or add
`test/research-view-embed.test.mjs`) that asserts:
1. The v1 and v2 research `select=` strings contain **no** bare `users!` embed without an alias prefix
   — i.e. every `users!...fkey` occurrence is preceded by `<alias>:`. (Structural string assertion on
   the built path, so it can't rot.)
2. Optionally, a live-shape assert if the suite has DB access: `?view=research&status=active` returns
   HTTP 200 and does not carry the substring `specified more than once`.

Anchor the string assertion on the exact embed tokens, not a line number.

## Also sweep for the same pattern elsewhere
Grep `api/` for any other `users!...fkey(` embed that appears **twice against the same table in one
`select=`** without aliases (my_work / team / inbox queue views, entity handlers, dossier). Fix any
found the same way. Report what you found (even if none).

## Verify
- After redeploy: `GET /api/queue?view=research&status=active&research_type=establish_ownership_history`
  returns 200 with `items.length > 0` and `count` ≈ 545.
- The Research page lane list now shows cards; each `establish_ownership_history` card shows its
  attached ownership-chain draft (`chainDraftHTML`).
- `npm run verify:deploy` green; new test green.

## Deploy
Railway redeploy of merged `main` (JS-only). No migration. Commit with the repo's
Co-Authored-By + Claude-Session trailer.

## Why this matters
This is the gate on the entire R1 ownership-chain review (453 drafts) **and** on every other research
lane operators are supposed to work. It has been failing silently — the lane badges show healthy
counts while the list itself 500s. Assert on the state delta (`items.length`), never the badge.
