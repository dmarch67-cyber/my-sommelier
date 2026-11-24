-- Tests for the palate profile: vintage_drinking, palate_profiles, apply_ct_own_notes.
-- One transaction, rolled back.

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
  '[{"wine_name": "Aalto", "vintage": 2015, "quantity": 6},
    {"wine_name": "Ridge Monte Bello", "vintage": 2013, "quantity": 2}]'::jsonb);

-- Drink two bottles of the Aalto.
insert into public.inventory_events (account_id, holding_id, event_type, quantity_delta)
select h.account_id, h.id, 'consumed', -1
from public.holdings h join public.vintages v on v.id = h.vintage_id
join public.wines w on w.id = v.wine_id, generate_series(1, 2)
where w.name = 'Aalto';

select pg_temp.check(
  (select (bought, drunk) = (6, 2) from public.vintage_drinking d
     join public.vintages v on v.id = d.vintage_id join public.wines w on w.id = v.wine_id
   where w.name = 'Aalto'),
  'vintage_drinking counts bottles bought (here + drunk) and drunk');

-- Thumbs up and the app source default.
insert into public.tasting_notes (account_id, vintage_id, liked)
select v.account_id, v.id, true from public.vintages v join public.wines w on w.id = v.wine_id
where w.name = 'Aalto';
select pg_temp.check((select source from public.tasting_notes where liked) = 'app',
  'notes written in the app are marked as such');

-- CellarTracker notes: added once, updated on re-run, empty ones skipped.
create temp table ct_in as
select jsonb_build_array(
  jsonb_build_object('vintage_id', v.id, 'source_ref', 'ct:123', 'tasted_on', '2019-05-04',
                     'rating', 94, 'notes', 'Gorgeous.'),
  jsonb_build_object('vintage_id', v.id, 'source_ref', 'score:9', 'tasted_on', null,
                     'rating', 92, 'notes', null),
  jsonb_build_object('vintage_id', v.id, 'source_ref', 'ct:empty', 'rating', null, 'notes', '  ')
) as notes
from public.vintages v join public.wines w on w.id = v.wine_id where w.name = 'Ridge Monte Bello';
grant select on ct_in to authenticated;

select pg_temp.check(
  (select public.apply_ct_own_notes(notes) from ct_in) = '{"added": 2, "updated": 0}'::jsonb,
  'CellarTracker notes are added, empty ones skipped');
select pg_temp.check(
  (select public.apply_ct_own_notes(notes) from ct_in) = '{"added": 0, "updated": 2}'::jsonb,
  'a re-run updates instead of duplicating');
select pg_temp.check(
  (select count(*) from public.tasting_notes where source = 'cellartracker') = 2
  and (select tasted_on is null from public.tasting_notes where source_ref = 'score:9'),
  'a score with no date is kept without one');

insert into public.palate_profiles (account_id, quiz, not_really)
select id, '{"body": "full"}', '["grape:Merlot"]' from public.accounts;
select pg_temp.check((select quiz->>'body' from public.palate_profiles) = 'full',
  'owner saves quiz answers');

-- Someone else sees none of it.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check((select count(*) from public.palate_profiles) = 0,
  'other accounts cannot read the profile');
select pg_temp.check((select count(*) from public.vintage_drinking) = 0,
  'other accounts cannot read the drinking counts');
select pg_temp.check(
  (select public.apply_ct_own_notes(notes) from ct_in) = '{"added": 0, "updated": 0}'::jsonb,
  'other accounts cannot add notes to Dan''s wines');

rollback;
