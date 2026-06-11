// Phase 2 Slice 2c — local folder-feed backfill: enrich-mode payload shaping.
//
// The backfill reads bytes locally and POSTs /api/intake/stage-om. In enrich
// mode it must carry seed_data.mode='enrich' + a PROPERTIES-anchored subject_hint
// so the promoter takes the enrich (fill-blanks, never-create) branch; in ingest
// mode the payload must stay byte-identical to the Slice-1 backfill.
//
// Pure-helper test: imports buildStageEnvelope/hintPathFor (the module guards
// main() behind isMainModule, so importing it runs no CLI / exits).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStageEnvelope, hintPathFor } from '../scripts/folder-feed-backfill.mjs';

const COMMON = {
  fileName: 'DaVita Tulsa OM.pdf',
  bytesBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
  sha256: 'deadbeef',
  sizeBytes: 13,
};
// PROPERTIES-anchored path the matcher needs: tenant/brand + City, ST + vertical.
const HINT = 'PROPERTIES/D/DaVita Dialysis/Tulsa, OK/DaVita Tulsa OM.pdf';
const REL  = 'D/DaVita Dialysis/Tulsa, OK/DaVita Tulsa OM.pdf'; // root = …/PROPERTIES

describe('folder-feed backfill — hintPathFor (PROPERTIES anchor)', () => {
  it('re-roots at PROPERTIES even when --root points at the PROPERTIES dir', () => {
    const full = '/home/scott/Team Briggs - Documents/PROPERTIES/D/DaVita Dialysis/Tulsa, OK/DaVita Tulsa OM.pdf';
    assert.equal(hintPathFor(full, REL), HINT);
  });

  it('normalizes Windows backslash paths', () => {
    const full = 'C:\\Users\\scott\\Team Briggs - Documents\\PROPERTIES\\D\\DaVita Dialysis\\Tulsa, OK\\DaVita Tulsa OM.pdf';
    assert.equal(hintPathFor(full, REL), HINT);
  });

  it('falls back to the ROOT-relative path when there is no PROPERTIES segment', () => {
    const full = '/home/scott/Team Briggs - Documents/Storage OMs/Some Brand Flyer.pdf';
    const rel = 'Storage OMs/Some Brand Flyer.pdf';
    assert.equal(hintPathFor(full, rel), rel);
  });
});

describe('folder-feed backfill — buildStageEnvelope (enrich mode)', () => {
  it('stamps seed_data.mode=enrich and a resolved subject_hint', () => {
    const env = buildStageEnvelope({ ...COMMON, relPath: REL, hintPath: HINT, mode: 'enrich' });
    const seed = env.inputs.seed_data;
    assert.equal(seed.mode, 'enrich');
    assert.equal(seed.source_path, REL);
    assert.deepEqual(seed.tags, ['folder_feed', 'backfill']);
    // The path anchor resolved the existing property's identity fields.
    assert.equal(seed.subject_hint.tenant_brand, 'DaVita Dialysis');
    assert.equal(seed.subject_hint.city, 'Tulsa');
    assert.equal(seed.subject_hint.state, 'OK');
    assert.equal(seed.subject_hint.vertical, 'dia');
    // Artifact carries the local bytes (the sanctioned backfill upload).
    assert.equal(env.inputs.intake_channel, 'folder_feed');
    assert.equal(env.inputs.artifacts.primary_document.bytes_base64, COMMON.bytesBase64);
  });
});

describe('folder-feed backfill — buildStageEnvelope (ingest mode byte-identical)', () => {
  it('omits the mode key entirely (Slice-1 payload shape)', () => {
    const env = buildStageEnvelope({ ...COMMON, relPath: REL, hintPath: HINT, mode: 'ingest' });
    const seed = env.inputs.seed_data;
    assert.ok(!('mode' in seed), 'ingest seed_data carries no mode key');
    // Full byte-identical seed_data shape (tags, subject_hint, source_path).
    assert.deepEqual(seed, {
      tags: ['folder_feed', 'backfill'],
      subject_hint: {
        tenant_brand: 'DaVita Dialysis', city: 'Tulsa', state: 'OK',
        vertical: 'dia', bucket: 'D',
      },
      source_path: REL,
    });
  });

  it('defaults to ingest shape when mode is omitted', () => {
    const env = buildStageEnvelope({ ...COMMON, relPath: REL, hintPath: HINT });
    assert.ok(!('mode' in env.inputs.seed_data), 'no mode key when mode is undefined');
  });
});
