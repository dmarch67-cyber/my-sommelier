-- Tests for apply_cellartracker (stage 2). One transaction, rolled back.

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
  '[{"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 6, "score_raw": "97", "score_low": 97},
    {"wine_name": "Ridge Monte Bello", "vintage": 2013, "quantity": 2}]'::jsonb);

create temp table ids as
select (select id from public.vintages where year = 2019) as r19,
       (select id from public.vintages where year = 2013) as r13;

-- Claude guessed first; the owner set the 2013 window by hand.
select public.apply_wine_enrichment(jsonb_build_array(jsonb_build_object(
  'wine_id', (select id from public.wines limit 1), 'colour', 'white', 'grapes', jsonb_build_array('Merlot'),
  'vintages', jsonb_build_array(jsonb_build_object('vintage_id', (select r19 from ids), 'drink_from', 2030, 'drink_to', 2050))))) ;
update public.vintages set drink_from = 2024, drink_to = 2044, drink_window_source = 'owner'
where id = (select r13 from ids);

create temp table m as select jsonb_build_array(
  jsonb_build_object('vintage_id', r19, 'ct_id', '4012345', 'colour', 'red',
    'grapes', jsonb_build_array('Cabernet Sauvignon'), 'drink_from', 2029, 'drink_to', 2060,
    'scores', jsonb_build_array(
      jsonb_build_object('source', 'vinous', 'source_detail', 'Vinous (Antonio Galloni)', 'raw_value', '98', 'value_low', 98, 'value_high', null, 'is_plus', false),
      jsonb_build_object('source', 'cellartracker', 'source_detail', 'CellarTracker community', 'raw_value', '95.4', 'value_low', 95.4, 'value_high', null, 'is_plus', false),
      jsonb_build_object('source', 'made_up', 'source_detail', 'Somebody', 'raw_value', '90', 'value_low', 90, 'value_high', null, 'is_plus', false),
      jsonb_build_object('source', 'wine_advocate', 'raw_value', '94-96', 'value_low', 96, 'value_high', 94, 'is_plus', false))),
  jsonb_build_object('vintage_id', r13, 'drink_from', 2020, 'drink_to', 2040, 'scores', '[]'::jsonb)
) as j from ids;

create temp table res as select public.apply_cellartracker((select j from m)) as r;
select pg_temp.check((select (r ->> 'matched')::int from res) = 2, 'two vintages matched');
select pg_temp.check((select (r ->> 'windows')::int from res) = 1, 'one window written');
select pg_temp.check((select (r ->> 'scores')::int from res) = 3, 'three good scores saved, the backwards range skipped');
select pg_temp.check(
  (select drink_from = 2029 and drink_to = 2060 and drink_window_source = 'cellartracker' and cellartracker_id = '4012345'
   from public.vintages where id = (select r19 from ids)),
  'CellarTracker window replaces the estimate');
select pg_temp.check(
  (select drink_from = 2024 and drink_window_source = 'owner' from public.vintages where id = (select r13 from ids)),
  'owner window kept');
select pg_temp.check(
  (select ct_drink_from = 2020 and ct_drink_to = 2040 from public.vintages where id = (select r13 from ids)),
  'CellarTracker''s own window is kept beside the owner''s');
select pg_temp.check(
  (select colour = 'red' and grapes = '{Cabernet Sauvignon}' from public.wines limit 1),
  'CellarTracker colour and grapes replace Claude guesses');
select pg_temp.check(
  (select count(*) from public.scores where vintage_id = (select r19 from ids) and source = 'other'
     and source_detail = 'CellarTracker export: Somebody') = 1,
  'unknown score source is kept as other');
select pg_temp.check(
  (select count(*) from public.scores where vintage_id = (select r19 from ids) and entered_via <> 'enrichment') = 1,
  'the spreadsheet score is untouched');

-- A second sync replaces its own scores rather than piling them up.
select public.apply_cellartracker((select j from m));
select pg_temp.check(
  (select count(*) from public.scores where vintage_id = (select r19 from ids)) = 4,
  'a second sync does not duplicate scores');

-- The owner's colour is not overwritten.
update public.wines set colour = 'red', enriched_by = 'owner';
select public.apply_cellartracker(jsonb_build_array(jsonb_build_object('vintage_id', (select r19 from ids), 'colour', 'white')));
select pg_temp.check((select colour = 'red' from public.wines limit 1), 'owner colour kept');

-- Run log
insert into public.enrichment_runs (account_id, source, ok, summary)
select id, 'cellartracker', true, '{"matched": 2}' from public.accounts;
select pg_temp.check((select count(*) from public.enrichment_runs) = 1, 'owner can log a run');

-- Another user sees nothing and changes nothing.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check((select count(*) from public.enrichment_runs) = 0, 'other users cannot see the run log');
create temp table res2 as select public.apply_cellartracker((select j from m)) as r;
select pg_temp.check((select (r ->> 'matched')::int from res2) = 0, 'other users match nothing');

rollback;
