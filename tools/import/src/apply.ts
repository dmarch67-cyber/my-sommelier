// Writes an import plan into the database in one transaction, then counts
// what the database now holds and rolls everything back if it differs from
// the plan. Connect as a role that bypasses row-level security (the Supabase
// service role or the postgres user); rows are scoped to one account_id.

import pg from 'pg';
import { countsByCellar, type ImportPlan } from './plan.ts';

export interface ApplyOptions {
  databaseUrl: string;
  accountId?: string;
  ownerEmail?: string;
  /** Do everything, verify, then roll back (a rehearsal against the real database). */
  rollback?: boolean;
  log?: (msg: string) => void;
}

export interface DbCounts {
  cellar: string;
  lines: number;
  inCellar: number;
  onOrder: number;
  magnums: number;
}

export interface ApplyResult {
  accountId: string;
  committed: boolean;
  dbCounts: DbCounts[];
  inserted: Record<string, number>;
}

async function insertRows(
  client: pg.PoolClient | pg.Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
) {
  if (!rows.length) return 0;
  // jsonb_populate_recordset types every column from the table itself.
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const sql = `insert into public.${table} (${cols})
    select ${cols} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`;
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await client.query(sql, [JSON.stringify(rows.slice(i, i + chunk))]);
  }
  return rows.length;
}

export async function resolveAccount(client: pg.Client, opts: ApplyOptions): Promise<string> {
  if (opts.accountId) {
    const r = await client.query('select id from public.accounts where id = $1', [opts.accountId]);
    if (!r.rowCount) throw new Error(`No account with id ${opts.accountId}`);
    return opts.accountId;
  }
  if (opts.ownerEmail) {
    const r = await client.query(
      `select m.account_id from public.account_members m
         join auth.users u on u.id = m.user_id
        where lower(u.email) = lower($1) and m.role = 'owner'`,
      [opts.ownerEmail],
    );
    if (r.rowCount !== 1)
      throw new Error(
        `Expected one account owned by ${opts.ownerEmail}, found ${r.rowCount}. Sign up in the app first, or pass --account-id.`,
      );
    return r.rows[0].account_id;
  }
  throw new Error('Pass --account-id or --owner-email');
}

