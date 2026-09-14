// ============================================================================
// SEC1-definer-default — stop re-learning that a new SECURITY DEFINER function
// is anon-executable.
//
// Postgres grants EXECUTE on a newly created FUNCTION to PUBLIC by default, and
// Supabase's ALTER DEFAULT PRIVILEGES additionally grants EXECUTE to `anon` and
// `authenticated` EXPLICITLY at CREATE time. So:
//   - `revoke ... from public` alone is a no-op for anon/authenticated (OCR2,
//     2026-09-02 — the two roles hold EXPLICIT grants, not PUBLIC ones).
//   - `revoke ... from anon, authenticated` alone leaves the PUBLIC grant
//     standing (B6d, 2026-08-29 — the leading `=X` in `proacl` IS public).
// The fix is to revoke from ALL THREE (public, anon, authenticated) and then
// ASSERT the result with `has_function_privilege()` — never trust the REVOKE
// statement itself as proof (both traps above were shipped, measured live, and
// found to be no-ops after the fact). Full mechanism + citations:
// CLAUDE.md, the B6d `compute_feed_cadence` section and the OCR2 section.
//
// This guard scans every .sql file under supabase/migrations/** (root +
// dialysis/ + government/ subdirectories) for a migration that
// CREATE [OR REPLACE] FUNCTION ... SECURITY DEFINER, and requires BOTH:
//   1. a revoke statement naming all three of public, anon, authenticated
//      (in one statement — the shape every real fix in this repo uses)
//   2. a has_function_privilege(...) assertion, somewhere in the SAME file
//
// Comments are ALWAYS stripped with a single quote-aware state machine (see
// sanitize() below) so a `--` sitting inside a string literal — a real case
// measured live in this repo's own migrations — can never be misread as a
// comment start, and a migration's own header prose can never satisfy the
// check. String-literal CONTENT is blanked only for the "does this file
// create a SECURITY DEFINER function" question, never for the revoke/assert
// stanza question — every real revoke shipped in this repo constructs it
// dynamically via `execute format('revoke all on function %s from public,
// anon, authenticated', r.sig)`, so the functional SQL text legitimately
// lives inside a string literal. See sanitizeStrict()/sanitizeForStanza()
// below for the full reasoning (this asymmetry was found empirically while
// building this guard, against the real, already-shipped MERGE1-sec fix).
//
// A NEW migration that creates a SECURITY DEFINER function must satisfy the
// check or be added to the ALLOWLIST below BY FILE PATH, with a stated reason
// — never by weakening the pattern. A stale allowlist entry (a file that no
// longer offends, or no longer exists) FAILS the test, so the allowlist
// cannot rot into a lie about what is still exposed.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// ---------------------------------------------------------------------------
// Pure helpers (exported implicitly via closures below — kept local so this
// guard has no runtime dependency on api/_shared/*, matching the convention
// of every other sql-source guard in this repo).
// ---------------------------------------------------------------------------

/**
 * A single quote-aware pass over the source that both strips comments and
 * blanks string-literal CONTENTS, in one linear scan, so neither operation
 * can misfire against the other.
 *
 * ⚠️ Doing this as two independent regex passes (strip `--` comments, THEN
 * blank '...' literals) is exactly the OCR1c footgun this repo warns about
 * repeatedly, and it is not hypothetical here: migration
 * `20260905120000_gov_merge1_fold_on_collision.sql` contains the ENGLISH
 * PROSE "...recorded from both sides -- fold fills any blank on the..."
 * *inside* a single-quoted SQL string literal (a `COMMENT ON` / `INSERT`
 * value). A line-based `--` stripper has no notion of "currently inside a
 * string" and deletes from that `--` to end of line — silently truncating
 * the literal and desynchronizing every subsequent quote in the file, which
 * then blanks (or fails to blank) unrelated code including the file's own
 * `SECURITY DEFINER` clause. Measured live against this exact file while
 * building this guard.
 *
 * The fix is ONE state machine: comment-vs-string is decided by what state
 * we are in at each character, so a `--` encountered while inside a
 * single-quoted literal is never treated as a comment start (it's just
 * literal content to blank), and a `'` encountered while inside a `--`
 * comment or `/* *\/` block never opens a string. Dollar-quoted function
 * bodies (`$function$ ... $function$`, `$$ ... $$`) are tracked with a tag
 * stack so the SAME rules recurse inside them (a real `--` inside a plpgsql
 * body is a real comment and should strip; a real `'...'` literal inside a
 * body should still have its content blanked) without a stray `$1`/`$2`
 * positional parameter ever being mistaken for a dollar-quote delimiter
 * (the tag pattern requires only letters/underscore between the two `$`s).
 *
 * `blankLiterals` controls whether string-literal CONTENT is replaced with
 * spaces (kept as `'` `'` delimiters, so length is roughly preserved) or left
 * verbatim. This is a parameter, not a single fixed behaviour, because the
 * two things this guard checks need OPPOSITE treatment of literals:
 *
 *   - "does this file CREATE a SECURITY DEFINER function?" must blank
 *     literals, or a `COMMENT ON VIEW ... IS '... SECURITY DEFINER ...'`
 *     description (real example: `20260522230000_gov_v_ownership_history_
 *     portfolio.sql`, a plain view relying on the Postgres DEFAULT security
 *     mode, not a function) reads as a false positive.
 *   - "does this file REVOKE from all three roles / ASSERT with
 *     has_function_privilege()?" must NOT blank literals — every real
 *     revoke shipped in this repo constructs it dynamically:
 *     `execute format('revoke all on function %s from public, anon,
 *     authenticated', r.sig)`. The functional SQL text lives INSIDE that
 *     format() string literal (the migration's function name/oid is only
 *     known at runtime). Blanking it makes the guard blind to every real fix
 *     — measured directly against the shipped
 *     `20260905130000_{dia,gov}_merge1_fold_function_privileges.sql` files
 *     while building this guard: with literals blanked, `hasFullStanza()`
 *     returned false on the ACTUAL FIX.
 */
