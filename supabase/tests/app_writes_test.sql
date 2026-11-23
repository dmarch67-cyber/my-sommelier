-- Tests for the app's write functions (add_bottles, undo_inventory_events)
-- and the plain inserts the app makes for Drink one. One transaction, rolled back.

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

create function pg_temp.check_fails(stmt text, what text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok - % (rejected: %)', what, sqlerrm;
    return;
  end;
  raise exception 'FAILED: % (statement succeeded)', what;
end;
$$;
grant execute on function pg_temp.check(boolean, text) to authenticated;
grant execute on function pg_temp.check_fails(text, text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{"full_name": "Dan"}'),
  ('00000000-0000-0000-0000-00000000b0b0', 'tester@example.test', '{}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';

insert into public.cellars (account_id, name, currency)
select id, x.name, x.cur from public.accounts, (values ('LA home', 'USD'), ('Paris', 'EUR')) x(name, cur);

create temp table t as
select (select id from public.cellars where name = 'LA home') as la,
       (select id from public.cellars where name = 'Paris') as paris;

-- Add a new wine ----------------------------------------------------------

create temp table r1 as
select public.add_bottles(
  (select la from t),
  '[{"wine_name": "Ridge Monte Bello", "vintage": 2019, "country": "USA", "region": "California",
     "appellation": "Santa Cruz", "quantity": 6, "unit_price": 250, "score_raw": "97+",
     "score_low": 97, "score_plus": true}]'::jsonb
) as res;

select pg_temp.check((select (res ->> 'new_wines')::int from r1) = 1, 'add_bottles creates a new wine');
select pg_temp.check(
  (select quantity from public.cellar_inventory where wine_name = 'Ridge Monte Bello') = 6,
  '6 bottles are in LA');
select pg_temp.check(
  (select currency from public.holdings) = 'USD', 'price takes the cellar currency');
select pg_temp.check(
  (select raw_value from public.scores) = '97+', 'score from the line is stored');

-- Add the same wine again (matched by id), a magnum, on order -------------------

create temp table r2 as
select public.add_bottles(
  (select la from t),
  jsonb_build_array(jsonb_build_object(
    'wine_id', (select id from public.wines), 'vintage', 2019, 'quantity', 2, 'bottle_size_ml', 1500,
    'score_raw', '97+')),
  true
) as res;

select pg_temp.check((select count(*) from public.wines) = 1, 'matched wine is reused');
select pg_temp.check((select count(*) from public.vintages) = 1, 'matched vintage is reused');
select pg_temp.check((select count(*) from public.scores) = 1, 'same score is not stored twice');
select pg_temp.check(
  (select quantity_on_order from public.cellar_inventory where bottle_size_ml = 1500) = 2,
  'ordered magnums are on order, not in the cellar');

-- All or nothing -----------------------------------------------------------

select pg_temp.check_fails(
  $$select public.add_bottles((select la from t),
     '[{"wine_name": "Good line", "quantity": 1}, {"wine_name": "Bad line", "quantity": 0}]'::jsonb)$$,
  'a bad line rejects the whole delivery');
select pg_temp.check(
  (select count(*) from public.wines where name = 'Good line') = 0, 'no partial delivery is left');
select pg_temp.check_fails(
  $$select public.add_bottles((select la from t), '[]'::jsonb)$$, 'empty delivery is rejected');

-- Drink one, then undo ------------------------------------------------------

create temp table drink as
with e as (
  insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, occurred_at)
  select account_id, id, 'consumed', -1, now() from public.holdings where bottle_size_ml = 750
  returning id
) select id from e;

select pg_temp.check(
  (select quantity from public.holdings where bottle_size_ml = 750) = 5, 'drinking one leaves 5');

select pg_temp.check(
  public.undo_inventory_events(array(select id from drink)) = 1, 'undo reverses one event');
select pg_temp.check(
  (select quantity from public.holdings where bottle_size_ml = 750) = 6, 'undo puts the bottle back');
select pg_temp.check(
  public.undo_inventory_events(array(select id from drink)) = 0, 'undoing twice does nothing');
select pg_temp.check(
  (select quantity from public.holdings where bottle_size_ml = 750) = 6, 'still 6 after second undo');

-- Undo a whole delivery
select pg_temp.check(
  public.undo_inventory_events(
    array(select jsonb_array_elements_text(res -> 'event_ids')::uuid from r2)) = 1,
  'undo the magnum order');
select pg_temp.check(
  (select quantity_on_order from public.holdings where bottle_size_ml = 1500) = 0,
  'magnum order removed');

-- Mark an order delivered
select public.add_bottles((select la from t),
  jsonb_build_array(jsonb_build_object('wine_id', (select id from public.wines), 'vintage', 2021,
    'quantity', 3)), true);
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta, on_order_delta, occurred_at)
select h.account_id, h.id, 'delivered', 3, -3, now()
from public.holdings h join public.vintages v on v.id = h.vintage_id where v.year = 2021;
select pg_temp.check(
  (select quantity from public.cellar_inventory where vintage = 2021) = 3
  and (select quantity_on_order from public.cellar_inventory where vintage = 2021) = 0,
  'delivered moves bottles from on order into the cellar');

-- Matching new wines by name ---------------------------------------------------

select pg_temp.check(
  (select (public.add_bottles((select la from t),
     '[{"wine_name": "ridge monte bello", "vintage": 2019, "quantity": 1}]'::jsonb) ->> 'new_wines')::int) = 0
  and (select count(*) from public.wines) = 1,
  'a new-wine line with an existing name reuses that wine');

-- Two lines of the same new wine (two vintages) make one wine
select public.add_bottles((select paris from t),
  '[{"wine_name": "Krug Grande Cuvée", "vintage": null, "quantity": 2},
    {"wine_name": "krug grande cuvée ", "vintage": 2008, "quantity": 1}]'::jsonb);
select pg_temp.check(
  (select count(*) from public.wines where lower(name) like 'krug%') = 1
  and (select count(*) from public.vintages v join public.wines w on w.id = v.wine_id where w.name like 'Krug%') = 2,
  'same new wine on two lines becomes one wine with two vintages');

-- Another user can't add to Dan's cellar or undo his events -----------------

reset role;
create temp table dan_events as select id from public.inventory_events;
grant select on t, dan_events to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';

select pg_temp.check_fails(
  $$select public.add_bottles((select la from t), '[{"wine_name": "Sneaky", "quantity": 1}]'::jsonb)$$,
  'tester cannot add bottles to Dan''s cellar');
select pg_temp.check(
  public.undo_inventory_events(array(select id from dan_events)) = 0,
  'tester cannot undo Dan''s events');

rollback;
