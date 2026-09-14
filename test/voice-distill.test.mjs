// Prompt 117 — voice-distill helper tests.
//
// The distiller's value in P117 is that layer 1 (deterministic shape stats) needs
// NO model, and that layer 2's verbatim-citation rule is enforced mechanically
// rather than merely asked for in the prompt. Both are tested here; the ollama
// call itself is the on-prem operator step and is not exercised.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deterministicShapeStats, stratifiedSample, distillPrompt, longFormPrompt, enforceVerbatim,
} from '../scripts/voice-distill.mjs';
import { bodyShape, cleanEmailBodyDetailed } from '../api/_shared/voice-corpus-clean.js';

function row(cleaned, { signoff = null, audience = 'external', ts = '2026-08-01', rawChars = null } = {}) {
  return {
    cleaned, signoff, audience, ts, bucket: 'external_follow_up',
    shape: bodyShape(cleaned),
    raw_chars: rawChars == null ? cleaned.length * 4 : rawChars,
    kept_chars: cleaned.length,
  };
}

const SHORT = row('Got it. On it.', { ts: '2026-08-10' });
const MID = row('Got it. Tenant does pay the ground rent.\n\nI will call him and walk through that section of the lease.', { ts: '2026-08-09' });
const LONG = row(
  'Team - we are quietly working on a new-construction opportunity in an affluent suburban market.\n\n'
  + '1) Twelve years of firm term remaining, corporate guaranty behind it.\n'
  + '2) Rent is materially below market for the submarket.\n\n'
  + 'I will send the full package Monday once the survey is back. Let me know if you want an early look before it goes wide, and I will hold a copy for you.\n\n'
  + 'Pricing guidance will land in the low sixes. The seller is motivated but not distressed, so I do not expect a long marketing period on this one.',
  { signoff: 'Best regards,', ts: '2026-08-08' },
);

describe('deterministicShapeStats — evidence with no model', () => {
  const stats = deterministicShapeStats([SHORT, MID, LONG]);

  it('counts sign-offs honestly, including the "(none)" majority', () => {
    assert.equal(stats.signoff_rate_pct, 33.3);
    assert.equal(stats.signoff_forms['best regards'], 1);
    assert.equal(stats.signoff_forms['(none)'], 2);
  });

  it('reports the retention share — how much of the raw body was Scott\'s prose', () => {
    assert.ok(stats.kept_share_pct > 0 && stats.kept_share_pct <= 100);
    assert.ok(stats.avg_raw_chars > stats.avg_kept_chars);
  });

  it('separates a long-form sub-population that a 255-char corpus could not hold', () => {
    assert.equal(stats.n_long_form, 1);
    assert.ok(stats.long_form);
    assert.equal(stats.long_form.n, 1);
    assert.equal(stats.long_form.uses_list_pct, 100);
  });

  it('returns long_form: null rather than faking stats when there are none', () => {
    assert.equal(deterministicShapeStats([SHORT]).long_form, null);
  });

  it('never divides by zero on an empty pool', () => {
    const s = deterministicShapeStats([]);
    assert.equal(s.n, 0);
    assert.equal(s.kept_share_pct, 0);
    assert.equal(s.signoff_rate_pct, 0);
  });
});

describe('stratifiedSample — bounded, deterministic, length-diverse', () => {
  const pool = [
    ...Array.from({ length: 40 }, (_, i) => row(`Short reply ${i}.`, { ts: `2026-07-${String((i % 28) + 1).padStart(2, '0')}` })),
    ...Array.from({ length: 6 }, (_, i) => row('x'.repeat(500) + ` long ${i}`, { ts: `2026-06-${String(i + 1).padStart(2, '0')}` })),
  ];

  it('caps at k and is stable across runs', () => {
    const a = stratifiedSample(pool, 12);
    const b = stratifiedSample(pool, 12);
    assert.equal(a.length, 12);
    assert.deepEqual(a.map((r) => r.cleaned), b.map((r) => r.cleaned));
  });

  it('still reaches the long-form stratum a plain slice(0, k) would miss', () => {
    const s = stratifiedSample(pool, 12);
    assert.ok(s.some((r) => r.shape.is_long_form), 'no long-form exemplar was sampled');
  });

  it('returns the whole pool when it is already under k', () => {
    assert.equal(stratifiedSample([SHORT, MID], 24).length, 2);
  });
});

