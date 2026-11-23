// A small made-up workbook in the same layout as the real one, covering the
// awkward cases. The real spreadsheet never goes in the repo.

import ExcelJS from 'exceljs';

type Line = (string | number | null | { formula: string; result: number })[];

function sheet(wb: ExcelJS.Workbook, name: string, header: Line, rows: Line[], startRow: number) {
  const ws = wb.addWorksheet(name);
  ws.getRow(1).values = header as ExcelJS.CellValue[];
  rows.forEach((r, i) => {
    const row = ws.getRow(startRow + i);
    r.forEach((v, j) => {
      if (v !== null) row.getCell(j + 1).value = v as ExcelJS.CellValue;
    });
  });
  return ws;
}

/** Counts this fixture must produce. */
export const FIXTURE_EXPECT = {
  lines: { NCP: 6, O: 3, Paris: 4 },
  physical: { NCP: 16, O: 7, Paris: 21 },
  inCellar: { NCP: 12, O: 7, Paris: 21 },
  onOrder: { NCP: 4, O: 0, Paris: 0 },
  magnums: { NCP: 1, O: 0, Paris: 7 },
};

export async function buildFixture(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  // LA: columns A..M = (blank) YEAR WINE REGION RP PRICE QTY LEFT TOTAL GONE FUTURE (L) ACCOLADE
  const la = sheet(
    wb,
    'NCP',
    [null, null, 'WINE', 'REGION', 'RP', 'PRICE', 'QTY', 'LEFT', 'TOTAL', 'GONE', 'FUTURE'],
    [
      [null, null, 'FRANCE'],
      [null, 2015, 'BADETTE ', 'ST. EMILION', '94+', 35, 4, 3, 140, 1],
      [null, 2008, 'BARDE-HAUT', 'ST. EMILION', 92, 0, 2, 2, 0, null, ' '],
      [
        null,
        2010,
        'LEOVILLE BARTON',
        'ST JULIEN',
        93,
        { formula: '340/5', result: 68 },
        5,
        0,
        340,
        5,
        null,
        null,
        'WS #2 WOY 2018',
      ],
      [null, null, 'CALIFORNIA'],
      [null, 2016, 'SAXUM BONE ROCK 1.5L', 'PASO ROBLES', '92-94', 296, 1, 1, 296],
      [null, 2024, 'TRUSS SKETCH 01', 'PASO ROBLES', 95, 75, 4, 4, 300, null, 4],
      [null, null, ' '],
      [null, null, 'OREGON'],
      [null, 2023, 'BERGSTROM SIGRID CHARDONNAY', 'RIBBON RIDGE', 97, 106, 6, 6, 636],
    ],
    2,
  );
  // Summary block like the real one.
  la.getCell('E12').value = 'Total Wine';
  la.getCell('G12').value = 22;
  la.getCell('H12').value = 16;
  la.getCell('J12').value = 6;
  la.getCell('K12').value = 4;
  la.getCell('F14').value = 'In Storage:';
  la.getCell('H14').value = 12;
  la.getCell('F15').value = "On it's way";
  la.getCell('H15').value = 4;

  const o = sheet(
    wb,
    'O',
    [null, 'YEAR', 'WINE', 'REGION', 'RP', 'PRICE', 'QTY', 'LEFT', 'TOTAL', 'GONE', 'FUTURE'],
    [
      [null, 2023, 'BERGSTROM SIGRID CHARDONNAY', 'DUNDEE HILLS', 97, 106, 5, 4, 530, 1],
      [null, 2023, 'BLEDSOE FAMILY CABERNET', 'WALLA WALLA', null, 52, 2, 1, 104, 1],
      [null, 2023, 'BERGSTROM LA SPIRALE PINOT NOIR', 'YAMHILL CARLTON', 94, 85, 2, 2, 999, null],
    ],
    2,
  );
  o.getCell('G6').value = 9;
  o.getCell('H6').value = 7;
  o.getCell('J6').value = 2;

  // Paris: A marker, D size in litres, E region, F RP, G price, H QTY, I LEFT, J TOTAL, K GONE, L FUTURE, U accolade
  const p = sheet(
    wb,
    'Paris',
    [null, null, 'WINE', null, 'REGION', 'RP', 'PRICE', 'QTY', 'LEFT', 'TOTAL', 'GONE', 'FUTURE'],
    [
      [null, null, 'FRANCE'],
      [null, 2008, 'CHATEAU BARDE-HAUT', 1.5, 'ST. EMILION', 90, 41.28, 6, 6, 247.68],
      [
        null,
        2016,
        'LEOVILLE BARTON',
        0.75,
        'ST JULIEN',
        96,
        null,
        12,
        12,
        0,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'WS #1 WOY 2019',
      ],
      [null, null, 'SPAIN'],
      [
        '*',
        2014,
        'AALTO PS',
        0.75,
        'RIBERA DEL DUERO',
        94,
        70,
        3,
        2,
        210,
        1,
        null,
        null,
        null,
        140,
        420,
        null,
        70,
      ],
      [
        null,
        2013,
        'ABADIA RETUERTA SELECCION ESPECIAL 1.5L',
        1.5,
        'SARDON DEL DEUERO',
        93,
        60,
        3,
        1,
        180,
        2,
      ],
    ],
    2,
  );
  p.getCell('F9').value = 'Total Wine';
  p.getCell('H9').value = 24;
  p.getCell('I9').value = 21;
  p.getCell('K9').value = 3;

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Layouts for the fixture: same columns as the real workbook, shorter sheets. */
export async function fixtureLayouts() {
  const { LAYOUTS } = await import('../src/workbook.ts');
  const last: Record<string, number> = { NCP: 11, O: 4, Paris: 7 };
  return LAYOUTS.map((l) => ({ ...l, lastDataRow: last[l.sheet] }));
}
