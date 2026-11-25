-- "Recheck window" checks that the signed-in user owns (or edits) the cellar
-- by reading account_members with the service role, which had no read grant
-- there, so every owner got "Only the cellar owner can recheck a window".
-- Applied to hosted 2026-11-25.
grant select on public.account_members to service_role;
