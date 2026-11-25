-- Label pictures (find-labels Edge Function). Run through the SQL editor or
-- the Supabase connector. Uses the same Vault secret as assess-wines.

-- Look for label pictures (one per vintage, plus a stand-in) for the next N wines. Each call
-- handles one wine, about 10 cents. "max" caps how many wines may have been
-- searched in total, so a test run stops by itself.
select array_agg(net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/find-labels',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{"max": 20}'::jsonb,
    timeout_milliseconds := 150000))
from generate_series(1, 10);

-- Full run: every 2 minutes, five wines at a time, until every held wine has
-- been searched (the calls return at once with {"done":true} after that).
select cron.schedule('find-labels', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://fhvwihqcctgekuejxzzv.supabase.co/functions/v1/find-labels',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-assess-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'assess_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000)
  from generate_series(1, 5);
$$);
-- To stop: select cron.unschedule('find-labels');

-- Progress and cost (Haiku ~$1/M input, $5/M output; web search $10 per 1,000):
select label_search_result, count(*),
       round(sum((label_search_usage->>'search_input')::numeric + (label_search_usage->>'look_input')::numeric) / 1e6
             + sum((label_search_usage->>'search_output')::numeric + (label_search_usage->>'look_output')::numeric) * 5 / 1e6
             + sum((label_search_usage->>'searches')::numeric) / 100, 2) as dollars
from public.wines where label_searched_at is not null group by 1;

-- Look again for a wine (e.g. after removing a wrong picture by mistake):
-- update public.wines set label_searched_at = null, label_search_result = null where id = '...';
