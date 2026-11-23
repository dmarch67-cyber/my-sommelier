-- My Sommelier schema tests. Runs on Supabase (`supabase db` + psql) or on a
-- plain Postgres with tests/support/supabase-shim.sql loaded first.
-- Everything runs in one transaction and is rolled back.
--
-- Fake users:
--   Dan    00000000-0000-0000-0000-00000000da00
--   Tester 00000000-0000-0000-0000-00000000b0b0

\set ON_ERROR_STOP on
begin;

create function pg_temp.check(ok boolean, what text) returns void
language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAILED: %', what;
  end if;
  raise notice 'ok - %', what;
end;
$$;

-- Runs a statement that must fail with the given SQLSTATE.
create function pg_temp.check_fails(stmt text, sqlstate_expected text, what text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlstate = sqlstate_expected then
      raise notice 'ok - % (rejected: %)', what, sqlerrm;
      return;
    end if;
    raise exception 'FAILED: % (wrong error % %)', what, sqlstate, sqlerrm;
  end;
  raise exception 'FAILED: % (statement succeeded)', what;
end;
$$;
grant execute on function pg_temp.check(boolean, text) to authenticated, anon;
grant execute on function pg_temp.check_fails(text, text, text) to authenticated, anon;

-- Sign-up creates an account and owner membership -------------------------

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{"full_name": "Dan"}'),
  ('00000000-0000-0000-0000-00000000b0b0', 'tester@example.test', '{}');

select pg_temp.check(
  (select count(*) from public.account_members where role = 'owner') = 2,
  'each sign-up gets its own account as owner');

-- Dan builds his cellar ----------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';

select pg_temp.check((select count(*) from public.accounts) = 1, 'Dan sees exactly one account');
select pg_temp.check((select name from public.accounts) = 'Dan', 'account named from sign-up');

create temp table ids as
select (select id from public.accounts) as dan_account;
grant select on ids to authenticated, anon;

insert into public.cellars (account_id, name, location, country_code, currency, timezone)
select dan_account, x.name, x.loc, x.cc, x.cur, x.tz from ids,
  (values ('LA home', 'Los Angeles', 'US', 'USD', 'America/Los_Angeles'),
          ('Oregon',  'Oregon',      'US', 'USD', 'America/Los_Angeles'),
          ('Paris',   'Paris',       'FR', 'EUR', 'Europe/Paris')) as x(name, loc, cc, cur, tz);

select pg_temp.check((select count(*) from public.cellars) = 3, 'Dan has three cellars');

insert into public.wines (account_id, name, producer, cuvee, source_name, country, region, appellation, colour)
select dan_account, 'Truss Pinot Noir', 'Truss', 'Pinot Noir', 'TRUSS PINOT NOIR',
       'USA', 'Oregon', 'Willamette Valley', 'red' from ids;
insert into public.wines (account_id, name, producer, source_name, country, region, appellation, colour)
select dan_account, 'Aalto PS', 'Aalto', 'AALTO PS', 'Spain', 'Castilla y Leon', 'Ribera del Duero', 'red'
from ids;

insert into public.vintages (account_id, wine_id, year)
select w.account_id, w.id, 2024 from public.wines w where w.producer = 'Truss';
insert into public.vintages (account_id, wine_id, year)
select w.account_id, w.id, 2014 from public.wines w where w.producer = 'Aalto';

select pg_temp.check_fails(
  $$insert into public.vintages (account_id, wine_id, year)
    select account_id, wine_id, year from public.vintages where year = 2014$$,
  '23505', 'a vintage year appears once per wine');

-- Magnum in Paris, priced in euros (currency defaults from the cellar).
insert into public.holdings (account_id, cellar_id, vintage_id, bottle_size_ml, unit_price, import_ref)
select c.account_id, c.id, v.id, 1500, 70.00, '{"sheet": "Paris", "row": 56}'
from public.cellars c, public.vintages v
where c.name = 'Paris' and v.year = 2014;

select pg_temp.check(
  (select currency from public.holdings where bottle_size_ml = 1500) = 'EUR',
  'Paris holding price is in EUR by default');
select pg_temp.check(
  (select bottle_size_label from public.cellar_inventory where bottle_size_ml = 1500) = 'Magnum'
  and (select is_non_standard_size from public.cellar_inventory where bottle_size_ml = 1500),
  'magnum is flagged');

-- Standard bottles in LA, some still on order (the FUTURE column).
insert into public.holdings (account_id, cellar_id, vintage_id, unit_price)
select c.account_id, c.id, v.id, 55.00
from public.cellars c, public.vintages v
where c.name = 'LA home' and v.year = 2024;

select pg_temp.check(
  (select bottle_size_ml from public.holdings where vintage_id = (select id from public.vintages where year = 2024)) = 750,
  'bottle size defaults to 750 ml');

-- Spreadsheet import pattern for one line: QTY 8, GONE 2, FUTURE 4.
-- Opening balance = QTY - FUTURE in the cellar plus FUTURE on order; GONE
-- becomes a consumed event with no date.
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, on_order_delta, note)
select h.account_id, h.id, 'imported', 4, 4, 'Spreadsheet opening balance'
from public.holdings h where h.bottle_size_ml = 750;
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, note)
select h.account_id, h.id, 'consumed', -2, 'GONE in spreadsheet, date unknown'
from public.holdings h where h.bottle_size_ml = 750;

