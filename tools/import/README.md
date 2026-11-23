# tools/import

The one-time spreadsheet importer, built by the Data Steward in Phase 1 (see `docs/data-model.md`, "Spreadsheet mapping"). After the import the app is the record; this tool is not a sync.

The workbook itself never goes in this repo. Point the importer at a local path. `.gitignore` blocks `.xlsx` and `.csv` files and the `import-output/` folder the reports go to.

Needs Node 22.18 or later (it runs the TypeScript directly).

## 1. Dry run (the default)

Reads the workbook, builds the full import plan and writes a reconciliation report. It does not connect to any database.

```sh
npm install
npm run import -w tools/import -- ~/path/to/My_Wine_Inventory.xlsx \
  --expect expected/checkpoint-b.json --out import-output
```

It prints one line per check and writes `import-output/dry-run.md` (for reading) and `dry-run.json` (the whole plan). Exit code 0 means every count matched the audit (`expected/checkpoint-b.json`) and the sheet's own total rows, and every line was mapped.

The report lists every change the importer makes (trimmed names, magnums taken out of names, folded region spellings, unknown prices, typed-over totals, wines matched across cellars), anything it could not map, and 20 lines to spot-check against the sheet.

## 2. Real import (only after the dry run is approved)

```sh
DATABASE_URL='postgresql://postgres:<password>@<host>:5432/postgres' \
npm run import -w tools/import -- ~/path/to/My_Wine_Inventory.xlsx \
  --expect expected/checkpoint-b.json --apply --owner-email <the account owner's sign-in email>
```

- Connect as a role that bypasses row-level security (on Supabase, the `postgres` connection string from the project's database settings). Rows go into the one account named by `--owner-email` or `--account-id`; the owner has to have signed up first.
- Refuses to run if any dry-run check fails, and refuses if that account already has imported holdings.
- Runs in one transaction: creates the three cellars (or reuses ones with the same names), wines, vintages and holdings at 0 bottles, then an `imported` event per line (`QTY − FUTURE` in the cellar, `FUTURE` on order) and a `consumed` event for `GONE` (no date). Scores go in with source `unknown`, accolades parsed.
- Then counts bottles from the database itself and rolls everything back if any cellar's lines, bottles in the cellar, bottles on order or magnums differ from the dry run.
- Add `--rollback` to do all of that and then roll back anyway: a rehearsal against the real database that leaves nothing behind.

## 2b. Real import without a database connection (SQL scripts)

Where only SQL can be run (for example through the Supabase connector), write the same plan as small scripts instead:

```sh
npm run import -w tools/import -- ~/path/to/My_Wine_Inventory.xlsx \
  --expect expected/checkpoint-b.json --sql import-output/sql --owner-email <owner's sign-in email>
```

This writes about 15 scripts of at most 20 KB each (`--chunk-bytes` changes the size). Run them in name order. `00-begin` checks the account and refuses one that already has imported holdings, then creates the cellars. The data scripts follow. `90-verify` counts from the database and raises if anything differs from the dry run. Each script commits on its own, so if one fails, run `undo.sql`, which removes that account's imported rows, and start again from `00-begin`. Row ids come from the account plus a row number, and `import_ref` keeps the sheet and row; the raw cells stay in the dry-run JSON.

## Tests

```sh
npm test -w tools/import          # parser, mapper and report, on a made-up workbook
npm run test:db -w tools/import   # also imports it into a throwaway Postgres with the migrations
```

`test:db` needs Postgres 15+ server binaries, like `npm run db:test`.

## Files

| File                         | What it does                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/workbook.ts`            | Sheet layouts (columns, data rows, cellar for each sheet) and reading cell values, including formula results |
| `src/normalise.ts`           | Cleanup rules: names, bottle size, region spellings, scores, accolades, prices                               |
| `src/plan.ts`                | Builds the import plan and the log of every change                                                           |
| `src/report.ts`              | Reconciliation checks and the Markdown/JSON report                                                           |
| `src/apply.ts`               | Writes a plan to Postgres in one transaction and verifies it                                                 |
| `src/cli.ts`                 | Command line                                                                                                 |
| `expected/checkpoint-b.json` | Counts the audit expects (no wine data)                                                                      |
