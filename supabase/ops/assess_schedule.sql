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

-- 3. Monthly refresh (after the first full run is done). Every 10 minutes,
--    review at most one wine that is due: new, its CellarTracker community
--    score has moved and its review is 28+ days old, or its review is 90+ days
--    old. "cap" limits re-reviews to that many per 30 days (~5c each). When
--    nothing is due the call returns at once and costs nothing.
select cron.schedule('refresh-wines', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/assess-wines',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{"mode": "refresh", "cap": 150}'::jsonb,
    timeout_milliseconds := 300000);
$$);

-- 4. Rewrite "What critics say" for vintages whose review changed (Haiku, no
--    web search, a fraction of a cent per wine).
select cron.schedule('critics-say', '5,35 * * * *', $$
  select net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/critics-say',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{"limit": 10}'::jsonb,
    timeout_milliseconds := 150000);
$$);

-- To pause:  select cron.unschedule('refresh-wines'); select cron.unschedule('critics-say');
-- Cost so far this month:
--   select count(*), sum((usage->>'searches')::int) from public.wine_assessments
--   where ok and started_at > now() - interval '30 days';
