-- Tests for emailed invoices: private addresses and the invoice_emails table.
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
grant execute on function pg_temp.check(boolean, text) to authenticated, service_role;
grant execute on function pg_temp.check_fails(text, text) to authenticated, service_role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000da00', 'dan@example.test', '{"full_name": "Dan"}'),
  ('00000000-0000-0000-0000-00000000b0b0', 'tester@example.test', '{}');

create temp table ids as
select
  (select account_id from public.account_members where user_id = '00000000-0000-0000-0000-00000000da00') as dan,
  (select account_id from public.account_members where user_id = '00000000-0000-0000-0000-00000000b0b0') as bob;
grant select on ids to authenticated, service_role;
create temp table seen (code text);
grant select, insert, delete on seen to authenticated, service_role;

-- Dan's address --------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';

select pg_temp.check(
  public.invoice_email_address((select dan from ids)) ->> 'address' is null,
  'no address shown until the receiving domain is set');

reset role;
insert into seen select code from private.invoice_inboxes;
select pg_temp.check((select count(*) from seen) = 1, 'a private code was made for Dan');
select pg_temp.check((select code from seen) ~ '^[a-z2-9]{16}$', 'the code is 16 letters and digits');
insert into private.app_settings (key, value) values ('invoice_email_domain', 'abc.resend.app');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check(
  public.invoice_email_address((select dan from ids)) ->> 'address' = (select code from seen) || '@abc.resend.app',
  'asking again gives the same address, at the domain');
select pg_temp.check(
  public.invoice_email_address((select dan from ids), true) ->> 'address' <> (select code from seen) || '@abc.resend.app',
  'a new address replaces the old one');
select pg_temp.check_fails(
  'select public.invoice_email_address((select bob from ids))',
  'Dan cannot get the tester''s address');
select pg_temp.check_fails(
  'select public.invoice_inbox_account(''abc'')',
  'the app cannot look up codes');
select pg_temp.check_fails('select * from private.invoice_inboxes', 'the app cannot read codes');

-- The reader (service role) --------------------------------------------------

reset role;
delete from seen;
insert into seen select code from private.invoice_inboxes;
set local role service_role;
select pg_temp.check(
  public.invoice_inbox_account(upper((select code from seen))) = (select dan from ids),
  'the reader finds Dan''s account from the code');
select pg_temp.check(public.invoice_inbox_account('nobodyscode12345') is null, 'unknown code: no account');

insert into public.invoice_emails (account_id, provider_email_id, from_address, subject, status, reading)
values ((select dan from ids), 'em_1', 'dan@example.test', 'Your order', 'ready',
        '{"merchant": "K&L", "lines": []}');
select pg_temp.check_fails(
  $q$insert into public.invoice_emails (account_id, provider_email_id) values ((select dan from ids), 'em_1')$q$,
  'the same email is saved only once');

-- Dan reviews ----------------------------------------------------------------

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check((select count(*) from public.invoice_emails) = 1, 'Dan sees his invoice');
update public.invoice_emails set status = 'added', added_event_ids = '{}' where provider_email_id = 'em_1';
select pg_temp.check(
  (select status from public.invoice_emails) = 'added', 'Dan can mark it added');
select pg_temp.check_fails(
  $q$update public.invoice_emails set reading = '{}' where provider_email_id = 'em_1'$q$,
  'Dan cannot change what the reader read');
select pg_temp.check_fails(
  $q$update public.invoice_emails set status = 'nonsense'$q$, 'status must be a known one');
select pg_temp.check_fails(
  $q$insert into public.invoice_emails (account_id, provider_email_id) values ((select dan from ids), 'em_2')$q$,
  'the app cannot make invoices');
select pg_temp.check_fails('delete from public.invoice_emails', 'the app cannot delete invoices');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000b0b0';
select pg_temp.check((select count(*) from public.invoice_emails) = 0, 'the tester sees no invoices of Dan''s');

-- Shared address (add@...): account found from the sender's sign-in email --

reset role;
insert into private.app_settings (key, value) values ('invoice_shared_address', 'add@mysommelier.net');
set local role service_role;
select pg_temp.check(
  public.invoice_sender_account('DAN@example.test', array['add@mysommelier.net']) = (select dan from ids),
  'mail from Dan''s sign-in email to the shared address finds his account');
select pg_temp.check(
  public.invoice_sender_account('dan@example.test', array['other@fenaetgra.resend.app']) is null,
  'mail from Dan to some other address is not taken');
select pg_temp.check(
  public.invoice_sender_account('stranger@example.test', array['add@mysommelier.net']) is null,
  'mail from a stranger finds no account');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000da00';
select pg_temp.check(
  public.invoice_email_address((select dan from ids)) ->> 'shared' = 'add@mysommelier.net',
  'the app shows the shared address');
select pg_temp.check(
  public.invoice_email_address((select dan from ids)) ->> 'sender' = 'dan@example.test',
  'and the email it must be sent from');
select pg_temp.check_fails(
  'select public.invoice_sender_account(''dan@example.test'', array[''add@mysommelier.net''])',
  'the app cannot look up accounts by email');

rollback;
