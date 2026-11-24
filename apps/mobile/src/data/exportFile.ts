import { Platform } from 'react-native';

import { writeXlsx } from '../lib/xlsx';
import { buildExport, type ExportInput } from '../logic/export';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Local date as YYYY-MM-DD (not UTC, so an evening export is dated today). */
export function localToday(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Builds the Excel file and hands it to the browser as a download. Phones
 * get save/share when the Android app is built; until then this says so.
 */
export function downloadExport(input: Omit<ExportInput, 'today'>): {
  fileName: string;
  bottles: number;
} {
  if (Platform.OS !== 'web') {
    throw new Error(
      'Export to Excel works in the web app for now. Open mysommelier.net on a computer.',
    );
  }
  const result = buildExport({ ...input, today: localToday() });
  const bytes = writeXlsx(result.sheets);
  const blob = new Blob([bytes as BlobPart], { type: XLSX_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { fileName: result.fileName, bottles: result.bottles };
}
