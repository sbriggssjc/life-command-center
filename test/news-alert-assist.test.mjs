import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNewsAlertExtractionPrompt,
  parseNewsAlertExtractionJson,
  normalizeNewsAlertExtraction,
} from '../api/_shared/news-alert-assist.js';

describe('news-alert assist prompt', () => {
  it('grounds the model on the alert payload and forbids writes', () => {
    const prompt = buildNewsAlertExtractionPrompt({
      news_lead_id: 'n1',
      tenant: 'DaVita',
      article_title: 'Permit filed for new DaVita clinic',
      summary: 'ABC Development submitted plans for a clinic in Dallas, TX.',
    });
    assert.match(prompt, /only ANNOTATE/i);
    assert.match(prompt, /never create records/i);
    assert.match(prompt, /ABC Development/);
    assert.match(prompt, /recorded_owner/);
    assert.match(prompt, /construction_loan/);
  });
});

describe('parseNewsAlertExtractionJson', () => {
  it('parses fenced JSON', () => {
    const parsed = parseNewsAlertExtractionJson('```json\n{"recommended_next_step":"track"}\n```');
    assert.equal(parsed.recommended_next_step, 'track');
  });

  it('falls back to the first object in prose', () => {
    const parsed = parseNewsAlertExtractionJson('Here: {"reason":"ok"} trailing');
    assert.equal(parsed.reason, 'ok');
  });
});

describe('normalizeNewsAlertExtraction', () => {
  it('clamps confidence, limits roles, and preserves grounded fields', () => {
    const out = normalizeNewsAlertExtraction({
      project: { description: 'New clinic', city: '', confidence: 9, evidence: 'Permit filed' },
      parties: [
        { name: 'ABC Development', role: 'applicant', confidence: 0.8, evidence: 'submitted plans' },
        { name: 'Made Up Role LLC', role: 'wizard', confidence: -1, evidence: 'thin' },
      ],
      timeline: [{ event: 'construction start', date_or_period: 'Q4 2026', confidence: 0.7, evidence: 'starts later this year' }],
      debt_or_deed_signals: [{ signal_type: 'construction_loan', party: 'Local Bank', confidence: 0.6, evidence: 'financing' }],
      follow_up_triggers: ['watch permit docket', 'watch deed records'],
      recommended_next_step: 'research_owner',
      reason: 'Owner/applicant named.',
    }, { city: 'Dallas', state: 'TX', tenant: 'DaVita', domain: 'dialysis' }, { provider: 'ollama', model: 'qwen2.5:14b' });

    assert.equal(out.project.city, 'Dallas');
    assert.equal(out.project.tenant, 'DaVita');
    assert.equal(out.project.confidence, 1);
    assert.equal(out.parties[0].role, 'applicant');
    assert.equal(out.parties[1].role, 'unknown');
    assert.equal(out.parties[1].confidence, 0);
    assert.equal(out.timeline[0].date_or_period, 'Q4 2026');
    assert.equal(out.debt_or_deed_signals[0].signal_type, 'construction_loan');
    assert.deepEqual(out.follow_up_triggers, ['watch permit docket', 'watch deed records']);
    assert.equal(out.recommended_next_step, 'research_owner');
    assert.equal(out.provider, 'ollama');
  });

  it('defaults unknown next steps to uncertain', () => {
    const out = normalizeNewsAlertExtraction({ recommended_next_step: 'auto_create_property' });
    assert.equal(out.recommended_next_step, 'uncertain');
  });
});

