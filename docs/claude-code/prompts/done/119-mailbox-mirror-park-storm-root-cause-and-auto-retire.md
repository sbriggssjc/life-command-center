# Prompt 119 — Mailbox-mirror park storm: root-cause the move failures + add an auto-retire sweep

**Status:** DRAFT 2026-08-20 (Cowork-diagnosed; immediate backlog already retired, see below)

Grounding: `api/_handlers/mailbox-reconcile.js` (the W7.6 mailbox-mirror mover + ack ledger, `MAILBOX_MIRROR`
flag), `api/_shared/processing-complete.js` (the move-message logic), `api/admin.js` (~L4907 `mailbox-mirror`
route), `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`, `docs/architecture/flows/processing-complete-move-message.md`,
migration `20260824120000_lcc_w7_6_mailbox_mirror.sql`. Doctrines: **Consumption-Layer** (a producer needs an
auto-retire + honest counts; a 3,900-noise badge trains the operator to ignore the surface) and the
flagged-intake fix in `docs/architecture/flows/lcc-flagged-email-intake.md` (its Condition already moves the
email to Processed on success).

## The problem (measured live 2026-08-20)

`v_lcc_health_alerts_open` held **3,987 open alerts, 3,960 of them `mailbox_mirror_parked` — 100% with the
identical `last_error: not_found_or_not_in_source_folder`**, still firing (newest 04:04Z). It buried the ~24
genuinely actionable alerts. The mover moves emails from **"Intake Staged, Not Completed" → "Processed"** off
the LCC worklist; the ack ledger retries 5× then parks + opens an `error` alert. Every park is the same error:
the email is **not in the source folder** when the mover tries.

**Leading hypothesis — a double-mover race.** The flagged-intake flow (`LCC Flagged Email Intake`) ALREADY
moves the email to Processed on its own success (Condition → `Move_email_(V2)`). So by the time the
mailbox-mirror mover runs its worklist, the email has already left the source folder → `not_found` → 5 retries
→ park → alert. If confirmed, the two movers are redundant and the mirror is generating pure noise for the
common (successful) path.

## The ask

1. **Root-cause it.** Confirm whether the parks are the double-mover race above (email already in Processed via
   the intake flow) vs. genuinely-stuck emails vs. a stale source-folder-id binding (we just hit exactly that
   class on the flagged-intake trigger — check the mover's source folder id is still valid). Report the split.
2. **Stop the noise at the source.** `not_found_or_not_in_source_folder` means the **desired end state is
   already true** — the email is out of the source folder. Treat it as **terminal SUCCESS / ack-complete, not a
   retryable failure**, so it never parks or alerts. And/or exclude already-in-Processed emails from the
   worklist. If the intake flow is the authoritative mover, consider retiring the mirror move for that path
   entirely (one owner of the Processed move). Whatever the choice: **one owner, and "already moved" is success.**
3. **Add the missing auto-retire arm (Consumption-Layer).** A scheduled sweep auto-resolves parked/ack-capped
   mirror alerts whose premise has cleared (email already in Processed / gone from source), reversibly, with a
   reason — so the surface self-heals instead of accreting terminal noise. Honest counts on the badge.
4. **Don't re-clear the current backlog** — Cowork already retired it: 3,960 rows set `resolved_at` +
   `resolved_note = 'cowork-mirror-backlog-retire-20260820: … non-retrying … Root-cause + durable auto-retire
   tracked in prompt 119.'` (reversible by that tag). Health surface is 3,987 → **27** now. Your job is to stop
   recurrence; if your sweep would re-touch those, make it idempotent with the tag.
5. **Verify:** after the fix, process an intake email end-to-end and confirm it moves to Processed **without**
   generating a park/alert; parked-alert creation rate → ~0 over a day; the 27 real alerts stay visible.

## Close-out
- Update `docs/claude-code/STATUS.md` + `docs/setup/OUTLOOK_MAILBOX_MIRROR_FLOW.md`; if `not_found`-as-success
  is a new durable rule, add it to CLAUDE.md near the flagged-intake / Consumption-Layer notes.
- Feature-flag registry: if any behavior is gated, register/verify the row. No `field_source_priority` change.
