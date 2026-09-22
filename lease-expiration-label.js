// lease-expiration-label.js — RECON2-render-spa
// ============================================================================
// The SPA's copy of mcp/lease-expiration-state.js → leaseExpirationStateLabel().
//
// A dia lease past its own lease_expiration with no evidence it renewed sits at
// leases.expiration_state = 'expired_unconfirmed' while is_active stays TRUE by
// design (RECON2 never flips is_active on inference). Without a label the panel
// shows it as a plain Active lease. This file does LABELLING ONLY — it never
// changes which lease a surface picks as the active one.
//
// Classic script, one shared global scope (no bundler — see CLAUDE.md W6.5), so
// it cannot import mcp/. The string is mirrored here and held in lock-step by
// test/recon2-render-spa-label.test.mjs, which fails on any drift from the
// server helper. Change BOTH or neither.
//
// Every other state — and every gov lease (no such column) — returns null / ''
// so the surrounding output is byte-for-byte unchanged.
// ============================================================================

function _leaseExpStateLabel(lease) {
  if (!lease || lease.expiration_state !== 'expired_unconfirmed') return null;
  const date = lease.lease_expiration ? String(lease.lease_expiration).slice(0, 10) : null;
  return date
    ? `Expired ${date} — renewal not on file (unconfirmed)`
    : 'Expired — renewal not on file (unconfirmed)';
}

// Inline badge rendered beside an expiration / an "Active" badge. Empty string
// for every state other than 'expired_unconfirmed'.
function _leaseExpStateBadge(lease) {
  const label = _leaseExpStateLabel(lease);
  if (!label) return '';
  const safe = typeof esc === 'function' ? esc(label) : String(label).replace(/[&<>"']/g, '');
  return ` <span class="lease-exp-unconfirmed" title="${safe}" style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(245,158,11,0.15);color:#f59e0b;font-weight:600;margin-left:4px">${safe}</span>`;
}

window._leaseExpStateLabel = _leaseExpStateLabel;
window._leaseExpStateBadge = _leaseExpStateBadge;
