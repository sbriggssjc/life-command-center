// UW#4 — pure helpers of the free-OCR lease drainer (no binaries / network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { localPathFor, meanConfidenceFromTsv, textAndConfFromSuryaJson, textAndConfFromPaddleJson } =
  await import('../scripts/lease-ocr-backfill.mjs');

describe('lease-ocr-backfill — localPathFor', () => {
  const ROOT = '/Users/scott/Team Briggs - Documents';
  const PREFIX = '/sites/TeamBriggs20/Shared Documents';

  it('strips the SharePoint site/library prefix and joins the local root', () => {
    const p = localPathFor('/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Tampa, FL/lease.pdf', ROOT, PREFIX);
    assert.equal(p, '/Users/scott/Team Briggs - Documents/PROPERTIES/D/DaVita/Tampa, FL/lease.pdf');
  });

  it('is case-insensitive on the prefix', () => {
    const p = localPathFor('/Sites/TeamBriggs20/SHARED DOCUMENTS/PROPERTIES/x.pdf', ROOT, PREFIX);
    assert.equal(p, '/Users/scott/Team Briggs - Documents/PROPERTIES/x.pdf');
  });

  it('returns null when the prefix is absent (never guesses)', () => {
    assert.equal(localPathFor('/some/other/library/x.pdf', ROOT, PREFIX), null);
  });

  it('returns null on empty input', () => {
    assert.equal(localPathFor('', ROOT, PREFIX), null);
    assert.equal(localPathFor('/sites/TeamBriggs20/Shared Documents/', ROOT, PREFIX), null);
  });
});

describe('lease-ocr-backfill — meanConfidenceFromTsv', () => {
  const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

  it('averages only scorable words (conf>=0, non-empty)', () => {
    const tsv = [
      header,
      '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tGRANT',
      '5\t1\t1\t1\t1\t2\t0\t0\t10\t10\t80\tDEED',
      '4\t1\t1\t1\t1\t0\t0\t0\t0\t0\t-1\t',        // non-word row, conf -1 → excluded
    ].join('\n');
    assert.equal(meanConfidenceFromTsv(tsv), 85);
  });

  it('returns null when there is no scorable word', () => {
    assert.equal(meanConfidenceFromTsv(header), null);
    assert.equal(meanConfidenceFromTsv(''), null);
  });

  it('ignores rows with too few columns', () => {
    const tsv = [header, 'garbage', '5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t70\tLEASE'].join('\n');
    assert.equal(meanConfidenceFromTsv(tsv), 70);
  });
});

describe('lease-ocr-backfill — textAndConfFromSuryaJson (UW#4b)', () => {
  it('flattens per-line text + scales 0-1 confidence to 0-100', () => {
    const surya = {
      'lease': [
        { page: 1, text_lines: [
          { text: 'BASE RENT $100,000', confidence: 0.98 },
          { text: 'ESCALATION 3% ANNUAL', confidence: 0.96 },
        ] },
        { page: 2, text_lines: [{ text: 'GUARANTOR: DaVita Inc.', confidence: 0.94 }] },
      ],
    };
    const r = textAndConfFromSuryaJson(JSON.stringify(surya));
    assert.match(r.text, /BASE RENT \$100,000/);
    assert.match(r.text, /GUARANTOR: DaVita Inc\./);
    assert.equal(r.confidence, 96);   // (98+96+94)/3 → 96.0
  });

  it('accepts an object (not just a string) and tolerates missing confidence', () => {
    const r = textAndConfFromSuryaJson({ doc: [{ text_lines: [{ text: 'RENEWAL: two 5-year options' }] }] });
    assert.match(r.text, /RENEWAL: two 5-year options/);
    assert.equal(r.confidence, null);
  });

  it('garbage / empty → empty text, null confidence', () => {
    assert.deepEqual(textAndConfFromSuryaJson('not json'), { text: '', confidence: null });
    assert.deepEqual(textAndConfFromSuryaJson({}), { text: '', confidence: null });
  });
});

describe('lease-ocr-backfill — textAndConfFromPaddleJson (UW#4b)', () => {
  it('parses the 3.x rec_texts / rec_scores shape', () => {
    const paddle = { rec_texts: ['TERM: 15 YEARS', 'EXPIRATION 2039-12-31'], rec_scores: [0.99, 0.97] };
    const r = textAndConfFromPaddleJson(paddle);
    assert.match(r.text, /TERM: 15 YEARS/);
    assert.match(r.text, /EXPIRATION 2039-12-31/);
    assert.equal(r.confidence, 98);
  });

  it('parses the legacy [bbox, [text, score]] line-tuple shape', () => {
    const legacy = [
      [[[0, 0], [10, 0], [10, 5], [0, 5]], ['NNN EXPENSE STRUCTURE', 0.92]],
      [[[0, 6], [10, 6], [10, 11], [0, 11]], ['LANDLORD: ACME LLC', 0.88]],
    ];
    const r = textAndConfFromPaddleJson(legacy);
    assert.match(r.text, /NNN EXPENSE STRUCTURE/);
    assert.match(r.text, /LANDLORD: ACME LLC/);
    assert.equal(r.confidence, 90);
  });

  it('garbage / empty → empty text, null confidence', () => {
    assert.deepEqual(textAndConfFromPaddleJson('not json'), { text: '', confidence: null });
    assert.deepEqual(textAndConfFromPaddleJson([]), { text: '', confidence: null });
  });
});
