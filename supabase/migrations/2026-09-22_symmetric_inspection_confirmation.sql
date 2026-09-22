-- 2026-09-22_symmetric_inspection_confirmation.sql
-- Design change: Quote-stage inspection entries now behave symmetrically
-- with work entries instead of always direct-confirming. create_schedule_entry()
-- gives a Quote job a tentative inspection unless it already has a confirmed
-- one; confirm_schedule_entry() now accepts inspection entries too, scoping
-- its sibling-tentative-drop to the SAME entry_type so a tentative work hold
-- and a tentative inspection candidate on the same job never affect each
-- other. The Work-Order/Scheduled work-entry rule and the Completed
-- direct-confirm rule (added 2026-09-21) are both unchanged.
-- remove_schedule_entry() is untouched -- it already only reacts to
-- entry_type='work' removals, which doesn't depend on inspection behaviour.

create or replace function public.create_schedule_entry(
  target_job_id uuid,
  target_technician_id uuid,
  target_date date,
  target_start time,
  target_end time
)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  job_status public.job_status;
  has_confirmed_inspection boolean;
  has_confirmed_work boolean;
  new_entry_type public.schedule_entry_type;
  new_status public.schedule_entry_status;
  result public.schedule_entries;
begin
  select status into job_status from public.jobs where id = target_job_id;

  if job_status = 'Quote' then
    new_entry_type := 'inspection';
    select exists (
      select 1 from public.schedule_entries
      where job_id = target_job_id and entry_type = 'inspection' and status = 'confirmed'
    ) into has_confirmed_inspection;
    new_status := case when has_confirmed_inspection then 'confirmed' else 'tentative' end;
  elsif job_status = 'Completed' then
    new_entry_type := 'work';
    new_status := 'confirmed';
  else
    new_entry_type := 'work';
    select exists (
      select 1 from public.schedule_entries
      where job_id = target_job_id and entry_type = 'work' and status = 'confirmed'
    ) into has_confirmed_work;
    new_status := case when has_confirmed_work then 'confirmed' else 'tentative' end;
  end if;

  insert into public.schedule_entries
    (job_id, technician_id, entry_type, status, scheduled_date, start_time, end_time, created_by)
  values
    (target_job_id, target_technician_id, new_entry_type, new_status, target_date, target_start, target_end, auth.uid())
  returning * into result;

  if new_entry_type = 'work' and new_status = 'confirmed' and job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = target_job_id;
  end if;

  return result;
end;
$$;

comment on function public.create_schedule_entry(uuid, uuid, date, time, time) is 'Creates one schedule_entries row. Quote-stage jobs get a tentative inspection entry, unless the job already has a confirmed inspection entry, in which case the new entry is directly confirmed -- symmetric with the Work-Order/Scheduled rule below. Completed jobs (e.g. a warranty return visit) get a directly-confirmed work entry and their status is left as Completed. Work-Order/Scheduled-stage jobs get a tentative work entry, unless the job already has a confirmed work entry (a second/third day), in which case the new entry is also directly confirmed. A directly-confirmed work entry on a Work-Order-stage job advances jobs.status to Scheduled.';

create or replace function public.confirm_schedule_entry(target_entry_id uuid)
returns public.schedule_entries
language plpgsql
security invoker
set search_path = public
as $$
declare
  job_status public.job_status;
  result public.schedule_entries;
begin
  update public.schedule_entries
  set status = 'confirmed'
  where id = target_entry_id and status = 'tentative'
  returning * into result;

  if result.id is null then
    raise exception 'schedule entry % is not a tentative entry', target_entry_id;
  end if;

  delete from public.schedule_entries
  where job_id = result.job_id
    and entry_type = result.entry_type
    and status = 'tentative'
    and id != target_entry_id;

  select status into job_status from public.jobs where id = result.job_id;
  if result.entry_type = 'work' and job_status = 'Work Order' then
    update public.jobs set status = 'Scheduled' where id = result.job_id;
  end if;

  return result;
end;
$$;

comment on function public.confirm_schedule_entry(uuid) is 'Promotes one tentative entry (work or inspection) to confirmed, deletes every other tentative entry of the SAME entry_type for the same job, and advances jobs.status Work Order -> Scheduled if the confirmed entry is a work entry and the job has not already moved past Work Order. Raises if the target row is not a tentative entry.';

comment on table public.schedule_entries is 'A dispatch-calendar booking: one job, one technician, one date/time range. Multiple confirmed rows per job represent a multi-day work booking. entry_type is fixed at creation from jobs.status at that moment (Quote -> inspection, else -> work) and never changes afterward. Both inspection and work rows pass through tentative status: each is tentative unless the job already has a confirmed entry of that same entry_type, in which case the new entry is directly confirmed. Completed-status jobs are the one exception -- always a directly-confirmed work entry.';
