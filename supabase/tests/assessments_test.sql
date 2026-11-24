-- Tests for blended drinking windows (stage 3). One transaction, rolled back.

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
grant execute on function pg_temp.check(boolean, text) to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{}');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';

insert into public.cellars (account_id, name, currency)
select id, 'LA home', 'USD' from public.accounts;

select public.add_bottles(
  (select id from public.cellars limit 1),
  '[{"wine_name": "Ridge Monte Bello", "vintage": 2019, "quantity": 6},
    {"wine_name": "Ridge Monte Bello", "vintage": 2013, "quantity": 2},
    {"wine_name": "Ridge Monte Bello", "vintage": 2005, "quantity": 1},
    {"wine_name": "Krug Grande Cuvee", "vintage": null, "quantity": 1}]'::jsonb);

-- Signed-in users cannot call the reviewer functions.
create temp table blocked as select true as ok;
grant all on blocked to authenticated, service_role;
do $$
begin
  perform public.claim_next_assessment((select id from public.accounts limit 1), 50);
  update blocked set ok = false;
exception when insufficient_privilege then
  null;
end;
$$;
select pg_temp.check((select ok from blocked), 'app users cannot claim reviews');

create temp table ids as
select (select id from public.accounts limit 1) as acct,
       (select id from public.wines where name = 'Ridge Monte Bello') as ridge,
       (select id from public.vintages where year = 2019) as r19,
       (select id from public.vintages where year = 2013) as r13,
       (select id from public.vintages where year = 2005) as r05;
grant all on ids to authenticated, service_role;

update public.vintages set drink_from = 2030, drink_to = 2060, drink_window_source = 'cellartracker'
where id = (select r19 from ids);
update public.vintages set drink_from = 2020, drink_to = 2045, drink_window_source = 'owner'
where id = (select r13 from ids);

reset role;
set local role service_role;

create temp table claim1 as select public.claim_next_assessment((select acct from ids), 50) as a;
select pg_temp.check(
  (select wine_id from public.wine_assessments where id = (select a from claim1)) = (select ridge from ids),
  'the wine with most bottles is reviewed first');
create temp table claim2 as select public.claim_next_assessment((select acct from ids), 50) as a;
select pg_temp.check(
  (select wine_id from public.wine_assessments where id = (select a from claim2)) <> (select ridge from ids),
  'a wine being reviewed is not claimed twice');

create temp table res as select public.apply_assessment(
  (select a from claim1),
  jsonb_build_array(
    jsonb_build_object('vintage_id', (select r19 from ids), 'drink_from', 2029, 'drink_to', 2052,
      'maturity', 'too_young', 'confidence', 'high', 'summary', 'Tight and primary.',
      'recent_notes', 7, 'latest_note_year', 2026),
    jsonb_build_object('vintage_id', (select r13 from ids), 'drink_from', 2022, 'drink_to', 2038,
      'maturity', 'ready', 'confidence', 'medium', 'summary', 'Open.', 'recent_notes', 3,
      'latest_note_year', 2025),
    jsonb_build_object('vintage_id', (select r05 from ids), 'drink_from', 2015, 'drink_to', 2027,
      'maturity', 'declining', 'confidence', 'medium', 'summary', 'Several past-peak notes.',
      'recent_notes', 4, 'latest_note_year', 2026),
    jsonb_build_object('vintage_id', gen_random_uuid(), 'drink_from', 2020, 'drink_to', 2030)),
  '[{"url": "https://example.test/a", "title": "A"}]'::jsonb, '{"searches": 3}'::jsonb,
  'claude-opus-5-5') as r;

select pg_temp.check((select (r ->> 'vintages')::int from res) = 3, 'only this wine''s vintages saved');
select pg_temp.check((select (r ->> 'windows')::int from res) = 2, 'two windows written');
select pg_temp.check(
  (select drink_from = 2029 and drink_to = 2052 and drink_window_source = 'blended'
   from public.vintages where id = (select r19 from ids)),
  'blended window replaces the CellarTracker window');
select pg_temp.check(
  (select drink_from = 2020 and drink_window_source = 'owner' from public.vintages where id = (select r13 from ids)),
  'owner window kept');
select pg_temp.check(
  (select drink_to = 2027 and drink_window_source = 'blended' from public.vintages where id = (select r05 from ids)),
  'blank window filled');
select pg_temp.check(
  (select maturity = 'ready' and summary = 'Open.' from public.vintage_assessments where vintage_id = (select r13 from ids)),
  'the review of the owner''s vintage is still kept for the backend');
select pg_temp.check(
  (select ok and finished_at is not null and sources -> 0 ->> 'url' = 'https://example.test/a'
   from public.wine_assessments where id = (select a from claim1)),
  'review marked done');

-- CellarTracker and the quick estimate never overwrite a blended window.
select public.apply_cellartracker(jsonb_build_array(jsonb_build_object(
  'vintage_id', (select r19 from ids), 'drink_from', 2031, 'drink_to', 2070)));
select pg_temp.check(
  (select drink_to = 2052 and drink_window_source = 'blended' and ct_drink_to = 2070
   from public.vintages where id = (select r19 from ids)),
  'a CellarTracker sync keeps the blended window but records its own');

-- A failure frees the wine to be tried again; a done wine is not re-claimed.
select public.fail_assessment((select a from claim2), 'boom', null);
create temp table claim3 as select public.claim_next_assessment((select acct from ids), 50) as a;
select pg_temp.check(
  (select wine_id from public.wine_assessments where id = (select a from claim3))
    = (select wine_id from public.wine_assessments where id = (select a from claim2)),
  'a failed wine is retried');
select public.fail_assessment((select a from claim3), 'boom again', null);
select pg_temp.check(
  public.claim_next_assessment((select acct from ids), 50) is null,
  'after two failures, and with the rest done, nothing is left');

-- The cap stops the run.
select pg_temp.check(
  public.claim_next_assessment((select acct from ids), 1) is null,
  'stops once the test limit of finished reviews is reached');

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check((select count(*) from public.vintage_assessments) = 3, 'members can read reviews');

rollback;
