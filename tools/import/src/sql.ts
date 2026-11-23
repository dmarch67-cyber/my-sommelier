// Writes an import plan as a set of small SQL scripts. This is for running
// the import where no direct Postgres connection is possible (for example
// through the Supabase connector). Each script is one call and commits on
// its own, so:
//   - 00-begin checks the account and refuses an account that already has
//     imported holdings, then creates the cellars;
//   - the data scripts insert positional JSON (small) in dependency order;
//   - 90-verify counts from the database and raises if anything differs;
//   - undo.sql removes this account's imported rows if a run fails halfway.
// Every row is keyed by account_id.

import { countsByCellar, type ImportPlan } from './plan.ts';

export interface SqlOptions {
  accountId?: string;
  ownerEmail?: string;
  /** Target size of one script in bytes (default 20 KB). */
  maxBytes?: number;
}

export interface SqlScript {
  name: string;
  sql: string;
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

function accountExpr(opts: SqlOptions): string {
  if (opts.accountId) {
    if (!/^[0-9a-f-]{36}$/i.test(opts.accountId)) throw new Error('--account-id is not a UUID');
    return `${lit(opts.accountId)}::uuid`;
  }
  if (opts.ownerEmail) {
    return `(select m.account_id from public.account_members m join auth.users u on u.id = m.user_id
   where lower(u.email) = lower(${lit(opts.ownerEmail)}) and m.role = 'owner')`;
  }
  throw new Error('Pass --account-id or --owner-email');
}

function dollar(json: string): string {
  let tag = 'imp';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$`;
}

/** Splits rows into groups whose JSON stays under maxBytes. */
function chunk<T>(rows: T[], maxBytes: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let size = 2;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (cur.length && size + n > maxBytes) {
      out.push(cur);
      cur = [];
      size = 2;
    }
    cur.push(r);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export function planToSql(plan: ImportPlan, opts: SqlOptions): SqlScript[] {
  const acct = accountExpr(opts);
  // Rows refer to each other by small numbers; ids are derived in SQL as
  // md5(account:kind:n), which keeps the scripts about a third of the size.
  const uid = (kind: string, expr: string) =>
    `md5((${acct})::text || ':${kind}:' || (${expr}))::uuid`;
  const wineN = new Map(plan.wines.map((w, i) => [w.id, i + 1]));
  const vintageN = new Map(plan.vintages.map((v, i) => [v.id, i + 1]));
  const holdingN = new Map(plan.holdings.map((h, i) => [h.id, i + 1]));
  // Leave room for the SQL around the data.
  const max = (opts.maxBytes ?? 20_000) - 1_500;
  const scripts: SqlScript[] = [];
  let n = 1;
  const add = (label: string, sql: string) => {
    scripts.push({ name: `${String(n).padStart(2, '0')}-${label}.sql`, sql });
    n++;
  };

  const cellarValues = plan.cellars
    .map(
      (c) =>
        `(${[c.name, c.location, c.country_code, c.currency, c.timezone].map(lit).join(', ')}, ${c.sort_order})`,
    )
    .join(',\n    ');
  scripts.push({
    name: '00-begin.sql',
    sql: `-- Checks the account, then creates the cellars. Run first.
do $$
declare
  acct uuid := ${acct};
  prior int;
begin
  if acct is null then
    raise exception 'No account found for the owner; sign up first or pass --account-id';
  end if;
  select count(*) into prior from public.holdings where account_id = acct and import_ref is not null;
  if prior > 0 then
    raise exception 'Account % already has % imported holdings; refusing to import twice', acct, prior;
  end if;
end;
$$;

insert into public.cellars (account_id, name, location, country_code, currency, timezone, sort_order)
select ${acct}, v.* from (values
    ${cellarValues}
  ) as v(name, location, country_code, currency, timezone, sort_order)
on conflict (account_id, name) do nothing;
`,
  });

  // wines: [n, name, source_name, country, region, appellation]
  for (const rows of chunk(
    plan.wines.map((w) => [
      wineN.get(w.id),
      w.name,
      w.source_name,
      w.country,
      w.region,
      w.appellation,
    ]),
    max,
  )) {
    add(
      'wines',
      `insert into public.wines (id, account_id, name, source_name, country, region, appellation)
select ${uid('w', 'r->>0')}, ${acct}, r->>1, r->>2, r->>3, r->>4, r->>5
from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) r;
`,
    );
  }

  // vintages: [n, wine n, year]
  for (const rows of chunk(
    plan.vintages.map((v) => [vintageN.get(v.id), wineN.get(v.wine_id), v.year]),
    max,
  )) {
    add(
      'vintages',
      `insert into public.vintages (id, account_id, wine_id, year)
select ${uid('v', 'r->>0')}, ${acct}, ${uid('w', 'r->>1')}, (r->>2)::smallint
from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) r;
`,
    );
  }

  // holdings: [n, cellar name, vintage n, size_ml, price, notes, sheet, row, extras, marker]
  // import_ref keeps sheet and row (plus Paris row 56's extra cells); the
  // raw cells of every line stay in the dry-run JSON report.
  const cellarName = new Map(plan.cellars.map((c) => [c.key, c.name]));
  for (const rows of chunk(
    plan.holdings.map((h) => [
      holdingN.get(h.id),
      cellarName.get(h.cellar),
      vintageN.get(h.vintage_id),
      h.bottle_size_ml,
      h.unit_price,
      h.notes,
      h.import_ref.sheet,
      h.import_ref.row,
      h.import_ref.extras ?? null,
      h.import_ref.marker ?? null,
    ]),
    max,
  )) {
    add(
      'holdings',
      `insert into public.holdings (id, account_id, cellar_id, vintage_id, bottle_size_ml, unit_price, notes, import_ref)
