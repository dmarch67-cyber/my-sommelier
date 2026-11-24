-- My Sommelier: one easy address for invoices (add@mysommelier.net).
--
-- Mail to the shared address carries no private code, so the reader finds the
-- account from who sent it: the sign-in email of an owner or editor. The
-- reader also checks that the email really came from that address (DKIM or
-- DMARC pass) before reading it. The private code address keeps working.
--
-- Backward compatible: one new nullable column and new functions only.

alter table public.invoice_emails add column if not exists matched_by text
  check (matched_by in ('code', 'sender'));
comment on column public.invoice_emails.matched_by is
  'How the account was found: the private code in the address, or the sender''s sign-in email.';

-- For the receive-invoice function (service role): the one account whose owner
-- or editor signs in with this email. Only for mail sent to the shared address
-- (so mail for anything else on the same email service is never picked up).
-- Null if none, or if more than one account matches.
create or replace function public.invoice_sender_account(p_email text, p_recipients text[])
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(distinct m.account_id) = 1 then min(m.account_id::text)::uuid end
  from auth.users u
  join public.account_members m on m.user_id = u.id and m.role in ('owner', 'editor')
  where lower(u.email) = lower(trim(p_email))
    and exists (
      select 1
      from private.app_settings s, unnest(p_recipients) r
      where s.key = 'invoice_shared_address' and lower(trim(r)) = lower(s.value)
    );
$$;
revoke all on function public.invoice_sender_account(text, text[]) from public, anon, authenticated;
grant execute on function public.invoice_sender_account(text, text[]) to service_role;

-- The address shown in the app: the shared one when set up, plus the private one.
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
  v_shared text;
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
  select value into v_shared from private.app_settings where key = 'invoice_shared_address';
  return jsonb_build_object(
    'address', case when v_domain is null then null else v_code || '@' || v_domain end,
    'shared', v_shared,
    'sender', (select u.email from auth.users u where u.id = auth.uid())
  );
end;
$$;
revoke all on function public.invoice_email_address(uuid, boolean) from public, anon;
grant execute on function public.invoice_email_address(uuid, boolean) to authenticated;
