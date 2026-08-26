-- The project's second write-capable function, after apply_bundle_to_job().
-- Creates an invoice for a job: inserts one invoices header row
-- (sequence_num computed as the next per-job counter value in the same
-- statement, avoiding a race between concurrent calls on the same job)
-- and one invoice_line_items row per id in line_item_ids, snapshotting
-- item_name_snapshot/qty/price directly from job_line_items at this
-- moment. The job_id filter on the line-item select means an id
-- belonging to a different job is silently excluded, not an error -- a
-- caller cannot smuggle another job's line item onto this invoice.
--
-- SECURITY INVOKER (the default -- no keyword needed): admin/office
-- already have full INSERT rights on both tables via existing RLS, so
-- this buys atomicity and server-side-sourced snapshot values, not
-- elevated privilege. Unlike apply_bundle_to_job (whose first insert is
-- an INSERT ... SELECT that just inserts zero rows under missing SELECT
-- access, returning null silently), this function's first insert is a
-- plain INSERT ... VALUES -- a technician calling this directly hits an
-- actual RLS policy violation (SQLSTATE 42501) on that insert, since
-- they have no insert policy on invoices at all. The call errors out
-- rather than returning null.
create or replace function public.create_invoice(target_job_id uuid, line_item_ids uuid[])
returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_invoice_id uuid;
begin
  insert into public.invoices (job_id, sequence_num, created_by)
  values (
    target_job_id,
    coalesce((select max(sequence_num) from public.invoices where job_id = target_job_id), 0) + 1,
    auth.uid()
  )
  returning id into new_invoice_id;

  insert into public.invoice_line_items (
    invoice_id, job_line_item_id, item_name_snapshot, qty,
    unit_price_inc_gst_snapshot, total_inc_gst_snapshot
  )
  select
    new_invoice_id,
    job_line_items.id,
    job_line_items.item_name_snapshot,
    job_line_items.qty,
    job_line_items.price_inc_gst,
    job_line_items.total_inc_gst
  from public.job_line_items
  where job_line_items.id = any(line_item_ids)
    and job_line_items.job_id = target_job_id;

  return new_invoice_id;
end;
$$;

comment on function public.create_invoice(uuid, uuid[]) is 'Creates an invoice for a job: one invoices header row (sequence_num = next per-job counter, computed atomically in the same insert) plus one invoice_line_items row per id in line_item_ids, snapshotting item_name_snapshot/qty/price_inc_gst/total_inc_gst from job_line_items at this moment. The job_id filter on the line-item select silently excludes any id belonging to a different job. SECURITY INVOKER -- admin/office already have full INSERT rights on both tables via RLS, so this buys atomicity and server-side snapshot sourcing, not elevated privilege. A technician calling this directly gets a real RLS policy violation on the header insert (unlike apply_bundle_to_job''s silent-null pattern), since technicians have no insert policy on invoices.';
