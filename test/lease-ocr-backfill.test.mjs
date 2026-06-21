// UW#4 — pure helpers of the free-OCR lease drainer (no binaries / network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { localPathFor, meanConfidenceFromTsv } = await import('../scripts/lease-ocr-backfill.mjs');

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
