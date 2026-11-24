-- The blended-window reviewer runs on a database schedule: pg_cron fires it,
-- pg_net makes the call. The schedule itself and its Vault secret are set up
-- per project (see supabase/ops/assess_schedule.sql), not in a migration.
create extension if not exists pg_cron;
create extension if not exists pg_net;
