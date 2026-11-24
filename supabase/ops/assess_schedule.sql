-- One-time, per-project setup for the blended-window reviewer (assess-wines).
-- Run in the SQL editor (or through the Supabase connector) after the
-- 20261126 migrations. Nothing here is typed by hand: the secret is random
-- and stays in Vault.

-- 1. The shared secret the schedule sends and the function checks.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'assess_secret',
  'Shared secret: pg_cron schedule -> assess-wines Edge Function');

-- 2. Every 2 minutes, review the next wine. "max" is how many wines may have
--    a finished review in total (50 for the test run; raise it for the full run).
select cron.schedule('assess-wines', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/assess-wines',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{"max": 50}'::jsonb,
    timeout_milliseconds := 300000);
$$);

-- To pause:   select cron.unschedule('assess-wines');
-- Progress:   select count(*) filter (where ok), count(*) filter (where not ok and finished_at is not null)
--             from public.wine_assessments;
