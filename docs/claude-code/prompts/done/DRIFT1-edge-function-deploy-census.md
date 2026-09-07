# DRIFT1 — 10 deployed edge functions have no committed source, and one of them cost us an investigation

> **GOVDUP1-a proved the cost.** `intake-salesforce` was deployed at **v23** against a **v1-era
> committed file whose header says it "never writes a domain table"** — while its
> `autoCreateProperty()` path POSTed 808 gov properties into existence. The search that concluded
> *"producer NOT FOUND"* read the committed file and was correct about it. **A producer whose
> deployed code is ahead of the repo is invisible to every code search, test, guard and reviewer.**
> That was treated as one bad function. **It is not: ten more are deployed with no committed source
> at all.**

**Repo:** `life-command-center` · **Projects:** LCC Opps (`xengecqvemvfknjvbvrq`), dia
(`zqzrriwuavgrquhisnoa`), gov (`scknotsqkcheojiaewwh`)
**Canonical page:** create `docs/architecture/edge-function-deploy-drift.md`, or extend
`docs/os/AI-SURFACES-OPERATIONAL-REFERENCE.md`'s deploy map — **pick one and say which**; do not
scatter this across three pages.

---

## 0. Standing rules

- **Census first, commits second.** Unit 1 is a measurement; do not start pasting source until the
  population is known and sized.
- **Do not deploy anything.** This unit reconciles the repo *to* the deployments; it must not change
  what is running. ⚠️ A "tidy-up redeploy" of a function whose committed source is stale would
  **roll production back** — that is the whole hazard, inverted.
- Counts below are dated **2026-09-06** and are a starting point, not the answer. Re-measure.

---

## 1. What is already measured

`supabase/functions/` holds **28** directories (including `_shared`). Deployments:

| project | deployed | slugs with **no** committed directory |
|---|---:|---|
| **dia** `zqzrriwuavgrquhisnoa` | 25 | `sf-test`, `salesforce-enrichment`, `test-function`, `ai-copilot-v2`, `w41-corpus-export`, `w43-sf-link-export` |
| **LCC Opps** `xengecqvemvfknjvbvrq` | 11 | `cortex-webex-sync`, `docai-diag` |
| **gov** `scknotsqkcheojiaewwh` | 2 | `bulk-import-awards`, `sam-entity-lookup` |

**≈10 deployed functions with no source in the repo at all**, plus **`intake-salesforce`, which has
source that is ~400 lines behind and actively misleading.**

⚠️ **"No committed directory" is not the same as "no source anywhere"** — some may live in the
**government-lease** or **Dialysis** repos, or in a gist, or nowhere. **Establish which, per
function, before proposing anything.** A function whose source is in a sibling repo is a
*pointer* problem; one with no source anywhere is a *reconstruction* problem. Different work.

---

## 2. Unit 1 — the census, per function

For each of the ~38 deployments across the three projects, record:

1. **slug, project, deployed `version`, `updated_at`, `status`**
2. **is there a committed directory?** If yes, **does the committed source match what is deployed?**
   — ⚠️ **The version number alone does not answer this**: `version` counts deployments, not
   content, and a function deployed twice from the same source reads v2. Compare something
   content-derived (the deployed entrypoint body, or a version string the source itself carries —
   `intake-salesforce` carries `sf-2026-05-v8` deployed vs `sf-2026-05-v1` committed, which is how
   the drift was named).
3. **does it write to any database?** — the GOVDUP1-a severity axis. A read-only or diagnostic
   function drifting is untidy; **a WRITER drifting is a producer nobody can audit.**
4. **is it live?** — last invocation if reachable, or whether a cron/PA flow/extension calls it.
   ⚠️ **`sf-test`, `test-function`, `docai-diag`, `ai-copilot-v2` read as scratch deployments** —
   confirm before assuming, and note that **an abandoned deployment that still answers is exactly
   the P194 stale-host shape**.

**Deliver the census as a table with a verdict per row**, not a total.

## 3. Unit 2 — commit what should exist, retire what should not

Two dispositions, decided per function from Unit 1:

- **Commit the deployed body** where the function is live and load-bearing. Start with
  **`intake-salesforce`** — it is the one already proven to have cost a real investigation, and
  `GOVDUP1-a-drift` is filed for exactly this. ⚠️ **Commit the DEPLOYED body verbatim; do not
  reconstruct it from the v1 file plus a guess.** Add a header naming the deployed version so the
  next reader can tell whether the file is current.
- **Retire the deployment** where it is scratch and dead — but ⚠️ **a deployment that still answers
  is not dead just because nobody remembers it** (P194: the retired Vercel host still served, still
  held a service key, and was writing rows). **Prove it is unreferenced before deleting**: no cron
  command names it, no PA flow, no extension URL, no `api/` caller. **If you cannot prove that, do
  not delete it — file it.**

⚠️ **Some of these may hold secrets.** `sf-test`, `salesforce-enrichment` and
`w43-sf-link-export` are Salesforce-shaped names on a project whose service key is powerful. **Check
whether a live deployment with no owner is also an unreviewed credential surface**, and if so say so
plainly — that changes the priority.

## 4. Unit 3 — make the next instance visible

The reason this is worth doing once is that it recurs silently. **Ship something that surfaces
drift** rather than relying on someone repeating this census:

- The cheapest honest option is a **documented operator check** in the deploy map: how to run
  `list_edge_functions` per project and compare against `supabase/functions/`.
- A repo guard can assert that **every committed function directory is deployed somewhere**, but it
  **cannot see the reverse** — a deployment with no committed source is invisible to any test that
  only reads the repo. **Say that limitation out loud rather than shipping a guard that implies
  coverage it does not have** (this repo has a standing problem with guards reporting more strength
  than they carry).

---

## 5. Out of scope

- **No redeploys.** Not even "to sync it up".
- **No behaviour changes** to any function.
- **No new edge functions.**
- **No `verify_jwt` or secret changes** — if the census finds one that looks wrong, record it and
  file it; changing an auth setting mid-census is how a working integration breaks.

## 6. Deliverables

1. The per-function census table (~38 rows) with a verdict each.
2. `intake-salesforce`'s deployed body committed verbatim, with a version header.
3. A named disposition for each of the ~10 sourceless deployments — commit, retire, or **filed with
   the reason it could not be decided**.
4. The Unit 3 mechanism, with its limitation stated.
5. Any credential-surface finding, called out separately from the tidiness findings.

## 7. Verify on

- **Deployed slugs with no committed source: 10 → n**, with every remaining one carrying a reason.
- **`intake-salesforce`'s committed file naming the deployed version** — and its false header
  ("never writes a domain table") **gone**, because that sentence is what made the GOVDUP1 search
  read as conclusive.
- ⚠️ **Not on "the census ran"** — a census that lists 38 rows and decides nothing has moved
  nothing. The number that matters is deployments that are now either reproducible from the repo or
  explicitly, reasonedly not.
