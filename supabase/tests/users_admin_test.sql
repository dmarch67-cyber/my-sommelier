-- Tests for other users and the admin: one transaction, rolled back.

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

-- The migration made the first user admin; tests start from a blank list.
delete from private.admins;
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{"full_name": "Dan"}', now() - interval '2 days'),
  ('00000000-0000-0000-0000-00000000b0b0', 'friend@example.test', '{"full_name": "Sam"}', now() - interval '1 day');
insert into private.admins (user_id) values ('00000000-0000-0000-0000-00000000da00');

select pg_temp.check(
  (select research_enabled from public.accounts a join public.account_members m on m.account_id = a.id
   where m.user_id = '00000000-0000-0000-0000-00000000b0b0') = true,
  'a new account starts with research on');

-- The friend: not an admin, sees only their own account, can make a cellar.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check(public.is_admin() = false, 'friend is not admin');
select pg_temp.check((select count(*) from public.accounts) = 1, 'friend sees only their own account');
select pg_temp.check_fails('select * from public.admin_list_users()', 'friend cannot list users');
select pg_temp.check_fails(
  $$select public.admin_set_research((select id from public.accounts), false)$$,
  'friend cannot switch research');
select pg_temp.check_fails(
  'update public.accounts set research_enabled = false',
  'friend cannot switch research by editing the account');
update public.accounts set name = 'Sam''s cellar';
select pg_temp.check((select name from public.accounts) = 'Sam''s cellar', 'friend can still rename their account');
insert into public.cellars (account_id, name, currency)
select id, 'Home', 'USD' from public.accounts;
select pg_temp.check((select count(*) from public.cellars) = 1, 'friend can create their first cellar');

-- Dan: admin, sees everyone on the admin list, can switch research.
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check(public.is_admin(), 'Dan is admin');
select pg_temp.check((select count(*) from public.cellars) = 0, 'Dan does not see the friend''s cellar');
select pg_temp.check((select count(*) from public.admin_list_users()) = 2, 'admin list shows both users');
select pg_temp.check(
  (select name = 'Sam' and cellars = 1 and not is_admin and research_enabled
   from public.admin_list_users() where email = 'friend@example.test'),
  'admin list shows the friend''s name, cellar count and research');
select public.admin_set_research(
  (select account_id from public.admin_list_users() where email = 'friend@example.test'), false);
select pg_temp.check(
  (select not research_enabled from public.admin_list_users() where email = 'friend@example.test'),
  'admin switched research off');

reset role;
select pg_temp.check(
  (select count(*) from public.research_accounts()) = 1,
  'scheduled jobs skip the account with research off');
select pg_temp.check(
  not has_function_privilege('authenticated', 'public.research_accounts()', 'execute'),
  'signed-in users cannot call research_accounts');
select pg_temp.check(
  not has_function_privilege('anon', 'public.admin_list_users()', 'execute'),
  'anonymous visitors cannot call admin_list_users');

rollback;