function sanitize(src, { blankLiterals }) {
  let out = '';
  let i = 0;
  const n = src.length;
  const dollarStack = [];

  while (i < n) {
    // Dollar-quote delimiter (open or close) — checked first so it takes
    // priority over comment/string handling at this position.
    if (src[i] === '$') {
      const rest = src.slice(i, i + 64); // tags are always short
      const m = /^\$[A-Za-z_]*\$/.exec(rest);
      if (m) {
        const tag = m[0];
        if (dollarStack.length && dollarStack[dollarStack.length - 1] === tag) {
          dollarStack.pop();
        } else {
          dollarStack.push(tag);
        }
        out += tag;
        i += tag.length;
        continue;
      }
    }

    // Line comment `-- ...` — only recognized here, i.e. NOT while inside a
    // string literal (the string-literal branch below consumes its own
    // contents in an inner loop and never returns control here mid-string).
    // Comments are ALWAYS stripped, regardless of blankLiterals — a
    // migration's own header prose explaining this rule must never satisfy
    // the check.
    if (src[i] === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i);
      if (j === -1) j = n;
      i = j;
      continue;
    }

    // Block comment `/* ... */`.
    if (src[i] === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2);
      i = j === -1 ? n : j + 2;
      continue;
    }

    // Single-quoted string literal. Doubled '' is a literal escaped quote
    // (not a closing quote), and a `--`/`/*` sequence inside the content is
    // never treated as a comment start (it is just literal content).
    if (src[i] === "'") {
      out += "'";
      i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") {
          out += blankLiterals ? '  ' : "''";
          i += 2;
          continue;
        }
        if (src[i] === "'") {
          out += "'";
          i++;
          break;
        }
        if (blankLiterals) {
          out += src[i] === '\n' ? '\n' : ' ';
        } else {
          out += src[i];
        }
        i++;
      }
      continue;
    }

    out += src[i];
    i++;
  }
  return out;
}

/** Comments stripped + literals blanked — for "does this file CREATE a definer function?". */
function sanitizeStrict(src) {
  return sanitize(src, { blankLiterals: true });
}

/** Comments stripped ONLY, literals left verbatim — for the revoke/assert stanza check (see above). */
function sanitizeForStanza(src) {
  return sanitize(src, { blankLiterals: false });
}

/**
 * Does the (strictly sanitized) source create (or replace) a SECURITY
 * DEFINER function? SECURITY DEFINER is only ever valid Postgres syntax as a
 * clause of a CREATE [OR REPLACE] FUNCTION statement, so requiring both
 * tokens (rather than SECURITY DEFINER alone) additionally guards against a
 * stray match inside, say, a doc comment the comment-stripper missed.
 */
function createsDefinerFunction(strictSanitizedSrc) {
  return /\bSECURITY\s+DEFINER\b/i.test(strictSanitizedSrc)
    && /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(strictSanitizedSrc);
}

/**
 * A revoke statement that names all three of public, anon and authenticated
 * — in ONE statement, the shape every real fix in this repo uses
 * (`revoke all on function %s from public, anon, authenticated`), anchored
 * on real REVOKE-on-FUNCTION syntax (`revoke ... on function ... from ...;`)
 * so a comment or prose string merely NAMING the three roles near the word
 * "revoke" cannot satisfy it by accident. Scans each matching statement
 * independently so an unrelated GRANT elsewhere in the file naming one of
 * these roles can never satisfy it by itself.
 */
