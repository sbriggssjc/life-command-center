#!/usr/bin/env node
// ============================================================================
// LCC Audit Sprint — Item #10 Phase A: Global error visibility.
//
// Today, uncaught JS errors and unhandled promise rejections vanish into
// the console. The user sees "nothing happened" while the app is silently
// broken. Toast tiers are also inconsistent — `.toast.ok` is used in 8+
// places in contacts-ui.js but has no CSS class so it renders neutral.
//
// Phase A scope:
//   1. CSS — add .toast.ok (success/green) and .toast.warn (alias of warning).
//   2. JS — lccReportError(label, err, options) helper that:
//        • Console-logs with full context.
//        • Rate-limits user-facing toasts (max 1 per 10s per label) so a
//          runaway loop doesn't spam the user.
//        • Includes a short error tag so users can reference the failure.
//   3. JS — global window error + unhandledrejection handlers that route
//      through lccReportError.
//   4. AUDIT_PROGRESS.md closeout.
//
// Closes audit findings:
//   C-5  (no global error capture)
//   C-6  (toast tiers inconsistent / .ok unstyled)
//   C-9  (unhandled rejections invisible)
//   C-10 (runaway error loops can spam UI without rate-limit)
//
// Phase B (deferred):
//   • POST captured errors to a client_errors table on LCC Opps for
//     historical analysis.
//   • Per-widget standard error-state with retry CTAs (extend the existing
//     .widget-error pattern to every list loader).
//   • Source-map symbolication of stack traces.
//
// Branch: audit/10-global-error-visibility
// ============================================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const argv = new Set(process.argv.slice(2));
const DRY  = argv.has('--dry') || !argv.has('--apply');

