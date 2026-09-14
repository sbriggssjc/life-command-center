# BROKER1 — assign every prospect to a Team Briggs broker, in LCC and (minimally) in Salesforce

**Repo: `life-command-center`.**

**Read first:** `api/_shared/roe.js` in full (the existing "who's pursuing this" signal — SF Account
OwnerId + dia `salesforce_activities.assigned_to` + `brokerClass()` self/nm_other/outside/unknown —
this prompt reuses its classification, does not rebuild it) · `api/_shared/external-user-mappings.js`
(`resolveExternalUser` — SF OwnerId → LCC `users.id`, the existing resolver for "which of our people is
this") · `docs/architecture/ownership-truth-pipeline-state.md` Stage 5 (LCC's existing, narrow
write-back-to-Salesforce doctrine — "never merely to sync," direct team benefit only) ·
`docs/os/PLANNED-BACKLOG.md` §P17/§P3 for how this connects to the ownership/contact-propagation arc
this is part of.

## Why this, why now

Scott's direction (verbatim): **"ensuring each prospect has been assigned to a Team Briggs broker in
the LCC app for prospecting and in SF (but only the minimum necessary for rules of engagement but
enough to connect back to the robust and complete data in the LCC app)."**

Today there is no durable, queryable "which Team Briggs broker owns this prospect" field anywhere.
`roe.js` computes a *live* verdict for one contact/account at a time (Contact 360 panel, on demand) —
it does not write or persist an assignment, and nothing sweeps the whole prospect population with it.

**Scott's assignment rule, verbatim, to build exactly — do not infer a different one:**
> Existing ROE will dictate. If a Team Briggs broker is already pursuing, use that broker. If not,
> usually all government prospects are Scott's. Almost all dialysis are Kelly. Nate has been area
> ownership and his own research in urgent care so far so don't assign him anything yet. Use Scott as
> the catch-all for any questions.

Concretely:
1. **Signal first** — if `roe.js`'s existing logic already resolves an `assigned_broker` who classifies
   `self` (Team Briggs) for this prospect, that broker wins, full stop — do not override a real signal
   with a default.
2. **No signal → default by vertical** — `domain='gov'` → Scott; `domain='dia'` → Kelly.
3. **Nate gets nothing assigned in this pass** — he is explicitly excluded from the default population;
   do not assign him prospects even if some heuristic would suggest it.
4. **Scott is the catch-all** — anything that doesn't cleanly resolve by rule 1 or 2 (general net lease
   / `domain='lcc'`/`cre`, an ambiguous multi-signal case, a vertical with no stated default) goes to
   Scott, not left blank and not guessed.

## 1. Define "prospect" precisely before writing anything

Do not assume — measure. A "prospect" for this purpose is an owner/entity LCC is or could be pursuing,
not every row in `entities`. Find the existing pipeline/stage concept this repo already uses to
distinguish a prospect from a closed deal, a competitor, or a pure data-model row (check
`bd_opportunities`, `v_lcc_entity_roles`, any existing `pipeline_stage`/`deal_stage`/prospecting-status
field) and state which one you used and why. If more than one candidate exists, say so and pick the one
that matches how Scott and the team actually use the word "prospect" in the app today — ask if genuinely
ambiguous rather than guessing between two real candidates.

## 2. Resolve Scott/Kelly/Nate to real `users.id` values

Confirm these three (and Sarah, referenced elsewhere in the app, even though she gets no default rule
here) resolve to real rows in `users` — do not hardcode a name string as the assignment; store a
`user_id` foreign key. If any of the three doesn't have a clean `users` row, say so and ask rather than
minting one.

## 3. Build the assignment: sweep + a durable column, reusing `roe.js`'s signal

For every prospect (per step 1's definition):
- Call (or adapt, without duplicating) `roe.js`'s existing resolution path to get `assigned_broker` +
  `assigned_broker_class` + `assigned_broker_source` for that prospect.
- If `assigned_broker_class === 'self'`, resolve that name to a `users.id` (via
  `external-user-mappings.js` if the name traces to an SF OwnerId, otherwise the closest existing
  name-resolution path this repo has for a Team Briggs rep — do not build a second name-matcher) and
  assign it.
- Else apply the vertical default (rule 2), or Scott (rule 4) if no default applies.
- Write the result to a new durable column/table (your call on shape — a single `assigned_broker_user_id`
  column on the entity, or a small `entity_broker_assignment` table if a history of reassignment is
  worth keeping; state which and why). **Never silently reassign an existing manual assignment** — if a
  prospect already carries a human-set assignment (however that's recorded today, if at all), a fresh
  sweep must not overwrite it; only fill blanks, and log every write so it's auditable.
- Report the real counts: how many resolved via existing ROE signal (rule 1) / gov defaulted to Scott /
  dialysis defaulted to Kelly / fell to the Scott catch-all (rule 4) / already had a manual assignment
  and were left alone.

## 4. Minimal Salesforce connect-back

**"Minimum necessary for rules of engagement but enough to connect back"** — this is explicitly NOT a
full sync. Do not push the whole LCC ownership/contact record into Salesforce. Scope to: whatever
Salesforce already checks for its own ROE/ownership-conflict purposes (an Account/Contact Owner field,
a campaign or list membership — check what Salesforce's own rules-of-engagement mechanism, if any,
actually reads before assuming) plus a stable reference (an external ID or URL) a rep can use to open
the full record in LCC. Read `ownership-truth-pipeline-state.md` Stage 5's doctrine before writing
anything to Salesforce: "never merely to sync," write back only where it serves the team directly (here:
letting a rep see in SF who owns a prospect and jump to LCC for the rest). If Salesforce has no existing
field this maps to cleanly, say so and propose the smallest addition — do not invent a broad new SF
object.

## 5. What NOT to do in this pass

- Do not rebuild `roe.js`'s classification logic — call/reuse it.
- Do not assign Nate anything.
- Do not attempt a full Salesforce sync of LCC's ownership/contact data — that's explicitly out of
  scope and contradicts Scott's "minimum necessary" instruction.
- Do not touch the rest of the ownership→true-owner→contact pipeline (OWN-T0a, B1b, AC11, the AC2/AC3
  operator-action item) — those are tracked separately; this prompt is scoped to assignment only.

## Guard + ship

Mutation-guarded tests: a prospect with an existing manual assignment is never overwritten by the
sweep. A prospect with a live Team-Briggs ROE signal is assigned to that broker, not the vertical
default. Nate never receives an assignment from this pass. An ambiguous/no-default case resolves to
Scott, never left null. Positive control: pick 2–3 real live examples (one gov, one dialysis, one with
an existing ROE `self` signal if a real one exists) and confirm the assignment live, by direct query,
matches the stated rule.

## Ship + record

Branch of your choice. `STATUS.md` entry naming the real resolved-count split from step 3. **New**
`PLANNED-BACKLOG.md` row `BROKER1` for this item (search first — confirm no existing row already covers
broker/prospect assignment before filing a new one).