select ${uid('h', 'r->>0')}, ${acct}, c.id, ${uid('v', 'r->>2')}, (r->>3)::int, (r->>4)::numeric, r->>5,
       jsonb_strip_nulls(jsonb_build_object('sheet', r->6, 'row', r->7, 'extras', r->8, 'marker', r->9))
from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) r
join public.cellars c on c.account_id = ${acct} and c.name = r->>1;
`,
    );
  }

  // events, rebuilt in SQL from [holding n, sheet, row, qty, gone, future]:
  // one 'imported' (QTY - FUTURE in the cellar, FUTURE on order), then one
  // 'consumed' for GONE. Rows are inserted in that order so each holding's
  // opening balance lands before its GONE.
  for (const rows of chunk(
    plan.holdings.map((h) => [
      holdingN.get(h.id),
      h.import_ref.sheet,
      h.import_ref.row,
      h.qty,
      h.gone,
      h.future,
    ]),
    max,
  )) {
    add(
      'events',
      `with d as (
  select r, ord from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) with ordinality as t(r, ord)
)
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, on_order_delta, reason, note)
select ${acct}, e.holding_id, e.event_type::public.inventory_event_type, e.qd, e.od, 'spreadsheet_import', e.note
from (
  select ${uid('h', 'r->>0')} holding_id, 'imported' event_type,
         (r->>3)::int - (r->>5)::int qd, (r->>5)::int od,
         'Opening balance from ' || (r->>1) || ' row ' || (r->>2) || ' (QTY ' || (r->>3)
           || case when (r->>5)::int > 0 then ', ' || (r->>5) || ' on order' else '' end || ')' note,
         0 step, ord
  from d where (r->>3)::int > 0
  union all
  select ${uid('h', 'r->>0')}, 'consumed', -(r->>4)::int, 0,
         'GONE column on ' || (r->>1) || ' row ' || (r->>2) || '; dates unknown',
         1, ord
  from d where (r->>4)::int > 0
  order by step, ord
) e;
`,
    );
  }

  // scores: [vintage n, raw, low, high, plus, barrel]
  for (const rows of chunk(
    plan.scores.map((s) => [
      vintageN.get(s.vintage_id),
      s.score.raw,
      s.score.low,
      s.score.high,
      s.score.plus,
      s.score.barrel,
    ]),
    max,
  )) {
    add(
      'scores',
      `insert into public.scores (account_id, vintage_id, source, raw_value, value_low, value_high, is_plus, is_barrel_sample, entered_via)
select ${acct}, ${uid('v', 'r->>0')}, 'unknown', r->>1, (r->>2)::numeric, (r->>3)::numeric, (r->>4)::boolean, (r->>5)::boolean, 'spreadsheet_import'
from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) r;
`,
    );
  }

  // accolades: [vintage n, raw, publication, title, rank, year]
  for (const rows of chunk(
    plan.accolades.map((a) => [
      vintageN.get(a.vintage_id),
      a.raw_text,
      a.publication,
      a.title,
      a.rank,
      a.year,
    ]),
    max,
  )) {
    add(
      'accolades',
      `insert into public.accolades (account_id, vintage_id, raw_text, publication, title, rank, year)
