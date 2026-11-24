-- My Sommelier: add bottles by emailing an invoice.
--
-- Each account gets a private email address (a random code at the app's
-- receiving domain). Mail sent there reaches the receive-invoice Edge
-- Function, which reads the invoice with Claude and saves what it found here
-- as an invoice waiting for review. Nothing is added to a cellar until the
-- owner checks the lines and confirms in the app (through add_bottles, as a
-- delivery upload does). It only ever adds.
--
-- Backward compatible: new tables and functions only; existing ones untouched.

-- Settings the app needs but nobody should edit from the app (for example
-- the receiving domain). Service role and SECURITY DEFINER functions only.
create table if not exists private.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
revoke all on private.app_settings from public, anon, authenticated;

-- One private address per account. The code is the secret part, so it lives
-- in the private schema; the app only ever sees its own through a function.
create table private.invoice_inboxes (
  account_id  uuid primary key references public.accounts (id) on delete cascade,
  code        text not null unique check (code ~ '^[a-z0-9]{12,40}$'),
  created_at  timestamptz not null default now()
);
revoke all on private.invoice_inboxes from public, anon, authenticated;

create or replace function private.new_inbox_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 16 characters from a 32-letter alphabet (no 0/o/1/l): about 80 bits.
  select string_agg(substr('abcdefghijkmnpqrstuvwxyz23456789', 1 + (get_byte(b, i) % 32), 1), '')
  from (select uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()) as b) r,
       generate_series(0, 15) i;
$$;
revoke all on function private.new_inbox_code() from public;

-- The signed-in user's private invoice address for an account they can change.
-- Makes one the first time. Returns null address while the receiving domain
-- is not set up yet, so the app can say so.
create or replace function public.invoice_email_address(p_account_id uuid, p_new boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code   text;
  v_domain text;
begin
  if p_account_id is null
     or p_account_id not in (select private.writable_account_ids()) then
    raise exception 'account not found' using errcode = 'insufficient_privilege';
  end if;
  if p_new then
    delete from private.invoice_inboxes where account_id = p_account_id;
  end if;
  select code into v_code from private.invoice_inboxes where account_id = p_account_id;
  if v_code is null then
    insert into private.invoice_inboxes (account_id, code)
    values (p_account_id, private.new_inbox_code())
    returning code into v_code;
  end if;
  select value into v_domain from private.app_settings where key = 'invoice_email_domain';
  return jsonb_build_object(
    'address', case when v_domain is null then null else v_code || '@' || v_domain end
  );
end;
$$;
revoke all on function public.invoice_email_address(uuid, boolean) from public, anon;
grant execute on function public.invoice_email_address(uuid, boolean) to authenticated;
comment on function public.invoice_email_address(uuid, boolean) is
  'The private address an account forwards invoices to. p_new makes a fresh one (the old one stops working).';

-- For the receive-invoice function (service role): which account a code belongs to.
create or replace function public.invoice_inbox_account(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select account_id from private.invoice_inboxes where code = lower(trim(p_code));
$$;
revoke all on function public.invoice_inbox_account(text) from public, anon, authenticated;
grant execute on function public.invoice_inbox_account(text) to service_role;

create table public.invoice_emails (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts (id) on delete cascade,
  -- The email provider's id for the message, so a repeated webhook is ignored
  -- and the invoice can be read again later.
  provider_email_id  text not null unique,
  from_address       text,
  subject            text,
  received_at        timestamptz not null default now(),
  status             text not null default 'reading'
                     check (status in ('reading', 'ready', 'failed', 'added', 'dismissed')),
  error              text,
  -- What Claude read: merchant, date, currency, suggested cellar, lines.
  reading            jsonb,
  cellar_id          uuid references public.cellars (id) on delete set null,
  added_event_ids    uuid[] not null default '{}',
  updated_at         timestamptz not null default now()
);
comment on table public.invoice_emails is
  'Invoices emailed to an account''s private address, read by Claude, waiting for the owner to review.';
create index invoice_emails_account_idx on public.invoice_emails (account_id, received_at desc);

create trigger invoice_emails_set_updated_at
  before update on public.invoice_emails
  for each row execute function private.set_updated_at();

alter table public.invoice_emails enable row level security;

create policy "members read their invoices" on public.invoice_emails
  for select to authenticated
  using (account_id in (select private.readable_account_ids()));

create policy "writers update their invoices" on public.invoice_emails
  for update to authenticated
  using (account_id in (select private.writable_account_ids()))
  with check (account_id in (select private.writable_account_ids()));

-- The app may only mark an invoice added, dismissed or back to waiting, and
-- record which cellar and events it went into. Only the reader writes readings.
revoke all on public.invoice_emails from public, anon, authenticated;
grant select on public.invoice_emails to authenticated;
grant update (status, cellar_id, added_event_ids) on public.invoice_emails to authenticated;

grant select, insert, update on public.invoice_emails to service_role;
grant select on public.wines, public.cellars to service_role;
