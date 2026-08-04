-- Looks up the calling user's role. SECURITY DEFINER so it can read
-- public.users even though users' own RLS policy (below) wouldn't
-- otherwise let every table's policies query it directly.
-- Named current_app_role (not current_role) to avoid clashing with
-- Postgres's own built-in CURRENT_ROLE.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;
