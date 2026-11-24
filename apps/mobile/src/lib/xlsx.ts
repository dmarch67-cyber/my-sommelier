import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

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

// Writing --------------------------------------------------------------------

export type XlsxCell = string | number | null | undefined;

/** How a number column is shown in Excel. */
export type XlsxFormat = 'integer' | 'money' | 'text';

export type XlsxSheet = {
  name: string;
  columns: { header: string; width?: number; format?: XlsxFormat }[];
  rows: XlsxCell[][];
  /** Rows after the data, e.g. totals; shown in bold. */
  footer?: XlsxCell[][];
};

// Style ids in styles.xml below.
const STYLE = { header: 1, integer: 2, money: 3, boldInteger: 4, boldMoney: 5, bold: 6 } as const;

/**
 * A small .xlsx writer: plain text and number cells, a bold frozen header row
 * with filter buttons, column widths and number formats. Enough for an
 * inventory export; not a general spreadsheet library.
 */
export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const names = uniqueSheetNames(sheets.map((s) => s.name));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      xml(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
          sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join('') +
          `</Types>`,
      ),
    ),
    '_rels/.rels': strToU8(
      xml(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    ),
    'xl/workbook.xml': strToU8(
      xml(
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
          names
            .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
            .join('') +
          `</sheets></workbook>`,
      ),
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      xml(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          sheets
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          `</Relationships>`,
      ),
    ),
    'xl/styles.xml': strToU8(xml(STYLES)),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });
  return zipSync(files, { level: 6 });
}

const STYLES =
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFF2EDE8"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="7">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs></styleSheet>`;

function sheetXml(s: XlsxSheet): string {
  const ncols = Math.max(1, s.columns.length);
  const lastCol = colName(ncols - 1);
  const dataRows = s.rows.length + 1;
  const out: string[] = [];
  const row = (cells: XlsxCell[], r: number, bold: boolean, header = false) => {
    const parts: string[] = [];
    cells.forEach((v, c) => {
      if (v == null || v === '') return;
      const ref = `${colName(c)}${r}`;
      const format = s.columns[c]?.format;
      if (typeof v === 'number' && Number.isFinite(v) && format !== 'text') {
        const style =
          format === 'money'
            ? bold
              ? STYLE.boldMoney
              : STYLE.money
            : format === 'integer'
              ? bold
                ? STYLE.boldInteger
                : STYLE.integer
              : bold
                ? STYLE.bold
                : 0;
        parts.push(`<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`);
      } else {
        const style = header ? STYLE.header : bold ? STYLE.bold : 0;
        const text = esc(String(v));
        parts.push(
          `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${text}</t></is></c>`,
        );
      }
    });
    out.push(`<row r="${r}">${parts.join('')}</row>`);
  };
  row(
    s.columns.map((c) => c.header),
    1,
    true,
    true,
  );
  s.rows.forEach((cells, i) => row(cells, i + 2, false));
  (s.footer ?? []).forEach((cells, i) => row(cells, dataRows + 2 + i, true));
  const lastRow = dataRows + (s.footer?.length ? s.footer.length + 1 : 0);

  return xml(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<dimension ref="A1:${lastCol}${lastRow}"/>` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="15"/>` +
      `<cols>${s.columns
        .map(
          (c, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.max(10, c.header.length + 2)}" customWidth="1"/>`,
        )
        .join('')}</cols>` +
      `<sheetData>${out.join('')}</sheetData>` +
      (s.rows.length ? `<autoFilter ref="A1:${lastCol}${dataRows}"/>` : '') +
      `</worksheet>`,
  );
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
}

function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and no repeats. */
function uniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}
