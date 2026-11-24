-- The blended-window reviewer runs on a database schedule: pg_cron fires it,
-- pg_net makes the call. The schedule itself and its Vault secret are set up
-- per project (see supabase/ops/assess_schedule.sql), not in a migration.
-- Plain Postgres (the test database) may not ship these, so only enable them
-- where they exist.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end;
$$;