select ${acct}, ${uid('v', 'r->>0')}, r->>1, r->>2, r->>3, (r->>4)::int, (r->>5)::smallint
from jsonb_array_elements(${dollar(JSON.stringify(rows))}::jsonb) r;
`,
    );
  }

  // Verify: what the database now holds against the plan.
  const expected = countsByCellar(plan)
    .map((c) => `(${lit(c.cellar)}, ${c.lines}, ${c.inCellar}, ${c.onOrder}, ${c.magnums})`)
    .join(',\n    ');
  const totals = {
    wines: plan.wines.length,
    vintages: plan.vintages.length,
    inventory_events: plan.events.length,
    scores: plan.scores.length,
    accolades: plan.accolades.length,
  };
  scripts.push({
    name: '90-verify.sql',
    sql: `-- Counts from the database (set by the ledger trigger) against the plan.
-- Raises if anything differs; then run undo.sql and start again from 00-begin.
do $$
declare
  acct uuid := ${acct};
  bad text;
begin
  with want(cellar, lines, in_cellar, on_order, magnums) as (values
    ${expected}
  ), got as (
    select c.name cellar, count(h.id)::int lines,
           coalesce(sum(h.quantity), 0)::int in_cellar,
           coalesce(sum(h.quantity_on_order), 0)::int on_order,
           coalesce(sum(case when h.bottle_size_ml = 1500 then h.quantity + h.quantity_on_order end), 0)::int magnums
    from public.cellars c
    left join public.holdings h on h.cellar_id = c.id and h.import_ref is not null
    where c.account_id = acct
    group by c.name
  )
  select string_agg(format('%s: want %s/%s/%s/%s, got %s/%s/%s/%s', w.cellar, w.lines, w.in_cellar, w.on_order, w.magnums,
                           g.lines, g.in_cellar, g.on_order, g.magnums), '; ')
    into bad
  from want w left join got g using (cellar)
  where g.cellar is null or (w.lines, w.in_cellar, w.on_order, w.magnums) <> (g.lines, g.in_cellar, g.on_order, g.magnums);
  if bad is not null then
    raise exception 'Import counts differ (lines/in cellar/on order/magnums): %', bad;
  end if;
${Object.entries(totals)
  .map(
    ([t, want]) => `  if (select count(*) from public.${t} where account_id = acct) <> ${want} then
    raise exception '${t}: expected ${want}, found %', (select count(*) from public.${t} where account_id = acct);
  end if;`,
  )
  .join('\n')}
end;
$$;

select c.name as cellar, count(h.id) as lines, sum(h.quantity) as in_cellar,
       sum(h.quantity_on_order) as on_order,
       sum(case when h.bottle_size_ml = 1500 then h.quantity + h.quantity_on_order else 0 end) as magnums
from public.cellars c
left join public.holdings h on h.cellar_id = c.id and h.import_ref is not null
where c.account_id = ${acct}
group by c.name, c.sort_order
order by c.sort_order;
`,
  });

  scripts.push({
    name: 'undo.sql',
    sql: `-- Removes everything this import created for the account, so a failed run
-- can start again from 00-begin. Only for an account with no other data:
-- wines without a hand-entered holding, and the import's cellars once empty.
delete from public.holdings where account_id = ${acct} and import_ref is not null;
delete from public.wines w
 where w.account_id = ${acct}
   and not exists (select 1 from public.holdings h join public.vintages v on v.id = h.vintage_id
                    where v.wine_id = w.id and h.account_id = w.account_id);
delete from public.cellars c
 where c.account_id = ${acct}
   and c.name in (${plan.cellars.map((c) => lit(c.name)).join(', ')})
   and not exists (select 1 from public.holdings h where h.cellar_id = c.id);
select (select count(*) from public.holdings where account_id = ${acct}) as holdings_left,
       (select count(*) from public.wines where account_id = ${acct}) as wines_left,
       (select count(*) from public.cellars where account_id = ${acct}) as cellars_left;
`,
  });
  return scripts;
}