function hasThreeRoleRevoke(stanzaSanitizedSrc) {
  const stmts =
    stanzaSanitizedSrc.match(/\brevoke\b[\s\S]{0,200}?\bon\s+function\b[\s\S]{0,400}?\bfrom\b[\s\S]{0,400}?;/gi) || [];
  return stmts.some(
    (stmt) => /\bpublic\b/i.test(stmt) && /\banon\b/i.test(stmt) && /\bauthenticated\b/i.test(stmt),
  );
}

function hasPrivilegeAssertion(stanzaSanitizedSrc) {
  return /has_function_privilege\s*\(/i.test(stanzaSanitizedSrc);
}

/** True when the file satisfies BOTH stanzas required by this guard. */
function hasFullStanza(rawSrc) {
  const stanzaSrc = sanitizeForStanza(rawSrc);
  return hasThreeRoleRevoke(stanzaSrc) && hasPrivilegeAssertion(stanzaSrc);
}

function walkSqlFiles(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out = out.concat(walkSqlFiles(p));
    else if (entry.endsWith('.sql')) out.push(p);
  }
  return out;
}

function relPath(absPath) {
  return absPath.slice(MIGRATIONS_DIR.length + 1).split('\\').join('/');
}

// ---------------------------------------------------------------------------
// ALLOWLIST — pre-existing offenders as of 2026-09-05, keyed by path relative
// to supabase/migrations/. Measured count: 219 of 220 SECURITY-DEFINER-
// creating migrations in the repo lack the revoke+assert stanza IN THE SAME
// FILE (the one exception, 20261014120000_lcc_entc_p195_unmerge_fix.sql,
// carries both and needs no entry). An earlier pass of this same census
// (before the quote/comment-aware sanitizer below existed) mis-flagged 6
// additional files as SECURITY DEFINER creators — they only ever MENTION
// "SECURITY DEFINER" inside a `COMMENT ON VIEW ... IS '...'` string
// describing a VIEW's default security mode, never inside an actual
// `CREATE FUNCTION`; the fixed sanitizer correctly excludes them, and they
// carry no allowlist entry. This guard's job is to stop the count growing,
// not to retroactively fix 219 files in one pass — that triage is
// docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.
//
// Two entries carry a NAMED reason instead of the generic one: they are
// deliberately anon-executable BY DESIGN (compute_feed_freshness /
// compute_feed_cadence — CLAUDE.md's B6d section: the LCC cross-DB pull reads
// v_feed_freshness as anon, and revoking that grant would silently blind the
// freshness monitor). Widen an exemption like this by NAME, never by
// loosening the regex above.
//
// A stale entry here — a path that does not exist, or a file that now
// actually satisfies hasFullStanza() — fails this suite (see the
// "allowlist cannot rot" test below), so this list can never drift from the
// truth silently.
// ---------------------------------------------------------------------------
const ALLOWLIST = {
  '20260423230000_gov_refresh_available_listings_rpc.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260425201000_lcc_storage_orphan_cleanup_cron.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260425240000_dia_property_merge_candidates_and_helper.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260425250000_dia_auto_merge_property_duplicates_cron.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260427120000_dia_normalize_address_for_merge.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428140000_lcc_round_76aq_storage_cleanup_rpc_and_cron.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428150000_lcc_round_76ar_cron_post_railway_url.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428180000_lcc_round_76au_cron_health_monitor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428430000_lcc_round_76bv_cron_health_capture_url.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428440000_lcc_round_76bw_stuck_intake_view_and_discard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428450000_lcc_round_76bx_retry_stranded_extractions.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260428530000_lcc_round_76cw_pg_net_timeout_bump.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260429370000_field_source_priority_schema_validity_check.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260429390000_field_provenance_retention.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260505200000_lcc_availability_checker_botblock_alert.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260509120000_lcc_audit_cron_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260514120000_lcc_flow_run_failures_dead_letter_plane.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260520140000_lcc_r3_m2_health_alert_independent_teams_push.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260520150000_lcc_r3_m4_autoresolve_http_failure_alerts.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522123000_lcc_autoresolve_recovered_flow_failures.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522130000_lcc_cron_health_latest_run_semantics.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522220000_lcc_entity_sync_from_dia_gov.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522230100_lcc_entity_portfolio_sync_and_enriched_queue.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522240000_lcc_cross_domain_entity_merge.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522250000_lcc_onboarding_cadence_state_machine.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522250100_lcc_touchpoint_cadence_constraint_expansion.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522260000_lcc_cadence_auto_advance_and_dashboard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522280000_lcc_property_attributes_sync.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522305000_lcc_merge_entity_dedupe_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522310000_lcc_fuzzy_entity_merge.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522330000_lcc_listing_event_watcher.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260522370000_lcc_property_attributes_federal_signals.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260529120000_lcc_sf_sync_log_retention_and_disk_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260529120000_staged_intake_artifacts_retention.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260529150000_lcc_artifact_offload_finalize_watch.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260529200000_lcc_listing_events_live_gate_and_retract.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260601140000_lcc_pg_net_url_attribution.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260602_lcc_bd_sync_freshness_health_check.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260603120000_lcc_review_lane_counts_cache.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260603130000_lcc_bd_vertical_domain_canonicalize.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260603140000_lcc_create_lead_idempotence_and_davita_cleanup.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260603150000_lcc_seed_cadence_on_conflict_link.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260604120500_lcc_finalize_classified_owners_canonical.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260604140000_lcc_inbox_intake_autotriage.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260605120000_lcc_r5_buyer_parent_registry.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260605120500_lcc_r5_buyer_gate_and_queue.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260605_cm_round68a_dia_listing_date_correction_rpc.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260606121000_lcc_r6_owner_facts_and_resolution.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260606122000_lcc_r6_owner_facts_sync.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260606122500_lcc_r6_ownership_chain_and_research.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607120000_lcc_r7_phase0_buyer_spe_cache.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607120500_lcc_r7_phase0_priority_queue_cache.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607121000_lcc_r7_slice2_decisions.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607130000_lcc_r7_phase2_junk_entity_lane.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607140000_lcc_write_failure_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260607150000_lcc_buyer_cadence.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608120000_lcc_r6_resolver_parent_self_precedence.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608130000_lcc_r8_dia_owner_facts_leg.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608140000_lcc_r8_decision_producers.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608150000_lcc_r10_unit1_cadence_advance_skip_guard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608151000_lcc_r10_unit2_cadence_asset_owner_hop.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608170000_lcc_r11_unit1_portfolio_rent_repoint.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608171000_lcc_r11_unit2_property_rent_fallback_rank.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260608210500_lcc_r15_flow_failure_single_ttl.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609120000_lcc_r9_tier0_control_evidence.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609140000_lcc_r9_slice3_developer_classification.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609170000_lcc_r9_slice3_classify_ledger_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609190000_lcc_r13_unit3_junk_reviewed_stop_asking.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609210000_lcc_r17_unit2_apply_fuzzy_merges_batched.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260609211000_lcc_r17_unit3_orphan_entity_flags.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260613200000_lcc_r17_connect_band_connected_value_rank.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260614120000_lcc_flow_failure_cluster_ttl_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260615121000_lcc_r18_unit2_disabled_critical_cron_alert.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260615123000_lcc_r22_mirror_orphan_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260615130000_lcc_r21_unit1_research_task_dedup.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260615131000_lcc_r21_unit3_research_backlog_growth_alert.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260616120000_lcc_r23_archived_mirror_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260616121000_lcc_tier1_unit2_provenance_autoresolve.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260616161000_lcc_r35_unit2_external_identities_asset_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260617120000_lcc_connectivity1b_owner_name_junk_guard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260617121000_lcc_connectivity1b_bridge_eligible_owner_sync.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260617122000_lcc_connectivity1b_finalize_cte_snapshot_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260617126000_lcc_connectivity1b_bridge_composite_split.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260619120000_lcc_r46_chain_worklist_and_research_tasks.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260619130000_lcc_r47_owner_parent_resolution.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260619210000_lcc_r48_unit1_listing_event_consumer.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260620120000_lcc_contactsel_slice1_owner_signal_mirror.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260620122000_lcc_contactsel_slice2_pivot_feedback.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260620140000_lcc_contact_enrich_phaseA_deed_routing.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260622120000_lcc_r60_research_task_flood_control.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260623140000_lcc_r64_decision_auto_resolve.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260713120000_lcc_ensure_worklist_owner_pivots.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260716130000_lcc_ore_tierA_institution_contacts.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260716140000_lcc_ore_multi_signal_reconciliation.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260719130000_lcc_r28_unit1_inbox_om_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260719140000_lcc_r39_contact_email_dedup.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260719150000_lcc_r40_merge_orphan_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260719180000_lcc_outreach1_cadence_contact_hop_and_observability.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260719181000_lcc_outreach1_backfill_sf_cadence_advances.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260721120000_lcc_r56_feed_freshness_monitor.sql':
    "creates compute_feed_freshness / compute_feed_cadence — deliberately anon-executable BY DESIGN (LCC cross-DB pull reads v_feed_freshness as anon; CLAUDE.md B6d / OCR2 sections). Do not weaken the guard regex for this — name the file.",
  '20260722140000_lcc_owner_cross_reference_resolver.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260723120000_lcc_ore_build2_owner_address_reconcile.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260723123000_lcc_ore_option_a_owner_address_observations.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260723124000_lcc_ore_option_a_feed_cron.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260724120000_lcc_sos_sidebar_address_authority.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260728130000_fix_field_provenance_prune.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260728170000_entity_reconcile_functions.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260728170500_reconcile_auto_by_address.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260728180000_deal_address_observations_engine.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260728181000_deal_address_sweep_v2_enrich.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260729130000_deal_address_sweep_v3_closed_and_dedup.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260729140000_actor_identity_foundation.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260729190000_lcc_offer_context_assembler.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260729192500_lcc_offer_context_v31.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260729200000_lcc_log_offer.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260730120000_lcc_contact_authority_hierarchy.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260801121000_lcc_filter_quarantined_relationships.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260801133000_lcc_contact_property_deal_reverse_reads.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260801180000_lcc_health_surface.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260801210000_lcc_field_source_priority_schema_drift_710_listing_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260803120500_lcc_refresh_guard_and_slow_alert.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260806120000_lcc_w7_1_correspondence_attribution.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260806140000_lcc_fix_reconcile_owner_name_collision.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260806140000_lcc_w7_2_deal_comms_propagate.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260806150000_lcc_w7_2c_propagation_refinements.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260808120000_lcc_prompt80_match_disambig_assist.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260812140000_lcc_w2_3_watermark_mirror_sync.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260813120000_lcc_w2_5_provenance_event_flush.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260813130000_lcc_w2_4_mirror_null_semantics_and_retraction.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260813140000_lcc_w2_3d2_dia_listing_leg_via_sales_feed_view.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260814120000_lcc_w3_2_ore_activation.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260814130000_lcc_prompt106_property_twin_assist.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260814180000_cm_gov_packet_refresh_chunked_cron.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260815120000_lcc_p112_cadence_overdue_signal.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260817120000_lcc_p116_brokerage_as_owner.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818120000_lcc_advance_todos_ai_next_action.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818140000_lcc_sf_owner_capture.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818150000_lcc_deal_sf_ids.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818160000_lcc_owner_reconciliation_core.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818170000_lcc_owner_evidence_feeders.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818175000_lcc_my_day_active_deals_touchpoints.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818180000_lcc_deal_and_cadence_owner_feeders.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818200000_lcc_deal_stage_next_step_engine.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818210000_lcc_my_day_deal_staleness.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818220000_lcc_deal_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818230000_lcc_my_day_fold_deal_risk.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818240000_lcc_party_role.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818250000_lcc_deal_correspondents.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818260000_lcc_reconcile_deal_todo.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818270000_lcc_mark_deal_swept.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818290000_property_owner_subsystem.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818300000_property_owner_source_label.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818310000_property_owner_source_authority.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818320000_lcc_owner_prospecting_status.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818330000_owner_prospecting_add_portfolio.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260818370000_property_owner_operator_suppression.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260819120000_lcc_w4_4_provenance_citizen_sf_link.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260819130000_lcc_w4_4_resolver_calibration_history.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260820120000_lcc_deal_spine.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260820120000_lcc_p119_mailbox_mirror_not_found_terminal.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260820140000_lcc_p120_move_queue_executor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260820140000_lcc_prune_skip_resolution_referenced_provenance.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260820160000_lcc_p121_staging_processed_single_owner.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260821120000_p122_cm_packet_refresh_cursor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260824120000_lcc_w7_6_mailbox_mirror.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260826120000_lcc_p175_portfolio_sync_resolves_merged_owners.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260827100000_lcc_p195_merge_byte_identical_owner_groups.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260827120000_lcc_w9_3_sf_linkage_drain.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260827150000_lcc_p196_merge_entity_reversible.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260827210000_lcc_a2a_merge_ambiguous_chain_entities.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260828120000_lcc_b1_split_chain_value_floor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260902140000_lcc_cron_post_retire_vercel_label.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260906120000_lcc_p113_domain_owner_feeder.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260906120100_lcc_p113_mirror_tick_owner_ids.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260907120000_lcc_owner_supersession_tier.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930120700_lcc_p147_p148_person_may_own.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930121000_lcc_p152_agent_is_not_principal.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930121200_lcc_p118_prune_skip_attempted_provenance_refs.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930121200_lcc_p157a_finalize_dedupe_within_statement.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930121300_lcc_p118_owner_address_resolver_hoist.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20260930121600_lcc_p160_merge_entity_owner_backrefs_and_cycle_guard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261002090000_lcc_p194_intake_extraction_provenance.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261002100000_lcc_b6a_followup_feed_freshness_loud.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261004120000_lcc_b6d_feed_expectation_grading_local.sql':
    "creates/replaces compute_feed_cadence again — same deliberate anon-executable exemption as R56 above.",
  '20261004120100_lcc_b6d_resolve_alerts_for_unwatched_feeds.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261007120000_lcc_pr8_provenance_relabel_registration.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261014120000_lcc_uxt1a_mirror_dia_lease_dates.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  '20261014120100_lcc_uxt1a_debt_loan_maturity_mirror.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428020000_dia_listing_cleanup_round_76ag.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428110000_dia_round_76ao_view_refresh_cross_db_recovery.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428180000_dia_round_76au_cron_health_monitor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428230000_dia_round_76ax_c_data_hygiene_sweep.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428250000_dia_round_76az_property_merge_loosen.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260428290000_dia_round_76be_consolidation_function.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260504100100_dia_round_76eg_listing_consolidation_function.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260519100000_dia_round_76r2_x2_merge_property_complete_fk_coverage.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260601130000_dia_hygiene_sweep_refresh_guard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260601150000_dia_merge_property_sales_collision_fix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260601160000_dia_merge_property_per_row_repoint.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260616_dia_tier4_unit2_recorded_owner_backfill.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260618140000_dia_r43_caprate_review_worklists.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260728_dia_marketing_engagement_rpc.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260801190000_dia_dossier_relocation_competition.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260804_dia_prompt31_property_consolidation_same_event_sales.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260815120000_dia_w3_4_queue_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'dialysis/20260905120000_dia_merge1_fold_on_collision.sql':
    "MERGE1: creates _dia_merge_fold_one_row / dia_merge_fold_table as SECURITY DEFINER with no stanza in this file — the revoke+assert was shipped 10 minutes later as a companion migration (20260905130000_dia_merge1_fold_function_privileges.sql). This is exactly the historical vulnerable-window shape the guard exists to catch on the NEXT such split; kept on the allowlist rather than backdated because splitting the fix across files is itself the anti-pattern (prefer landing both in one migration going forward).",
  'government/20260428180000_gov_round_76au_cron_health_monitor.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260428230000_gov_round_76ax_c_data_hygiene_sweep.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260428290000_gov_round_76be_consolidation_function.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260504110000_gov_consolidation_strip_listing_prefix.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260512000000_gov_auto_resolve_ownership_loosen.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260601130000_gov_hygiene_sweep_refresh_guard.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260607123000_gov_apply_manual_true_owner.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260618140000_gov_r43_caprate_review_worklists.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260804_gov_prompt31_property_consolidation_same_event_sales.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260804b_gov_prompt31_apply_fixes.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260815121000_gov_w3_4_queue_health.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260817120000_gov_w3_7_om_confirmed_noi.sql':
    "pre-existing migration predating the SEC1-definer-default guard (2026-09-05) — not yet triaged for anon-executable SECURITY DEFINER exposure. See docs/audits/SEC1_DEFINER_ANON_TRIAGE_2026-09-05.md.",
  'government/20260905120000_gov_merge1_fold_on_collision.sql':
    "MERGE1: same as the dia twin above — companion fix is 20260905130000_gov_merge1_fold_function_privileges.sql.",
};

