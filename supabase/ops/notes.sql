-- Third-party tasting notes (gather-notes Edge Function). Run through the SQL
-- editor or the Supabase connector. Uses the same Vault secret as assess-wines.

-- Test run: gather notes for the next wines (most bottles first). Each call
-- handles one wine. "max" caps how many wines may have been searched in
-- total, so a test run stops by itself.
select array_agg(net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/gather-notes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{"max": 20}'::jsonb,
    timeout_milliseconds := 150000))
from generate_series(1, 10);

-- Full run: every 2 minutes, five wines at a time, until every held wine has
-- been searched (the calls return at once with {"done":true} after that).
select cron.schedule('gather-notes', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/gather-notes',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
  from generate_series(1, 5);
$$);
-- To stop: select cron.unschedule('gather-notes');

-- Afterwards, rewrite the "What critics say" summaries with the new notes
-- (critics-say also does this by itself on its half-hourly schedule):
-- select net.http_post(url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/critics-say',
--   headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
--     (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
--   body := '{"limit": 20}'::jsonb, timeout_milliseconds := 150000)
-- from generate_series(1, 10);

-- Progress and cost (Haiku 5.5 $0.10/M input, $0.50/M output; web search $10 per 1,000):
select notes_search_result, count(*) as wines,
       sum((notes_search_usage->>'notes')::int) as notes,
       sum((notes_search_usage->>'rejected')::int) as rejected,
       round(sum((notes_search_usage->>'search_input')::numeric + (notes_search_usage->>'read_input')::numeric) * 0.10 / 1e6
             + sum((notes_search_usage->>'search_output')::numeric + (notes_search_usage->>'read_output')::numeric) * 0.50 / 1e6
             + sum((notes_search_usage->>'searches')::numeric) / 100, 2) as dollars
from public.wines where notes_searched_at is not null group by 1;

-- Look again for one wine: POST {"wine_id": "..."} to gather-notes, or
-- update public.wines set notes_searched_at = null, notes_search_result = null where id = '...';
