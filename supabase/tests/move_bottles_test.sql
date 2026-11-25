-- Tests for move_bottles(): moving bottles between cellars. One transaction, rolled back.

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
select id, x.name, x.cur from public.accounts, (values ('LA home', 'USD'), ('Paris', 'EUR'), ('Oregon', 'USD')) x(name, cur);

create temp table t as
select (select id from public.cellars where name = 'LA home') as la,
       (select id from public.cellars where name = 'Paris') as paris,
       (select id from public.cellars where name = 'Oregon') as oregon;

-- Two lots in LA (6 at $250, 3 at $280) and one magnum.
select public.add_bottles((select la from t),
  '[{"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 6, "unit_price": 250, "merchant": "Ridge"},
    {"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 3, "unit_price": 280},
    {"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 1, "bottle_size_ml": 1500}]'::jsonb);
create temp table v as select id from public.vintages;
grant select on t, v to authenticated;

create function pg_temp.n(cellar uuid, size integer default 750) returns integer
language sql as $$
  select coalesce(sum(quantity), 0)::int from public.holdings
  where cellar_id = cellar and bottle_size_ml = size
$$;
grant execute on function pg_temp.n(uuid, integer) to authenticated;

-- Move 8: takes all 6 from the big lot and 2 from the other -------------------

create temp table m1 as
select public.move_bottles((select id from v), (select la from t), (select paris from t), 750, 8, 'Summer') as res;

select pg_temp.check(pg_temp.n((select la from t)) = 1, '1 standard bottle left in LA');
select pg_temp.check(pg_temp.n((select paris from t)) = 8, '8 standard bottles now in Paris');
select pg_temp.check(pg_temp.n((select la from t), 1500) = 1, 'magnum stays in LA');
select pg_temp.check(
  (select jsonb_array_length(res -> 'event_ids') from m1) = 4, 'two lots moved: 4 events');
select pg_temp.check(
  (select count(distinct transfer_id) from public.inventory_events where transfer_id is not null) = 1,
  'all events of the move share one transfer_id');
select pg_temp.check(
  (select count(*) from public.holdings where cellar_id = (select paris from t)) = 2,
  'Paris gets one lot per LA lot');
select pg_temp.check(
  (select unit_price = 250 and currency = 'USD' and merchant = 'Ridge' from public.holdings
   where cellar_id = (select paris from t) and quantity = 6),
  'moved lot keeps its price, currency and merchant');
select pg_temp.check(
  (select bool_and(note = 'Summer') from public.inventory_events where transfer_id is not null),
  'note is kept on the move');
select pg_temp.check(
  (select reason from public.inventory_events where event_type = 'transfer_out' limit 1) = 'Moved to Paris',
  'history says where the bottles went');

-- Move some back: reuses the same Paris -> LA lot -----------------------------

create temp table m2 as
select public.move_bottles((select id from v), (select paris from t), (select la from t), 750, 2) as res;
select pg_temp.check(pg_temp.n((select la from t)) = 3, 'moved 2 back to LA');
select pg_temp.check(
  (select count(*) from public.holdings where cellar_id = (select la from t)) = 3,
  'moving back reuses the original LA lots (no new lot)');

-- Undo both moves (latest first) ---------------------------------------------------

select public.undo_inventory_events(
  (select array(select jsonb_array_elements_text(res -> 'event_ids')::uuid) from m2));
select pg_temp.check(pg_temp.n((select paris from t)) = 8, 'undo of the move back returns 2 to Paris');

select public.undo_inventory_events(
  (select array(select jsonb_array_elements_text(res -> 'event_ids')::uuid) from m1));
select pg_temp.check(pg_temp.n((select paris from t)) = 0 and pg_temp.n((select la from t)) = 9,
  'undo of a move puts the bottles back');

-- Refusals ------------------------------------------------------------------------

select pg_temp.check_fails(
  format('select public.move_bottles(%L, %L, %L, 750, 50)', (select id from v), (select la from t), (select oregon from t)),
  'cannot move more than are there');
select pg_temp.check(pg_temp.n((select oregon from t)) = 0, 'a refused move changes nothing');
select pg_temp.check_fails(
  format('select public.move_bottles(%L, %L, %L, 750, 1)', (select id from v), (select la from t), (select la from t)),
  'cannot move to the same cellar');
select pg_temp.check_fails(
  format('select public.move_bottles(%L, %L, %L, 750, 0)', (select id from v), (select la from t), (select oregon from t)),
  'must move at least one');

-- Another user cannot see or move Dan's bottles.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check_fails(
  format('select public.move_bottles(%L, %L, %L, 750, 1)', (select id from v), (select la from t), (select oregon from t)),
  'another account cannot move these bottles');

select format('select public.move_bottles(%L, %L, %L, 750, 1)', (select id from v), (select la from t),
  (select oregon from t)) as anon_stmt \gset
reset role;
set local role anon;
select pg_temp.check_fails(:'anon_stmt',
  'signed-out visitors cannot move bottles');

rollback;
