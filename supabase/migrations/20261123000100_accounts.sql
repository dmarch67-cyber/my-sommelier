-- My Sommelier: accounts and membership.
--
-- Every row of user data belongs to exactly one account. A user gets an
-- account automatically on sign-up and is its owner. account_members lets a
-- later version share an account (for example with a partner) without a
-- redesign; v1 has one member per account.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Keeps updated_at current on every table that has one.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create type public.account_role as enum ('owner', 'editor', 'viewer');

create table public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.accounts is
  'A household or person who owns cellars. All user data hangs off an account.';

create table public.account_members (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.account_role not null default 'owner',
  created_at  timestamptz not null default now(),
  unique (account_id, user_id)
);
comment on table public.account_members is
  'Which signed-in users can see (viewer) or change (owner, editor) an account.';
create index account_members_user_id_idx on public.account_members (user_id);

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function private.set_updated_at();

-- Accounts the signed-in user can read. SECURITY DEFINER so policies can
-- call it without recursing into account_members' own policy.
create or replace function private.readable_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.account_id
  from public.account_members m
  where m.user_id = auth.uid();
$$;

-- Accounts the signed-in user can change.
create or replace function private.writable_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.account_id
  from public.account_members m
  where m.user_id = auth.uid()
    and m.role in ('owner', 'editor');
$$;

revoke all on function private.readable_account_ids() from public;
revoke all on function private.writable_account_ids() from public;
grant execute on function private.readable_account_ids() to authenticated, service_role;
grant execute on function private.writable_account_ids() to authenticated, service_role;

-- New sign-up: create an account and make the user its owner.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_account_id uuid;
begin
  insert into public.accounts (name)
  values (coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.email), ''),
    'My cellar'
  ))
  returning id into new_account_id;

  insert into public.account_members (account_id, user_id, role)
  values (new_account_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
