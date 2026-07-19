import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectInfraAlert,
  infraUrgency,
  buildInfraScoringItem,
  priorityTierFromScore,
} from '../api/_shared/intake-classify.js';
import { scoreItem } from '../api/_shared/briefing-data.js';

// The end-to-end tier an infra alert would receive: the SAME path api/intake.js
// uses — classify → build the pseudo-item → shared scoreItem() → bucket.
function tierFor(subject, senderEmail) {
  const { score } = scoreItem(buildInfraScoringItem({ subject, senderEmail }), null);
  return priorityTierFromScore(score);
}

test('detectInfraAlert — sender domains (Vercel/GitHub + subdomains)', () => {
  assert.deepEqual(detectInfraAlert({ senderEmail: 'noreply@vercel.com', subject: 'x' }),
    { isInfra: true, sourceSystem: 'vercel', matchedBy: 'sender_domain' });
  assert.equal(detectInfraAlert({ senderEmail: 'notifications@github.com', subject: 'x' }).sourceSystem, 'github');
  // subdomain match
  assert.equal(detectInfraAlert({ senderEmail: 'bot@notifications.github.com', subject: 'x' }).sourceSystem, 'github');
  assert.equal(detectInfraAlert({ senderEmail: 'app@githubapp.com', subject: 'x' }).sourceSystem, 'github');
  // sender wins over subject (source_system from the authoritative domain)
  const r = detectInfraAlert({ senderEmail: 'deploy@vercel.com', subject: 'Build failed' });
  assert.equal(r.sourceSystem, 'vercel');
  assert.equal(r.matchedBy, 'sender_domain');
});

test('detectInfraAlert — subject fallback when sender is not vercel/github', () => {
  const r = detectInfraAlert({ senderEmail: 'ci@example.com', subject: 'Build failed for soccer-video' });
  assert.equal(r.isInfra, true);
  assert.equal(r.matchedBy, 'subject');
  assert.equal(detectInfraAlert({ senderEmail: 'x@y.com', subject: 'Workflow run failed' }).sourceSystem, 'github');
  assert.equal(detectInfraAlert({ senderEmail: 'x@y.com', subject: 'Vercel deployment failed' }).sourceSystem, 'vercel');
  assert.equal(detectInfraAlert({ senderEmail: 'x@y.com', subject: 'Action required: verify email' }).isInfra, true);
});

test('detectInfraAlert — normal deal/FYI email is NOT infra', () => {
  assert.equal(detectInfraAlert({ senderEmail: 'broker@cbre.com', subject: 'OM for 123 Main St' }).isInfra, false);
  // a real GitHub notification that is not a failure (avoid the "build" false-positive)
  assert.equal(detectInfraAlert({ senderEmail: 'friend@gmail.com', subject: 'building our pipeline together' }).isInfra, false);
  assert.equal(detectInfraAlert({}).isInfra, false);
});

test('infraUrgency — failure vs attention vs notice', () => {
  assert.equal(infraUrgency('Build failed — soccer-video'), 'high');
  assert.equal(infraUrgency('Deployment error on prod'), 'high');
  assert.equal(infraUrgency('Action required: approve deployment'), 'medium');
  assert.equal(infraUrgency('Vercel weekly digest'), 'low');
});

test('buildInfraScoringItem — encodes urgency in priority, no due_date, no body', () => {
  const hi = buildInfraScoringItem({ subject: 'Build failed', senderEmail: 'noreply@vercel.com' });
  assert.equal(hi.priority, 'urgent');
  assert.equal(hi.source_type, 'flagged_email');
  assert.equal(hi.body, '');
  assert.equal('due_date' in hi, false);
  assert.equal(buildInfraScoringItem({ subject: 'Action required: x' }).priority, 'high');
  assert.equal(buildInfraScoringItem({ subject: 'weekly digest' }).priority, 'low');
});

test('priorityTierFromScore — bucket boundaries', () => {
  assert.equal(priorityTierFromScore(40), 'HIGH');
  assert.equal(priorityTierFromScore(41), 'HIGH');
  assert.equal(priorityTierFromScore(39), 'MED');
  assert.equal(priorityTierFromScore(20), 'MED');
  assert.equal(priorityTierFromScore(19), 'LOW');
  assert.equal(priorityTierFromScore(0), 'LOW');
  assert.equal(priorityTierFromScore(null), 'LOW');
});

test('end-to-end tier via the shared scoreItem engine', () => {
  // build failure (urgent) → HIGH; below deal-deadline emails, above bare FYI
  assert.equal(tierFor('Build failed — soccer-video', 'noreply@vercel.com'), 'HIGH');
  assert.equal(tierFor('Workflow run failed', 'notifications@github.com'), 'HIGH');
  // action-required (attention) → MED
  assert.equal(tierFor('Action required: verify your account', 'noreply@vercel.com'), 'MED');
  // soft notice (low) → LOW
  assert.equal(tierFor('Vercel weekly digest', 'noreply@vercel.com'), 'LOW');

  // an infra alert must score BELOW an active deal-deadline email…
  const dealScore = scoreItem({
    title: 'Offer / under contract — closing next week', body: '',
    metadata: {}, source_type: 'flagged_email', priority: 'high',
  }, null).score;
  const infraScore = scoreItem(buildInfraScoringItem({ subject: 'Build failed' }), null).score;
  assert.ok(infraScore < dealScore, `infra ${infraScore} should be < deal ${dealScore}`);

  // …and ABOVE a bare FYI/reference email (no keywords, normal priority)
  const fyiScore = scoreItem({
    title: 'FYI — newsletter', body: '', metadata: {}, source_type: 'flagged_email', priority: 'normal',
  }, null).score;
  assert.ok(infraScore > fyiScore, `infra ${infraScore} should be > fyi ${fyiScore}`);
});
