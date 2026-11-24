-- Tests for wine_food_matches and wines_needing_food_matches. One transaction, rolled back.

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

select pg_temp.check((select count(*) from public.wines_needing_food_matches(12, null)) = 0,
  'wines not yet filled in (no grapes or style) wait for the fill-in');
select pg_temp.check((select count(*) from public.wines_needing_food_matches(12,
    (select id from public.wines where name = 'Ridge Monte Bello'))) = 1,
  'one named wine can be asked for straight away');

update public.wines set enriched_at = now(), colour = 'red', grapes = '{Cabernet Sauvignon}'
where name = 'Ridge Monte Bello';
update public.wines set enriched_at = now() where name = 'Bergstrom Sigrid Chardonnay';

select pg_temp.check((select count(*) from public.wines_needing_food_matches(12, null)) = 2,
  'filled-in wines without dishes are listed once each (not per vintage)');
select pg_temp.check((select remaining from public.wines_needing_food_matches(1, null) limit 1) = 2,
  'remaining counts every wine still to do');
select pg_temp.check((select colour from public.wines_needing_food_matches(12, null)
    where name = 'Ridge Monte Bello') = 'red', 'facts come along');

insert into public.wine_food_matches (wine_id, account_id, dishes, avoid, older, model)
select id, account_id,
  '[{"dish": "Roast leg of lamb", "why": "Firm tannins love the fat."}]'::jsonb,
  'Spicy Thai', 'Simple roast chicken', 'test'
from public.wines where name = 'Ridge Monte Bello';

select pg_temp.check((select count(*) from public.wines_needing_food_matches(12, null)) = 1,
  'a wine with dishes is not asked about again');
select pg_temp.check((select count(*) from public.wine_food_matches) = 1, 'owner reads dishes');

create temp table dan_wine as
select id, account_id from public.wines where name = 'Bergstrom Sigrid Chardonnay';

-- Someone else sees none of it and cannot write to Dan's wines.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check((select count(*) from public.wine_food_matches) = 0,
  'other accounts cannot read the dishes');
select pg_temp.check((select count(*) from public.wines_needing_food_matches(12, null)) = 0,
  'other accounts are not offered Dan''s wines');

do $$
begin
  begin
    insert into public.wine_food_matches (wine_id, account_id, dishes)
    select id, account_id, '[]'::jsonb from dan_wine;
    raise exception 'FAILED: other account wrote dishes';
  exception when insufficient_privilege then
    raise notice 'ok - other accounts cannot add dishes to Dan''s wines';
  end;
end;
$$;

rollback;