export async function applyPlan(plan: ImportPlan, opts: ApplyOptions): Promise<ApplyResult> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client({ connectionString: opts.databaseUrl });
  await client.connect();
  try {
    await client.query('begin');
    const accountId = await resolveAccount(client, opts);

    // One import per account: refuse if a previous import left holdings.
    const prior = await client.query(
      'select count(*)::int as n from public.holdings where account_id = $1 and import_ref is not null',
      [accountId],
    );
    if (prior.rows[0].n > 0) {
      throw new Error(
        `Account ${accountId} already has ${prior.rows[0].n} imported holdings; refusing to import twice.`,
      );
    }

    // Cellars: reuse one with the same name, otherwise create it.
    const cellarIds = new Map<string, string>();
    for (const c of plan.cellars) {
      const found = await client.query(
        'select id from public.cellars where account_id = $1 and name = $2',
        [accountId, c.name],
      );
      if (found.rowCount) {
        cellarIds.set(c.key, found.rows[0].id);
        log(`cellar ${c.name}: using existing`);
      } else {
        const ins = await client.query(
          `insert into public.cellars (account_id, name, location, country_code, currency, timezone, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [accountId, c.name, c.location, c.country_code, c.currency, c.timezone, c.sort_order],
        );
        cellarIds.set(c.key, ins.rows[0].id);
        log(`cellar ${c.name}: created`);
      }
    }

    const inserted: Record<string, number> = {};
    inserted.wines = await insertRows(
      client,
      'wines',
      ['id', 'account_id', 'name', 'source_name', 'country', 'region', 'appellation'],
      plan.wines.map((w) => ({
        id: w.id,
        account_id: accountId,
        name: w.name,
        source_name: w.source_name,
        country: w.country,
        region: w.region,
        appellation: w.appellation,
      })),
    );
    inserted.vintages = await insertRows(
      client,
      'vintages',
      ['id', 'account_id', 'wine_id', 'year'],
      plan.vintages.map((v) => ({
        id: v.id,
        account_id: accountId,
        wine_id: v.wine_id,
        year: v.year,
      })),
    );
    inserted.holdings = await insertRows(
      client,
      'holdings',
      [
        'id',
        'account_id',
        'cellar_id',
        'vintage_id',
        'bottle_size_ml',
        'unit_price',
        'currency',
        'notes',
        'import_ref',
      ],
      plan.holdings.map((h) => ({
        id: h.id,
        account_id: accountId,
        cellar_id: cellarIds.get(h.cellar),
        vintage_id: h.vintage_id,
        bottle_size_ml: h.bottle_size_ml,
        unit_price: h.unit_price,
        currency: h.currency,
        notes: h.notes,
        import_ref: h.import_ref,
      })),
    );
    // Events go in order: each holding's opening balance before its GONE.
    inserted.inventory_events = await insertRows(
      client,
      'inventory_events',
      [
        'account_id',
        'holding_id',
        'event_type',
        'quantity_delta',
        'on_order_delta',
        'occurred_at',
        'reason',
        'note',
      ],
      plan.events.map((e) => ({
        account_id: accountId,
        holding_id: e.holding_id,
        event_type: e.event_type,
        quantity_delta: e.quantity_delta,
        on_order_delta: e.on_order_delta,
        occurred_at: null,
        reason: 'spreadsheet_import',
        note: e.note,
      })),
    );
    inserted.scores = await insertRows(
      client,
      'scores',
      [
        'account_id',
        'vintage_id',
        'source',
        'raw_value',
        'value_low',
        'value_high',
        'is_plus',
        'is_barrel_sample',
        'entered_via',
      ],
      plan.scores.map((s) => ({
        account_id: accountId,
        vintage_id: s.vintage_id,
        source: 'unknown',
        raw_value: s.score.raw,
        value_low: s.score.low,
        value_high: s.score.high,
        is_plus: s.score.plus,
        is_barrel_sample: s.score.barrel,
        entered_via: 'spreadsheet_import',
      })),
    );
    inserted.accolades = await insertRows(
      client,
      'accolades',
      ['account_id', 'vintage_id', 'raw_text', 'publication', 'title', 'rank', 'year'],
      plan.accolades.map((a) => ({ account_id: accountId, ...a })),
    );
    log(`inserted ${JSON.stringify(inserted)}`);

    // Count from the database (counts were set by the ledger trigger).
    const res = await client.query(
      `select c.name as cellar,
              count(h.id)::int as lines,
              coalesce(sum(h.quantity), 0)::int as "inCellar",
              coalesce(sum(h.quantity_on_order), 0)::int as "onOrder",
              coalesce(sum(case when h.bottle_size_ml = 1500 then h.quantity + h.quantity_on_order end), 0)::int as magnums
         from public.cellars c
         left join public.holdings h on h.cellar_id = c.id and h.import_ref is not null
        where c.account_id = $1
        group by c.name`,
      [accountId],
    );
    const dbCounts: DbCounts[] = res.rows;
    const mismatches: string[] = [];
    for (const want of countsByCellar(plan)) {
      const got = dbCounts.find((d) => d.cellar === want.cellar);
      for (const k of ['lines', 'inCellar', 'onOrder', 'magnums'] as const) {
        if (!got || got[k] !== want[k])
          mismatches.push(`${want.cellar} ${k}: plan ${want[k]}, database ${got?.[k]}`);
      }
    }
    if (mismatches.length)
      throw new Error(
        `Database counts differ from the plan, rolled back:\n${mismatches.join('\n')}`,
      );

    if (opts.rollback) {
      await client.query('rollback');
      log('verified, then rolled back (--rollback)');
      return { accountId, committed: false, dbCounts, inserted };
    }
    await client.query('commit');
    return { accountId, committed: true, dbCounts, inserted };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}