// ---------------------------------------------------------------------------
// Discovery: every .sql migration that creates a SECURITY DEFINER function.
// ---------------------------------------------------------------------------
const allSqlFiles = walkSqlFiles(MIGRATIONS_DIR);
const definerFiles = allSqlFiles
  .map((abs) => ({ abs, rel: relPath(abs) }))
  .filter(({ abs }) => createsDefinerFunction(sanitizeStrict(readFileSync(abs, 'utf8'))));

// ---------------------------------------------------------------------------
// Unit tests on the pure detector logic (no filesystem) — these are the
// positive controls required by the spec: the guard must fire on an
// unguarded SECURITY DEFINER function (the MERGE1 shape before its
// companion-file fix) and must NOT fire on a properly-guarded one.
// ---------------------------------------------------------------------------

test('detector: comments are stripped before matching (a migration explaining the rule in prose must not satisfy it)', () => {
  const src = `
-- This migration deliberately does NOT revoke from public, anon, authenticated,
-- and does NOT call has_function_privilege(), because the author forgot.
create or replace function public.leaky_fn(x int)
returns int
language plpgsql
security definer
as $function$
begin
  return x + 1;
end;
$function$;
`;
  const strictSanitized = sanitizeStrict(src);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(
    hasFullStanza(src),
    false,
    'a comment merely NAMING the missing stanza must not satisfy the detector',
  );
});