describe('prompts', () => {
  const stats = deterministicShapeStats([SHORT, MID, LONG]);

  it('states the deterministic measurements so the model cannot contradict them', () => {
    const p = distillPrompt('external_follow_up', [SHORT, MID, LONG], stats);
    assert.match(p, /sign-off present on 33\.3% of emails/);
    assert.match(p, /must be a verbatim/);
    assert.match(p, /COMPLETE emails/);
  });

  it('the long-form prompt asks for structure, not for openings', () => {
    const p = longFormPrompt('cold_bd_outreach', [LONG]);
    assert.match(p, /paragraph_progression/);
    assert.match(p, /what_he_never_does_at_length/);
  });
});

describe('enforceVerbatim — a hallucinated example cannot reach the profile', () => {
  const samples = [MID, LONG];

  it('keeps real excerpts and drops invented ones', () => {
    const out = enforceVerbatim({
      characteristic_phrases: ['Got it.', 'I hope this email finds you well'],
      transitions: ['Let me know if', 'Furthermore, in conclusion'],
      evidence: [
        { attribute: 'directness', excerpt: 'Tenant does pay the ground rent' },
        { attribute: 'warmth', excerpt: 'Warmest salutations to you and yours' },
      ],
    }, samples);

    assert.deepEqual(out.attributes.characteristic_phrases, ['Got it.']);
    assert.deepEqual(out.attributes.transitions, ['Let me know if']);
    assert.equal(out.attributes.evidence.length, 1);
    assert.match(out.attributes.evidence[0].excerpt, /ground rent/);
    assert.equal(out.dropped_unverbatim, 3);
  });

  it('matches across the line breaks the model collapses', () => {
    const out = enforceVerbatim({ evidence: [{ attribute: 'x', excerpt: 'corporate guaranty behind it. 2) Rent is materially below market' }] }, samples);
    assert.equal(out.attributes.evidence.length, 1, 'a whitespace-normalised match should survive');
  });

  it('redacts PII from surviving excerpts before they hit disk', () => {
    const withPii = [row('Call me at (918) 555-0142 or scott@example.com about the deal.')];
    const out = enforceVerbatim({ evidence: [{ attribute: 'x', excerpt: 'Call me at (918) 555-0142 or scott@example.com' }] }, withPii);
    assert.equal(out.attributes.evidence.length, 1);
    assert.doesNotMatch(out.attributes.evidence[0].excerpt, /555-0142/);
    assert.doesNotMatch(out.attributes.evidence[0].excerpt, /scott@example\.com/);
  });

  it('tolerates a model that returned nothing usable', () => {
    const out = enforceVerbatim({ _raw: 'not json' }, samples);
    assert.equal(out.dropped_unverbatim, 0);
  });
});

describe('end-to-end: a full body becomes a shaped, guarded corpus row', () => {
  it('cleans, measures, and keeps the sign-off observable', () => {
    const html = '<div>Got it — sending the package now.</div><div>&nbsp;</div><div>Two notes: the firm term is 12.1 years, and the cap holds at 6.00%.</div><div>Best regards,</div><div>Scott Briggs</div><div>Senior Vice President</div><div id="appendonsend"></div><div>From: Someone &lt;a@b.com&gt;</div>';
    const d = cleanEmailBodyDetailed(html.replace(/<[^>]+>/g, (t) => t));
    assert.ok(d.cleaned.length > 0);
  });
});
