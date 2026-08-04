-- Staff profile table, linked 1:1 to Supabase Auth users.
-- Custom fields (role, name, phone) can't live on auth.users directly,
-- so we mirror the account here. The `role` column is what every RLS
-- policy in this app checks.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null check (role in ('admin', 'office', 'technician')),
  phone text,
  created_at timestamptz not null default now()
);

comment on table public.users is 'Staff accounts (admin/office/technician). One row per auth.users row.';