test('detector: prose merely NAMING the three roles (no real "revoke ... on function ... from" shape) must not satisfy it', () => {
  // The tightened revoke pattern requires the actual REVOKE-ON-FUNCTION-FROM
  // shape, not just the co-occurrence of the words "revoke"/public/anon/
  // authenticated — so a comment (or a raise-notice string) that merely
  // DESCRIBES doing this in prose, without the SQL shape, cannot satisfy it.
  const src = `
create or replace function public.leaky_fn2(x int)
returns int
language plpgsql
security definer
as $function$
begin
  -- this migration revokes execute from public, anon and authenticated, and asserts with has_function_privilege
  raise notice 'this function revokes access for public, anon and authenticated and checks has_function_privilege';
  return x + 1;
end;
$function$;
`;
  const strictSanitized = sanitizeStrict(src);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(
    hasFullStanza(src),
    false,
    'prose naming the roles/assertion without the real REVOKE...ON FUNCTION...FROM shape must not satisfy the detector',
  );
});

test('detector: a `--` comment can never satisfy the stanza, even one that IS shaped like the real SQL (comments are always stripped)', () => {
  const src = `
create or replace function public.leaky_fn3(x int)
returns int
language plpgsql
security definer
as $function$
begin
  -- revoke all on function public.leaky_fn3(int) from public, anon, authenticated;
  -- select has_function_privilege('anon', 'public.leaky_fn3(int)', 'EXECUTE');
  return x + 1;
end;
$function$;
`;
  const strictSanitized = sanitizeStrict(src);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(
    hasFullStanza(src),
    false,
    'a real-shaped revoke/assert sitting only in a `--` comment must not satisfy the detector — comments never execute',
  );
});

