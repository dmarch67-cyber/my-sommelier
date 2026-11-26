-- My Sommelier: other users and an admin.
--
-- * private.admins lists the users who may manage everyone's sign-in (name,
--   email, password). The project's first user (the owner) is made admin.
--   Changing an email or password needs the Auth admin API, so that runs in
--   the admin-users Edge Function, which checks public.is_admin() first.
-- * accounts.research_enabled switches the background research (drink
--   windows, critic notes, label pictures) on per account, because it costs
--   AI credit. It is on for every account, new ones included (Dan's choice,
--   2026-11-26); the admin can switch it off for anyone.
-- * public.research_accounts() lists those accounts for the scheduled jobs.
--
-- Backward compatible: one new column with a default, new table and functions.

create table if not exists private.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
comment on table private.admins is
  'Users who may see every user and change their name, email and password.';

insert into private.admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

alter table public.accounts
  add column if not exists research_enabled boolean not null default true;
comment on column public.accounts.research_enabled is
  'Background research (windows, critic notes, labels) runs for this account. Admin switches it.';

-- Is the signed-in user an admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.admins a
    where a.user_id = auth.uid()
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Every user for the admin screen: who they are, their account and how big
-- their cellars are. Admins only.
create or replace function public.admin_list_users()
returns table (
  user_id           uuid,
  email             text,
  name              text,
  created_at        timestamptz,
  last_sign_in_at   timestamptz,
  is_admin          boolean,
  account_id        uuid,
  account_name      text,
  research_enabled  boolean,
  cellars           bigint,
  bottles           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'insufficient_privilege';
  end if;
  return query
  select
    u.id,
    u.email::text,
    coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), '')::text,
    u.created_at,
    u.last_sign_in_at,
    exists (select 1 from private.admins a where a.user_id = u.id),
    m.account_id,
    acc.name,
    coalesce(acc.research_enabled, false),
    (select count(*) from public.cellars c where c.account_id = m.account_id),
    (select coalesce(sum(h.quantity), 0)::bigint from public.holdings h
      where h.account_id = m.account_id)
  from auth.users u
  left join lateral (
    select am.account_id from public.account_members am
    where am.user_id = u.id
    order by (am.role = 'owner') desc, am.created_at
    limit 1
  ) m on true
  left join public.accounts acc on acc.id = m.account_id
  order by u.created_at;
end;
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;

-- Switch background research on or off for one account. Admins only.
create or replace function public.admin_set_research(p_account_id uuid, p_enabled boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = 'insufficient_privilege';
  end if;
  update public.accounts set research_enabled = coalesce(p_enabled, false)
  where id = p_account_id;
  if not found then
    raise exception 'account not found' using errcode = 'no_data_found';
  end if;
end;
$$;
revoke all on function public.admin_set_research(uuid, boolean) from public, anon;
grant execute on function public.admin_set_research(uuid, boolean) to authenticated, service_role;

-- For the scheduled jobs (service role): accounts with research switched on,
-- oldest first.
create or replace function public.research_accounts()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.accounts where research_enabled order by created_at, id;
$$;
revoke all on function public.research_accounts() from public, anon, authenticated;
grant execute on function public.research_accounts() to service_role;

-- Members may not switch research on for themselves.
create or replace function private.guard_research_enabled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.research_enabled is distinct from old.research_enabled
     and current_user = 'authenticated'
     and not public.is_admin() then
    raise exception 'only an admin can switch research on or off'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_guard_research on public.accounts;
create trigger accounts_guard_research
  before update on public.accounts
  for each row execute function private.guard_research_enabled();
