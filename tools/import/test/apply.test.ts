// End to end: import the fixture workbook into a real Postgres with the
// migrations applied. Skipped without DATABASE_URL; run it with
//   npm run test:db -w tools/import
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readWorkbook } from '../src/workbook.ts';
import { buildPlan, countsByCellar } from '../src/plan.ts';
import { applyPlan } from '../src/apply.ts';
import { buildFixture, fixtureLayouts } from './fixture.ts';

const url = process.env.DATABASE_URL;
const skip = url ? false : 'DATABASE_URL not set';

async function freshPlan() {
  return buildPlan(await readWorkbook(await buildFixture(), await fixtureLayouts()));
}

async function withClient<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function signUp(email: string) {
  return withClient(async (c) => {
    await c.query('insert into auth.users (email) values ($1)', [email]);
    const r = await c.query(
      'select m.account_id from public.account_members m join auth.users u on u.id = m.user_id where u.email = $1',
      [email],
    );
    return r.rows[0].account_id as string;
  });
}

const count = (accountId: string, table: string) =>
  withClient(
    async (c) =>
      (
        await c.query(`select count(*)::int n from public.${table} where account_id = $1`, [
          accountId,
        ])
      ).rows[0].n as number,
  );

test('imports the fixture and the database counts match the plan', { skip }, async () => {
  const accountId = await signUp('dan@example.test');
  const plan = await freshPlan();
  const result = await applyPlan(plan, { databaseUrl: url!, ownerEmail: 'dan@example.test' });
  assert.equal(result.committed, true);
  assert.equal(result.accountId, accountId);

  for (const want of countsByCellar(plan)) {
    const got = result.dbCounts.find((d) => d.cellar === want.cellar)!;
    assert.deepEqual(
      [got.lines, got.inCellar, got.onOrder, got.magnums],
      [want.lines, want.inCellar, want.onOrder, want.magnums],
      want.cellar,
    );
  }
  assert.equal(await count(accountId, 'wines'), plan.wines.length);
  assert.equal(await count(accountId, 'inventory_events'), plan.events.length);
  assert.equal(await count(accountId, 'scores'), plan.scores.length);
  assert.equal(await count(accountId, 'accolades'), plan.accolades.length);

  await withClient(async (c) => {
    // Currency by cellar, flagged magnums, on-order bottles, unknown price.
    const truss = await c.query(
      `select * from public.cellar_inventory where account_id = $1 and wine_name = 'Truss Sketch 01'`,
      [accountId],
    );
    assert.deepEqual(
      [truss.rows[0].quantity, truss.rows[0].quantity_on_order, truss.rows[0].currency],
      [0, 4, 'USD'],
    );
    const paris = await c.query(
      `select bottle_size_label, is_non_standard_size, unit_price, currency from public.cellar_inventory
        where account_id = $1 and cellar_name = 'Paris' and wine_name = 'Barde-Haut'`,
      [accountId],
    );
    assert.deepEqual(paris.rows[0], {
      bottle_size_label: 'Magnum',
      is_non_standard_size: true,
      unit_price: '41.28',
      currency: 'EUR',
    });
    const score = await c.query(
      `select source, entered_via, value_low, value_high, is_barrel_sample from public.scores where account_id = $1 and raw_value = '92-94'`,
      [accountId],
    );
    assert.deepEqual(score.rows[0], {
      source: 'unknown',
      entered_via: 'spreadsheet_import',
      value_low: '92.00',
      value_high: '94.00',
      is_barrel_sample: true,
    });
  });
});

test('refuses to import into the same account twice', { skip }, async () => {
  const plan = await freshPlan();
  await assert.rejects(
    applyPlan(plan, { databaseUrl: url!, ownerEmail: 'dan@example.test' }),
    /refusing to import twice/,
  );
});

test('--rollback verifies and keeps nothing', { skip }, async () => {
  const accountId = await signUp('rehearsal@example.test');
  const result = await applyPlan(await freshPlan(), {
    databaseUrl: url!,
    accountId,
    rollback: true,
  });
  assert.equal(result.committed, false);
  assert.equal(
    result.dbCounts.reduce((a, d) => a + d.inCellar, 0),
    40,
  );
  assert.equal(await count(accountId, 'holdings'), 0);
  assert.equal(await count(accountId, 'cellars'), 0);
});

test('rolls back when the database disagrees with the plan', { skip }, async () => {
  const accountId = await signUp('mismatch@example.test');
  const plan = await freshPlan();
  plan.holdings[0].in_cellar += 1; // the plan now claims a bottle the ledger will not produce
  await assert.rejects(applyPlan(plan, { databaseUrl: url!, accountId }), /differ from the plan/);
  assert.equal(await count(accountId, 'holdings'), 0);
});

test('an unknown owner is an error, not a new account', { skip }, async () => {
  await assert.rejects(
    applyPlan(await freshPlan(), { databaseUrl: url!, ownerEmail: 'nobody@example.test' }),
    /found 0/,
  );
});

test('the SQL scripts import the fixture, verify, and undo cleanly', { skip }, async () => {
  const { planToSql } = await import('../src/sql.ts');
  const accountId = await signUp('sql@example.test');
  const plan = await freshPlan();
  const scripts = planToSql(plan, { ownerEmail: 'sql@example.test', maxBytes: 1_700 });
  assert.ok(
    scripts.filter((s) => s.name.includes('events')).length > 1,
    'events split into chunks',
  );
  for (const s of scripts) assert.ok(Buffer.byteLength(s.sql) < 6_000, `${s.name} is small`);
  const run = (name: string) =>
    withClient((c) => c.query(scripts.find((s) => s.name === name)!.sql));
  for (const s of scripts.filter((s) => s.name !== 'undo.sql')) await run(s.name);

  const want = countsByCellar(plan);
  const got = await withClient((c) =>
    c.query(
      `select c.name, sum(h.quantity)::int q, sum(h.quantity_on_order)::int o from public.cellars c
         join public.holdings h on h.cellar_id = c.id where c.account_id = $1 group by c.name`,
      [accountId],
    ),
  );
  for (const w of want) {
    const g = got.rows.find((r) => r.name === w.cellar);
    assert.deepEqual([g.q, g.o], [w.inCellar, w.onOrder], w.cellar);
  }
  assert.equal(await count(accountId, 'inventory_events'), plan.events.length);
  // Notes rebuilt in SQL match the plan's wording.
  const notes = await withClient((c) =>
    c.query('select note from public.inventory_events where account_id = $1', [accountId]),
  );
  assert.deepEqual(notes.rows.map((r) => r.note).sort(), plan.events.map((e) => e.note).sort());

  // A second begin refuses; undo leaves nothing.
  await assert.rejects(run('00-begin.sql'), /refusing to import twice/);
  await run('undo.sql');
  for (const t of ['holdings', 'wines', 'vintages', 'scores', 'cellars', 'inventory_events'])
    assert.equal(await count(accountId, t), 0, t);
  // And verify now fails loudly.
  await assert.rejects(run('90-verify.sql'), /differ/);
});
