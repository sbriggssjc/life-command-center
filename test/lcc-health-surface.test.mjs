import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260801180000_lcc_health_surface.sql'),
  'utf8',
);

describe('Prompt 12 LCC Health surface migration', () => {
  it('creates a normalized health-event ledger and current/surface views', () => {
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.lcc_health_events/i);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.lcc_record_health_event/i);
    assert.match(sql, /CREATE OR REPLACE VIEW public\.v_lcc_health_events_current/i);
    assert.match(sql, /CREATE OR REPLACE VIEW public\.v_lcc_health_surface/i);
  });

  it('reuses existing failure and DB-drift signals', () => {
    assert.match(sql, /FROM public\.flow_run_failures/i);
    assert.match(sql, /FROM public\.v_field_source_priority_invalid_columns/i);
    assert.match(sql, /FROM public\.connector_accounts/i);
    assert.match(sql, /connector_type::text\s+AS check_name/i);
  });

  it('opens same-day health alerts through the existing alert table', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.lcc_health_threshold_tick/i);
    assert.match(sql, /INSERT INTO public\.lcc_health_alerts/i);
    assert.match(sql, /lcc-health-threshold-tick/i);
  });
});
