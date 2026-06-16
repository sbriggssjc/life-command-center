# Claude Code — R29: TEAM PULSE "SYNC ERRORS" third source + contact-qualify ordering

Two small "the surface shows the wrong/buried thing" fixes verified live 2026-06-16.

## Unit 1 — TEAM PULSE "SYNC ERRORS" reads a THIRD source (definitive fix)

### Why (verified live 2026-06-16, post R25+R27 deploy)
This widget has now slipped past TWO fixes (R25 Unit 3 repoint, R27 mv source fix)
because each targeted the wrong field. Ground truth on the live Today page, same load:
- **TEAM SIGNALS "Sync Errors" = 0** (correct — reads the live `summary.error`).
- **TEAM PULSE "SYNC ERRORS" = 2107** (wrong — a different source).

2107 matches NONE of the sync-error sources (all verified 0 on LCC Opps):
`mv_work_counts.sync_errors`=0 (R27), `v_work_counts.unresolved_sync_errors`=0,
`sync_errors` table=0 rows, `connector_accounts status='error'`=0 (4 healthy / 1
disconnected). The ONLY source in the low-2000s is **`ingest_write_failures` on a
rolling ~4-day window** (24h≈482, 4d≈1886, 5d≈2697 → ~4.3d ≈ 2107). So the TEAM PULSE
card's "SYNC ERRORS" value is an **ingest-write-failure count mislabeled "SYNC ERRORS"**,
rendered from a different code path than TEAM SIGNALS.

### The fix
- In `ops.js`, find the **TEAM PULSE** card's "SYNC ERRORS" render (NOT the TEAM SIGNALS
  one already fixed — they're separate render sites). Trace the value it prints; it is
  NOT `liveSyncErr` / `summary.error` (those are 0) — it's pulling an
  ingest-write-failure-derived field (likely a `canonicalCounts.*` / pulse-payload field
  fed by an `ingest_write_failures` count, or a `/api/...` pulse endpoint).
- Repoint TEAM PULSE "SYNC ERRORS" to the **same `liveSyncErr` source TEAM SIGNALS uses**
  (`/api/sync?action=health` → `summary.error`, 0 fallback), so both cards show the
  identical bounded connector-error count on one load. (This is what R25 cc2bf4f intended
  but the deployed card still reads the old field.)
- If the ingest-write-failure count is worth surfacing, that's a SEPARATE, correctly
  LABELED metric (e.g. "Ingest write failures (7d)") on Ops Health — do not leave it
  labeled "SYNC ERRORS" on TEAM PULSE.

### Verify live (after deploy)
- TEAM SIGNALS "Sync Errors" and TEAM PULSE "SYNC ERRORS" show the **same** number on one
  page load (0 today).
- Grep confirms no remaining Today render site reads an `ingest_write_failures`-derived
  value under a "sync error" label.

## Unit 2 — contact-qualify worklist buries the actionable rows (R28 Unit 2 follow-up)

### Why (verified live 2026-06-16)
`v_lcc_contact_qualify_worklist` = 371 workable. Composition: **215 emailable persons**
(the actionable set — you can qualify + email them; max value ~$3.55M), 129
persons-WITHOUT-email, 27 orgs. But a pure value-sort puts non-emailable rows on top:
the highest `rank_value` entries are **Northwestern Mutual / Jamestown / Akridge**
($26M/$23M/$22M) — FIRMS mistyped as `entity_type='person'` with **no email**. So the 215
actionable emailable persons sit buried below non-emailable mistyped firms — the exact
P-CONTACT burial pattern R25 fixed.

### The fix
- In the worklist API (`operations.js ?action=contact_qualify_worklist`) order **emailable
  rows first** (`has_email DESC`), THEN by `rank_value DESC NULLS LAST` — so the
  qualify-and-email-able persons lead, mirroring the R25 connect-band ordering. (If the
  ordering already lives in the view, apply it there; keep one ordering source.)
- Exclude the firm-as-person leak: rows that are `entity_type='person'` but whose name
  fails `looksLikePersonName` (the R20 guard — firm-shaped / no first-last) should NOT
  appear in a CONTACT-qualify worklist. Reuse the existing guard; don't invent a new one.
  (These are the same mistyped firms surfacing in P-CONTACT; long-term they want a retype,
  but for this worklist just exclude them so it's all real qualifiable contacts.)

### Verify live (after deploy)
- The worklist's top rows are emailable real persons (first+last names with an email),
  not non-emailable firms; Northwestern Mutual / Jamestown / Akridge no longer head the
  list.

## House rules
≤12 `api/*.js`; `node --check`; suite green. JS-only (DB sources already correct per R27;
the worklist view exists per R28). LOW priority but both are recurring "surface shows the
wrong thing" warts — this pins the exact sources so they're the last pass.
