-- Tests for apply_ct_places. One transaction, rolled back.

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
  '[{"wine_name": "Vine Hill Ranch", "vintage": 2019, "quantity": 2, "country": "USA", "region": "California", "appellation": "Napa Valley"},
    {"wine_name": "Montrose", "vintage": 2016, "quantity": 2, "country": "France", "region": "Bordeaux", "appellation": "St Estephe"},
    {"wine_name": "Wrong Match", "vintage": 2018, "quantity": 1, "country": "Italy", "region": "Tuscany"}]'::jsonb);

create temp table res as select public.apply_ct_places(jsonb_build_array(
  jsonb_build_object('vintage_id', (select v.id from public.vintages v join public.wines w on w.id = v.wine_id where w.name = 'Vine Hill Ranch'),
    'country', 'USA', 'region', 'California', 'sub_region', 'Napa Valley', 'appellation', 'Oakville'),
  jsonb_build_object('vintage_id', (select v.id from public.vintages v join public.wines w on w.id = v.wine_id where w.name = 'Montrose'),
    'country', 'France', 'region', 'Bordeaux', 'sub_region', 'Médoc', 'appellation', 'Saint-Estèphe'),
  jsonb_build_object('vintage_id', (select v.id from public.vintages v join public.wines w on w.id = v.wine_id where w.name = 'Wrong Match'),
    'country', 'France', 'region', 'Rhône', 'sub_region', null, 'appellation', 'Cornas')
)) as r;

select pg_temp.check((select (r ->> 'wines_changed')::int from res) = 2, 'two wines take CellarTracker places');
select pg_temp.check((select (r ->> 'skipped_country_differs')::int from res) = 1, 'a different country is not trusted');
select pg_temp.check(
  (select (sub_region, appellation) = ('Napa Valley', 'Oakville') from public.wines where name = 'Vine Hill Ranch'),
  'Napa wine gets sub-region and appellation');
select pg_temp.check(
  (select appellation = 'Saint-Estèphe' and sub_region = 'Médoc' from public.wines where name = 'Montrose'),
  'Bordeaux spelling replaced by CellarTracker''s');
select pg_temp.check(
  (select region = 'Tuscany' and appellation is null from public.wines where name = 'Wrong Match'),
  'mismatched country left alone');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
create temp table res2 as select public.apply_ct_places(jsonb_build_array(
  jsonb_build_object('vintage_id', (select id from public.vintages limit 1), 'country', 'USA'))) as r;
select pg_temp.check((select (r ->> 'wines_changed')::int from res2) = 0, 'other users change nothing');

rollback;