test('detector: a `raise notice` string CONSTRUCTING the real revoke/assert shape DOES satisfy it — this is the actual production pattern (dynamic `format()`)', () => {
  // Every real fix in this repo builds its revoke via
  // `execute format('revoke all on function %s from public, anon, authenticated', r.sig)`
  // — the functional SQL text lives INSIDE a string literal because the
  // function signature/oid is only known at runtime. The detector must NOT
  // blank literals away here, or it goes blind to every real fix (measured
  // directly against the shipped MERGE1-sec migrations while building this
  // guard — see the sanitizeForStanza() doc comment above).
  const src = `
create or replace function public.dynamic_fn(x int)
returns int
language plpgsql
security definer
as $function$
begin
  return x + 1;
end;
$function$;

do $$
begin
  execute format('revoke all on function %s from public, anon, authenticated', 'public.dynamic_fn(int)');
end $$;

do $$
begin
  perform has_function_privilege('anon', 'public.dynamic_fn(int)', 'EXECUTE');
end $$;
`;
  assert.equal(hasFullStanza(src), true);
});

test('detector: POSITIVE CONTROL — the MERGE1 pre-fix shape (unguarded SECURITY DEFINER, no stanza) is flagged', () => {
  // Inlined fixture representing the historical vulnerable window this guard
  // exists to catch: MERGE1 shipped `_dia_merge_fold_one_row` /
  // `dia_merge_fold_table` as SECURITY DEFINER with no revoke/assert in the
  // SAME migration (the fix landed 10 minutes later as a companion file —
  // see CLAUDE.md's MERGE1 section and the ALLOWLIST entries for the two
  // *_merge1_fold_on_collision.sql files above). This mirrors that shape
  // exactly, including the destructive dynamic-SQL surface that made it
  // dangerous (a table name taken as a parameter).
  const merge1PreFixShape = `
-- MERGE1 (2026-09-05) -- fold_fill_blanks / re_derivable / resolve_status policy.
create or replace function public._dia_merge_fold_one_row(
  p_table text, p_pk_col text, p_fk_col text, p_keep_id text, p_drop_id text
) returns jsonb
language plpgsql
security definer
as $function$
declare
  v_fold_detail jsonb;
begin
  execute format('update public.%I k set ... from public.%I d where k.%I = $1', p_table, p_table, p_fk_col)
    using p_keep_id;
  return v_fold_detail;
end;
$function$;

create or replace function public.dia_merge_fold_table(
  p_table text, p_policy text, p_keep_id text, p_drop_id text
) returns jsonb
language plpgsql
security definer
as $function$
begin
  return public._dia_merge_fold_one_row(p_table, 'id', 'fk', p_keep_id, p_drop_id);
end;
$function$;
`;
  const strictSanitized = sanitizeStrict(merge1PreFixShape);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(
    hasFullStanza(merge1PreFixShape),
    false,
    'the MERGE1 pre-fix shape (SECURITY DEFINER + dynamic SQL over a caller-named table, no revoke/assert) must be flagged',
  );
});

