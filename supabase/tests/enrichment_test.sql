-- Tests for apply_wine_enrichment (stage 1 fill-in). One transaction, rolled back.

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
grant execute on function pg_temp.check(boolean, text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{}'),
  ('00000000-0000-0000-0000-00000000b0b0', 'other@example.test', '{}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';

insert into public.cellars (account_id, name, currency)
select id, 'LA home', 'USD' from public.accounts;

select public.add_bottles(
  (select id from public.cellars limit 1),
  '[{"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 6},
    {"wine_name": "Ridge Monte Bello", "vintage": 2013, "quantity": 2},
    {"wine_name": "Bergstrom Sigrid Chardonnay", "vintage": 2021, "quantity": 3}]'::jsonb);

-- The owner already knows the Chardonnay is white and set a window for Ridge 2013.
update public.wines set colour = 'white' where name = 'Bergstrom Sigrid Chardonnay';
update public.vintages set drink_from = 2025, drink_to = 2045, drink_window_source = 'owner'
where year = 2013;

create temp table ids as
select (select id from public.wines where name = 'Ridge Monte Bello') as ridge,
       (select id from public.wines where name = 'Bergstrom Sigrid Chardonnay') as sigrid,
       (select id from public.vintages where year = 2019) as r19,
       (select id from public.vintages where year = 2013) as r13,
       (select id from public.vintages where year = 2021) as s21;

select pg_temp.check((select count(*) from public.wines where enriched_at is null) = 2,
  'new wines start not enriched');

create temp table res as
select public.apply_wine_enrichment(jsonb_build_array(
  jsonb_build_object('wine_id', ridge, 'colour', 'red', 'body', 'full', 'producer', 'Ridge',
    'grapes', jsonb_build_array('Cabernet Sauvignon', 'Merlot'),
    'vintages', jsonb_build_array(
      jsonb_build_object('vintage_id', r19, 'drink_from', 2029, 'drink_to', 2055),
      jsonb_build_object('vintage_id', r13, 'drink_from', 2023, 'drink_to', 2050))),
  jsonb_build_object('wine_id', sigrid, 'colour', 'red', 'body', 'purple', 'producer', '',
    'grapes', jsonb_build_array('Chardonnay'),
    'vintages', jsonb_build_array(
      jsonb_build_object('vintage_id', s21, 'drink_from', 2030, 'drink_to', 2024)))
)) as r from ids;

select pg_temp.check((select (r ->> 'wines')::int from res) = 2, 'two wines updated');
select pg_temp.check((select (r ->> 'windows')::int from res) = 1, 'only one window written');
select pg_temp.check(
  (select colour = 'red' and body = 'full' and producer = 'Ridge'
          and grapes = '{Cabernet Sauvignon,Merlot}' and enriched_at is not null
   from public.wines where id = (select ridge from ids)),
  'blanks are filled on Ridge');
select pg_temp.check(
  (select colour = 'white' and body is null and producer is null and grapes = '{Chardonnay}'
   from public.wines where id = (select sigrid from ids)),
  'owner colour kept, unknown body ignored, empty producer ignored');
select pg_temp.check(
  (select drink_from = 2029 and drink_to = 2055 and drink_window_source = 'estimate'
   from public.vintages where id = (select r19 from ids)),
  'blank window filled and marked estimate');
select pg_temp.check(
  (select drink_from = 2025 and drink_window_source = 'owner'
   from public.vintages where id = (select r13 from ids)),
  'owner window is never overwritten');
select pg_temp.check(
  (select drink_from is null from public.vintages where id = (select s21 from ids)),
  'backwards window is ignored');
select pg_temp.check(
  (select body = 'full' and grapes[1] = 'Cabernet Sauvignon' and drink_window_source = 'estimate'
   from public.cellar_inventory where vintage = 2019),
  'cellar view shows body, grapes and window source');

-- An estimate can be refreshed by a later run.
select public.apply_wine_enrichment(jsonb_build_array(jsonb_build_object('wine_id',
  (select ridge from ids), 'vintages', jsonb_build_array(
    jsonb_build_object('vintage_id', (select r19 from ids), 'drink_from', 2030, 'drink_to', 2056)))));
select pg_temp.check(
  (select drink_from = 2030 from public.vintages where id = (select r19 from ids)),
  'an earlier estimate can be replaced');

-- Another user cannot touch Dan's wines.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
create temp table res2 as
select public.apply_wine_enrichment(jsonb_build_array(jsonb_build_object(
  'wine_id', (select ridge from ids), 'body', 'light'))) as r;
select pg_temp.check((select (r ->> 'wines')::int from res2) = 0, 'other users change nothing');

reset role;
select pg_temp.check(
  (select body = 'full' from public.wines where name = 'Ridge Monte Bello'),
  'Dan''s wine unchanged by the other user');

rollback;