select pg_temp.check(
  (select (quantity, quantity_on_order) = (2, 4) from public.holdings where bottle_size_ml = 750),
  'counts come from the ledger: 2 in the cellar, 4 on order');

-- Delivery moves bottles from on order to in the cellar.
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, on_order_delta)
select h.account_id, h.id, 'delivered', 4, -4 from public.holdings h where h.bottle_size_ml = 750;
select pg_temp.check(
  (select (quantity, quantity_on_order) = (6, 0) from public.holdings where bottle_size_ml = 750),
  'delivery: 6 in the cellar, 0 on order');

select pg_temp.check_fails(
  $$update public.holdings set quantity = 99$$,
  '23514', 'counts cannot be overwritten directly');

select pg_temp.check_fails(
  $$insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta)
    select account_id, id, 'consumed', -7 from public.holdings where bottle_size_ml = 750$$,
  '23514', 'cannot drink more bottles than are in the cellar');

select pg_temp.check_fails(
  $$insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta)
    select account_id, id, 'consumed', 1 from public.holdings where bottle_size_ml = 750$$,
  '23514', 'a consumed event must reduce the count');

select pg_temp.check_fails(
  $$update public.inventory_events set quantity_delta = 10 where event_type = 'delivered'$$,
  '23514', 'ledger amounts cannot be edited');

select pg_temp.check_fails(
  $$delete from public.inventory_events where event_type = 'delivered'$$,
  '42501', 'ledger rows cannot be deleted');

update public.inventory_events set note = 'Arrived from Truss' where event_type = 'delivered';
select pg_temp.check(
  (select note from public.inventory_events where event_type = 'delivered') = 'Arrived from Truss',
  'ledger notes can be edited');

-- Move 2 bottles from LA to Oregon.
insert into public.holdings (account_id, cellar_id, vintage_id, unit_price)
select c.account_id, c.id, v.id, 55.00
from public.cellars c, public.vintages v
where c.name = 'Oregon' and v.year = 2024;

with t as (select gen_random_uuid() as tid)
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, transfer_id)
select h.account_id, h.id,
       case when c.name = 'LA home' then 'transfer_out' else 'transfer_in' end::public.inventory_event_type,
       case when c.name = 'LA home' then -2 else 2 end,
       t.tid
from public.holdings h join public.cellars c on c.id = h.cellar_id, t
where h.bottle_size_ml = 750;

select pg_temp.check(
  (select string_agg(cellar_name || '=' || quantity, ',' order by cellar_name)
     from public.cellar_inventory where vintage = 2024) = 'LA home=4,Oregon=2',
  'move between cellars: LA 4, Oregon 2');

-- Scores as entered.
insert into public.scores (account_id, vintage_id, source, raw_value, value_low, is_plus, entered_via)
select account_id, id, 'unknown', '94+', 94, true, 'spreadsheet_import' from public.vintages where year = 2014;
insert into public.scores (account_id, vintage_id, source, raw_value, value_low, value_high, is_barrel_sample)
select account_id, id, 'vinous', '92-94', 92, 94, true from public.vintages where year = 2024;

select pg_temp.check(
  (select raw_value from public.scores where is_plus) = '94+',
  '"94+" is kept as entered, with a plus flag');