test('detector: POSITIVE CONTROL — the actual MERGE1-sec follow-up migrations DO satisfy the stanza (proves the detector recognises a real fix)', () => {
  for (const relFixPath of [
    'dialysis/20260905130000_dia_merge1_fold_function_privileges.sql',
    'government/20260905130000_gov_merge1_fold_function_privileges.sql',
  ]) {
    const abs = join(MIGRATIONS_DIR, relFixPath);
    assert.ok(existsSync(abs), `expected the MERGE1-sec follow-up migration to exist at ${relFixPath}`);
    const rawSrc = readFileSync(abs, 'utf8');
    assert.equal(
      hasFullStanza(rawSrc),
      true,
      `${relFixPath} is the shipped fix for MERGE1's anon-executable definer helpers and must satisfy the stanza`,
    );
  }
});

test('detector: a correctly-guarded function (revoke from all three + has_function_privilege assertion) passes', () => {
  const src = `
create or replace function public.safe_fn(x int)
returns int
language plpgsql
security definer
as $function$
begin
  return x + 1;
end;
$function$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'safe_fn'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'safe_fn'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad > 0 then
    raise exception 'safe_fn still reachable by anon/authenticated';
  end if;
end $$;
`;
  const strictSanitized = sanitizeStrict(src);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(hasFullStanza(src), true);
});

