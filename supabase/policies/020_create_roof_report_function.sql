-- The project's third write-capable function, after apply_bundle_to_job()
-- and create_invoice(). Creates one roof_reports row: sequence_num is
-- computed as the next per-job counter value in the same statement
-- (same race-safe pattern as create_invoice's invoices.sequence_num),
-- avoiding a race between concurrent calls on the same job -- the
-- unique(job_id, sequence_num) constraint on roof_reports is the real
-- safety net for a genuine simultaneous collision, converting it into a
-- retryable unique_violation rather than corrupting data, same as
-- create_invoice's accepted limitation.
--
-- SECURITY INVOKER (the default -- no keyword needed): admin/office
-- already have full INSERT rights on roof_reports via existing RLS, so
-- this buys atomic sequence numbering, not elevated privilege. A
-- technician calling this directly hits a real RLS policy violation
-- (SQLSTATE 42501) on the insert, since they have no insert policy on
-- roof_reports at all -- same behavior as create_invoice, not
-- apply_bundle_to_job's silent-null pattern.
--
-- Called by the generate-roof-report Edge Function using a Supabase
-- client scoped to the CALLING USER's own JWT, not the service-role
-- client -- this is deliberate: it keeps this specific write gated by
-- RLS as a second, independent layer, on top of (not instead of) the
-- Edge Function's own admin/office role check.
create or replace function public.create_roof_report(
  target_job_id uuid,
  p_client_name text,
  p_property_address text,
  p_date_of_inspection date,
  p_inspector text,
  p_work_order text,
  p_roof_type public.roof_type_option,
  p_roof_age text,
  p_roof_pitch text,
  p_urgent_observations text[],
  p_urgent_recommendations text[],
  p_preventive_observations text[],
  p_preventive_recommendations text[],
  p_photo_paths text[],
  p_docx_path text
)
returns public.roof_reports
language plpgsql
set search_path = public
as $$
declare
  new_row public.roof_reports;
begin
  insert into public.roof_reports (
    job_id, sequence_num, client_name, property_address, date_of_inspection,
    inspector, work_order, roof_type, roof_age, roof_pitch,
    urgent_observations, urgent_recommendations,
    preventive_observations, preventive_recommendations,
    photo_paths, docx_path, created_by
  )
  select
    target_job_id,
    coalesce((select max(sequence_num) from public.roof_reports where job_id = target_job_id), 0) + 1,
    p_client_name, p_property_address, p_date_of_inspection,
    p_inspector, p_work_order, p_roof_type, p_roof_age, p_roof_pitch,
    p_urgent_observations, p_urgent_recommendations,
    p_preventive_observations, p_preventive_recommendations,
    p_photo_paths, p_docx_path, auth.uid()
  returning * into new_row;

  return new_row;
end;
$$;

comment on function public.create_roof_report(uuid, text, text, date, text, text, public.roof_type_option, text, text, text[], text[], text[], text[], text[], text) is 'Creates one roof_reports row for a job: sequence_num = next per-job counter, computed atomically in the same insert (same pattern as create_invoice). SECURITY INVOKER -- admin/office already have full INSERT rights via RLS, so this buys atomic sequence numbering, not elevated privilege. A technician calling this directly gets a real RLS policy violation, not a null.';