select pg_temp.check_fails(
  $$insert into public.scores (account_id, vintage_id, raw_value, value_low, value_high)
    select account_id, id, '94-92', 94, 92 from public.vintages where year = 2024$$,
  '23514', 'score range must run low to high');

insert into public.accolades (account_id, vintage_id, raw_text, publication, title, rank, year)
select account_id, id, 'VINOUS #37 WOY 2025', 'Vinous', 'Wine of the Year', 37, 2025
from public.vintages where year = 2014;

-- Drink one in LA and write a note on it.
with e as (
  insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, occurred_at)
  select h.account_id, h.id, 'consumed', -1, now()
  from public.holdings h join public.cellars c on c.id = h.cellar_id
  where c.name = 'LA home' and h.bottle_size_ml = 750
  returning id, account_id
)
insert into public.tasting_notes (account_id, vintage_id, inventory_event_id, rating, maturity, notes, food_pairing)
select e.account_id, v.id, e.id, 93, 'approaching', 'Bright cherry, firm tannin.', 'Duck'
from e, public.vintages v where v.year = 2024;

select pg_temp.check(
  (select count(*) from public.tasting_notes where inventory_event_id is not null) = 1,
  'tasting note linked to the bottle drunk');

-- The second user cannot see or touch Dan's data ---------------------------

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';

select pg_temp.check((select count(*) from public.accounts) = 1, 'tester sees only their own account');
select pg_temp.check(
  (select id from public.accounts) <> (select dan_account from ids), 'tester''s account is not Dan''s');
select pg_temp.check(
  (select count(*) from public.account_members) = 1, 'tester sees only their own membership');
select pg_temp.check(
  (select count(*) from public.cellars) + (select count(*) from public.wines)
  + (select count(*) from public.vintages) + (select count(*) from public.holdings)
  + (select count(*) from public.inventory_events) + (select count(*) from public.scores)
  + (select count(*) from public.accolades) + (select count(*) from public.tasting_notes)
  + (select count(*) from public.cellar_inventory) = 0,
  'tester sees none of Dan''s cellars, wines, holdings, history, scores or notes');

select pg_temp.check_fails(
  $$insert into public.cellars (account_id, name) select dan_account, 'Sneaky' from ids$$,
  '42501', 'tester cannot add a cellar to Dan''s account');

with u as (update public.cellars set name = 'Hacked' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'tester cannot rename Dan''s cellars');

with d as (delete from public.wines returning 1)
select pg_temp.check((select count(*) from d) = 0, 'tester cannot delete Dan''s wines');

-- Tester makes their own cellar and tries to point a holding at Dan's vintage.
insert into public.cellars (account_id, name) select id, 'My cellar' from public.accounts;

reset role;
create temp table dan_ids as
select (select id from public.vintages where year = 2014) as dan_vintage,
       (select id from public.holdings where bottle_size_ml = 1500) as dan_holding;
grant select on dan_ids to authenticated;
set local role authenticated;

select pg_temp.check_fails(
  $$insert into public.holdings (account_id, cellar_id, vintage_id)
    select c.account_id, c.id, d.dan_vintage from public.cellars c, dan_ids d$$,
  '23503', 'tester cannot link their holding to Dan''s wine');

select pg_temp.check_fails(
  $$insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta)
    select a.id, d.dan_holding, 'consumed', -1 from public.accounts a, dan_ids d$$,
  '23503', 'tester cannot drink Dan''s bottles');

select pg_temp.check_fails(
  $$insert into public.accounts (name) values ('Second account')$$,
  '42501', 'users cannot create extra accounts from the app');

-- Signed-out visitors get nothing.
reset role;
set local role anon;
select pg_temp.check_fails($$select * from public.cellars$$, '42501', 'signed-out visitors cannot read cellars');
select pg_temp.check_fails($$select * from public.cellar_inventory$$, '42501', 'signed-out visitors cannot read inventory');

-- Back to Dan: nothing of his changed.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check(
  (select count(*) from public.cellars where name in ('LA home', 'Oregon', 'Paris')) = 3
  and (select sum(quantity) from public.holdings) = 5,
  'Dan''s data is unchanged after the tester''s attempts');

reset role;
rollback;
\echo 'All schema tests passed.'
