import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../lib/csv';

// The furniture-list export is a file the user hands to someone else, and its
// cells carry names that are user-typed AND AI-generated. The export used to
// quote only, so a leading `=` went through verbatim and a spreadsheet evaluated
// it on open.
describe('csvCell', () => {
  it('quotes ordinary values without touching them', () => {
    expect(csvCell('Sofa')).toBe('"Sofa"');
    expect(csvCell(3)).toBe('"3"');
    expect(csvCell('')).toBe('""');
  });

  it('escapes embedded quotes by doubling', () => {
    expect(csvCell('The "good" sofa')).toBe('"The ""good"" sofa"');
  });

  it('neutralises every formula lead-in', () => {
    // Excel / Sheets / LibreOffice all treat these as the start of a formula.
    expect(csvCell('=HYPERLINK("http://x","click")')).toBe('"\'=HYPERLINK(""http://x"",""click"")"');
    expect(csvCell('+1+1')).toBe('"\'+1+1"');
    expect(csvCell('-1+1')).toBe('"\'-1+1"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell('\tcmd')).toBe('"\'\tcmd"');
    expect(csvCell('\rcmd')).toBe('"\'\rcmd"');
  });

  it('leaves a hyphen mid-string alone', () => {
    // Only the FIRST character matters, so real names keep their punctuation.
    expect(csvCell('L-shaped desk')).toBe('"L-shaped desk"');
    expect(csvCell('Sofa @ window')).toBe('"Sofa @ window"');
  });

  it('does not mangle a negative measurement into a formula escape twice', () => {
    // A genuinely negative number still reads correctly after the prefix is
    // stripped by the spreadsheet.
    expect(csvCell(-40)).toBe('"\'-40"');
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF, as Excel expects', () => {
    const out = toCsv([
      ['Qty', 'Name'],
      [2, 'Dining chair'],
    ]);
    expect(out).toBe('"Qty","Name"\r\n"2","Dining chair"');
  });

  it('keeps a comma inside a cell from splitting it', () => {
    expect(toCsv([['Sofa, 3-seat']])).toBe('"Sofa, 3-seat"');
  });
});
