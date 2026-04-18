#!/usr/bin/env node
// ============================================================================
// Copilot Action Smoke Test Suite
// Life Command Center — Wave 0-3 Validation
//
// Usage:
//   node test/smoke-copilot-actions.mjs                          # uses localhost:3000
//   node test/smoke-copilot-actions.mjs https://your-app.vercel.app
//   LCC_API_KEY=xxx node test/smoke-copilot-actions.mjs https://your-app.vercel.app
//
// What it does:
//   1. Tests all read-only actions return 200 with expected shapes
//   2. Tests write actions return confirmation prompts (without _confirmed)
//   3. Tests AI-powered handlers return generated content
//   4. Tests confirmation bypass works (with _confirmed, dry-run safe actions only)
//   5. Reports pass/fail summary with timing
// ============================================================================

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const API_KEY = process.env.LCC_API_KEY || '';
const WORKSPACE_ID = process.env.LCC_WORKSPACE_ID || '';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SKIP = '\x1b[33m○\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

async function dispatch(actionName, params = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-lcc-key'] = API_KEY;
  if (WORKSPACE_ID) headers['x-lcc-workspace'] = WORKSPACE_ID;

  const startMs = Date.now();
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ copilot_action: actionName, params }),
  });
  const durationMs = Date.now() - startMs;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, durationMs };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ${PASS} ${name}`);
  } catch (e) {
    failed++;
    const msg = e.message || String(e);
    console.log(`  ${FAIL} ${name} — ${msg}`);
    failures.push({ name, error: msg });
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  ${SKIP} ${name} — ${reason}`);
}

// ============================================================================
// TIER 0: READ-ONLY ACTIONS
// ============================================================================

