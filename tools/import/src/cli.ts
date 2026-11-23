#!/usr/bin/env node
// sommelier-import: one-time import of the cellar spreadsheet.
//
//   Dry run (default; reads the workbook only, connects to nothing):
//     node src/cli.ts <workbook.xlsx> [--out <dir>] [--expect expected/checkpoint-b.json]
//
//   Real import (after the dry run is approved):
//     DATABASE_URL=postgres://... node src/cli.ts <workbook.xlsx> --apply \
//       (--owner-email <email> | --account-id <uuid>) [--rollback]
//
// Exit code 0 when every count matches, 1 when something differs or fails.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyPlan } from './apply.ts';
import { buildPlan } from './plan.ts';
import {
  reconcile,
  renderJson,
  renderMarkdown,
  type Expectations,
  type ReportMeta,
} from './report.ts';
import { readWorkbook } from './workbook.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', default: 'import-output' },
    expect: { type: 'string' },
    apply: { type: 'boolean', default: false },
    rollback: { type: 'boolean', default: false },
    'database-url': { type: 'string' },
    'account-id': { type: 'string' },
    'owner-email': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || positionals.length !== 1) {
  console.log(`Usage: sommelier-import <workbook.xlsx> [--out dir] [--expect file.json]
       sommelier-import <workbook.xlsx> --apply (--owner-email e | --account-id id) [--rollback]
Dry run is the default and writes only the report files. --apply needs DATABASE_URL.`);
  process.exit(values.help ? 0 : 2);
}

const workbookPath = resolve(positionals[0]);
const bytes = await readFile(workbookPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sheets = await readWorkbook(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
);
const plan = buildPlan(sheets);
const expect: Expectations | undefined = values.expect
  ? JSON.parse(await readFile(values.expect, 'utf8'))
  : undefined;
const checks = reconcile(plan, expect);
const countsOk = checks.every((c) => c.ok) && plan.problems.length === 0;

const mode: ReportMeta['mode'] = !values.apply
  ? 'dry-run'
  : values.rollback
    ? 'rehearsal'
    : 'apply';
const meta: ReportMeta = {
  workbook: basename(workbookPath),
  sha256,
  generatedAt: new Date().toISOString(),
  mode,
};
const outDir = resolve(values.out!);
await mkdir(outDir, { recursive: true });
const stem = mode === 'dry-run' ? 'dry-run' : mode;
await writeFile(join(outDir, `${stem}.md`), renderMarkdown(plan, meta, checks));
await writeFile(join(outDir, `${stem}.json`), renderJson(plan, meta, checks));

for (const c of checks)
  console.log(
    `${c.ok ? 'ok  ' : 'DIFF'} ${c.check}: ${c.plan}${c.expected !== null ? ` (expected ${c.expected})` : ''}${c.sheetSays !== null ? ` (sheet ${c.sheetSays})` : ''}`,
  );
if (plan.problems.length)
  console.log(`${plan.problems.length} line(s) could not be mapped; see the report.`);
console.log(`Report: ${join(outDir, `${stem}.md`)}`);

if (!values.apply) process.exit(countsOk ? 0 : 1);

if (!countsOk) {
  console.error('Refusing to write: the dry-run checks above do not all pass.');
  process.exit(1);
}
const databaseUrl = values['database-url'] ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL (or --database-url) to the database connection string.');
  process.exit(2);
}
try {
  const result = await applyPlan(plan, {
    databaseUrl,
    accountId: values['account-id'],
    ownerEmail: values['owner-email'],
    rollback: values.rollback,
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(result.dbCounts));
  console.log(
    result.committed
      ? `Imported into account ${result.accountId}.`
      : 'Rehearsal verified and rolled back; nothing kept.',
  );
  await writeFile(join(outDir, `${stem}-result.json`), JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
