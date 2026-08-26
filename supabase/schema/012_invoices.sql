create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  sequence_num integer not null,
  paid_amount numeric(10, 2) not null default 0,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  unique (job_id, sequence_num)
);

comment on table public.invoices is 'One invoice generated against a job. A job can have multiple invoices (e.g. deposit + final) -- sequence_num is a per-job counter (1, 2, 3...) assigned by create_invoice(), formatted client-side as a letter suffix by formatInvoiceNumber() in src/lib/jobConstants.js (e.g. "Invoice #0001-A"). No delete policy exists for any role -- invoices are immutable once created; only paid_amount is ever updated after creation. Voiding (as distinct from deleting) an issued invoice is a documented future item, not built in this phase.';