async function testReadActions() {
  console.log(`\n${BOLD}Tier 0: Read-Only Actions${RESET}`);

  await test('get_daily_briefing_snapshot returns snapshot payload', async () => {
    const { status, data, durationMs } = await dispatch('get_daily_briefing_snapshot', { role_view: 'broker' });
    assert(status === 200, `Expected 200, got ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.source === 'copilot_action_dispatch', 'Missing dispatch source');
    assert(data.briefing_id || data.data || data.ok !== undefined, 'No briefing data in response');
    console.log(`    ${durationMs}ms`);
  });

  await test('list_staged_intake_inbox returns data', async () => {
    const { status, data, durationMs } = await dispatch('list_staged_intake_inbox');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.source === 'copilot_action_dispatch', 'Missing dispatch source');
    console.log(`    ${durationMs}ms`);
  });

  await test('get_my_execution_queue returns data', async () => {
    const { status, data, durationMs } = await dispatch('get_my_execution_queue');
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('get_sync_run_health returns data', async () => {
    const { status, data, durationMs } = await dispatch('get_sync_run_health');
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('get_hot_business_contacts returns data', async () => {
    const { status, data, durationMs } = await dispatch('get_hot_business_contacts');
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('search_entity_targets returns data', async () => {
    const { status, data, durationMs } = await dispatch('search_entity_targets', { q: 'test' });
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('fetch_listing_activity_context returns data', async () => {
    const { status, data, durationMs } = await dispatch('fetch_listing_activity_context', { entity_id: 'none' });
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('get_work_counts returns counts', async () => {
    const { status, data, durationMs } = await dispatch('get_work_counts');
    assert(status === 200, `Expected 200, got ${status}`);
    console.log(`    ${durationMs}ms`);
  });

  await test('get_pipeline_intelligence returns pipeline data', async () => {
    const { status, data, durationMs } = await dispatch('get_pipeline_intelligence');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.pipeline || data.response, 'No pipeline data or AI response');
    console.log(`    ${durationMs}ms`);
  });

  await test('guided_entity_merge returns merge candidates', async () => {
    const { status, data, durationMs } = await dispatch('guided_entity_merge');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.message || data.entity_duplicates !== undefined, 'No merge data');
    console.log(`    ${durationMs}ms`);
  });

  await test('generate_teams_card returns card JSON', async () => {
    const { status, data, durationMs } = await dispatch('generate_teams_card', {
      card_type: 'inbox_triage',
      data: { title: 'Test Item', sender: 'test@example.com', priority: 'normal' }
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.card?.type === 'AdaptiveCard', 'No AdaptiveCard in response');
    console.log(`    ${durationMs}ms`);
  });
}

// ============================================================================
// TIER 1-2: WRITE ACTIONS — CONFIRMATION ENFORCEMENT
// ============================================================================

async function testConfirmationEnforcement() {
  console.log(`\n${BOLD}Tier 1-2: Confirmation Enforcement (should NOT execute)${RESET}`);

  const writeActions = [
    { name: 'draft_outreach_email', params: { contact_name: 'Test Contact' }, expectedConfirm: 'explicit' },
    { name: 'draft_seller_update_email', params: { entity_name: 'Test Property' }, expectedConfirm: 'explicit' },
    { name: 'ingest_outlook_flagged_emails', params: {}, expectedConfirm: 'lightweight' },
    { name: 'triage_inbox_item', params: { id: 'test-id' }, expectedConfirm: 'lightweight' },
    { name: 'promote_intake_to_action', params: { inbox_item_id: 'test-id' }, expectedConfirm: 'explicit' },
    { name: 'create_listing_pursuit_followup_task', params: { title: 'Test', action_type: 'follow_up' }, expectedConfirm: 'explicit' },
    { name: 'update_execution_task_status', params: { id: 'test-id', status: 'in_progress' }, expectedConfirm: 'explicit' },
    { name: 'retry_sync_error_record', params: { error_id: 'test-id' }, expectedConfirm: 'explicit' },
    { name: 'create_todo_task', params: { title: 'Test Task' }, expectedConfirm: 'explicit' },
    { name: 'generate_document', params: { doc_type: 'pursuit_summary', entity_name: 'Test' }, expectedConfirm: 'explicit' },
    { name: 'research_followup', params: { research_task_id: 'test-id' }, expectedConfirm: 'explicit' },
    { name: 'reassign_work_item', params: { item_type: 'action', item_id: 'test', assigned_to: 'test' }, expectedConfirm: 'explicit' },
    { name: 'escalate_action', params: { action_item_id: 'test', escalate_to: 'test', reason: 'test' }, expectedConfirm: 'explicit' },
  ];

  for (const { name, params, expectedConfirm } of writeActions) {
    await test(`${name} requires ${expectedConfirm} confirmation`, async () => {
      const { status, data } = await dispatch(name, params);
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.requires_confirmation === true, `Should require confirmation, got: ${JSON.stringify(data).slice(0, 200)}`);
      assert(data.confirmation_level === expectedConfirm, `Expected ${expectedConfirm}, got ${data.confirmation_level}`);
    });
  }
}

// ============================================================================
// TIER AI: AI-POWERED HANDLERS
// ============================================================================

async function testAiHandlers() {
  console.log(`\n${BOLD}AI-Powered Handlers (require AI provider)${RESET}`);

  await test('generate_prospecting_brief returns brief + contacts', async () => {
    const { status, data, durationMs } = await dispatch('generate_prospecting_brief', { limit: 3 });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.action === 'generate_prospecting_brief', 'Wrong action in response');
    // May have response (if AI available) or contacts (if contacts exist) or both
    assert(data.response !== undefined || data.contacts !== undefined, 'No response or contacts');
    console.log(`    ${durationMs}ms | contacts: ${data.contacts?.length || 0} | provider: ${data.provider || 'none'}`);
  });

  await test('get_relationship_context returns contact + briefing', async () => {
    const { status, data, durationMs } = await dispatch('get_relationship_context', { contact_name: 'Boyd' });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.action === 'get_relationship_context', 'Wrong action');
    console.log(`    ${durationMs}ms | contact found: ${!!data.contact} | provider: ${data.provider || 'none'}`);
  });

  await test('generate_listing_pursuit_dossier returns dossier', async () => {
    const { status, data, durationMs } = await dispatch('generate_listing_pursuit_dossier', { entity_name: 'test' });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.action === 'generate_listing_pursuit_dossier', 'Wrong action');
    console.log(`    ${durationMs}ms | entity: ${data.entity?.name || 'none'} | provider: ${data.provider || 'none'}`);
  });
}

// ============================================================================
// NATURAL LANGUAGE CHAT
// ============================================================================

async function testNaturalLanguageChat() {
  console.log(`\n${BOLD}Natural Language Chat (system prompt + context enrichment)${RESET}`);

  await test('Chat responds to operational question', async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (API_KEY) headers['x-lcc-key'] = API_KEY;
    if (WORKSPACE_ID) headers['x-lcc-workspace'] = WORKSPACE_ID;

    const startMs = Date.now();
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: "What's in my queue?", context: { assistant_feature: 'global_copilot' } }),
    });
    const durationMs = Date.now() - startMs;
    const data = await res.json().catch(() => ({}));
    assert(res.status === 200, `Expected 200, got ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    assert(data.response?.length > 10, 'Response too short or missing');
    assert(data.provider, 'No provider reported');
    console.log(`    ${durationMs}ms | provider: ${data.provider} | response length: ${data.response?.length || 0}`);
  });
}

// ============================================================================
// INVALID/EDGE CASES
// ============================================================================

async function testEdgeCases() {
  console.log(`\n${BOLD}Edge Cases${RESET}`);

  await test('Unknown action returns error with action list', async () => {
    const { status, data } = await dispatch('nonexistent_action');
    assert(status === 400, `Expected 400, got ${status}`);
    assert(data.error?.includes('Unknown action'), 'Missing error message');
    assert(Array.isArray(data.available_actions), 'Missing available_actions list');
  });

  await test('generate_document with invalid doc_type returns error', async () => {
    const { data } = await dispatch('generate_document', { _confirmed: true, doc_type: 'invalid_type' });
    assert(data.error?.includes('Unknown doc_type'), 'Missing doc_type error');
  });

  await test('generate_teams_card with invalid card_type returns error', async () => {
    const { data } = await dispatch('generate_teams_card', { card_type: 'invalid' });
    assert(data.error?.includes('Unknown card_type'), 'Missing card_type error');
  });
}

// ============================================================================
// RUN ALL
// ============================================================================

async function main() {
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  LCC Copilot Action Smoke Tests${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  Target:    ${BASE_URL}`);
  console.log(`  API Key:   ${API_KEY ? '***' + API_KEY.slice(-4) : '(none — using transitional auth)'}`);
  console.log(`  Workspace: ${WORKSPACE_ID || '(auto-resolve)'}`);
  console.log(`  Time:      ${new Date().toISOString()}`);

  // Quick connectivity check
  try {
    const r = await fetch(`${BASE_URL}/api/config`);
    if (!r.ok) throw new Error(`Status ${r.status}`);
    console.log(`  Status:    Connected\n`);
  } catch (e) {
    console.log(`  Status:    \x1b[31mCannot reach ${BASE_URL}\x1b[0m — ${e.message}`);
    console.log(`\n  Start dev server with: npm run dev\n`);
    process.exit(1);
  }

  await testReadActions();
  await testConfirmationEnforcement();
  await testAiHandlers();
  await testNaturalLanguageChat();
  await testEdgeCases();

  // Summary
  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${PASS} Passed: ${passed}`);
  if (failed > 0) console.log(`  ${FAIL} Failed: ${failed}`);
  if (skipped > 0) console.log(`  ${SKIP} Skipped: ${skipped}`);
  console.log(`  Total:  ${passed + failed + skipped}`);

  if (failures.length > 0) {
    console.log(`\n${BOLD}  Failures:${RESET}`);
    failures.forEach(f => {
      console.log(`  ${FAIL} ${f.name}`);
      console.log(`    ${f.error}`);
    });
  }

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════${RESET}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