function detectEol(s) {
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf   = (s.match(/(^|[^\r])\n/g) || []).length;
  return crlf > lf ? '\r\n' : '\n';
}
function toEol(s, eol) { return s.replace(/\r\n/g, '\n').replace(/\n/g, eol); }
async function fileExists(p) {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}
function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let n = 0; let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
async function replaceUnique(path, oldStr, newStr, report, label) {
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const oldN = toEol(oldStr, eol);
  const newN = toEol(newStr, eol);
  const occ = countOccurrences(original, oldN);
  if (occ === 0) throw new Error(label + ': anchor not found in ' + path);
  if (occ > 1)  throw new Error(label + ': anchor matched ' + occ + ' times in ' + path);
  if (oldN === newN) { report.push([label, 0, 'no changes']); return; }
  const updated = original.replace(oldN, () => newN);
  const delta = updated.length - original.length;
  report.push([label + ' (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, updated, 'utf8');
}

// ─── styles.css: add .toast.ok and .toast.warn ───
async function patchStylesCss(report) {
  const path = resolve(REPO_ROOT, 'styles.css');
  if (!await fileExists(path)) throw new Error('styles.css not found.');

  const ANCHOR = `.toast.info { border-color: var(--accent); }`;
  const REPLACE = `.toast.info { border-color: var(--accent); }
/* Item #10 Phase A (2026-05-17): missing tier styles. .ok was used in 8+ */
/* places in contacts-ui.js without a matching CSS class — toasts rendered */
/* neutral. .warn is an alias for the existing .warning. */
.toast.ok { border-color: var(--green, #22c55e); }
.toast.warn { border-color: var(--yellow); }
.toast .toast-tag { display: inline-block; margin-right: 8px; padding: 1px 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: var(--text2); background: var(--s2); border: 1px solid var(--border); border-radius: 4px; vertical-align: middle; }`;
  await replaceUnique(path, ANCHOR, REPLACE, report, 'styles.css (toast tier classes)');
}

// ─── app.js: lccReportError + global handlers ───
async function patchAppJs(report) {
  const path = resolve(REPO_ROOT, 'app.js');
  if (!await fileExists(path)) throw new Error('app.js not found.');

  // Anchor right after smoothDOMUpdate export — a natural home for global
  // utility helpers. Inserts the helper + global handlers + rate limiter.
  await replaceUnique(path,
    `window.smoothDOMUpdate = smoothDOMUpdate;

// ── Custom Modal (async replacements for confirm/prompt) ──────────────`,
    `window.smoothDOMUpdate = smoothDOMUpdate;

// ============================================================================
// GLOBAL ERROR VISIBILITY — Item #10 Phase A (2026-05-17)
//
// Today: uncaught errors + unhandled rejections vanish silently into the
// console. The user has no way to know the app is broken until they
// re-load the page hours later.
//
// lccReportError(label, err, options) is the single central path:
//   • Console-logs with full context.
//   • Surfaces a tiered toast (info/ok/warn/error) to the user.
//   • Rate-limits per-label to max 1 toast / 10s so a runaway loop
//     can't spam the UI.
//   • Tags the toast with a short error code (e.g. [E-4F2A]) the user
//     can quote when reporting bugs.
//
// Global handlers wire \`window.error\` and \`unhandledrejection\` through
// the same path so silent failures become visible.
// ============================================================================
const _LCC_ERR_RATE_MS = 10000; // per-label cooldown
const _lccErrRateState = new Map(); // label -> { lastShown, count }

function _lccErrCode() {
  // Short 4-char tag for end-user quoting; collisions OK (we have console too).
  return Math.random().toString(16).slice(2, 6).toUpperCase();
}

function lccReportError(label, err, options) {
  options = options || {};
  const tier = options.tier || 'error'; // 'error' | 'warn' | 'info' | 'ok'
  const lbl = String(label || 'Error');
  const code = options.code || _lccErrCode();
  const detail = err && (err.message || err.reason || err.error) ? (err.message || err.reason || err.error) : (typeof err === 'string' ? err : '');

  // Console always — never lose the stack.
  try {
    if (tier === 'error') console.error('[LCC E-' + code + ']', lbl, err);
    else if (tier === 'warn') console.warn('[LCC W-' + code + ']', lbl, err);
    else console.info('[LCC I-' + code + ']', lbl, err);
  } catch (_) {}

  if (options.silent) return code;

  // Rate-limit per-label
  const now = Date.now();
  const st = _lccErrRateState.get(lbl) || { lastShown: 0, count: 0 };
  st.count += 1;
  if (now - st.lastShown < _LCC_ERR_RATE_MS) {
    _lccErrRateState.set(lbl, st);
    return code; // suppressed this round
  }
  st.lastShown = now;
  _lccErrRateState.set(lbl, st);

  // Toast composition: tag + label + (detail if short)
  const tagPrefix = tier === 'error' ? 'E' : tier === 'warn' ? 'W' : 'I';
  const userMessage = options.userMessage
    || (lbl + (detail ? ': ' + (String(detail).length > 80 ? String(detail).slice(0, 77) + '…' : detail) : ''))
    + ' [' + tagPrefix + '-' + code + ']';

  if (typeof showToast === 'function') {
    try { showToast(userMessage, tier); } catch (e) { console.warn('[LCC] showToast failed', e); }
  }
  return code;
}
window.lccReportError = lccReportError;

// Diagnostic accessor — call from devtools to see what's been rate-limited.
window.lccErrorStats = function () {
  const out = {};
  _lccErrRateState.forEach((v, k) => { out[k] = { count: v.count, lastShownAt: new Date(v.lastShown).toISOString() }; });
  return out;
};

(function _lccWireGlobalErrorHandlers() {
  if (window._lccGlobalErrorsWired) return;
  window._lccGlobalErrorsWired = true;

  window.addEventListener('error', function (event) {
    // Skip noisy resource loads (image 404s, etc.). Only catch JS errors,
    // which have event.error or a message + filename + lineno.
    if (event && (event.error || (event.message && event.filename))) {
      lccReportError('JS error', event.error || event.message, {
        tier: 'error',
        userMessage: 'Something went wrong on this page. ' +
          (event.message ? '(' + String(event.message).slice(0, 80) + ')' : ''),
      });
    }
  });

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event && event.reason;
    lccReportError('Unhandled promise rejection', reason, {
      tier: 'error',
      userMessage: 'A background task failed silently. Reload may help.',
    });
  });
})();

// ── Custom Modal (async replacements for confirm/prompt) ──────────────`,
    report, 'app.js (lccReportError + global handlers)');
}

// ─── AUDIT_PROGRESS.md: append closeout entry ───
async function updateAuditProgress(report) {
  const path = resolve(REPO_ROOT, 'AUDIT_PROGRESS.md');
  if (!await fileExists(path)) throw new Error('AUDIT_PROGRESS.md not found.');
  const original = await readFile(path, 'utf8');
  const eol = detectEol(original);
  const N = (s) => toEol(s, eol);
  let c = original;

  const appendBlock = N(`

## Closeout — item 10 Phase A — Global error visibility
- **Status:** ✅ DONE (Phase A) / ⏸️ DEFERRED (Phase B: client_errors table + per-widget retry CTAs + sourcemap symbolication)
- **Branch:** \`audit/10-global-error-visibility\`
- **Patch:** \`audit/patches/10-global-error-visibility/apply.mjs\`
- **Closes:** C-5 (no global error capture), C-6 (toast tiers inconsistent / \`.ok\` unstyled), C-9 (unhandled rejections invisible), C-10 (runaway loops could spam UI).

### What this adds

**1. Toast tier styles** in \`styles.css\`:
- \`.toast.ok\` — success/green border. Was used in 8+ places in \`contacts-ui.js\` without a matching CSS class — toasts rendered neutral.
- \`.toast.warn\` — alias for \`.warning\`.
- \`.toast-tag\` chip style for the error-code tag prefix.

**2. \`lccReportError(label, err, options)\` helper** in \`app.js\`:
- Central path for reporting any user-impactful failure.
- Console-logs with full context (\`[LCC E-XXXX] label, err\`).
- Surfaces a tiered toast (\`'error'\` | \`'warn'\` | \`'info'\` | \`'ok'\`).
- Tags the toast with a short error code (e.g. \`[E-4F2A]\`) so users can quote it when reporting bugs.
- **Rate-limited per-label**: max 1 toast per 10 seconds for the same label, so a runaway loop can't spam the UI. Suppressed errors still console-log normally.
- Options:
  - \`tier\` — toast severity
  - \`userMessage\` — override the default formatted message
  - \`silent: true\` — log only, no toast
  - \`code\` — pre-assigned error code (for cross-reference with backend logs)

**3. Global handlers** wired automatically on first load:
- \`window.addEventListener('error', ...)\` — catches uncaught JS errors. Filters out resource-load 404s so it only fires on real exceptions.
- \`window.addEventListener('unhandledrejection', ...)\` — catches unhandled promise rejections (the silent failure mode that was invisible until now).
- Both route through \`lccReportError\`.

**4. \`window.lccErrorStats()\`** diagnostic accessor:
- Returns \`{ label: { count, lastShownAt } }\` for every label that hit the rate limiter. Useful from devtools when investigating a noisy session.

### Files changed
- \`styles.css\` — toast tier classes (.ok, .warn) + .toast-tag chip
- \`app.js\` — lccReportError helper + global handlers + diagnostic accessor
- \`AUDIT_PROGRESS.md\` — this closeout

### Verification
1. \`grep -c "lccReportError" app.js\` → 2 or more (definition + window export)
2. \`grep -c "addEventListener\\\\('error'" app.js\` → 1 or more
3. \`grep -c "addEventListener\\\\('unhandledrejection'" app.js\` → 1 or more
4. \`grep -c "\\\\.toast\\\\.ok" styles.css\` → 1 or more
5. Smoke: open devtools console and run \`throw new Error('test')\`. A red toast appears with the error message + \`[E-XXXX]\` tag, console shows \`[LCC E-XXXX] JS error\`.
6. Smoke: run \`Promise.reject(new Error('async test'))\`. A red toast appears with "A background task failed silently. Reload may help." + \`[E-XXXX]\`, console shows \`[LCC E-XXXX] Unhandled promise rejection\`.
7. Smoke: run \`for (let i=0; i<100; i++) throw new Error('spam' + i)\` (in a setInterval). Confirm only ~1 toast per 10s appears (the rest are suppressed); console still shows every error. \`window.lccErrorStats()\` returns the count.

### Adoption guide for follow-up work
Any handler that currently does:
\`\`\`js
try { ... }
catch (e) {
  console.warn('Failed to load X:', e);
  if (typeof showToast === 'function') showToast('Failed: ' + e.message, 'error');
}
\`\`\`
…should switch to:
\`\`\`js
try { ... }
catch (e) { lccReportError('Load X', e); }
\`\`\`
Same UX, rate-limited, console-logged with code tag, ready for Phase B telemetry.

### Phase B (deferred)
- POST captured errors to a \`client_errors\` table on LCC Opps for historical aggregation + alerting.
- Migrate the ~50 existing ad-hoc \`console.warn + showToast\` sites to \`lccReportError\`.
- Extend the \`.widget-error\` retry pattern (used by Daily Briefing) to every list-loader \`catch\` block.
- Sourcemap symbolication so production stack traces are readable.

`);

  const preflightAnchor = N('\n# Sprint preflight — 2026-05-17\n');
  if (c.includes(preflightAnchor)) {
    c = c.replace(preflightAnchor, () => appendBlock + preflightAnchor);
  } else {
    c = c + appendBlock;
  }
  if (c === original) { report.push(['AUDIT_PROGRESS.md', 0, 'no changes']); return; }
  const delta = c.length - original.length;
  report.push(['AUDIT_PROGRESS.md (' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')', delta, DRY ? 'dry-run' : 'written']);
  if (!DRY) await writeFile(path, c, 'utf8');
}

async function main() {
  console.log('\n=== LCC Audit Sprint — Item #10 Phase A (global error visibility) ===');
  console.log('Mode: ' + (DRY ? 'DRY-RUN' : 'APPLY') + '\n');
  if (!await fileExists(resolve(REPO_ROOT, 'package.json'))) {
    throw new Error('Could not find package.json at ' + REPO_ROOT + '.');
  }
  const report = [];
  await patchStylesCss(report);
  await patchAppJs(report);
  await updateAuditProgress(report);
  console.log('--- ' + (DRY ? 'DRY-RUN' : 'APPLY') + ' SUMMARY ---');
  for (const [file, delta, note] of report) {
    const sign = delta > 0 ? '+' : (delta < 0 ? '' : '±');
    console.log('  ' + file.padEnd(70) + '  ' + sign + delta + ' bytes  (' + note + ')');
  }
  if (DRY) console.log('\n✓ Dry-run complete. Re-run with --apply.\n');
  else     console.log('\n✓ Apply complete.\n');
}
main().catch(err => { console.error('\n❌ FAILED: ' + err.message + '\n'); process.exit(1); });
