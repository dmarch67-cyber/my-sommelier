-- Tests for editing and deleting your own tasting notes.
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
  '[{"wine_name": "Aalto", "vintage": 2015, "quantity": 6}]'::jsonb);

insert into public.tasting_notes (account_id, vintage_id, notes, liked)
select v.account_id, v.id, 'Big and dark.', true from public.vintages v;

create temp table ct_in as
select jsonb_build_array(
  jsonb_build_object('vintage_id', v.id, 'source_ref', 'ct:1', 'tasted_on', '2019-05-04',
                     'rating', 94, 'notes', 'Gorgeous.'),
  jsonb_build_object('vintage_id', v.id, 'source_ref', 'ct:2', 'tasted_on', '2020-01-01',
                     'rating', 90, 'notes', 'Fine.')
) as notes
from public.vintages v;
grant select on ct_in to authenticated;
select pg_temp.check(
  (select public.apply_ct_own_notes(notes) from ct_in) = '{"added": 2, "updated": 0}'::jsonb,
  'CellarTracker notes come in');

-- Someone else can neither change nor delete Dan's notes.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
update public.tasting_notes set notes = 'hacked';
delete from public.tasting_notes;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check(
  (select count(*) from public.tasting_notes) = 3
  and not exists (select 1 from public.tasting_notes where notes = 'hacked'),
  'other accounts cannot edit or delete the notes');

-- Dan edits his own app note and deletes it.
update public.tasting_notes set notes = 'Even better a day later.' where source_ref is null;
select pg_temp.check(
  (select notes from public.tasting_notes where source_ref is null) = 'Even better a day later.',
  'owner edits a note');
delete from public.tasting_notes where source_ref is null;
select pg_temp.check(
  (select count(*) from public.dismissed_notes) = 0,
  'deleting an app note leaves nothing behind');

-- Edit one CellarTracker note (the app saves it as its own) and delete the other.
update public.tasting_notes set notes = 'My rewrite.', source = 'app' where source_ref = 'ct:1';
delete from public.tasting_notes where source_ref = 'ct:2';
select pg_temp.check(
  (select count(*) from public.dismissed_notes where source_ref = 'ct:2') = 1,
  'a deleted CellarTracker note is remembered');

select pg_temp.check(
  (select public.apply_ct_own_notes(notes) from ct_in) = '{"added": 0, "updated": 0}'::jsonb,
  'the sync neither restores the deleted note nor overwrites the edit');
select pg_temp.check(
  (select notes from public.tasting_notes where source_ref = 'ct:1') = 'My rewrite.'
  and not exists (select 1 from public.tasting_notes where source_ref = 'ct:2'),
  'edit kept, deleted note stays gone');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check((select count(*) from public.dismissed_notes) = 0,
  'other accounts cannot see deleted-note records');
do $$
begin
  insert into public.dismissed_notes (account_id, source_ref)
  select id, 'x' from public.accounts limit 1;
  raise exception 'FAILED: users must not write deleted-note records directly';
exception when insufficient_privilege then
  raise notice 'ok - users cannot write deleted-note records directly';
end;
$$;

-- Deleting an account with CellarTracker notes still works.
reset role;
delete from public.accounts
where id = (select account_id from public.account_members
            where user_id = '00000000-0000-0000-0000-00000000da00');
select pg_temp.check(
  not exists (select 1 from public.dismissed_notes),
  'deleting an account removes its notes cleanly');

rollback;
