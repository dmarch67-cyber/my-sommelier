-- My Sommelier: per-account data separation.
--
-- Every table has row-level security on. A signed-in user sees rows of the
-- accounts they belong to, and changes rows of the accounts where they are
-- owner or editor. Anonymous visitors get nothing.

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

alter table public.accounts enable row level security;
alter table public.account_members enable row level security;

grant select, update on public.accounts to authenticated;
grant select on public.account_members to authenticated;
revoke insert, delete on public.accounts from authenticated;
revoke insert, update, delete on public.account_members from authenticated;

create policy "members read their accounts" on public.accounts
  for select to authenticated
  using (id in (select private.readable_account_ids()));

create policy "owners and editors rename their accounts" on public.accounts
  for update to authenticated
  using (id in (select private.writable_account_ids()))
  with check (id in (select private.writable_account_ids()));

create policy "members read their account's members" on public.account_members
  for select to authenticated
  using (account_id in (select private.readable_account_ids()));

-- Tables with full read/write for members.
do $$
declare
  t text;
begin
  foreach t in array array[
    'cellars', 'wines', 'vintages', 'holdings', 'scores', 'accolades', 'tasting_notes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format(
      'create policy "members read" on public.%I for select to authenticated '
      'using (account_id in (select private.readable_account_ids()))', t);
    execute format(
      'create policy "writers insert" on public.%I for insert to authenticated '
      'with check (account_id in (select private.writable_account_ids()))', t);
    execute format(
      'create policy "writers update" on public.%I for update to authenticated '
      'using (account_id in (select private.writable_account_ids())) '
      'with check (account_id in (select private.writable_account_ids()))', t);
    execute format(
      'create policy "writers delete" on public.%I for delete to authenticated '
      'using (account_id in (select private.writable_account_ids()))', t);
  end loop;
end;
$$;

-- The ledger is append-only: read, add, and edit the note/date/reason
-- (guarded by trigger). No deletes.
alter table public.inventory_events enable row level security;
grant select, insert, update on public.inventory_events to authenticated;
revoke delete on public.inventory_events from authenticated;

create policy "members read" on public.inventory_events
  for select to authenticated
  using (account_id in (select private.readable_account_ids()));

create policy "writers insert" on public.inventory_events
  for insert to authenticated
  with check (account_id in (select private.writable_account_ids()));

create policy "writers update" on public.inventory_events
  for update to authenticated
  using (account_id in (select private.writable_account_ids()))
  with check (account_id in (select private.writable_account_ids()));
