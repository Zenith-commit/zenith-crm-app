create table public.materials_catalog (
  id uuid primary key default gen_random_uuid(),
  item_number text,
  description text not null,
  item_type text not null check (item_type in ('material', 'service')),
  price numeric(10, 2) not null,
  purchase_cost numeric(10, 2),
  tax_rate numeric(4, 2) not null default 10.00,
  price_includes_tax boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.materials_catalog is 'Reusable price list of materials and services, similar to ServiceM8''s catalog. Admin/office only -- technicians have no access.';
