import { strFromU8, unzipSync } from 'fflate';

/**
 * A small .xlsx reader: returns the first sheet as rows of text. An .xlsx file
 * is a zip of XML files; this reads the shared strings and the first
 * worksheet. Formulas give their last calculated value, as Excel saved it.
 * Enough for a delivery list; not a general spreadsheet library.
 */
export function readXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) =>
      f.name === 'xl/sharedStrings.xml' ||
      f.name === 'xl/workbook.xml' ||
      f.name === 'xl/_rels/workbook.xml.rels' ||
      f.name.startsWith('xl/worksheets/sheet'),
  });
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  const shared: string[] = [];
  for (const si of text('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) ?? []) {
    shared.push(
      decode(
        (si.match(/<t[^>]*>[\s\S]*?<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
      ),
    );
  }

  // The first sheet in the workbook's order (not always sheet1.xml).
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = text('xl/workbook.xml').match(/<sheet\b[^>]*r:id="([^"]+)"/);
  if (firstSheet) {
    const rel =
      text('xl/_rels/workbook.xml.rels').match(
        new RegExp(`<Relationship\\b[^>]*Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`),
      ) ??
      text('xl/_rels/workbook.xml.rels').match(
        new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${firstSheet[1]}"`),
      );
    if (rel) sheetPath = 'xl/' + rel[1].replace(/^\/?xl\//, '');
  }
  const sheet = text(sheetPath) || text('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('This file has no worksheet. Is it an Excel .xlsx file?');

  const rows: string[][] = [];
  for (const rowXml of sheet.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
    const rowNum = Number(rowXml.match(/<row\b[^>]*\br="(\d+)"/)?.[1] ?? rows.length + 1);
    const row: string[] = [];
    for (const c of rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = c.match(/\bt="(\w+)"/)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        value = decode((c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? '').replace(/<[^>]+>/g, ''));
      } else {
        const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        value = type === 's' ? (shared[Number(v)] ?? '') : decode(v);
        if (!type && /^-?\d+\.\d{6,}$/.test(value))
          value = String(Math.round(Number(value) * 100) / 100);
      }
      row[ref ? colIndex(ref) : row.length] = value;
    }
    rows[rowNum - 1] = Array.from(row, (v) => v ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}