test('detector: revoke from public+anon alone (missing authenticated) does NOT satisfy the stanza', () => {
  const src = `
create or replace function public.half_fixed_fn(x int) returns int language sql security definer
as $function$ select x $function$;
revoke all on function public.half_fixed_fn(int) from public, anon;
select has_function_privilege('anon', 'public.half_fixed_fn(int)', 'EXECUTE');
`;
  const strictSanitized = sanitizeStrict(src);
  assert.equal(createsDefinerFunction(strictSanitized), true);
  assert.equal(
    hasFullStanza(src),
    false,
    'B6d found this exact half-fix (anon+authenticated revoked, PUBLIC left standing, or vice versa) to be a no-op',
  );
});

// ---------------------------------------------------------------------------
// Whole-repo scan.
// ---------------------------------------------------------------------------

test(`repo scan: found at least one SECURITY DEFINER function migration (sanity — ${definerFiles.length} found)`, () => {
  assert.ok(definerFiles.length > 0, 'expected to find SECURITY DEFINER migrations under supabase/migrations/**');
});

test('every SECURITY DEFINER migration either satisfies the stanza or is a named ALLOWLIST entry', () => {
  const unexplained = [];
  for (const { abs, rel } of definerFiles) {
    const rawSrc = readFileSync(abs, 'utf8');
    if (hasFullStanza(rawSrc)) continue;
    if (Object.prototype.hasOwnProperty.call(ALLOWLIST, rel)) continue;
    unexplained.push(rel);
  }
  assert.deepEqual(
    unexplained,
    [],
    `New SECURITY DEFINER migration(s) missing a revoke(public,anon,authenticated)+has_function_privilege() ` +
      `stanza, and not in the ALLOWLIST:\n${unexplained.map((f) => '  - ' + f).join('\n')}\n` +
      `Either add the revoke+assert stanza to the SAME migration file, or add a named ALLOWLIST entry ` +
      `explaining why (never weaken the detector to make this pass).`,
  );
});

test('the ALLOWLIST cannot rot into a lie: every entry must name a file that (a) exists, (b) still creates a SECURITY DEFINER function, and (c) still actually lacks the stanza', () => {
  const definerRelSet = new Set(definerFiles.map((f) => f.rel));
  const stale = [];
  for (const rel of Object.keys(ALLOWLIST)) {
    const abs = join(MIGRATIONS_DIR, rel);
    if (!existsSync(abs)) {
      stale.push(`${rel} — file no longer exists`);
      continue;
    }
    if (!definerRelSet.has(rel)) {
      stale.push(`${rel} — no longer creates a SECURITY DEFINER function (or never did)`);
      continue;
    }
    const rawSrc = readFileSync(abs, 'utf8');
    if (hasFullStanza(rawSrc)) {
      stale.push(`${rel} — now satisfies the stanza; remove this allowlist entry`);
    }
  }
  assert.deepEqual(
    stale,
    [],
    `Stale ALLOWLIST entries (remove them — a stale entry hides a real fix or a deleted file):\n` +
      stale.map((f) => '  - ' + f).join('\n'),
  );
});

test('the ALLOWLIST has no duplicate or unreachable entries relative to supabase/migrations/', () => {
  // Every key must be a relative path that, joined to MIGRATIONS_DIR, stays inside it
  // (no path traversal, no accidental absolute path).
  for (const rel of Object.keys(ALLOWLIST)) {
    assert.ok(!rel.startsWith('/'), `ALLOWLIST key must be relative: ${rel}`);
    assert.ok(!rel.includes('..'), `ALLOWLIST key must not traverse: ${rel}`);
  }
});

test(`sanity: ALLOWLIST size matches measured pre-existing offender count (${Object.keys(ALLOWLIST).length} entries)`, () => {
  // This is a population-size sanity check, not a magic number the guard
  // depends on — it exists so a future re-run of this file notices if the
  // measured population silently grew or shrank without anyone updating the
  // header comment above. Update the count in the comment (not this assert)
  // when the allowlist legitimately changes size.
  assert.equal(Object.keys(ALLOWLIST).length, 219);
});
